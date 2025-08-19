Real-Time Chat Web App
Project Status: In Progress (End of Day 4 of 5)
This README documents the progress of the Real-Time Chat Web App. The project is built with 

HTML, CSS, and vanilla JavaScript, using Firebase for the backend. This file is updated daily to reflect the latest implemented features.

Implemented Features (Up to Day 4)
The application now includes advanced messaging history features in addition to the existing user management and real-time feedback systems.

User and Room Management
  User Profiles & Search: User profiles are created on login, and a member picker allows for searching and adding users to rooms.
  
  Room Creation & Admin Controls: Users can create rooms with initial members, and room admins can add or remove members from a dedicated management screen. The UI prevents the removal of the last admin.

Real-Time Functionality

  Presence System: An "Online" badge indicates which users are currently active, based on their lastActiveAt timestamp stored in Firestore.
  Typing Indicator: A real-time message like "User is typing..." appears in the chat, with logic to debounce writes and clear the status after a timeout.

  Messaging and History
  
  Pagination (Infinite Scroll): The chat history now supports infinite scroll. As a user scrolls up, older messages are loaded in batches (
  
  PAGE_SIZE = 25) using Firestore cursors (startAfter) and prepended to the view without disrupting the scroll position.
  
  In-Room Search: A client-side search allows users to find messages within the conversation. An in-memory index (
  
  searchIndex) is built from loaded messages for fast filtering.
  
  Jump-to-Message: Clicking a search result scrolls the chat to the exact message. If the message isn't already loaded, the app automatically fetches older pages until it is found.
  
  Unread Message Logic: The app tracks unread messages for each room. A 
  
  lastReadTimestamp is updated in Firestore when a user focuses on a room. This timestamp is then used on the main chat list to calculate and display an unread message count badge.

Stretch Features Implemented
  Search Term Highlighting: Matched terms in the search results are highlighted for better visibility.
  
  Offline Message Queuing: Outgoing text messages are queued in localStorage if the user is offline and are sent automatically when the connection is restored.

Data Structures Used (Up to Day 4)
  The following Firestore collections are now in use:
  
  users/{uid}: Stores public user profile data.
  
  chatrooms/{roomId}: Contains metadata for each chat room.
  
  chatrooms/{roomId}/members/{uid}: Lists room members and their roles.
  
  chatrooms/{roomId}/messages/{messageId}: Stores all messages for a room.
  
  presence/{userId}: Tracks the last known online time for each user.
  
  typing/{roomId}/{userId}: Stores the real-time typing status of a user in a room.
  
  reads/{userId}/{roomId}: Stores the timestamp of the last message a user has read in a room.

How to Run and Test
  Configure Firebase: Set up a Firebase project and ensure Firestore, Storage, and Authentication are enabled.
  Launch the App: Open the chatrooms.html file in a web browser to start the application. After logging in, you can use all the features implemented up to this point.
