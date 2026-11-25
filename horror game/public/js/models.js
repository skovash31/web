// Loads the provided GLB models and drives them with procedural animation
// (the models ship without skeletal animation, but their limbs are separate pivots).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const store = {};

export async function loadModels(onProgress) {
  const list = [['player', 'models/player.glb'], ['monster', 'models/monster.glb'], ['flashlight', 'models/flashlight.glb'], ['boss', 'models/boss.glb'], ['car', 'models/car.glb'], ['stapler', 'models/stapler.glb'], ['staple', 'models/staple.glb'], ['staples', 'models/staple_ammo.glb']];
  let done = 0;
  await Promise.all(list.map(([k, url]) => new Promise((res) => {
    loader.load(url, (g) => { store[k] = g.scene; done++; onProgress?.(done / list.length); res(); }, undefined, (e) => { console.warn('model failed', url, e); store[k] = null; done++; res(); });
  })));
  return store;
}

function find(root, name) { let f = null; root.traverse((o) => { if (!f && o.name === name) f = o; }); return f; }

function prepare(root, { tint, shadow = true } = {}) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = shadow; o.receiveShadow = true;
      if (tint !== undefined) {
        o.material = o.material.clone();
        o.material.color = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.25);
      }
    }
  });
  return root;
}

// The provided flashlight.glb. Its lens faces -Z (LightOrigin marks the beam start).
// Materials are cloned per instance so the lens can glow while the light is on; the
// fully-metallic trim is toned down because there is no environment map to reflect.
export function makeFlashlight() {
  const src = store.flashlight;
  if (!src) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    m.rotation.x = Math.PI / 2; g.add(m);
    g.userData.setOn = () => {};
    return g;
  }
  const root = prepare(src.clone(true), { shadow: false });
  let lens = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (o.material.name === 'Metal') { o.material.metalness = 0.55; o.material.roughness = 0.35; }
    if (o.material.name === 'BlackBody') o.material.color.setRGB(0.09, 0.09, 0.1);
    if (o.material.name === 'Lens') { lens = o.material; lens.emissive = new THREE.Color(0xfff1d0); lens.emissiveIntensity = 0; }
  });
  root.userData.lightOrigin = find(root, 'LightOrigin');
  root.userData.setOn = (on) => { if (lens) lens.emissiveIntensity = on ? 2.2 : 0; };
  return root;
}

// ---------------------------------------------------------------- office supplies
// stapler.glb: fires along -Z; TopArm is the hinged top, MuzzleOrigin where staples leave.
export function makeStapler() {
  const src = store.stapler;
  if (!src) return null;
  const root = prepare(src.clone(true), { shadow: false });
  return { root, top: find(root, 'TopArm'), muzzle: find(root, 'MuzzleOrigin') };
}
// staple.glb: a single staple, crown at z=0 with its legs pointing toward -Z.
export function makeStaple() {
  const src = store.staple;
  if (!src) return null;
  const root = prepare(src.clone(true), { shadow: false });
  root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.set(0x3a3e46); o.material.metalness = 0.85; o.material.roughness = 0.3; o.material.emissive = new THREE.Color(0x101216); } });
  return root;
}
export function makeStaplesBox() {
  const src = store.staples;
  return src ? prepare(src.clone(true)) : null;
}

// The provided car.glb (front faces +Z, wheels are separate nodes, headlight origins
// marked). Its cabin is a closed shell behind the glass: the shell stays single-sided so
// it vanishes from the driver's seat, and the glass is made see-through (tinted). Returns null if the model failed to load.
export function makeCar() {
  const src = store.car;
  if (!src) return null;
  const root = src.clone(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.material = o.material.clone();
    const n = o.material.name;
    if (n === 'Glass') Object.assign(o.material, { transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    if (n === 'Headlight' || n === 'Taillight') o.userData.lamp = o.material;
  });
  return {
    root,
    wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].map((w) => find(root, w)).filter(Boolean),
    front: ['Wheel_FL', 'Wheel_FR'].map((w) => find(root, w)).filter(Boolean),
    headlightOrigins: ['HeadlightOrigin_L', 'HeadlightOrigin_R'].map((w) => find(root, w)).filter(Boolean),
    lamps: (() => { const l = []; root.traverse((o) => { if (o.userData.lamp) l.push(o.userData.lamp); }); return l; })(),
  };
}

// ---------------------------------------------------------------- employees
export class PlayerRig {
  constructor(color) {
    this.root = new THREE.Group();
    const src = store.player;
    if (src) {
      this.model = prepare(src.clone(true), { tint: color });
      this.root.add(this.model);
      this.head = find(this.model, 'Head');
      this.armR = find(this.model, 'Arm_R');
      this.armL = find(this.model, 'Arm_L');
      this.legR = find(this.model, 'Leg_R');
      this.legL = find(this.model, 'Leg_L');
      this.torso = find(this.model, 'Torso');
    } else {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color }));
      m.position.y = 0.85; this.root.add(m);
    }
    // ID badge so co-workers are readable in the dark
    this.flash = makeFlashlight();
    if (this.armR) {
      this.flash.position.set(0, -0.66, 0.02);
      this.flash.rotation.x = -Math.PI / 2;
      this.armR.add(this.flash);
    }
    this.phase = 0;
    this.crouchAmt = 0;
  }

  update(dt, { speed = 0, crouch = false, pitch = 0, flashlight = false, alive = true }) {
    if (!this.model) return;
    this.crouchAmt += ((crouch ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 10);
    const moving = speed > 0.3;
    this.phase += dt * (moving ? 4 + speed * 1.6 : 0);
    const sw = moving ? Math.sin(this.phase) * Math.min(0.9, 0.25 + speed * 0.14) : 0;
    const c = this.crouchAmt;
    this.legR.rotation.x = sw - c * 1.1;
    this.legL.rotation.x = -sw - c * 1.1;
    this.armL.rotation.x = -sw * 0.8;
    // flashlight arm points where they're looking
    this.armR.rotation.x = flashlight ? -Math.PI / 2 - pitch : sw * 0.8;
    this.armR.rotation.z = 0;
    this.head.rotation.x = -pitch * 0.6;
    this.model.position.y = -c * 0.42 + (moving ? Math.abs(Math.cos(this.phase)) * 0.03 : 0);
    this.torso.rotation.x = c * 0.35;
    if (!alive) { this.model.rotation.x = -Math.PI / 2; this.model.position.y = 0.2; }
    else this.model.rotation.x = 0;
  }
}

// ---------------------------------------------------------------- Mr. Thatch, human disguise
// The provided boss.glb (top hat, gold company badge), animated like the employees.
export class HumanRig {
  constructor() {
    this.root = new THREE.Group();
    const src = store.boss;
    if (src) {
      this.model = prepare(src.clone(true));
      this.model.scale.set(1.04, 1.08, 1.04);
      this.root.add(this.model);
      for (const n of ['Head', 'Torso', 'Arm_R', 'Arm_L', 'Leg_R', 'Leg_L', 'TopHat', 'Badge']) this[n] = find(this.model, n);
      this.model.traverse((o) => { if (o.isMesh && o.material.name === 'GoldBadge') { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0x3a2a08); } });
    } else {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x23252b }));
      m.position.y = 0.85; this.root.add(m);
    }
    this.phase = 0;
    this.t = 0;
    this.stepCallback = null;
    this.lastStepSign = 0;
    this.reach = 0;
    this.cover = 0;
  }

  update(dt, anim, speed) {
    if (!this.model) return;
    this.t += dt;
    const moving = speed > 0.2;
    this.phase += dt * (moving ? 3 + speed * 1.7 : 0);
    const s = Math.sin(this.phase);
    const sign = Math.sign(s);
    if (moving && sign !== this.lastStepSign && this.stepCallback) this.stepCallback(speed);
    this.lastStepSign = sign;
    const amp = Math.min(0.85, 0.3 + speed * 0.15);
    this.Leg_R.rotation.x = moving ? s * amp : 0;
    this.Leg_L.rotation.x = moving ? -s * amp : 0;
    const reachT = anim === 'reach' || anim === 'kill' || anim === 'check' || anim === 'open' ? 1 : 0;
    this.reach += (reachT - this.reach) * Math.min(1, dt * 6);
    // blinded: both hands thrown up over his eyes, staggering
    this.cover += ((anim === 'blind' ? 1 : 0) - this.cover) * Math.min(1, dt * 10);
    this.slump = (this.slump || 0) + ((anim === 'stunned' ? 1 : 0) - (this.slump || 0)) * Math.min(1, dt * 8);
    const c = this.cover;
    this.Arm_R.rotation.x = ((moving ? -s * amp * 0.7 : 0) * (1 - this.reach) - this.reach * 1.4) * (1 - c) - c * 2.6;
    this.Arm_L.rotation.x = ((moving ? s * amp * 0.7 : 0) * (1 - this.reach) - (anim === 'kill' ? this.reach * 1.4 : 0)) * (1 - c) - c * 2.5;
    this.Arm_R.rotation.z = c * 0.5; this.Arm_L.rotation.z = -c * 0.5;
    // a stiff, slightly-too-still posture; the head tilts when he talks
    this.Head.rotation.z = anim === 'talk' ? Math.sin(this.t * 2.2) * 0.12 : c * Math.sin(this.t * 9) * 0.25;
    this.Head.rotation.x = anim === 'talk' ? Math.sin(this.t * 3.1) * 0.05 : c * 0.35;
    this.model.position.y = moving ? Math.abs(Math.cos(this.phase)) * 0.03 : 0;
    this.Torso.rotation.x = speed > 3 ? 0.25 : c * 0.2 + this.slump * 0.45;
    if (this.slump > 0.01) {
      const k = this.slump, j = Math.sin(this.t * 29) * 0.06;
      this.Head.rotation.x += k * 0.6; this.Head.rotation.z += k * (0.3 + j);
      this.Arm_R.rotation.x = this.Arm_R.rotation.x * (1 - k) + k * (0.3 + j); this.Arm_L.rotation.x = this.Arm_L.rotation.x * (1 - k) + k * (0.2 - j);
      this.Leg_R.rotation.x = this.Leg_R.rotation.x * (1 - k) - k * 0.25; this.Leg_L.rotation.x = this.Leg_L.rotation.x * (1 - k) + k * 0.1;
    }
  }

  headWorldPos(out) {
    if (this.Head) return this.Head.getWorldPosition(out).add(_v.set(0, 0.3, 0));
    return out.copy(this.root.position).add(_v.set(0, 1.7, 0));
  }
}

// ---------------------------------------------------------------- the CEO
// monster.glb: a hunched, jointed rig (Torso > Neck > Head, Arm > Forearm, Leg > Shin).
// Every joint keeps its authored rest pose; animation is layered on top of it.
const JOINTS = ['Torso', 'Neck', 'Head', 'Arm_R', 'Arm_L', 'Forearm_R', 'Forearm_L', 'Leg_R', 'Leg_L', 'Shin_R', 'Shin_L'];
const _eyeLocal = new THREE.Vector3(0, 0.27, 0.19); // between the eyes, in Head space

export class MonsterRig {
  constructor() {
    this.root = new THREE.Group();
    const src = store.monster;
    this.base = {};
    if (src) {
      this.model = prepare(src.clone(true));
      this.model.scale.setScalar(1.06);
      this.root.add(this.model);
      for (const n of JOINTS) {
        const o = find(this.model, n);
        this[n] = o;
        if (o) this.base[n] = o.quaternion.clone();
      }
      this.model.traverse((o) => {
        if (!o.isMesh) return;
        // glowing pupils: you can find his eyes with the flashlight, and they find you
        if (o.material.name === 'Pupil') { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff3020); o.material.emissiveIntensity = 0.6; this.pupil = o.material; }
      });
      // his authored legs are bent: measure where the soles really are so he stands on the floor
      this.model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.model);
      this.footOffset = -box.min.y;
      this.height = box.max.y - box.min.y;
    } else {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.6, 4, 8), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
      m.position.y = 1.2; this.root.add(m);
      this.footOffset = 0; this.height = 2.4;
    }
    this.phase = 0;
    this.t = 0;
    this.twitch = 0;
    this.twitchTarget = new THREE.Euler();
    this.twitchCur = new THREE.Euler();
    this.lean = 0;
    this.crawl = false;   // set by the renderer while he squeezes through a vent (Hard)
    this.crawlAmt = 0;
    this.stepCallback = null;
    this.lastStepSign = 0;
  }

  rot(name, x = 0, y = 0, z = 0) {
    const o = this[name];
    if (!o) return;
    o.quaternion.copy(this.base[name]).multiply(_q.setFromEuler(_e.set(x, y, z)));
  }

  update(dt, anim, speed) {
    if (!this.model) return;
    if (anim === 'pound') anim = 'kill';
    if (anim === 'transform') anim = 'roar';
    this.t += dt;
    const t = this.t;
    const moving = speed > 0.2;
    const run = anim === 'run';
    // long, loping strides: cadence grows slower than speed
    this.phase += dt * (moving ? 2.0 + speed * 1.05 : 0);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    // footstep event on each leg plant
    const sign = Math.sign(s);
    if (moving && sign !== this.lastStepSign && this.stepCallback) this.stepCallback(speed);
    this.lastStepSign = sign;
    const amp = run ? 0.7 : 0.4;
    const leanTarget = run ? 0.42 : anim === 'search' ? 0.12 : anim === 'roar' ? -0.35 : anim === 'blind' ? -0.3 : anim === 'kill' ? 0.25 : anim === 'stunned' ? 0.55 : 0.06;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 5);
    // random unnatural head twitches
    this.twitch -= dt;
    if (this.twitch <= 0) {
      this.twitch = 0.4 + Math.random() * (run ? 0.8 : 2.2);
      this.twitchTarget.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.8);
    }
    for (const k of ['x', 'y', 'z']) this.twitchCur[k] += (this.twitchTarget[k] - this.twitchCur[k]) * Math.min(1, dt * 18);

    // arms: shoulder swing + elbow bend (positive fore* = elbow flexes more)
    let armRx = moving ? -s * amp * 0.8 : Math.sin(t * 0.9) * 0.05;
    let armLx = moving ? s * amp * 0.8 : Math.sin(t * 0.9 + 1) * 0.05;
    let armRz = 0.05, armLz = -0.05;
    let foreR = moving ? Math.max(0, s) * 0.35 : Math.sin(t * 1.3) * 0.06;
    let foreL = moving ? Math.max(0, -s) * 0.35 : Math.sin(t * 1.3 + 2) * 0.06;
    let headX = this.twitchCur.x * 0.6, headY = this.twitchCur.y, headZ = this.twitchCur.z;
    if (anim === 'search') { headY = Math.sin(t * 1.6) * 0.9; armRx = 0.1; foreR = 0.2; }
    if (anim === 'open' || anim === 'check') { armRx = -1.4 + Math.sin(t * 10) * 0.1; armLx = -1.2; foreR = -0.3; foreL = -0.5 + Math.sin(t * 8) * 0.2; }
    if (anim === 'roar') { armRz = 0.9; armLz = -0.9; armRx = -0.5; armLx = -0.5; foreR = -0.6; foreL = -0.6; headX = -0.6; headZ = Math.sin(t * 30) * 0.15; }
    if (anim === 'kill') { armRx = -2.0 + Math.sin(t * 14) * 0.35; armLx = -1.8 + Math.cos(t * 14) * 0.35; foreR = -0.4 + Math.sin(t * 14) * 0.5; foreL = -0.4 + Math.cos(t * 14) * 0.5; headX = 0.35 + Math.sin(t * 25) * 0.2; }
    if (anim === 'burn') { armRx = -2.6 + Math.sin(t * 17) * 0.6; armLx = -2.4 + Math.cos(t * 19) * 0.6; foreR = Math.sin(t * 13) * 0.8; foreL = Math.cos(t * 11) * 0.8; headX = -0.8 + Math.sin(t * 31) * 0.3; headZ = Math.sin(t * 23) * 0.4; }
    // blinded: claws thrown up over his face, head shaking
    if (anim === 'blind') { armRx = -2.3 + Math.sin(t * 13) * 0.15; armLx = -2.2 + Math.cos(t * 11) * 0.15; armRz = 0.5; armLz = -0.5; foreR = 1.1; foreL = 1.1; headX = 0.4 + Math.sin(t * 21) * 0.15; headY = Math.sin(t * 7) * 0.6; headZ = Math.sin(t * 17) * 0.25; }
    // stapled: staggered and seizing, arms hanging, head lolling, twitching all over
    if (anim === 'stunned') { const j = Math.sin(t * 31) * 0.08 + Math.sin(t * 13) * 0.06; armRx = 0.25 + j; armLx = 0.15 - j; armRz = 0.25 + Math.sin(t * 7) * 0.1; armLz = -0.3; foreR = 0.5 + j * 2; foreL = 0.3 - j * 2; headX = 0.7 + Math.sin(t * 2.3) * 0.2; headY = Math.sin(t * 1.7) * 0.5; headZ = 0.5 + Math.sin(t * 23) * 0.1; }
    // chasing: arms thrust forward, claws reaching
    if (run) { armRx = -1.0 - s * 0.45; armLx = -1.0 + s * 0.45; foreR = -0.35 + Math.max(0, s) * 0.3; foreL = -0.35 + Math.max(0, -s) * 0.3; }

    // legs: hip swing; the knee folds while the leg swings through and straightens to plant
    const kneeAmp = run ? 0.95 : 0.6;
    let legR = s * amp, legL = -s * amp;
    let shinR = moving ? Math.max(0, -c) * kneeAmp : 0, shinL = moving ? Math.max(0, c) * kneeAmp : 0;
    if (anim === 'blind') { legR = -0.15; legL = 0.25; shinR = 0.3; shinL = 0.15; }
    if (anim === 'kill' || anim === 'roar') { shinR = 0.25; shinL = 0.25; legR = -0.15; legL = -0.15; } // braced, crouching
    if (anim === 'stunned') { legR = -0.35; legL = -0.2; shinR = 0.75; shinL = 0.6; } // sagging at the knees

    // crawling through a vent: body pitched forward, clawing along
    this.crawlAmt += ((this.crawl ? 1 : 0) - this.crawlAmt) * Math.min(1, dt * 6);
    const cr = this.crawlAmt;
    if (cr > 0.01) {
      armRx = armRx * (1 - cr) + cr * (-1.5 - s * 0.6); armLx = armLx * (1 - cr) + cr * (-1.5 + s * 0.6);
      foreR = foreR * (1 - cr) + cr * 0.6; foreL = foreL * (1 - cr) + cr * 0.6;
      shinR = shinR * (1 - cr) + cr * 1.2; shinL = shinL * (1 - cr) + cr * 1.2;
    }

    this.rot('Leg_R', legR, 0, 0);
    this.rot('Leg_L', legL, 0, 0);
    this.rot('Shin_R', shinR, 0, 0);
    this.rot('Shin_L', shinL, 0, 0);
    this.rot('Arm_R', armRx, 0, armRz);
    this.rot('Arm_L', armLx, 0, armLz);
    this.rot('Forearm_R', -foreR, 0, 0);
    this.rot('Forearm_L', -foreL, 0, 0);
    this.rot('Torso', this.lean + (moving ? Math.abs(s) * 0.05 : Math.sin(t * 1.2) * 0.02), moving ? s * 0.14 : 0, moving ? c * 0.04 : 0);
    this.rot('Neck', this.lean * -0.5, 0, 0);
    this.rot('Head', headX - this.lean * 0.3, headY, headZ);
    const bob = moving ? Math.abs(c) * (run ? 0.1 : 0.05) : Math.sin(t * 1.2) * 0.01;
    // folded knees lower the hips: sink the body so the soles stay on the floor
    const sink = (Math.max(shinR, shinL) * 0.12 + (anim === 'kill' || anim === 'roar' ? 0.06 : 0) + (anim === 'stunned' ? 0.12 : 0)) * (1 - cr);
    this.model.position.y = (this.footOffset || 0) + bob - sink + cr * 0.2;
    this.model.rotation.x = cr * 1.3;
    if (this.pupil) this.pupil.emissiveIntensity = anim === 'blind' ? 0.05 : anim === 'stunned' ? (Math.sin(t * 17) > 0.6 ? 0.8 : 0.05) : run ? 1.6 : 0.6;
  }

  // World position of his eyes (what the flashlight stun and the death camera aim at).
  headWorldPos(out) {
    if (this.Head) return this.Head.localToWorld(out.copy(_eyeLocal));
    return out.copy(this.root.position).add(_v.set(0, 2.2, 0));
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
