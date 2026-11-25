// A private lobby / game session for 1-4 players. Owns the floor, the CEO, the
// simulation tick and all networking for its members.
import { Floor } from './Floor.js';
import { CEO } from './CEO.js';
import { LEVELS, LEVEL_BY_ID } from '../shared/levels/index.js';
import { MAX_PLAYERS, TICK_RATE, PLAYER, NOISE, DIFFICULTIES, DEFAULT_DIFFICULTY, STAPLER, COFFEE, MEDKIT } from '../shared/constants.js';
import { toTile, C, tileCenter } from '../shared/grid.js';
import { saveCheckpoint } from './saves.js';

const CARRY_KINDS = new Set(['battery', 'medkit', 'stapler', 'staples', 'coffee']);
// item fields that travel with carried items between floors
const carryOf = (it) => ({ kind: it.kind, name: it.name, ...(it.ammo !== undefined ? { ammo: it.ammo } : {}), ...(it.count !== undefined ? { count: it.count } : {}) });
const extrasOf = (c) => ({ ...(c.ammo !== undefined ? { ammo: c.ammo } : {}), ...(c.count !== undefined ? { count: c.count } : {}) });
const CLIENT_NOISES = { land: NOISE.land, flashlight: NOISE.flashlight, scream: NOISE.scream };

export class Room {
  constructor(code, io, opts = {}) {
    this.code = code;
    this.io = io;
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby';
    this.floorIndex = opts.save?.floorIndex ?? 0;
    this.save = opts.save || null;
    this.journal = opts.save?.journal ? [...opts.save.journal] : [];
    this.floor = null;
    this.ceo = null;
    this.interval = null;
    this.stats = { deaths: 0, started: 0, checkpoints: 0 };
    this.debug = !!opts.debug;
    this.transitioning = false;
    this.onEmpty = opts.onEmpty || (() => {});
    this.colorPool = [0, 1, 2, 3];
    this.settings = { waypoints: true, difficulty: DEFAULT_DIFFICULTY };
  }

  // ---------------------------------------------------------------- membership
  get full() { return this.players.size >= MAX_PLAYERS; }

  addPlayer(socket, name) {
    const color = this.colorPool.find((c) => ![...this.players.values()].some((p) => p.color === c)) ?? 0;
    const p = {
      id: socket.id, socket, name: (name || 'Employee').slice(0, 16), color,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0,
      crouch: false, sprint: false, moving: false, flashlight: false,
      alive: true, hidden: null, health: PLAYER.maxHealth, inventory: [], invuln: 0,
      stepTimer: 0, lastUpdate: Date.now(), grace: 2,
    };
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    socket.join(this.code);
    if (this.phase === 'playing' && this.floor) {
      // Late joiner: arrive at the floor's spawn.
      const sp = this.floor.spawnPoint(this.players.size - 1);
      Object.assign(p, sp, { y: 0 });
      p.invuln = 3;
      this.restoreConsumables(p);
      this.sendFloor(p);
      this.broadcastEvent({ type: 'msg', text: `${p.name} joined the shift.`, dur: 3 });
    }
    this.broadcastLobby();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.floor && p.inventory.length) this.floor.dropAll(p);
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this.players.keys().next().value || null;
    if (this.players.size === 0) { this.stop(); this.onEmpty(this); return; }
    this.broadcastEvent({ type: 'msg', text: `${p.name} left.`, dur: 3 });
    this.broadcastEvent({ type: 'left', id });
    this.broadcastLobby();
    if (this.phase === 'playing') this.checkAllDead();
  }

  lobbyState() {
    return {
      code: this.code, hostId: this.hostId, phase: this.phase,
      settings: this.settings,
      floorIndex: this.floorIndex, floorName: LEVELS[this.floorIndex].name, floorLabel: LEVELS[this.floorIndex].label,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };
  }

  // Host-only lobby settings (e.g. objective markers on/off).
  setSetting(byId, key, value) {
    if (byId !== this.hostId) return false;
    if (key === 'waypoints') this.settings.waypoints = !!value;
    else if (key === 'difficulty' && Object.hasOwn(DIFFICULTIES, value) && this.phase !== 'playing') this.settings.difficulty = value;
    else return false;
    this.broadcastLobby();
    return true;
  }

  broadcastLobby() { this.io.to(this.code).emit('lobby', this.lobbyState()); }

  // ---------------------------------------------------------------- lifecycle
  start(byId) {
    if (byId !== this.hostId) return false;
    if (this.phase === 'playing') return false;
    this.phase = 'playing';
    this.stats.started = Date.now();
    this.loadFloor(this.floorIndex, { fromSave: !!this.save });
    this.broadcastLobby();
    if (!this.interval) {
      let last = Date.now();
      this.interval = setInterval(() => {
        const now = Date.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        try { this.tick(dt); } catch (e) { console.error(`[room ${this.code}] tick error`, e); }
      }, 1000 / TICK_RATE);
    }
    return true;
  }

  stop() { if (this.interval) clearInterval(this.interval); this.interval = null; }

  loadFloor(index, { fromSave = false, consumables = null } = {}) {
    const level = LEVELS[index];
    this.floorIndex = index;
    this.cutscene = null;
    this.floor = new Floor(level, this, (Date.now() ^ (index * 7919)) >>> 0);
    this.ceo = level.ceo ? new CEO(this, this.floor, level.ceo, this.settings.difficulty) : null;
    let i = 0;
    for (const p of this.players.values()) {
      const sp = this.floor.spawnPoint(i++);
      Object.assign(p, { x: sp.x, y: 0, z: sp.z, vx: 0, vz: 0, alive: true, hidden: null, health: PLAYER.maxHealth, invuln: p.god ? 99999 : 3, grace: 2, frozen: false, reload: null, lastFire: 0, boostUntil: 0 });
      p.yaw = Math.PI; // face out of the elevator / into the room
    }
    // Recreate carried consumables in the new floor's item table.
    const carry = consumables || this.lastCarry || {};
    for (const p of this.players.values()) {
      const kinds = carry[p.name] || [];
      p.inventory = [];
      for (const it of kinds) {
        const item = this.floor.createItem(it.kind, it.name, extrasOf(it));
        item.state = 'held'; item.holder = p.id;
        p.inventory.push(item.id);
      }
    }
    for (const p of this.players.values()) this.ensureFlashlight(p);
    this.lastCarry = carry;
    // Checkpoint at the start of every floor.
    this.checkpoint = { floorIndex: index, journal: [...this.journal], carry };
    if (index > 0 || fromSave) {
      saveCheckpoint(this.code, { floorIndex: index, journal: this.journal, carry, levelName: level.name });
      this.stats.checkpoints++;
    }
    for (const p of this.players.values()) this.sendFloor(p);
    if (index > 0) this.broadcastEvent({ type: 'msg', text: 'Checkpoint saved.', dur: 2.5 });
    this.transitioning = false;
  }

  // Everyone carries a flashlight. It's an inventory item (so it can be held in either
  // hand) but it can never be dropped or lost.
  ensureFlashlight(p) {
    if (!this.floor) return;
    if (p.inventory.some((iid) => this.floor.items.get(iid)?.kind === 'flashlight')) return;
    const it = this.floor.createItem('flashlight', 'Flashlight');
    it.state = 'held'; it.holder = p.id;
    p.inventory.unshift(it.id);
  }

  restoreConsumables(p) {
    this.ensureFlashlight(p);
    const kinds = this.lastCarry?.[p.name] || [];
    for (const it of kinds) {
      const item = this.floor.createItem(it.kind, it.name, extrasOf(it));
      item.state = 'held'; item.holder = p.id; p.inventory.push(item.id);
    }
  }

  sendFloor(p) {
    p.socket.emit('floor', {
      floorIndex: this.floorIndex,
      state: this.floor.publicState(),
      you: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, health: p.health, alive: p.alive },
      players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, color: q.color, alive: q.alive })),
      journal: this.journal,
      ceo: this.ceo ? this.ceo.snapshot() : null,
      ceoActive: !!(this.ceo && this.ceo.active),
      ceoStaples: this.ceo && this.ceo.stunned ? this.ceo.staples : [],
      debug: this.debug,
    });
    this.sendInventory(p);
  }

  changeFloor(levelId) {
    const lvl = LEVEL_BY_ID[levelId];
    if (!lvl || this.transitioning) return;
    this.transitioning = true;
    const carry = {};
    for (const p of this.players.values()) {
      carry[p.name] = p.inventory.map((iid) => this.floor.items.get(iid)).filter((it) => it && CARRY_KINDS.has(it.kind)).map(carryOf);
    }
    this.loadFloor(lvl.index, { consumables: carry });
  }

  reloadCheckpoint() {
    const cp = this.checkpoint;
    this.journal = [...cp.journal];
    this.broadcastEvent({ type: 'reload' });
    this.loadFloor(cp.floorIndex, { consumables: cp.carry });
  }

  ending() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const secs = Math.round((Date.now() - this.stats.started) / 1000);
    this.broadcastEvent({ type: 'ending', time: secs, deaths: this.stats.deaths });
    saveCheckpoint(this.code, { floorIndex: 0, journal: this.journal, carry: {}, completed: true, levelName: 'Completed' });
    this.stop();
    this.floorIndex = 0;
    this.save = null;
    setTimeout(() => { this.phase = 'lobby'; this.floor = null; this.ceo = null; this.broadcastLobby(); }, 1000);
  }

  // ---------------------------------------------------------------- simulation
  alivePlayers() {
    const out = [];
    for (const p of this.players.values()) if (p.alive) out.push(p);
    return out;
  }

  tick(dt) {
    if (this.phase !== 'playing' || !this.floor || this.transitioning) return;
    for (const p of this.players.values()) {
      if (p.invuln > 0) p.invuln -= dt;
      if (p.grace > 0) p.grace -= dt;
      if (!p.alive) continue;
      // Footstep noise the CEO can hear.
      if (p.moving && !p.hidden) {
        p.stepTimer -= dt;
        if (p.stepTimer <= 0) {
          p.stepTimer = 0.45;
          const r = p.sprint ? NOISE.sprint : p.crouch ? NOISE.crouch : NOISE.walk;
          this.noise(p.x, p.z, r, p, 'step', true);
        }
      }
      // Slow health regeneration away from hazards.
      if (p.health < PLAYER.maxHealth && (this.floor.time - (p.lastHazard ?? -99)) > 5) p.health = Math.min(PLAYER.maxHealth, p.health + 2 * dt);
    }
    this.floor.update(dt);
    if (this.ceo) this.ceo.update(dt);
    if (this.phase !== 'playing') return;
    this.io.to(this.code).volatile.emit('snap', this.snapshot());
  }

  snapshot() {
    const ps = [];
    for (const p of this.players.values()) {
      ps.push({
        id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(2),
        f: (p.crouch ? 1 : 0) | (p.sprint ? 2 : 0) | (p.moving ? 4 : 0) | (p.flashlight ? 8 : 0) | (p.alive ? 16 : 0),
        h: p.hidden, hp: Math.round(p.health),
      });
    }
    const c = this.ceo;
    return {
      t: Date.now(), p: ps,
      c: c ? c.snapshot() : null,
      ca: c ? c.active : false,
      aw: c ? Object.fromEntries([...c.awareness.entries()].map(([k, v]) => [k, +v.toFixed(2)])) : null,
    };
  }

  handleState(p, s) {
    if (!p.alive || this.phase !== 'playing' || !this.floor || this.transitioning || p.frozen) return;
    if (typeof s !== 'object' || !s) return;
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    p.yaw = num(s.yaw, p.yaw); p.pitch = num(s.pitch, p.pitch);
    p.crouch = !!s.crouch; p.sprint = !!s.sprint; p.moving = !!s.moving;
    if (!!s.flashlight !== p.flashlight) { p.flashlight = !!s.flashlight; }
    if (p.hidden) { p.moving = false; return; }
    const nx = num(s.x, p.x), ny = num(s.y, p.y), nz = num(s.z, p.z);
    const now = Date.now();
    const elapsed = Math.max(0.05, (now - p.lastUpdate) / 1000);
    p.lastUpdate = now;
    const dist = Math.hypot(nx - p.x, nz - p.z);
    // Anti-teleport: reject moves faster than a sprint (with generous slack for jitter).
    const boost = p.boostUntil > now ? COFFEE.speed : 1;
    if (p.grace <= 0 && dist > PLAYER.sprintSpeed * boost * elapsed * 1.8 + 1.0) {
      p.socket.emit('teleport', { x: p.x, y: p.y, z: p.z });
      return;
    }
    // Must stand somewhere walkable.
    const c = this.floor.grid.cell(toTile(nx), toTile(nz));
    if (c === C.WALL || c === C.GLASS) { p.socket.emit('teleport', { x: p.x, y: p.y, z: p.z }); return; }
    p.vx = (nx - p.x) / elapsed; p.vz = (nz - p.z) / elapsed;
    p.x = nx; p.y = ny; p.z = nz;
  }

  handleNoise(p, type) {
    if (!p.alive || p.hidden) return;
    const r = CLIENT_NOISES[type];
    if (r) this.noise(p.x, p.z, p.crouch && type === 'land' ? r * 0.5 : r, p, type);
  }

  handleUse(p, itemId) {
    if (!p.alive || !this.floor) return;
    const idx = p.inventory.indexOf(itemId);
    if (idx < 0) return;
    const it = this.floor.items.get(itemId);
    if (!it) return;
    if (it.kind === 'battery') {
      p.inventory.splice(idx, 1); it.state = 'used';
      p.socket.emit('battery', { value: PLAYER.maxBattery });
      this.tell(p, 'Fresh battery in.');
    } else if (it.kind === 'medkit') {
      // heals, and the client refills stamina / clears exhaustion when it gets 'medkit'
      p.inventory.splice(idx, 1); it.state = 'used';
      p.health = Math.min(PLAYER.maxHealth, p.health + MEDKIT.heal);
      p.socket.emit('medkit', { health: p.health });
      this.noiseSound(p.x, p.z, 'medkit');
      this.tell(p, 'You patch yourself up and catch your breath.');
    } else if (it.kind === 'coffee') {
      p.inventory.splice(idx, 1); it.state = 'used';
      p.boostUntil = Date.now() + COFFEE.duration * 1000;
      p.socket.emit('boost', { dur: COFFEE.duration, speed: COFFEE.speed });
      this.noiseSound(p.x, p.z, 'slurp');
    } else if (it.kind === 'stapler') {
      return this.handleReload(p, it.id);
    } else if (it.kind === 'staples') {
      return this.handleReload(p);
    } else if (it.kind === 'flashlight') {
      return;
    } else return this.tell(p, 'You can\'t use that here. Find where it goes.');
    this.sendInventory(p);
  }

  // ---------------------------------------------------------------- the stapler
  stapleReserve(p) {
    return p.inventory.map((iid) => this.floor.items.get(iid)).filter((it) => it && it.kind === 'staples').reduce((n, it) => n + (it.count || 0), 0);
  }

  // Fire a staple from the player's eye along `dir`. The server decides hits; the shooter's
  // own raycast only tells it *where on the model* the staple should stick.
  handleFire(p, d = {}) {
    if (!p.alive || p.hidden || !this.floor || this.phase !== 'playing' || this.transitioning || p.frozen) return;
    const st = this.floor.items.get(String(d.id || ''));
    if (!st || st.kind !== 'stapler' || !p.inventory.includes(st.id)) return;
    if (p.reload) return this.toPlayer(p, 'ammo', { msg: 'Still reloading...' });
    const now = Date.now();
    if (now - (p.lastFire || 0) < STAPLER.fireInterval * 1000 - 30) return;
    if (!(st.ammo > 0)) return this.toPlayer(p, 'ammo', { msg: this.stapleReserve(p) ? 'Empty. Press R to reload.' : 'Out of staples. Find a box of staples.', dry: true });
    let dir = Array.isArray(d.dir) ? d.dir.map(Number) : null;
    if (!dir || dir.length !== 3 || dir.some((v) => !Number.isFinite(v))) return;
    const len = Math.hypot(...dir);
    if (len < 1e-6) return;
    dir = dir.map((v) => v / len);
    p.lastFire = now;
    st.ammo--;
    const eye = (p.y || 0) + (p.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand);
    const o = [p.x, eye, p.z];
    // how far the staple flies before hitting a wall, the floor or the ceiling
    const g = this.floor.grid, doorOpen = (id) => this.floor.isDoorOpen(id);
    let wall = STAPLER.range;
    for (let t = 0.2; t <= STAPLER.range; t += 0.1) {
      const x = o[0] + dir[0] * t, y = o[1] + dir[1] * t, z = o[2] + dir[2] * t;
      const c = g.cell(toTile(x), toTile(z));
      if (y <= 0.02 || y >= (c === C.VENT ? 1.15 : 3) || g.tileOpaque(toTile(x), toTile(z), doorOpen) && !(c === C.VENT && y < 1.15)) { wall = t; break; }
    }
    const c = this.ceo;
    let hit = null;
    if (c && c.canBeStapled()) {
      const slack = 0.18 + Math.min(0.45, c.speed * 0.1);
      const h = c.rayHit(o, dir, wall, slack);
      if (h && h.t <= wall && g.lineOfSight(p.x, p.z, h.point[0], h.point[2], doorOpen)) hit = h;
    }
    const to = hit ? hit.point : [o[0] + dir[0] * wall, o[1] + dir[1] * wall, o[2] + dir[2] * wall];
    let stuck = null;
    if (hit) {
      // where on the model to stick it: the shooter's precise hit if it is sane, else the volume hit
      const BONES = new Set(['Torso', 'Neck', 'Head', 'Arm_R', 'Arm_L', 'Forearm_R', 'Forearm_L', 'Leg_R', 'Leg_L', 'Shin_R', 'Shin_L']);
      const h = d.hit;
      const ok = h && BONES.has(h.bone) && [h.local, h.normal].every((v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && Math.abs(n) < 3));
      stuck = ok ? { bone: h.bone, local: h.local.map((n) => +n.toFixed(3)), normal: h.normal.map((n) => +n.toFixed(3)), form: c.form } : { bone: hit.part, local: hit.part === 'Head' ? [0, 0.22, 0.2] : [0, 0.4, 0.12], normal: [0, 0, 1], form: c.form };
    }
    const stunned = hit ? c.staple(p, stuck) : false;
    this.broadcastEvent({ type: 'staple', by: p.id, from: o.map((n) => +n.toFixed(2)), to: to.map((n) => +n.toFixed(2)), hit: !!hit, stuck, stunned });
    this.noise(p.x, p.z, STAPLER.noise, p, 'stapler');
    this.sendInventory(p);
  }

  // Reload takes exactly STAPLER.reloadTime seconds and needs staples to load.
  handleReload(p, staplerId = null) {
    if (!p.alive || !this.floor) return;
    if (p.reload) return;
    const held = p.inventory.map((iid) => this.floor.items.get(iid)).filter((it) => it && it.kind === 'stapler');
    const st = held.find((it) => it.id === staplerId) || held.find((it) => (it.ammo || 0) < STAPLER.magazine) || held[0];
    if (!st) return this.toPlayer(p, 'ammo', { msg: "You don't have a stapler." });
    if ((st.ammo || 0) >= STAPLER.magazine) return this.toPlayer(p, 'ammo', { msg: "It's already full." });
    if (!this.stapleReserve(p)) return this.toPlayer(p, 'ammo', { msg: 'No staples to load. Find a box of staples.', dry: true });
    const token = { stapler: st.id, floor: this.floor };
    p.reload = token;
    this.sendInventory(p, STAPLER.reloadTime);
    this.noiseSound(p.x, p.z, 'staplerOpen');
    this.floor.after(STAPLER.reloadTime, () => this.finishReload(p, token));
  }

  finishReload(p, token) {
    if (p.reload !== token) return;
    p.reload = null;
    const st = this.floor.items.get(token.stapler);
    if (!p.alive || !st || !p.inventory.includes(st.id) || this.floor !== token.floor) { this.sendInventory(p); return; }
    let need = STAPLER.magazine - (st.ammo || 0);
    for (const iid of [...p.inventory]) {
      const box = this.floor.items.get(iid);
      if (!box || box.kind !== 'staples' || need <= 0) continue;
      const take = Math.min(need, box.count || 0);
      box.count -= take; need -= take;
      st.ammo = (st.ammo || 0) + take;
      if (box.count <= 0) { p.inventory.splice(p.inventory.indexOf(iid), 1); box.state = 'used'; }
    }
    this.noiseSound(p.x, p.z, 'staplerLoad');
    this.sendInventory(p);
  }

  handleDrop(p, itemId) {
    if (!p.alive || !this.floor || p.hidden) return;
    const idx = p.inventory.indexOf(itemId);
    if (idx < 0) return;
    const it = this.floor.items.get(itemId);
    if (it.kind === 'flashlight') return this.tell(p, "You'll need that. You can't drop your flashlight.");
    p.inventory.splice(idx, 1);
    if (p.reload && (p.reload.stapler === it.id || it.kind === 'staples')) { p.reload = null; this.toPlayer(p, 'ammo', { msg: 'Reload cancelled.' }); }
    it.state = 'world'; it.holder = null;
    it.x = p.x + Math.sin(p.yaw) * 0.6; it.z = p.z + Math.cos(p.yaw) * 0.6; it.y = 0;
    const g = this.floor.grid;
    if (!g.isOpen(toTile(it.x), toTile(it.z))) { it.x = p.x; it.z = p.z; }
    this.floor.syncItemEntity(it);
    if (!this.floor.ents.has(it.id)) this.floor.ents.set(it.id, { id: it.id, type: 'item', x: it.x, z: it.z, tx: toTile(it.x), tz: toTile(it.z) });
    this.broadcastEvent({ type: 'item', item: this.floor.itemPublic(it) });
    this.sendInventory(p);
  }

  // Office finale: everyone piles into the restricted elevator while Thatch closes in,
  // reveals what he really is, and the doors shut in his face. Server-timed so every
  // client sees the same beats; the CEO walks the whole way (never teleports).
  elevatorEscape() {
    const f = this.floor, ceo = this.ceo;
    if (this.cutscene || !f) return;
    const door = f.entity('elevator_door');
    if (!door) return;
    this.cutscene = 'elevatorEscape';
    f.departing = true;
    for (const p of this.players.values()) p.frozen = true;
    let front = { x: door.x, z: door.z - 2 };
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (f.grid.cell(door.tx + dx, door.tz + dz) === C.FLOOR) { front = { x: tileCenter(door.tx + dx), z: tileCenter(door.tz + dz) }; break; }
    }
    this.broadcastEvent({ type: 'cutscene', id: 'elevatorEscape', phase: 'start', door: [door.x, door.z], front: [front.x, front.z] });
    f.after(0.55, () => {
      const tiles = f.grid.elevatorTiles.filter(([x, z]) => !f.grid.entities.some((e) => e.type === 'elevator' && e.tx === x && e.tz === z));
      let i = 0;
      for (const p of this.alivePlayers()) {
        const [tx, tz] = tiles[i++ % tiles.length];
        p.hidden = null;
        p.x = tileCenter(tx) + (Math.random() - 0.5) * 0.5; p.z = tileCenter(tz) + (Math.random() - 0.5) * 0.5; p.y = 0;
        p.yaw = Math.atan2(door.x - p.x, door.z - p.z);
        p.socket.emit('teleport', { x: p.x, y: 0, z: p.z, yaw: p.yaw });
      }
      const d = f.doors.get('elevator_door');
      d.locked = false; f.setDoor('elevator_door', true, null); d.locked = true; d.lock = 'script';
      if (ceo) { if (ceo.state === 'dormant') ceo.activate(); ceo.action = null; ceo.scriptMove(front.x, front.z, 4.0); }
    });
    const start = f.time;
    let transformed = false, tTrans = 0;
    const step = () => {
      if (this.cutscene !== 'elevatorEscape' || this.floor !== f) return;
      const t = f.time - start;
      const dist = ceo ? Math.hypot(ceo.x - door.x, ceo.z - door.z) : 99;
      const seesDoor = ceo && dist < 6.5 && f.grid.lineOfSight(ceo.x, ceo.z, door.x, door.z, (id) => f.isDoorOpen(id));
      if (!transformed && t > 1.5 && (seesDoor || t > 17)) {
        transformed = true; tTrans = t;
        if (ceo) { ceo.form = 'monster'; ceo.scriptMove(front.x, front.z, 4.6); ceo.doAction({ type: 'transform', face: door }, 2.1); }
        this.broadcastEvent({ type: 'cutscene', id: 'elevatorEscape', phase: 'transform' });
        if (ceo) this.noiseSound(ceo.x, ceo.z, 'roar');
      }
      if (transformed && t - tTrans > 3.0 && (dist < 2.9 || t > 22)) {
        f.setDoor('elevator_door', false, null);
        this.broadcastEvent({ type: 'cutscene', id: 'elevatorEscape', phase: 'closed' });
        this.broadcastEvent({ type: 'sound', name: 'slam' });
        if (ceo) ceo.doAction({ type: 'pound', face: door }, 4);
        f.after(2.6, () => this.broadcastEvent({ type: 'elevator', phase: 'depart', next: 'b1' }));
        f.after(6.6, () => { this.cutscene = null; this.changeFloor('b1'); });
        return;
      }
      f.after(0.1, step);
    };
    f.after(0.6, step);
  }

  killPlayer(p, cause) {
    if (!p.alive) return;
    p.alive = false;
    p.health = 0;
    p.reload = null;
    if (p.hidden) p.hidden = null;
    this.stats.deaths++;
    this.broadcastEvent({ type: 'death', id: p.id, name: p.name, cause, at: [p.x, p.z] });
    this.noise(p.x, p.z, NOISE.scream, null, 'scream');
    this.floor.dropAll(p);
    this.checkAllDead();
  }

  checkAllDead() {
    if (this.phase !== 'playing' || this.transitioning) return;
    if (this.players.size && this.alivePlayers().length === 0) {
      this.transitioning = true;
      this.broadcastEvent({ type: 'gameover' });
      setTimeout(() => { if (this.phase === 'playing') this.reloadCheckpoint(); }, 6500);
    }
  }

  // ---------------------------------------------------------------- messaging helpers
  broadcastEvent(evt) { this.io.to(this.code).emit('ev', evt); }
  toPlayer(p, name, data) { p.socket.emit(name, data); }
  tell(p, text) { p.socket.emit('ev', { type: 'msg', text, dur: 3, private: true }); }

  sendInventory(p, reloading = 0) {
    if (!this.floor) return;
    p.socket.emit('inv', {
      items: p.inventory.map((iid) => this.floor.items.get(iid)).filter(Boolean).map((it) => ({ id: it.id, kind: it.kind, name: it.name, key: it.key, ammo: it.ammo, count: it.count })),
      health: p.health,
      reloading,
    });
  }

  addJournal(id, title, text) {
    if (this.journal.some((j) => j.id === id)) return;
    const entry = { id, title, text };
    this.journal.push(entry);
    this.broadcastEvent({ type: 'journal', entry });
  }

  noise(x, z, radius, player, kind, quiet = false) {
    if (this.ceo) this.ceo.hear(x, z, radius, kind, player);
  }

  noiseSound(x, z, name) { this.broadcastEvent({ type: 'sound', name, at: [x, z] }); }

  chat(p, text) {
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return;
    this.io.to(this.code).emit('chat', { name: p.name, color: p.color, text: t, dead: !p.alive });
  }

  debugCmd(p, cmd) {
    if (!this.debug || !cmd) return;
    if (cmd.floor && LEVEL_BY_ID[cmd.floor]) { this.transitioning = false; this.changeFloor(cmd.floor); }
    if (cmd.flag && this.floor) this.floor.setFlag(cmd.flag);
    if (cmd.give && this.floor) { const it = this.floor.items.get(cmd.give); if (it) this.floor.pickup(p, it); }
    const GIVE = { stapler: 'Heavy-duty stapler', staples: 'Box of staples', medkit: 'First-aid kit', coffee: 'Cup of coffee', battery: 'Battery' };
    if (cmd.giveKind && this.floor && GIVE[cmd.giveKind]) {
      const it = this.floor.createItem(cmd.giveKind, GIVE[cmd.giveKind], cmd.giveKind === 'stapler' ? { ammo: Number(cmd.ammo) || 0 } : cmd.giveKind === 'staples' ? { count: STAPLER.perBox } : {});
      it.state = 'world'; it.x = p.x; it.z = p.z; this.floor.syncItemEntity(it);
      this.floor.pickup(p, it);
    }
    if (cmd.ceo && this.ceo) { if (cmd.ceo === 'activate') this.ceo.activate(); if (cmd.ceo === 'sleep') this.ceo.state = 'dormant'; }
    if (cmd.god === true) { p.invuln = 99999; p.god = true; }
    if (cmd.report) p.socket.emit('debugInfo', { difficulty: this.settings.difficulty, ceo: this.ceo ? { difficulty: this.ceo.difficulty, run: this.ceo.cfg.run, vents: !!this.floor.grid.ceoVents } : null, items: this.floor ? [...this.floor.items.values()].map((it) => ({ id: it.id, x: it.x, z: it.z })) : [] });
    if (cmd.god === false) { p.invuln = 0; p.god = false; }
    if (cmd.tp) { p.x = +cmd.tp.x; p.z = +cmd.tp.z; p.y = 0; p.grace = 0.6; p.socket.emit('teleport', { x: p.x, y: 0, z: p.z }); }
    if (cmd.ceoGoto && this.ceo) { this.ceo.state = 'investigate'; this.ceo.urgent = false; this.ceo.lastKnown = { ...cmd.ceoGoto }; this.ceo.setGoal(cmd.ceoGoto.x, cmd.ceoGoto.z); }
    if (cmd.kill) this.killPlayer(p, 'debug');
    if (cmd.ending) this.ending();
  }
}
