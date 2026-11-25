// CAT INCORPORATED — client entry point. Wires networking, rendering, the local player,
// remote players / CEO, world state and UI together.
import * as THREE from 'three';
import { io } from '/socket.io/socket.io.esm.min.js';
import { LEVEL_BY_ID, LEVELS } from '../shared/levels/index.js';
import { C, toTile } from '../shared/grid.js';
import { PLAYER, SEND_RATE } from '../shared/constants.js';
import { World } from './world.js';
import { LocalPlayer } from './player.js';
import { Remotes } from './remotes.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { loadModels } from './models.js';
import { Story } from './story.js';
import { Cutscenes } from './cutscene.js';
import { Finale } from './ending.js';

// ---------------------------------------------------------------- setup
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 90);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const ui = new UI();
const audio = new Audio();
const input = new Input(canvas);
const world = new World(scene);
const me = new LocalPlayer(camera, scene);
const remotes = new Remotes(scene, audio, (x, z) => surfaceAt(x, z));
const story = new Story(document.getElementById('subtitle'));
const cutscenes = new Cutscenes({ scene, camera, world, me, story, audio, ui });
const finale = new Finale({ renderer, mainScene: scene, camera, audio, story, ui });
remotes.onTransform = () => { me.shake = 1.2; };
const NEUTRAL = { dx: 0, dy: 0 };
const modelsReady = loadModels((p) => { document.getElementById('load-pct').textContent = Math.round(p * 100) + '%'; });

const net = io({ transports: ['websocket', 'polling'] });
const G = {
  phase: 'menu', myId: null, lobby: null, level: null, grid: null, flags: new Set(), journal: [],
  roster: [], alive: new Map(), floorIndex: -1, specIdx: 0, deathCam: null, lastSend: 0,
  awareness: 0, interactTarget: null, debug: false, wantFs: localStorage.getItem('catinc.fs') !== '0',
  inGas: false, coughT: 0, breathT: 0, travelling: false, lastHealth: 100,
};
window.__game = G;
window.__dbg = { me, world, remotes, camera, renderer, scene, audio, input, ui, net, story, cutscenes, finale };

// ---------------------------------------------------------------- menu & lobby
const $ = (id) => document.getElementById(id);
const nameVal = () => { const n = $('name').value.trim() || 'Employee'; localStorage.setItem('catinc.name', n); return n; };
function enterLobby(res) {
  if (!res.ok) { ui.error(res.error); return; }
  G.myId = res.id;
  G.phase = 'lobby';
  localStorage.setItem('catinc.lastCode', res.code);
  ui.error('');
  ui.lobby(res.lobby, G.myId);
  ui.screen('lobby');
}
$('btn-create').onclick = () => { audio.init(); net.emit('createRoom', { name: nameVal() }, enterLobby); };
$('btn-join').onclick = () => {
  audio.init();
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 5) return ui.error('Room codes have 5 characters.');
  net.emit('joinRoom', { code, name: nameVal() }, enterLobby);
};
$('btn-continue').onclick = () => {
  audio.init();
  const code = $('save-code').value.trim().toUpperCase();
  if (code.length !== 5) return ui.error('Enter the 5-character code of your previous lobby.');
  net.emit('createRoom', { name: nameVal(), saveCode: code }, enterLobby);
};
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('opt-waypoints').onchange = (e) => net.emit('setting', { key: 'waypoints', value: e.target.checked });
$('btn-copy').onclick = () => navigator.clipboard?.writeText($('lobby-code').textContent);
$('btn-start').onclick = async () => { audio.init(); lockPointer(); ui.screen('loading'); await modelsReady; net.emit('startGame'); };
$('btn-leave').onclick = () => { net.emit('leaveRoom'); G.phase = 'menu'; ui.screen('menu'); };
$('btn-resume').onclick = () => { ui.closeModal(); lockPointer(); };
$('btn-quit').onclick = () => { net.emit('leaveRoom'); location.reload(); };
$('btn-ending').onclick = () => { audio.outdoor(false); $('ending').classList.add('hidden'); G.phase = 'lobby'; ui.screen('lobby'); world.dispose(); };
$('sens').value = input.sens; $('sens').oninput = (e) => input.setSens(+e.target.value);
$('vol').value = localStorage.getItem('catinc.vol') || 0.8; audio.setVolume(+$('vol').value);
$('vol').oninput = (e) => { audio.setVolume(+e.target.value); localStorage.setItem('catinc.vol', e.target.value); };
$('fs').checked = G.wantFs; $('fs').onchange = (e) => { G.wantFs = e.target.checked; localStorage.setItem('catinc.fs', G.wantFs ? '1' : '0'); };
$('click-to-play').onclick = () => lockPointer();
// Any click on the game while it's running captures the mouse so you can look around.
document.addEventListener('mousedown', (e) => {
  if (G.phase !== 'playing' || input.locked || input.typing) return;
  if (ui.modal && ui.modal !== 'pause') return;
  if (e.target.closest('button, input, .modal .menu-card, .paper, .keypad-box')) return;
  if (ui.modal === 'pause') ui.closeModal();
  lockPointer();
});
document.addEventListener('pointerlockerror', () => { if (G.phase === 'playing') ui.clickToPlay(true); });

function lockPointer() {
  audio.init();
  if (G.wantFs && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().then(() => navigator.keyboard?.lock?.(['KeyW', 'KeyT', 'KeyN', 'KeyS', 'KeyD', 'ControlLeft', 'ControlRight']).catch(() => {})).catch(() => {});
  }
  input.lock();
}
document.addEventListener('pointerlockchange', () => {
  if (G.phase !== 'playing') return;
  if (!input.locked) {
    if (ui.modal === 'note' || ui.modal === 'journal') { ui.closeModal(); ui.clickToPlay(true); }
    else if (!ui.modal && !input.typing) ui.showModal('pause');
  } else { ui.clickToPlay(false); if (ui.modal === 'pause') ui.closeModal(); }
});
window.addEventListener('beforeunload', (e) => { if (G.phase === 'playing') { e.preventDefault(); e.returnValue = ''; } });

// chat
const chatInput = $('chat-input');
function openChat() { input.typing = true; chatInput.classList.remove('hidden'); chatInput.value = ''; input.unlock(); setTimeout(() => chatInput.focus(), 0); }
function closeChat(send) {
  if (send && chatInput.value.trim()) net.emit('chat', chatInput.value.trim());
  chatInput.classList.add('hidden'); chatInput.blur(); input.typing = false; lockPointer();
}
chatInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') closeChat(true); if (e.key === 'Escape') closeChat(false); });

window.addEventListener('keydown', (e) => {
  if (G.phase !== 'playing' || input.typing) return;
  if (ui.modal === 'keypad') {
    if (/^\d$/.test(e.key)) ui.keypadPress(e.key);
    else if (e.key === 'Backspace') { ui.keypadValue = ui.keypadValue.slice(0, -1); ui.renderKeypad(); }
    else if (e.key === 'Enter') ui.keypadPress('OK');
    else if (e.key === 'Escape') { ui.closeModal(); lockPointer(); }
    return;
  }
  if ((e.code === 'KeyT' || e.code === 'Enter') && !ui.modal) { e.preventDefault(); openChat(); }
  if ((ui.modal === 'note' && (e.code === 'KeyE' || e.code === 'Escape')) || (ui.modal === 'journal' && (e.code === 'KeyJ' || e.code === 'Escape'))) { ui.closeModal(); input.pressed.delete('KeyE'); if (!input.locked) lockPointer(); return; }
  if (e.code === 'KeyJ' && !ui.modal) ui.openJournal(G.journal);
});

// ---------------------------------------------------------------- networking
net.on('connect', () => { G.myId = net.id; });
net.on('disconnect', () => { if (G.phase === 'playing') ui.message('Connection lost. Reconnecting…', 6); });
net.on('lobby', (l) => {
  G.lobby = l;
  if (G.phase === 'lobby' || G.phase === 'menu') ui.lobby(l, G.myId);
  G.roster = l.players;
  if (G.phase === 'playing') { remotes.setRoster(G.roster.map((p) => ({ ...p, alive: G.alive.get(p.id) !== false })), G.myId); refreshTeam(); }
});

net.on('floor', async (f) => {
  G.invReady = false;
  await modelsReady;
  const changed = f.floorIndex !== G.floorIndex;
  G.floorIndex = f.floorIndex;
  G.level = LEVEL_BY_ID[f.state.levelId];
  G.grid = world.build(f.state.levelId, f.state);
  G.flags = world.flags;
  G.journal = f.journal || [];
  G.debug = f.debug;
  if (G.debug) window.dbg = (cmd) => net.emit('debug', cmd);
  G.roster = f.players;
  G.alive = new Map(f.players.map((p) => [p.id, p.alive]));
  remotes.setRoster(f.players, G.myId);
  remotes.clearBuffers();
  remotes.ceoActive = f.ceoActive;
  me.reset(f.you);
  me.battery = Math.max(me.battery, 35);
  G.deathCam = null; G.travelling = false; G.markerCache = null;
  cutscenes.stop();
  G.sawCeo = false;
  if (changed) story.reset();
  ui.hiding(false); ui.spectate(null); ui.gameover(false);
  ui.objectives(G.level, G.flags);
  refreshTeam();
  audio.setTheme(G.level.theme);
  if (G.flags.has('endOfDay')) audio.setAfterHours(true);
  ui.screen('hud');
  G.phase = 'playing';
  input.enabled = true;
  ui.fade(false, 1500);
  if (changed) { ui.intro(G.level.intro); if (f.floorIndex > 0) audio.play('ding'); story.arrival(G.level.id); }
  if (!input.locked) ui.clickToPlay(true);
});

net.on('snap', (s) => {
  if (G.phase !== 'playing') return;
  remotes.push(s, G.myId);
  for (const p of s.p) {
    const was = G.alive.get(p.id);
    const now = !!(p.f & 16);
    if (was !== now) { G.alive.set(p.id, now); refreshTeam(); }
    if (p.id === G.myId) {
      if (p.hp < G.lastHealth - 0.5 && now) { audio.play('hurt'); }
      G.lastHealth = p.hp;
      me.health = p.hp;
      if (now && !me.alive) { me.alive = true; G.deathCam = null; ui.spectate(null); }
    }
  }
  G.awareness = s.aw?.[G.myId] || 0;
});

net.on('inv', (d) => {
  const prev = new Set(G.invIds || []);
  G.invIds = d.items.map((i) => i.id);
  ui.inventory(d.items);
  if (G.invReady) {
    for (const it of d.items) {
      if (prev.has(it.id)) continue;
      story.pickup(it);
      // batteries go straight into the flashlight when it isn't full
      if (it.kind === 'battery' && me.battery < 95) net.emit('useItem', it.id);
    }
  }
  G.invReady = true;
});
net.on('note', (n) => { ui.openNote(n); audio.play('ui'); story.read(n.id); });
net.on('keypad', (k) => { input.unlock(); ui.openKeypad(k.digits, (code) => net.emit('interact', { id: k.id, code })); });
net.on('keypadResult', (r) => { ui.keypadResult(r.ok); if (r.ok) setTimeout(() => lockPointer(), 750); });
net.on('battery', (d) => { me.battery = d.value; audio.play('insert'); story.batteryIn(); if (!me.flashlight) { me.flashlight = true; audio.play('flashlight'); } });
net.on('teleport', (d) => { me.pos.set(d.x, d.y ?? me.pos.y, d.z); me.vel.set(0, 0, 0); if (d.yaw !== undefined) me.yaw = d.yaw; });
net.on('chat', (c) => ui.chatLine(c));
net.on('ev', handleEvent);

function refreshTeam() { ui.team(G.roster, G.myId, G.alive); }

function handleEvent(e) {
  switch (e.type) {
    case 'door': {
      world.setDoor(e.id, e.open, e.locked);
      const ent = world.ents?.get(e.id);
      if (ent) audio.play(ent.heavy || ent.elevatorDoor || ent.gate ? 'doorHeavy' : 'door', [ent.x, ent.z]);
      break;
    }
    case 'item': {
      world.updateItem(e.item);
      if (e.item.state === 'held' && e.item.holder === G.myId) audio.play('pickup');
      break;
    }
    case 'flag':
      if (e.on) G.flags.add(e.name); else G.flags.delete(e.name);
      if (G.level) ui.objectives(G.level, G.flags);
      if (e.name === 'endOfDay' && e.on) audio.setAfterHours(true);
      if (e.on) story.flag(e.name);
      if (e.on && e.name === 'delivered') cutscenes.thatchMeet();
      break;
    case 'msg': ui.message(e.text, e.dur, e.private); break;
    case 'lights': world.applyLights(e.mode); break;
    case 'sound': audio.play(e.name, e.at); if (e.name === 'slam') me.shake = 1.2; break;
    case 'switch': world.setSwitch(e.id, e.on); break;
    case 'valve': world.setValve(e.id, e.on); break;
    case 'socket': world.setSocket(e.id, e.count); break;
    case 'timer': ui.timer(e.until, e.label); break;
    case 'hide': {
      world.setHidden(e.spot, e.on);
      const ent = world.ents.get(e.spot);
      if (ent) audio.play('hide', [ent.x, ent.z]);
      if (e.player === G.myId) {
        if (e.on) story.hide();
        me.hidden = e.on ? e.spot : null;
        if (e.on && ent) { me.hideYaw = ent.facing; me.yaw = ent.facing; me.pitch = 0; }
        ui.hiding(e.on);
      }
      break;
    }
    case 'hideCheck': {
      world.hideCheck(e.spot);
      const ent = world.ents.get(e.spot);
      if (ent) audio.play('locker', [ent.x, ent.z]);
      break;
    }
    case 'death': {
      G.alive.set(e.id, false);
      refreshTeam();
      if (e.id === G.myId) onMyDeath(e.cause);
      else { ui.message(`${e.name} has been retained.`, 4); audio.scream([e.at[0], 1.5, e.at[1]]); if (me.alive) story.teammateDown(e.name); }
      break;
    }
    case 'gameover': ui.gameover(true); ui.spectate(null); break;
    case 'reload': ui.fade(true, 400); break;
    case 'elevator':
      G.travelling = true;
      audio.play('elevator');
      me.shake = 0.6;
      setTimeout(() => { me.shake = 1.0; }, 1200);
      setTimeout(() => ui.fade(true, 1500), 2400);
      break;
    case 'journal': if (!G.journal.some((j) => j.id === e.entry.id)) G.journal.push(e.entry); break;
    case 'ending':
      G.phase = 'finale'; input.enabled = false; input.unlock();
      cutscenes.stop(); ui.prompt(null); ui.markers([]);
      ui.hiding(false); ui.spectate(null); ui.closeModal();
      world.setDoor('elevator_door', false); me.viewModel.visible = false; me.flashlight = false; me.updateFlashlight(0, {});
      document.getElementById('intro').classList.add('hidden');
      finale.start(e, G.roster.length <= 1, world);
      break;
    case 'say': {
      let who = e.who;
      if (who === 'you' && e.player && e.player !== G.myId) who = G.roster.find((p) => p.id === e.player)?.name || 'Teammate';
      story.say(who, e.text, { priority: true, dur: e.dur });
      break;
    }
    case 'cutscene':
      if (e.id === 'elevatorEscape') { cutscenes.elevatorEscape(e.phase, e); if (e.phase === 'start') { me.hidden = null; ui.hiding(false); ui.closeModal(); } }
      break;
    case 'ceo':
      if (e.what === 'chase') {
        const d = remotes.ceoState ? Math.hypot(remotes.ceoState.x - me.pos.x, remotes.ceoState.z - me.pos.z) : 99;
        if (e.target === G.myId || d < 18) {
          if (e.form === 'human') audio.play('roar', null); else audio.stinger();
          me.shake = 0.5;
          if (e.target === G.myId) story.chase();
        }
      }
      if (e.what === 'lost' && me.alive) story.lost();
      break;
    case 'trap': world.setTrapSealed(); me.shake = 2; break;
    case 'left': G.alive.delete(e.id); break;
    default: break;
  }
}

function onMyDeath(cause) {
  me.alive = false;
  me.hidden = null;
  me.flashlight = false;
  me.updateFlashlight(0, {});
  ui.hiding(false);
  ui.closeModal();
  if (cause === 'ceo' && remotes.ceoRig) {
    G.deathCam = { t: 0, from: camera.position.clone() };
    audio.play('jumpscare');
    ui.flash();
  } else { audio.play('cough'); G.deathCam = null; }
  setTimeout(() => { ui.death(cause); }, cause === 'ceo' ? 1300 : 200);
}

// ---------------------------------------------------------------- helpers
function surfaceAt(x, z) {
  if (!G.grid) return 'carpet';
  const c = G.grid.cell(toTile(x), toTile(z));
  if (c === C.ELEVATOR || c === C.VENT) return 'metal';
  return world.theme?.surface || 'concrete';
}

const _fwd = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function promptFor(it) {
  const e = it.ent;
  switch (e.type) {
    case 'door': {
      const s = world.doorState.get(e.id);
      if (s?.open) return e.gate ? null : e.heavy || e.elevatorDoor ? null : 'Close door';
      if (s?.locked) return e.lock?.key ? `Swipe keycard (${e.lock.key.replace('key_', '').toUpperCase()})` : e.gate ? 'Gate (locked)' : 'Locked door';
      return 'Open door';
    }
    case 'note': return `Read: ${e.title}`;
    case 'terminal': return 'Use terminal';
    case 'dispenser': return 'Use copier';
    case 'socket': return e.title || 'Insert';
    case 'switch': return e.title || 'Throw switch';
    case 'valve': return `Turn ${e.label} valve`;
    case 'monitor': return 'Read monitor';
    case 'keypad': return 'Enter code';
    case 'lever': return 'Pull lever';
    case 'console': return e.title || 'Use console';
    case 'elevator': return 'Elevator panel';
    case 'hide': return e.model === 'cabinet' ? 'Hide in cabinet' : 'Hide in locker';
    default: return 'Interact';
  }
}

function findTarget() {
  const cam = camera.position;
  me.forward(_fwd);
  let best = null, bestScore = Infinity;
  const consider = (id, x, y, z, label, extraRange = 0) => {
    _v.set(x - cam.x, y - cam.y, z - cam.z);
    const d = _v.length();
    if (d > PLAYER.interactRange + extraRange) return;
    _v.divideScalar(d || 1);
    const dot = _v.dot(_fwd);
    if (dot < (d < 1.2 ? 0.45 : 0.86)) return;
    if (!G.grid.lineOfSight(cam.x, cam.z, x, z, (i) => world.doorOpen(i))) return;
    const score = (1 - dot) * 3 + d * 0.1;
    if (score < bestScore) { bestScore = score; best = { id, label }; }
  };
  for (const it of world.interactables) {
    const label = promptFor(it);
    if (!label) continue;
    if (it.ent.type === 'item') continue;
    if (it.ent.type === 'elevator' && !G.grid) continue;
    consider(it.id, it.x, it.y, it.z, label, it.ent.type === 'elevator' ? 0.6 : 0);
  }
  for (const item of world.items.values()) {
    if (item.state !== 'world') continue;
    consider(item.id, item.x, (item.y || 0) + 0.1, item.z, item.kind === 'battery' ? 'Grab battery (loads flashlight)' : `Pick up ${item.name}`, 0.3);
  }
  return best;
}

// ---------------------------------------------------------------- objective markers
// Which entities should be pointed at right now: every unfinished, visible objective's
// targets, minus things already done (items taken, notes read, switches thrown).
function markerTargets() {
  const out = new Map();
  if (!G.level) return out;
  const flags = G.flags;
  const pending = (id) => {
    const item = world.items.get(id);
    if (item) return item.state === 'world';
    const ent = world.ents.get(id);
    if (!ent) return false;
    if (ent.type === 'note') return !flags.has('read_' + id);
    if (ent.type === 'switch' || ent.type === 'valve') return !world.props.get(id)?.prop?.userData.on;
    return true;
  };
  for (const o of G.level.objectives || []) {
    if (o.after && !flags.has(o.after)) continue;
    if (flags.has(o.flag)) continue;
    let ids = (o.targets || []).filter(pending);
    if (!ids.length && o.then) ids = o.then.filter(pending);
    for (const id of ids) {
      const item = world.items.get(id);
      if (item) { out.set(id, { x: item.x, y: (item.y || 0) + 0.45, z: item.z }); continue; }
      const it = world.interactables.find((i) => i.id === id);
      const ent = world.ents.get(id);
      if (it) out.set(id, { x: it.x, y: it.y + 0.45, z: it.z });
      else if (ent) out.set(id, { x: ent.x, y: 1.6, z: ent.z });
    }
  }
  return out;
}

const _mp = new THREE.Vector3();
function updateMarkers(dt) {
  const enabled = G.lobby?.settings?.waypoints !== false && me.alive && !me.hidden && !G.travelling;
  if (!enabled) { ui.markers([]); return; }
  G.markerT = (G.markerT || 0) - dt;
  if (G.markerT <= 0 || !G.markerCache) { G.markerT = 0.25; G.markerCache = markerTargets(); }
  const w = window.innerWidth, h = window.innerHeight, pad = 46;
  const list = [];
  for (const [key, p] of G.markerCache) {
    const dist = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    _mp.set(p.x, p.y, p.z).project(camera);
    const behind = _mp.z > 1;
    let sx = (_mp.x * 0.5 + 0.5) * w, sy = (-_mp.y * 0.5 + 0.5) * h;
    if (behind) { sx = w - sx; sy = h - sy; }
    const onScreen = !behind && sx > pad && sx < w - pad && sy > pad && sy < h - pad;
    let angle = 0;
    if (!onScreen) {
      // clamp to the screen edge along the direction from the centre
      let dx = sx - w / 2, dy = sy - h / 2;
      if (behind && Math.abs(dy) < 1) dy = 1;
      const k = Math.min((w / 2 - pad) / Math.abs(dx || 1e-6), (h / 2 - pad) / Math.abs(dy || 1e-6));
      sx = w / 2 + dx * k; sy = h / 2 + dy * k;
      angle = Math.atan2(dy, dx) * 180 / Math.PI - 45;
    }
    // fade out when you're right on top of it
    const opacity = dist < 1.6 ? 0 : dist < 3 ? (dist - 1.6) / 1.4 : 0.9;
    list.push({ key, x: sx, y: sy, dist, edge: !onScreen, angle, opacity });
  }
  ui.markers(list);
}

// ---------------------------------------------------------------- dialogue triggers
const DISCOVER_MODEL = { tank: 'tank', body: 'body', locker: 'hide', cabinet: 'hide', crate: 'crate', blood: 'blood' };
function storyChecks(dt) {
  if (!me.alive || !G.level) return;
  G.storyT = (G.storyT || 0) - dt;
  if (G.storyT > 0) return;
  G.storyT = 0.3;
  const cam = camera.position;
  me.forward(_fwd);
  // things you notice as you look around
  for (const { ent } of world.props.values()) {
    const kind = DISCOVER_MODEL[ent.model];
    if (!kind) continue;
    const dx = ent.x - cam.x, dz = ent.z - cam.z, d = Math.hypot(dx, dz);
    if (d > 3.6 || d < 0.3) continue;
    if ((dx * _fwd.x + dz * _fwd.z) / d < 0.6) continue;
    if (!G.grid.lineOfSight(cam.x, cam.z, ent.x, ent.z, (i) => world.doorOpen(i))) continue;
    story.discover(kind, G.level.id);
  }
  const tx = toTile(cam.x), tz = toTile(cam.z);
  for (let z = tz - 1; z <= tz + 1; z++) for (let x = tx - 1; x <= tx + 1; x++) if (G.grid.cell(x, z) === C.VENT) story.discover('vent', G.level.id);
  // the CEO
  const c = remotes.ceoState;
  if (c && remotes.ceoActive) {
    const d = Math.hypot(c.x - cam.x, c.z - cam.z);
    if (c.fm !== 'human' && !G.sawCeo && d < 20 && ((c.x - cam.x) * _fwd.x + (c.z - cam.z) * _fwd.z) / d > 0.55 && G.grid.lineOfSight(cam.x, cam.z, c.x, c.z, (i) => world.doorOpen(i))) {
      G.sawCeo = true; story.sighting(G.level.id);
    }
    if (me.hidden && d < 5) story.hideNear();
  }
  if (me.flashlight && me.battery < 15) story.lowBattery();
  if (G.inGas) story.gas();
  if (me.exhausted) story.exhausted();
}

// ---------------------------------------------------------------- main loop
me.onStep = (mode) => audio.footstep(surfaceAt(me.pos.x, me.pos.z), [me.pos.x, me.pos.y + 0.05, me.pos.z], mode, true);
me.onLand = () => { net.emit('noise', 'land'); audio.footstep(surfaceAt(me.pos.x, me.pos.z), [me.pos.x, me.pos.y, me.pos.z], 'sprint', true); };

let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { G.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  story.update();
  if (G.phase === 'finale') { finale.update(dt); return; }
  if (G.phase !== 'playing' || !G.grid) return;

  const inp = input.frame();
  const doorOpen = (id) => world.doorOpen(id);

  cutscenes.update(dt);
  if (me.alive && !G.travelling && cutscenes.lockControls) {
    me.update(dt, NEUTRAL, G.grid, doorOpen);
    ui.prompt(null);
  } else if (me.alive && !G.travelling) {
    if (inp.toggleFlash) {
      if (me.battery <= 0) story.noBattery();
      net.emit('noise', 'flashlight'); audio.play('flashlight');
    }
    me.update(dt, inp, G.grid, doorOpen);
    // inventory
    if (inp.slot !== null) ui.select(inp.slot);
    if (inp.wheel) ui.select((ui.selected + inp.wheel + 8) % 8);
    if (inp.use && ui.selectedItem()) net.emit('useItem', ui.selectedItem().id);
    if (inp.drop && ui.selectedItem()) net.emit('dropItem', ui.selectedItem().id);
    // interaction
    if (me.hidden) {
      ui.prompt('Leave hiding spot');
      if (inp.interact) net.emit('interact', { id: me.hidden });
    } else {
      const t = findTarget();
      G.interactTarget = t;
      ui.prompt(t?.label);
      if (inp.interact && t) net.emit('interact', { id: t.id });
    }
    // gas feedback
    G.inGas = world.inHazard(me.pos.x, me.pos.z);
    if (G.inGas) { G.coughT -= dt; if (G.coughT <= 0) { G.coughT = 1.6 + Math.random(); audio.play('cough'); } }
    if (me.exhausted) { G.breathT -= dt; if (G.breathT <= 0) { G.breathT = 0.8; audio.play('breath'); } }
  } else {
    ui.prompt(null);
    me.updateFlashlight(dt, { toggleFlash: false });
    if (!me.alive) {
      // spectator controls
      const living = remotes.living();
      if (inp.next) G.specIdx++;
      if (inp.prev) G.specIdx--;
      const target = living.length ? living[((G.specIdx % living.length) + living.length) % living.length] : null;
      ui.spectate(target && (!G.deathCam || G.deathCam.t > 1.5) ? target.name : null);
      G.specTarget = target;
    }
  }

  // network upload
  if (now - G.lastSend > 1000 / SEND_RATE && me.alive) {
    G.lastSend = now;
    net.volatile.emit('state', { x: +me.pos.x.toFixed(3), y: +me.pos.y.toFixed(3), z: +me.pos.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), crouch: me.crouch, sprint: me.sprinting, moving: me.moving && me.speedNow > 0.3, flashlight: me.flashlight });
  }

  remotes.update(dt);
  world.update(dt, camera.position);
  updateCamera(dt, now / 1000);

  // HUD + audio
  ui.bars({ health: me.alive ? me.health : 100, stamina: me.stamina, exhausted: me.exhausted, battery: me.battery, inGas: G.inGas });
  ui.awareness(me.alive ? G.awareness : 0);
  ui.tickTimer();
  updateMarkers(dt);
  storyChecks(dt);
  const ceo = remotes.ceoState;
  const dC = ceo ? Math.hypot(ceo.x - camera.position.x, ceo.z - camera.position.z) : 99;
  const chasing = ceo && (ceo.st === 'chase' || (ceo.st === 'scripted' && ceo.fm !== 'human'));
  const danger = ceo && remotes.ceoActive ? Math.max(0, 1 - dC / 22) * 0.8 + G.awareness * 0.4 : 0;
  me.forward(_fwd);
  audio.update(dt, camera.position, _fwd, {
    lightNear: world.lightAt(camera.position.x, camera.position.z),
    ceo, ceoActive: remotes.ceoActive, ceoChasing: chasing, ceoHuman: ceo?.fm === 'human',
    chaseIntensity: chasing && dC < 30 ? 1 : ceo && ceo.st === 'investigate' && dC < 15 ? 0.25 : 0,
    danger: Math.min(1, danger), alive: me.alive,
  });
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

function updateCamera(dt, t) {
  if (cutscenes.applyCamera(dt)) { me.viewModel.visible = false; return; }
  if (me.alive && me.hidden) {
    const pr = world.props.get(me.hidden);
    const local = pr?.prop?.userData.hideCam;
    if (pr && local) {
      _v.copy(local); pr.group.localToWorld(_v);
      camera.position.copy(_v);
      camera.rotation.set(me.pitch, me.yaw + Math.PI, 0, 'YXZ');
      me.viewModel.visible = false;
      return;
    }
  }
  if (me.alive) { me.applyCamera(dt, t); return; }
  me.viewModel.visible = false;
  // death cam: stare into the CEO's face
  if (G.deathCam && G.deathCam.t < 1.5) G.deathCam.t += dt;
  if (G.deathCam && G.deathCam.t < 1.5 && remotes.ceoRig) {
    remotes.ceoRig.headWorldPos(_v2);
    const dir = _v.copy(camera.position).sub(_v2).setY(0).normalize();
    const target = _v2.clone().add(dir.multiplyScalar(0.75)).add(new THREE.Vector3(0, -0.1, 0));
    camera.position.lerp(target, Math.min(1, dt * 8));
    camera.lookAt(_v2);
    camera.position.x += (Math.random() - 0.5) * 0.04; camera.position.y += (Math.random() - 0.5) * 0.04;
    return;
  }
  // spectate a teammate (their own point of view)
  const target = G.specTarget;
  if (target?.state) {
    const s = target.state;
    if (s.hidden) {
      const pr = world.props.get(s.h);
      if (pr?.prop?.userData.hideCam) { _v.copy(pr.prop.userData.hideCam); pr.group.localToWorld(_v); camera.position.copy(_v); camera.rotation.set(0, pr.ent.facing + Math.PI, 0, 'YXZ'); return; }
    }
    const eye = s.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
    camera.position.set(s.x - Math.sin(s.yaw) * 0.15, (s.y || 0) + eye + 0.1, s.z - Math.cos(s.yaw) * 0.15);
    camera.rotation.set(s.pitch || 0, s.yaw + Math.PI, 0, 'YXZ');
    target.rig.root.visible = false; // don't render their head inside the camera
  }
}

ui.screen('menu');
