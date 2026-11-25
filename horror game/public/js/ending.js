// The finale: the elevator rises to the surface, you walk out of the building into the
// night, get into your car and drive home. Entirely in-engine and procedurally built.
import * as THREE from 'three';
import { tex, textTexture } from './textures.js';

const _v = new THREE.Vector3(), _q = new THREE.Vector3();
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, k) => a + (b - a) * k;

export class Finale {
  constructor({ renderer, mainScene, camera, audio, story, ui }) {
    Object.assign(this, { renderer, mainScene, camera, audio, story, ui });
    this.active = false;
    this.indicator = document.getElementById('floorind');
  }

  start(stats, solo, world) {
    this.story.reset();
    this.active = true;
    this.stats = stats;
    this.solo = solo;
    this.t = 0;
    this.shot = 1;
    this.fired = new Set();
    this.baseCam = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() };
    // face the elevator doors from the back of the car
    const door = world?.ents?.get('elevator_door');
    if (door) {
      let fx = door.x, fz = door.z;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (world.grid.cell(door.tx + dx, door.tz + dz) === 1) { fx = door.x + dx * 2; fz = door.z + dz * 2; break; }
      const ix = Math.sign(door.x - fx), iz = Math.sign(door.z - fz);
      this.camera.position.set(door.x + ix * 3.2, 1.6, door.z + iz * 3.2);
      this.camera.lookAt(door.x, 1.45, door.z);
      this.baseCam = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() };
    }
    this.ui.letterbox?.(true);
    this.indicator.classList.remove('hidden');
    this.audio.play('elevator');
    this.audio.chaseTarget = 0;
  }

  once(key, fn) { if (!this.fired.has(key)) { this.fired.add(key); fn(); } }
  say(key, who, text) { this.once(key, () => this.story.say(who, text, { priority: true })); }

  // ---------------------------------------------------------------- exterior set
  build() {
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x070a12);
    s.fog = new THREE.FogExp2(0x0a0e18, 0.011);
    s.add(new THREE.HemisphereLight(0x5a6a8a, 0x202020, 1.1));
    const moon = new THREE.DirectionalLight(0x9aaadd, 0.8); moon.position.set(-30, 50, 20); s.add(moon);
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const add = (geo, m, x, y, z, parent = s) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); parent.add(me); return me; };

    // ground and road
    const asphalt = tex('concrete', [80, 80], [44, 46, 50]);
    const ground = add(new THREE.PlaneGeometry(800, 800), std({ map: asphalt, color: 0x55585e, roughness: 0.85 }), 150, 0, 0);
    ground.rotation.x = -Math.PI / 2;
    const white = std({ color: 0xbfbfb0, roughness: 0.8 });
    for (let x = -9; x <= 12; x += 3) add(new THREE.BoxGeometry(0.12, 0.01, 4.5), white, x, 0.01, 10);
    const road = add(new THREE.PlaneGeometry(800, 9), std({ color: 0x1c1d20, roughness: 0.6 }), 300, 0.012, 26);
    road.rotation.x = -Math.PI / 2;
    const dash = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.01, 0.15), std({ color: 0xd8c060, emissive: 0x302810 }), 120);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 120; i++) { m4.makeTranslation(-20 + i * 6, 0.02, 26); dash.setMatrixAt(i, m4); }
    s.add(dash);

    // the CAT building at night
    const winC = document.createElement('canvas'); winC.width = 512; winC.height = 512;
    const wx = winC.getContext('2d');
    wx.fillStyle = '#16181d'; wx.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 22; r++) for (let c = 0; c < 30; c++) {
      const lit = Math.random() < 0.14;
      wx.fillStyle = lit ? `rgb(${220 + Math.random() * 30},${180 + Math.random() * 40},${110 + Math.random() * 40})` : '#0b0d12';
      wx.fillRect(4 + c * 17, 6 + r * 23, 11, 15);
    }
    const winT = new THREE.CanvasTexture(winC); winT.colorSpace = THREE.SRGBColorSpace;
    const facade = std({ map: winT, emissiveMap: winT, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.7 });
    add(new THREE.BoxGeometry(46, 34, 24), [std({ color: 0x15171c }), std({ color: 0x15171c }), std({ color: 0x111111 }), std({ color: 0x111111 }), facade, std({ color: 0x15171c })], 0, 17, -24);
    add(new THREE.BoxGeometry(5, 3, 0.2), std({ color: 0x223038, emissive: 0x8fb8c8, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }), 0, 1.5, -11.95);
    add(new THREE.BoxGeometry(9, 0.3, 3.5), std({ color: 0x222428 }), 0, 3.3, -10.4);
    const entr = new THREE.PointLight(0xffd8a0, 40, 16, 1.3); entr.position.set(0, 3, -9); s.add(entr);
    this.signMat = new THREE.MeshStandardMaterial({ map: textTexture('CAT INCORPORATED', { w: 1024, h: 160, bg: '#0a0a0a', fg: '#e8c870', font: 'bold 96px Arial' }), emissive: 0xffffff, emissiveIntensity: 1, emissiveMap: textTexture('CAT INCORPORATED', { w: 1024, h: 160, bg: '#000000', fg: '#e8c870', font: 'bold 96px Arial' }) });
    add(new THREE.PlaneGeometry(14, 2.2), this.signMat, 0, 9, -11.85);

    // street lamps
    const pole = std({ color: 0x2a2c30, metalness: 0.6, roughness: 0.5 });
    const head = std({ color: 0xffe0a0, emissive: 0xffd090, emissiveIntensity: 2 });
    const lamp = (x, z, light) => {
      add(new THREE.CylinderGeometry(0.1, 0.12, 6, 8), pole, x, 3, z);
      add(new THREE.BoxGeometry(0.6, 0.15, 0.3), head, x, 6, z);
      if (light) { const l = new THREE.PointLight(0xffd090, 70, 28, 1.3); l.position.set(x, 5.8, z); s.add(l); }
    };
    lamp(-8, 2, true); lamp(11, 6, true); lamp(-8, 16, true); lamp(11, 18, false);
    for (let x = 20; x < 700; x += 28) lamp(x, 31.5, false);
    this.roadLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffd090, 0, 28, 1.3); s.add(l); return l; });

    // your car
    const car = this.car = new THREE.Group();
    car.position.set(3, 0, 10.4);
    s.add(car);
    const paint = std({ color: 0x8a2424, metalness: 0.4, roughness: 0.35 });
    add(new THREE.BoxGeometry(1.9, 0.62, 4.4), paint, 0, 0.6, 0, car);
    const cabinMat = std({ color: 0x0c0f14, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.55 });
    add(new THREE.BoxGeometry(1.72, 0.55, 2.1), cabinMat, 0, 1.18, -0.25, car);
    add(new THREE.BoxGeometry(1.74, 0.05, 2.0), paint, 0, 1.46, -0.25, car); // roof
    for (const x of [-0.84, 0.84]) add(new THREE.BoxGeometry(0.06, 0.55, 0.08), paint, x, 1.18, 0.78, car); // A-pillars
    const wheelG = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 16);
    for (const [x, z] of [[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]]) { const w = add(wheelG, std({ color: 0x111111 }), x, 0.34, z, car); w.rotation.z = Math.PI / 2; }
    for (const x of [-0.65, 0.65]) {
      add(new THREE.BoxGeometry(0.4, 0.14, 0.05), std({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 1.5 }), x, 0.7, 2.21, car);
      add(new THREE.BoxGeometry(0.4, 0.12, 0.05), std({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 1.2 }), x, 0.72, -2.21, car);
    }
    // interior
    add(new THREE.BoxGeometry(1.6, 0.25, 0.4), std({ color: 0x15161a, roughness: 0.8 }), 0, 0.95, 0.7, car);
    this.dash = std({ color: 0x0a0a0a, emissive: 0x30c0ff, emissiveIntensity: 0 });
    add(new THREE.BoxGeometry(0.26, 0.06, 0.02), this.dash, 0.42, 1.03, 0.86, car);
    const wheel = add(new THREE.TorusGeometry(0.17, 0.022, 8, 20), std({ color: 0x111111 }), 0.42, 0.96, 0.62, car);
    wheel.rotation.x = -0.4;
    this.steer = wheel;
    // driver door (on the car's left = +x side), hinged at the front
    this.doorPivot = new THREE.Group(); this.doorPivot.position.set(0.97, 0.55, 0.65); car.add(this.doorPivot);
    add(new THREE.BoxGeometry(0.06, 0.62, 1.15), paint, 0, 0, -0.57, this.doorPivot);
    add(new THREE.BoxGeometry(0.04, 0.5, 1.0), cabinMat, 0, 0.6, -0.55, this.doorPivot);
    // headlights
    this.heads = [-0.6, 0.6].map((x) => {
      const l = new THREE.SpotLight(0xfff4d0, 0, 45, 0.45, 0.5, 1.2);
      l.position.set(x, 0.7, 2.3); car.add(l);
      l.target.position.set(x * 0.6, 0, 14); car.add(l.target);
      return l;
    });

    // light rain
    const n = 1600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = Math.random() * 14; pos[i * 3 + 2] = (Math.random() - 0.5) * 40; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0x8899aa, size: 0.05, transparent: true, opacity: 0.6 }));
    s.add(this.rain);

    this.cam = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400);
  }

  carPose(te) {
    // A: pull out of the space, B: turn onto the road, C: drive away
    const start = 14, turn = 17.6, straight = 19.4;
    if (te < start) return { x: 3, z: 10.4, yaw: 0, v: 0 };
    if (te < turn) { const k = ease((te - start) / (turn - start)); return { x: 3, z: lerp(10.4, 22, k), yaw: 0, v: 3 }; }
    if (te < straight) {
      const k = (te - turn) / (straight - turn), a = Math.PI - k * Math.PI / 2; // quarter circle, radius 4, centre (7, 22)
      return { x: 7 + Math.cos(a) * 4, z: 22 + Math.sin(a) * 4 * -1 * -1, yaw: k * Math.PI / 2, v: 4 };
    }
    const d = te - straight;
    const dist = 4 * d + 0.9 * d * d; // accelerating
    return { x: 7 + dist, z: 26, yaw: Math.PI / 2, v: Math.min(16, 4 + 1.8 * d) };
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    if (this.shot === 1) this.elevatorShot(dt, t);
    else this.outsideShot(dt, t - 7.2);
  }

  elevatorShot(dt, t) {
    const floors = ['B5', 'B4', 'B3', 'B2', 'B1', 'G'];
    const idx = Math.min(floors.length - 1, Math.floor(t / 1.05));
    this.indicator.textContent = `▲ ${floors[idx]}`;
    this.say('e1', 'you', this.solo ? "Going up. I'm actually going UP." : "Going up. We're actually going UP.");
    if (t > 3.4) this.say('e2', 'you', "Dana... I hope you'd be proud.");
    this.camera.position.copy(this.baseCam.pos).add(_v.set((Math.random() - 0.5) * 0.012, Math.sin(t * 30) * 0.004, (Math.random() - 0.5) * 0.012));
    this.camera.quaternion.copy(this.baseCam.quat);
    if (t > 6.0) this.once('ding', () => { this.audio.play('ding'); this.indicator.textContent = 'G  ·  LOBBY'; });
    if (t > 6.3) this.once('fade1', () => this.ui.fade(true, 700));
    this.renderer.render(this.mainScene, this.camera);
    if (t > 7.2) {
      this.indicator.classList.add('hidden');
      this.build();
      this.shot = 2;
      this.ui.fade(false, 1400);
      this.audio.outdoor(true);
    }
  }

  outsideShot(dt, te) {
    const cam = this.cam;
    const sign = this.signMat;
    // --- look back at the building; the sign sputters and dies
    if (te < 2.6) {
      cam.position.set(0, 1.65, -1.6 + te * 0.2);
      _v.set(0, lerp(9.5, 4.5, ease(te / 2.6)), -12);
      cam.lookAt(_v);
      this.say('o1', 'you', this.solo ? 'I made it. I actually made it out.' : 'We made it. We actually made it out.');
      const flick = te > 1.0 && te < 2.1 ? (Math.random() < 0.5 ? 0.1 : 1) : te >= 2.1 ? 0 : 1;
      sign.emissiveIntensity = flick; sign.color.setScalar(flick > 0.5 ? 1 : 0.25);
    } else if (te < 3.6) {
      // turn toward the car
      const k = ease((te - 2.6) / 1.0);
      cam.position.set(0, 1.65, -1.08);
      const a = new THREE.Vector3(0, 4.5, -12), b = new THREE.Vector3(5, 1.5, 10);
      cam.lookAt(a.lerp(b, k));
    } else if (te < 9.6) {
      // walk across the lot
      const k = (te - 3.6) / 6.0;
      const bob = Math.sin(te * 9.5) * 0.035;
      cam.position.set(lerp(0, 5.3, k), 1.65 + bob, lerp(-1.08, 8.4, k));
      cam.lookAt(5 + Math.sin(te * 0.8) * 0.6, 1.4, 14);
      this.stepT = (this.stepT || 0) - dt;
      if (this.stepT <= 0) { this.stepT = 0.5; this.audio.play('stepOutside'); }
      if (te > 4.2) this.say('o2', 'you', 'Fresh air. I never thought a parking lot could look this good.');
      if (te > 7.4) this.say('o3', 'you', 'Nobody is ever going to believe this.');
    } else if (te < 10.6) {
      cam.position.set(5.3, 1.65, 8.4);
      cam.lookAt(lerp(5, 3.5, ease(te - 9.6)), 1.15, lerp(14, 10.4, ease(te - 9.6)));
      if (te > 10.0) this.once('dopen', () => this.audio.play('carDoorOpen'));
      if (te > 10.0) this.doorPivot.rotation.y = -1.1 * ease((te - 10.0) / 0.5);
    } else if (te < 12.0) {
      // climb in
      const k = ease((te - 10.6) / 1.2);
      const seat = this.car.localToWorld(_q.set(0.42, 1.2, -0.2));
      cam.position.set(lerp(5.3, seat.x, k), lerp(1.65, seat.y, k), lerp(8.4, seat.z, k));
      cam.lookAt(lerp(3.5, seat.x, k), 1.15, lerp(10.4, seat.z + 10, k));
      if (te > 11.6) this.doorPivot.rotation.y = -1.1 * (1 - ease((te - 11.6) / 0.35));
    } else {
      // in the car
      if (te > 12.0) this.once('dclose', () => { this.doorPivot.rotation.y = 0; this.audio.play('carDoor'); });
      if (te > 12.6) this.once('keys', () => this.audio.play('keys'));
      if (te > 13.1) this.once('engine', () => { this.audio.engine(true); this.dash.emissiveIntensity = 0.8; this.heads.forEach((h) => { h.intensity = 45; }); });
      if (te > 13.5) this.say('o4', 'you', "Let's go home.");
      const p = this.carPose(te);
      this.car.position.set(p.x, 0, p.z);
      this.car.rotation.y = p.yaw;
      this.audio.engine(true, Math.min(1, p.v / 16));
      this.steer.rotation.z = te > 17.6 && te < 19.4 ? 0.6 : 0;
      const seat = this.car.localToWorld(_q.set(0.42, 1.2 + Math.sin(te * 14) * 0.004 * (p.v > 1 ? 1 : 0), -0.2));
      cam.position.copy(seat);
      const ahead = this.car.localToWorld(new THREE.Vector3(0.3, 1.0, 12));
      cam.lookAt(ahead);
      // streetlights pass overhead
      const near = [];
      for (let x = 20; x < 700; x += 28) if (Math.abs(x - p.x) < 50) near.push(x);
      near.sort((a, b) => Math.abs(a - p.x) - Math.abs(b - p.x));
      this.roadLights.forEach((l, i) => { if (near[i] !== undefined) { l.position.set(near[i], 5.8, 31.5); l.intensity = 70; } else l.intensity = 0; });
      if (te > 21.5) this.say('o5', 'you', "...I'm calling in sick tomorrow.");
      if (te > 24.0) this.once('fadeEnd', () => this.ui.fade(true, 1600));
      if (te > 25.8) this.once('done', () => this.finish());
    }

    // rain follows the camera
    const rp = this.rain.geometry.attributes.position.array;
    for (let i = 0; i < rp.length; i += 3) {
      rp[i + 1] -= 0.25;
      if (rp[i + 1] < 0) { rp[i] = cam.position.x + (Math.random() - 0.5) * 40; rp[i + 1] = 14; rp[i + 2] = cam.position.z + (Math.random() - 0.5) * 40; }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix();
    this.renderer.render(this.scene, cam);
  }

  finish() {
    this.active = false;
    this.audio.engine(false);
    this.ui.letterbox?.(false);
    this.ui.ending(this.stats);
    this.ui.fade(false, 800);
  }
}
