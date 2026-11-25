// Server-authoritative CEO monster AI.
// States: dormant -> patrol <-> investigate -> search -> chase -> kill.
// He only ever moves by walking along A* paths at bounded speed (no teleports),
// opens doors physically, can't fit through vents, and is synced to every client.
import { Grid, C, toTile, tileCenter } from '../shared/grid.js';

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export class CEO {
  constructor(room, floor, cfg) {
    this.room = room;
    this.floor = floor;
    this.grid = floor.grid;
    this.cfg = { catchRange: 1.15, detectRate: 1.5 + floor.level.index * 0.18, ...cfg };
    const sp = this.grid.entities.find((e) => e.type === 'ceoSpawn');
    this.x = sp ? sp.x : tileCenter(1);
    this.z = sp ? sp.z : tileCenter(1);
    this.yaw = 0;
    this.speed = 0;
    this.state = cfg.active ? 'patrol' : 'dormant';
    this.anim = 'idle';
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;
    this.repath = 0;
    this.pause = 0;
    this.target = null;
    this.lastKnown = null;
    this.lostTimer = 0;
    this.searchTimer = 0;
    this.searchPoints = [];
    this.checkedSpots = new Set();
    this.awareness = new Map();
    this.sawHide = new Map(); // spotId -> playerId
    this.actionTimer = 0;
    this.action = null;   // {type:'door'|'kill'|'roar'|'check', ...}
    this.huntTimer = cfg.huntInterval || 0;
    this.stuck = 0;
    this.lastPos = [this.x, this.z];
    this.lookTimer = 0;
    this.lookBase = 0;
    this.rng = Math.random;
    this.form = cfg.form || 'monster'; // 'human' until he reveals himself
    this.scriptSpeed = 0;
    this.doorPassable = (id) => this.floor.ceoCanPass(id);
    this.doorOpen = (id) => this.floor.isDoorOpen(id);
  }

  get active() { return this.state !== 'dormant'; }

  activate() {
    if (this.state !== 'dormant') return;
    this.state = 'patrol';
    this.room.broadcastEvent({ type: 'ceo', what: 'awake', form: this.form });
    if (this.form === 'monster') this.room.noiseSound(this.x, this.z, 'roar');
  }

  forceChase(player) {
    if (!player) return;
    if (this.state === 'dormant') this.activate();
    this.startChase(player, true);
    this.awareness.set(player.id, 1);
  }

  snapshot() {
    return { x: +this.x.toFixed(2), z: +this.z.toFixed(2), yaw: +this.yaw.toFixed(3), st: this.state, an: this.anim, sp: +this.speed.toFixed(2), fm: this.form };
  }

  // Cutscene control: walk (never teleport) to a point at a given speed, ignoring players.
  scriptMove(x, z, speed) {
    this.state = 'scripted';
    this.scriptSpeed = speed;
    this.target = null;
    this.setGoal(x, z);
  }

  // ---------------------------------------------------------------- perception
  canSee(p) {
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > this.cfg.vision + 2) return { seen: false, d };
    if (!this.grid.lineOfSight(this.x, this.z, p.x, p.z, this.doorOpen)) return { seen: false, d };
    const ang = Math.abs(wrap(Math.atan2(dx, dz) - this.yaw));
    const inFov = ang < (this.cfg.fov * Math.PI / 180) / 2;
    const lit = this.floor.lights !== 'emergency' && this.floor.lights !== 'off' && this.floor.lights !== 'dim';
    let range = lit ? this.cfg.vision * 0.72 : this.cfg.darkVision;
    if (p.flashlight) range = this.cfg.vision;
    if (p.crouch) range *= 0.6;
    if (p.sprint) range *= 1.15;
    // A flashlight beam pointed at him is visible from any direction.
    let beam = false;
    if (p.flashlight && d < this.cfg.vision) {
      const toCeo = Math.atan2(-dx, -dz);
      if (Math.abs(wrap(toCeo - p.yaw)) < 0.45) beam = true;
    }
    const close = d < 1.9;
    return { seen: (inFov && d < range) || beam || close, d, range, close, beam };
  }

  perceive(dt) {
    let best = null, bestA = 0;
    for (const p of this.room.alivePlayers()) {
      let a = this.awareness.get(p.id) || 0;
      if (p.hidden) { a = Math.max(0, a - 0.3 * dt); this.awareness.set(p.id, a); continue; }
      const v = this.canSee(p);
      if (v.seen) {
        if (v.close) a = 1;
        else {
          const prox = 1 - Math.min(1, v.d / Math.max(1, v.range || this.cfg.vision));
          let gain = this.cfg.detectRate * (0.35 + prox * 1.6);
          if (p.moving) gain *= 1.3;
          if (v.beam) gain *= 1.4;
          if (this.state === 'chase' || this.state === 'search') gain *= 2.2;
          a = Math.min(1, a + gain * dt);
        }
        p._seenByCeo = true;
      } else {
        a = Math.max(0, a - 0.12 * dt);
        p._seenByCeo = false;
      }
      this.awareness.set(p.id, a);
      if (a > bestA) { bestA = a; best = p; }
    }
    return { best, bestA };
  }

  // Called by the room whenever a sound is made.
  hear(x, z, radius, kind, sourcePlayer) {
    if (!this.active || this.state === 'trapped' || this.state === 'scripted' || (this.action && this.action.type === 'kill')) return;
    const d = Math.hypot(x - this.x, z - this.z);
    let eff = radius * this.cfg.hearing;
    if (!this.grid.lineOfSight(this.x, this.z, x, z, this.doorOpen)) eff *= 0.62;
    if (d > eff) return;
    if (this.state === 'chase') {
      if (sourcePlayer && sourcePlayer.id === this.target) this.lastKnown = { x, z };
      return;
    }
    const jitter = Math.min(3, d * 0.12);
    const tx = x + (this.rng() - 0.5) * jitter * 2, tz = z + (this.rng() - 0.5) * jitter * 2;
    // Louder or closer sounds override the current investigation.
    const prio = radius / Math.max(1, d);
    if (this.state === 'investigate' && this.investPrio > prio * 1.2) return;
    this.investPrio = prio;
    this.investigate(tx, tz, radius >= 14);
  }

  // ---------------------------------------------------------------- behaviours
  setGoal(x, z) {
    let tx = toTile(x), tz = toTile(z);
    if (!this.grid.ceoWalkable(tx, tz, this.doorPassable)) {
      const n = this.nearestWalkable(tx, tz, 3);
      if (!n) return false;
      [tx, tz] = n;
    }
    const sx = toTile(this.x), sz = toTile(this.z);
    const raw = this.grid.findPath(sx, sz, tx, tz, this.doorPassable);
    if (!raw) return false;
    this.goal = [tx, tz];
    this.path = this.smooth(raw.map(([px, pz]) => ({ x: tileCenter(px), z: tileCenter(pz), tx: px, tz: pz })));
    // when the goal is a precise point inside the final tile, aim at it
    if (Math.hypot(x - tileCenter(tx), z - tileCenter(tz)) < 1.0 && this.path.length) {
      const last = this.path[this.path.length - 1];
      last.x = x; last.z = z;
    }
    this.pathIdx = 0;
    return true;
  }

  smooth(pts) {
    if (pts.length <= 2) return pts.slice(1).length ? pts.slice(1) : pts;
    const out = [];
    let i = 0;
    let cur = { x: this.x, z: this.z };
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      // never skip door tiles: they must be visited so the door gets opened
      for (let k = i + 1; k < pts.length; k++) {
        if (this.grid.cell(pts[k].tx, pts[k].tz) === C.DOOR) { j = Math.min(j, k); break; }
      }
      while (j > i + 1 && !this.grid.segmentWalkable(cur.x, cur.z, pts[j].x, pts[j].z, this.doorPassable)) j--;
      out.push(pts[j]);
      cur = pts[j];
      i = j;
    }
    return out;
  }

  nearestWalkable(tx, tz, r) {
    let best = null, bd = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = tx + dx, z = tz + dz;
      if (!this.grid.ceoWalkable(x, z, this.doorPassable)) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = [x, z]; }
    }
    return best;
  }

  patrol() {
    this.state = 'patrol';
    this.target = null;
    const players = this.room.alivePlayers();
    let pick = null;
    // Higher floors: patrols drift toward where the employees are.
    const drift = Math.min(0.6, this.floor.level.index * 0.12);
    for (let i = 0; i < 25 && !pick; i++) {
      let cand;
      if (players.length && this.rng() < drift) {
        const p = players[Math.floor(this.rng() * players.length)];
        cand = [toTile(p.x) + Math.round((this.rng() - 0.5) * 12), toTile(p.z) + Math.round((this.rng() - 0.5) * 12)];
      } else cand = this.grid.randomFloorTile(this.rng);
      if (!cand || !this.grid.ceoWalkable(cand[0], cand[1], this.doorPassable)) continue;
      const d = Math.hypot(tileCenter(cand[0]) - this.x, tileCenter(cand[1]) - this.z);
      if (d < 8) continue;
      if (this.setGoal(tileCenter(cand[0]), tileCenter(cand[1]))) pick = cand;
    }
    if (!pick) this.pause = 1.5;
  }

  investigate(x, z, urgent) {
    if (this.state === 'chase') return;
    this.state = 'investigate';
    this.urgent = urgent;
    this.lastKnown = { x, z };
    if (!this.setGoal(x, z)) { this.startSearch(this.x, this.z); return; }
    this.pause = 0;
    this.room.broadcastEvent({ type: 'ceo', what: 'investigate' });
  }

  startSearch(x, z) {
    this.state = 'search';
    this.searchTimer = this.cfg.searchTime;
    this.checkedSpots.clear();
    this.searchPoints = [];
    const cx = toTile(x), cz = toTile(z);
    for (let i = 0; i < 6; i++) {
      const tx = cx + Math.round((this.rng() - 0.5) * 9), tz = cz + Math.round((this.rng() - 0.5) * 9);
      if (this.grid.ceoWalkable(tx, tz, this.doorPassable)) this.searchPoints.push([tileCenter(tx), tileCenter(tz)]);
    }
    // Hiding places close to where he lost you get priority.
    const spots = this.floor.hideSpots().filter((s) => Math.hypot(s.x - x, s.z - z) < 9).sort(() => this.rng() - 0.5).slice(0, 3);
    for (const s of spots) this.searchPoints.splice(Math.floor(this.rng() * (this.searchPoints.length + 1)), 0, [s.x, s.z, s.id]);
    this.path = null;
    this.nextSearchPoint();
  }

  nextSearchPoint() {
    while (this.searchPoints.length) {
      const [x, z, spot] = this.searchPoints.shift();
      this.searchSpot = spot || null;
      if (this.setGoal(x, z)) return true;
    }
    this.searchSpot = null;
    return false;
  }

  startChase(player, instant) {
    const wasChasing = this.state === 'chase';
    this.state = 'chase';
    this.target = player.id;
    this.lastKnown = { x: player.x, z: player.z };
    this.lostTimer = 0;
    this.repath = 0;
    if (!wasChasing) {
      this.room.broadcastEvent({ type: 'ceo', what: 'chase', target: player.id, form: this.form });
      const d = Math.hypot(player.x - this.x, player.z - this.z);
      if (this.form === 'monster') {
        if (!instant && d > 6) this.doAction({ type: 'roar' }, 0.9);
        this.room.noiseSound(this.x, this.z, 'roar');
      }
    }
  }

  doAction(action, t) { this.action = action; this.actionTimer = t; }

  // ---------------------------------------------------------------- main update
  update(dt) {
    if (this.state === 'dormant') { this.anim = 'idle'; this.speed = 0; return; }
    if (this.state === 'trapped') { this.anim = 'burn'; this.speed = 0; this.yaw += dt * 3; return; }

    // Ongoing timed action (opening a door, roaring, killing, checking a locker)
    if (this.action) {
      this.actionTimer -= dt;
      this.speed = 0;
      this.anim = this.action.type === 'door' ? 'open' : this.action.type;
      if (this.action.face) this.turnTo(this.action.face, dt, 6);
      if (this.actionTimer <= 0) {
        const a = this.action; this.action = null;
        this.finishAction(a);
      }
      return;
    }

    if (this.state === 'scripted') {
      if (!this.followPath(dt, this.scriptSpeed)) { this.speed = 0; this.anim = 'idle'; }
      return;
    }

    const { best, bestA } = this.perceive(dt);
    this.tryCatch();
    if (this.action) return;

    // Hunting instinct: periodically home in on someone's rough location.
    if (this.cfg.huntInterval && (this.state === 'patrol')) {
      this.huntTimer -= dt;
      if (this.huntTimer <= 0) {
        this.huntTimer = this.cfg.huntInterval * (0.7 + this.rng() * 0.6);
        const ps = this.room.alivePlayers();
        if (ps.length) {
          const p = ps[Math.floor(this.rng() * ps.length)];
          this.investigate(p.x + (this.rng() - 0.5) * 8, p.z + (this.rng() - 0.5) * 8, false);
        }
      }
    }

    if (this.state === 'chase') this.updateChase(dt);
    else {
      if (best && bestA >= 1) this.startChase(best, false);
      else if (best && bestA >= 0.4 && best._seenByCeo && this.state !== 'investigate') this.investigate(best.x, best.z, false);
      else if (best && bestA >= 0.4 && best._seenByCeo && this.state === 'investigate') { this.lastKnown = { x: best.x, z: best.z }; this.repathTo(best.x, best.z, dt); }
    }
    if (this.action) return;

    switch (this.state) {
      case 'patrol':
        if (this.pause > 0) { this.pause -= dt; this.look(dt); if (this.pause <= 0) this.patrol(); break; }
        if (!this.followPath(dt, this.cfg.walk)) {
          this.pause = 1 + this.rng() * 2.5; this.lookBase = this.yaw; this.lookTimer = 0;
          this.path = null;
        }
        break;
      case 'investigate':
        if (!this.followPath(dt, this.urgent ? this.cfg.walk * 1.7 : this.cfg.walk * 1.25)) this.startSearch(this.lastKnown?.x ?? this.x, this.lastKnown?.z ?? this.z);
        break;
      case 'search':
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) { this.patrol(); break; }
        if (this.pause > 0) { this.pause -= dt; this.look(dt); break; }
        if (!this.followPath(dt, this.cfg.search)) {
          if (this.searchSpot) { this.checkHideSpot(this.searchSpot); this.searchSpot = null; break; }
          this.pause = 1.2 + this.rng() * 1.5; this.lookBase = this.yaw; this.lookTimer = 0;
          if (!this.nextSearchPoint()) this.searchPoints.push(...[[this.x + (this.rng() - 0.5) * 10, this.z + (this.rng() - 0.5) * 10]]);
        }
        break;
    }
    this.checkStuck(dt);
  }

  repathTo(x, z, dt) {
    this.repath -= dt;
    if (this.repath > 0) return;
    this.repath = 0.6;
    this.setGoal(x, z);
  }

  updateChase(dt) {
    const p = this.room.players.get(this.target);
    if (!p || !p.alive) { this.startSearch(this.x, this.z); return; }
    if (p.hidden) {
      // Saw them hide? Go straight there.
      if (this.sawHide.get(p.hidden) === p.id || p._hidWhileSeen) {
        const spot = this.floor.entity(p.hidden);
        if (spot) {
          if (Math.hypot(spot.x - this.x, spot.z - this.z) < 2.6) { this.checkHideSpot(spot.id, true); return; }
          this.repathTo(spot.x, spot.z, dt);
          this.followPath(dt, this.cfg.run);
          return;
        }
      }
      this.startSearch(this.lastKnown.x, this.lastKnown.z);
      return;
    }
    const v = this.canSee(p);
    if (v.seen || v.d < 2.5) {
      this.lastKnown = { x: p.x, z: p.z, vx: p.vx || 0, vz: p.vz || 0 };
      this.lostTimer = 0;
    } else {
      this.lostTimer += dt;
      if (this.lostTimer > this.cfg.chaseLose) {
        const lk = this.lastKnown;
        this.room.broadcastEvent({ type: 'ceo', what: 'lost' });
        this.startSearch(lk.x + (lk.vx || 0) * 1.5, lk.z + (lk.vz || 0) * 1.5);
        return;
      }
    }
    // Direct pursuit when in open line, otherwise path.
    const directOK = v.seen && this.grid.segmentWalkable(this.x, this.z, p.x, p.z, this.doorPassable, 0.4);
    if (directOK) {
      this.path = [{ x: p.x, z: p.z, tx: toTile(p.x), tz: toTile(p.z) }];
      this.pathIdx = 0;
    } else {
      this.repath -= dt;
      if (this.repath <= 0 || !this.path) {
        this.repath = 0.4;
        const tgt = v.seen ? p : this.lastKnown;
        if (!this.setGoal(tgt.x, tgt.z)) this.path = null;
      }
    }
    if (!this.followPath(dt, this.cfg.run) && !v.seen) {
      // Reached last known position without seeing them: lose faster.
      this.lostTimer += dt * 2;
      this.look(dt);
    }
  }

  checkHideSpot(spotId, certain = false) {
    if (this.checkedSpots.has(spotId) && !certain) return;
    this.checkedSpots.add(spotId);
    const spot = this.floor.entity(spotId);
    if (!spot) return;
    const sawIt = this.sawHide.get(spotId);
    const occupant = this.room.alivePlayers().find((p) => p.hidden === spotId);
    const chance = this.cfg.hideCheck + (occupant && occupant.hideNoise ? 0.25 : 0);
    if (certain || sawIt || this.rng() < chance) {
      this.doAction({ type: 'check', spot: spotId, face: spot }, 1.4);
      this.room.broadcastEvent({ type: 'hideCheck', spot: spotId });
    }
  }

  finishAction(a) {
    if (a.type === 'door') {
      this.floor.setDoor(a.door, true, null);
    } else if (a.type === 'check') {
      const occupant = this.room.alivePlayers().find((p) => p.hidden === a.spot);
      this.sawHide.delete(a.spot);
      if (occupant) {
        this.room.killPlayer(occupant, 'ceo');
        this.doAction({ type: 'kill', face: occupant }, 2.6);
      }
    } else if (a.type === 'kill') {
      const others = this.room.alivePlayers();
      if (others.length) this.startSearch(this.x, this.z);
      else this.patrol();
    }
  }

  tryCatch() {
    for (const p of this.room.alivePlayers()) {
      if (p.hidden || p.invuln > 0) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < this.cfg.catchRange && Math.abs(p.y) < 1.4 && this.grid.lineOfSight(this.x, this.z, p.x, p.z, this.doorOpen)) {
        // Can't reach players inside vents
        if (this.grid.cell(toTile(p.x), toTile(p.z)) === C.VENT) continue;
        this.room.killPlayer(p, 'ceo');
        this.doAction({ type: 'kill', face: p }, 2.6);
        return;
      }
    }
  }

  // Record that a player was watched hiding. Called by the floor when someone hides.
  noticeHide(player, spotId) {
    if (!this.active) return;
    const a = this.awareness.get(player.id) || 0;
    const v = this.canSee(player);
    if ((v.seen && a > 0.3) || (this.state === 'chase' && this.target === player.id && v.seen)) {
      this.sawHide.set(spotId, player.id);
      player._hidWhileSeen = true;
    } else player._hidWhileSeen = false;
  }

  // Walk the current path. Returns false when there is no path / it's complete.
  followPath(dt, maxSpeed) {
    if (!this.path || this.pathIdx >= this.path.length) { this.speed = Math.max(0, this.speed - dt * 6); this.anim = 'idle'; return false; }
    const wp = this.path[this.pathIdx];
    // Door handling: if the next waypoint (or the tile we're entering) is a closed door, open it first.
    const ahead = this.doorAhead(wp);
    if (ahead) {
      if (!this.floor.ceoCanPass(ahead.id)) { this.path = null; return false; }
      if (!this.floor.isDoorOpen(ahead.id)) {
        this.doAction({ type: 'door', door: ahead.id, face: ahead }, this.floor.doors.get(ahead.id)?.heavy ? 1.2 : 0.7);
        return true;
      }
    }
    const dx = wp.x - this.x, dz = wp.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) { this.pathIdx++; return this.pathIdx < this.path.length || this.followPath(dt, maxSpeed); }
    const target = Math.atan2(dx, dz);
    this.turnTo({ x: wp.x, z: wp.z }, dt, this.state === 'chase' ? 7 : 4);
    // Slow down for sharp turns so he rounds corners naturally.
    const turnPenalty = Math.max(0.35, Math.cos(Math.min(Math.PI / 2, Math.abs(wrap(target - this.yaw)))));
    const want = maxSpeed * turnPenalty;
    this.speed += Math.sign(want - this.speed) * Math.min(Math.abs(want - this.speed), dt * (this.state === 'chase' ? 7 : 3));
    const step = Math.min(d, this.speed * dt);
    this.x += (dx / d) * step;
    this.z += (dz / d) * step;
    this.anim = this.speed > 3 ? 'run' : this.speed > 0.2 ? 'walk' : 'idle';
    return true;
  }

  doorAhead(wp) {
    const tx = toTile(this.x), tz = toTile(this.z);
    const wx = toTile(wp.x), wz = toTile(wp.z);
    const dirx = Math.sign(wp.x - this.x), dirz = Math.sign(wp.z - this.z);
    // check the waypoint tile and the next tile in the direction of travel
    for (const [cx, cz] of [[wx, wz], [toTile(this.x + dirx * 1.1), toTile(this.z + dirz * 1.1)]]) {
      if (cx === tx && cz === tz) continue;
      if (Math.abs(cx - tx) > 1 || Math.abs(cz - tz) > 1) continue;
      const door = this.grid.doorAtTile(cx, cz);
      if (door) return door;
    }
    return null;
  }

  turnTo(pt, dt, rate) {
    const target = Math.atan2(pt.x - this.x, pt.z - this.z);
    const diff = wrap(target - this.yaw);
    this.yaw = wrap(this.yaw + Math.sign(diff) * Math.min(Math.abs(diff), rate * dt));
  }

  look(dt) {
    this.lookTimer += dt;
    this.yaw = wrap(this.lookBase + Math.sin(this.lookTimer * 1.3) * 1.1);
    this.anim = 'search';
    this.speed = 0;
  }

  checkStuck(dt) {
    const moved = Math.hypot(this.x - this.lastPos[0], this.z - this.lastPos[1]);
    if (this.path && this.speed > 0.3 && moved < 0.02) {
      this.stuck += dt;
      if (this.stuck > 1.5) {
        this.stuck = 0;
        // snap back to the centre of the current tile (a tiny correction, never a jump) and repath
        const cx = tileCenter(toTile(this.x)), cz = tileCenter(toTile(this.z));
        if (Math.hypot(cx - this.x, cz - this.z) < 1.2) { this.x += (cx - this.x) * 0.3; this.z += (cz - this.z) * 0.3; }
        if (this.goal) this.setGoal(tileCenter(this.goal[0]), tileCenter(this.goal[1]));
        else this.patrol();
      }
    } else this.stuck = 0;
    this.lastPos = [this.x, this.z];
  }

  inRect([x1, z1, x2, z2]) {
    const tx = toTile(this.x), tz = toTile(this.z);
    return tx >= x1 && tx <= x2 && tz >= z1 && tz <= z2;
  }
}
