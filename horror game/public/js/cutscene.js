// In-engine cutscenes: letterboxing, a scripted Mr. Thatch cameo, and the camera for the
// server-timed elevator escape. Gameplay keeps running underneath for everyone else.
import * as THREE from 'three';
import { HumanRig } from './models.js';
import { tileCenter } from '../shared/grid.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const ease = (t) => t * t * (3 - 2 * t);

export class Cutscenes {
  constructor({ scene, camera, world, me, story, audio, ui }) {
    Object.assign(this, { scene, camera, world, me, story, audio, ui });
    this.active = null;     // id of the running cutscene
    this.lockControls = false;
    this.cameraOverride = false;
    this.bars = document.getElementById('letterbox');
  }

  letterbox(on) { this.bars.classList.toggle('on', on); document.body.classList.toggle('cinematic', on); }

  stop() {
    if (this.npc) { this.scene.remove(this.npc.root); this.npc = null; }
    this.active = null; this.lockControls = false; this.cameraOverride = false;
    this.letterbox(false);
    this.timeline = null;
  }

  // ---------------------------------------------------------------- Thatch meets the team
  // Plays when the quarterly report lands in Pruitt's inbox. Mr. Thatch, in his human
  // disguise, steps out of Pruitt's office, collects it and introduces himself.
  thatchMeet() {
    if (this.active) return;
    const w = this.world;
    const door = w.ents.get('pruitt_door'), inbox = w.ents.get('inbox');
    if (!door || !inbox) return;
    this.stop();
    this.active = 'thatchMeet';
    this.npc = new HumanRig();
    this.scene.add(this.npc.root);
    const inside = { x: door.x + 2.6, z: door.z };
    const spot = { x: inbox.x - 0.2, z: inbox.z - 1.6 };
    this.npc.root.position.set(inside.x, 0, inside.z);
    this.npc.root.rotation.y = -Math.PI / 2;
    // Only players who can actually see the spot get the camera moment.
    const cam = this.camera.position;
    const sees = this.me.alive && !this.me.hidden && Math.hypot(cam.x - spot.x, cam.z - spot.z) < 17 && w.grid.lineOfSight(cam.x, cam.z, spot.x, spot.z, (id) => w.doorOpen(id) || id === 'pruitt_door');
    this.watching = sees;
    if (sees) { this.lockControls = true; this.letterbox(true); }
    this.t = 0;
    let anim = 'idle', speed = 0;
    const walk = (from, to, t0, t1, t) => {
      const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      this.npc.root.position.set(from.x + (to.x - from.x) * k, 0, from.z + (to.z - from.z) * k);
      if (k > 0 && k < 1) { this.npc.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z); speed = 1.6; anim = 'walk'; }
      return k;
    };
    const lines = [
      [0.4, 'thatch', 'Ah. Is that the quarterly report?'],
      [3.4, 'thatch', "Splendid. Cornelius Thatch — I don't believe we've met."],
      [7.4, 'thatch', 'I make a point of knowing every employee. Especially the ones with... initiative.'],
      [12.2, 'thatch', "Don't stay too late tonight. The building gets... lonely."],
      [18.0, 'you', "That was the CEO? Something about that smile..."],
    ];
    w.setDoorVisual('pruitt_door', true);
    this.audio.play('door', [door.x, door.z]);
    this.timeline = (dt) => {
      const t = (this.t += dt);
      speed = 0; anim = 'idle';
      for (const l of lines) if (!l.done && t >= l[0]) { l.done = true; this.story.say(l[1], l[2], { priority: true }); }
      if (t < 2.4) walk(inside, spot, 0, 2.4, t);
      else if (t < 4.0) { anim = 'reach'; this.faceToward(inbox); }
      else if (t < 15.0) { anim = 'talk'; this.faceToward(this.camera.position); }
      else if (t < 17.6) walk(spot, inside, 15.0, 17.6, t);
      if (t > 3.0 && !this.tookReport) { this.tookReport = true; w.setSocket('inbox', 0); }
      if (t > 15.0 && this.lockControls) { this.lockControls = false; this.letterbox(false); }
      if (t > 17.8 && this.npc) { w.setDoorVisual('pruitt_door', false); this.audio.play('door', [door.x, door.z]); this.scene.remove(this.npc.root); this.npc = null; }
      if (this.npc) this.npc.update(dt, anim, speed);
      if (t > 19) { this.tookReport = false; this.stop(); }
    };
  }

  faceToward(p) {
    const r = this.npc.root;
    const target = Math.atan2(p.x - r.position.x, p.z - r.position.z);
    let d = target - r.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    r.rotation.y += d * 0.08;
  }

  // ---------------------------------------------------------------- escape from the office
  elevatorEscape(phase, data) {
    const w = this.world;
    if (phase === 'start') {
      this.stop();
      this.active = 'elevatorEscape';
      this.lockControls = true;
      this.letterbox(true);
      this.ui.fade(true, 250);
      setTimeout(() => this.ui.fade(false, 600), 450);
      // camera at the back of the car, square to the doors, looking out into the hall
      const [dx, dz] = data.door, [fx, fz] = data.front;
      const into = _v.set(dx - fx, 0, dz - fz).normalize();
      this.camPos = new THREE.Vector3(dx + into.x * 3.3, 1.62, dz + into.z * 3.3);
      this.camLook = new THREE.Vector3(fx - into.x * 3, 1.7, fz - into.z * 3);
      this.cameraOverride = true;
      this.t = 0;
      this.shake = 0.15;
      const lines = [[0.9, 'you', 'Get in! Everyone, get in!'], [2.4, 'thatch', "Leaving so soon? We haven't discussed your... retention."], [6.5, 'you', "Come on, close... why won't it close?! I can hear him coming."]];
      this.timeline = (dt) => { this.t += dt; for (const l of lines) if (!l.done && this.t >= l[0]) { l.done = true; this.story.say(l[1], l[2], { priority: true }); } };
    } else if (phase === 'transform') {
      this.story.say('thatch', 'NOBODY. LEAVES.', { priority: true, dur: 2.2 });
      this.ui.flash();
      this.shake = 1.2;
      this.audio.play('transform');
      setTimeout(() => this.story.say('you', 'What IS he?! Close it — CLOSE IT!', { priority: true }), 1500);
    } else if (phase === 'closed') {
      this.shake = 1.6;
      for (let i = 0; i < 4; i++) setTimeout(() => { this.audio.play('thud', data?.door || null); this.shake = 1.0; }, 700 + i * 750);
      setTimeout(() => this.story.say('you', "...We're moving. Wait — we're going DOWN?!", { priority: true }), 3400);
    }
  }

  update(dt) {
    this.timeline?.(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 0.6);
  }

  // Called by the main loop. Returns true when this cutscene owns the camera.
  applyCamera(dt) {
    if (this.active === 'thatchMeet' && this.lockControls && this.npc) {
      // turn the player's head toward Mr. Thatch, gently
      this.npc.headWorldPos(_v2);
      const cam = this.camera.position;
      const yaw = Math.atan2(_v2.x - cam.x, _v2.z - cam.z);
      const pitch = Math.atan2(_v2.y - 0.15 - cam.y, Math.hypot(_v2.x - cam.x, _v2.z - cam.z));
      let d = yaw - this.me.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.me.yaw += d * Math.min(1, dt * 3); this.me.pitch += (pitch - this.me.pitch) * Math.min(1, dt * 3);
      return false; // normal first-person camera, just steered
    }
    if (this.active === 'elevatorEscape' && this.cameraOverride) {
      const s = this.shake * 0.05;
      this.camera.position.copy(this.camPos).add(_v.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.camera.lookAt(this.camLook);
      return true;
    }
    return false;
  }
}

export { ease };
