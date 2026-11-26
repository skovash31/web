// Visible staples: each shot flies from the shooter to where the server says it landed.
// A hit sticks to the bone of Mr. Thatch's model that the shooter's ray struck (same spot
// on every client), stays there for the whole stun and drops off when it ends. Misses
// stick in the wall for a while.
import * as THREE from 'three';
import { makeStaple, makeBullet } from './models.js';

const SPEED = 45;          // m/s, fast but visible
const SCALE = 3.2;         // the staple model is ~2.6 cm: make it readable at a distance
const STUCK = 5.5;         // staples stuck in him are drawn bigger still, so you can see them land
const WALL_LIFE = 12;      // seconds a missed staple stays in the wall
const _z = new THREE.Vector3(0, 0, 1);

export class StapleFX {
  constructor(scene, remotes, audio) {
    Object.assign(this, { scene, remotes, audio });
    this.flying = [];
    this.wall = [];
    this.stuck = [];   // staples attached to the CEO rig
    this.falling = [];
  }

  mesh(weapon) {
    if (weapon === 'gun') {
      const b = makeBullet();
      const g = new THREE.Group();
      if (b) { b.rotation.y = Math.PI; g.add(b); } // tip leads (+Z after the flight alignment)
      g.scale.setScalar(2.2);
      return g;
    }
    const m = makeStaple();
    const g = new THREE.Group();
    if (m) g.add(m);
    else g.add(new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.002, 0.013), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6 })));
    g.scale.setScalar(SCALE);
    return g;
  }

  // Server event {from, to, hit, stuck:{bone, local, normal, form}}.
  shot(e) {
    const from = new THREE.Vector3(...e.from), to = new THREE.Vector3(...e.to);
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.01) return;
    dir.normalize();
    const g = this.mesh(e.weapon);
    // fly crown-first, legs trailing (legs point to -Z in the model)
    g.quaternion.setFromUnitVectors(_z, dir);
    g.position.copy(from).addScaledVector(dir, 0.35);
    this.scene.add(g);
    this.flying.push({ g, from, to, dir, t: 0, dur: len / (e.weapon === 'gun' ? 140 : SPEED), e });
  }

  land(f) {
    const { e } = f;
    if (e.hit) {
      this.audio.play('stapleHit', [f.to.x, f.to.z]);
      this.scene.remove(f.g);
      if (e.stuck) this.attach(e.stuck);
    } else {
      this.audio.play('stapleWall', [f.to.x, f.to.z]);
      f.g.position.copy(f.to).addScaledVector(f.dir, -0.01);
      this.wall.push({ g: f.g, life: WALL_LIFE });
    }
  }

  rigFor(form) {
    const r = this.remotes;
    if (form === 'human') return r.human || null;
    return r.ceo || null;
  }

  // Stick a staple to a bone of the current CEO model, legs driven into the surface.
  attach(s) {
    const rig = this.rigFor(s.form) || this.remotes.ceoRig;
    const bone = rig && (rig[s.bone] || rig.Torso);
    if (!bone) return;
    const g = this.mesh(s.weapon);
    const n = new THREE.Vector3(...s.normal);
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();
    // the model is scaled: undo the bone's world scale so staples keep their size
    bone.updateWorldMatrix(true, false);
    const ws = new THREE.Vector3(); bone.getWorldScale(ws);
    const sc = s.weapon === 'gun' ? 2.2 : STUCK;
    g.scale.set(sc / ws.x, sc / ws.y, sc / ws.z);
    g.quaternion.setFromUnitVectors(_z, n); // crown faces out, legs (-Z) driven into him
    g.position.set(...s.local).addScaledVector(n, 0.004);
    bone.add(g);
    this.stuck.push({ g, bone });
  }

  // Stun over: the staples pop out and fall to the floor.
  release() {
    for (const s of this.stuck) {
      const w = new THREE.Vector3(); s.g.getWorldPosition(w);
      const q = new THREE.Quaternion(); s.g.getWorldQuaternion(q);
      s.bone.remove(s.g);
      s.g.position.copy(w); s.g.quaternion.copy(q); s.g.scale.setScalar(STUCK);
      this.scene.add(s.g);
      this.falling.push({ g: s.g, v: new THREE.Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5), spin: (Math.random() - 0.5) * 20, life: 2.5 });
    }
    this.stuck = [];
  }

  clear() {
    for (const list of [this.flying, this.wall, this.falling]) for (const f of list) this.scene.remove(f.g);
    for (const s of this.stuck) s.bone.remove(s.g);
    this.flying = []; this.wall = []; this.stuck = []; this.falling = [];
  }

  update(dt) {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.g.position.lerpVectors(f.from, f.to, k);
      if (k >= 1) { this.flying.splice(i, 1); this.land(f); }
    }
    for (let i = this.wall.length - 1; i >= 0; i--) {
      const w = this.wall[i];
      w.life -= dt;
      if (w.life <= 0) { this.scene.remove(w.g); this.wall.splice(i, 1); }
    }
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.life -= dt;
      f.v.y -= 9.8 * dt;
      f.g.position.addScaledVector(f.v, dt);
      if (f.g.position.y < 0.01) { f.g.position.y = 0.01; f.v.set(0, 0, 0); }
      f.g.rotation.x += f.spin * dt * (f.v.lengthSq() > 0 ? 1 : 0);
      if (f.life <= 0) { this.scene.remove(f.g); this.falling.splice(i, 1); }
    }
  }
}
