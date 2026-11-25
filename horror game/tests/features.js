// Tests for the flashlight stun, difficulty settings, random item placement and
// leaving hiding spots. Runs against real level data with a lightweight fake room.
import { Floor } from '../server/Floor.js';
import { CEO, BLIND } from '../server/CEO.js';
import { LEVELS, LEVEL_BY_ID } from '../shared/levels/index.js';
import { C, toTile, tileCenter } from '../shared/grid.js';
import { PLAYER, DIFFICULTIES } from '../shared/constants.js';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };

function makeWorld(levelId, { difficulty = 'normal', cfg = {}, seed = 1234 } = {}) {
  const room = {
    players: new Map(), events: [],
    alivePlayers() { return [...this.players.values()].filter((p) => p.alive); },
    broadcastEvent(e) { this.events.push(e); },
    noise(x, z, r, p, k) { this.ceo?.hear(x, z, r, k, p); },
    noiseSound() {}, tell() {}, toPlayer(p, ev, d) { p.lastTeleport = d; }, sendInventory() {}, addJournal() {},
    killPlayer(p) { p.alive = false; this.events.push({ type: 'death', id: p.id }); },
    ending() {},
  };
  const level = LEVEL_BY_ID[levelId];
  const floor = new Floor(level, room, seed);
  room.floor = floor;
  const ceo = new CEO(room, floor, { ...level.ceo, active: true, huntInterval: 0, ...cfg }, difficulty);
  let a = 7; ceo.rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  room.ceo = ceo;
  return { room, floor, ceo };
}
const addPlayer = (room, id, x, z, extra = {}) => {
  const p = { id, name: id, x, z, y: 0, yaw: 0, pitch: 0, alive: true, hidden: null, crouch: false, sprint: false, moving: false, flashlight: false, invuln: 0, inventory: [], ...extra };
  room.players.set(id, p);
  return p;
};
function sim(w, seconds, onStep) {
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt) {
    w.floor.update(dt);
    w.ceo.update(dt);
    if (onStep && onStep(t)) return t;
  }
  return null;
}
// Aim a player's yaw/pitch exactly at a point.
function aimAt(p, x, y, z) {
  const eye = (p.y || 0) + (p.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand);
  p.yaw = Math.atan2(x - p.x, z - p.z);
  p.pitch = Math.atan2(y - eye, Math.hypot(x - p.x, z - p.z));
}
const aimEyes = (p, ceo) => { const e = ceo.eyePoint(); aimAt(p, e.x, e.y, e.z); };
// Freeze the CEO in place facing a direction (search + pause, no look-around).
function hold(w, x, z, yaw) {
  Object.assign(w.ceo, { x, z, yaw, state: 'search', searchTimer: 99, pause: 99 });
  w.ceo.look = () => {};
}

function stunTests() {
  console.log('Flashlight stun');
  // corridor on B3: CEO at x=6, player 7 m east, facing each other
  {
    const w = makeWorld('b3');
    hold(w, tileCenter(4), tileCenter(18), Math.PI / 2);
    const p = addPlayer(w.room, 'p1', tileCenter(8), tileCenter(18), { flashlight: true });
    aimEyes(p, w.ceo);
    p.awareFix = true;
    const t = sim(w, 2, () => w.ceo.blinded);
    ok(t !== null && t >= BLIND.aimTime - 0.06, `a beam held on his eyes blinds him (after ${t?.toFixed(2)} s)`);
    ok(w.room.events.some((e) => e.type === 'ceo' && e.what === 'blind' && e.by === 'p1'), 'everyone is told he was blinded, and by whom');
    ok(Math.abs(w.ceo.blindTimer - BLIND.duration) < 0.1, `the blind lasts ${BLIND.duration} s`);
    // while blind he can't catch anyone, even right next to him
    p.x = w.ceo.x + 0.6; p.flashlight = false;
    delete w.ceo.look;
    const pos = [w.ceo.x, w.ceo.z];
    sim(w, BLIND.duration - 0.3);
    ok(p.alive, 'a blinded monster cannot catch a player standing next to him');
    ok(Math.hypot(w.ceo.x - pos[0], w.ceo.z - pos[1]) < 0.01, 'he stays put, staggering, while blinded');
    ok(w.ceo.snapshot().an === 'blind' && w.ceo.snapshot().bl > 0, 'clients get the blind state and animation');
    sim(w, 0.5);
    ok(!w.ceo.blinded && Math.abs(w.ceo.blindCooldown - BLIND.cooldown) < 0.3, `after ${BLIND.duration} s he recovers and the stun recharges for ${BLIND.cooldown} s`);
    ok(w.room.events.some((e) => e.type === 'ceo' && e.what === 'unblind'), 'recovery is broadcast');
  }
  {
    // cooldown: a second beam right after does nothing until it recharges
    const w = makeWorld('b3', { cfg: { vision: 0, darkVision: 0 } });
    hold(w, tileCenter(4), tileCenter(18), Math.PI / 2);
    w.ceo.blindCooldown = BLIND.cooldown;
    const p = addPlayer(w.room, 'p1', tileCenter(8), tileCenter(18), { flashlight: true });
    let blinded = false;
    sim(w, BLIND.cooldown - 0.5, () => { aimEyes(p, w.ceo); p.x = tileCenter(8); if (w.ceo.blinded) { blinded = true; return true; } });
    ok(!blinded, `no second blind during the ${BLIND.cooldown} s cooldown`);
    const t = sim(w, 2, () => { aimEyes(p, w.ceo); return w.ceo.blinded; });
    ok(t !== null, 'once recharged, the stun works again');
  }
  {
    // aim matters: chest, feet, beside him, flashlight off, or his back turned
    const cases = [
      ['beam aimed at his chest', (p, w) => aimAt(p, w.ceo.x, 1.0, w.ceo.z)],
      ['beam aimed a metre to his side', (p, w) => aimAt(p, w.ceo.x, w.ceo.eyeHeight(), w.ceo.z + 1.2)],
      ['flashlight switched off', (p, w) => { aimEyes(p, w.ceo); p.flashlight = false; }],
      ['his back turned to the light', (p, w) => { w.ceo.yaw = -Math.PI / 2; aimEyes(p, w.ceo); }],
      ['too far away (20 m)', (p, w) => { p.x = w.ceo.x + 20; aimEyes(p, w.ceo); }],
    ];
    for (const [label, setup] of cases) {
      const w = makeWorld('b3', { cfg: { vision: 0, darkVision: 0 } });
      hold(w, tileCenter(4), tileCenter(18), Math.PI / 2);
      const p = addPlayer(w.room, 'p1', tileCenter(8), tileCenter(18), { flashlight: true });
      setup(p, w);
      sim(w, 1.5);
      ok(!w.ceo.blinded, `no blind with ${label}`);
    }
    // a wall in between
    const w = makeWorld('b3');
    hold(w, tileCenter(4), tileCenter(18), 0);
    const p = addPlayer(w.room, 'p1', tileCenter(4), tileCenter(14), { flashlight: true });
    if (!w.floor.grid.lineOfSight(p.x, p.z, w.ceo.x, w.ceo.z, () => false)) {
      aimEyes(p, w.ceo);
      sim(w, 1.5);
      ok(!w.ceo.blinded, 'no blind through a wall');
    }
  }
  {
    // the human form can be dazzled too, and a blind breaks off a chase
    const w = makeWorld('office', { cfg: { form: 'human' } });
    const lvl = w.floor.grid;
    let spot = null;
    for (let z = 1; z < lvl.h - 1 && !spot; z++) for (let x = 1; x < lvl.w - 6 && !spot; x++) {
      if ([0, 1, 2, 3, 4, 5].every((d) => lvl.isOpen(x + d, z))) spot = [x, z];
    }
    hold(w, tileCenter(spot[0]), tileCenter(spot[1]), Math.PI / 2);
    w.ceo.form = 'human';
    const p = addPlayer(w.room, 'p1', tileCenter(spot[0] + 4), tileCenter(spot[1]), { flashlight: true });
    w.ceo.forceChase(p); w.ceo.action = null;
    let t = sim(w, 2, () => { aimEyes(p, w.ceo); return w.ceo.blinded; });
    ok(t !== null, 'Mr. Thatch in human form can be blinded too');
    p.flashlight = false; p.x = tileCenter(spot[0] + 5);
    t = sim(w, BLIND.duration + 0.2, () => !w.ceo.blinded);
    ok(w.ceo.state === 'search', 'after a blind he has lost track and has to search');
  }
  {
    // scripted cutscene movement ignores the flashlight
    const w = makeWorld('b3');
    hold(w, tileCenter(4), tileCenter(18), Math.PI / 2);
    w.ceo.scriptMove(tileCenter(4), tileCenter(18), 2);
    const p = addPlayer(w.room, 'p1', tileCenter(8), tileCenter(18), { flashlight: true });
    aimEyes(p, w.ceo);
    sim(w, 1.5);
    ok(!w.ceo.blinded, 'cannot be blinded during a cutscene');
  }
}

function difficultyTests() {
  console.log('Difficulty');
  const base = LEVEL_BY_ID.b3.ceo;
  for (const [d, mul] of [['easy', 0.5], ['normal', 1], ['medium', 1.2], ['hard', 1.5]]) {
    const w = makeWorld('b3', { difficulty: d });
    ok(Math.abs(w.ceo.cfg.run - base.run * mul) < 1e-9 && Math.abs(w.ceo.cfg.walk - base.walk * mul) < 1e-9, `${DIFFICULTIES[d].label}: monster speed ×${mul} (run ${w.ceo.cfg.run.toFixed(2)} m/s)`);
  }
  {
    // actually moves at the scaled speed
    const measure = (d) => {
      const w = makeWorld('b3', { difficulty: d });
      w.ceo.x = tileCenter(4); w.ceo.z = tileCenter(18); w.ceo.yaw = Math.PI / 2;
      const p = addPlayer(w.room, 'p1', tileCenter(30), tileCenter(18), { invuln: 99 });
      w.ceo.forceChase(p); w.ceo.action = null;
      let top = 0, lx = w.ceo.x;
      sim(w, 3, () => { top = Math.max(top, (w.ceo.x - lx) / 0.05); lx = w.ceo.x; });
      return top;
    };
    const e = measure('easy'), n = measure('normal'), h = measure('hard');
    ok(Math.abs(e / n - 0.5) < 0.05 && Math.abs(h / n - 1.5) < 0.05, `chase speed in practice: easy ${e.toFixed(2)}, normal ${n.toFixed(2)}, hard ${h.toFixed(2)} m/s`);
  }
  {
    // Easy: closed doors stop him; Normal: he opens them
    const door = (diff) => {
      const w = makeWorld('b1', { difficulty: diff });
      const d = w.floor.grid.entities.find((e) => e.type === 'door' && !e.lock && w.floor.grid.cell(e.tx, e.tz) === C.DOOR);
      w.ceo.x = tileCenter(d.tx - 2); w.ceo.z = tileCenter(d.tz);
      if (!w.floor.grid.ceoWalkable(d.tx - 2, d.tz, () => true)) { w.ceo.x = tileCenter(d.tx); w.ceo.z = tileCenter(d.tz - 2); }
      const target = d.axis === 'z' ? [d.tx + 2, d.tz] : [d.tx, d.tz + 2];
      w.ceo.investigate(tileCenter(target[0]), tileCenter(target[1]), false);
      sim(w, 10, () => w.floor.isDoorOpen(d.id));
      return { opened: w.floor.isDoorOpen(d.id), passOpen: (() => { w.floor.setDoor(d.id, true, null); return w.ceo.doorPassable(d.id); })() };
    };
    const e = door('easy'), n = door('normal');
    ok(!e.opened, 'Easy: he cannot open closed doors');
    ok(e.passOpen, 'Easy: he still walks through doors the players left open');
    ok(n.opened, 'Normal: he opens closed doors');
  }
  {
    // Medium: sharper senses and more thorough
    const n = makeWorld('b3', { difficulty: 'normal' }).ceo.cfg, m = makeWorld('b3', { difficulty: 'medium' }).ceo.cfg;
    ok(m.detectRate > n.detectRate && m.hearing > n.hearing && m.hideCheck > n.hideCheck && m.searchTime > n.searchTime,
      'Medium: faster detection, better hearing, checks more lockers, searches longer');
  }
  {
    // Hard: crawls into vents after players; Normal: vents are safe
    const vent = (diff) => {
      const w = makeWorld('b2', { difficulty: diff });
      const p = addPlayer(w.room, 'p1', tileCenter(9), tileCenter(14), { crouch: true });
      w.ceo.x = tileCenter(5); w.ceo.z = tileCenter(14);
      w.ceo.forceChase(p); w.ceo.action = null;
      let inVent = false;
      sim(w, 15, () => { if (w.floor.grid.cell(toTile(w.ceo.x), toTile(w.ceo.z)) === C.VENT) inVent = true; return !p.alive; });
      return { inVent, caught: !p.alive };
    };
    const n = vent('normal'), h = vent('hard');
    ok(!n.inVent && !n.caught, 'Normal: he cannot follow into the vents');
    ok(h.inVent && h.caught, 'Hard: he crawls through the vent and catches the player inside');
  }
}

function itemTests() {
  console.log('Random item placement');
  for (const level of LEVELS) {
    const room = { players: new Map(), alivePlayers: () => [], broadcastEvent() {}, noise() {}, tell() {}, toPlayer() {} };
    const positions = new Map();
    let bad = [], moved = 0, total = 0, fixedOk = true;
    for (let seed = 1; seed <= 25; seed++) {
      const f = new Floor(level, room, seed * 7919);
      const g = f.grid;
      const label = f.areaLabels();
      const tiles = new Set();
      for (const it of f.items.values()) {
        if (it.id.startsWith('dyn_')) continue; // staplers / staples: tested separately
        const e = f.ents.get(it.id);
        if (!f.randomizable({ ...it, state: e.hidden ? 'hidden' : 'world' })) {
          if (Math.abs(it.x - e.x) > 1e-6 || Math.abs(it.z - e.z) > 1e-6) fixedOk = false;
          continue;
        }
        total++;
        const tx = toTile(it.x), tz = toTile(it.z);
        if (tx !== e.tx || tz !== e.tz) moved++;
        if (!positions.has(it.id)) positions.set(it.id, new Set());
        positions.get(it.id).add(`${tx},${tz}`);
        const c = g.cell(tx, tz), top = g.solidTop[tz * g.w + tx];
        if (c !== C.FLOOR) bad.push(`${it.id} not on floor`);
        if (top > 1.0) bad.push(`${it.id} inside a tall prop`);
        if (Math.abs((it.y || 0) - top) > 1e-6 && top > 0) bad.push(`${it.id} floating/sunk`);
        if (label[tz * g.w + tx] !== label[e.tz * g.w + e.tx]) bad.push(`${it.id} left its area`);
        if (tiles.has(`${tx},${tz}`)) bad.push(`${it.id} stacked`);
        tiles.add(`${tx},${tz}`);
        // reachable on foot from the authored spot with every unlockable door open
        const reach = g.playerReachable(e.tx, e.tz, () => true);
        if (!reach[tz * g.w + tx]) bad.push(`${it.id} unreachable`);
      }
    }
    const varied = [...positions.values()].every((s) => s.size >= 3);
    ok(!bad.length, `[${level.id}] ${total} placements over 25 rounds: on open floor or desks, in their own area, reachable, never stacked${bad.length ? ' — ' + [...new Set(bad)].slice(0, 4).join(', ') : ''}`);
    ok(varied && moved > total * 0.5, `[${level.id}] positions change between rounds (${positions.size} items, ${moved}/${total} moved)`);
    ok(fixedOk, `[${level.id}] story items keep their authored spots`);
  }
}

function hideTests() {
  console.log('Hiding spots');
  for (const level of LEVELS) {
    const w = makeWorld(level.id);
    let bad = [];
    for (const spot of w.floor.hideSpots()) {
      const p = addPlayer(w.room, 'p_' + spot.id, spot.x + Math.sin(spot.facing) * 1.2, spot.z + Math.cos(spot.facing) * 1.2);
      p.preHide = { x: p.x, z: p.z };
      w.floor.on_hide(p, spot);
      w.floor.leaveHide(p);
      if (p.hidden) bad.push(spot.id + ' still hidden');
      if (!w.floor.spotFree(p.x, p.z, PLAYER.radius + 0.01)) bad.push(spot.id + ' exit overlaps a solid');
      if (!p.lastTeleport || p.lastTeleport.x !== p.x) bad.push(spot.id + ' client not moved');
      w.room.players.delete(p.id);
    }
    ok(!bad.length, `[${level.id}] leaving each of ${w.floor.hideSpots().length} hiding spots puts you on free floor you can walk away from${bad.length ? ' — ' + bad.slice(0, 3).join(', ') : ''}`);
  }
}

export function runFeatureTests() {
  stunTests();
  difficultyTests();
  itemTests();
  hideTests();
  return { passed, failed };
}


// Online: the host's difficulty choice reaches the server's monster, and can't be changed mid-shift.
export async function runOnlineFeatureTests() {
  const { createServer } = await import('../server/index.js');
  const { io: connect } = await import('socket.io-client');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  console.log('Online difficulty');
  const srv = await createServer({ port: 0, debug: true, quiet: true });
  const url = `http://localhost:${srv.port}`;
  const mk = () => { const s = connect(url, { transports: ['websocket'], forceNew: true }); s.lobby = null; s.on('lobby', (l) => { s.lobby = l; }); s.on('debugInfo', (d) => { s.info = d; }); return s; };
  const emit = (s, ...a) => new Promise((r) => s.emit(...a, r));
  const report = async (s) => { s.info = null; s.emit('debug', { report: true }); for (let i = 0; i < 40 && !s.info; i++) await sleep(25); return s.info; };
  const a = mk(), b = mk();
  try {
    await Promise.all([a, b].map((s) => new Promise((r) => s.on('connect', r))));
    const room = await emit(a, 'createRoom', { name: 'Host' });
    await emit(b, 'joinRoom', { code: room.code, name: 'Guest' });
    a.emit('setting', { key: 'difficulty', value: 'hard' }); await sleep(150);
    a.emit('startGame'); await sleep(400);
    a.emit('debug', { floor: 'b2' }); await sleep(5500);
    const info = await report(a);
    ok(info?.ceo?.difficulty === 'hard' && info.ceo.vents && Math.abs(info.ceo.run - LEVEL_BY_ID.b2.ceo.run * 1.5) < 1e-6, `Hard reaches the server's monster on B2 (run ${info?.ceo?.run?.toFixed(2)} m/s, vents open)`);
    a.emit('setting', { key: 'difficulty', value: 'easy' }); await sleep(150);
    ok(b.lobby?.settings?.difficulty === 'hard' && (await report(a))?.ceo?.difficulty === 'hard', 'difficulty cannot be changed in the middle of a shift');
    const first = info.items;
    a.emit('debug', { floor: 'b2' }); await sleep(5500);
    const second = (await report(a)).items;
    const movedIds = second.filter((it) => { const f = first.find((x) => x.id === it.id); return f && (Math.abs(f.x - it.x) > 0.01 || Math.abs(f.z - it.z) > 0.01); });
    ok(movedIds.length >= 3, `reloading the floor reshuffles the loose items (${movedIds.length}/${second.length} moved)`);
  } catch (e) {
    ok(false, 'online feature test crashed: ' + e.stack);
  } finally {
    a.close(); b.close();
    await srv.close?.();
  }
  return { passed, failed };
}


if (process.argv[1]?.endsWith('features.js')) {
  runFeatureTests();
  const r = await runOnlineFeatureTests();
  console.log(`
${r.passed}/${r.passed + r.failed} passed`);
  process.exit(r.failed ? 1 : 0);
}
