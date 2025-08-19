Real-Time Chat Web App
    Project Status: In Progress (End of Day 3 of 5)
    This project is a real-time chat web application built using vanilla HTML, CSS, and JavaScript with a Firebase backend. This README documents the features implemented up to Day 3.

  Technologies Used
    Platform: HTML, CSS, JavaScript (Vanilla only) 
    Backend: Firebase (Firestore, Auth) 

  Implemented Features (Up to Day 3)
  
  User and Room Management
  
  User Profiles: On first login, user profiles are automatically created or updated in Firestore with a display name, email, photo URL, and searchable keys.
  User Search: A "member picker" with typeahead functionality allows searching for registered users to add to rooms.
  Room Creation: Users can create new chat rooms with a title and an initial list of members. The user who creates the room is assigned the "admin" role.
  Member List & Roles: A dedicated screen (room_members.html) lists all members of a room, showing their avatar, name, and role ("admin" or "member"). The member list updates in real-time.
  Admin Controls: Users with the "admin" role have the ability to add new members to the room or remove existing members. The UI prevents the removal of the last remaining admin.
  
  Real-Time Functionality
  
  Presence System: The application indicates which users are currently online. This is achieved by tracking each user's 
  lastActiveAt timestamp in Firestore, which is updated via a regular heartbeat. An "Online" badge is displayed next to active users in the member list.
  Typing Indicator: When a user is typing in a chat room, a message like "X is typing..." is displayed to other members. This status is set on keypress and is debounced to limit database writes. The indicator is cleared automatically after a 5-second timeout or when a message is sent.
  
  Data Structures Used (Up to Day 3)
  
  The following Firestore collections and data structures have been implemented:
  
  users/{uid}
  Stores public user profile information.
  
  Fields: 
  
  displayName, email, photoUrl, searchKeys[], createdAt, updatedAt.
  chatrooms/{roomId}
  Stores metadata for a chat room.
  
  Fields: 
  
  type, title, createdBy, createdAt.
  chatrooms/{roomId}/members/{uid}
  A sub-collection listing the members of a room and their roles.
  
  Fields: 
  
  role, joinedAt.
  presence/{userId}
  Stores the last known activity time for a user to determine online status.
  
  Fields: 
    
  lastActiveAt.
  typing/{roomId}/{userId}
  Tracks the real-time typing status of a user within a specific room.
    
  Fields: 
    
  isTyping, updatedAt.

How to Run and Test
    Clone the Repository: Download or clone the project files to your local machine.
    Configure Firebase:
    Create a new project in the Firebase Console.
    Set up Firestore and Authentication.
    In your project settings, add a new Web App and copy the firebaseConfig object.
    Paste your unique firebaseConfig object into the JavaScript files where it is required.
    Launch the App: Open the chatrooms.html file in your web browser to start the application.
