Real-Time Chat Web App
This project is a real-time web chat application built using only vanilla JavaScript, HTML, and CSS. The backend services, including a real-time database and user authentication, are handled by Firebase.

Daily Progress
  Day 1: Static UI Layout
  What was implemented: The complete static layout for the chat screen (chat.html) was created with a responsive design for both mobile and desktop. The UI includes a fixed header, a scrollable message area, and styled message bubbles.
  
  Day 2: Firebase Integration & Message Sending
  What was implemented: The static UI was connected to a Firebase backend. Anonymous user authentication was implemented to provide a unique senderId for each session. The core message-sending logic was created, allowing users to send messages that are saved to a Firestore database.
  
  Day 3: Real-Time Functionality & Read Receipts
  What was implemented: The application was made fully real-time. An onSnapshot listener was added to display new messages instantly without a page refresh. A sophisticated, WhatsApp-style read receipt system was implemented, tracking "delivered" and "seen" statuses for each message. A real-time typing indicator was also added to show when another user is typing.
  
  Day 4: Chatroom List, Search, and Mute
  What was implemented today:
  
  Chatroom List Page: A new home screen, chatrooms.html, was created to display a list of all chat rooms.
  
  Dynamic Data: The page fetches data from multiple Firestore collections to display the room title, a preview of the last message, and a timestamp. Logic to calculate and display an unread message badge for each room was also implemented.
  
  Performance: Data fetching was optimized using Promise.all to run database requests in parallel, ensuring a fast load time.
  
  Search Functionality: A search bar was added to instantly filter the chatroom list by title.
  
  Mute Functionality: A mute/unmute button was added to each room, with the status saved to Firestore and updated in real-time.

Firebase Data Structures
  /chatrooms/{roomId}: Stores chat room metadata (e.g., title).
  
  /chatrooms/{roomId}/messages/{messageId}: Stores all messages for a specific room.
  
  /chatrooms/{roomId}/typing/{userId}: Stores the real-time typing status of users.
  
  /reads/{userId}/rooms/{roomId}: Stores the lastReadTimestamp for each user in each room.
  
  /mutes/{userId}/rooms/{roomId}: Stores the mute status for each user for each room.

How to Run and Test the App
    1. Open the chatrooms.html file in a web browser.
    2. The app will display a list of available chat rooms.
    3. Type in the search bar to filter the list.
    4. Click the "Mute" button on a room to toggle its mute status.
    5. Click on a room to navigate to the chat.html page and start sending messages.
    6. To test two-user functionality (real-time messages, read receipts, typing indicator):
    7. Open chatrooms.html in a normal browser window (User A).
    8. Open chatrooms.html in a new Incognito Window (User B).
    9. Have both users enter the same chat room.
    10. As one user types, the other will see the typing indicator.
    11. Messages sent from one user will appear instantly for the other, and read receipts will update accordingly.
