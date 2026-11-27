// The Lurker: hide too long and it shoves you out of the locker and takes half your health.
import { Floor } from '../server/Floor.js';
import { LEVELS } from '../shared/levels/index.js';
import { DIFFICULTIES, LURKER, DEFAULT_DIFFICULTY } from '../shared/constants.js';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeRoom = () => ({ players: new Map(), alivePlayers: () => [], broadcastEvent() {}, noise() {}, tell() {}, toPlayer() {} });

export function runLurkerTests() {
  console.log('The Lurker');
  const lim = ['easy', 'normal', 'medium', 'hard'].map((k) => DIFFICULTIES[k].hideLimit);
  ok(lim.every((v) => v > LURKER.warnBefore) && lim.every((v, i) => !i || v < lim[i - 1]), `harder difficulties give you less time in a locker (${lim.join(' / ')} s)`);
}

export async function runOnlineLurkerTests() {
  const { createServer } = await import('../server/index.js');
  const { io: connect } = await import('socket.io-client');
  console.log('The Lurker online');
  const srv = await createServer({ port: 0, debug: true, quiet: true });
  const url = `http://localhost:${srv.port}`;
  const mk = () => {
    const s = connect(url, { transports: ['websocket'], forceNew: true });
    Object.assign(s, { events: [], floor: null, snap: null, tele: null });
    s.on('ev', (e) => s.events.push(e));
    s.on('floor', (f) => { s.floor = f; });
    s.on('snap', (x) => { s.snap = x; });
    s.on('teleport', (d) => { s.tele = d; });
    return s;
  };
  const emit = (s, ...a) => new Promise((r) => s.emit(...a, r));
  const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(25); } return false; };
  const a = mk(), b = mk();
  const limit = DIFFICULTIES[DEFAULT_DIFFICULTY].hideLimit;
  const spots = new Floor(LEVELS[0], fakeRoom(), 1).hideSpots();
  const meA = () => a.snap?.p.find((q) => q.id === a.id);
  const hideIn = async (spot) => {
    a.tele = null;
    a.emit('debug', { tp: { x: spot.x + Math.sin(spot.facing) * 1.3, z: spot.z + Math.cos(spot.facing) * 1.3 } });
    await waitFor(() => a.tele, 1000);
    a.emit('interact', { id: spot.id });
    return waitFor(() => meA()?.h === spot.id, 1500);
  };
  try {
    await Promise.all([a, b].map((s) => new Promise((r) => s.on('connect', r))));
    const room = await emit(a, 'createRoom', { name: 'A' });
    await emit(b, 'joinRoom', { code: room.code, name: 'B' });
    a.emit('startGame');
    await waitFor(() => a.floor && b.floor && a.snap && b.snap, 4000);
    a.emit('debug', { hp: 80 });
    await sleep(150);

    const [s1, s2] = spots;
    ok(await hideIn(s1), 'you can hide in a locker');
    const n0 = a.events.length;
    await sleep(1200);
    ok(!a.events.slice(n0).some((e) => e.type === 'lurker'), 'a short hide is safe');

    // fast-forward to just before the warning
    a.emit('debug', { hideTime: limit - LURKER.warnBefore - 0.3 });
    ok(await waitFor(() => a.events.some((e) => e.type === 'lurker' && e.phase === 'warn'), 2000), `${LURKER.warnBefore} s before the limit, the hider gets a warning`);
    ok(!b.events.some((e) => e.type === 'lurker' && e.phase === 'warn'), 'only the hider hears the warning');

    // ...and to the attack
    const hpBefore = meA().hp;
    a.tele = null;
    a.emit('debug', { hideTime: limit - 0.2 });
    ok(await waitFor(() => a.events.some((e) => e.type === 'lurker' && e.phase === 'attack'), 2000), `after ${limit} s (Normal) the Lurker attacks`);
    const atk = a.events.find((e) => e.type === 'lurker' && e.phase === 'attack');
    ok(b.events.some((e) => e.type === 'lurker' && e.phase === 'attack' && e.id === a.id && e.spot === s1.id), 'teammates see it burst out of that locker');
    await waitFor(() => meA() && !meA().h, 1000);
    ok(!meA().h && a.events.some((e) => e.type === 'hide' && e.on === false && e.player === a.id), 'it kicks you out of the hiding place');
    ok(a.tele && Math.abs(Math.atan2(Math.sin(a.tele.yaw - s1.facing - Math.PI), Math.cos(a.tele.yaw - s1.facing - Math.PI))) < 0.01, 'you land facing the locker, so you see what shoved you');
    ok(Math.abs(atk.hp - hpBefore / 2) <= 1.5 && Math.abs(meA().hp - hpBefore / 2) <= 1.5, `it takes half your current health (${hpBefore} → ${atk.hp})`);

    // that locker stays off-limits for a while
    a.emit('interact', { id: s1.id }); await sleep(300);
    ok(meA().h !== s1.id && a.events.some((e) => e.type === 'msg' && /still in there/i.test(e.text)), "you can't climb straight back into that locker");

    // hopping to another locker doesn't reset the clock
    a.emit('debug', { hideTime: limit - 1 });
    ok(await hideIn(s2), 'another locker still works');
    ok(await waitFor(() => a.events.filter((e) => e.type === 'lurker' && e.phase === 'attack').length === 2, 3000), "hopping straight into another locker doesn't reset the clock");
    await waitFor(() => meA() && !meA().h, 1000);
    const atk2 = a.events.filter((e) => e.type === 'lurker' && e.phase === 'attack')[1];
    ok(Math.abs(atk2.hp - atk.hp / 2) <= 1.5, `the second hit takes half of what's left (${atk.hp} → ${atk2.hp})`);
    ok(meA().hp > 0 && a.snap.p.find((q) => q.id === a.id).f & 16, 'it hurts but never kills on its own');
  } finally {
    a.close(); b.close();
    await srv.close();
  }
  return { passed, failed };
}
