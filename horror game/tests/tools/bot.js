// Simple wandering bot for manual multiplayer testing: node tests/tools/bot.js <ROOMCODE> [name]
import { io } from 'socket.io-client';
const [code, name = 'Bot'] = process.argv.slice(2);
const s = io('http://localhost:3000', { transports: ['websocket'] });
let pos = null, t = 0;
s.on('connect', () => s.emit('joinRoom', { code, name }, (r) => console.log('join', r.ok, r.error || '')));
s.on('floor', (f) => { pos = { ...f.you }; console.log('floor', f.state.levelId); });
s.on('teleport', (d) => { if (pos) Object.assign(pos, d); });
setInterval(() => {
  if (!pos) return;
  t += 0.05;
  const cx = pos.cx ?? (pos.cx = pos.x), cz = pos.cz ?? (pos.cz = pos.z);
  const x = cx + Math.sin(t * 0.6) * 1.6, z = cz + Math.cos(t * 0.6) * 1.6;
  const yaw = Math.atan2(Math.cos(t * 0.6), -Math.sin(t * 0.6));
  s.volatile.emit('state', { x, y: 0, z, yaw, pitch: 0, moving: true, flashlight: true, crouch: Math.sin(t * 0.3) > 0.7 });
}, 50);
setTimeout(() => process.exit(0), 240000);
