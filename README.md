Real-Time Chat Web App
This project is a real-time web chat application built using only vanilla JavaScript, HTML, and CSS. The backend services, including a real-time database, user authentication, and file storage, are handled by Firebase.

Daily Progress
  Day 1: Static UI Layout
  What was implemented: The complete static layout for the chat screen was created with a responsive design for both mobile and desktop. The UI includes a fixed header, a scrollable message area, and styled message bubbles.
  
  Day 2: Firebase Integration & Message Sending
  What was implemented: The static UI was connected to a Firebase backend. Anonymous user authentication was implemented to provide a unique senderId for each session. The core message-sending logic was created, allowing users to send messages that are saved to a Firestore database.
  
  Day 3: Real-Time Functionality
  What was implemented: The application was made fully real-time. An onSnapshot listener was added to display new messages instantly. A sophisticated, WhatsApp-style read receipt system was implemented, tracking "delivered" and "seen" statuses. A real-time typing indicator was also added.
  
  Day 4: Chatroom Management
  What was implemented: The application's home screen, chatrooms.html, was built. The page fetches all chat rooms and displays the last message preview and a real-time unread message count. Core management features were added, including a search bar, a mute button, and the ability to create new chat rooms.
  
  Day 5: Image Message Upload
  What was implemented today:
  
  Firebase Storage Integration: The Firebase Storage SDK was integrated to handle file uploads.
  
  Image Upload UI: An "attach file" button and an image preview container were added to the chat.html page.
  
  Upload Logic: A function was created in app.js to handle the image upload process. It uploads the selected image to a dedicated folder in Firebase Storage at the path /chatrooms/{roomId}/images/{fileName}.
  
  Message Sending: The sendMessage function was updated to handle messages containing an imageUrl. After an image is uploaded, its public URL is saved in the message document in Firestore.
  
  Image Display: The displayMessage function was updated to conditionally render an <img> tag if a message object contains an imageUrl, showing the image in the chat bubble.
  
  Stretch Task - Upload Progress: A visual progress bar was implemented to provide feedback to the user during the image upload.
  
  Stretch Task - File Size Limit: The code now validates the image file size, preventing users from uploading images larger than 5MB.
  
  Chatroom Preview: The getLastMessage function in chatrooms.js was enhanced to display "📷 Image" as the preview text on the chatroom list if the last message was an image.

Firebase Data Structures & Storage
  /chatrooms/{roomId}: Stores chat room metadata.
  
  /chatrooms/{roomId}/messages/{messageId}: Stores all messages for a specific room.
  
  /chatrooms/{roomId}/typing/{userId}: Stores the real-time typing status of users.
  
  /reads/{userId}/rooms/{roomId}: Stores the lastReadTimestamp for each user.
  
  /mutes/{userId}/rooms/{roomId}: Stores the mute status for each user.
  
  Firebase Storage Path: gs://<your-bucket>/chatrooms/{roomId}/images/{fileName}

How to Run and Test the App
    1. Open the chatrooms.html file in a web browser.
    2. Click on a chat room to enter the conversation.
    3. Click the paperclip (📎) icon to select an image from your device.
    4. You will see a preview of the image. You can add text or send the image by itself.
    5. Click "Send" to upload the image and send the message. Observe the progress bar during the upload.
    6. The image will appear in the chat for all users in the room.
