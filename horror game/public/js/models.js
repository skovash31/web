// Loads the provided GLB models and drives them with procedural animation
// (the models ship without skeletal animation, but their limbs are separate pivots).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const store = {};

export async function loadModels(onProgress) {
  const list = [['player', 'models/player.glb'], ['monster', 'models/monster.glb'], ['flashlight', 'models/flashlight.glb']];
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

export function makeFlashlight() {
  const src = store.flashlight;
  if (!src) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    m.rotation.x = Math.PI / 2; g.add(m);
    return g;
  }
  return prepare(src.clone(true), { shadow: false });
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
// Built from the employee model: charcoal suit, red tie, pale skin, slicked grey hair.
export class HumanRig {
  constructor() {
    this.root = new THREE.Group();
    const src = store.player;
    const suit = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.55 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe6dccf, roughness: 0.5 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x9a9a9e, roughness: 0.4 });
    const red = new THREE.MeshStandardMaterial({ color: 0x8a1010, roughness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
    if (src) {
      this.model = src.clone(true);
      this.model.scale.set(1.04, 1.08, 1.04);
      this.root.add(this.model);
      this.model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      for (const n of ['Head', 'Torso', 'Arm_R', 'Arm_L', 'Leg_R', 'Leg_L']) this[n] = find(this.model, n);
      const setMat = (node, m) => node?.traverse((o) => { if (o.isMesh) o.material = m; });
      setMat(this.Torso, suit); setMat(this.Arm_R, suit); setMat(this.Arm_L, suit);
      setMat(this.Leg_R, trousers); setMat(this.Leg_L, trousers); setMat(this.Head, skin);
      // shirt, tie, hair, a too-wide smile
      const add = (parent, geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me; };
      if (this.Torso) {
        add(this.Torso, new THREE.BoxGeometry(0.14, 0.4, 0.02), white, 0, 0.5, 0.112);
        add(this.Torso, new THREE.BoxGeometry(0.05, 0.34, 0.02), red, 0, 0.47, 0.123);
      }
      if (this.Head) {
        const cap = add(this.Head, new THREE.SphereGeometry(0.262, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, 0, 0.3, -0.015);
        cap.scale.set(1.02, 1.05, 1.04);
        const back = add(this.Head, new THREE.SphereGeometry(0.258, 16, 10, Math.PI * 0.6, Math.PI * 0.8, 0, Math.PI * 0.62), hair, 0, 0.3, -0.01);
        back.scale.set(1.02, 1, 1.04);
        // the smile: too wide, too many teeth
        add(this.Head, new THREE.BoxGeometry(0.28, 0.05, 0.012), new THREE.MeshStandardMaterial({ color: 0x2a0606 }), 0, 0.17, 0.247);
        add(this.Head, new THREE.BoxGeometry(0.25, 0.02, 0.014), white, 0, 0.18, 0.249);
        for (const x of [-0.1, 0.1]) add(this.Head, new THREE.BoxGeometry(0.06, 0.03, 0.01), new THREE.MeshStandardMaterial({ color: 0x111111 }), x, 0.32, 0.252);
      }
    } else {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), suit);
      m.position.y = 0.85; this.root.add(m);
    }
    this.phase = 0;
    this.t = 0;
    this.stepCallback = null;
    this.lastStepSign = 0;
    this.reach = 0;
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
    this.Arm_R.rotation.x = (moving ? -s * amp * 0.7 : 0) * (1 - this.reach) - this.reach * 1.4;
    this.Arm_L.rotation.x = (moving ? s * amp * 0.7 : 0) * (1 - this.reach) - (anim === 'kill' ? this.reach * 1.4 : 0);
    // a stiff, slightly-too-still posture; the head tilts when he talks
    this.Head.rotation.z = anim === 'talk' ? Math.sin(this.t * 2.2) * 0.12 : 0;
    this.Head.rotation.x = anim === 'talk' ? Math.sin(this.t * 3.1) * 0.05 : 0;
    this.model.position.y = moving ? Math.abs(Math.cos(this.phase)) * 0.03 : 0;
    this.Torso.rotation.x = speed > 3 ? 0.25 : 0;
  }

  headWorldPos(out) {
    if (this.Head) return this.Head.getWorldPosition(out).add(_v.set(0, 0.3, 0));
    return out.copy(this.root.position).add(_v.set(0, 1.7, 0));
  }
}

// ---------------------------------------------------------------- the CEO
export class MonsterRig {
  constructor() {
    this.root = new THREE.Group();
    const src = store.monster;
    this.base = {};
    if (src) {
      this.model = prepare(src.clone(true));
      this.model.scale.setScalar(1.06);
      this.root.add(this.model);
      for (const n of ['Torso', 'Neck', 'Head', 'Arm_R', 'Arm_L', 'Leg_R', 'Leg_L']) {
        const o = find(this.model, n);
        this[n] = o;
        if (o) this.base[n] = o.quaternion.clone();
      }
      this.model.traverse((o) => {
        if (o.isMesh && o.material.name === 'Pupil') { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff3020); o.material.emissiveIntensity = 0.6; this.pupil = o.material; }
        if (o.isMesh && (o.material.name === 'WhiteSkin' || o.material.name === 'HeadWhite')) { o.material = o.material.clone(); o.material.roughness = 0.55; o.material.color.set(0xe8e4dc); }
      });
    } else {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.6, 4, 8), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
      m.position.y = 1.2; this.root.add(m);
    }
    this.phase = 0;
    this.t = 0;
    this.twitch = 0;
    this.twitchTarget = new THREE.Euler();
    this.twitchCur = new THREE.Euler();
    this.lean = 0;
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
    this.phase += dt * (moving ? 2.2 + speed * 1.2 : 0);
    const s = Math.sin(this.phase);
    // footstep event on each leg plant
    const sign = Math.sign(s);
    if (moving && sign !== this.lastStepSign && this.stepCallback) this.stepCallback(speed);
    this.lastStepSign = sign;
    const run = anim === 'run';
    const amp = run ? 0.75 : 0.42;
    const leanTarget = run ? 0.38 : anim === 'search' ? 0.1 : anim === 'roar' ? -0.35 : 0.05;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 5);
    // random unnatural head twitches
    this.twitch -= dt;
    if (this.twitch <= 0) {
      this.twitch = 0.4 + Math.random() * (run ? 0.8 : 2.2);
      this.twitchTarget.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.8);
    }
    this.twitchCur.x += (this.twitchTarget.x - this.twitchCur.x) * Math.min(1, dt * 18);
    this.twitchCur.y += (this.twitchTarget.y - this.twitchCur.y) * Math.min(1, dt * 18);
    this.twitchCur.z += (this.twitchTarget.z - this.twitchCur.z) * Math.min(1, dt * 18);

    let armRx = moving ? -s * amp * 0.8 : Math.sin(t * 0.9) * 0.05;
    let armLx = moving ? s * amp * 0.8 : Math.sin(t * 0.9 + 1) * 0.05;
    let armRz = 0.05, armLz = -0.05;
    let headX = this.twitchCur.x * 0.6, headY = this.twitchCur.y, headZ = this.twitchCur.z;
    if (anim === 'search') { headY = Math.sin(t * 1.6) * 0.9; armRx = 0.1; }
    if (anim === 'open' || anim === 'check') { armRx = -1.5 + Math.sin(t * 10) * 0.1; armLx = -1.3; }
    if (anim === 'roar') { armRz = 0.9; armLz = -0.9; armRx = -0.5; armLx = -0.5; headX = -0.6; headZ = Math.sin(t * 30) * 0.15; }
    if (anim === 'kill') { armRx = -2.2 + Math.sin(t * 14) * 0.3; armLx = -2.0 + Math.cos(t * 14) * 0.3; headX = 0.3 + Math.sin(t * 25) * 0.2; }
    if (anim === 'burn') { armRx = -2.6 + Math.sin(t * 17) * 0.6; armLx = -2.4 + Math.cos(t * 19) * 0.6; headX = -0.8 + Math.sin(t * 31) * 0.3; headZ = Math.sin(t * 23) * 0.4; }
    if (run) { armRx = -0.9 - s * 0.5; armLx = -0.9 + s * 0.5; } // reaching forward while chasing

    this.rot('Leg_R', s * amp, 0, 0);
    this.rot('Leg_L', -s * amp, 0, 0);
    this.rot('Arm_R', armRx, 0, armRz);
    this.rot('Arm_L', armLx, 0, armLz);
    this.rot('Torso', this.lean + (moving ? Math.abs(s) * 0.05 : Math.sin(t * 1.2) * 0.02), moving ? s * 0.12 : 0, 0);
    this.rot('Neck', this.lean * -0.5, 0, 0);
    this.rot('Head', headX, headY, headZ);
    this.model.position.y = moving ? Math.abs(Math.cos(this.phase)) * (run ? 0.09 : 0.05) : Math.sin(t * 1.2) * 0.01;
    if (this.pupil) this.pupil.emissiveIntensity = run ? 1.5 : 0.5;
  }

  headWorldPos(out) {
    if (this.Head) return this.Head.getWorldPosition(out).add(_v.set(0, 0.25, 0));
    return out.copy(this.root.position).add(_v.set(0, 2.2, 0));
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
