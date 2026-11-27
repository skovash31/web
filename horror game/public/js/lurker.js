// The Lurker: the thing that lives in the lockers. Stay hidden too long and it bursts out,
// shoves you into the hall and takes half your health. Built from primitives: a gaunt,
// hunched, wet-black body, a long head with a split jaw, pale eyes and very long arms.
import * as THREE from 'three';

const SKIN = 0x15120f;

function limb(len, r0, r1, mat) {
  // a tapered segment hanging down from its pivot (the joint is at y = 0)
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 7), mat);
  m.position.y = -len / 2;
  g.add(m);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(r0 * 1.15, 7, 6), mat);
  g.add(knob);
  return g;
}

function makeLurker() {
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.45, metalness: 0.05, transparent: true });
  const bone = new THREE.MeshStandardMaterial({ color: 0x8a7f6c, roughness: 0.55, transparent: true });
  const tooth = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.4, transparent: true });
  const gum = new THREE.MeshStandardMaterial({ color: 0x3a0806, roughness: 0.6, transparent: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xe8f6d0, transparent: true });
  const root = new THREE.Group();

  // hunched torso, ribs showing through
  const torso = new THREE.Group();
  torso.position.set(0, 1.05, 0);
  root.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.62, 4, 10), skin);
  chest.scale.set(1, 1, 0.75);
  chest.position.y = 0.36;
  torso.add(chest);
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 4, 12, Math.PI * 0.9), bone);
    rib.position.set(0, 0.28 + i * 0.09, 0.02);
    rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.05);
    rib.scale.set(1, 0.78, 1);
    torso.add(rib);
  }

  // neck + long head with a split jaw
  const neck = new THREE.Group();
  neck.position.set(0, 0.78, 0.04);
  torso.add(neck);
  const neckM = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.24, 6), skin);
  neckM.position.set(0, 0.1, 0.04); neckM.rotation.x = 0.4;
  neck.add(neckM);
  const head = new THREE.Group();
  head.position.set(0, 0.22, 0.1);
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
  skull.scale.set(0.9, 1.25, 1.15);
  head.add(skull);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), eyeMat);
    e.position.set(s * 0.05, 0.04, 0.125);
    e.scale.set(1, 0.6, 1);
    head.add(e); eyes.push(e);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.06, 0.03);
  head.add(jaw);
  const jawM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin);
  jawM.scale.set(0.85, 1.3, 1.25); jawM.position.z = 0.03;
  jaw.add(jawM);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.075, 10), gum);
  mouth.position.set(0, -0.04, 0.105); mouth.scale.set(0.8, 1.4, 1);
  head.add(mouth);
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 1.6;
    for (const [grp, y, flip] of [[head, -0.045, Math.PI], [jaw, -0.02, 0]]) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.045, 4), tooth);
      t.position.set(Math.sin(a) * 0.06, y, 0.06 + Math.cos(a) * 0.05);
      t.rotation.x = flip;
      grp.add(t);
    }
  }
  // a faint sick glow from the eyes only, so it reads as a shape in the dark
  const glow = new THREE.PointLight(0xd9e8c0, 0.35, 1.1, 2);
  glow.position.set(0, 0.04, 0.22);
  head.add(glow);

  // very long arms: shoulder -> elbow -> wrist -> four long fingers
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = limb(0.62, 0.05, 0.035, skin);
    shoulder.position.set(s * 0.2, 0.66, 0);
    torso.add(shoulder);
    const elbow = limb(0.66, 0.038, 0.026, skin);
    elbow.position.y = -0.62;
    shoulder.add(elbow);
    const hand = new THREE.Group();
    hand.position.y = -0.66;
    elbow.add(hand);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.03), skin);
    palm.position.y = -0.05;
    hand.add(palm);
    const fingers = [];
    for (let f = 0; f < 4; f++) {
      const fg = limb(0.2 + (f === 1 || f === 2 ? 0.05 : 0), 0.011, 0.006, skin);
      fg.position.set((f - 1.5) * 0.022, -0.1, 0);
      fg.rotation.z = (f - 1.5) * 0.12 * s;
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.05, 4), tooth);
      claw.position.y = -0.25 - (f === 1 || f === 2 ? 0.05 : 0);
      claw.rotation.x = Math.PI;
      fg.add(claw);
      hand.add(fg); fingers.push(fg);
    }
    arms.push({ s, shoulder, elbow, hand, fingers });
  }

  // spindly legs, mostly lost in the locker's shadow
  for (const s of [-1, 1]) {
    const thigh = limb(0.55, 0.05, 0.035, skin);
    thigh.position.set(s * 0.1, 1.05, 0);
    thigh.rotation.set(-0.5, 0, s * 0.12);
    root.add(thigh);
    const shin = limb(0.55, 0.035, 0.025, skin);
    shin.position.y = -0.55; shin.rotation.x = 0.9;
    thigh.add(shin);
  }

  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { root, torso, neck, head, jaw, arms, eyes, glow, mats: [skin, bone, tooth, gum, eyeMat] };
}

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;

export class Lurkers {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.active = [];
    this.breath = null;
  }

  // It lunges out of hiding spot `spotId` (all clients see it).
  attack(spotId) {
    const ent = this.world.ents.get(spotId);
    if (!ent) return null;
    const pr = this.world.props.get(spotId)?.prop;
    if (pr) pr.userData.forceOpen = 2.6; // the door bangs open while it's out
    const L = makeLurker();
    const f = ent.facing || 0;
    L.root.rotation.y = f;
    L.base = new THREE.Vector3(ent.x, 0, ent.z);
    L.dir = new THREE.Vector3(Math.sin(f), 0, Math.cos(f));
    L.t = 0;
    L.dur = 2.6;
    L.seed = Math.random() * 10;
    this.place(L, 0);
    this.scene.add(L.root);
    this.active.push(L);
    this.audio.play('lurker', [ent.x, ent.z]);
    return L;
  }

  // Breathing and scratching inside your locker: the warning before it attacks.
  warn(spotId, secs) {
    this.stopWarn();
    const ent = this.world.ents.get(spotId);
    if (!ent) return;
    const at = [ent.x, ent.z];
    let n = 0;
    const tick = () => {
      this.audio.play(n % 3 === 2 ? 'scratch' : 'lurkerBreath', at);
      n++;
      // the closer it gets to attacking, the faster it breathes
      const left = Math.max(0.6, secs - n * 1.8);
      this.breath = setTimeout(tick, Math.max(700, Math.min(2400, left * 220)));
    };
    tick();
  }
  stopWarn() { clearTimeout(this.breath); this.breath = null; }

  place(L, t) {
    // 0-0.3 s: burst out; hold and twitch; from 1.7 s: pull back in and fade
    const out = ease(t / 0.3) * (1 - ease((t - 1.7) / 0.6));
    const reach = lerp(-0.05, 0.4, out);
    L.root.position.copy(L.base).addScaledVector(L.dir, reach);
    L.root.position.y = lerp(-0.05, 0, out);
    const w = Math.sin(t * 31 + L.seed) * 0.5 + Math.sin(t * 17) * 0.5;
    // folds forward out of the locker so its face hangs at your eye level
    L.torso.rotation.x = lerp(0.15, 0.85, out) + w * 0.03 * out;
    L.neck.rotation.x = lerp(0.2, -0.75, out);
    L.head.rotation.z = Math.sin(t * 23 + L.seed) * 0.18 * out + 0.25 * out;
    L.head.rotation.x = w * 0.08 * out;
    L.jaw.rotation.x = lerp(0.05, 0.85, out) + Math.abs(w) * 0.15 * out;
    for (const a of L.arms) {
      // arms swing up and forward, grabbing at you
      const grab = Math.sin(t * 9 + a.s) * 0.12 * out;
      a.shoulder.rotation.x = lerp(0.15, -1.75, out) + grab;
      a.shoulder.rotation.z = a.s * lerp(0.1, 0.32, out);
      a.elbow.rotation.x = lerp(-0.3, -0.25, out) - grab;
      a.hand.rotation.x = lerp(0, -0.35, out);
      for (const fg of a.fingers) fg.rotation.x = lerp(0.1, 0.55 + Math.sin(t * 14 + a.s) * 0.3, out);
    }
    const fade = 1 - ease((t - 2.15) / 0.45);
    for (const m of L.mats) m.opacity = fade;
    L.glow.intensity = 0.35 * fade * (0.8 + Math.random() * 0.4);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const L = this.active[i];
      L.t += dt;
      if (L.t >= L.dur) {
        this.scene.remove(L.root);
        L.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
        L.mats.forEach((m) => m.dispose());
        this.active.splice(i, 1);
        continue;
      }
      this.place(L, L.t);
    }
  }

  clear() {
    this.stopWarn();
    for (const L of this.active) this.scene.remove(L.root);
    this.active.length = 0;
  }
}
