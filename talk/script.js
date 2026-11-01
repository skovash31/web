const chans=['general','random','coding'];
let cur='general',db={general:[],random:[],coding:[]},user='';
try{db=JSON.parse(localStorage.getItem('db'))||db;user=localStorage.getItem('user')||''}catch(e){}
if(!user){user=(prompt('Pick a username')||'You').slice(0,20);try{localStorage.setItem('user',user)}catch(e){}}
const bc=window.BroadcastChannel?new BroadcastChannel('chatroom'):null;
const $=id=>document.getElementById(id);
const col=s=>{let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return`hsl(${h},55%,50%)`};
function save(){try{localStorage.setItem('db',JSON.stringify(db))}catch(e){}}
function drawList(){$('list').innerHTML='';chans.forEach(c=>{const d=document.createElement('div');d.className='ch'+(c===cur?' on':'');d.textContent='# '+c;d.onclick=()=>{cur=c;drawList();draw()};$('list').appendChild(d)});
 $('top').textContent='# '+cur;$('in').placeholder='Message #'+cur;
 $('me').innerHTML='';const a=document.createElement('div');a.className='av';a.style.background=col(user);a.textContent=user[0].toUpperCase();$('me').append(a,user)}
function draw(){const box=$('msgs');box.innerHTML='';db[cur].forEach(m=>{
 const r=document.createElement('div');r.className='m';
 const a=document.createElement('div');a.className='av';a.style.background=col(m.u);a.textContent=m.u[0].toUpperCase();
 const b=document.createElement('div');const n=document.createElement('span');n.className='n';n.textContent=m.u;
 const t=document.createElement('span');t.className='t';t.textContent=new Date(m.t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
 const x=document.createElement('div');x.className='x';x.textContent=m.x;
 const h=document.createElement('div');h.append(n,t);b.append(h,x);r.append(a,b);box.appendChild(r)});
 box.scrollTop=box.scrollHeight}
function add(c,u,x,fromOther){db[c].push({u,x,t:Date.now()});save();if(!fromOther&&bc)bc.postMessage({c,u,x});if(c===cur)draw()}
if(bc)bc.onmessage=e=>add(e.data.c,e.data.u,e.data.x,true);
const replies=['Nice!','Haha true','Tell me more','Agreed 👍','Wait, really?','That’s cool'];
$('in').addEventListener('keydown',e=>{if(e.key!=='Enter')return;const v=e.target.value.trim();if(!v)return;e.target.value='';
 add(cur,user,v);const c=cur;setTimeout(()=>add(c,'Bot',replies[Math.floor(Math.random()*replies.length)],true),900)});
drawList();draw();
