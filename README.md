Real-Time Chat Web App
This project is a multi-user, real-time chat application built with vanilla HTML, CSS, and JavaScript, using Firebase for the backend.

Day 2 Progress: Member Management & Admin Controls
What Was Implemented
Day 2 focused on building a comprehensive member management screen and implementing role-based permissions for administrative actions.


Member Management Page: A new page, room_members.html, was created to display and manage members of a specific chat room. It is accessible via a "Members" button in the main chat header.


Real-Time List: The page features a list of all current members that updates in real-time using Firestore's onSnapshot listener. Each entry displays the member's avatar, display name, and a role badge ("admin" or "member").



Admin-Only Controls: The interface conditionally renders controls based on the logged-in user's role:

Admins can see an "Add Members" button, which opens a modal to search for and add new users to the room.

Admins can see "Remove," "Promote," and "Demote" buttons next to other members.


Last Admin Guard: Critical logic was implemented to prevent the removal or demotion of the last remaining admin in a room, ensuring the room always has a manager.


Stretch Goal: Role Management: The UI for promoting a member to an admin or demoting an admin to a member was fully implemented.

Data Structures Used
This feature primarily interacts with the members subcollection within a chatroom document.

chatrooms/{roomId}

This document holds the main information about the chat room, such as its 

title.


chatrooms/{roomId}/members/{uid} 


role: A string that is either "admin" or "member". This determines the user's permissions within the room.


joinedAt: A timestamp indicating when the user was added to the room.


users/{uid} 

This collection is read to fetch the 

displayName and photoUrl for each member to display in the list.

How to Run and Test
Run the application: Serve the project files using a local web server (e.g., VS Code's Live Server) and open chatrooms.html.

Test Admin View:

Log in and create a new room, adding at least one other user as a member. You will be the admin.

Open the newly created chat room from the list.

In the chat header, click the "Members" button.

Verify: You should see the member list. As an admin, you should also see the "Add Members" button in the header and "Remove" / "Promote" buttons next to the other member.

Test: Try adding a new member and removing the member you added initially.

Test Last Admin Guard:

Navigate back to the members page of the room where you are the only admin.

Verify: There should be no "Remove" or "Demote" button next to your own name, as you are the last admin.

Test Non-Admin View:

Log out and log back in as the non-admin user you added to the room.

Navigate to the same room's members page.

Verify: You should see the member list but no admin controls ("Add Members," "Remove," "Promote," etc.).
