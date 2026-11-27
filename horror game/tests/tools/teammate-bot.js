// Debug helper: a scripted teammate that joins a lobby and shows off every animation.
// Usage: node tests/tools/teammate-bot.js <ROOMCODE> [port]   (server must run with --debug)
import { io } from 'socket.io-client';

const [code, port = '3100'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = io(`http://localhost:${port}`, { transports: ['websocket'] });
let snap = null, inv = [], floor = null;
s.on('snap', (x) => { snap = x; });
s.on('inv', (d) => { inv = d.items; });
s.on('floor', (f) => { floor = f; });
await new Promise((r) => s.on('connect', r));
await new Promise((r) => s.emit('joinRoom', { code, name: 'Bob' }, r));
console.log('joined', code);
while (!floor || !snap) await sleep(100);
s.emit('debug', { god: true });
for (const k of ['stapler', 'coffee', 'medkit']) s.emit('debug', { giveKind: k, ammo: 20 });
await sleep(500);
const host = () => snap.p.find((q) => q.id !== s.id);
let me = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
const h = host();
// stand 4 m in front of the host, facing them
me.x = h.x + Math.sin(h.yaw) * 4; me.z = h.z + Math.cos(h.yaw) * 4; me.yaw = h.yaw + Math.PI;
s.emit('debug', { tp: { x: me.x, z: me.z } });
await sleep(400);
const id = (k) => inv.find((i) => i.kind === k)?.id;
let hm = null, ho = 'flashlight', flags = { crouch: false, sprint: false, flashlight: false };
const send = (moving) => s.emit('state', { ...me, ...flags, moving, hm, ho });
async function move(sec, speed, ang, extra = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < sec * 1000) {
    const dt = 0.05;
    const a = me.yaw + ang;
    me.x += Math.sin(a) * speed * dt; me.z += Math.cos(a) * speed * dt;
    if (extra.jump) { const t = ((Date.now() - t0) / 1000) % 0.8; me.y = Math.max(0, 4.6 * t - 6.5 * t * t); }
    if (extra.turn) me.yaw += extra.turn * dt;
    send(speed > 0); await sleep(50);
  }
  me.y = 0; send(false);
}
const phase = async (name, fn) => { console.log('phase', name); s.emit('chat', name); await fn(); await sleep(600); };
await phase('idle', () => move(3, 0, 0));
await phase('walk-fwd', () => move(2, 2.7, 0));
await phase('walk-back', () => move(2, 2.0, Math.PI));
await phase('strafe', () => move(2, 2.5, Math.PI / 2));
await phase('sprint', async () => { flags.sprint = true; await move(2, 5, -Math.PI / 2); flags.sprint = false; });
await phase('crouch-walk', async () => { flags.crouch = true; await move(2.5, 1.4, 0); flags.crouch = false; });
await phase('jump', () => move(2.4, 0, 0, { jump: true }));
await phase('turn', () => move(2, 0, 0, { turn: 2.5 }));
await phase('flashlight', async () => { flags.flashlight = true; me.pitch = 0.2; await move(2, 0, 0); });
await phase('stapler', async () => { hm = 'stapler'; await move(1.5, 0, 0); for (let i = 0; i < 3; i++) { s.emit('fire', { id: id('stapler'), dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] }); await move(0.6, 0, 0); } });
await phase('coffee', async () => { hm = 'coffee'; await move(1, 0, 0); s.emit('useItem', id('coffee')); await move(2.2, 0, 0); hm = null; });
await phase('medkit', async () => { hm = 'medkit'; await move(1, 0, 0); s.emit('useItem', id('medkit')); await move(2.2, 0, 0); hm = null; });
await phase('die', async () => { s.emit('debug', { god: false }); s.emit('debug', { kill: true }); await sleep(2500); });
console.log('done');
await sleep(1000);
process.exit(0);
