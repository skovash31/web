# BirdQuestX
Bird Quest X A GAME WHERE BIRDS FIGHT TO THE DEATH inspired by super smash bros

## Friend system setup

Player IDs are Firebase Authentication UIDs. Enable **Email/Password** and **Google** sign-in in Firebase Authentication, create a **Realtime Database**, and publish the rules from [`accounts/firebase-database.rules.json`](./accounts/firebase-database.rules.json) in the Firebase Realtime Database Rules console. The database URL is configured in [`accounts/firebase.js`](./accounts/firebase.js); if you create the database in a different region, replace it with the exact URL shown in the Firebase console.

After signing in, the game lobby shows a player's ID. Players can share that ID, send friend requests, accept requests, and view/remove accepted friends. Friend requests and friend lists sync through Realtime Database across accounts and devices.

Game names also determine a unique lowercase `@name` (spaces and punctuation become underscores). @Names are reserved in Realtime Database and can be changed at any time, as long as the new @name is available. Existing accounts are assigned/reserved when they next open the game; if two existing names map to the same @name, the later account must choose another. Publish the rules in `accounts/firebase-database.rules.json` in the Firebase Realtime Database Rules console; otherwise @name reservation fails with a permission error. Username uniqueness is enforced by the database rules.
