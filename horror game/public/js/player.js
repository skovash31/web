// Local first-person controller: movement, collision, crouch/jump, stamina,
// flashlight & battery, head-bob, hiding camera and the two hands: the main hand (right
// of screen, the selected hotbar slot) and the off hand (left), each showing what it holds.
import * as THREE from 'three';
import { PLAYER, WALL_H, VENT_CEIL, COFFEE } from '../shared/constants.js';
import { C, toTile } from '../shared/grid.js';
import { makeFlashlight, makeStapler } from './models.js';
import { buildItem } from './props.js';

const P = PLAYER;

export class LocalPlayer {
  constructor(camera, scene) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.crouch = false; this.crouchAmt = 0;
    this.onGround = true;
    this.stamina = P.maxStamina; this.exhausted = false;
    this.battery = P.maxBattery; this.flashlight = false;
    this.health = P.maxHealth; this.alive = true;
    this.hidden = null;
    this.moving = false; this.sprinting = false;
    this.bob = 0; this.bobAmt = 0;
    this.stepPhase = 0;
    this.solids = [];
    this.shake = 0;
    this.hideYaw = 0;
    this.onStep = null; this.onLand = null;
    this.speedNow = 0;
    this.boostUntil = 0; // coffee: performance.now() timestamp

    // Flashlight: spotlight + held view model
    this.spot = new THREE.SpotLight(0xfff1d8, 0, 32, 0.52, 0.55, 1.3);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(512, 512);
    this.spot.shadow.camera.near = 0.2;
    this.spot.shadow.camera.far = 30;
    this.spot.shadow.bias = -0.0015;
    camera.add(this.spot);
    this.spot.position.set(0.12, -0.1, 0.05);
    this.spot.target.position.set(0, -0.05, -10);
    camera.add(this.spot.target);
    this.hands = { main: this.makeHand(1), off: this.makeHand(-1) };
    this.handsHidden = false;
    this.flashHand = null; // 'main' | 'off' | null — which hand holds the flashlight
    this.fill = new THREE.PointLight(0xfff1d8, 0, 3.5, 2); // faint bounce so near walls read
    camera.add(this.fill);
    this.fill.position.set(0, 0, -0.8);
    scene.add(camera);
  }

  reset(you) {
    this.pos.set(you.x, you.y || 0, you.z);
    this.vel.set(0, 0, 0);
    this.yaw = you.yaw ?? this.yaw; this.pitch = 0;
    this.alive = you.alive !== false;
    this.health = you.health ?? P.maxHealth;
    this.stamina = P.maxStamina; this.exhausted = false;
    this.hidden = null;
    this.crouch = false;
  }

  get boosted() { return performance.now() < this.boostUntil; }

  get eyeHeight() { return P.eyeStand + (P.eyeCrouch - P.eyeStand) * this.crouchAmt; }
  get height() { return P.standHeight + (P.crouchHeight - P.standHeight) * this.crouchAmt; }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  // Solid test for a capsule (as a vertical box) at (x,z) spanning [y0,y1]
  collides(grid, doorOpen, x, z, y0, y1) {
    const r = P.radius;
    grid.solidsNear(x, z, doorOpen, this.solids);
    for (const s of this.solids) {
      if (x + r <= s.minX || x - r >= s.maxX || z + r <= s.minZ || z - r >= s.maxZ) continue;
      // circle vs box precise test
      const cx = Math.max(s.minX, Math.min(x, s.maxX)), cz = Math.max(s.minZ, Math.min(z, s.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 >= r * r) continue;
      if (y1 <= s.bottom || y0 >= s.top) continue;
      return s;
    }
    return null;
  }

  groundAt(grid, doorOpen, x, z, feet) {
    const r = P.radius * 0.9;
    let g = 0;
    grid.solidsNear(x, z, doorOpen, this.solids);
    for (const s of this.solids) {
      if (s.top > 5) continue;
      if (x + r <= s.minX || x - r >= s.maxX || z + r <= s.minZ || z - r >= s.maxZ) continue;
      if (s.top <= feet + P.stepHeight && s.top > g && s.bottom < 0) g = s.top;
    }
    return g;
  }

  ceilingAt(grid, x, z) {
    const c = grid.cell(toTile(x), toTile(z));
    return c === C.VENT ? VENT_CEIL : WALL_H;
  }

  update(dt, input, grid, doorOpen) {
    if (!this.alive) return;
    // Hidden: limited look-around, no movement
    if (this.hidden) {
      this.yaw += -input.dx;
      this.pitch = Math.max(-0.5, Math.min(0.4, this.pitch - input.dy));
      const d = ((this.yaw - this.hideYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw = this.hideYaw + Math.max(-0.7, Math.min(0.7, d));
      this.moving = false; this.sprinting = false;
      this.stamina = Math.min(P.maxStamina, this.stamina + P.staminaRegen * dt);
      this.updateFlashlight(dt, input);
      return;
    }
    this.yaw -= input.dx;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - input.dy));
    this.unstick(grid, doorOpen);

    // Crouch (hold). Can't stand up under a low ceiling.
    const wantCrouch = input.crouch;
    if (wantCrouch) this.crouch = true;
    else if (this.crouch) {
      const ceil = Math.min(this.ceilingAt(grid, this.pos.x + P.radius, this.pos.z), this.ceilingAt(grid, this.pos.x - P.radius, this.pos.z), this.ceilingAt(grid, this.pos.x, this.pos.z + P.radius), this.ceilingAt(grid, this.pos.x, this.pos.z - P.radius));
      if (this.pos.y + P.standHeight < ceil - 0.02 && !this.collides(grid, doorOpen, this.pos.x, this.pos.z, this.pos.y + 0.05, this.pos.y + P.standHeight)) this.crouch = false;
    }
    this.crouchAmt += ((this.crouch ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 12);

    // Movement intent
    let mx = 0, mz = 0;
    if (input.f) mz += 1; if (input.b) mz -= 1;
    if (input.r) mx += 1; if (input.l) mx -= 1;
    const len = Math.hypot(mx, mz);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    let wishX = 0, wishZ = 0;
    if (len > 0) { wishX = (fx * mz + rx * mx) / len; wishZ = (fz * mz + rz * mx) / len; }
    this.moving = len > 0;
    const boosted = this.boosted;
    const canSprint = input.sprint && mz > 0 && !this.crouch && (boosted || (!this.exhausted && this.stamina > 0));
    this.sprinting = canSprint && this.moving;
    let speed = this.crouch ? P.crouchSpeed : this.sprinting ? P.sprintSpeed : P.walkSpeed;
    if (this.exhausted && !boosted) speed *= 0.85;
    if (this.health < 35) speed *= 0.9;
    if (boosted) speed *= COFFEE.speed;

    // Stamina (coffee: running costs nothing)
    if (this.sprinting && !boosted) {
      this.stamina -= P.sprintDrain * dt;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    } else {
      this.stamina = Math.min(P.maxStamina, this.stamina + P.staminaRegen * dt * (this.moving ? 0.6 : 1));
      if (this.exhausted && this.stamina >= P.exhaustedUntil) this.exhausted = false;
    }

    // Horizontal velocity (snappy acceleration on ground, limited in air)
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (wishX * speed - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wishZ * speed - this.vel.z) * Math.min(1, accel * dt);

    // Jump
    if (input.jump && this.onGround && !this.crouch) {
      const ceil = this.ceilingAt(grid, this.pos.x, this.pos.z);
      if (ceil > 2) { this.vel.y = P.jumpSpeed; this.onGround = false; }
    }
    this.vel.y -= P.gravity * dt;

    // Horizontal collision: axis separated, with step-up onto low props
    const h = this.height;
    const tryAxis = (nx, nz) => {
      const hit = this.collides(grid, doorOpen, nx, nz, this.pos.y + 0.02, this.pos.y + h);
      if (!hit) return true;
      if (hit.top <= this.pos.y + P.stepHeight && this.onGround) {
        const ceil = this.ceilingAt(grid, nx, nz);
        if (!this.collides(grid, doorOpen, nx, nz, hit.top + 0.01, hit.top + h) && hit.top + h < ceil) { this.pos.y = hit.top; return true; }
      }
      return false;
    };
    const steps = Math.ceil((Math.abs(this.vel.x) + Math.abs(this.vel.z)) * dt / 0.15) || 1;
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + this.vel.x * dt / steps;
      if (tryAxis(nx, this.pos.z)) this.pos.x = nx; else this.vel.x = 0;
      const nz = this.pos.z + this.vel.z * dt / steps;
      if (tryAxis(this.pos.x, nz)) this.pos.z = nz; else this.vel.z = 0;
    }

    // Vertical
    const fallSpeed = -this.vel.y;
    let ny = this.pos.y + this.vel.y * dt;
    const ground = this.groundAt(grid, doorOpen, this.pos.x, this.pos.z, this.pos.y);
    const ceil = this.ceilingAt(grid, this.pos.x, this.pos.z);
    if (ny + h > ceil) { ny = ceil - h; if (this.vel.y > 0) this.vel.y = 0; }
    if (ny <= ground) {
      if (!this.onGround && fallSpeed > 3.5) this.onLand?.(fallSpeed);
      ny = ground; this.vel.y = 0; this.onGround = true;
    } else if (ny > ground + 0.05) this.onGround = false;
    this.pos.y = ny;

    // Head bob + footsteps
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);
    const bobTarget = this.onGround && this.speedNow > 0.4 ? Math.min(1, this.speedNow / P.walkSpeed) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 8);
    if (this.onGround && this.speedNow > 0.4) {
      const prev = this.stepPhase;
      this.stepPhase += dt * (this.sprinting ? 11 : this.crouch ? 5 : 7.5);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.stepPhase / Math.PI)) this.onStep?.(this.sprinting ? 'sprint' : this.crouch ? 'crouch' : 'walk');
    }
    this.updateFlashlight(dt, input);
  }

  // ---------------------------------------------------------------- hands
  makeHand(side) {
    const g = new THREE.Group();
    g.visible = false;
    this.camera.add(g);
    return { side, g, itemId: null, kind: null, model: null, top: null, kick: 0, anim: null, base: new THREE.Vector3(0.25 * side, -0.24, -0.46) };
  }

  // Put an inventory item (or nothing) in a hand. Rebuilds the held model only when it changes.
  setHand(which, item) {
    const h = this.hands[which];
    const id = item?.id || null;
    if (h.itemId === id && h.built) return;
    h.itemId = id; h.kind = item?.kind || null; h.top = null; h.setOn = null; h.kick = 0;
    if (h.model) h.g.remove(h.model);
    h.model = null;
    h.built = true;
    if (!item) return;
    let m;
    if (item.kind === 'flashlight') {
      m = makeFlashlight(); m.scale.setScalar(0.85); h.setOn = m.userData.setOn;
    } else if (item.kind === 'stapler' && (m = makeStapler())) {
      h.top = m.top; m = m.root; m.scale.setScalar(1.25);
    } else {
      // any other item: its world model, sized to sit in the palm
      m = buildItem(item.kind, item.key);
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const k = 0.14 / Math.max(0.01, size.x, size.y, size.z);
      m.scale.multiplyScalar(k);
      m.position.set(-(box.min.x + size.x / 2) * k, -(box.min.y + size.y / 2) * k, -(box.min.z + size.z / 2) * k);
      const wrap = new THREE.Group(); wrap.add(m);
      // tilt flat things up so you can see them
      if (['keycard', 'file', 'report'].includes(item.kind)) wrap.rotation.x = 1.1;
      else wrap.rotation.set(0.25, -0.5 * h.side, 0);
      m = wrap;
    }
    m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 2; } });
    h.model = m;
    h.g.add(m);
  }

  // Animations: 'fire' kick, reload progress per hand (0..1 or -1).
  kickHand(which) { const h = this.hands[which]; if (h) h.kick = 1; }
  useHandAnim(which) { const h = this.hands[which]; if (h) h.use = 1; }

  updateHands(dt, { reload = {} } = {}) {
    for (const which of ['main', 'off']) {
      const h = this.hands[which];
      h.g.visible = !!h.model && this.alive && !this.hidden && !this.handsHidden;
      if (!h.g.visible) continue;
      h.kick = Math.max(0, h.kick - dt * 6);
      h.use = Math.max(0, (h.use || 0) - dt * 1.4);
      const bobY = Math.sin(this.stepPhase * 2) * 0.03 * this.bobAmt;
      const bobX = Math.cos(this.stepPhase) * 0.02 * this.bobAmt;
      h.g.position.copy(h.base);
      h.g.position.x += bobX * 0.5;
      h.g.position.y += bobY * 0.6 - (this.sprinting ? 0.05 : 0);
      h.g.position.z += h.kick * 0.05;
      let rx = (this.sprinting ? 0.25 : 0) + 0.04 + h.kick * 0.25, ry = 0.06 * h.side, rz = 0, top = -h.kick * 0.18;
      const r = reload[which] ?? -1;
      if (r >= 0) {
        const open = r < 0.15 ? r / 0.15 : r > 0.85 ? (1 - r) / 0.15 : 1;
        const wobble = r > 0.3 && r < 0.7 ? Math.sin(r * 40) * 0.04 : 0;
        if (h.kind === 'stapler') {
          // tip it up, flip the top open, slot the strip in, snap it shut
          rx = open * 0.55; rz = open * 0.5 * h.side; ry = (0.06 - open * 0.3) * h.side;
          top = open * 1.0 + wobble;
          h.g.position.y += open * 0.06 + (r > 0.3 && r < 0.7 ? Math.sin(r * 20) * 0.01 : 0);
        } else if (h.kind === 'flashlight') {
          // point it up, unscrew the cap, drop a fresh battery in
          rx = open * 1.1; rz = open * Math.sin(r * 30) * 0.3;
          h.g.position.y -= open * 0.06;
        }
      }
      if (h.use > 0) {
        // raise it to your face: tip the mug back / open the kit
        const u = Math.sin(Math.min(1, (1 - h.use) / 0.7) * Math.PI);
        h.g.position.x -= h.base.x * 0.7 * u; h.g.position.y += 0.12 * u; h.g.position.z += 0.12 * u;
        rx -= 0.9 * u;
      }
      h.g.rotation.set(rx, ry, rz);
      if (h.top) h.top.rotation.x = top;
    }
  }

  hideHands() { this.handsHidden = true; this.hands.main.g.visible = false; this.hands.off.g.visible = false; }

  refreshViewModel() {
    // models just finished loading: rebuild whatever is in hand
    for (const which of ['main', 'off']) { const h = this.hands[which]; h.built = false; this.setHand(which, h.itemId ? { id: h.itemId, kind: h.kind } : null); }
  }

  // Safety net: if we ever end up overlapping a solid (a server correction, leaving a
  // locker, a door closing on us), nudge out to the nearest free spot instead of freezing.
  unstick(grid, doorOpen) {
    const h = this.height;
    if (!this.collides(grid, doorOpen, this.pos.x, this.pos.z, this.pos.y + 0.02, this.pos.y + h)) return false;
    for (let r = 0.1; r <= 1.6; r += 0.1) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
        if (!this.collides(grid, doorOpen, x, z, this.pos.y + 0.02, this.pos.y + h)) { this.pos.x = x; this.pos.z = z; return true; }
      }
    }
    return false;
  }

  updateFlashlight(dt, input) {
    if (input.toggleFlash) {
      if (this.battery > 0 && this.flashHand) this.flashlight = !this.flashlight;
      else this.flashlight = false;
      input.flashToggled = true;
    }
    if (!this.flashHand || this.reloadingFlash) this.flashlight = false;
    // the beam comes from whichever hand holds it
    this.spot.position.x = this.flashHand === 'off' ? -0.12 : 0.12;
    if (this.flashlight) {
      this.battery = Math.max(0, this.battery - P.batteryDrain * dt);
      if (this.battery <= 0) this.flashlight = false;
    }
    let intensity = this.flashlight ? 38 : 0;
    // dying battery flickers
    if (this.flashlight && this.battery < 15 && Math.random() < 0.08 + (15 - this.battery) * 0.01) intensity *= Math.random() * 0.4;
    if (this.flashlight && this.battery < 15) intensity *= 0.5 + this.battery / 30;
    this.spot.intensity = intensity;
    this.fill.intensity = this.flashlight ? 0.6 : 0;
    const fh = this.flashHand && this.hands[this.flashHand];
    fh?.setOn?.(intensity > 5);
  }

  applyCamera(dt, t) {
    const cam = this.camera;
    const bobY = Math.sin(this.stepPhase * 2) * 0.035 * this.bobAmt;
    const bobX = Math.cos(this.stepPhase) * 0.03 * this.bobAmt;
    cam.position.set(this.pos.x + Math.cos(this.yaw) * bobX, this.pos.y + this.eyeHeight + bobY, this.pos.z - Math.sin(this.yaw) * bobX);
    let shakeX = 0, shakeY = 0;
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt); shakeX = (Math.random() - 0.5) * this.shake * 0.08; shakeY = (Math.random() - 0.5) * this.shake * 0.08; }
    const breathe = this.exhausted ? Math.sin(t * 9) * 0.008 : Math.sin(t * 1.6) * 0.002;
    cam.rotation.set(this.pitch + shakeY + breathe, this.yaw + Math.PI + shakeX, 0, 'YXZ');
    this.handsHidden = false; // main re-hides them for cutscenes / death cams after this
  }
}
