// Mobile detection and the on-screen touch controls that replace keyboard/mouse on a
// phone or tablet: a virtual joystick for movement, a drag zone for the camera, and
// buttons for everything else. Feeds the same Input instance desktop uses, through its
// press()/hold()/addLook() hooks, so player.js and main.js need no touch-specific code.
export function isMobile() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true; // iPadOS
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return touch && !!coarse;
}

const DEADZONE = 0.35;
const JOY_RADIUS = 42;

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.onPause = null;
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.root.innerHTML = `
      <div id="tc-look"></div>
      <div id="tc-left">
        <button id="tc-sprint" class="tc-btn tc-toggle">SPRINT</button>
        <button id="tc-crouch" class="tc-btn tc-toggle">CROUCH</button>
        <div id="tc-joy"><div id="tc-joy-knob"></div></div>
      </div>
      <button id="tc-pause" class="tc-btn tc-pause">II</button>
      <div id="tc-right">
        <div class="tc-row">
          <button id="tc-flash" class="tc-btn tc-small" title="Flashlight">F</button>
          <button id="tc-reload" class="tc-btn tc-small" title="Reload">R</button>
          <button id="tc-swap" class="tc-btn tc-small" title="Swap hands">X</button>
          <button id="tc-drop" class="tc-btn tc-small" title="Drop">Q</button>
        </div>
        <button id="tc-interact" class="tc-btn tc-interact hidden"></button>
        <div class="tc-row tc-main">
          <button id="tc-jump" class="tc-btn tc-mid">JUMP</button>
          <button id="tc-use" class="tc-btn tc-mid">USE</button>
          <button id="tc-fire" class="tc-btn tc-fire">FIRE</button>
        </div>
      </div>
    `;
    document.getElementById('hud').appendChild(this.root);
    const $ = (id) => this.root.querySelector('#' + id);
    const pauseBtn = $('tc-pause');
    pauseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onPause?.(); });
    this.wireEdge($('tc-flash'), 'KeyF');
    this.wireEdge($('tc-reload'), 'KeyR');
    this.wireEdge($('tc-swap'), 'KeyX');
    this.wireEdge($('tc-drop'), 'KeyQ');
    this.wireEdge($('tc-jump'), 'Space');
    this.wireEdge($('tc-use'), 'Mouse2');
    this.wireEdge($('tc-fire'), 'Mouse0');
    this.wireEdge($('tc-interact'), 'KeyE');
    this.wireToggle($('tc-sprint'), 'ShiftLeft');
    this.wireToggle($('tc-crouch'), 'KeyC');
    this.wireJoystick($('tc-joy'), $('tc-joy-knob'));
    this.wireLook($('tc-look'));
  }

  // Edge-triggered: one key "press" per tap, same as a mouse click or a key tapped once.
  wireEdge(el, code) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('down');
      this.input.press(code);
    });
    const up = () => el.classList.remove('down');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  // Held down like Shift or Ctrl: toggles on tap since thumbs are busy on the joystick/buttons.
  wireToggle(el, code) {
    let on = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      on = !on;
      el.classList.toggle('on', on);
      this.input.hold(code, on);
    });
  }

  wireJoystick(base, knob) {
    let activeId = null, originX = 0, originY = 0;
    const reset = () => {
      knob.style.transform = 'translate(0px, 0px)';
      this.input.hold('KeyW', false); this.input.hold('KeyS', false);
      this.input.hold('KeyA', false); this.input.hold('KeyD', false);
    };
    const move = (x, y) => {
      let dx = x - originX, dy = y - originY;
      const d = Math.hypot(dx, dy);
      if (d > JOY_RADIUS) { dx *= JOY_RADIUS / d; dy *= JOY_RADIUS / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / JOY_RADIUS, ny = dy / JOY_RADIUS;
      this.input.hold('KeyW', -ny > DEADZONE);
      this.input.hold('KeyS', ny > DEADZONE);
      this.input.hold('KeyD', nx > DEADZONE);
      this.input.hold('KeyA', -nx > DEADZONE);
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activeId = e.pointerId;
      const r = base.getBoundingClientRect();
      originX = r.left + r.width / 2; originY = r.top + r.height / 2;
      try { base.setPointerCapture(activeId); } catch { /* ignored */ }
      move(e.clientX, e.clientY);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === activeId) move(e.clientX, e.clientY); });
    const end = (e) => { if (e.pointerId === activeId) { activeId = null; reset(); } };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  // Dragging anywhere else on screen turns the camera, like mouse movement.
  wireLook(zone) {
    let activeId = null, lastX = 0, lastY = 0;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activeId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
      try { zone.setPointerCapture(activeId); } catch { /* ignored */ }
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return;
      this.input.addLook(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
    });
    const end = (e) => { if (e.pointerId === activeId) activeId = null; };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  // Mirrors ui.prompt(): the context-sensitive interact button (open door, pick up, etc).
  setPrompt(text) {
    const el = this.root.querySelector('#tc-interact');
    el.classList.toggle('hidden', !text);
    el.textContent = text || '';
  }

  // Chosen on the menu, before joining a lobby — not auto-detected.
  setEnabled(on) {
    this.input.touch = on;
    document.body.classList.toggle('touch', on);
    this.root.classList.toggle('hidden', !on);
  }
}
