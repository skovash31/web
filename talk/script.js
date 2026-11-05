(async()=>{
const txt=await (await fetch('firebase.txt')).text();
const firebaseConfig=new Function('return '+txt.slice(txt.indexOf('{'),txt.lastIndexOf('}')+1))();
firebase.initializeApp(firebaseConfig);
const auth=firebase.auth(),fs=firebase.firestore(),FV=firebase.firestore.FieldValue;
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
const $=id=>document.getElementById(id);
let user='',myNum='',view='home',cur=null,unsubs=[],unsubM=null,servers=[],fr=[];
const uid=()=>auth.currentUser&&auth.currentUser.uid;
const col=s=>{let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return`hsl(${h},55%,50%)`};
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
const other=f=>{const o=f.members.find(m=>m!==uid());return{id:o,name:(f.names||{})[o]||'?'}};
const fail=e=>alert(e.message);
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24);
let avatars={},lastMsgs=[];
function mkAv(name,id){const a=el('div','av');const p=avatars[id];
 if(p){a.style.background='url('+p+') center/cover'}else{a.textContent=(name||'?')[0].toUpperCase();a.style.background=col(name||'?')}return a}
async function loadAv(ids){const miss=[...new Set(ids)].filter(x=>x&&!(x in avatars));if(!miss.length)return false;
 await Promise.all(miss.map(id=>fs.collection('users').doc(id).get().then(d=>{avatars[id]=(d.exists&&d.data().photo)||''}).catch(()=>{avatars[id]=''})));return true}
function toAvatar(file){return new Promise((res,rej)=>{const img=new Image(),r=new FileReader();
 r.onload=()=>{img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=96;const s=Math.min(img.width,img.height);
 c.getContext('2d').drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,96,96);res(c.toDataURL('image/jpeg',.8))};img.onerror=rej;img.src=r.result};r.readAsDataURL(file)})}


function resetChat(){if(unsubM)unsubM();unsubM=null;$('msgs').innerHTML='';$('title').textContent='Select a chat';$('in').placeholder=''}
function drawAll(){drawRail();drawList();$('addm').hidden=!servers.some(s=>s.id===view)}
function drawRail(){const R=$('servers');R.innerHTML='';
 const ic=(t,on,fn,title)=>{const d=el('div','srv'+(on?' on':''),t);d.title=title;d.onclick=fn;R.appendChild(d)};
 ic('💬',view==='home',()=>{view='home';cur=null;resetChat();drawAll()},'Home');
 servers.forEach(s=>ic(s.name[0].toUpperCase(),view===s.id,()=>{view=s.id;cur=null;resetChat();drawAll()},s.name));
 ic('+',false,serverMenu,'Create or join a server')}
function drawList(){
 const L=$('list');L.innerHTML='';const S=servers.find(s=>s.id===view);
 $('stitle').textContent=S?S.name:'Home';
 const head=(t,fn)=>{const d=el('div','hd',t);if(fn){const b=el('button',null,'+');b.onclick=fn;d.appendChild(b)}L.appendChild(d)};
 const item=(t,key,fn)=>{const d=el('div','ch'+(cur&&cur.key===key?' on':''),t);d.onclick=fn;L.appendChild(d);return d};
 if(!S){head('Friends',addFriend);
  fr.forEach(f=>{const o=other(f);
   const xb=(label,fn)=>{const b=el('button',null,label);b.onclick=e=>{e.stopPropagation();fn()};return b};
   const del=msg=>()=>{if(confirm(msg))fs.collection('friendships').doc(f.id).delete().catch(fail)};
   if(f.status==='accepted'){const d=item('@ '+o.name,f.id,()=>openChat({key:f.id,path:'friendships/'+f.id+'/messages',name:o.name,dm:true}));d.appendChild(xb('Unfriend',del('Unfriend '+o.name+'?')))}
   else if(f.from===uid()){const d=item(o.name+' (pending)',f.id,()=>{});d.appendChild(xb('Cancel',del('Cancel friend request to '+o.name+'?')))}
   else{const d=item(o.name,f.id,()=>{});d.append(xb('Accept',()=>fs.collection('friendships').doc(f.id).update({status:'accepted'}).catch(fail)),xb('Decline',del('Decline request from '+o.name+'?')))}})}
 else{head('Channels',S.owner===uid()?newChannel:null);
  S.channels.forEach(ch=>{const d=item('# '+ch,S.id+ch,()=>openChat({key:S.id+ch,path:'servers/'+S.id+'/channels/'+ch+'/messages',name:ch}));
   if(S.owner===uid()&&S.channels.length>1){const b=el('button',null,'✕');b.title='Delete channel';b.onclick=e=>{e.stopPropagation();if(!confirm('Delete #'+ch+'?'))return;
    if(cur&&cur.key===S.id+ch)resetChat();fs.collection('servers').doc(S.id).update({channels:FV.arrayRemove(ch)}).catch(fail)};d.appendChild(b)}});
  item('🔑 Invite code','inv',()=>prompt('Share this invite code:',S.id));
  if(S.owner===uid())item('🗑 Delete server','del',()=>{if(confirm('Delete "'+S.name+'" for everyone? This cannot be undone.')){resetChat();fs.collection('servers').doc(S.id).delete().catch(fail)}});
  else item('🚪 Leave server','leave',()=>{if(confirm('Leave "'+S.name+'"?')){resetChat();fs.collection('servers').doc(S.id).update({members:FV.arrayRemove(uid())}).catch(fail)}})}
 const m=$('me');m.innerHTML='';const a=mkAv(user||'?',uid());a.title='Change picture';a.style.cursor='pointer';a.onclick=()=>$('pf').click();
 const info=el('div','info',user);info.appendChild(el('small',null,'ID '+myNum));
 const rn=el('button',null,'Rename');rn.onclick=()=>askName(user,false);
 const lo=el('button',null,'Log out');lo.onclick=()=>auth.signOut();m.append(a,info,rn,lo)}
function draw(list){const box=$('msgs');box.innerHTML='';list.forEach(m=>{
 const r=el('div','m'),a=mkAv(m.u,m.uid);
 const b=el('div'),h=el('div'),x=el('div','x',m.x);
 h.append(el('span','n',m.u),el('span','t',(m.t&&m.t.toDate?m.t.toDate():new Date()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));
 if(m.f){if(m.f.type.startsWith('image/')){const i=el('img');i.src=m.f.url;x.appendChild(i)}else{const l=el('a',null,'📄 '+m.f.name);l.href=m.f.url;l.download=m.f.name;x.appendChild(l)}}
 if(m.uid===uid()&&m.id&&cur){const dl=el('button','mdel','🗑');dl.title='Delete message';dl.onclick=()=>{if(confirm('Delete this message?'))fs.collection(cur.path).doc(m.id).delete().catch(fail)};h.appendChild(dl)}
 b.append(h,x);r.append(a,b);box.appendChild(r)});box.scrollTop=box.scrollHeight;
 lastMsgs=list;loadAv(list.map(m=>m.uid)).then(c=>{if(c)draw(list)})}

function openChat(c){cur=c;if(unsubM)unsubM();
 $('title').textContent=(c.dm?'@ ':'# ')+c.name;$('in').placeholder='Message '+c.name;drawList();
 unsubM=fs.collection(c.path).orderBy('t').limitToLast(200)
 .onSnapshot(s=>draw(s.docs.map(d=>({...d.data({serverTimestamps:'estimate'}),id:d.id}))),fail)}
function send(x,f){if(!cur)return alert('Pick a friend or channel first');
 const d={u:user,uid:uid(),x,t:FV.serverTimestamp()};if(f)d.f=f;
 fs.collection(cur.path).add(d).catch(fail)}
const find=(n)=>fs.collection('users').where(/^\d{7}$/.test(n)?'num':'name','==',n).limit(1).get();
async function addFriend(){const n=(prompt('Friend username or 7-digit user ID')||'').trim();if(!n)return;
 try{const s=await find(n);if(s.empty)return alert('No user found');
 const o=s.docs[0];if(o.id===uid())return alert('That is you');
 if(fr.some(f=>f.members.includes(o.id)))return alert('Already friends or pending');
 await fs.collection('friendships').add({members:[uid(),o.id],names:{[uid()]:user,[o.id]:o.data().name},status:'pending',from:uid()})}catch(e){fail(e)}}
function serverMenu(){if(confirm('OK = create a new server\nCancel = join with an invite code'))newServer();else joinServer()}
async function newServer(){const n=(prompt('Server name')||'').trim().slice(0,30);if(!n)return;
 try{const r=await fs.collection('servers').add({name:n,owner:uid(),members:[uid()],names:{[uid()]:user},channels:['general']});view=r.id;cur=null;resetChat()}catch(e){fail(e)}}
async function joinServer(){const c=(prompt('Invite code')||'').trim();if(!c)return;
 try{await fs.collection('servers').doc(c).update({members:FV.arrayUnion(uid()),['names.'+uid()]:user});view=c;cur=null;resetChat()}catch(e){alert('Could not join: '+e.message)}}
function newChannel(){const n=slug(prompt('Channel name')||'');if(!n)return;
 fs.collection('servers').doc(view).update({channels:FV.arrayUnion(n)}).catch(fail)}
$('addm').onclick=async()=>{const n=(prompt('Add a member by their 7-digit user ID')||'').trim();if(!n)return;
 try{const s=await find(n);if(s.empty)return alert('No user found');const o=s.docs[0];
 await fs.collection('servers').doc(view).update({members:FV.arrayUnion(o.id),['names.'+o.id]:o.data().name})}catch(e){fail(e)}};
$('in').addEventListener('keydown',e=>{if(e.key!=='Enter')return;const v=e.target.value.trim();if(!v)return;e.target.value='';send(v)});
$('clip').onclick=()=>$('file').click();
$('file').onchange=e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(f.size>7e5){alert('Max 700 KB');return}
 const r=new FileReader();r.onload=()=>send('',{name:f.name,type:f.type,url:r.result});r.readAsDataURL(f)};
async function ensureNum(){try{const ref=fs.collection('users').doc(uid()),d=await ref.get(),x=d.exists?d.data():{};
 if(x.photo)avatars[uid()]=x.photo;
 if(x.num)myNum=x.num;else{for(let i=0;i<10;i++){const n=String(1000000+Math.floor(Math.random()*9000000));
  const s=await fs.collection('users').where('num','==',n).limit(1).get();if(s.empty){await ref.set({num:n},{merge:true});myNum=n;break}}}
 drawList()}catch(e){}}
function start(){stop();const u=uid();
 unsubs=[fs.collection('servers').where('members','array-contains',u).onSnapshot(s=>{servers=s.docs.map(d=>({id:d.id,...d.data()}));
  if(view!=='home'&&!servers.some(x=>x.id===view)){view='home';cur=null;resetChat()}drawAll()},fail),
 fs.collection('friendships').where('members','array-contains',u).onSnapshot(s=>{fr=s.docs.map(d=>({id:d.id,...d.data()}));if(cur&&cur.dm&&!fr.some(f=>f.id===cur.key))resetChat();drawList()},fail)];
 drawAll();ensureNum()}
function stop(){unsubs.forEach(f=>f());unsubs=[];resetChat();cur=null;servers=[];fr=[];view='home';$('servers').innerHTML='';$('list').innerHTML='';$('addm').hidden=true}
$('pf').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
 try{const d=await toAvatar(f);await fs.collection('users').doc(uid()).set({photo:d},{merge:true});avatars[uid()]=d;drawList();draw(lastMsgs)}catch(x){fail(x)}};
const nameOf=u=>'User';
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
  askName('',true)}catch(e){user='User';drawList();$('title').textContent='Error: '+e.message}});
})().catch(e=>alert('Could not load firebase.txt (run via localhost or hosting): '+e.message));
