/* ============================================================
   config.example.js — copy this file to js/config.js and paste
   your own Firebase credentials to switch the leaderboard on.

   These keys are NOT secrets: they are designed to be public in
   web apps. What protects the data are the Firestore rules in
   firestore.rules, so publish those too.
   ============================================================ */

export const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

/** Firestore collection that stores finished runs. */
export const LEADERBOARD_COLLECTION = "runs";
