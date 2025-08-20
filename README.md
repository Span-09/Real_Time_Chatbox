Real-Time Chat Web App
Project Status: Completed (End of Day 5 of 5)
This document provides a complete overview of the Real-Time Chat Web App, a project built with HTML, CSS, and vanilla JavaScript, using Firebase for the backend. The application is now feature-complete and hardened for production.

Implemented Features
The application includes a full suite of features for a modern, real-time chat experience.

User and Room Management
User Profiles & Search: User profiles are created on login, and a member picker allows for searching and adding users to rooms.

Room Creation & Admin Controls: Users can create rooms with initial members, and room admins can add or remove members from a dedicated management screen. The UI prevents the removal of the last admin.

Real-Time Functionality
Presence System: An "Online" badge indicates which users are currently active, based on their lastActiveAt timestamp stored in Firestore.

Typing Indicator: A real-time message like "User is typing..." appears in the chat, with logic to debounce writes and clear the status after a timeout.

Messaging and History
Pagination (Infinite Scroll): The chat history supports infinite scroll, allowing users to efficiently load older messages in batches without disrupting their scroll position.

In-Room Search: A client-side search allows users to find messages within the conversation and jump directly to the result.

Unread Message Logic: The app tracks and displays an unread message count badge for each room on the main chat list.

Security and Testing
Firestore Security Rules: The application is secured with robust rules in firestore.rules that enforce user authentication, membership, and role-based permissions. This ensures that only authorized users can read or write data.

Emulator Testing: The project is configured with mocha, chai, and @firebase/rules-unit-testing to run automated tests against the Firebase Emulator. The test:emul script in package.json facilitates running these tests to validate security rules before deployment.

UX Polish and Accessibility
Mobile-Friendly Design: The UI is fully responsive and optimized for mobile devices, using appropriate viewport settings.

Error Handling: The interface provides clear error messages and retry options for failed actions, such as sending a message while offline.

Accessibility: A basic accessibility pass has been completed, including the use of alt text for images, aria-label attributes for interactive elements, and aria-live regions for dynamic error messages.

Data Structures Used
The following Firestore collections are used in the application:

users/{uid}: Stores public user profile data.

chatrooms/{roomId}: Contains metadata for each chat room.

chatrooms/{roomId}/members/{uid}: Lists room members and their roles.

chatrooms/{roomId}/messages/{messageId}: Stores all messages for a room.

presence/{userId}: Tracks the last known online time for each user.

typing/{roomId}/{userId}: Stores the real-time typing status of a user in a room.

reads/{userId}/{roomId}: Stores the timestamp of the last message a user has read in a room.

How to Run and Test
Running the Application
Configure Firebase: Set up a Firebase project and ensure Firestore, Storage, and Authentication are enabled.

Launch the App: Open the chatrooms.html file in a web browser to start the application.

Running Emulator Tests
The project is set up to test Firestore security rules using the Firebase Emulator Suite.

Install Dependencies:

Bash

npm install
Run the Tests:

Bash

npm run test:emul

This command will start the Firestore emulator, execute the test suite defined in the /tests directory, and then shut the emulator down. The tests include checks for both valid and invalid operations (negative cases) to ensure the security rules are working as expected.
