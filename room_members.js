import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, onSnapshot, setDoc, deleteDoc, serverTimestamp, query, where, getDocs, writeBatch, limit, orderBy, startAt, endAt } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase config must match your project
const firebaseConfig = {
  apiKey: "AIzaSyDEpEbOdl7ysRoYZBj3phVcfA5wxE6W37c",
  authDomain: "real-time-chatbot-372f7.firebaseapp.com",
  projectId: "real-time-chatbot-372f7",
  storageBucket: "real-time-chatbot-372f7.appspot.com",
  messagingSenderId: "88476999060",
  appId: "1:88476999060:web:ec54d7298b84333d274381",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
try { await setPersistence(auth, browserLocalPersistence) } catch (e) { console.warn('Auth persistence setup failed:', e) }
const db = getFirestore(app);

// DOM
const backLink = document.getElementById('back-link');
const roomTitleEl = document.getElementById('room-title');
const adminActions = document.getElementById('admin-actions');
const membersList = document.getElementById('members-list');
const membersEmpty = document.getElementById('members-empty');
const membersError = document.getElementById('members-error');

const addMembersModal = document.getElementById('add-members-modal');
const openAddMembersBtn = document.getElementById('open-add-members');
const cancelAddMembersBtn = document.getElementById('cancel-add-members');
const confirmAddMembersBtn = document.getElementById('confirm-add-members');
const memberSearchInput = document.getElementById('member-search-input');
const memberSearchDropdown = document.getElementById('member-search-dropdown');
const selectedNewMembers = document.getElementById('selected-new-members');
const addMembersError = document.getElementById('add-members-error');

// State
let currentUser = null;
let roomId = null;
let myRole = 'member';
let roomTitle = '';
let membersCache = new Map(); // uid -> { displayName, email, photoUrl, role }
let selectedToAdd = []; // [{ uid, displayName }]

function getQueryParam(name) {
  const params = new URLSearchParams(location.search);
  return params.get(name);
}

function avatarFor(name, photoUrl) {
  if (photoUrl) return photoUrl;
  const n = name || 'User';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(n)}&background=random`;
}

function renderMembers() {
  membersList.innerHTML = '';
  const entries = Array.from(membersCache.entries());
  if (entries.length === 0) {
    membersEmpty.style.display = 'block';
    return;
  }
  membersEmpty.style.display = 'none';

  const adminsCount = entries.filter(([_, m]) => m.role === 'admin').length;

  for (const [uid, m] of entries) {
    const row = document.createElement('div');
    row.className = 'member-row';

    const left = document.createElement('div');
    left.className = 'member-info';
    const img = document.createElement('img');
    img.className = 'member-avatar';
    img.src = avatarFor(m.displayName || m.email || 'User', m.photoUrl);
    img.alt = m.displayName || m.email || uid;
    const name = document.createElement('div');
    name.className = 'member-name';
    name.textContent = m.displayName || m.email || uid;
    const role = document.createElement('span');
    role.className = 'role-badge';
    role.textContent = m.role;
    left.appendChild(img);
    left.appendChild(name);
    left.appendChild(role);

    const right = document.createElement('div');
    right.className = 'member-actions';

    if (myRole === 'admin') {
      // Promote/Demote actions
      if (m.role === 'member') {
        const promoteBtn = document.createElement('button');
        promoteBtn.className = 'btn-secondary btn-pill';
        promoteBtn.textContent = 'Promote to admin';
        promoteBtn.onclick = () => changeRole(uid, 'admin');
        right.appendChild(promoteBtn);
      } else if (m.role === 'admin') {
        if (adminsCount > 1) {
          const demoteBtn = document.createElement('button');
          demoteBtn.className = 'btn-secondary btn-pill';
          demoteBtn.textContent = 'Demote to member';
          demoteBtn.onclick = () => changeRole(uid, 'member');
          right.appendChild(demoteBtn);
        }
      }

      // Remove member (not for last admin)
      if (!(m.role === 'admin' && adminsCount === 1)) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-danger';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = () => removeMember(uid, m.role, adminsCount);
        right.appendChild(removeBtn);
      }
    }

    row.appendChild(left);
    row.appendChild(right);
    membersList.appendChild(row);
  }
}

async function removeMember(uid, role, adminsCount) {
  addMembersError.textContent = '';
  if (role === 'admin' && adminsCount <= 1) {
    addMembersError.textContent = "Can't remove the last admin.";
    return;
  }
  try {
    await deleteDoc(doc(db, 'chatrooms', roomId, 'members', uid));
  } catch (e) {
    membersError.textContent = 'Failed to remove member.';
    console.error(e);
  }
}

async function changeRole(uid, newRole) {
  try {
    // Guard: don’t demote the last admin
    if (newRole === 'member') {
      const currentAdmins = Array.from(membersCache.values()).filter(m => m.role === 'admin').length;
      const isTargetAdmin = (membersCache.get(uid)?.role === 'admin');
      if (isTargetAdmin && currentAdmins <= 1) {
        membersError.textContent = "Can't demote the last admin.";
        return;
      }
    }
    await setDoc(doc(db, 'chatrooms', roomId, 'members', uid), { role: newRole }, { merge: true });
  } catch (e) {
    membersError.textContent = 'Failed to change role.';
    console.error(e);
  }
}

function openAddModal() {
  selectedToAdd = [];
  selectedNewMembers.innerHTML = '';
  memberSearchInput.value = '';
  memberSearchDropdown.innerHTML = '';
  addMembersError.textContent = '';
  addMembersModal.style.display = 'flex';
}
function closeAddModal() { addMembersModal.style.display = 'none'; }

openAddMembersBtn?.addEventListener('click', openAddModal);
cancelAddMembersBtn?.addEventListener('click', closeAddModal);
addMembersModal?.addEventListener('click', (e) => { if (e.target === addMembersModal) closeAddModal(); });

memberSearchInput?.addEventListener('input', async (e) => {
  const term = e.target.value.trim().toLowerCase();
  memberSearchDropdown.innerHTML = '';
  if (!term) return;
  try {
    const usersRef = collection(db, 'users');
    const q1 = query(usersRef, where('searchKeys', 'array-contains', term), limit(10));
    let snap = await getDocs(q1);

    // Fallback: prefix match on email if no results (helps older profiles without prefixes)
    if (snap.empty) {
      const q2 = query(usersRef, orderBy('emailLower'), startAt(term), endAt(term + '\uf8ff'), limit(10));
      snap = await getDocs(q2);
    }
    // Second fallback: prefix match on displayNameLower
    if (snap.empty) {
      const q3 = query(usersRef, orderBy('displayNameLower'), startAt(term), endAt(term + '\uf8ff'), limit(10));
      snap = await getDocs(q3);
    }

    let added = 0;
    snap.forEach(docSnap => {
      // Skip members already in the room
      if (membersCache.has(docSnap.id)) return;
      const u = docSnap.data();
      const item = document.createElement('div');
      item.className = 'member-result-item';
      item.textContent = u.displayName || u.email || docSnap.id;
      item.onclick = () => {
        if (!selectedToAdd.find(m => m.uid === docSnap.id)) {
          selectedToAdd.push({ uid: docSnap.id, displayName: u.displayName || u.email || docSnap.id });
          renderSelectedToAdd();
        }
        memberSearchDropdown.innerHTML = '';
        memberSearchInput.value = '';
      };
      memberSearchDropdown.appendChild(item);
      added++;
    });

    if (snap.empty || added === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'member-result-item';
      emptyMsg.style.color = '#6b7280';
      emptyMsg.textContent = snap.empty ? 'No matches' : 'No matches (all are already members)';
      memberSearchDropdown.appendChild(emptyMsg);
    }
  } catch (e) {
    console.error(e);
  }
});

function renderSelectedToAdd() {
  selectedNewMembers.innerHTML = '';
  selectedToAdd.forEach(m => {
    const tag = document.createElement('span');
    tag.className = 'selected-member-tag';
    tag.textContent = m.displayName;
    tag.onclick = () => {
      selectedToAdd = selectedToAdd.filter(x => x.uid !== m.uid);
      renderSelectedToAdd();
    };
    selectedNewMembers.appendChild(tag);
  });
}

confirmAddMembersBtn?.addEventListener('click', async () => {
  addMembersError.textContent = '';
  if (selectedToAdd.length === 0) { addMembersError.textContent = 'Pick at least one user.'; return; }
  try {
    const batch = writeBatch(db);
    selectedToAdd.forEach(m => {
      const ref = doc(db, 'chatrooms', roomId, 'members', m.uid);
      batch.set(ref, { role: 'member', joinedAt: serverTimestamp() });
    });
    await batch.commit();
    closeAddModal();
  } catch (e) {
    addMembersError.textContent = 'Failed to add members.';
    console.error(e);
  }
});

function navigateBack() {
  // If a "title" param exists in URL, go back to chat.html
  const params = new URLSearchParams(location.search);
  const title = params.get('title');
  if (title) location.href = `chat.html?roomId=${encodeURIComponent(roomId)}&title=${encodeURIComponent(title)}`;
  else history.back();
}

backLink?.addEventListener('click', navigateBack);

function listenToMembers() {
  const membersRef = collection(db, 'chatrooms', roomId, 'members');
  return onSnapshot(membersRef, async (snapshot) => {
    membersCache.clear();
    const admins = [];
    for (const docSnap of snapshot.docs) {
      const m = docSnap.data();
      // enrich from users collection for display name and avatar
      try {
        const u = await getDoc(doc(db, 'users', docSnap.id));
        const info = u.exists() ? u.data() : {};
        const entry = {
          displayName: info.displayName || info.email || docSnap.id,
          email: info.email || '',
          photoUrl: info.photoUrl || '',
          role: m.role || 'member',
        };
        membersCache.set(docSnap.id, entry);
        if (entry.role === 'admin') admins.push(docSnap.id);
      } catch {
        membersCache.set(docSnap.id, { displayName: docSnap.id, email: '', photoUrl: '', role: m.role || 'member' });
      }
    }
    // Show admin actions if I am admin
    adminActions.style.display = myRole === 'admin' ? 'block' : 'none';
    renderMembers();
  });
}

async function init() {
  roomId = getQueryParam('roomId');
  if (!roomId) {
    membersError.textContent = 'Missing roomId.';
    return;
  }
  // Load room title
  try {
    const roomDoc = await getDoc(doc(db, 'chatrooms', roomId));
    roomTitle = roomDoc.exists() ? (roomDoc.data().title || roomId) : roomId;
    roomTitleEl.textContent = `${roomTitle} • Members`;
  } catch { /* ignore */ }

  onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;
    if (!currentUser || currentUser.isAnonymous) {
      location.href = 'chatrooms.html';
      return;
    }
    // Read my role in this room
    try {
      const myRef = await getDoc(doc(db, 'chatrooms', roomId, 'members', currentUser.uid));
      myRole = myRef.exists() ? (myRef.data().role || 'member') : 'member';
    } catch { myRole = 'member'; }
    listenToMembers();
  });
}

init();
