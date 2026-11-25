// A private lobby / game session for 1-4 players. Owns the floor, the CEO, the
// simulation tick and all networking for its members.
import { Floor } from './Floor.js';
import { CEO } from './CEO.js';
import { LEVELS, LEVEL_BY_ID } from '../shared/levels/index.js';
import { MAX_PLAYERS, TICK_RATE, PLAYER, NOISE, DIFFICULTIES, DEFAULT_DIFFICULTY } from '../shared/constants.js';
import { toTile, C, tileCenter } from '../shared/grid.js';
import { saveCheckpoint } from './saves.js';

const CARRY_KINDS = new Set(['battery', 'medkit']);
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
      Object.assign(p, { x: sp.x, y: 0, z: sp.z, vx: 0, vz: 0, alive: true, hidden: null, health: PLAYER.maxHealth, invuln: p.god ? 99999 : 3, grace: 2, frozen: false });
      p.yaw = Math.PI; // face out of the elevator / into the room
    }
    // Recreate carried consumables in the new floor's item table.
    const carry = consumables || this.lastCarry || {};
    for (const p of this.players.values()) {
      const kinds = carry[p.name] || [];
      p.inventory = [];
      for (const it of kinds) {
        const item = this.floor.createItem(it.kind, it.name);
        item.state = 'held'; item.holder = p.id;
        p.inventory.push(item.id);
      }
    }
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

  restoreConsumables(p) {
    const kinds = this.lastCarry?.[p.name] || [];
    for (const it of kinds) {
      const item = this.floor.createItem(it.kind, it.name);
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
      carry[p.name] = p.inventory.map((iid) => this.floor.items.get(iid)).filter((it) => it && CARRY_KINDS.has(it.kind)).map((it) => ({ kind: it.kind, name: it.name }));
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
    if (p.grace <= 0 && dist > PLAYER.sprintSpeed * elapsed * 1.8 + 1.0) {
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
      if (p.health >= PLAYER.maxHealth - 1) return this.tell(p, 'You are not hurt.');
      p.inventory.splice(idx, 1); it.state = 'used';
      p.health = Math.min(PLAYER.maxHealth, p.health + 60);
      this.tell(p, 'You patch yourself up.');
    } else return this.tell(p, 'You can\'t use that here. Find where it goes.');
    this.sendInventory(p);
  }

  handleDrop(p, itemId) {
    if (!p.alive || !this.floor || p.hidden) return;
    const idx = p.inventory.indexOf(itemId);
    if (idx < 0) return;
    const it = this.floor.items.get(itemId);
    p.inventory.splice(idx, 1);
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

  sendInventory(p) {
    if (!this.floor) return;
    p.socket.emit('inv', { items: p.inventory.map((iid) => this.floor.items.get(iid)).filter(Boolean).map((it) => ({ id: it.id, kind: it.kind, name: it.name, key: it.key })), health: p.health });
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
