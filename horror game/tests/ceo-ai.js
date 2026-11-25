// Behavioural tests for the CEO AI against real level data, using a lightweight fake room.
import { Floor } from '../server/Floor.js';
import { CEO } from '../server/CEO.js';
import { LEVEL_BY_ID } from '../shared/levels/index.js';
import { C, toTile, tileCenter } from '../shared/grid.js';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };

function makeWorld(levelId, cfgOverride = {}) {
  const room = {
    players: new Map(), events: [],
    alivePlayers() { return [...this.players.values()].filter((p) => p.alive); },
    broadcastEvent(e) { this.events.push(e); },
    noise(x, z, r, p, k) { this.ceo?.hear(x, z, r, k, p); },
    noiseSound() {}, tell() {}, toPlayer() {}, sendInventory() {}, addJournal() {},
    killPlayer(p) { p.alive = false; this.events.push({ type: 'death', id: p.id }); },
    ending() {},
  };
  const level = LEVEL_BY_ID[levelId];
  const floor = new Floor(level, room, 1234);
  room.floor = floor;
  const ceo = new CEO(room, floor, { ...level.ceo, active: true, huntInterval: 0, ...cfgOverride });
  ceo.rng = mulberry(7);
  room.ceo = ceo;
  return { room, floor, ceo };
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const addPlayer = (room, id, tx, tz, extra = {}) => {
  const p = { id, name: id, x: tileCenter(tx), z: tileCenter(tz), y: 0, yaw: 0, alive: true, hidden: null, crouch: false, sprint: false, moving: false, flashlight: false, invuln: 0, inventory: [], ...extra };
  room.players.set(id, p);
  return p;
};
function sim(world, seconds, onStep) {
  const dt = 0.05;
  let maxStep = 0, enteredVent = false;
  for (let t = 0; t < seconds; t += dt) {
    const px = world.ceo.x, pz = world.ceo.z;
    world.floor.update(dt);
    world.ceo.update(dt);
    maxStep = Math.max(maxStep, Math.hypot(world.ceo.x - px, world.ceo.z - pz) / dt);
    if (world.floor.grid.cell(toTile(world.ceo.x), toTile(world.ceo.z)) === C.VENT) enteredVent = true;
    const g = world.floor.grid.cell(toTile(world.ceo.x), toTile(world.ceo.z));
    if (g === C.WALL || g === C.GLASS) enteredVent = 'wall';
    if (onStep && onStep(t)) break;
  }
  return { maxStep, enteredVent };
}

export function runCeoTests() {
  console.log('CEO AI');
  {
    const w = makeWorld('b3');
    const start = [w.ceo.x, w.ceo.z];
    let travelled = 0, lx = w.ceo.x, lz = w.ceo.z;
    const r = sim(w, 60, () => { travelled += Math.hypot(w.ceo.x - lx, w.ceo.z - lz); lx = w.ceo.x; lz = w.ceo.z; });
    ok(travelled > 30, `patrols the floor on his own (walked ${travelled.toFixed(0)} m in 60 s)`);
    ok(r.maxStep <= w.ceo.cfg.run + 0.01, `moves continuously, never faster than his run speed (${r.maxStep.toFixed(2)} m/s)`);
    ok(r.enteredVent === false, 'never walks through walls, glass or vents');
    void start;
  }
  {
    const w = makeWorld('b3');
    w.ceo.x = tileCenter(4); w.ceo.z = tileCenter(18); w.ceo.yaw = Math.PI / 2; // south corridor west end
    // noise 20 m away down the corridor
    w.room.noise(tileCenter(11), tileCenter(18), 14, null, 'step');
    ok(w.ceo.state === 'investigate', 'hears a sprinting footstep 14 m away and investigates');
    const d0 = Math.hypot(w.ceo.x - tileCenter(11), w.ceo.z - tileCenter(18));
    sim(w, 4);
    const d1 = Math.hypot(w.ceo.x - tileCenter(11), w.ceo.z - tileCenter(18));
    ok(d1 < d0 - 4, `walks toward the sound (${d0.toFixed(1)} m → ${d1.toFixed(1)} m)`);
    const far = makeWorld('b3');
    far.ceo.x = tileCenter(4); far.ceo.z = tileCenter(18);
    far.room.noise(tileCenter(33), tileCenter(8), 1.5, null, 'crouch');
    ok(far.ceo.state === 'patrol', 'does not hear a crouched footstep from across the floor');
  }
  {
    const w = makeWorld('b3');
    w.ceo.x = tileCenter(2); w.ceo.z = tileCenter(18); w.ceo.yaw = Math.PI / 2; w.ceo.state = 'search'; w.ceo.searchTimer = 99; w.ceo.pause = 99;
    w.ceo.look = () => {}; // hold still facing east
    const p = addPlayer(w.room, 'p1', 10, 18, { flashlight: true, moving: true, yaw: -Math.PI / 2 });
    let chasedAt = null;
    sim(w, 4, (t) => { if (w.ceo.state === 'chase') { chasedAt = t; return true; } });
    ok(chasedAt !== null, `spots a player with a flashlight 16 m down the corridor and gives chase (${chasedAt?.toFixed(2)} s)`);
    let caught = false;
    delete w.ceo.look;
    p.flashlight = false; // (a beam in his eyes would blind him — tested separately)
    sim(w, 10, () => { if (!p.alive) { caught = true; return true; } });
    ok(caught && w.room.events.some((e) => e.type === 'death'), 'catches and kills a stationary player');
  }
  {
    const w = makeWorld('b3');
    // player crouched in the dark behind him → not detected
    w.floor.lights = 'emergency';
    w.ceo.x = tileCenter(10); w.ceo.z = tileCenter(18); w.ceo.yaw = Math.PI / 2; w.ceo.state = 'search'; w.ceo.searchTimer = 99; w.ceo.pause = 99; w.ceo.look = () => {};
    addPlayer(w.room, 'p1', 4, 18, { crouch: true });
    sim(w, 3);
    ok(w.ceo.state !== 'chase', 'does not notice a crouched player in the dark behind him');
  }
  {
    // Hiding: unseen hide survives (hideCheck 0); seen hide gets pulled out.
    const w = makeWorld('b3', { hideCheck: 0 });
    const spot = w.floor.hideSpots()[0];
    const p = addPlayer(w.room, 'p1', spot.tx, spot.tz);
    w.ceo.x = tileCenter(30); w.ceo.z = tileCenter(18);
    w.floor.on_hide(p, spot);
    w.ceo.startSearch(spot.x, spot.z);
    sim(w, 25);
    ok(p.alive, 'a player who hid unseen survives a search of the area');
    const w2 = makeWorld('b3');
    const spot2 = w2.floor.hideSpots().find((s) => s.tx === 1 && s.tz === 6) || w2.floor.hideSpots()[0];
    const p2 = addPlayer(w2.room, 'p2', spot2.tx, spot2.tz + 1, { flashlight: true });
    w2.ceo.x = p2.x + 4; w2.ceo.z = p2.z; w2.ceo.yaw = -Math.PI / 2;
    w2.ceo.forceChase(p2);
    w2.ceo.action = null;
    p2.x = spot2.x; p2.z = spot2.z;
    w2.floor.on_hide(p2, spot2);
    sim(w2, 12, () => !p2.alive);
    ok(!p2.alive, 'a player seen climbing into a locker is dragged out');
  }
  {
    // Doors: the CEO opens closed doors on his path
    const w = makeWorld('b1');
    const door = w.floor.grid.entities.find((e) => e.type === 'door' && !e.lock && w.floor.grid.cell(e.tx, e.tz) === C.DOOR);
    w.ceo.x = tileCenter(door.tx - 2); w.ceo.z = tileCenter(door.tz);
    if (!w.floor.grid.ceoWalkable(door.tx - 2, door.tz, () => true)) { w.ceo.x = tileCenter(door.tx); w.ceo.z = tileCenter(door.tz - 2); }
    const target = door.axis === 'z' ? [door.tx + 2, door.tz] : [door.tx, door.tz + 2];
    w.ceo.investigate(tileCenter(target[0]), tileCenter(target[1]), false);
    sim(w, 8, () => w.floor.isDoorOpen(door.id));
    ok(w.floor.isDoorOpen(door.id), `opens the closed door ${door.id} that blocks his path`);
    // Locked doors stop him
    ok(!w.floor.ceoCanPass('vault_door'), 'cannot pass locked doors');
  }
  {
    // Vents are safe
    const w = makeWorld('b2');
    const ventTile = [9, 14];
    const p = addPlayer(w.room, 'p1', ventTile[0], ventTile[1], { crouch: true });
    w.ceo.x = tileCenter(5); w.ceo.z = tileCenter(14);
    w.ceo.forceChase(p);
    const r = sim(w, 15);
    ok(p.alive && r.enteredVent === false, 'cannot follow a player into a crawl vent');
  }
  return { passed, failed };
}

if (process.argv[1] && process.argv[1].endsWith('ceo-ai.js')) {
  const r = runCeoTests();
  console.log(`\n${r.passed} passed, ${r.failed} failed`);
  process.exit(r.failed ? 1 : 0);
}
