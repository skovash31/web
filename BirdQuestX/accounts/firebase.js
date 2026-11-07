import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";

export {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
export {
  get,
  off,
  onValue,
  ref,
  remove,
  set,
  update
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";

const app = initializeApp({
  apiKey: "AIzaSyB9EB8SglOnvGFt8M0MEyJKCuCOlAptZqc",
  authDomain: "bird-quest-x.firebaseapp.com",
  databaseURL: "https://bird-quest-x-default-rtdb.firebaseio.com",
  projectId: "bird-quest-x",
  storageBucket: "bird-quest-x.firebasestorage.app",
  messagingSenderId: "254426386448",
  appId: "1:254426386448:web:c9cabe6d308f3461b6fa95"
});

export const auth = getAuth(app);
export const database = getDatabase(app);
