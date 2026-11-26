// DOM-based UI: menus, lobby, HUD, modals and overlays.
import { PLAYER_COLORS, ITEM_INFO, DIFFICULTIES } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const ICON = { keycard: '💳', battery: '🔋', medkit: '✚', file: '📁', report: '📄', fuse: '⚡', specimen: '🧪', tape: '📼', stapler: '🗜️', staples: '📎', flashlight: '🔦', coffee: '☕', nothing: '🔴' };

export class UI {
  constructor() {
    this.$ = $;
    this.msgEls = [];
    this.modal = null;
    this.keypadValue = '';
    this.keypadDigits = 4;
    this.selected = 0;
    this.items = [];
    this.timerEnd = 0;
    // keypad buttons
    const keys = $('keypad-keys');
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
      const b = document.createElement('button');
      b.textContent = k;
      b.onclick = () => this.keypadPress(k);
      keys.appendChild(b);
    }
    $('name').value = localStorage.getItem('catinc.name') || '';
    $('save-code').value = localStorage.getItem('catinc.lastCode') || '';
    this.grain();
  }

  screen(name) {
    for (const id of ['menu', 'lobby', 'loading']) $(id).classList.toggle('hidden', id !== name);
    $('hud').classList.toggle('hidden', name !== 'hud');
  }

  error(t) { $('menu-error').textContent = t || ''; }

  lobby(l, myId) {
    $('lobby-code').textContent = l.code;
    $('pause-code').textContent = `Room / save code: ${l.code}`;
    $('lobby-floor').textContent = l.floorIndex > 0 ? `Resuming at ${l.floorLabel} — ${l.floorName}` : 'Starting a new shift at LEVEL G';
    const ul = $('lobby-players');
    ul.innerHTML = '';
    for (const p of l.players) {
      const li = document.createElement('li');
      li.style.borderColor = hex(PLAYER_COLORS[p.color]);
      li.innerHTML = `<span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>${p.id === l.hostId ? '<span class="host">HOST</span>' : ''}`;
      ul.appendChild(li);
    }
    const host = l.hostId === myId;
    const wp = $('opt-waypoints');
    wp.checked = l.settings?.waypoints !== false;
    wp.disabled = !host;
    const df = $('opt-difficulty');
    const diff = DIFFICULTIES[l.settings?.difficulty] ? l.settings.difficulty : 'normal';
    df.value = diff;
    df.disabled = !host;
    $('diff-desc').textContent = DIFFICULTIES[diff].desc;
    $('settings-host').classList.toggle('hidden', host);
    $('btn-start').classList.toggle('hidden', !host);
    $('lobby-wait').classList.toggle('hidden', host);
  }

  // ------------------------------------------------------------ HUD
  prompt(text) {
    const el = $('prompt');
    if (text) { el.innerHTML = `<b>E</b>${escapeHtml(text)}`; $('crosshair').classList.add('active'); }
    else { el.innerHTML = ''; $('crosshair').classList.remove('active'); }
  }

  message(text, dur = 4, priv = false) {
    const box = $('messages');
    // de-duplicate repeated messages
    const last = this.msgEls.at(-1);
    if (last && last.textContent === text) { clearTimeout(last._t); last._t = setTimeout(() => this.dropMsg(last), dur * 1000); return; }
    const d = document.createElement('div');
    d.className = 'msg' + (priv ? ' private' : '');
    d.textContent = text;
    box.appendChild(d);
    this.msgEls.push(d);
    while (this.msgEls.length > 4) this.dropMsg(this.msgEls[0], true);
    d._t = setTimeout(() => this.dropMsg(d), dur * 1000);
  }
  dropMsg(d, now) {
    const i = this.msgEls.indexOf(d);
    if (i >= 0) this.msgEls.splice(i, 1);
    if (now) d.remove(); else { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }
  }

  objectives(level, flags) {
    $('obj-floor').textContent = `${level.label} · ${level.name.toUpperCase()}`;
    const ul = $('obj-list');
    ul.innerHTML = '';
    for (const o of level.objectives || []) {
      if (o.after && !flags.has(o.after)) continue;
      const li = document.createElement('li');
      li.textContent = o.text;
      if (flags.has(o.flag)) li.className = 'done';
      ul.appendChild(li);
    }
  }

  bars(p) {
    $('bar-health').style.width = Math.max(0, p.health) + '%';
    $('bar-stamina').style.width = p.stamina + '%';
    $('bar-stamina').classList.toggle('exhausted', p.exhausted);
    $('bar-battery').style.width = p.battery + '%';
    $('hurt').style.opacity = p.health < 100 ? Math.min(0.9, (100 - p.health) / 90) * (p.inGas ? 1 : 0.6) : 0;
  }

  inventory(items) {
    this.items = items;
    if (this.selected >= Math.max(1, items.length)) this.selected = Math.max(0, items.length - 1);
    const el = $('inventory');
    el.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const it = items[i];
      const d = document.createElement('div');
      d.className = 'slot' + (i === this.selected && it ? ' sel' : '');
      d.innerHTML = `<span class="n">${i + 1}</span>${it ? ICON[it.kind] || '?' : ''}${it && i === this.selected ? `<span class="lbl">${escapeHtml(it.name)}</span>` : ''}`;
      el.appendChild(d);
    }
  }
  select(i) { this.selected = Math.max(0, Math.min(7, i)); this.inventory(this.items); }
  // The off hand: one item held in the left hand, shown beside the hotbar.
  offhand(it) {
    const el = $('offhand');
    if (!el) return;
    el.classList.toggle('full', !!it);
    el.innerHTML = `<span class="n">X</span>${it ? ICON[it.kind] || '?' : ''}<span class="lbl">${it ? escapeHtml(it.name) : 'off hand'}</span>`;
  }
  selectedItem() { return this.items[this.selected]; }

  team(players, myId, aliveMap) {
    const el = $('team');
    el.innerHTML = '';
    for (const p of players) {
      const d = document.createElement('div');
      d.style.color = hex(PLAYER_COLORS[p.color]);
      d.textContent = p.name + (p.id === myId ? ' (you)' : '') + (aliveMap.get(p.id) === false ? ' — retained' : '');
      if (aliveMap.get(p.id) === false) d.className = 'dead';
      el.appendChild(d);
    }
  }

  awareness(a) {
    const e = $('eye');
    e.style.opacity = a > 0.05 ? Math.min(1, 0.3 + a) : 0;
    e.style.color = a >= 1 ? '#ff2a1a' : a > 0.4 ? '#ffaa30' : '#dddddd';
    e.style.borderColor = e.style.color;
  }

  timer(sec, label) {
    this.timerEnd = performance.now() + sec * 1000;
    this.timerLabel = label;
    $('timer').classList.remove('hidden');
  }
  tickTimer() {
    if (!this.timerEnd) return;
    const left = (this.timerEnd - performance.now()) / 1000;
    if (left <= 0) { this.timerEnd = 0; $('timer').classList.add('hidden'); return; }
    $('timer').textContent = `${this.timerLabel} ${left.toFixed(1)}`;
  }

  // Objective markers: list of {key, x, y (screen px), dist, edge, angle}
  markers(list) {
    const box = $('markers');
    this.markerEls = this.markerEls || new Map();
    const seen = new Set();
    for (const m of list) {
      seen.add(m.key);
      let el = this.markerEls.get(m.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'marker';
        el.innerHTML = '<div class="pin"></div><span></span>';
        box.appendChild(el);
        this.markerEls.set(m.key, el);
      }
      el.classList.toggle('edge', m.edge);
      el.style.left = m.x + 'px'; el.style.top = m.y + 'px';
      el.style.opacity = m.opacity;
      el.firstChild.style.transform = m.edge ? `rotate(${m.angle}deg)` : 'rotate(45deg)';
      el.lastChild.textContent = `${Math.round(m.dist)} m`;
    }
    for (const [k, el] of this.markerEls) if (!seen.has(k)) { el.remove(); this.markerEls.delete(k); }
  }

  // ------------------------------------------------------------ modals
  openNote(n) {
    $('note-title').textContent = n.title;
    $('note-text').textContent = n.text;
    $('note').querySelector('.paper').classList.toggle('terminal', !!n.terminal);
    this.showModal('note');
  }
  openKeypad(digits, onSubmit) {
    this.keypadDigits = digits; this.keypadValue = ''; this.keypadSubmit = onSubmit;
    this.renderKeypad();
    $('keypad-display').classList.remove('ok');
    this.showModal('keypad');
  }
  keypadPress(k) {
    if (k === 'C') this.keypadValue = '';
    else if (k === 'OK') { if (this.keypadValue.length === this.keypadDigits) this.keypadSubmit?.(this.keypadValue); return; }
    else if (this.keypadValue.length < this.keypadDigits) this.keypadValue += k;
    this.renderKeypad();
  }
  renderKeypad() { $('keypad-display').textContent = this.keypadValue.padEnd(this.keypadDigits, '_'); }
  keypadResult(ok) {
    const d = $('keypad-display');
    if (ok) { d.classList.add('ok'); d.textContent = 'OPEN'; setTimeout(() => this.closeModal(), 700); }
    else { d.textContent = 'DENIED'; this.keypadValue = ''; setTimeout(() => this.renderKeypad(), 700); }
  }
  openJournal(entries) {
    const list = $('journal-list');
    list.innerHTML = entries.length ? '' : '<p>No documents found yet.</p>';
    for (const e of entries) {
      const d = document.createElement('div');
      d.className = 'entry';
      d.innerHTML = `<h4>▸ ${escapeHtml(e.title)}</h4><pre>${escapeHtml(e.text)}</pre>`;
      d.querySelector('h4').onclick = () => d.classList.toggle('open');
      list.appendChild(d);
    }
    this.showModal('journal');
  }
  showModal(id) { this.closeModal(); this.modal = id; $(id).classList.remove('hidden'); }
  closeModal() { if (this.modal) $(this.modal).classList.add('hidden'); this.modal = null; }

  // ------------------------------------------------------------ overlays
  fade(on, ms = 1200) {
    const f = $('fade');
    f.style.transition = `opacity ${ms}ms`;
    f.classList.remove('hidden');
    requestAnimationFrame(() => { f.style.opacity = on ? 1 : 0; });
    if (!on) setTimeout(() => { if (f.style.opacity === '0') f.classList.add('hidden'); }, ms + 50);
  }
  intro(lines) {
    const el = $('intro');
    el.classList.add('hidden'); void el.offsetWidth; el.classList.remove('hidden');
    $('intro-l1').textContent = lines[0] || ''; $('intro-l2').textContent = lines[1] || ''; $('intro-l3').textContent = lines[2] || '';
    clearTimeout(this._introT); this._introT = setTimeout(() => el.classList.add('hidden'), 6000);
  }
  flash() { const f = $('flash'); f.classList.add('hidden'); void f.offsetWidth; f.classList.remove('hidden'); setTimeout(() => f.classList.add('hidden'), 650); }
  death(cause) {
    const el = $('death');
    $('death-sub').textContent = cause === 'gas' ? 'The air on B4 was not meant for employees.' : 'Mr. Thatch thanks you for your contribution. You can watch your team.';
    el.classList.add('hidden'); void el.offsetWidth; el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4200);
  }
  gameover(on) { $('gameover').classList.toggle('hidden', !on); }
  spectate(name) {
    const el = $('spectate');
    if (!name) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `SPECTATING <b>${escapeHtml(name)}</b><br><span class="hint">[click] next teammate · you'll be back on the next floor</span>`;
  }
  letterbox(on) { $('letterbox').classList.toggle('on', on); document.body.classList.toggle('cinematic', on); }
  hiding(on) { $('slats').classList.toggle('hidden', !on); $('hide-hint').classList.toggle('hidden', !on); $('crosshair').classList.toggle('hidden', on); }
  clickToPlay(on) { $('click-to-play').classList.toggle('hidden', !on); }

  chatLine(c) {
    const log = $('chat-log');
    const d = document.createElement('div');
    d.style.color = hex(PLAYER_COLORS[c.color]);
    d.innerHTML = `<b>${escapeHtml(c.name)}${c.dead ? ' (dead)' : ''}:</b> <span style="color:#ddd">${escapeHtml(c.text)}</span>`;
    log.appendChild(d);
    while (log.children.length > 7) log.firstChild.remove();
    setTimeout(() => { d.style.opacity = 0.0; }, 12000);
  }

  ending(stats) {
    $('ending-stats').textContent = `Time: ${Math.floor(stats.time / 60)}m ${stats.time % 60}s · Employees retained along the way: ${stats.deaths}`;
    $('ending').classList.remove('hidden');
  }

  grain() {
    const c = $('grain');
    c.width = 256; c.height = 144;
    const x = c.getContext('2d');
    const img = x.createImageData(256, 144);
    const draw = () => {
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      x.putImageData(img, 0, 0);
      setTimeout(draw, 70);
    };
    draw();
  }
}

export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export { ITEM_INFO };
