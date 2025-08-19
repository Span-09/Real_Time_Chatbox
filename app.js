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
  getDoc,
  where,
  limit,
  startAfter,
  getDocs
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
const offlineIndicator = document.getElementById('offline-indicator')
const attachFileButton = document.getElementById('attach-file-button')
const imageUploadInput = document.getElementById('image-upload-input')
const imagePreviewContainer = document.getElementById('image-preview-container')
const imagePreview = document.getElementById('image-preview')
const removeImageBtn = document.getElementById('remove-image-btn')
const manageMembersBtn = document.getElementById('manage-members-btn')
const roomSearchInput = document.getElementById('room-search-input')
const roomSearchResults = document.getElementById('room-search-results')

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
// Pagination/Search state
const PAGE_SIZE = 25
let oldestDocCursor = null
let hasMore = true
let isLoadingOlder = false
let newestTimestamp = null
let newMessagesUnsub = null
let modificationsUnsub = null
const messagesCache = [] // ascending by timestamp
const searchIndex = [] // { id, textLower, timestamp }
// Offline queue
const OFFLINE_QUEUE_KEY = `rtc2_queue_${roomId}`

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
  initMessages(roomId)
  startPresenceHeartbeat()
  // Initialize offline indicator state
  updateOfflineIndicator()
  window.addEventListener('online', () => { updateOfflineIndicator(); replayQueuedMessages() })
  window.addEventListener('offline', updateOfflineIndicator)
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
    if (!navigator.onLine) {
      // Basic offline queue: text-only
      if (selectedImageFile) {
        alert('You are offline. Image uploads are not queued. Send text only or retry when online.')
        return
      }
      queueOutgoing({ text })
      messageInput.value = ''
      sendButton.textContent = 'Queued'
      setTimeout(() => (sendButton.textContent = 'Send'), 800)
      return
    }
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
    // Network error fallback: queue text
    if (!navigator.onLine && text) {
      queueOutgoing({ text })
      messageInput.value = ''
      sendButton.textContent = 'Queued'
      setTimeout(() => (sendButton.textContent = 'Send'), 800)
      return
    }
  } finally {
    sendButton.disabled = false
    sendButton.textContent = 'Send'
    messageInput.focus()
  }
}

function initMessages (currentRoomId) {
  chatArea.innerHTML = ''
  lastMessageDate = null
  removeTypingIndicator()
  messagesCache.length = 0
  searchIndex.length = 0
  oldestDocCursor = null
  hasMore = true
  newestTimestamp = null
  if (newMessagesUnsub) { try { newMessagesUnsub() } catch {} newMessagesUnsub = null }
  if (modificationsUnsub) { try { modificationsUnsub() } catch {} modificationsUnsub = null }

  loadInitialMessages(currentRoomId).then(() => {
    subscribeToNewMessages(currentRoomId)
    subscribeToRecentMessageModifications(currentRoomId)
  })

  listenForTyping(currentRoomId)

  // Scroll listener for pagination
  chatArea.addEventListener('scroll', async () => {
    if (chatArea.scrollTop < 100 && hasMore && !isLoadingOlder) {
      await loadOlderMessages(currentRoomId)
    }
  })

  // Focus -> mark seen
  window.addEventListener('focus', () => {
    markAllLoadedUnseenAsSeen()
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

async function loadInitialMessages (currentRoomId) {
  const messagesRef = collection(db, 'chatrooms', currentRoomId, 'messages')
  const qDesc = query(messagesRef, orderBy('timestamp', 'desc'), limit(PAGE_SIZE))
  const snap = await getDocs(qDesc)
  const docs = snap.docs
  if (docs.length === 0) { return }
  oldestDocCursor = docs[docs.length - 1]
  hasMore = docs.length === PAGE_SIZE
  // Build ascending list for render
  const items = docs.map(d => ({ id: d.id, ...d.data() })).reverse()
  items.forEach(m => cacheAndRenderMessage(m, 'append'))
  newestTimestamp = items[items.length - 1].timestamp
  await ensureDeliveryForLoaded(items)
  // Scroll to bottom after initial load
  chatArea.scrollTop = chatArea.scrollHeight
  markAllLoadedUnseenAsSeen()
  if (currentUser) markAsRead(currentUser.uid, currentRoomId)
}

async function loadOlderMessages (currentRoomId) {
  if (!oldestDocCursor || !hasMore) return
  isLoadingOlder = true
  const prevHeight = chatArea.scrollHeight
  const messagesRef = collection(db, 'chatrooms', currentRoomId, 'messages')
  const qDesc = query(messagesRef, orderBy('timestamp', 'desc'), startAfter(oldestDocCursor), limit(PAGE_SIZE))
  const snap = await getDocs(qDesc)
  const docs = snap.docs
  if (docs.length === 0) { hasMore = false; isLoadingOlder = false; return }
  oldestDocCursor = docs[docs.length - 1]
  hasMore = docs.length === PAGE_SIZE
  const items = docs.map(d => ({ id: d.id, ...d.data() })).reverse()
  items.forEach(m => cacheAndRenderMessage(m, 'prepend'))
  await ensureDeliveryForLoaded(items)
  // Preserve scroll position
  const newHeight = chatArea.scrollHeight
  chatArea.scrollTop = chatArea.scrollTop + (newHeight - prevHeight)
  isLoadingOlder = false
}

function subscribeToNewMessages (currentRoomId) {
  const messagesRef = collection(db, 'chatrooms', currentRoomId, 'messages')
  if (!newestTimestamp) return
  const qNew = query(messagesRef, orderBy('timestamp'), where('timestamp', '>', newestTimestamp))
  newMessagesUnsub = onSnapshot(qNew, async snap => {
    for (const d of snap.docChanges()) {
      if (d.type === 'added') {
        const m = { id: d.doc.id, ...d.doc.data() }
        cacheAndRenderMessage(m, 'append')
        newestTimestamp = m.timestamp
        await maybeUpdateDeliveryAndSeen(m)
      }
    }
    if (currentUser) markAsRead(currentUser.uid, currentRoomId)
    chatArea.scrollTop = chatArea.scrollHeight
  })
}

function subscribeToRecentMessageModifications (currentRoomId) {
  // Listen to modifications on the most recent window to update read receipts
  const messagesRef = collection(db, 'chatrooms', currentRoomId, 'messages')
  const qRecent = query(messagesRef, orderBy('timestamp', 'desc'), limit(200))
  modificationsUnsub = onSnapshot(qRecent, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'modified') {
        const d = change.doc
        const m = { id: d.id, ...d.data() }
        // Update cache entry
        const idx = messagesCache.findIndex(x => x.id === m.id)
        if (idx !== -1) messagesCache[idx] = { ...messagesCache[idx], ...m }
        // Update UI for read receipts if it's my sent message
        updateReadReceiptsUI(m)
      }
    })
  })
}

function cacheAndRenderMessage (message, mode) {
  // Prevent duplicates in cache
  if (!messagesCache.find(x => x.id === message.id)) {
    // Insert maintaining ascending order by timestamp
    let inserted = false
    for (let i = messagesCache.length - 1; i >= 0; i--) {
      const mi = messagesCache[i]
      if (!mi.timestamp || !message.timestamp || mi.timestamp.toMillis() <= message.timestamp.toMillis()) {
        messagesCache.splice(i + 1, 0, message)
        inserted = true
        break
      }
    }
    if (!inserted) messagesCache.unshift(message)
    // Update search index
    if (message.text) {
      searchIndex.push({ id: message.id, textLower: (message.text || '').toLowerCase(), timestamp: message.timestamp })
    }
  }
  renderMessage(message, mode)
}

async function maybeUpdateDeliveryAndSeen (message) {
  const myUid = currentUser?.uid
  const isSent = message.senderId === myUid
  const msgRef = doc(db, 'chatrooms', roomId, 'messages', message.id)
  const delivered = Array.isArray(message.deliveredTo) ? message.deliveredTo : []
  const seen = Array.isArray(message.seenBy) ? message.seenBy : []
  if (!isSent && !delivered.includes(myUid)) {
    await updateDoc(msgRef, { deliveredTo: [...delivered, myUid] })
  }
  if (document.hasFocus() && !isSent && !seen.includes(myUid)) {
    await updateDoc(msgRef, { seenBy: [...seen, myUid] })
  }
}

async function ensureDeliveryForLoaded (items) {
  const myUid = currentUser?.uid
  if (!myUid) return
  for (const m of items) {
    const isSent = m.senderId === myUid
  const delivered = Array.isArray(m.deliveredTo) ? m.deliveredTo : []
  if (!isSent && !delivered.includes(myUid)) {
      try {
        const msgRef = doc(db, 'chatrooms', roomId, 'messages', m.id)
    await updateDoc(msgRef, { deliveredTo: [...delivered, myUid] })
      } catch {}
    }
  }
}

async function markAllLoadedUnseenAsSeen () {
  const myUid = currentUser?.uid
  if (!myUid) return
  for (const m of messagesCache) {
    const isSent = m.senderId === myUid
  const seen = Array.isArray(m.seenBy) ? m.seenBy : []
  if (!isSent && !seen.includes(myUid)) {
      try {
        const msgRef = doc(db, 'chatrooms', roomId, 'messages', m.id)
    await updateDoc(msgRef, { seenBy: [...seen, myUid] })
      } catch {}
    }
  }
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

function renderMessage (message, mode = 'append') {
  const myUid = currentUser?.uid
  const isSent = message.senderId === myUid
  const prevScrollHeight = chatArea.scrollHeight
  // Assign id for scrolling
  const before = chatArea.firstChild
  const el = buildMessageElement(message, isSent, myUid)
  if (mode === 'prepend') {
    chatArea.insertBefore(el, before)
  } else {
    chatArea.appendChild(el)
  }
  if (mode === 'prepend') {
    const delta = chatArea.scrollHeight - prevScrollHeight
    chatArea.scrollTop = chatArea.scrollTop + delta
  }
}

function buildMessageElement (message, isSent, myUid) {
  const messageDate = message.timestamp && typeof message.timestamp.toDate === 'function' ? message.timestamp.toDate() : new Date()

  // Date separator logic when appending only
  if (
    !lastMessageDate ||
    lastMessageDate.toDateString() !== messageDate.toDateString()
  ) {
    createAndDisplayDateSeparator(messageDate)
  }
  lastMessageDate = messageDate

  const wrapper = document.createElement('div')
  const messageBubble = document.createElement('div')
  messageBubble.id = `msg-${message.id}`
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
    let deliveredCount = (message.deliveredTo || []).filter(uid => uid !== myUid).length
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
  wrapper.appendChild(messageBubble)
  return wrapper
}

function updateReadReceiptsUI (message) {
  const myUid = currentUser?.uid
  if (!myUid || message.senderId !== myUid) return
  const el = document.getElementById(`msg-${message.id}`)
  if (!el) return
  const tsEl = el.querySelector('.message-timestamp')
  if (!tsEl) return
  let rr = el.querySelector('.read-receipts')
  if (!rr) {
    rr = document.createElement('span')
    rr.className = 'read-receipts'
    tsEl.appendChild(rr)
  }
  const deliveredCount = (message.deliveredTo || []).filter(uid => uid !== myUid).length
  const seenCount = (message.seenBy || []).filter(uid => uid !== myUid).length
  rr.classList.toggle('read', seenCount > 0)
  if (seenCount > 0) {
    rr.innerHTML = '<span style="color:blue">✓✓</span>'
  } else if (deliveredCount > 0) {
    rr.textContent = '✓✓'
  } else {
    rr.textContent = '✓'
  }
}

// In-room search
let searchDebounce
roomSearchInput?.addEventListener('input', e => {
  const term = (e.target.value || '').trim().toLowerCase()
  clearTimeout(searchDebounce)
  if (!term) { roomSearchResults.innerHTML = ''; return }
  searchDebounce = setTimeout(() => {
    const matches = searchIndex.filter(m => m.textLower.includes(term)).slice(0, 20)
    roomSearchResults.innerHTML = ''
    if (matches.length === 0) { return }
    for (const m of matches) {
      const item = document.createElement('div')
      item.className = 'room-search-item'
      const dateTxt = m.timestamp && m.timestamp.toDate ? m.timestamp.toDate().toLocaleString() : ''
      const message = messagesCache.find(x => x.id === m.id)
      const preview = message?.text || '(image)'
  item.innerHTML = highlightText(`${dateTxt} — ${preview}`, term)
      item.addEventListener('click', async () => {
        await jumpToMessage(m.id, m.timestamp)
        roomSearchResults.innerHTML = ''
      })
      roomSearchResults.appendChild(item)
    }
  }, 200)
})

async function jumpToMessage (id, ts) {
  // Load older pages until the message timestamp is within loaded range
  let earliest = messagesCache[0]?.timestamp
  while (hasMore && earliest && ts && earliest.toMillis() > ts.toMillis()) {
    await loadOlderMessages(roomId)
    earliest = messagesCache[0]?.timestamp
  }
  // Scroll to the message element
  const elId = `msg-${id}`
  const el = document.getElementById(elId)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('highlight')
    setTimeout(() => el.classList.remove('highlight'), 1500)
  }
}

// --- Helpers: search highlight ---
function escapeHtml (s = '') {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function escapeRegExp (s = '') { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function highlightText (text, term) {
  const safe = escapeHtml(text)
  if (!term) return safe
  const re = new RegExp(escapeRegExp(term), 'ig')
  return safe.replace(re, m => `<mark>${m}</mark>`)
}

// --- Offline queue helpers ---
function loadQueue () {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]') } catch { return [] }
}
function saveQueue (q) { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)) }
function queueOutgoing ({ text }) {
  const q = loadQueue()
  q.push({ text, queuedAt: Date.now() })
  saveQueue(q)
}
async function replayQueuedMessages () {
  if (!navigator.onLine || !currentUser) return
  const q = loadQueue()
  if (!q.length) return
  const messagesRef = collection(db, 'chatrooms', roomId, 'messages')
  const remain = []
  for (const m of q) {
    try {
      await addDoc(messagesRef, {
        senderId: currentUser.uid,
        text: m.text,
        imageUrl: '',
        timestamp: serverTimestamp(),
        deliveredTo: [currentUser.uid],
        seenBy: []
      })
    } catch (e) {
      // keep in queue on failure
      remain.push(m)
    }
  }
  saveQueue(remain)
}
function updateOfflineIndicator () {
  if (!offlineIndicator) return
  offlineIndicator.style.display = navigator.onLine ? 'none' : 'block'
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