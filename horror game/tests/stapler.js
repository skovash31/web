// Stapler tests: spawn placement, the 10 s stun rules, the hit test, and an online
// two-player run checking ammo, reload timing, firing, stun sync and no stacking.
import { Floor } from '../server/Floor.js';
import { CEO } from '../server/CEO.js';
import { LEVELS, LEVEL_BY_ID } from '../shared/levels/index.js';
import { C, toTile, tileCenter } from '../shared/grid.js';
import { STAPLER, GUN } from '../shared/constants.js';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeRoom() {
  return {
    players: new Map(), events: [],
    alivePlayers() { return [...this.players.values()].filter((p) => p.alive); },
    broadcastEvent(e) { this.events.push(e); },
    noise(x, z, r, p, k) { this.ceo?.hear(x, z, r, k, p); },
    noiseSound() {}, tell() {}, toPlayer() {}, sendInventory() {}, addJournal() {},
    killPlayer(p) { p.alive = false; this.events.push({ type: 'death', id: p.id }); },
    ending() {},
  };
}
function world(levelId, cfg = {}) {
  const room = fakeRoom();
  const floor = new Floor(LEVEL_BY_ID[levelId], room, 99);
  room.floor = floor;
  const ceo = new CEO(room, floor, { ...LEVEL_BY_ID[levelId].ceo, active: true, huntInterval: 0, ...cfg });
  room.ceo = ceo;
  return { room, floor, ceo };
}
const sim = (w, s, fn) => { for (let t = 0; t < s; t += 0.05) { w.floor.update(0.05); w.ceo.update(0.05); if (fn && fn(t)) return t; } return null; };

function spawnTests() {
  console.log('Stapler spawns');
  for (const level of LEVELS) {
    const bad = [];
    let staplers = 0, boxes = 0;
    const spots = new Set();
    for (let seed = 1; seed <= 20; seed++) {
      const f = new Floor(level, fakeRoom(), seed * 104729);
      const g = f.grid;
      const sp = f.spawnTiles[0];
      const reach = g.playerReachable(sp[0], sp[1], () => true);
      const label = f.loot.label;
      const all = [...f.items.values()].filter((i) => i.state === 'world');
      for (const it of all.filter((i) => i.kind === 'stapler' || i.kind === 'staples')) {
        if (it.kind === 'stapler') { staplers++; spots.add(`${toTile(it.x)},${toTile(it.z)}`); if (it.ammo !== 0) bad.push('stapler not empty'); }
        else { boxes++; if (it.count !== STAPLER.perBox) bad.push('box count ' + it.count); }
        const tx = toTile(it.x), tz = toTile(it.z), i = tz * g.w + tx;
        if (g.cell(tx, tz) !== C.FLOOR) bad.push(`${it.kind} off the floor`);
        if (g.solidTop[i] > 1.0) bad.push(`${it.kind} inside furniture`);
        if (!reach[i]) bad.push(`${it.kind} unreachable`);
        if (!f.loot.areas.has(label[i])) bad.push(`${it.kind} outside a loot area`);
        const ent = f.ents.get(it.id);
        if (!ent || Math.abs(ent.x - it.x) > 1e-6) bad.push(`${it.kind} not interactable`);
        if (all.some((o) => o !== it && toTile(o.x) === tx && toTile(o.z) === tz)) bad.push(`${it.kind} stacked on another item`);
      }
    }
    const want = level.index === 0 ? 1 : 2;
    ok(!bad.length && staplers === 20 && boxes === 20 * want, `[${level.id}] 1 stapler + ${want} box${want > 1 ? 'es' : ''} of 20 per round, on reachable open floor/desks${bad.length ? ' — ' + [...new Set(bad)].slice(0, 3).join(', ') : ''}`);
    ok(spots.size >= 6, `[${level.id}] the stapler turns up in different places (${spots.size} spots in 20 rounds)`);
  }
}

function stunTests() {
  console.log('Staple stun');
  const w = world('b3');
  Object.assign(w.ceo, { x: tileCenter(4), z: tileCenter(18), yaw: Math.PI / 2 });
  const p = { id: 'p1', name: 'p1', x: tileCenter(5), z: tileCenter(18), y: 0, yaw: 0, pitch: 0, alive: true, hidden: null, invuln: 0, flashlight: false, inventory: [] };
  w.room.players.set('p1', p);
  w.ceo.forceChase(p); w.ceo.action = null;
  ok(w.ceo.staple(p, { bone: 'Torso', local: [0, 0.3, 0.1], normal: [0, 0, 1] }) === true, 'a staple hit stuns him');
  ok(w.room.events.some((e) => e.type === 'ceo' && e.what === 'stun' && e.dur === STAPLER.stun), `the stun is announced to everyone (${STAPLER.stun} s)`);
  const pos = [w.ceo.x, w.ceo.z];
  let tStun = sim(w, STAPLER.stun + 1, () => !w.ceo.stunned);
  ok(tStun !== null && Math.abs(tStun - STAPLER.stun) < 0.11, `lasts exactly ${STAPLER.stun} s (${tStun?.toFixed(2)} s)`);
  ok(p.alive, 'he cannot attack a player standing right next to him while stunned');
  ok(Math.hypot(w.ceo.x - pos[0], w.ceo.z - pos[1]) < 1e-6, 'he cannot move while stunned');
  ok(w.ceo.state !== 'chase' && w.room.events.some((e) => e.type === 'ceo' && e.what === 'unstun'), 'afterwards the chase is broken off and recovery is announced');

  // no stacking
  const w2 = world('b3');
  Object.assign(w2.ceo, { x: tileCenter(4), z: tileCenter(18) });
  w2.ceo.staple(null, null);
  sim(w2, 6);
  const left = w2.ceo.stunTimer;
  const again = w2.ceo.staple(null, { bone: 'Head', local: [0, 0.2, 0.2], normal: [0, 0, 1] });
  ok(!again && Math.abs(w2.ceo.stunTimer - left) < 1e-9, 'a second hit during the stun sticks but does not extend or restart it');
  ok(w2.ceo.staples.length === 1, 'the extra staple is remembered for players who join mid-stun');
  ok(w2.room.events.filter((e) => e.type === 'ceo' && e.what === 'stun').length === 1, 'only one stun is ever announced per stun');
  sim(w2, 5);
  ok(!w2.ceo.stunned && w2.ceo.staples.length === 0, 'the stuck staples are cleared when the stun ends');
  // cannot staple during cutscenes; stun overrides a blind
  const w3 = world('b3');
  w3.ceo.scriptMove(w3.ceo.x + 2, w3.ceo.z, 2);
  ok(w3.ceo.staple(null, null) === false, 'cannot be stunned during a cutscene');
  const w4 = world('b3');
  w4.ceo.blindTimer = 3;
  w4.ceo.staple(null, null);
  ok(w4.ceo.stunned && !w4.ceo.blinded, 'a staple hit replaces an active blind (no double effects)');
}

function gunStunTests() {
  console.log('Gun stun');
  const w = world('b3');
  ok(w.ceo.staple(null, null, GUN.stun) === true && w.ceo.stunTimer === GUN.stun, `a bullet stuns him for ${GUN.stun} s`);
  const t = sim(w, GUN.stun + 1, () => !w.ceo.stunned);
  ok(t !== null && Math.abs(t - GUN.stun) < 0.11, `lasts exactly ${GUN.stun} s (${t?.toFixed(2)} s)`);
  const w2 = world('b3');
  w2.ceo.staple(null, null, STAPLER.stun); sim(w2, 4);
  ok(w2.ceo.staple(null, null, GUN.stun) === true && w2.ceo.stunTimer === GUN.stun, 'a bullet during a staple stun upgrades it to the full 30 s (not 30 + what was left)');
  ok(w2.ceo.staple(null, null, STAPLER.stun) === false && w2.ceo.stunTimer === GUN.stun, 'a staple during a gun stun changes nothing');
  ok(w2.ceo.snapshot().sm === GUN.stun, 'clients are told the stun length for the HUD bar');
}

function hitTests() {
  console.log('Staple hit test');
  const w = world('b3');
  Object.assign(w.ceo, { x: 10, z: 10, yaw: 0, anim: 'walk' });
  const o = [10, 1.6, 4];
  const aim = (x, y, z) => { const d = [x - o[0], y - o[1], z - o[2]]; const l = Math.hypot(...d); return d.map((v) => v / l); };
  ok(!!w.ceo.rayHit(o, aim(10, 1.2, 10), 16), 'a shot at his body hits');
  ok(w.ceo.rayHit(o, aim(10, 2.27, 10.75), 16)?.part === 'Head', 'a shot at his head hits the head');
  ok(!w.ceo.rayHit(o, aim(11.5, 1.2, 10), 16), 'a shot a metre to his side misses');
  ok(!w.ceo.rayHit(o, aim(10, 3.4, 10), 16), 'a shot over his head misses');
  ok(!w.ceo.rayHit(o, aim(10, 1.2, 10), 4), 'out of range misses');
}

// ---------------------------------------------------------------- online
export async function runOnlineStaplerTests() {
  const { createServer } = await import('../server/index.js');
  const { io: connect } = await import('socket.io-client');
  console.log('Stapler online (2 players)');
  const srv = await createServer({ port: 0, debug: true, quiet: true });
  const url = `http://localhost:${srv.port}`;
  const mk = () => {
    const s = connect(url, { transports: ['websocket'], forceNew: true });
    Object.assign(s, { events: [], inv: null, ammo: [], snaps: [], floor: null });
    s.on('ev', (e) => s.events.push(e));
    s.on('inv', (d) => { s.inv = d; s.invLog = [...(s.invLog || []), { t: Date.now(), d }]; });
    s.on('ammo', (a) => s.ammo.push(a));
    s.on('snap', (x) => { s.snaps.push(x); if (s.snaps.length > 600) s.snaps.shift(); });
    s.on('floor', (f) => { s.floor = f; });
    return s;
  };
  const emit = (s, ...a) => new Promise((r) => s.emit(...a, r));
  const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(25); } return false; };
  const a = mk(), b = mk();
  const stapler = () => a.inv?.items.find((i) => i.kind === 'stapler');
  try {
    await Promise.all([a, b].map((s) => new Promise((r) => s.on('connect', r))));
    const room = await emit(a, 'createRoom', { name: 'A' });
    await emit(b, 'joinRoom', { code: room.code, name: 'B' });
    a.emit('startGame'); await waitFor(() => a.floor && b.floor, 3000);
    for (const s of [a, b]) s.emit('debug', { god: true });
    a.emit('debug', { floor: 'b3' });
    await waitFor(() => a.floor?.state.levelId === 'b3' && b.floor?.state.levelId === 'b3', 8000);
    await sleep(300);
    const spawned = a.floor.state.items.filter((i) => i.kind === 'stapler' || i.kind === 'staples');
    ok(spawned.length === 3 && b.floor.state.items.filter((i) => i.kind === 'stapler' || i.kind === 'staples').length === 3, 'both players see the same stapler and 2 boxes on the floor');
    // pick up the floor's stapler: B sees it leave the floor
    const st0 = spawned.find((i) => i.kind === 'stapler');
    a.emit('debug', { tp: { x: st0.x, z: st0.z } }); await sleep(150);
    a.emit('interact', { id: st0.id });
    await waitFor(() => stapler(), 2000);
    ok(stapler()?.ammo === 0, 'picking up a stapler: it starts empty');
    ok(await waitFor(() => b.events.some((e) => e.type === 'item' && e.item.id === st0.id && e.item.state === 'held'), 2000), 'the pickup is synced: it disappears for the other player too');
    a.emit('fire', { id: stapler().id, dir: [0, 0, 1] }); await sleep(200);
    ok(a.ammo.some((m) => m.dry) && !a.events.some((e) => e.type === 'staple'), 'an empty stapler cannot fire');
    a.emit('reload'); await sleep(200);
    ok(!a.inv.reloading && a.ammo.some((m) => /No staples/.test(m.msg || '')), 'cannot reload without a box of staples');
    // get a box and reload: exactly 5 s, no firing meanwhile
    const box = spawned.find((i) => i.kind === 'staples');
    a.emit('debug', { tp: { x: box.x, z: box.z } }); await sleep(150);
    a.emit('interact', { id: box.id });
    await waitFor(() => a.inv.items.some((i) => i.kind === 'staples'), 2000);
    ok(a.inv.items.find((i) => i.kind === 'staples')?.count === 20, 'a box holds exactly 20 staples');
    a.invLog = [];
    const t0 = Date.now();
    a.emit('reload');
    await waitFor(() => a.inv.reloading > 0, 1000);
    ok(a.inv.reloading === STAPLER.reloadTime, `reloading starts (${STAPLER.reloadTime} s)`);
    a.emit('fire', { id: stapler().id, dir: [0, 0, 1] }); await sleep(200);
    ok(!a.events.some((e) => e.type === 'staple'), 'cannot fire while reloading');
    await waitFor(() => stapler()?.ammo === 20, 7000);
    const took = (a.invLog.find((x) => x.d.items.find((i) => i.kind === 'stapler')?.ammo === 20)?.t || Date.now()) - t0;
    ok(stapler()?.ammo === 20 && Math.abs(took - STAPLER.reloadTime * 1000) < 350, `reload completes after ${(took / 1000).toFixed(2)} s with 20 staples loaded`);
    ok(!a.inv.items.some((i) => i.kind === 'staples'), 'the empty box is used up');
    // shoot him: wake him and aim at his body from 5 m
    a.emit('debug', { ceo: 'activate' }); await sleep(300);
    const shootAt = async () => {
      const c = a.snaps.at(-1).c;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      a.emit('debug', { tp: { x: c.x + fx * 4, z: c.z + fz * 4 } }); await sleep(120);
      const c2 = a.snaps.at(-1).c;
      const me = a.snaps.at(-1).p.find((q) => q.id === a.id);
      const d = [c2.x - me.x, 1.2 - 1.6, c2.z - me.z]; const l = Math.hypot(...d);
      a.emit('fire', { id: stapler().id, dir: d.map((v) => v / l), hit: { bone: 'Torso', local: [0.02, 0.35, 0.1], normal: [0, 0, 1] } });
      await sleep(200);
    };
    let tries = 0;
    while (!a.events.some((e) => e.type === 'staple' && e.hit) && tries++ < 6) await shootAt();
    const shot = a.events.find((e) => e.type === 'staple' && e.hit);
    ok(!!shot && shot.stunned && shot.stuck?.bone === 'Torso', `a staple hits him and sticks where it hit (${tries} shot${tries > 1 ? 's' : ''})`);
    ok(await waitFor(() => b.events.some((e) => e.type === 'staple' && e.hit) && b.events.some((e) => e.type === 'ceo' && e.what === 'stun'), 1000), 'the other player sees the hit, the stuck staple and the stun');
    await sleep(150);
    const fired = a.events.filter((e) => e.type === 'staple' && e.by === a.id).length; // what the server actually fired
    ok(stapler().ammo === 20 - fired, `each shot uses one staple (${fired} fired, ${stapler().ammo} left)`);
    await sleep(300);
    const s1 = b.snaps.at(-1).c;
    ok(s1.sn > 8 && s1.sn <= STAPLER.stun && s1.an === 'stunned', `snapshots carry the stun to everyone (${s1.sn} s left)`);
    // fire interval + no stacking
    const before = a.events.filter((e) => e.type === 'staple').length;
    const c = a.snaps.at(-1).c, me = a.snaps.at(-1).p.find((q) => q.id === a.id);
    const d = [c.x - me.x, -0.4, c.z - me.z]; const l = Math.hypot(...d);
    a.emit('fire', { id: stapler().id, dir: d.map((v) => v / l) });
    a.emit('fire', { id: stapler().id, dir: d.map((v) => v / l) });
    await sleep(300);
    ok(a.events.filter((e) => e.type === 'staple').length === before + 1, 'two shots in the same instant only fire once (fire interval)');
    const s2 = b.snaps.at(-1).c;
    ok(s2.sn < s1.sn && a.events.filter((e) => e.type === 'ceo' && e.what === 'stun').length === 1, 'a second hit during the stun does not restart it');
    const pos = [s2.x, s2.z];
    await sleep(2000);
    ok(Math.hypot(b.snaps.at(-1).c.x - pos[0], b.snaps.at(-1).c.z - pos[1]) < 0.01, 'he does not move while stunned');
    ok(await waitFor(() => b.events.some((e) => e.type === 'ceo' && e.what === 'unstun'), 9000), 'the stun ends for everyone');
    // the pistol
    a.emit('debug', { giveKind: 'gun' }); a.emit('debug', { giveKind: 'gunammo' });
    const gun = () => a.inv?.items.find((i) => i.kind === 'gun');
    await waitFor(() => gun() && a.inv.items.some((i) => i.kind === 'gunammo'), 1500);
    const evBefore = a.events.length;
    let gt = 0;
    while (!a.events.slice(evBefore).some((e) => e.type === 'staple' && e.weapon === 'gun' && e.hit) && gt++ < 6) {
      const c = a.snaps.at(-1).c;
      a.emit('debug', { tp: { x: c.x + Math.sin(c.yaw) * 4, z: c.z + Math.cos(c.yaw) * 4 } }); await sleep(150);
      const c2 = a.snaps.at(-1).c, me = a.snaps.at(-1).p.find((q) => q.id === a.id);
      const d = [c2.x - me.x, -0.4, c2.z - me.z]; const l = Math.hypot(...d);
      a.emit('fire', { id: gun().id, dir: d.map((v) => v / l) }); await sleep(700);
    }
    const gshot = a.events.slice(evBefore).find((e) => e.type === 'staple' && e.weapon === 'gun' && e.hit);
    ok(!!gshot && gshot.stunned && gshot.stuck?.weapon === 'gun', 'a pistol shot hits, stuns, and the bullet stays in him');
    await sleep(300);
    ok(b.snaps.at(-1).c.sn > GUN.stun - 2 && b.snaps.at(-1).c.sm === GUN.stun, `everyone sees the ${GUN.stun} s stun (${b.snaps.at(-1).c.sn} s left)`);
    ok(gun().ammo === GUN.magazine - gt, `each shot uses a bullet (${gun().ammo} left)`);
    const r0 = Date.now();
    a.emit('reload', gun().id);
    await waitFor(() => gun()?.ammo === GUN.magazine, 5000);
    const rt = Date.now() - r0;
    ok(gun().ammo === GUN.magazine && Math.abs(rt - GUN.reloadTime * 1000) < 400, `the pistol reloads from the box in ${(rt / 1000).toFixed(2)} s`);
    const shotT = a.events.indexOf(shot);
    void shotT;
  } catch (e) {
    ok(false, 'online stapler test crashed: ' + e.stack);
  } finally {
    a.close(); b.close();
    await srv.close?.();
  }
  return { passed, failed };
}

export function runStaplerTests() {
  spawnTests();
  stunTests();
  gunStunTests();
  hitTests();
  return { passed, failed };
}

if (process.argv[1]?.endsWith('stapler.js')) {
  runStaplerTests();
  const r = await runOnlineStaplerTests();
  console.log(`\n${r.passed}/${r.passed + r.failed} passed`);
  process.exit(r.failed ? 1 : 0);
}
