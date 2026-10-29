// SETUP (free): console.firebase.google.com -> create project -> add Web app -> paste config below.
// Then: Authentication -> Sign-in method -> enable Google, and add your GitHub Pages domain under Authorized domains.
// Also enable Anonymous under Sign-in method (for the no-account option).
// Then: Firestore Database -> create -> Rules -> paste:
//   rules_version = '2';
//   service cloud.firestore { match /databases/{d}/documents {
//     match /messages/{id} { allow read: if request.auth != null;
//       allow create: if request.auth != null && request.resource.data.uid == request.auth.uid; } } }
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "PASTE_HERE",
  authDomain: "PASTE_HERE",
  projectId: "PASTE_HERE",
  appId: "PASTE_HERE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
let user = null, unsub = null;

$("signin").onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => alert(e.message));
$("guest").onclick = () => {
  const n = $("guestname").value.trim();
  if (!n) { alert("Pick a name first."); return; }
  try { localStorage.setItem("guest-name", n); } catch (e) {}
  signInAnonymously(auth).catch(e => alert(e.message));
};
function myName() {
  if (user && user.displayName) return user.displayName;
  try { return localStorage.getItem("guest-name") || "Guest"; } catch (e) { return "Guest"; }
}
$("signout").onclick = () => signOut(auth);

onAuthStateChanged(auth, u => {
  user = u;
  $("login").hidden = !!u;
  $("msgs").hidden = !u;
  $("sendrow").hidden = !u;
  $("signout").hidden = !u;
  if (unsub) { unsub(); unsub = null; }
  if (!u) return;
  const q = query(collection(db, "messages"), orderBy("ts", "desc"), limit(100));
  unsub = onSnapshot(q, snap => {
    const box = $("msgs");
    box.textContent = "";
    snap.docs.slice().reverse().forEach(d => {
      const x = d.data();
      const el = document.createElement("div");
      el.className = "m" + (x.uid === user.uid ? " me" : "");
      const n = document.createElement("div"); n.className = "n"; n.textContent = x.name || "Anon";
      const t = document.createElement("div"); t.textContent = x.text || "";
      el.append(n, t); box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
  });
});

function send() {
  const v = $("text").value.trim();
  if (!v || !user) return;
  $("text").value = "";
  addDoc(collection(db, "messages"), {
    text: v, uid: user.uid, name: myName(), ts: serverTimestamp()
  }).catch(e => alert(e.message));
}
$("sendbtn").onclick = send;
$("text").onkeydown = e => { if (e.key === "Enter") send(); };
