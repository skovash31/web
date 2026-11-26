// Held items: the permanent flashlight, coffee on desks, medkits and batteries, online.
import { Floor } from '../server/Floor.js';
import { LEVELS } from '../shared/levels/index.js';
import { C, toTile } from '../shared/grid.js';
import { COFFEE, MEDKIT, PLAYER, NOTHING, GUN } from '../shared/constants.js';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeRoom = () => ({ players: new Map(), alivePlayers: () => [], broadcastEvent() {}, noise() {}, tell() {}, toPlayer() {} });

function buttonTests() {
  console.log('Nothing Button');
  const counts = new Set();
  let others = true;
  for (let seed = 1; seed <= 40; seed++) {
    for (const level of LEVELS) {
      const f = new Floor(level, fakeRoom(), seed * 6007);
      const n = [...f.items.values()].filter((i) => i.kind === 'nothing').length;
      if (level.index === 0) counts.add(n); else if (n !== 1) others = false;
    }
  }
  ok([...counts].every((n) => n >= 2 && n <= 4) && counts.size === 3, `the office spawns 2, 3 or 4 buttons (saw ${[...counts].sort().join(', ')})`);
  ok(others, 'every other floor has exactly one');
}

function coffeeSpawnTests() {
  console.log('Coffee spawns');
  for (const level of LEVELS) {
    const bad = [];
    let cups = 0, onDesk = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const f = new Floor(level, fakeRoom(), seed * 7907);
      const g = f.grid;
      const sp = f.spawnTiles[0];
      const reach = g.playerReachable(sp[0], sp[1], () => true);
      for (const it of [...f.items.values()].filter((i) => i.kind === 'coffee')) {
        cups++;
        const tx = toTile(it.x), tz = toTile(it.z), i = tz * g.w + tx;
        const ent = g.entities.find((e) => e.tx === tx && e.tz === tz && e.type === 'prop');
        if (ent?.model === 'desk') onDesk++;
        if (!(it.y > 0.6 && it.y <= 1.0)) bad.push('not on furniture');
        if (g.cell(tx, tz) !== C.FLOOR || !reach[i]) bad.push('unreachable');
      }
    }
    const want = level.index === 0 ? 2 : 1;
    ok(!bad.length && cups === 20 * want, `[${level.id}] ${want} cup${want > 1 ? 's' : ''} of coffee per round, sitting on furniture you can reach${bad.length ? ' — ' + [...new Set(bad)].join(', ') : ''}`);
    ok(onDesk >= cups * 0.9, `[${level.id}] coffee is left on desks (${onDesk}/${cups})`);
  }
}

export async function runOnlineItemTests() {
  const { createServer } = await import('../server/index.js');
  const { io: connect } = await import('socket.io-client');
  console.log('Held items online');
  const srv = await createServer({ port: 0, debug: true, quiet: true });
  const url = `http://localhost:${srv.port}`;
  const mk = () => {
    const s = connect(url, { transports: ['websocket'], forceNew: true });
    Object.assign(s, { events: [], inv: null, got: {}, floor: null });
    s.on('ev', (e) => s.events.push(e));
    s.on('inv', (d) => { s.inv = d; });
    s.on('floor', (f) => { s.floor = f; });
    for (const n of ['boost', 'medkit', 'battery']) s.on(n, (d) => { s.got[n] = d; });
    return s;
  };
  const emit = (s, ...a) => new Promise((r) => s.emit(...a, r));
  const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(25); } return false; };
  const a = mk(), b = mk();
  const kinds = (s) => s.inv?.items.map((i) => i.kind) || [];
  const find = (s, k) => s.inv?.items.find((i) => i.kind === k);
  try {
    await Promise.all([a, b].map((s) => new Promise((r) => s.on('connect', r))));
    const room = await emit(a, 'createRoom', { name: 'A' });
    await emit(b, 'joinRoom', { code: room.code, name: 'B' });
    a.emit('startGame'); await waitFor(() => a.floor && b.floor && a.inv && b.inv, 3000);
    ok(kinds(a).filter((k) => k === 'flashlight').length === 1 && kinds(b).filter((k) => k === 'flashlight').length === 1, 'every player starts with exactly one flashlight item');
    a.emit('dropItem', find(a, 'flashlight').id); await sleep(200);
    ok(kinds(a).includes('flashlight') && a.events.some((e) => e.type === 'msg' && /can't drop your flashlight/i.test(e.text)), "the flashlight can't be dropped");
    // coffee
    a.emit('debug', { giveKind: 'coffee' }); await waitFor(() => find(a, 'coffee'), 1000);
    const cup = find(a, 'coffee');
    a.emit('useItem', cup.id); await waitFor(() => a.got.boost, 1000);
    ok(a.got.boost?.dur === COFFEE.duration && a.got.boost?.speed === COFFEE.speed, `drinking coffee gives a ${COFFEE.duration} s speed boost (×${COFFEE.speed})`);
    ok(!find(a, 'coffee'), 'the cup is used up');
    // medkit
    a.emit('debug', { giveKind: 'medkit' }); await waitFor(() => find(a, 'medkit'), 1000);
    a.emit('useItem', find(a, 'medkit').id); await waitFor(() => a.got.medkit, 1000);
    ok(a.got.medkit && a.got.medkit.health <= PLAYER.maxHealth && !find(a, 'medkit'), `a first-aid kit heals (+${MEDKIT.heal}) and refills stamina, and is used up`);
    // battery
    a.emit('debug', { giveKind: 'battery' }); await waitFor(() => find(a, 'battery'), 1000);
    ok(!a.got.battery, 'a battery you pick up waits in your inventory (no auto-load)');
    a.emit('useItem', find(a, 'battery').id); await waitFor(() => a.got.battery, 1000);
    ok(a.got.battery?.value === PLAYER.maxBattery && !find(a, 'battery'), 'loading a battery fills the flashlight');
    // the Nothing Button
    const btn = a.floor.state.items.filter((i) => i.kind === 'nothing');
    ok(btn.length >= 2 && btn.length <= 4 && b.floor.state.items.filter((i) => i.kind === 'nothing').length === btn.length, `the office has 2-4 Nothing Buttons (${btn.length} this time), the same for both players`);
    ok(btn.every((i) => i.presses === NOTHING.presses), `each one can be pressed ${NOTHING.presses} times`);
    a.emit('debug', { luck: false });
    a.emit('debug', { giveKind: 'nothing' }); await waitFor(() => find(a, 'nothing'), 1000);
    const strip = (items) => JSON.stringify(items.map(({ presses, ...r }) => r));
    const before = strip(a.inv.items), evA = a.events.length, evB = b.events.length;
    const gotBefore = JSON.stringify(a.got);
    a.emit('useItem', find(a, 'nothing').id); await sleep(400);
    const newA = a.events.slice(evA);
    ok(strip(a.inv.items) === before && JSON.stringify(a.got) === gotBefore && find(a, 'nothing').presses === NOTHING.presses - 1, 'pressing it does nothing (only one press used up): inventory, health, stamina, battery all the same');
    ok(newA.every((e) => (e.type === 'sound' && e.name === 'nothing') || (e.type === 'msg' && e.private)) && b.events.length === evB, 'it only clicks for the presser (no noise for Mr. Thatch, nothing for teammates)');
    for (let i = 0; i < NOTHING.presses - 1; i++) { a.emit('useItem', find(a, 'nothing').id); await sleep(150); }
    await sleep(200);
    ok(!find(a, 'nothing') && !kinds(a).includes('gun'), `after ${NOTHING.presses} presses the button is gone`);
    // the 1% roll: forced win
    a.emit('debug', { giveKind: 'nothing' }); await waitFor(() => find(a, 'nothing'), 1000);
    a.emit('debug', { luck: true });
    a.emit('useItem', find(a, 'nothing').id);
    ok(await waitFor(() => find(a, 'gun') && find(a, 'gunammo'), 1000), 'a lucky press gives a pistol and a box of bullets');
    ok(find(a, 'gun')?.ammo === GUN.magazine && find(a, 'gunammo')?.count === GUN.perBox && find(a, 'nothing')?.presses === NOTHING.presses - 1, `the pistol comes loaded (${GUN.magazine}) with ${GUN.perBox} spare, and the button keeps its other presses`);
    for (const k of ['gun', 'gunammo', 'nothing']) { a.emit('dropItem', find(a, k).id); await sleep(80); }
    // other items drop normally
    a.emit('debug', { giveKind: 'coffee' }); await waitFor(() => find(a, 'coffee'), 1000);
    const c2 = find(a, 'coffee');
    a.emit('dropItem', c2.id);
    ok(await waitFor(() => !find(a, 'coffee') && b.events.some((e) => e.type === 'item' && e.item.id === c2.id && e.item.state === 'world'), 1000), 'other items drop (Q) and teammates see them land');
    // death: the flashlight stays with you
    a.emit('debug', { giveKind: 'medkit' }); await waitFor(() => find(a, 'medkit'), 1000);
    a.emit('debug', { kill: true }); await sleep(300);
    ok(kinds(a).length === 1 && kinds(a)[0] === 'flashlight', 'dying drops everything except the flashlight');
    // next floor: still exactly one flashlight, carried coffee comes along
    for (const s of [a, b]) s.emit('debug', { god: true });
    b.emit('debug', { giveKind: 'coffee' }); await waitFor(() => find(b, 'coffee'), 1000);
    b.emit('debug', { floor: 'b1' });
    await waitFor(() => a.floor?.state.levelId === 'b1' && b.floor?.state.levelId === 'b1', 8000);
    await sleep(300);
    ok(kinds(a).filter((k) => k === 'flashlight').length === 1 && kinds(b).filter((k) => k === 'flashlight').length === 1, 'after a floor change everyone still has exactly one flashlight');
    ok(kinds(b).includes('coffee'), 'coffee you carry comes with you to the next floor');
  } catch (e) {
    ok(false, 'online item test crashed: ' + e.stack);
  } finally {
    a.close(); b.close();
    await srv.close?.();
  }
  return { passed, failed };
}

export function runItemTests() {
  buttonTests();
  coffeeSpawnTests();
  return { passed, failed };
}

if (process.argv[1]?.endsWith('items.js')) {
  runItemTests();
  const r = await runOnlineItemTests();
  console.log(`\n${r.passed}/${r.passed + r.failed} passed`);
  process.exit(r.failed ? 1 : 0);
}
