// Keyboard / mouse input with pointer lock. Exposes a per-frame snapshot.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.dx = 0; this.dy = 0;
    this.sens = Number(localStorage.getItem('catinc.sens') || 1);
    this.wheel = 0;
    this.enabled = false; // gameplay keys only while playing
    this.typing = false;
    this.mouseButtons = new Set();
    window.addEventListener('keydown', (e) => {
      if (this.typing) return;
      if (this.enabled && (e.ctrlKey || ['Space', 'Tab', 'KeyS', 'KeyD', 'KeyW', 'KeyF', 'KeyJ', 'KeyG', 'KeyQ'].includes(e.code))) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => { if (document.pointerLockElement === canvas) this.pressed.add('Mouse' + e.button); });
    document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    window.addEventListener('wheel', (e) => { if (document.pointerLockElement === canvas) this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  get locked() { return document.pointerLockElement === this.canvas; }
  lock() {
    if (this.locked || !this.canvas.requestPointerLock) return;
    const plain = () => { try { const r = this.canvas.requestPointerLock(); r?.catch?.(() => {}); } catch { /* ignored */ } };
    try {
      // raw mouse input where supported; fall back to the plain request
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r?.catch) r.catch(plain);
    } catch { plain(); }
  }
  unlock() { if (this.locked) document.exitPointerLock(); }

  setSens(v) { this.sens = v; localStorage.setItem('catinc.sens', v); }

  frame() {
    const k = this.keys, p = this.pressed;
    const active = this.locked && this.enabled && !this.typing;
    const s = 0.0022 * this.sens;
    const out = {
      f: active && k.has('KeyW'), b: active && k.has('KeyS'), l: active && k.has('KeyA'), r: active && k.has('KeyD'),
      sprint: active && (k.has('ShiftLeft') || k.has('ShiftRight')),
      crouch: active && (k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC')),
      jump: active && p.has('Space'),
      interact: active && p.has('KeyE'),
      toggleFlash: active && (p.has('KeyF') || p.has('Mouse2')),
      use: active && p.has('KeyQ'),
      drop: active && p.has('KeyG'),
      fire: active && p.has('Mouse0'),
      reload: active && p.has('KeyR'),
      slot: null,
      wheel: active ? this.wheel : 0,
      next: active && (p.has('Mouse0') || p.has('ArrowRight')),
      prev: active && (p.has('Mouse2') || p.has('ArrowLeft')),
      dx: active ? this.dx * s : 0, dy: active ? this.dy * s : 0,
      pressed: new Set(p),
    };
    for (let i = 1; i <= 8; i++) if (active && p.has('Digit' + i)) out.slot = i - 1;
    this.dx = 0; this.dy = 0; this.wheel = 0;
    p.clear();
    return out;
  }
}
