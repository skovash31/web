// End-to-end multiplayer test: boots the real server, connects two Socket.IO clients,
// creates/joins a private lobby and plays through every floor to the ending, checking
// sync, puzzles, keycards, inventory, elevator travel, checkpoints, death/respawn and
// that the CEO never teleports.
import { io as connect } from 'socket.io-client';
import { createServer } from '../server/index.js';
import { LEVEL_BY_ID } from '../shared/levels/index.js';
import { Grid, tileCenter } from '../shared/grid.js';
import { loadCheckpoint } from '../server/saves.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ ' + msg); } };

class Bot {
  constructor(url, name) {
    this.name = name;
    this.s = connect(url, { transports: ['websocket'], forceNew: true });
    this.events = [];
    this.notes = [];
    this.inv = [];
    this.floor = null;
    this.snaps = [];
    this.s.on('ev', (e) => this.events.push(e));
    this.s.on('note', (n) => this.notes.push(n));
    this.s.on('inv', (d) => { this.inv = d.items; });
    this.s.on('floor', (f) => { this.floor = f; this.grid = new Grid(LEVEL_BY_ID[f.state.levelId]); });
    this.s.on('snap', (s) => { this.snaps.push(s); if (this.snaps.length > 4000) this.snaps.shift(); });
    this.s.on('keypad', (k) => { this.keypad = k; });
    this.s.on('keypadResult', (k) => { this.keypadResult = k; });
    this.s.on('lobby', (l) => { this.lobby = l; });
  }
  emit(...a) { return new Promise((r) => this.s.emit(...a, r)); }
  get id() { return this.s.id; }
  ent(id) { return this.grid.entities.find((e) => e.id === id); }
  // teleport (debug) to an open tile next to an entity, then interact with it
  async goto(x, z) { this.s.emit('debug', { tp: { x, z } }); await sleep(60); this.s.emit('state', { x, y: 0, z, yaw: 0, pitch: 0 }); await sleep(40); }
  standNear(e) {
    const g = this.grid;
    if (g.isOpen(e.tx, e.tz)) return [e.x, e.z];
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (g.isOpen(e.tx + dx, e.tz + dz)) return [tileCenter(e.tx + dx), tileCenter(e.tz + dz)];
    }
    return [e.x, e.z];
  }
  async use(id, extra = {}) {
    let e = this.ent(id);
    const item = this.floor.state.items.find((i) => i.id === id);
    if (!e && item) e = { x: item.x, z: item.z, tx: Math.floor(item.x / 2), tz: Math.floor(item.z / 2) };
    const [x, z] = this.standNear(e);
    await this.goto(x, z);
    this.s.emit('interact', { id, ...extra });
    await sleep(120);
  }
  hasFlag(name) { return this.events.some((e) => e.type === 'flag' && e.name === name && e.on); }
  async waitFor(pred, ms = 8000, label = '') {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(50); }
    console.log('    (timeout waiting for ' + label + ')');
    return false;
  }
  async enterElevator() {
    const tiles = this.grid.elevatorTiles;
    const [x, z] = tiles[Math.floor(Math.random() * tiles.length)];
    await this.goto(tileCenter(x), tileCenter(z));
  }
  close() { this.s.close(); }
}

async function rideElevator(a, b, next) {
  await a.enterElevator(); await b.enterElevator();
  const before = a.floor.floorIndex;
  a.s.emit('interact', { id: 'elevator' }); b.s.emit('interact', { id: 'elevator' });
  await sleep(100);
  const okDepart = await a.waitFor(() => a.events.some((e) => e.type === 'elevator' && e.next === next), 3000, 'elevator depart');
  if (!okDepart) console.log('    msgs:', a.events.filter((e) => e.type === 'msg').slice(-4).map((e) => e.text), b.events.filter((e) => e.type === 'msg').slice(-3).map((e) => e.text));
  ok(okDepart, `elevator departs toward ${next}`);
  const arrived = await a.waitFor(() => a.floor.state.levelId === next && b.floor?.state.levelId === next, 7000, 'arrival');
  ok(arrived && a.floor.floorIndex === before + 1, `both players arrive on ${next}`);
  await sleep(250);
  a.events.length = 0; b.events.length = 0;
}

export async function runPlaythrough() {
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catinc-saves-'));
  process.env.SAVE_DIR = saveDir;
  const srv = await createServer({ port: 0, debug: true, quiet: true });
  const url = `http://localhost:${srv.port}`;
  const a = new Bot(url, 'Alice'), b = new Bot(url, 'Bob');
  try {
    await sleep(300);
    console.log('Lobby');
    const created = await a.emit('createRoom', { name: 'Alice' });
    ok(created.ok && /^[A-Z0-9]{5}$/.test(created.code), `private lobby created with code ${created.code}`);
    const bad = await b.emit('joinRoom', { code: 'ZZZZZ', name: 'Bob' });
    ok(!bad.ok, 'joining a wrong code is rejected');
    const joined = await b.emit('joinRoom', { code: created.code, name: 'Bob' });
    ok(joined.ok && joined.lobby.players.length === 2, 'second player joins by room code');
    ok(joined.lobby.settings?.waypoints === true, 'objective markers are on by default');
    b.s.emit('setting', { key: 'waypoints', value: false }); await sleep(150);
    ok(a.lobby?.settings?.waypoints !== false, 'non-host cannot change lobby settings');
    a.s.emit('setting', { key: 'waypoints', value: false }); await sleep(150);
    ok(b.lobby?.settings?.waypoints === false, 'host turns objective markers off for everyone');
    a.s.emit('setting', { key: 'waypoints', value: true }); await sleep(150);
    ok(b.lobby?.settings?.waypoints === true, 'host turns objective markers back on');
    b.s.emit('startGame'); await sleep(200);
    ok(!a.floor, 'non-host cannot start the game');
    a.s.emit('startGame');
    await a.waitFor(() => a.floor && b.floor, 3000, 'floor');
    ok(a.floor?.state.levelId === 'office' && b.floor?.state.levelId === 'office', 'host starts: both load the office floor');
    for (const bot of [a, b]) bot.s.emit('debug', { god: true });

    // --- sync check: A moves, B sees it in snapshots
    await a.goto(tileCenter(3), tileCenter(3));
    await sleep(250);
    const seen = b.snaps.at(-1)?.p.find((p) => p.id === a.id);
    ok(seen && Math.abs(seen.x - tileCenter(3)) < 0.01 && Math.abs(seen.z - tileCenter(3)) < 0.01, 'player positions are synchronised to the other client');
    // anti-teleport
    a.s.emit('state', { x: 60, y: 0, z: 30 }); await sleep(150);
    const s2 = b.snaps.at(-1)?.p.find((p) => p.id === a.id);
    ok(s2 && s2.x < 20, 'server rejects impossible movement');

    // ================= OFFICE
    console.log('Office');
    await a.use('copier');
    ok(a.events.some((e) => e.type === 'msg' && /Clock in/i.test(e.text)), 'copier refuses before clocking in');
    await a.use('clock');
    ok(a.hasFlag('clockedIn'), 'clock in at terminal');
    await a.use('copier'); await sleep(1900);
    ok(a.inv.some((i) => i.kind === 'report'), 'copier prints the quarterly report into inventory');
    await a.use('inbox');
    ok(a.hasFlag('delivered'), 'report delivered to inbox');
    for (const f of ['file_1', 'file_2', 'file_3']) await b.use(f);
    ok(b.inv.filter((i) => i.kind === 'file').length === 3, 'B picks up 3 folders');
    await b.use('restricted_door');
    ok(!a.floor.state.doors.find((d) => d.id === 'restricted_door').open && !a.events.some((e) => e.type === 'door' && e.id === 'restricted_door'), 'restricted door stays locked without keycard');
    await b.use('records');
    ok(b.hasFlag('filed') && b.hasFlag('endOfDay'), 'filing completes the day → end of day event');
    ok(a.events.some((e) => e.type === 'item' && e.item.id === 'key_b1' && e.item.state === 'world'), 'B1 keycard appears');
    await a.use('clock');
    ok(a.notes.at(-1)?.title.includes('NEW MESSAGE'), 'terminal now shows Dana\'s email');
    await b.use('key_b1');
    ok(b.inv.some((i) => i.key === 'key_b1'), 'B holds the B1 keycard');
    // keycard handoff: drop + pickup by A
    b.s.emit('dropItem', 'key_b1'); await sleep(150);
    ok(!b.inv.some((i) => i.key === 'key_b1') && a.events.some((e) => e.type === 'item' && e.item.id === 'key_b1' && e.item.state === 'world'), 'keycard can be dropped for a teammate');
    const dropped = a.events.filter((e) => e.type === 'item' && e.item.id === 'key_b1').at(-1).item;
    a.floor.state.items = a.floor.state.items.map((i) => (i.id === 'key_b1' ? dropped : i));
    await a.use('key_b1');
    ok(a.inv.some((i) => i.key === 'key_b1'), 'A picks up the handed-off keycard');
    await a.use('restricted_door');
    ok(a.events.some((e) => e.type === 'door' && e.id === 'restricted_door' && e.open), 'keycard opens the restricted door');
    await a.use('elevator_door');
    ok(a.events.some((e) => e.type === 'door' && e.id === 'elevator_door' && e.open), 'keycard opens the elevator');
    await a.enterElevator();
    await b.goto(tileCenter(2), tileCenter(2));
    a.s.emit('interact', { id: 'elevator' }); await sleep(150);
    ok(a.events.some((e) => e.type === 'msg' && /Everyone has to be inside/.test(e.text)), 'elevator waits for all living players');
    // Story: picking up the card set Mr. Thatch (still human) on our trail.
    ok(b.events.some((e) => e.type === 'say' && e.who === 'thatch'), 'Thatch speaks when the B1 card is taken');
    ok(a.snaps.some((s) => s.ca && s.c?.fm === 'human' && s.c.st === 'chase'), 'Thatch chases in his human form');
    // Reaching the restricted hall triggers the elevator escape cutscene.
    await a.goto(tileCenter(26), tileCenter(14));
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'cutscene' && e.phase === 'start'), 3000, 'escape start'), 'reaching the elevator starts the escape cutscene');
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'cutscene' && e.phase === 'transform'), 20000, 'transform'), 'Thatch transforms into the monster at the elevator');
    ok(await a.waitFor(() => a.snaps.at(-1)?.c?.fm === 'monster', 2000, 'monster form'), 'snapshots now show his monster form');
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'cutscene' && e.phase === 'closed'), 15000, 'closed'), 'elevator doors slam shut in his face');
    {
      const c = a.snaps.at(-1).c;
      const g = a.grid;
      ok(g.cell(Math.floor(c.x / 2), Math.floor(c.z / 2)) !== 4, 'the monster never gets inside the car');
      const ps = a.snaps.at(-1).p;
      ok(ps.every((p) => g.cell(Math.floor(p.x / 2), Math.floor(p.z / 2)) === 4), 'every employee made it into the elevator');
    }
    ok(await a.waitFor(() => a.floor.state.levelId === 'b1' && b.floor?.state.levelId === 'b1', 12000, 'b1'), 'the elevator carries everyone down to B1');
    await sleep(250); a.events.length = 0; b.events.length = 0;
    ok(loadCheckpoint(created.code)?.floorIndex === 1, 'checkpoint saved to disk on arrival');

    // ================= B1
    console.log('B1 — Restricted Archives');
    ok(a.floor.state.lights === 'emergency', 'B1 starts in emergency lighting');
    await a.use('vault_keypad');
    ok(a.events.some((e) => e.type === 'msg' && /No power/i.test(e.text)), 'keypad dead without power');
    await a.use('breaker_a');
    await sleep(200);
    await b.use('breaker_b');
    ok(a.hasFlag('power'), 'co-op breakers restore power');
    await sleep(200);
    ok(a.snaps.at(-1)?.ca === true, 'power wakes the CEO');
    const digits = [];
    for (const [i, n] of [['b1_code_1', 0], ['b1_code_2', 1], ['b1_code_3', 2], ['b1_code_4', 3]].map((x) => x)) {
      await b.use(i);
      const text = b.notes.at(-1).text;
      const code = b.floor.state.codes.vault;
      digits[n] = code[n];
      ok(text.includes(code[n]) && !text.includes('{code'), `note ${i} reveals digit ${n + 1}`);
    }
    ok(a.events.some((e) => e.type === 'journal'), 'read notes are shared to the team journal');
    await a.use('vault_keypad');
    ok(a.keypad?.digits === 4, 'keypad prompts for a 4-digit code');
    a.s.emit('interact', { id: 'vault_keypad', code: '0000' === digits.join('') ? '1111' : '0000' }); await sleep(150);
    ok(a.keypadResult?.ok === false, 'wrong code rejected');
    a.s.emit('interact', { id: 'vault_keypad', code: digits.join('') }); await sleep(150);
    ok(a.keypadResult?.ok === true && a.hasFlag('vaultOpen'), 'correct code opens the vault');
    await a.use('key_b2');
    ok(a.inv.some((i) => i.key === 'key_b2'), 'B2 keycard taken');
    await rideElevator(a, b, 'b2');

    // ================= B2
    console.log('B2 — Research & Development');
    ok(a.snaps.at(-1)?.ca === false, 'CEO dormant in B2 until disturbed');
    await b.use('valve_monitor');
    const order = b.floor.state.orders.valves;
    ok(b.notes.at(-1)?.text.includes(order[0]), 'monitor shows the valve sequence');
    const idOf = (label) => b.grid.entities.find((e) => e.type === 'valve' && e.label === label).id;
    const wrong = b.grid.entities.find((e) => e.type === 'valve' && e.label !== order[0]).id;
    await a.use(wrong);
    ok(a.events.some((e) => e.type === 'msg' && /Wrong valve/.test(e.text)), 'wrong valve triggers the alarm');
    for (const label of order) await a.use(idOf(label));
    ok(a.hasFlag('protoOpen'), 'correct sequence opens the Prototype Lab');
    await b.use('key_b3');
    await sleep(300);
    const snap = a.snaps.at(-1);
    ok(snap?.ca && snap.c.st === 'chase', 'taking the B3 keycard starts the chase');
    await rideElevator(b, a, 'b3');

    // ================= B3
    console.log('B3 — Employee Containment');
    ok(a.snaps.at(-1)?.ca === true, 'CEO already hunting on B3');
    await a.use('fuse_1');
    await a.use('fusebox');
    ok(a.events.some((e) => e.type === 'socket' && e.id === 'fusebox' && e.count === 1), 'first fuse inserted');
    await b.use('iso_lever');
    ok(b.events.some((e) => e.type === 'door' && e.id === 'iso_gate' && e.open), 'lever holds the isolation gate open');
    await a.use('fuse_2');
    await a.use('fusebox');
    ok(a.hasFlag('wardenOpen'), "both fuses open the Warden's office");
    await a.use('key_b4');
    await rideElevator(a, b, 'b4');

    // ================= B4 — also tests hazards, death, spectating and checkpoint reload
    console.log('B4 — Biological Research');
    a.s.emit('debug', { god: false }); // let the gas hurt
    const spec = a.ent('spec_1');
    await a.goto(...a.standNear(spec));
    await sleep(800);
    const hp = a.snaps.at(-1).p.find((p) => p.id === a.id).hp;
    ok(hp < 100, `toxic gas damages players (hp ${hp})`);
    await b.use('vent_switch');
    ok(b.hasFlag('vent'), 'ventilation purge clears the gas');
    // Deaths: kill both → game over → checkpoint reload
    a.s.emit('debug', { kill: true });
    await sleep(200);
    ok(b.events.some((e) => e.type === 'death' && e.id === a.id), 'death is broadcast (other player can spectate)');
    ok(b.snaps.at(-1).p.find((p) => p.id === a.id).f & 16 ? false : true, 'dead player flagged as not alive in snapshots');
    b.s.emit('debug', { kill: true });
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'gameover'), 2000, 'gameover'), 'all players dead → game over');
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'reload'), 9000, 'reload'), 'reloads last checkpoint');
    await a.waitFor(() => a.snaps.at(-1)?.p.every((p) => p.f & 16), 2000, 'revive');
    ok(a.floor.state.levelId === 'b4' && a.snaps.at(-1).p.every((p) => p.f & 16), 'players respawn alive at the B4 checkpoint');
    for (const bot of [a, b]) bot.s.emit('debug', { god: true });
    await b.use('vent_switch');
    for (const s of ['spec_1', 'spec_2', 'spec_3']) await a.use(s);
    ok(a.inv.filter((i) => i.kind === 'specimen').length === 3, 'collected 3 specimens');
    await a.use('sequencer');
    ok(a.hasFlag('sequenced'), 'sequencer authenticates');
    await b.use('key_b5');
    ok(b.inv.some((i) => i.key === 'key_b5'), 'B5 keycard printed and taken');
    await rideElevator(b, a, 'b5');

    // ================= B5
    console.log('B5 — Executive Level');
    await a.use('furnace_console');
    ok(a.events.some((e) => e.type === 'msg' && /NO POWER/.test(e.text)), 'incinerator needs generators');
    for (const g of ['gen_1', 'gen_2', 'gen_3']) await (g === 'gen_2' ? b : a).use(g);
    ok(a.hasFlag('gensOnline'), 'all three generators online');
    await a.use('furnace_console');
    ok(a.hasFlag('trapArmed'), 'incinerator armed');
    // move both players far away, then send the CEO walking into the chamber
    await a.goto(tileCenter(3), tileCenter(9)); await b.goto(tileCenter(5), tileCenter(9));
    a.s.emit('debug', { ceoGoto: { x: tileCenter(32), z: tileCenter(14) } });
    for (let i = 0; i < 6; i++) { await sleep(5000); a.s.emit('debug', { ceoGoto: { x: tileCenter(32), z: tileCenter(14) } }); if (a.events.some((e) => e.type === 'trap')) break; }
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'trap' && e.sealed), 15000, 'trap'), 'CEO walks into the incinerator and it seals');
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'flag' && e.name === 'thatchDead'), 12000, 'dead'), 'Thatch burns');
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'flag' && e.name === 'elevatorBack'), 8000, 'back'), 'the elevator comes back down for the team');
    await a.enterElevator(); await b.goto(tileCenter(3), tileCenter(9));
    a.s.emit('interact', { id: 'elevator' }); await sleep(200);
    ok(!a.events.some((e) => e.type === 'ending'), 'nobody gets left behind: the ride up waits for everyone');
    await b.enterElevator();
    a.s.emit('interact', { id: 'elevator' });
    ok(await a.waitFor(() => a.events.some((e) => e.type === 'ending') && b.events.some((e) => e.type === 'ending'), 5000, 'ending'), 'riding up to the surface ends the game for all players');

    // ---- CEO movement must be continuous across all snapshots collected (no teleporting)
    let maxSpeed = 0;
    const S = a.snaps;
    for (let i = 1; i < S.length; i++) {
      if (!S[i].c || !S[i - 1].c || !S[i].ca || !S[i - 1].ca) continue;
      const dt = (S[i].t - S[i - 1].t) / 1000;
      if (dt <= 0 || dt > 0.5) continue;
      const d = Math.hypot(S[i].c.x - S[i - 1].c.x, S[i].c.z - S[i - 1].c.z);
      if (d > 3) continue; // floor change (new building) — not a teleport within a floor
      maxSpeed = Math.max(maxSpeed, d / dt);
    }
    ok(maxSpeed < 7.5, `CEO never teleports (max observed speed ${maxSpeed.toFixed(2)} m/s)`);
  } catch (e) {
    failed++;
    console.log('  ✗ playthrough crashed: ' + e.stack);
  } finally {
    a.close(); b.close();
    await srv.close();
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
  return { passed, failed };
}

if (process.argv[1] && process.argv[1].endsWith('playthrough.js')) {
  runPlaythrough().then(({ passed, failed }) => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); });
}
