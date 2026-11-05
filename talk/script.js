(async()=>{
const txt=await (await fetch('firebase.txt')).text();
const firebaseConfig=new Function('return '+txt.slice(txt.indexOf('{'),txt.lastIndexOf('}')+1))();
firebase.initializeApp(firebaseConfig);
const auth=firebase.auth(),fs=firebase.firestore(),FV=firebase.firestore.FieldValue;
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
const $=id=>document.getElementById(id);
let user='',cur=null,unsubs=[],unsubM=null,groups=[],fr=[];
const uid=()=>auth.currentUser&&auth.currentUser.uid;
const col=s=>{let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return`hsl(${h},55%,50%)`};
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
const other=f=>{const o=f.members.find(m=>m!==uid());return{id:o,name:(f.names||{})[o]||'?'}};
const fail=e=>alert(e.message);

function drawList(){
 const L=$('list');L.innerHTML='';
 const head=(t,fn)=>{const d=el('div','hd',t);const b=el('button',null,'+');b.onclick=fn;d.appendChild(b);L.appendChild(d)};
 const item=(t,c,fn)=>{const d=el('div','ch'+(cur&&cur.id===c.id?' on':''),t);d.onclick=fn;L.appendChild(d);return d};
 head('Friends',addFriend);
 fr.forEach(f=>{const o=other(f);
  if(f.status==='accepted')item('@ '+o.name,f,()=>openChat({col:'friendships',id:f.id,name:o.name}));
  else if(f.from===uid())item(o.name+' (pending)',f,()=>{});
  else{const d=item(o.name,f,()=>{});const b=el('button',null,'Accept');b.onclick=()=>fs.collection('friendships').doc(f.id).update({status:'accepted'}).catch(fail);d.appendChild(b)}});
 head('Groups',newGroup);
 groups.forEach(g=>item('# '+g.name,g,()=>openChat({col:'groups',id:g.id,name:g.name})));
 const m=$('me');m.innerHTML='';const a=el('div','av',(user||'?')[0].toUpperCase());a.style.background=col(user||'?');
 const lo=el('button',null,'Log out');lo.onclick=()=>auth.signOut();const rn=el('button',null,'Rename');rn.onclick=()=>askName(user,false);m.append(a,user,rn,lo)}

function draw(list){const box=$('msgs');box.innerHTML='';list.forEach(m=>{
 const r=el('div','m'),a=el('div','av',m.u[0].toUpperCase());a.style.background=col(m.u);
 const b=el('div'),h=el('div'),x=el('div','x',m.x);
 h.append(el('span','n',m.u),el('span','t',(m.t&&m.t.toDate?m.t.toDate():new Date()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));
 if(m.f){if(m.f.type.startsWith('image/')){const i=el('img');i.src=m.f.url;x.appendChild(i)}else{const l=el('a',null,'📄 '+m.f.name);l.href=m.f.url;l.download=m.f.name;x.appendChild(l)}}
 b.append(h,x);r.append(a,b);box.appendChild(r)});box.scrollTop=box.scrollHeight}

function openChat(c){cur=c;if(unsubM)unsubM();
 $('title').textContent=(c.col==='groups'?'# ':'@ ')+c.name;$('addm').hidden=c.col!=='groups';$('in').placeholder='Message '+c.name;drawList();
 unsubM=fs.collection(c.col).doc(c.id).collection('messages').orderBy('t').limitToLast(200)
 .onSnapshot(s=>draw(s.docs.map(d=>d.data({serverTimestamps:'estimate'}))),fail)}

function send(x,f){if(!cur)return alert('Pick a friend or group first');
 const d={u:user,uid:uid(),x,t:FV.serverTimestamp()};if(f)d.f=f;
 fs.collection(cur.col).doc(cur.id).collection('messages').add(d).catch(fail)}

async function addFriend(){const n=(prompt('Friend username')||'').trim();if(!n)return;
 try{const s=await fs.collection('users').where('name','==',n).limit(1).get();
 if(s.empty)return alert('No user with that name');
 const o=s.docs[0];if(o.id===uid())return alert('That is you');
 if(fr.some(f=>f.members.includes(o.id)))return alert('Already friends or pending');
 await fs.collection('friendships').add({members:[uid(),o.id],names:{[uid()]:user,[o.id]:o.data().name},status:'pending',from:uid()})}catch(e){fail(e)}}

function newGroup(){const n=(prompt('Group name')||'').trim();if(!n)return;
 fs.collection('groups').add({name:n,owner:uid(),members:[uid()],names:{[uid()]:user}}).catch(fail)}

$('addm').onclick=()=>{const n=(prompt('Add which friend? (username)')||'').trim().toLowerCase();
 const f=fr.find(f=>f.status==='accepted'&&other(f).name.toLowerCase()===n);
 if(!f)return alert('Friend not found');const o=other(f);
 fs.collection('groups').doc(cur.id).update({members:FV.arrayUnion(o.id),['names.'+o.id]:o.name}).catch(fail)};

$('in').addEventListener('keydown',e=>{if(e.key!=='Enter')return;const v=e.target.value.trim();if(!v)return;e.target.value='';send(v)});
$('clip').onclick=()=>$('file').click();
$('file').onchange=e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(f.size>7e5){alert('Max 700 KB');return}
 const r=new FileReader();r.onload=()=>send('',{name:f.name,type:f.type,url:r.result});r.readAsDataURL(f)};

function start(){stop();const u=uid();
 unsubs=[fs.collection('groups').where('members','array-contains',u).onSnapshot(s=>{groups=s.docs.map(d=>({id:d.id,...d.data()}));drawList()},fail),
 fs.collection('friendships').where('members','array-contains',u).onSnapshot(s=>{fr=s.docs.map(d=>({id:d.id,...d.data()}));drawList()},fail)];drawList()}
function stop(){unsubs.forEach(f=>f());unsubs=[];if(unsubM)unsubM();unsubM=null;cur=null;groups=[];fr=[];$('msgs').innerHTML='';$('title').textContent='Select a chat';$('addm').hidden=true}

const nameOf=u=>(u.displayName||u.email.split('@')[0]).slice(0,20);
const err=e=>$('aerr').textContent=e.message.replace('Firebase: ','');
let pendingName='',nmFirst=false;
function askName(def,first,msg){nmFirst=first;$('nmi').value=def||'';$('nme').textContent=msg||'';$('nmc').style.display=first?'none':'';$('nm').style.display='grid';$('nmi').focus()}
async function setName(n){n=n.trim().slice(0,20);if(!n)throw new Error('Enter a username');
 const s=await fs.collection('users').where('name','==',n).limit(1).get();
 if(!s.empty&&s.docs[0].id!==uid())throw new Error('That username is taken');
 await fs.collection('users').doc(uid()).set({name:n},{merge:true});user=n;try{localStorage.setItem('un_'+uid(),n)}catch(e){}
 auth.currentUser.updateProfile({displayName:n}).catch(()=>{})}
$('nms').onclick=async()=>{try{await setName($('nmi').value);$('nm').style.display='none';if(nmFirst)start();else drawList()}catch(e){$('nme').textContent=e.message}};
$('nmi').addEventListener('keydown',e=>{if(e.key==='Enter')$('nms').click()});
$('nmc').onclick=()=>$('nm').style.display='none';
$('up').onclick=()=>{const n=$('aname').value.trim();if(!n){$('aerr').textContent='Enter a username';return}
 pendingName=n;auth.createUserWithEmailAndPassword($('aemail').value,$('apass').value).catch(e=>{pendingName='';err(e)})};
$('inb').onclick=()=>auth.signInWithEmailAndPassword($('aemail').value,$('apass').value).catch(err);
$('gb').onclick=()=>auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(err);
auth.onAuthStateChanged(async u=>{
 if(!u){stop();user='';$('auth').style.display='grid';$('nm').style.display='none';return}
 $('auth').style.display='none';$('aerr').textContent='';
 let c=null;try{c=localStorage.getItem('un_'+u.uid)}catch(e){}
 if(c){user=c;start();return}
 try{const d=await fs.collection('users').doc(u.uid).get();
  if(d.exists&&d.data().name){user=d.data().name;try{localStorage.setItem('un_'+u.uid,user)}catch(e){}start();return}
  if(pendingName){const n=pendingName;pendingName='';try{await setName(n);start()}catch(e){askName(n,true,e.message)}return}
  askName(nameOf(u),true)}catch(e){alert(e.message)}});
})().catch(e=>alert('Could not load firebase.txt (run via localhost or hosting): '+e.message));
