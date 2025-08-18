import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  doc,
  setDoc,
  updateDoc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js'


// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyDEpEbOdl7ysRoYZBj3phVcfA5wxE6W37c",
    authDomain: "real-time-chatbot-372f7.firebaseapp.com",
    projectId: "real-time-chatbot-372f7",
    storageBucket: "real-time-chatbot-372f7.firebasestorage.app", // <-- This is the corrected line
    messagingSenderId: "88476999060",
    appId: "1:88476g999060:web:ec54d7298b84333d274381",
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const storage = getStorage(app)

// --- DOM References ---
const sendButton = document.querySelector('.send-button')
const messageInput = document.querySelector('.message-input')
const chatArea = document.querySelector('.chat-area')
const roomTitleEl = document.querySelector('.room-title')
const backButton = document.querySelector('.back-button')
const attachFileButton = document.getElementById('attach-file-button')
const imageUploadInput = document.getElementById('image-upload-input')
const imagePreviewContainer = document.getElementById('image-preview-container')
const imagePreview = document.getElementById('image-preview')
const removeImageBtn = document.getElementById('remove-image-btn')
const manageMembersBtn = document.getElementById('manage-members-btn')

let typingTimeout = null
let isTyping = false
let lastTypingWriteAt = 0
const TYPING_THROTTLE_MS = 2000
const urlParams = new URLSearchParams(window.location.search)
const roomId = urlParams.get('roomId')
const roomTitle = urlParams.get('title')
let currentUser = null
let lastMessageDate = null
let selectedImageFile = null
let presenceIntervalId = null
const userCache = new Map()

if (!roomId || !roomTitle) {
  window.location.href = 'chatrooms.html'
} else {
  roomTitleEl.textContent = roomTitle
}

backButton.addEventListener('click', () => {
  window.location.href = 'chatrooms.html'
})

onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user
    sendButton.disabled = false
    listenForMessages(roomId)
  startPresenceHeartbeat()
  } else {
    signInAnonymously(auth).catch(err => console.error(err))
  }
})

sendButton.addEventListener('click', sendMessage)
messageInput.addEventListener('keydown', event => {
  const now = Date.now()
  if (!isTyping) {
    setTypingStatus(true)
    isTyping = true
    lastTypingWriteAt = now
  } else if (now - lastTypingWriteAt >= TYPING_THROTTLE_MS) {
    // Refresh updatedAt but throttle
    setTypingStatus(true)
    lastTypingWriteAt = now
  }
  clearTimeout(typingTimeout)
  typingTimeout = setTimeout(() => {
    setTypingStatus(false)
    isTyping = false
  }, 5000)

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
})

messageInput.addEventListener('blur', () => {
  setTypingStatus(false)
  isTyping = false
})

async function sendMessage () {
  const text = messageInput.value.trim()
  if ((text === '' && !selectedImageFile) || !currentUser) return

  sendButton.disabled = true
  sendButton.textContent = 'Sending...'


  try {
    let imageUrl = ''
    if (selectedImageFile) {
      imageUrl = await uploadImage(selectedImageFile)
    }
    const messagesRef = collection(db, 'chatrooms', roomId, 'messages')
    await addDoc(messagesRef, {
      senderId: currentUser.uid,
      text: text,
      imageUrl: imageUrl,
      timestamp: serverTimestamp(),
      deliveredTo: [currentUser.uid],
      seenBy: []
    })
    messageInput.value = ''
    setTypingStatus(false)
    isTyping = false
    selectedImageFile = null
    imagePreview.src = ''
    imagePreviewContainer.style.display = 'none'
  } catch (error) {
    console.error('Error sending message:', error)
  } finally {
    sendButton.disabled = false
    sendButton.textContent = 'Send'
    messageInput.focus()
  }
}

function listenForMessages (currentRoomId) {
  const messagesRef = collection(db, 'chatrooms', currentRoomId, 'messages')
  const q = query(messagesRef, orderBy('timestamp'))
  let lastSnapshot = null

  async function markAllUnseenAsSeen (snapshot, myUid) {
    for (const docSnap of snapshot.docs) {
      const message = { ...docSnap.data(), id: docSnap.id }
      const isSent = message.senderId === myUid
      if (!isSent && message.seenBy && !message.seenBy.includes(myUid)) {
        const msgRef = doc(
          db,
          'chatrooms',
          currentRoomId,
          'messages',
          docSnap.id
        )
        await updateDoc(msgRef, {
          seenBy: [...message.seenBy, myUid]
        })
      }
    }
  }

  onSnapshot(q, async snapshot => {
    chatArea.innerHTML = ''
    lastMessageDate = null
    removeTypingIndicator()
    let myUid = currentUser?.uid
    lastSnapshot = snapshot

    for (const docSnap of snapshot.docs) {
      const message = { ...docSnap.data(), id: docSnap.id }
      const isSent = message.senderId === myUid
      displayMessage(message, isSent, myUid)

      if (
        !isSent &&
        message.deliveredTo &&
        !message.deliveredTo.includes(myUid)
      ) {
        const msgRef = doc(
          db,
          'chatrooms',
          currentRoomId,
          'messages',
          docSnap.id
        )
        await updateDoc(msgRef, {
          deliveredTo: [...message.deliveredTo, myUid]
        })
      }
    }

    if (document.hasFocus()) {
      await markAllUnseenAsSeen(snapshot, myUid)
    }

    if (currentUser) {
      markAsRead(currentUser.uid, currentRoomId)
    }
    chatArea.scrollTop = chatArea.scrollHeight
  })

  listenForTyping(currentRoomId)

  window.addEventListener('focus', async () => {
    if (lastSnapshot && currentUser) {
      await markAllUnseenAsSeen(lastSnapshot, currentUser.uid)
    }
  })

  // Minimal cleanup: ensure typing is cleared if user navigates away
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      setTypingStatus(false)
      isTyping = false
    }
  })
  window.addEventListener('beforeunload', () => {
    try {
      setTypingStatus(false)
    } catch {}
  })
}

function markAsRead (userId, currentRoomId) {
  const readStatusRef = doc(db, 'reads', userId, 'rooms', currentRoomId)
  setDoc(
    readStatusRef,
    { lastReadTimestamp: serverTimestamp() },
    { merge: true }
  )
}

function displayMessage (message, isSent, myUid) {
  const messageDate =
    message.timestamp && typeof message.timestamp.toDate === 'function'
      ? message.timestamp.toDate()
      : new Date()

  if (
    !lastMessageDate ||
    lastMessageDate.toDateString() !== messageDate.toDateString()
  ) {
    createAndDisplayDateSeparator(messageDate)
  }
  lastMessageDate = messageDate

  const messageBubble = document.createElement('div')
  messageBubble.classList.add('message-bubble', isSent ? 'sent' : 'received')

  if (message.imageUrl) {
    const imageDiv = document.createElement('div')
    imageDiv.classList.add('message-image')
    const img = document.createElement('img')
    img.src = message.imageUrl
    img.alt = 'Image'
    imageDiv.appendChild(img)
    messageBubble.appendChild(imageDiv)
  }

  if (message.text) {
    const messageText = document.createElement('div')
    messageText.classList.add('message-text')
    messageText.textContent = message.text
    messageBubble.appendChild(messageText)
  }

  const messageTimestamp = document.createElement('div')
  messageTimestamp.classList.add('message-timestamp')
  messageTimestamp.textContent = messageDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })

  if (isSent) {
    const readReceipts = document.createElement('span')
    readReceipts.classList.add('read-receipts')
    let deliveredCount = (message.deliveredTo || []).filter(
      uid => uid !== myUid
    ).length
    let seenCount = (message.seenBy || []).filter(uid => uid !== myUid).length

    if (seenCount > 0) {
      readReceipts.innerHTML = '<span style="color:blue">✓✓</span>'
      readReceipts.classList.add('read')
    } else if (deliveredCount > 0) {
      readReceipts.textContent = '✓✓'
    } else {
      readReceipts.textContent = '✓'
    }
    messageTimestamp.appendChild(readReceipts)
  }
  messageBubble.appendChild(messageTimestamp)
  chatArea.appendChild(messageBubble)
}

function setTypingStatus (isTyping) {
  if (!currentUser) return
  const typingRef = doc(db, 'chatrooms', roomId, 'typing', currentUser.uid)
  setDoc(typingRef, { isTyping: isTyping, updatedAt: serverTimestamp() })
}

function listenForTyping (currentRoomId) {
  const typingCol = collection(db, 'chatrooms', currentRoomId, 'typing')
  onSnapshot(typingCol, snapshot => {
    const typers = []
    snapshot.docs.forEach(docSnap => {
      const d = docSnap.data()
  if (docSnap.id !== currentUser?.uid && d.isTyping) {
        typers.push(docSnap.id)
      }
    })
    updateTypingIndicator(typers)
  })
}

async function updateTypingIndicator (uids) {
  let el = document.getElementById('typing-indicator')
  if (!uids || uids.length === 0) {
    if (el) el.remove()
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'typing-indicator'
    el.className = 'typing-banner'
    chatArea.appendChild(el)
  }
  // Resolve names with cache
  const names = []
  for (const uid of uids) {
    const name = await getDisplayName(uid)
    names.push(name)
  }
  let text = ''
  if (names.length === 1) text = `${names[0]} is typing…`
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`
  else text = `${names[0]}, ${names[1]} and ${names.length - 2} others are typing…`
  el.textContent = text
  chatArea.scrollTop = chatArea.scrollHeight
}

function removeTypingIndicator () {
  const el = document.getElementById('typing-indicator')
  if (el) el.remove()
}

async function getDisplayName (uid) {
  if (userCache.has(uid)) return userCache.get(uid)
  try {
    const u = await getDoc(doc(db, 'users', uid))
    const name = u.exists()
      ? (u.data().displayName || u.data().email || 'Someone')
      : 'Someone'
    userCache.set(uid, name)
    return name
  } catch {
    return 'Someone'
  }
}

function startPresenceHeartbeat () {
  if (!currentUser) return
  const presRef = doc(db, 'presence', currentUser.uid)
  const ping = (status = 'online') => {
    setDoc(presRef, { userId: currentUser.uid, status, lastActiveAt: serverTimestamp() }, { merge: true })
  }
  ping('online')
  if (presenceIntervalId) clearInterval(presenceIntervalId)
  presenceIntervalId = setInterval(() => ping('online'), 30000)
  window.addEventListener('focus', () => ping('online'))
  window.addEventListener('blur', () => ping('away'))
  window.addEventListener('online', () => ping('online'))
  window.addEventListener('offline', () => ping('offline'))
  window.addEventListener('beforeunload', () => ping('offline'))
}

function createAndDisplayDateSeparator (date) {
  const separator = document.createElement('div')
  separator.classList.add('date-separator')
  const separatorText = document.createElement('span')
  separatorText.textContent = formatDateSeparator(date)
  separator.appendChild(separatorText)
  chatArea.appendChild(separator)
}

function formatDateSeparator (date) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }
}

attachFileButton.addEventListener('click', () => {
  imageUploadInput.value = ''
  imageUploadInput.click()
})

imageUploadInput.addEventListener('change', e => {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    alert('File is too large. Please select an image under 5MB.')
    return
  }
  selectedImageFile = file
  const reader = new FileReader()
  reader.onload = function (evt) {
    imagePreview.src = evt.target.result
    imagePreviewContainer.style.display = 'block'
  }
  reader.readAsDataURL(file)
})

removeImageBtn.addEventListener('click', () => {
  selectedImageFile = null
  imagePreview.src = ''
  imagePreviewContainer.style.display = 'none'
})

async function uploadImage(file) {
  const uniqueFileName = `${Date.now()}-${file.name}`;
  const storageRef = ref(
    storage,
    `chatrooms/${roomId}/images/${uniqueFileName}`
  );

  // --- Progress Bar UI ---
  let progressBar = document.getElementById('upload-progress-bar');
  if (!progressBar) {
    progressBar = document.createElement('div');
    progressBar.id = 'upload-progress-bar';
    progressBar.style.width = '0%';
    progressBar.style.height = '4px';
    progressBar.style.background = '#4caf50';
    progressBar.style.margin = '8px 0';
    progressBar.style.borderRadius = '2px';
    chatArea.appendChild(progressBar);
  }

  const uploadTask = uploadBytesResumable(storageRef, file);

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        progressBar.style.width = progress + '%';
      },
      (error) => {
        // Handle unsuccessful uploads
        console.error("Upload failed:", error);
        if (progressBar) progressBar.remove();
        reject(error);
      },
      () => {
        // Handle successful uploads on complete
        getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
          if (progressBar) progressBar.remove();
          resolve(downloadURL);
        });
      }
    );
  });
}

if (manageMembersBtn) {
  manageMembersBtn.addEventListener('click', () => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('roomId');
    const title = params.get('title');
    if (rid) {
      window.location.href = `room_members.html?roomId=${encodeURIComponent(rid)}${title ? `&title=${encodeURIComponent(title)}` : ''}`;
    }
  });
}