// Runtime state and rules for a single floor: doors, items, puzzles, hazards, triggers.
// Everything here is authoritative; clients only send intents ("interact with X").
import { Grid, C, toTile, tileCenter, mulberry32 } from '../shared/grid.js';
import { PLAYER, NOISE, STAPLER } from '../shared/constants.js';

export class Floor {
  constructor(level, room, seed) {
    this.level = level;
    this.room = room;
    this.grid = new Grid(level);
    this.rng = mulberry32(seed);
    this.flags = new Set();
    this.lights = level.startLights || 'on';
    this.doors = new Map();
    this.items = new Map();
    this.ents = new Map();
    this.groups = {};
    this.timers = [];          // {at, fn}
    this.time = 0;
    this.firedRules = new Set();
    this.firedZones = new Set();
    this.switchState = {};     // switch id -> bool (for clients)
    this.valveState = {};
    this.dynamicItemSeq = 0;
    this.trap = level.trap ? { ...level.trap, sealed: false } : null;
    this.departing = false;

    for (const e of this.grid.entities) {
      this.ents.set(e.id, e);
      if (this.grid.cell(e.tx, e.tz) === C.DOOR) {
        this.doors.set(e.id, { id: e.id, open: false, locked: !!e.lock, lock: e.lock || null, heavy: !!e.heavy, gate: !!e.gate, elevatorDoor: !!e.elevatorDoor });
      }
      if (e.type === 'item') {
        this.items.set(e.id, { id: e.id, kind: e.kind, key: e.key, name: e.name, x: e.x, z: e.z, y: e.solid || 0, state: e.hidden ? 'hidden' : 'world', holder: null, onPickup: e.onPickup });
      }
    }
    this.randomizeItems();
    this.spawnStaplers();
    // Puzzle setup
    for (const [gid, g] of Object.entries(level.groups || {})) {
      const st = { def: g, id: gid };
      if (g.kind === 'code') {
        st.code = Array.from({ length: g.digits }, () => Math.floor(this.rng() * 10)).join('');
      } else if (g.kind === 'sequence') {
        const valves = this.grid.entities.filter((e) => e.type === 'valve' && e.group === gid).map((e) => e.id);
        for (let i = valves.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [valves[i], valves[j]] = [valves[j], valves[i]]; }
        st.order = valves; st.progress = 0; st.fails = 0;
      } else if (g.kind === 'socket') {
        st.count = 0;
      } else if (g.kind === 'switchWindow' || g.kind === 'switchPermanent') {
        st.active = new Set(); st.deadline = 0;
        st.members = this.grid.entities.filter((e) => e.type === 'switch' && e.group === gid).map((e) => e.id);
      } else if (g.kind === 'timedFlag') {
        st.until = 0; st.cooldownUntil = 0;
      }
      if (g.done) st.done = false;
      this.groups[gid] = st;
    }
    // Elevator door: open on arrival for all sublevels (players arrive inside).
    const ed = this.doors.get('elevator_door');
    if (ed && level.index > 0) { ed.open = true; }
    this.spawnTiles = this.computeSpawns();
    // Some floors: the car leaves once everyone steps out. No way back up.
    if (level.elevatorLeaves && ed) {
      const close = () => {
        const de = this.ents.get('elevator_door');
        const inCar = this.room.alivePlayers().some((p) => this.grid.cell(toTile(p.x), toTile(p.z)) === C.ELEVATOR);
        if (inCar || this.tileOccupied(de.tx, de.tz)) return this.after(1, close);
        if (this.flags.has('elevatorBack')) return;
        ed.locked = true; ed.lock = 'script';
        this.setDoor('elevator_door', false, null);
        this.room.broadcastEvent({ type: 'msg', text: level.elevatorLeavesMsg || 'The elevator doors shut behind you. The car hums away upward.', dur: 5 });
        this.room.broadcastEvent({ type: 'sound', name: 'elevatorLeave' });
      };
      this.after(level.elevatorLeaves, close);
    }
  }

  // ---------------------------------------------------------------- random item placement
  // Loose collectibles (batteries, first-aid kits, misplaced folders...) are scattered to a
  // new random spot every time a floor loads. Each item stays inside the same door-bounded
  // area the level designer put it in, so an item can never land in a wall, a sealed room or
  // somewhere the story hasn't unlocked yet. Story items (keycards on pedestals, puzzle
  // pieces, anything with a pickup script or marked fixed) keep their authored spot.
  randomizable(it) {
    const e = this.ents.get(it.id);
    return it.state === 'world' && e && !e.base && !e.onPickup && !e.fixed && !e.hidden;
  }

  areaLabels() {
    const g = this.grid, W = g.w;
    const label = new Int32Array(W * g.h).fill(-1);
    const passable = (x, z) => {
      const c = g.cell(x, z), i = z * W + x;
      if (c === C.DOOR) { const d = this.doors.get(g.doorAt.get(i)?.id); return !!d && !d.locked && !d.gate && !d.elevatorDoor; }
      if (c !== C.FLOOR && c !== C.ELEVATOR && c !== C.VENT) return false;
      return !(g.solidTop[i] > 1.0); // tall props block; low ones can be climbed
    };
    let n = 0;
    for (let z = 0; z < g.h; z++) for (let x = 0; x < W; x++) {
      if (label[z * W + x] >= 0 || !passable(x, z)) continue;
      const q = [[x, z]]; label[z * W + x] = n;
      while (q.length) {
        const [cx, cz] = q.pop();
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, nz = cz + dz;
          if (!g.inBounds(nx, nz) || label[nz * W + nx] >= 0 || !passable(nx, nz)) continue;
          label[nz * W + nx] = n; q.push([nx, nz]);
        }
      }
      n++;
    }
    return label;
  }

  randomizeItems() {
    const movable = [...this.items.values()].filter((it) => this.randomizable(it));
    const g = this.grid, W = g.w;
    const label = this.areaLabels();
    const occupied = new Set();
    for (const e of g.entities) if (e.type !== 'light' && !movable.some((it) => it.id === e.id)) occupied.add(e.tz * W + e.tx);
    const spawn = new Set((this.spawnTiles || this.computeSpawns()).map(([x, z]) => z * W + x));
    const inHazard = (x, z) => (this.level.hazards || []).some((h) => x >= h.rect[0] && x <= h.rect[2] && z >= h.rect[1] && z <= h.rect[3])
      || (this.level.trap && x >= this.level.trap.zone[0] && x <= this.level.trap.zone[2] && z >= this.level.trap.zone[1] && z <= this.level.trap.zone[3]);
    const nearDoor = (x, z) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => g.cell(x + dx, z + dz) === C.DOOR || g.cell(x + dx, z + dz) === C.ELEVATOR);
    // candidate tiles per area: open floor, or the top of a desk / crate / gurney
    const byArea = new Map();
    for (let z = 0; z < g.h; z++) for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (g.cell(x, z) !== C.FLOOR || label[i] < 0 || spawn.has(i) || inHazard(x, z) || nearDoor(x, z)) continue;
      const top = g.solidTop[i];
      const ent = g.entities.find((e) => e.tx === x && e.tz === z && e.type !== 'light');
      let y = 0;
      if (top > 0) {
        if (!(top >= 0.7 && top <= 1.0) || !ent || ent.type !== 'prop') continue; // only flat, low furniture
        y = top;
      } else if (occupied.has(i)) continue;
      if (!byArea.has(label[i])) byArea.set(label[i], []);
      byArea.get(label[i]).push({ x, z, y, i });
    }
    const placed = [];
    // remembered so other loot (staplers, staples) can be scattered the same way
    this.loot = { label, byArea, placed, areas: new Set(movable.map((it) => label[toTile(it.z) * W + toTile(it.x)])) };
    for (const [x, z] of this.spawnTiles || this.computeSpawns()) this.loot.areas.add(label[z * W + x]);
    this.loot.areas.delete(-1);
    const far = (c) => placed.every((p) => Math.max(Math.abs(p.x - c.x), Math.abs(p.z - c.z)) >= 3);
    // shuffle so the spacing rule doesn't always favour the same items
    for (let k = movable.length - 1; k > 0; k--) { const j = Math.floor(this.rng() * (k + 1)); [movable[k], movable[j]] = [movable[j], movable[k]]; }
    for (const it of movable) {
      const area = label[toTile(it.z) * W + toTile(it.x)];
      const cands = (byArea.get(area) || []).filter((c) => !placed.some((p) => p.i === c.i));
      if (!cands.length) continue;
      const spaced = cands.filter(far);
      const pool = spaced.length ? spaced : cands;
      const c = pool[Math.floor(this.rng() * pool.length)];
      placed.push(c);
      // a little jitter inside the tile so it doesn't look grid-snapped
      const jx = (this.rng() - 0.5) * (c.y ? 0.6 : 0.9), jz = (this.rng() - 0.5) * (c.y ? 0.6 : 0.9);
      it.x = tileCenter(c.x) + jx; it.z = tileCenter(c.z) + jz; it.y = c.y;
    }
  }

  // One stapler and some boxes of staples per floor, at random spots in areas players can
  // reach (the areas the level's own loose loot lives in, plus where the team arrives).
  spawnStaplers() {
    const L = this.loot;
    if (!L) return;
    const pool = [];
    for (const a of L.areas) for (const c of L.byArea.get(a) || []) if (!L.placed.some((p) => p.i === c.i)) pool.push(c);
    const pick = () => {
      const free = pool.filter((c) => !L.placed.some((p) => p.i === c.i));
      if (!free.length) return null;
      const spaced = free.filter((c) => L.placed.every((p) => Math.max(Math.abs(p.x - c.x), Math.abs(p.z - c.z)) >= 3));
      const from = spaced.length ? spaced : free;
      const c = from[Math.floor(this.rng() * from.length)];
      L.placed.push(c);
      return c;
    };
    const place = (kind, name, extra) => {
      const c = pick();
      if (!c) return null;
      const it = this.createItem(kind, name, extra);
      it.state = 'world';
      it.x = tileCenter(c.x) + (this.rng() - 0.5) * 0.6; it.z = tileCenter(c.z) + (this.rng() - 0.5) * 0.6; it.y = c.y;
      this.syncItemEntity(it);
      return it;
    };
    place('stapler', 'Heavy-duty stapler', { ammo: 0 });
    const boxes = this.level.index === 0 ? 1 : 2;
    for (let i = 0; i < boxes; i++) place('staples', 'Box of staples', { count: STAPLER.perBox });
  }

  computeSpawns() {
    const sp = this.grid.entities.find((e) => e.type === 'spawn');
    if (sp) {
      const out = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (this.grid.isOpen(sp.tx + dx, sp.tz + dz)) out.push([sp.tx + dx, sp.tz + dz]);
      return out;
    }
    return this.grid.elevatorTiles.filter(([x, z]) => !this.grid.entities.some((e) => e.tx === x && e.tz === z && e.type === 'elevator'))
      .concat(this.grid.elevatorTiles);
  }

  spawnPoint(i) {
    const t = this.spawnTiles[i % this.spawnTiles.length];
    const jitter = (Math.floor(i / this.spawnTiles.length) % 3 - 1) * 0.5;
    return { x: tileCenter(t[0]) + jitter, z: tileCenter(t[1]) + jitter * 0.6 };
  }

  entity(id) { return this.ents.get(id); }
  hideSpots() { return this.grid.entities.filter((e) => e.type === 'hide'); }
  isDoorOpen(id) { const d = this.doors.get(id); return !!d && d.open; }
  ceoCanPass(id) {
    const d = this.doors.get(id);
    if (!d) return false;
    if (d.open) return true;
    if (d.elevatorDoor || d.gate) return false;
    return !d.locked;
  }

  // ---------------------------------------------------------------- public snapshot
  publicState() {
    const codes = {};
    const orders = {};
    for (const [gid, st] of Object.entries(this.groups)) {
      if (st.code) codes[gid] = st.code;
      if (st.order) orders[gid] = st.order.map((id) => this.ents.get(id).label);
    }
    return {
      levelId: this.level.id,
      flags: [...this.flags],
      lights: this.lights,
      doors: [...this.doors.values()].map((d) => ({ id: d.id, open: d.open, locked: d.locked })),
      items: [...this.items.values()].map((it) => this.itemPublic(it)),
      codes, orders,
      switches: this.switchState,
      valves: this.valveState,
      trap: this.trap ? { sealed: this.trap.sealed } : null,
    };
  }

  itemPublic(it) {
    return { id: it.id, kind: it.kind, name: it.name, key: it.key, state: it.state, holder: it.holder, x: +it.x.toFixed(2), y: it.y, z: +it.z.toFixed(2), ammo: it.ammo, count: it.count };
  }

  // ---------------------------------------------------------------- doors & flags
  setDoor(id, open, player) {
    const d = this.doors.get(id);
    if (!d || d.open === open) return;
    d.open = open;
    const e = this.ents.get(id);
    this.room.broadcastEvent({ type: 'door', id, open, locked: d.locked });
    this.room.noise(e.x, e.z, NOISE.door * (d.heavy ? 1.4 : 1), player, 'door');
  }

  setFlag(name) {
    if (this.flags.has(name)) return;
    this.flags.add(name);
    this.room.broadcastEvent({ type: 'flag', name, on: true });
    this.evaluateRules();
  }

  clearFlag(name) {
    if (!this.flags.has(name)) return;
    this.flags.delete(name);
    this.room.broadcastEvent({ type: 'flag', name, on: false });
  }

  evaluateRules() {
    (this.level.rules || []).forEach((r, i) => {
      if (this.firedRules.has(i)) return;
      if (r.when.every((f) => this.flags.has(f))) { this.firedRules.add(i); this.run(r.do, {}); }
    });
  }

  after(sec, fn) { this.timers.push({ at: this.time + sec, fn }); }

  // ---------------------------------------------------------------- action DSL
  run(actions, ctx) {
    for (const a of actions || []) {
      if (a.msg) this.room.broadcastEvent({ type: 'msg', text: a.msg, dur: a.dur || 4 });
      if (a.objective) this.room.broadcastEvent({ type: 'msg', text: a.objective, dur: 4 });
      if (a.flag) this.setFlag(a.flag);
      if (a.unflag) this.clearFlag(a.unflag);
      if (a.unlock) { const d = this.doors.get(a.unlock); if (d) { d.locked = false; this.room.broadcastEvent({ type: 'door', id: d.id, open: d.open, locked: false }); } }
      if (a.lock) { const d = this.doors.get(a.lock); if (d) { d.locked = true; this.room.broadcastEvent({ type: 'door', id: d.id, open: d.open, locked: true }); } }
      if (a.open) this.setDoor(a.open, true, ctx.player);
      if (a.close) this.setDoor(a.close, false, ctx.player);
      if (a.show) { const it = this.items.get(a.show); if (it && it.state === 'hidden') { it.state = 'world'; this.room.broadcastEvent({ type: 'item', item: this.itemPublic(it) }); } }
      if (a.lights) { this.lights = a.lights; this.room.broadcastEvent({ type: 'lights', mode: a.lights }); }
      if (a.sound) this.room.broadcastEvent({ type: 'sound', name: a.sound });
      if (a.noise) {
        const src = ctx.ent || ctx.player;
        if (src) this.room.noise(src.x, src.z, a.noise, null, 'loud');
      }
      if (a.ceo && this.room.ceo) {
        const ceo = this.room.ceo;
        if (a.ceo === 'activate') ceo.activate();
        if (a.ceo === 'chase' && ctx.player) ceo.forceChase(ctx.player);
        // "encounter": he senses the intruder and heads for their rough position
        if (a.ceo === 'hunt' && ctx.player && ceo.active && ceo.state !== 'chase' && ceo.state !== 'scripted') {
          ceo.investigate(ctx.player.x + (Math.random() - 0.5) * 6, ctx.player.z + (Math.random() - 0.5) * 6, true);
        }
      }
      if (a.say) this.room.broadcastEvent({ type: 'say', who: a.say.who || 'you', text: a.say.text, dur: a.say.dur, local: !!a.say.local, player: ctx.player?.id });
      if (a.blackout) {
        const prev = this.lights;
        if (prev !== 'off') {
          this.lights = 'off';
          this.room.broadcastEvent({ type: 'lights', mode: 'off' });
          this.after(a.blackout, () => { if (this.lights === 'off') { this.lights = prev; this.room.broadcastEvent({ type: 'lights', mode: prev }); } });
        }
      }
      if (a.cutscene === 'elevatorEscape') this.room.elevatorEscape();
      if (a.ending) this.room.ending();
    }
  }

  // ---------------------------------------------------------------- interaction
  interact(player, id, payload = {}) {
    const e = this.ents.get(id);
    if (!e) return;
    if (!player.alive) return;
    if (player.hidden) { if (e.type === 'hide' && player.hidden === id) this.leaveHide(player); return; }
    const it = this.items.get(id);
    const ex = it && it.state === 'world' ? it.x : e.x, ez = it && it.state === 'world' ? it.z : e.z;
    const dist = Math.hypot(player.x - ex, player.z - ez);
    const range = PLAYER.interactRange + 1.4 + (e.type === 'elevator' ? 2.5 : 0);
    if (dist > range) return this.room.tell(player, 'Too far away.');
    const handler = this['on_' + e.type];
    if (handler) handler.call(this, player, e, payload);
  }

  hasKey(player, key) {
    return player.inventory.some((iid) => this.items.get(iid)?.key === key);
  }

  on_door(p, e) {
    const d = this.doors.get(e.id);
    if (d.open) {
      if (d.heavy || d.gate || d.elevatorDoor) return this.room.tell(p, d.gate ? 'The gate is held open by the lever.' : 'It will not budge.');
      // don't close on someone / the CEO
      if (this.tileOccupied(e.tx, e.tz)) return this.room.tell(p, 'Something is in the way.');
      return this.setDoor(e.id, false, p);
    }
    if (d.locked) {
      if (d.lock && typeof d.lock === 'object' && d.lock.key) {
        if (this.hasKey(p, d.lock.key)) {
          d.locked = false;
          this.room.broadcastEvent({ type: 'sound', name: 'keycard', at: [e.x, e.z] });
          this.room.tell(p, 'Access granted.');
          return this.setDoor(e.id, true, p);
        }
        this.room.broadcastEvent({ type: 'sound', name: 'denied', at: [e.x, e.z] });
        return this.room.tell(p, e.lockMsg || 'Locked. Requires a keycard.');
      }
      if (d.gate) return this.room.tell(p, e.lockMsg || 'The gate is shut tight.');
      if (d.elevatorDoor) return this.room.tell(p, 'The elevator door only opens from its control panel.');
      return this.room.tell(p, e.lockMsg || 'Locked.');
    }
    this.setDoor(e.id, true, p);
  }

  tileOccupied(tx, tz) {
    for (const q of this.room.alivePlayers()) if (toTile(q.x) === tx && toTile(q.z) === tz) return true;
    const c = this.room.ceo;
    if (c && c.active && toTile(c.x) === tx && toTile(c.z) === tz) return true;
    return false;
  }

  on_item(p, e) {
    const it = this.items.get(e.id);
    if (!it || it.state !== 'world') return;
    this.pickup(p, it);
  }

  pickup(p, it) {
    if (p.inventory.length >= PLAYER.inventorySize) return this.room.tell(p, 'Your hands are full.');
    it.state = 'held'; it.holder = p.id;
    p.inventory.push(it.id);
    this.room.broadcastEvent({ type: 'item', item: this.itemPublic(it) });
    this.room.sendInventory(p);
    this.room.tell(p, `Picked up: ${it.name}`);
    this.room.noise(p.x, p.z, NOISE.pickup, p, 'pickup');
    this.setFlag('got_' + it.id);
    if (it.onPickup) { const actions = it.onPickup; it.onPickup = null; this.run(actions, { player: p }); }
  }

  // Dropped items (death / disconnect) land at the player's feet.
  dropAll(p) {
    const keep = [];
    for (const iid of p.inventory) {
      const it = this.items.get(iid);
      if (!it) continue;
      it.state = 'world'; it.holder = null;
      it.x = p.x + (Math.random() - 0.5) * 0.6; it.z = p.z + (Math.random() - 0.5) * 0.6; it.y = 0;
      // make sure it lands on an open tile so it can be reached
      if (!this.grid.isOpen(toTile(it.x), toTile(it.z)) && this.grid.cell(toTile(it.x), toTile(it.z)) !== C.VENT) { it.x = tileCenter(toTile(p.x)); it.z = tileCenter(toTile(p.z)); }
      this.syncItemEntity(it);
      this.room.broadcastEvent({ type: 'item', item: this.itemPublic(it) });
    }
    p.inventory = keep;
    this.room.sendInventory(p);
  }

  createItem(kind, name, extra = {}) {
    const id = `dyn_${kind}_${++this.dynamicItemSeq}`;
    const it = { id, kind, name, x: 0, z: 0, y: 0, state: 'hidden', holder: null, ...extra };
    this.items.set(id, it);
    this.ents.set(id, { id, type: 'item', x: 0, z: 0, tx: 0, tz: 0 });
    return it;
  }

  // Items can be dropped anywhere; give them an entity record so they're interactable.
  syncItemEntity(it) {
    const ent = this.ents.get(it.id);
    if (ent) { ent.x = it.x; ent.z = it.z; ent.tx = toTile(it.x); ent.tz = toTile(it.z); }
  }

  on_note(p, e) {
    this.room.toPlayer(p, 'note', { id: e.id, title: e.title, text: this.fillText(e.text) });
    this.room.addJournal(e.id, e.title, this.fillText(e.text));
    this.setFlag('read_' + e.id);
  }

  fillText(t) {
    return t.replace(/\{code:(\w+):(\d)\}/g, (_, g, i) => this.groups[g]?.code?.[+i] ?? '?');
  }

  on_terminal(p, e) {
    if (e.after && this.flags.has(e.after.flag)) {
      this.room.toPlayer(p, 'note', { id: e.id + '_after', title: e.after.title, text: e.after.text, terminal: true });
      this.room.addJournal(e.id + '_after', e.after.title, e.after.text);
      if (e.after.setFlag) this.setFlag(e.after.setFlag);
      return;
    }
    this.room.toPlayer(p, 'note', { id: e.id, title: e.title, text: e.text, terminal: true });
    if (e.setFlag && !this.flags.has(e.setFlag)) {
      this.setFlag(e.setFlag);
      if (e.useMsg) this.room.broadcastEvent({ type: 'msg', text: e.useMsg, dur: 3 });
      this.room.broadcastEvent({ type: 'sound', name: 'beep', at: [e.x, e.z] });
    }
  }

  on_dispenser(p, e) {
    if (e.requires && !this.flags.has(e.requires)) return this.room.tell(p, e.failMsg || 'Nothing happens.');
    if (e.once && this.flags.has('used_' + e.id)) return this.room.tell(p, 'Out of paper. It already printed what you needed.');
    if (p.inventory.length >= PLAYER.inventorySize) return this.room.tell(p, 'Your hands are full.');
    this.setFlag('used_' + e.id);
    const it = this.createItem(e.give.kind, e.give.name);
    this.room.broadcastEvent({ type: 'sound', name: 'copier', at: [e.x, e.z] });
    this.room.noise(e.x, e.z, 7, p, 'machine');
    this.after(1.6, () => {
      if (!p.alive || !this.room.players.has(p.id)) { it.state = 'world'; it.x = e.x; it.z = e.z; this.syncItemEntity(it); this.room.broadcastEvent({ type: 'item', item: this.itemPublic(it) }); return; }
      this.pickup(p, it);
      if (e.setFlag) this.setFlag(e.setFlag);
      if (e.useMsg) this.room.tell(p, e.useMsg);
    });
  }

  on_socket(p, e) {
    const st = this.groups[e.group];
    if (!st) return;
    if (st.done) return this.room.tell(p, 'Already done.');
    const mine = p.inventory.filter((iid) => this.items.get(iid)?.kind === e.accepts);
    if (!mine.length) {
      return this.room.tell(p, `${e.emptyMsg || 'It needs something.'} (${st.count}/${st.def.need})`);
    }
    for (const iid of mine) {
      if (st.count >= st.def.need) break;
      const it = this.items.get(iid);
      it.state = 'used'; it.holder = null;
      p.inventory.splice(p.inventory.indexOf(iid), 1);
      st.count++;
      this.room.broadcastEvent({ type: 'item', item: this.itemPublic(it) });
    }
    this.room.sendInventory(p);
    this.room.broadcastEvent({ type: 'sound', name: 'insert', at: [e.x, e.z] });
    this.room.broadcastEvent({ type: 'socket', id: e.id, count: st.count, need: st.def.need });
    if (st.count >= st.def.need) { st.done = true; this.run(st.def.do, { player: p, ent: e }); }
    else if (st.def.onProgress) this.room.broadcastEvent({ type: 'msg', text: st.def.onProgress.replace('{n}', st.count), dur: 3 });
  }

  on_switch(p, e) {
    const st = this.groups[e.group];
    if (!st) return;
    const g = st.def;
    if (g.kind === 'timedFlag') {
      if (this.time < st.until) return this.room.tell(p, 'The purge is already running.');
      if (this.time < st.cooldownUntil) return this.room.tell(p, 'The fans are spinning down. Wait a moment.');
      st.until = this.time + g.time; st.cooldownUntil = st.until + (g.cooldown || 0);
      this.setFlag(g.flag); this.setFlag(g.flag + 'Used');
      this.switchState[e.id] = true;
      this.room.broadcastEvent({ type: 'switch', id: e.id, on: true });
      this.run(g.do, { player: p, ent: e });
      this.after(g.time, () => {
        this.clearFlag(g.flag);
        this.switchState[e.id] = false;
        this.room.broadcastEvent({ type: 'switch', id: e.id, on: false });
        this.run(g.endDo, { ent: e });
      });
      return;
    }
    if (st.done) return this.room.tell(p, 'Already on.');
    if (st.active.has(e.id)) return this.room.tell(p, 'Already thrown.');
    st.active.add(e.id);
    this.switchState[e.id] = true;
    this.room.broadcastEvent({ type: 'switch', id: e.id, on: true });
    this.room.broadcastEvent({ type: 'sound', name: 'switch', at: [e.x, e.z] });
    this.run(g.eachDo, { player: p, ent: e });
    const need = g.need || st.members.length;
    if (st.active.size >= need) {
      st.done = true;
      this.run(g.do, { player: p, ent: e });
      return;
    }
    if (g.kind === 'switchWindow') {
      const solo = this.room.alivePlayers().length <= 1;
      const win = solo ? g.soloWindow : g.window;
      st.deadline = this.time + win;
      const token = (st.token = (st.token || 0) + 1);
      this.room.broadcastEvent({ type: 'msg', text: g.onProgress.replace('{t}', win), dur: 4 });
      this.room.broadcastEvent({ type: 'timer', label: 'BREAKER', until: win });
      this.after(win, () => {
        if (st.done || st.token !== token) return;
        for (const id of st.active) {
          this.switchState[id] = false;
          this.room.broadcastEvent({ type: 'switch', id, on: false });
          const se = this.ents.get(id);
          this.room.broadcastEvent({ type: 'sound', name: 'bang', at: [se.x, se.z] });
          this.room.noise(se.x, se.z, 12, null, 'bang');
        }
        st.active.clear();
        this.room.broadcastEvent({ type: 'msg', text: g.onReset, dur: 4 });
      });
    } else if (g.onProgress) {
      this.room.broadcastEvent({ type: 'msg', text: g.onProgress.replace('{n}', st.active.size), dur: 4 });
    }
  }

  on_valve(p, e) {
    const st = this.groups[e.group];
    if (!st || st.done) return this.room.tell(p, 'The valve is locked open.');
    if (this.valveState[e.id]) return this.room.tell(p, 'Already open.');
    const g = st.def;
    if (st.order[st.progress] === e.id) {
      st.progress++;
      this.valveState[e.id] = true;
      this.room.broadcastEvent({ type: 'valve', id: e.id, on: true });
      this.room.broadcastEvent({ type: 'sound', name: 'valve', at: [e.x, e.z] });
      if (st.progress >= st.order.length) { st.done = true; this.run(g.do, { player: p, ent: e }); }
      else this.room.broadcastEvent({ type: 'msg', text: g.onProgress.replace('{n}', st.progress), dur: 2.5 });
    } else {
      st.progress = 0;
      st.fails++;
      for (const id of Object.keys(this.valveState)) { this.valveState[id] = false; this.room.broadcastEvent({ type: 'valve', id, on: false }); }
      this.room.broadcastEvent({ type: 'sound', name: 'alarm', at: [e.x, e.z] });
      this.room.broadcastEvent({ type: 'msg', text: g.onFail, dur: 4 });
      this.room.noise(e.x, e.z, NOISE.fail, p, 'alarm');
      if (g.failLimit && st.fails >= g.failLimit && !st.failDone) { st.failDone = true; this.run(g.failDo, { player: p, ent: e }); }
    }
  }

  on_monitor(p, e) {
    const st = this.groups[e.group];
    const labels = st.order.map((id) => this.ents.get(id).label);
    this.room.toPlayer(p, 'note', { id: e.id, title: e.title, terminal: true,
      text: `PRESSURE EQUALIZATION SEQUENCE\n\nOpen the valves in this order:\n\n   1. ${labels[0]}\n   2. ${labels[1]}\n   3. ${labels[2]}\n   4. ${labels[3]}\n\nValve status: ${st.done ? 'EQUALIZED' : `${st.progress}/${labels.length} open`}\n\nWARNING: An incorrect sequence vents pressure LOUDLY.` });
    this.setFlag('readMonitor');
  }

  on_keypad(p, e, payload) {
    const st = this.groups[e.group];
    if (!st) return;
    if (st.done) return this.room.tell(p, 'The keypad shows a green light.');
    if (st.def.requires && !this.flags.has(st.def.requires)) return this.room.tell(p, st.def.failMsg || 'No power.');
    if (payload.code === undefined) return this.room.toPlayer(p, 'keypad', { id: e.id, digits: st.def.digits });
    if (String(payload.code) === st.code) {
      st.done = true;
      this.room.broadcastEvent({ type: 'sound', name: 'keycard', at: [e.x, e.z] });
      this.room.toPlayer(p, 'keypadResult', { ok: true });
      this.run(st.def.do, { player: p, ent: e });
    } else {
      this.room.broadcastEvent({ type: 'sound', name: 'denied', at: [e.x, e.z] });
      this.room.toPlayer(p, 'keypadResult', { ok: false });
      this.room.noise(e.x, e.z, 7, p, 'beep');
    }
  }

  on_lever(p, e) {
    const d = this.doors.get(e.door);
    if (!d) return;
    const solo = this.room.alivePlayers().length <= 1;
    const t = solo ? e.soloTime : e.time;
    this.switchState[e.id] = true;
    this.room.broadcastEvent({ type: 'switch', id: e.id, on: true });
    this.room.broadcastEvent({ type: 'sound', name: 'lever', at: [e.x, e.z] });
    this.room.broadcastEvent({ type: 'timer', label: 'GATE', until: t });
    this.room.tell(p, `The gate grinds open — ${t} seconds!`);
    this.setDoor(e.door, true, p);
    const token = (e._token = (e._token || 0) + 1);
    const tryClose = () => {
      if (e._token !== token) return;
      const de = this.ents.get(e.door);
      if (this.tileOccupied(de.tx, de.tz)) return this.after(0.5, tryClose);
      this.setDoor(e.door, false, null);
      this.switchState[e.id] = false;
      this.room.broadcastEvent({ type: 'switch', id: e.id, on: false });
    };
    this.after(t, tryClose);
  }

  on_console(p, e) {
    if (e.requires && !this.flags.has(e.requires)) return this.room.tell(p, e.failMsg);
    if (!this.trap) return;
    if (this.trap.sealed) return this.room.tell(p, 'The furnace roars.');
    if (this.flags.has(this.trap.armFlag)) return this.room.tell(p, 'ARMED. The chamber will seal when it detects him inside — and nobody else.');
    this.setFlag(this.trap.armFlag);
    this.room.broadcastEvent({ type: 'sound', name: 'powerup', at: [e.x, e.z] });
    this.room.broadcastEvent({ type: 'msg', text: 'INCINERATOR ARMED. Lure Thatch into the chamber, then get out.', dur: 6 });
    this.room.noise(e.x, e.z, 16, p, 'machine');
  }

  on_elevator(p, e) {
    if (this.departing) return;
    if (e.next === 'surface') {
      if (!this.flags.has('elevatorBack')) return this.room.tell(p, 'The panel is dead. The car is gone. Not until this is finished.');
      const alive = this.room.alivePlayers();
      const inside = alive.filter((q) => this.grid.cell(toTile(q.x), toTile(q.z)) === C.ELEVATOR);
      if (inside.length < alive.length) return this.room.tell(p, `Wait for everyone (${inside.length}/${alive.length}). Nobody gets left down here.`);
      this.departing = true;
      const d = this.doors.get('elevator_door');
      if (d) { d.locked = true; this.setDoor('elevator_door', false, p); }
      this.room.broadcastEvent({ type: 'sound', name: 'keycard', at: [e.x, e.z] });
      this.after(1.2, () => this.room.ending());
      return;
    }
    if (!e.next) return this.room.tell(p, 'The panel has no buttons going up. Not until this is finished.');
    if (!this.hasKey(p, e.key)) {
      const lvlName = e.key.replace('key_', '').toUpperCase();
      return this.room.tell(p, `The panel needs the ${lvlName} keycard.`);
    }
    const alive = this.room.alivePlayers();
    const inside = alive.filter((q) => !q.hidden && this.grid.cell(toTile(q.x), toTile(q.z)) === C.ELEVATOR);
    if (inside.length < alive.length) return this.room.tell(p, `Everyone has to be inside the elevator (${inside.length}/${alive.length}).`);
    const ceo = this.room.ceo;
    if (ceo && ceo.active && this.grid.cell(toTile(ceo.x), toTile(ceo.z)) === C.ELEVATOR) return this.room.tell(p, 'HE IS IN HERE.');
    this.departing = true;
    const d = this.doors.get('elevator_door');
    if (d) { d.locked = true; d.lock = 'script'; this.setDoor('elevator_door', false, p); }
    this.room.broadcastEvent({ type: 'sound', name: 'keycard', at: [e.x, e.z] });
    this.room.broadcastEvent({ type: 'elevator', phase: 'depart', next: e.next });
    this.after(4.2, () => this.room.changeFloor(e.next));
  }

  on_hide(p, e) {
    if (this.room.alivePlayers().some((q) => q.hidden === e.id)) return this.room.tell(p, 'Someone is already hiding in there.');
    p.hidden = e.id;
    p.hideNoise = false;
    p.preHide = { x: p.x, z: p.z };
    if (this.room.ceo) this.room.ceo.noticeHide(p, e.id);
    this.room.broadcastEvent({ type: 'hide', player: p.id, spot: e.id, on: true });
    this.room.noise(p.x, p.z, 3, p, 'hide');
  }

  leaveHide(p) {
    const e = this.ents.get(p.hidden);
    p.hidden = null;
    p._hidWhileSeen = false;
    if (e) {
      // Step out in front of the hiding spot, clear of its collision box (and of anything
      // else). Falls back to where the player stood before hiding.
      const pt = this.exitPoint(e, p.preHide);
      p.x = pt.x; p.z = pt.z; p.y = 0; p.vx = 0; p.vz = 0;
      p.grace = Math.max(p.grace || 0, 0.6);
      this.room.toPlayer(p, 'teleport', { x: p.x, y: 0, z: p.z, yaw: e.facing });
    }
    this.room.broadcastEvent({ type: 'hide', player: p.id, spot: e?.id, on: false });
    this.room.noise(p.x, p.z, 3, p, 'hide');
  }

  // Is a standing player (radius + margin) free of walls, closed doors and props here?
  spotFree(x, z, r = PLAYER.radius + 0.06) {
    const tx = toTile(x), tz = toTile(z);
    const c = this.grid.cell(tx, tz);
    if (c !== C.FLOOR && c !== C.ELEVATOR && !(c === C.DOOR && this.isDoorOpen(this.grid.doorAtTile(tx, tz)?.id))) return false;
    for (const b of this.grid.solidsNear(x, z, (id) => this.isDoorOpen(id))) {
      if (b.bottom > 1.7) continue; // vent ceilings
      const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return false;
    }
    return true;
  }

  exitPoint(e, preHide) {
    const f = e.facing || 0;
    const cands = [];
    for (const d of [1.35, 1.6, 1.9]) for (const side of [0, 0.35, -0.35]) {
      cands.push({ x: e.x + Math.sin(f) * d + Math.cos(f) * side, z: e.z + Math.cos(f) * d - Math.sin(f) * side });
    }
    if (preHide) cands.push(preHide);
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) cands.push({ x: tileCenter(e.tx + dx), z: tileCenter(e.tz + dz) });
    return cands.find((c) => this.spotFree(c.x, c.z)) || preHide || { x: e.x + Math.sin(f) * 1.35, z: e.z + Math.cos(f) * 1.35 };
  }

  // ---------------------------------------------------------------- per-tick
  update(dt) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at <= this.time) { const t = this.timers[i]; this.timers.splice(i, 1); t.fn(); }
    }
    const alive = this.room.alivePlayers();
    // Trigger zones
    for (const z of this.level.zones || []) {
      if (z.once && this.firedZones.has(z.id)) continue;
      if (z.requires && !this.flags.has(z.requires)) continue;
      const p = alive.find((q) => this.inRect(q, z.rect));
      if (p) { this.firedZones.add(z.id); this.run(z.do, { player: p }); }
    }
    // Hazards
    for (const h of this.level.hazards || []) {
      if (h.offFlag && this.flags.has(h.offFlag)) continue;
      for (const p of alive) {
        if (p.hidden || !this.inRect(p, h.rect)) continue;
        p.health -= h.dps * dt;
        p.lastHazard = this.time;
        if (p.health <= 0) this.room.killPlayer(p, 'gas');
      }
    }
    // Incinerator trap
    const ceo = this.room.ceo;
    if (this.trap && !this.trap.sealed && this.flags.has(this.trap.armFlag) && ceo && ceo.active && ceo.inRect(this.trap.zone)) {
      const playerInside = alive.some((p) => this.inRect(p, this.trap.zone));
      const doorTiles = this.trap.doors.map((id) => this.ents.get(id));
      const onDoor = alive.some((p) => doorTiles.some((d) => toTile(p.x) === d.tx && toTile(p.z) === d.tz));
      if (!playerInside && !onDoor) this.seal();
    }
  }

  seal() {
    this.trap.sealed = true;
    for (const id of this.trap.doors) {
      const d = this.doors.get(id);
      d.locked = true; d.lock = 'script';
      d.open = false;
      this.room.broadcastEvent({ type: 'door', id, open: false, locked: true });
    }
    const ceo = this.room.ceo;
    ceo.state = 'trapped'; ceo.action = null; ceo.path = null;
    this.room.broadcastEvent({ type: 'sound', name: 'slam' });
    this.room.broadcastEvent({ type: 'trap', sealed: true });
    this.room.broadcastEvent({ type: 'msg', text: 'CHAMBER SEALED. IGNITION.', dur: 5 });
    this.after(2.0, () => this.room.broadcastEvent({ type: 'sound', name: 'furnace' }));
    this.after(9.0, () => {
      this.setFlag('thatchDead');
      this.room.broadcastEvent({ type: 'say', who: 'you', text: "It's... it's over. He's gone." });
    });
    // The elevator that left you down here comes back for you.
    this.after(13.0, () => {
      const d = this.doors.get('elevator_door');
      if (d) { d.locked = false; d.lock = null; this.setDoor('elevator_door', true, null); }
      this.room.broadcastEvent({ type: 'sound', name: 'ding' });
      this.room.broadcastEvent({ type: 'msg', text: 'Somewhere behind you, an elevator chimes. Its doors slide open.', dur: 6 });
      this.setFlag('elevatorBack');
    });
  }

  inRect(p, [x1, z1, x2, z2]) {
    const tx = toTile(p.x), tz = toTile(p.z);
    return tx >= x1 && tx <= x2 && tz >= z1 && tz <= z2;
  }
}
