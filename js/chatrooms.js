import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, setPersistence, browserLocalPersistence, updateProfile, fetchSignInMethodsForEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, collectionGroup, doc, getDocs, getDoc, query, where, orderBy, limit, setDoc, onSnapshot, addDoc, serverTimestamp, getCountFromServer, documentId } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyDEpEbOdl7ysRoYZBj3phVcfA5wxE6W37c",
    authDomain: "real-time-chatbot-372f7.firebaseapp.com",
    projectId: "real-time-chatbot-372f7",
    storageBucket: "real-time-chatbot-372f7.appspot.com",
    messagingSenderId: "88476999060",
    appId: "1:88476999060:web:ec54d7298b84333d274381",
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Ensure the session persists and avoids transient state glitches (do not block script)
setPersistence(auth, browserLocalPersistence).catch((e) => {
    console.warn("Auth persistence setup failed:", e);
});
const db = getFirestore(app);
let presenceIntervalId = null;

function startPresenceHeartbeat(user) {
    if (!user) return;
    const presRef = doc(db, 'presence', user.uid);
    const ping = (status = 'online') => {
        setDoc(presRef, { userId: user.uid, status, lastActiveAt: serverTimestamp() }, { merge: true });
    };
    ping('online');
    if (presenceIntervalId) clearInterval(presenceIntervalId);
    presenceIntervalId = setInterval(() => ping('online'), 30000);
    window.addEventListener('focus', () => ping('online'));
    window.addEventListener('blur', () => ping('away'));
    window.addEventListener('online', () => ping('online'));
    window.addEventListener('offline', () => ping('offline'));
}

// --- DOM References ---
const chatroomListEl = document.getElementById('chatroom-list');
const searchBar = document.getElementById('search-bar');
const createRoomBtn = document.getElementById('create-room-btn');
const memberPicker = document.getElementById('member-picker');
const memberSearchResults = document.getElementById('member-search-results');
const selectedMembersDiv = document.getElementById('selected-members');
const createRoomModal = document.getElementById('create-room-modal');
const cancelCreateRoom = document.getElementById('cancel-create-room');
const createRoomForm = document.getElementById('create-room-form');
const createRoomConfirmBtn = document.getElementById('create-room-confirm-btn');
const createFromRoomSelect = document.getElementById('create-from-room');
const createRoomError = document.getElementById('create-room-error');
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const passwordInput = document.getElementById('login-password');
const togglePassword = document.getElementById('toggle-password');
const userAvatarImg = document.getElementById('user-avatar');
let currentUser;
let selectedMembers = [];
const CHATLIST_CACHE_KEY = 'chatrooms:list:v1';
const CHAT_RETURN_FAST_FLAG = 'chat:return-fast';
let hadCacheAtStartup = false;
let liveFetchScheduled = false;

// Simple concurrency limiter for parallel Firestore calls
async function pMap(items, mapper, concurrency = 6) {
    const ret = [];
    let i = 0;
    const work = async () => {
        while (i < items.length) {
            const idx = i++;
            ret[idx] = await mapper(items[idx], idx);
        }
    };
    const workers = Array(Math.min(concurrency, Math.max(1, items.length))).fill(0).map(work);
    await Promise.all(workers);
    return ret;
}

// Instant cache render on load (before auth state settles)
try {
    const cached = sessionStorage.getItem(CHATLIST_CACHE_KEY);
    if (cached) {
        const { items } = JSON.parse(cached);
        if (Array.isArray(items) && chatroomListEl) {
            renderChatrooms(items, { fromCache: true });
            hadCacheAtStartup = true;
        }
    }
} catch {}

// If returning via back/forward, delay live fetch so UI stays instant
try {
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation');
    const type = nav && nav[0] && nav[0].type;
    if ((type === 'back_forward' || sessionStorage.getItem(CHAT_RETURN_FAST_FLAG) === '1') && hadCacheAtStartup) {
        setTimeout(() => {
            if (!liveFetchScheduled) { liveFetchScheduled = true; loadChatrooms().finally(() => { liveFetchScheduled = false; }); }
        }, 600);
        sessionStorage.removeItem(CHAT_RETURN_FAST_FLAG);
    }
} catch {}

// --- Helpers ---
function buildPrefixes(str) {
    const keys = new Set();
    if (!str) return keys;
    const clean = str.toLowerCase().trim();
    if (!clean) return keys;
    // Split on non-alphanumeric to support names like "Jean-Luc Picard"
    const parts = clean.split(/[^a-z0-9]+/).filter(Boolean);
    for (const part of parts) {
        for (let i = 1; i <= part.length; i++) {
            keys.add(part.slice(0, i));
        }
    }
    return keys;
}

function buildSearchKeys(name, email) {
    const keys = new Set();
    const nm = (name || '').trim();
    const em = (email || '').trim().toLowerCase();
    // Name prefixes
    for (const k of buildPrefixes(nm)) keys.add(k);
    // Email full + local part prefixes
    if (em) {
        keys.add(em);
        const local = em.split('@')[0] || '';
        for (const k of buildPrefixes(local)) keys.add(k);
    }
    return Array.from(keys);
}

async function ensureProfileDefaults(user) {
    if (!user) return;
    const hasName = !!(user.displayName && user.displayName.trim());
    const hasPhoto = !!user.photoURL;
    if (hasName && hasPhoto) return;
    const derivedName = hasName ? user.displayName : (user.email ? user.email.split('@')[0] : `User-${user.uid.slice(-5)}`);
    const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(derivedName)}&background=random`;
    try {
        await updateProfile(user, {
            displayName: hasName ? user.displayName : derivedName,
            photoURL: hasPhoto ? user.photoURL : defaultAvatar,
        });
    } catch (e) {
        console.warn('Failed to update profile defaults:', e);
    }
}

// --- Show/Hide Modal ---
createRoomBtn.addEventListener('click', () => {
    createRoomModal.style.display = 'flex';
});
cancelCreateRoom.addEventListener('click', () => {
    createRoomModal.style.display = 'none';
});
createRoomModal.addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
});

// --- Upsert User Profile ---
async function upsertUserProfile(user) {
    const userRef = doc(db, 'users', user.uid);
    const existing = await getDoc(userRef);
    const displayName = (user.displayName && user.displayName.trim()) || (user.email ? user.email.split('@')[0] : `User-${user.uid.slice(-5)}`);
    const email = user.email || '';
    const photoUrl = user.photoURL || '';
    const profile = {
        displayName,
    displayNameLower: displayName.toLowerCase(),
        email,
    emailLower: email.toLowerCase(),
        photoUrl,
        // Preserve createdAt if exists
        createdAt: existing.exists() && existing.data().createdAt ? existing.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
        searchKeys: buildSearchKeys(displayName, email),
    };
    await setDoc(userRef, profile, { merge: true });
}

// --- Authentication ---
onAuthStateChanged(auth, async user => {
    currentUser = user ? user : null;
    if (currentUser && !currentUser.isAnonymous) {
    startPresenceHeartbeat(currentUser);
        // Only upsert if user is NOT anonymous
        if (!currentUser.isAnonymous) {
            await ensureProfileDefaults(currentUser);
            await upsertUserProfile(currentUser);
        }
        loginModal.style.display = 'none';
        try {
            const name = (currentUser.displayName && currentUser.displayName.trim()) || (currentUser.email ? currentUser.email.split('@')[0] : 'User');
            const avatar = currentUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
            if (userAvatarImg) {
                userAvatarImg.src = avatar;
                userAvatarImg.alt = name;
                userAvatarImg.title = name;
            }
        } catch {}
        if (hadCacheAtStartup) {
            if (!liveFetchScheduled) {
                liveFetchScheduled = true;
                setTimeout(() => { loadChatrooms().finally(() => { liveFetchScheduled = false; }); }, 350);
            }
        } else {
            loadChatrooms();
        }
        listenForMuteChanges();
        populateCreateFromRoomSelect();
    } else {
        // If we somehow have an anonymous session, sign it out and show login
        if (user && user.isAnonymous) {
            try { await signOut(auth); } catch {}
        }
        loginModal.style.display = 'flex';
    }
});

async function loadChatrooms() {
    if (!currentUser) return;

    // 1) Render from cache instantly for perceived speed
    try {
        const cached = sessionStorage.getItem(CHATLIST_CACHE_KEY);
        if (cached) {
            const { items } = JSON.parse(cached);
            renderChatrooms(items, { fromCache: true });
        }
    } catch {}

    // 2) Live refresh: try collectionGroup; if denied by rules, fall back to per-room membership checks
    try {
        let rooms = [];
        try {
            const membersCg = collectionGroup(db, 'members');
            const myMembershipsQ = query(membersCg, where(documentId(), '==', currentUser.uid));
            const membershipSn = await getDocs(myMembershipsQ);
            const roomRefs = Array.from(new Set(
                membershipSn.docs.map(d => d.ref.parent.parent).filter(Boolean)
            ));
            const roomDocs = await pMap(roomRefs, async (r) => await getDoc(r));
            rooms = roomDocs.filter(d => d && d.exists()).map(d => ({ id: d.id, ...d.data() }));
        } catch (cgErr) {
            // Fallback: prior behavior — fetch chatrooms directly (rules must allow list)
            const roomsRef = collection(db, 'chatrooms');
            const roomsSnapshot = await getDocs(roomsRef);
            rooms = roomsSnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        }

        // Preload last messages with limited concurrency; prefer room metadata if present
        const lastMessages = await pMap(rooms, async (room) => {
            if (room.lastMessageText || room.lastMessageAt) {
                return {
                    text: room.lastMessageText || 'No messages yet...',
                    timestamp: room.lastMessageAt || null,
                };
            }
            return await getLastMessage(room.id);
        }, 6);

        // Prepare items with unreadCount as null initially for lazy hydration
        const items = rooms.map((room, idx) => ({
            room,
            lastMessage: lastMessages[idx] || { text: 'No messages yet...', timestamp: null },
            unreadCount: null,
        }));

        // Sort: pinned first, then by last message time desc
        items.sort((a, b) => {
            const ap = !!a.room.pinned, bp = !!b.room.pinned;
            if (ap !== bp) return bp - ap;
            const at = a.lastMessage.timestamp?.toMillis?.() || 0;
            const bt = b.lastMessage.timestamp?.toMillis?.() || 0;
            return bt - at;
        });

    // Render list quickly without unread
        renderChatrooms(items);

        // Cache for fast back/forward
        try {
            sessionStorage.setItem(CHATLIST_CACHE_KEY, JSON.stringify({ items }));
        } catch {}

        // 3) Lazy load unread counts in background (use a single reads fetch, then per-room count)
        hydrateUnreadCounts(items);
    } catch (error) {
        console.error('Error loading chatrooms:', error);
        alert('Could not load chatrooms.');
    }
}

function renderChatrooms(items, { fromCache = false } = {}) {
    const frag = document.createDocumentFragment();
    chatroomListEl.innerHTML = '';
    for (const data of items) {
        const el = createRoomElement(data.room, data.lastMessage, data.unreadCount);
        addSwipeToMute(el);
        frag.appendChild(el);
    }
    chatroomListEl.appendChild(frag);
}

async function getLastMessage(roomId) {
    const messagesRef = collection(db, 'chatrooms', roomId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
        return { text: 'No messages yet...', timestamp: null };
    }
    const lastMessageData = snapshot.docs[0].data();
    if (lastMessageData.imageUrl && !lastMessageData.text) {
        return { text: '📷 Image', timestamp: lastMessageData.timestamp };
    }
    return lastMessageData;
}

async function getUnreadCount(roomId, userId, lastReadTimestamp) {
    const messagesRef = collection(db, 'chatrooms', roomId, 'messages');
    const unreadQuery = lastReadTimestamp ? query(messagesRef, where('timestamp', '>', lastReadTimestamp)) : query(messagesRef);
    try {
        const agg = await getCountFromServer(unreadQuery);
        return agg.data().count || 0;
    } catch {
        // Fallback to fetching minimal snapshot size
        const unreadSnapshot = await getDocs(unreadQuery);
        return unreadSnapshot.size;
    }
}

async function hydrateUnreadCounts(items) {
    try {
        const MAX_HYDRATE = 20; // hydrate top N first
        const subset = items.slice(0, MAX_HYDRATE);
        // Pull all read markers for the user in one go
        const readsRef = collection(db, 'reads', currentUser.uid, 'rooms');
        const readsSn = await getDocs(readsRef);
        const lastReadMap = new Map();
        readsSn.forEach(d => {
            const data = d.data();
            lastReadMap.set(d.id, data.lastReadTimestamp || null);
        });

        // Compute counts with limited concurrency
        const counts = await pMap(subset, async (item) => {
            const lr = lastReadMap.get(item.room.id) || null;
            return await getUnreadCount(item.room.id, currentUser.uid, lr);
        }, 6);

        // Update DOM in-place without full re-render
        subset.forEach((item, idx) => {
            const count = counts[idx] || 0;
            item.unreadCount = count;
            const container = chatroomListEl.querySelector(`.chatroom-item[data-room-id="${item.room.id}"]`);
            if (container) {
                let meta = container.querySelector('.chatroom-meta');
                if (meta) {
                    let badge = meta.querySelector('.unread-badge');
                    if (count > 0) {
                        if (!badge) {
                            badge = document.createElement('div');
                            badge.className = 'unread-badge';
                            meta.appendChild(badge);
                        }
                        badge.textContent = String(count);
                    } else if (badge) {
                        badge.remove();
                    }
                }
            }
        });

        // Refresh cache with unread counts
        try { sessionStorage.setItem(CHATLIST_CACHE_KEY, JSON.stringify({ items })); } catch {}
    } catch (e) {
        console.warn('Failed to hydrate unread counts:', e);
    }
}

function createRoomElement(room, lastMessage, unreadCount) {
    const roomElement = document.createElement('div');
    roomElement.className = 'chatroom-item';
    roomElement.dataset.roomId = room.id;
    roomElement.dataset.roomTitle = room.title;

    const ts = lastMessage && lastMessage.timestamp;
    const formattedTimestamp = ts && ts.toDate ? ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const previewText = (lastMessage && (lastMessage.text || (lastMessage.imageUrl && '📷 Image'))) || 'No messages yet...';

    roomElement.innerHTML = `
        <div class="chatroom-details">
            <div class="chatroom-title">${room.title || 'Untitled Chat'}</div>
            <div class="last-message">${previewText}</div>
        </div>
        <div class="chatroom-meta">
            <div class="last-message-time">${formattedTimestamp}</div>
            ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
        </div>
        <button class="mute-button" data-room-id="${room.id}">Mute</button>
    `;

    const details = roomElement.querySelector('.chatroom-details');
    details.addEventListener('click', () => {
        try { sessionStorage.setItem(CHAT_RETURN_FAST_FLAG, '1'); } catch {}
        window.location.href = `chat.html?roomId=${room.id}&title=${encodeURIComponent(room.title)}`;
    });

    return roomElement;
}

async function toggleMute(roomId, button) {
    if (!currentUser) return;
    const muteRef = doc(db, 'mutes', currentUser.uid, 'rooms', roomId);
    const muteDoc = await getDoc(muteRef);
    const newMuteStatus = !muteDoc.exists() || !muteDoc.data().muted;
    try {
        await setDoc(muteRef, { muted: newMuteStatus });
    } catch (error) {
        console.error("Error updating mute status:", error);
    }
}

function updateMuteButtonUI(button, isMuted) {
    button.textContent = isMuted ? 'Unmute' : 'Mute';
    button.classList.toggle('muted', isMuted);
}

function listenForMuteChanges() {
    if (!currentUser) return;
    const mutesRef = collection(db, 'mutes', currentUser.uid, 'rooms');
    onSnapshot(mutesRef, (snapshot) => {
        snapshot.docs.forEach(doc => {
            const roomId = doc.id;
            const isMuted = doc.data().muted;
            const button = document.querySelector(`.mute-button[data-room-id="${roomId}"]`);
            if (button) {
                updateMuteButtonUI(button, isMuted);
            }
        });
    });
}

function addSwipeToMute(element) {
    let longPressTimeout;
    element.addEventListener('mousedown', () => {
        longPressTimeout = setTimeout(() => {
            const roomId = element.dataset.roomId;
            const muteButton = element.querySelector('.mute-button');
            toggleMute(roomId, muteButton);
        }, 800);
    });
    element.addEventListener('mouseup', () => clearTimeout(longPressTimeout));
    element.addEventListener('mouseleave', () => clearTimeout(longPressTimeout));
}

chatroomListEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('mute-button')) {
        toggleMute(e.target.dataset.roomId, e.target);
    }
});

searchBar.addEventListener('keyup', (e) => {
    const term = e.target.value.toLowerCase();
    const rooms = chatroomListEl.getElementsByClassName('chatroom-item');
    Array.from(rooms).forEach((room) => {
        const title = room.querySelector('.chatroom-title').textContent.toLowerCase();
        room.style.display = title.includes(term) ? 'flex' : 'none';
    });
});

// --- Create Room Form Submission ---
createRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (createRoomError) createRoomError.textContent = '';
    const roomTitle = document.getElementById('room-title-input').value.trim();
    if (!roomTitle) {
        if (createRoomError) createRoomError.textContent = "Please enter a room title.";
        return;
    }
    // Local duplicate title validation (case-insensitive) against currently loaded list
    const existingTitles = Array.from(document.querySelectorAll('.chatroom-item .chatroom-title'))
        .map(el => el.textContent.trim().toLowerCase());
    if (existingTitles.includes(roomTitle.toLowerCase())) {
        if (createRoomError) createRoomError.textContent = "A room with this title already exists.";
        return;
    }
    // Always include self
    if (!selectedMembers.find(m => m.uid === currentUser.uid)) {
        selectedMembers.push({ uid: currentUser.uid, displayName: currentUser.displayName || currentUser.uid });
        renderSelectedMembers();
    }
    try {
        const roomsRef = collection(db, 'chatrooms');
        const roomDoc = await addDoc(roomsRef, {
            type: "group",
            title: roomTitle,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp()
        });
        for (const member of selectedMembers) {
            await setDoc(doc(db, 'chatrooms', roomDoc.id, 'members', member.uid), {
                role: member.uid === currentUser.uid ? "admin" : "member",
                joinedAt: serverTimestamp()
            });
        }
        selectedMembers = [];
        renderSelectedMembers();
        document.getElementById('room-title-input').value = '';
        createRoomModal.style.display = 'none';
        loadChatrooms();
        // success: keep UI silent or add a brief toast if desired
    } catch (error) {
        console.error("Error creating new chatroom:", error);
        if (createRoomError) {
            // Minimal, user-friendly message
            createRoomError.textContent = "Could not create room. Please try again.";
        }
    }
});

// --- Optional: Create-From Existing Room ---
async function populateCreateFromRoomSelect() {
    createFromRoomSelect.innerHTML = '<option value="">Select a room</option>';
    const roomsRef = collection(db, 'chatrooms');
    const roomsSnapshot = await getDocs(roomsRef);
    roomsSnapshot.forEach(docSnap => {
        const option = document.createElement('option');
        option.value = docSnap.id;
        option.textContent = docSnap.data().title || docSnap.id;
        createFromRoomSelect.appendChild(option);
    });
}

createFromRoomSelect.addEventListener('change', async (e) => {
    const roomId = e.target.value;
    if (!roomId) return;
    const membersRef = collection(db, 'chatrooms', roomId, 'members');
    const snapshot = await getDocs(membersRef);
    const members = await Promise.all(snapshot.docs.map(async (docSnap) => {
        const uid = docSnap.id;
        try {
            const uDoc = await getDoc(doc(db, 'users', uid));
            const data = uDoc.exists() ? uDoc.data() : {};
            return { uid, displayName: data.displayName || data.email || uid };
        } catch {
            return { uid, displayName: uid };
        }
    }));
    selectedMembers = members;
    renderSelectedMembers();
});

memberPicker.addEventListener('input', async (e) => {
    const term = e.target.value.trim().toLowerCase();
    if (!term) {
        memberSearchResults.innerHTML = '';
        return;
    }
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('searchKeys', 'array-contains', term), limit(10));
    const snapshot = await getDocs(q);
    memberSearchResults.innerHTML = '';
    snapshot.forEach(docSnap => {
        const user = docSnap.data();
        if (selectedMembers.find(m => m.uid === docSnap.id)) return;
        const item = document.createElement('div');
        item.className = 'member-result-item';
        item.textContent = user.displayName || user.email || docSnap.id;
        item.onclick = () => {
            selectedMembers.push({ uid: docSnap.id, displayName: user.displayName || user.email || docSnap.id });
            renderSelectedMembers();
            memberSearchResults.innerHTML = '';
            memberPicker.value = '';
        };
        memberSearchResults.appendChild(item);
    });
});

function renderSelectedMembers() {
    selectedMembersDiv.innerHTML = '';
    selectedMembers.forEach(member => {
        const tag = document.createElement('span');
        tag.className = 'selected-member-tag';
        tag.textContent = member.displayName;
        tag.onclick = () => {
            selectedMembers = selectedMembers.filter(m => m.uid !== member.uid);
            renderSelectedMembers();
        };
        selectedMembersDiv.appendChild(tag);
    });
}

// --- Login Form Submission ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !email.includes('@')) {
        loginError.textContent = "Please enter a valid email address.";
        return;
    }
    if (!password || password.length < 6) {
        loginError.textContent = "Password must be at least 6 characters.";
        return;
    }
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        // Distinguish wrong password vs new user by checking sign-in methods
        try {
            const methods = await fetchSignInMethodsForEmail(auth, email);
            if (!methods || methods.length === 0) {
                // New user: create account
                await createUserWithEmailAndPassword(auth, email, password);
                await ensureProfileDefaults(auth.currentUser);
            } else {
                // Existing user: wrong password or other auth issue
                loginError.textContent = 'Incorrect password for existing account.';
            }
        } catch (err) {
            if (err.code === 'auth/invalid-email') {
                loginError.textContent = 'Invalid email format.';
            } else if (err.code === 'auth/weak-password') {
                loginError.textContent = 'Password must be at least 6 characters.';
            } else if (err.code === 'auth/too-many-requests') {
                loginError.textContent = 'Too many attempts. Please try again later.';
            } else {
                loginError.textContent = (err.code || 'auth/error') + ': ' + (err.message || 'Login failed');
            }
        }
    }
});

togglePassword.addEventListener('click', () => {
  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    togglePassword.textContent = "🙈";
  } else {
    passwordInput.type = "password";
    togglePassword.textContent = "👁️";
  }
});
