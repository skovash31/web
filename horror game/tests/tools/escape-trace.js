// Debug helper: traces the CEO during the office elevator-escape cutscene.
import { io } from 'socket.io-client';
import { createServer } from '../../server/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await createServer({ port: 0, debug: true, quiet: true });
const s = io(`http://localhost:${srv.port}`, { transports: ['websocket'] });
let last = null; const evs = [];
s.on('snap', (x) => { last = x; });
s.on('ev', (e) => { if (['cutscene', 'door'].includes(e.type)) evs.push(`${e.type}:${e.phase || e.id + '=' + e.open}`); });
await new Promise((r) => s.on('connect', r));
await new Promise((r) => s.emit('createRoom', { name: 'T' }, r));
s.emit('startGame'); await sleep(500);
s.emit('debug', { god: true });
for (const f of ['clockedIn', 'filed', 'delivered']) s.emit('debug', { flag: f });
await sleep(300);
s.emit('debug', { tp: { x: 53, z: 24.6 } }); await sleep(200);
s.emit('debug', { give: 'key_b1' }); await sleep(200);
s.emit('interact', { id: 'restricted_door' }); await sleep(300);
const t0 = Date.now();
for (let i = 0; i < 6; i++) { await sleep(500); console.log('pre', (Date.now() - t0) / 1000, JSON.stringify(last?.c)); }
s.emit('debug', { tp: { x: 53, z: 28.6 } });
for (let i = 0; i < 30; i++) { await sleep(500); console.log((Date.now() - t0) / 1000, JSON.stringify(last?.c), evs.splice(0).join(' ')); }
process.exit(0);
