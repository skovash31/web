// Remote employees and the CEO: snapshot buffering + interpolation, rigs, flashlights,
// nameplates and spatial footsteps.
import * as THREE from 'three';
import { PlayerRig, MonsterRig, HumanRig } from './models.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { textTexture } from './textures.js';
import { toTile, C } from '../shared/grid.js';

const DELAY = 110; // ms of interpolation delay
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

class Buffer {
  constructor() { this.s = []; }
  push(t, v) { this.s.push({ t, ...v }); if (this.s.length > 30) this.s.shift(); }
  sample(t) {
    const s = this.s;
    if (!s.length) return null;
    if (t <= s[0].t) return s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].t <= t) {
        const a = s[i], b = s[i + 1];
        if (!b) return a;
        const k = (t - a.t) / (b.t - a.t);
        return { ...b, x: a.x + (b.x - a.x) * k, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAngle(a.yaw, b.yaw, k), pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * k };
      }
    }
    return s[0];
  }
  clear() { this.s.length = 0; }
}

export class Remotes {
  constructor(scene, audio, getSurface) {
    this.scene = scene;
    this.audio = audio;
    this.getSurface = getSurface;
    this.players = new Map();
    this.offset = null; // serverTime - localTime
    this.spots = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.SpotLight(0xfff1d8, 0, 26, 0.45, 0.5, 1.4);
      s.castShadow = false;
      scene.add(s); scene.add(s.target);
      this.spots.push(s);
    }
    this.ceo = null;
    this.ceoBuf = new Buffer();
    this.ceoActive = false;
  }

  serverNow() { return Date.now() + (this.offset ?? 0); }

  setRoster(list, myId) {
    for (const [id, r] of this.players) if (!list.some((p) => p.id === id) || id === myId) { this.scene.remove(r.rig.root); this.players.delete(id); }
    for (const p of list) {
      if (p.id === myId) continue;
      let r = this.players.get(p.id);
      if (!r) {
        const rig = new PlayerRig(PLAYER_COLORS[p.color] ?? 0xffffff);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(p.name, { w: 256, h: 64, bg: null, fg: '#' + (PLAYER_COLORS[p.color] ?? 0xffffff).toString(16).padStart(6, '0'), font: 'bold 34px Arial' }), depthTest: true, transparent: true }));
        tag.scale.set(0.9, 0.22, 1); tag.position.y = 2.05;
        rig.root.add(tag);
        this.scene.add(rig.root);
        r = { id: p.id, name: p.name, color: p.color, rig, buf: new Buffer(), state: null, stepPhase: 0, tag };
        this.players.set(p.id, r);
      }
      r.alive = p.alive !== false;
    }
  }

  clearBuffers() { for (const r of this.players.values()) r.buf.clear(); this.ceoBuf.clear(); this.lastForm = null; this.morph = 0; }

  ensureHuman() {
    if (!this.human) {
      this.human = new HumanRig();
      this.scene.add(this.human.root);
      // polished dress shoes on office carpet / tile
      this.human.stepCallback = (speed) => this.audio.play('heel', [this.human.root.position.x, this.human.root.position.z], speed);
    }
    return this.human;
  }

  ensureCeo() {
    if (!this.ceo) {
      this.ceo = new MonsterRig();
      this.scene.add(this.ceo.root);
      this.ceo.stepCallback = (speed) => {
        const at = [this.ceo.root.position.x, 0.2, this.ceo.root.position.z];
        if (this.ceo.crawl) this.audio.play('ventBang', [at[0], at[2]]); else this.audio.ceoStep(at, speed);
      };
    }
    return this.ceo;
  }

  push(snap, myId) {
    const off = snap.t - Date.now();
    this.offset = this.offset === null ? off : this.offset + (off - this.offset) * 0.05;
    for (const p of snap.p) {
      if (p.id === myId) continue;
      const r = this.players.get(p.id);
      if (r) r.buf.push(snap.t, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, f: p.f, h: p.h, hp: p.hp });
    }
    if (snap.c) { this.ceoBuf.push(snap.t, { x: snap.c.x, y: 0, z: snap.c.z, yaw: snap.c.yaw, st: snap.c.st, an: snap.c.an, sp: snap.c.sp, fm: snap.c.fm, bl: snap.c.bl || 0, cd: snap.c.cd || 0 }); }
    this.ceoActive = !!snap.ca;
  }

  update(dt, hideSpotPos) {
    const t = this.serverNow() - DELAY;
    let spotI = 0;
    for (const r of this.players.values()) {
      const s = r.buf.sample(t);
      if (!s) { r.rig.root.visible = false; continue; }
      const alive = !!(s.f & 16);
      const hidden = !!s.h;
      r.state = { ...s, alive, hidden, crouch: !!(s.f & 1), sprint: !!(s.f & 2), moving: !!(s.f & 4), flashlight: !!(s.f & 8) };
      r.rig.root.visible = !hidden;
      const prev = r.rig.root.position.clone();
      r.rig.root.position.set(s.x, s.y || 0, s.z);
      r.rig.root.rotation.y = s.yaw;
      const speed = prev.distanceTo(r.rig.root.position) / Math.max(dt, 1e-3);
      r.speed = (r.speed ?? 0) + (Math.min(speed, 7) - (r.speed ?? 0)) * Math.min(1, dt * 10);
      r.rig.update(dt, { speed: r.speed, crouch: r.state.crouch, pitch: s.pitch || 0, flashlight: r.state.flashlight, alive });
      r.rig.flash?.userData.setOn?.(r.state.flashlight && alive && !hidden);
      r.tag.visible = alive;
      // footsteps
      if (alive && !hidden && r.speed > 0.5) {
        const before = r.stepPhase;
        r.stepPhase += dt * (r.state.sprint ? 11 : r.state.crouch ? 5 : 7.5);
        if (Math.floor(before / Math.PI) !== Math.floor(r.stepPhase / Math.PI)) this.audio.footstep(this.getSurface(s.x, s.z), [s.x, 0.1, s.z], r.state.sprint ? 'sprint' : r.state.crouch ? 'crouch' : 'walk');
      }
      // flashlight beam
      if (r.state.flashlight && alive && !hidden && spotI < this.spots.length) {
        const sp = this.spots[spotI++];
        const eye = (r.state.crouch ? 0.95 : 1.5);
        sp.position.set(s.x + Math.sin(s.yaw) * 0.3, (s.y || 0) + eye, s.z + Math.cos(s.yaw) * 0.3);
        const cp = Math.cos(s.pitch || 0);
        sp.target.position.set(s.x + Math.sin(s.yaw) * cp * 8, (s.y || 0) + eye + Math.sin(s.pitch || 0) * 8, s.z + Math.cos(s.yaw) * cp * 8);
        sp.intensity = 30;
      }
    }
    for (; spotI < this.spots.length; spotI++) this.spots[spotI].intensity = 0;

    // CEO
    const c = this.ceoBuf.sample(t);
    if (c && this.ceoActive) {
      const human = c.fm === 'human';
      // human -> monster: the suit splits, he stretches, and the thing underneath steps out
      if (!human && this.lastForm === 'human') { this.morph = 1.0; this.onTransform?.(); }
      this.lastForm = c.fm;
      if (this.morph > 0) this.morph -= dt;
      const showHuman = human || this.morph > 0.45;
      if (showHuman) {
        const h = this.ensureHuman();
        h.root.visible = true;
        h.root.position.set(c.x, 0, c.z);
        h.root.rotation.y = c.yaw;
        if (this.morph > 0) {
          const k = 1 - (this.morph - 0.45) / 0.55;
          h.root.scale.set(1 + k * 0.25, 1 + k * 0.45, 1 + k * 0.25);
          h.root.position.x += (Math.random() - 0.5) * 0.12 * k; h.root.position.z += (Math.random() - 0.5) * 0.12 * k;
          h.root.rotation.z = (Math.random() - 0.5) * 0.3 * k;
          h.update(dt, 'kill', 0);
        } else { h.root.scale.set(1, 1, 1); h.root.rotation.z = 0; h.update(dt, c.an, c.sp || 0); }
      } else if (this.human) this.human.root.visible = false;
      if (!showHuman) {
        const rig = this.ensureCeo();
        rig.root.visible = true;
        rig.root.position.set(c.x, 0, c.z);
        rig.root.rotation.y = c.yaw;
        const grow = this.morph > 0 ? 0.8 + (1 - this.morph / 0.45) * 0.2 : 1;
        rig.root.scale.setScalar(grow);
        rig.crawl = !!this.grid && this.grid.cell(toTile(c.x), toTile(c.z)) === C.VENT;
        rig.update(dt, c.an, c.sp || 0);
      } else if (this.ceo) this.ceo.root.visible = false;
      this.ceoState = c;
      this.ceoRig = showHuman ? this.human : this.ceo;
    } else {
      if (this.ceo) this.ceo.root.visible = false;
      if (this.human) this.human.root.visible = false;
      this.ceoState = c && this.ceoActive ? c : null;
    }
    void hideSpotPos;
    // blinding flare on his face
    if (this.flare) {
      this.flareT -= dt;
      const rig = this.ceoRig;
      if (this.flareT <= 0 || !rig) { this.flare.visible = false; if (this.flareT <= 0) { this.scene.remove(this.flare); this.flare = null; } }
      else {
        rig.headWorldPos(this.flare.position);
        const k = this.flareT / 0.6;
        this.flare.visible = true;
        this.flare.material.opacity = Math.min(1, k * 1.4);
        this.flare.scale.setScalar(0.6 + (1 - k) * 1.8);
      }
    }
  }

  // Bright burst on Mr. Thatch's eyes when a flashlight blinds him.
  blindFlare() {
    if (!this.flare) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,240,1)'); grad.addColorStop(0.3, 'rgba(255,240,200,0.7)'); grad.addColorStop(1, 'rgba(255,230,180,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
      this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.scene.add(this.flare);
    }
    this.flareT = 0.6;
  }

  living() { return [...this.players.values()].filter((r) => r.state?.alive); }
}
