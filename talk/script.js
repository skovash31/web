// No accounts, no Firebase. Messages go through the free public relay ntfy.sh.
// Change TOPIC to any long random string so only your people share the room.
const TOPIC = "thatoneidlecat-chat-8f3k2q9x";
const BASE = "https://ntfy.sh/";

const $ = id => document.getElementById(id);
let myName = "", myId = "", seen = new Set(), es = null;

function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

myName = lsGet("chat-name");
myId = lsGet("chat-id");
if (!myId) { myId = "u" + Math.random().toString(36).slice(2, 10); lsSet("chat-id", myId); }

function addMsg(m) {
  if (m.event !== "message" || seen.has(m.id)) return;
  seen.add(m.id);
  const box = $("msgs");
  const el = document.createElement("div");
  const uid = (m.tags && m.tags[0]) || "";
  el.className = "m" + (uid === myId ? " me" : "");
  const n = document.createElement("div"); n.className = "n"; n.textContent = m.title || "Anon";
  const t = document.createElement("div"); t.textContent = m.message || "";
  el.append(n, t); box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function connect() {
  if (es) es.close();
  es = new EventSource(BASE + TOPIC + "/sse?since=12h");
  es.onmessage = e => { try { addMsg(JSON.parse(e.data)); } catch (x) {} };
}

function enter() {
  $("login").hidden = true;
  $("msgs").hidden = false;
  $("sendrow").hidden = false;
  $("rename").hidden = false;
  connect();
  $("text").focus();
}

function join() {
  const v = $("guestname").value.trim();
  if (!v) return;
  myName = v; lsSet("chat-name", v); enter();
}
$("guest").onclick = join;
$("guestname").onkeydown = e => { if (e.key === "Enter") join(); };
$("rename").onclick = () => {
  const v = prompt("New name:", myName);
  if (v && v.trim()) { myName = v.trim().slice(0, 24); lsSet("chat-name", myName); }
};

function send() {
  const v = $("text").value.trim();
  if (!v) return;
  $("text").value = "";
  const url = BASE + TOPIC + "/publish?message=" + encodeURIComponent(v) +
    "&title=" + encodeURIComponent(myName) + "&tags=" + encodeURIComponent(myId);
  fetch(url).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); })
    .catch(e => alert("Could not send: " + e.message + " (your network may be blocking ntfy.sh)"));
}
$("sendbtn").onclick = send;
$("text").onkeydown = e => { if (e.key === "Enter") send(); };

if (myName) enter();