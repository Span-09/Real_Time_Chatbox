import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, setPersistence, browserLocalPersistence, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, query, where, orderBy, limit, setDoc, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
// Ensure the session persists and avoids transient state glitches
try {
    await setPersistence(auth, browserLocalPersistence);
} catch (e) {
    console.warn("Auth persistence setup failed:", e);
}
const db = getFirestore(app);

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
        loadChatrooms();
        listenForMuteChanges();
        populateCreateFromRoomSelect();
    } else {
        // Not signed in or anonymous: show login modal
        loginModal.style.display = 'flex';
    }
});

async function loadChatrooms() {
    if (!currentUser) return;   
    try {
        const roomsRef = collection(db, 'chatrooms');
        const roomsSnapshot = await getDocs(roomsRef);

        const promises = roomsSnapshot.docs.map(async (roomDoc) => {
            const room = { id: roomDoc.id, ...roomDoc.data() };
            const lastMessage = await getLastMessage(room.id);
            const unreadCount = await getUnreadCount(room.id, currentUser.uid);
            return { room, lastMessage, unreadCount };
        });

        const chatroomData = await Promise.all(promises);

        chatroomData.sort((a, b) => (b.room.pinned || false) - (a.room.pinned || false));

        chatroomListEl.innerHTML = '';
        chatroomData.forEach(data => {
            const roomElement = createRoomElement(data.room, data.lastMessage, data.unreadCount);
            addSwipeToMute(roomElement);
            chatroomListEl.appendChild(roomElement);
        });
    } catch (error) {
        console.error("Error loading chatrooms:", error);
        alert("Could not load chatrooms.");
    }
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

async function getUnreadCount(roomId, userId) {
    const readStatusRef = doc(db, 'reads', userId, 'rooms', roomId);
    const readDoc = await getDoc(readStatusRef);
    const lastReadTimestamp = readDoc.exists() ? readDoc.data().lastReadTimestamp : null;

    const messagesRef = collection(db, 'chatrooms', roomId, 'messages');
    const unreadQuery = lastReadTimestamp ? query(messagesRef, where('timestamp', '>', lastReadTimestamp)) : query(messagesRef);
    const unreadSnapshot = await getDocs(unreadQuery);
    return unreadSnapshot.size;
}

function createRoomElement(room, lastMessage, unreadCount) {
    const roomElement = document.createElement('div');
    roomElement.className = 'chatroom-item';
    roomElement.dataset.roomId = room.id;
    roomElement.dataset.roomTitle = room.title;

    const formattedTimestamp = lastMessage.timestamp ? lastMessage.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    roomElement.innerHTML = `
        <div class="chatroom-details">
            <div class="chatroom-title">${room.title || 'Untitled Chat'}</div>
            <div class="last-message">${lastMessage.text}</div>
        </div>
        <div class="chatroom-meta">
            <div class="last-message-time">${formattedTimestamp}</div>
            ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
        </div>
        <button class="mute-button" data-room-id="${room.id}">Mute</button>
    `;

    const details = roomElement.querySelector('.chatroom-details');
    details.addEventListener('click', () => {
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
        // Firebase v10 often returns auth/invalid-credential for non-existent users OR wrong password
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
            try {
                // Attempt to create the account; if it already exists, we’ll get email-already-in-use
                await createUserWithEmailAndPassword(auth, email, password);
                // Set defaults immediately for brand-new users
                await ensureProfileDefaults(auth.currentUser);
            } catch (err) {
                if (err.code === 'auth/email-already-in-use') {
                    // Email exists, so the original error was likely a wrong password
                    loginError.textContent = 'Incorrect password for existing account.';
                } else if (err.code === 'auth/invalid-email') {
                    loginError.textContent = 'Invalid email format.';
                } else if (err.code === 'auth/weak-password') {
                    loginError.textContent = 'Password must be at least 6 characters.';
                } else {
                    loginError.textContent = err.code + ': ' + err.message;
                }
            }
        } else {
            // Other errors surfaced directly
            loginError.textContent = error.code + ": " + error.message;
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