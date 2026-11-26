// CAT INCORPORATED — client entry point. Wires networking, rendering, the local player,
// remote players / CEO, world state and UI together.
import * as THREE from 'three';
import { io } from '/socket.io/socket.io.esm.min.js';
import { LEVEL_BY_ID, LEVELS } from '../shared/levels/index.js';
import { C, toTile } from '../shared/grid.js';
import { PLAYER, SEND_RATE, DIFFICULTIES, STAPLER, COFFEE, GUN } from '../shared/constants.js';
const WEAPON = { stapler: STAPLER, gun: GUN };
const WEAPON_NAME = { stapler: 'STAPLER', gun: 'PISTOL' };
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
import { Music } from './music.js';
import { StapleFX } from './staples.js';
import { isMobile, TouchControls } from './mobile.js';

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
const touch = new TouchControls(input);
ui.touch = touch;
touch.onPause = () => { if (G.phase === 'playing' && !ui.modal) ui.showModal('pause'); };
ui.onOffhandTap = () => input.press('KeyX');
// Touch controls are a menu option, not auto-detected — isMobile() only picks the
// checkbox's default so phones/tablets start with it on, but anyone can flip it.
const optTouch = document.getElementById('opt-touch');
const storedTouch = localStorage.getItem('catinc.touch');
function setTouchMode(on) { touch.setEnabled(on); localStorage.setItem('catinc.touch', on ? '1' : '0'); }
setTouchMode(optTouch.checked = storedTouch !== null ? storedTouch === '1' : isMobile());
optTouch.onchange = (e) => setTouchMode(e.target.checked);
const world = new World(scene);
const me = new LocalPlayer(camera, scene);
const remotes = new Remotes(scene, audio, (x, z) => surfaceAt(x, z));
const story = new Story(document.getElementById('subtitle'));
const cutscenes = new Cutscenes({ scene, camera, world, me, story, audio, ui });
const finale = new Finale({ renderer, mainScene: scene, camera, audio, story, ui });
remotes.onTransform = () => { me.shake = 1.2; };
const NEUTRAL = { dx: 0, dy: 0 };
const modelsReady = loadModels((p) => { document.getElementById('load-pct').textContent = Math.round(p * 100) + '%'; });
// The local player is created before the GLBs arrive: swap in the real flashlight model.
modelsReady.then(() => me.refreshViewModel());

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
$('opt-difficulty').onchange = (e) => net.emit('setting', { key: 'difficulty', value: e.target.value });
$('btn-copy').onclick = () => navigator.clipboard?.writeText($('lobby-code').textContent);
$('btn-start').onclick = async () => { audio.init(); lockPointer(); ui.screen('loading'); await modelsReady; net.emit('startGame'); };
$('btn-leave').onclick = () => { net.emit('leaveRoom'); G.phase = 'menu'; ui.screen('menu'); };
$('btn-resume').onclick = () => { ui.closeModal(); lockPointer(); };
// Close/cancel buttons for the note, journal and keypad modals — the only way off them
// without a keyboard (mirrors the E/J/Esc keyboard shortcuts below).
const closeModalTap = () => { ui.closeModal(); if (!input.locked) lockPointer(); };
$('note-close').onclick = closeModalTap;
$('journal-close').onclick = closeModalTap;
$('keypad-cancel').onclick = closeModalTap;
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
  remotes.grid = G.grid;
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
  stapleFX.clear();
  (f.ceoStaples || []).forEach((s) => stapleFX.attach(s));
  G.reloadEnd = 0; G.escapeClosed = false; G.offChosen = false; G.flashReload = null; me.reloadingFlash = false; me.boostUntil = 0; G.deadHint = false;
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
  if (changed) {
    const d = DIFFICULTIES[G.lobby?.settings?.difficulty];
    const lines = [...(G.level.intro || [])];
    if (d && G.lobby.settings.difficulty !== 'normal') lines[2] = `${lines[2] ? lines[2] + ' · ' : ''}${d.label.toUpperCase()} DIFFICULTY`;
    ui.intro(lines);
  }
  if (changed) { if (f.floorIndex > 0) audio.play('ding'); story.arrival(G.level.id); }
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
  G.items = d.items;
  // staplers: staples loaded in each one; spare staples in boxes
  // weapons (stapler, gun): rounds loaded in each one; spare ammo by ammo kind
  G.weapons = new Map(d.items.filter((i) => WEAPON[i.kind]).map((i) => [i.id, { kind: i.kind, ammo: i.ammo || 0 }]));
  G.reserve = {};
  for (const i of d.items) if (i.kind === 'staples' || i.kind === 'gunammo') G.reserve[i.kind] = (G.reserve[i.kind] || 0) + (i.count || 0);
  if (d.reloading > 0) { G.reloadStart = performance.now(); G.reloadEnd = G.reloadStart + d.reloading * 1000; audio.play(d.items.find((i) => i.id === G.reloadStaplerId)?.kind === 'gun' ? 'gunReload' : 'staplerOpen'); }
  else if (G.reloadEnd) {
    G.reloadEnd = 0;
    const st = d.items.find((i) => i.id === G.reloadStaplerId) || d.items.find((i) => WEAPON[i.kind]);
    if (st?.kind === 'gun') audio.play('gunLoad');
    else if (st) { audio.play('staplerLoad'); story.say('you', st.ammo >= STAPLER.magazine ? 'Loaded. Twenty staples.' : 'Loaded what I had.', { key: 'reloaded', cooldown: 30 }); }
  }
  refreshInventory();
  if (G.invReady) {
    for (const it of d.items) {
      if (prev.has(it.id)) continue;
      story.pickup(it);
      // a new stapler / gun goes straight into your hand, ready to use
      if (it.kind === 'stapler' || it.kind === 'gun') { const k = ui.items.findIndex((i) => i.id === it.id); if (k >= 0) ui.select(k); }
    }
  }
  G.invReady = true;
});
net.on('jackpot', () => { me.shake = Math.max(me.shake, 0.4); setTimeout(() => story.say('you', "Wait. It did something. It did SOMETHING!", { priority: true }), 400); });
net.on('ammo', (a) => {
  if (a.msg) ui.message(a.msg, 2.5, true);
  if (a.dry) { audio.play('dry'); if (G.weapons?.size && !G.reserve?.staples) story.say('you', 'Empty. I need more staples.', { key: 'nostaples', cooldown: 25 }); }
});
net.on('note', (n) => { ui.openNote(n); audio.play('ui'); story.read(n.id); });
net.on('keypad', (k) => { input.unlock(); ui.openKeypad(k.digits, (code) => net.emit('interact', { id: k.id, code })); });
net.on('keypadResult', (r) => { ui.keypadResult(r.ok); if (r.ok) setTimeout(() => lockPointer(), 750); });
net.on('battery', (d) => { me.battery = d.value; audio.play('insert'); story.batteryIn(); if (!me.flashlight && me.flashHand) { me.flashlight = true; audio.play('flashlight'); } G.deadHint = false; });
net.on('medkit', (d) => { me.health = d.health; me.stamina = PLAYER.maxStamina; me.exhausted = false; story.say('you', pick(['That\'s better. I can breathe again.', 'Patched up. Keep moving.']), { key: 'medkit', cooldown: 20 }); });
net.on('boost', (d) => { me.boostUntil = performance.now() + d.dur * 1000; me.stamina = PLAYER.maxStamina; me.exhausted = false; story.say('you', pick(['Oh, that\'s strong. I feel like I could run forever.', 'Burnt, bitter... perfect. Let\'s go.']), { key: 'coffee', cooldown: 30 }); });
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
        if (!e.on) { me.vel.set(0, 0, 0); me.crouch = false; }
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
      world.setDoor('elevator_door', false); me.hideHands(); me.flashlight = false; me.updateFlashlight(0, {});
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
      if (e.id === 'elevatorEscape') { if (e.phase === 'closed') G.escapeClosed = true; cutscenes.elevatorEscape(e.phase, e); if (e.phase === 'start') { me.hidden = null; ui.hiding(false); ui.closeModal(); } }
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
      if (e.what === 'blind') {
        remotes.blindFlare();
        const d = remotes.ceoState ? Math.hypot(remotes.ceoState.x - me.pos.x, remotes.ceoState.z - me.pos.z) : 99;
        if (me.alive && (e.by === G.myId || d < 20)) {
          me.shake = Math.max(me.shake, 0.3);
          if (e.by === G.myId) story.say('you', e.form === 'human' ? 'Right in the eyes! Go, go!' : "It worked — he can't see! Move!", { priority: true });
          else story.say(G.roster.find((p) => p.id === e.by)?.name || 'you', 'I blinded him! Run!', { priority: true });
        }
      }
      if (e.what === 'stun') {
        me.shake = Math.max(me.shake, 0.25);
        if (e.by !== G.myId && me.alive) story.say(G.roster.find((p) => p.id === e.by)?.name || 'you', 'I stapled him! He\'s down!', { priority: true });
      }
      if (e.what === 'unstun') { stapleFX.release(); if (me.alive && remotes.ceoState && Math.hypot(remotes.ceoState.x - me.pos.x, remotes.ceoState.z - me.pos.z) < 20) story.say('you', "He's getting back up!", { key: 'unstun', cooldown: 15, priority: true }); }
      if (e.what === 'unblind' && me.alive && remotes.ceoState && Math.hypot(remotes.ceoState.x - me.pos.x, remotes.ceoState.z - me.pos.z) < 18) story.say('you', "He's shaking it off...", { key: 'unblind', cooldown: 20 });
      break;
    case 'trap': world.setTrapSealed(); me.shake = 2; break;
    case 'staple': {
      stapleFX.shot(e);
      if (e.by !== G.myId) audio.play(e.weapon === 'gun' ? 'gunshot' : 'staple', [e.from[0], e.from[2]]);
      if (e.by === G.myId && e.hit) story.say('you', e.weapon === 'gun' ? (e.stunned ? "He's DOWN. That'll hold him for a while!" : 'Hit him!') : e.stunned ? pick(['Got him!', 'Right in him — MOVE!', "He's down! Go, go!"]) : 'Another one in him.', { priority: true, key: 'staplehit', cooldown: e.stunned ? 0 : 6 });
      break;
    }
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
// ---------------------------------------------------------------- flashlight stun HUD
// The server decides whether a beam blinds him; this mirrors its aim test so the
// crosshair can show when the light is on his eyes, and shows blind / recharge state.
const STUN = { duration: 5, cooldown: 15 };
const _eyes = new THREE.Vector3();
function aimingAtEyes() {
  const rig = remotes.ceoRig, c = remotes.ceoState;
  if (!rig || !c || !me.flashlight || !me.alive || me.hidden) return false;
  rig.headWorldPos(_eyes);
  const d = _eyes.distanceTo(camera.position);
  if (d > 11 || d < 0.6) return false;
  me.forward(_fwd);
  _v.copy(_eyes).sub(camera.position).normalize();
  return Math.acos(Math.max(-1, Math.min(1, _v.dot(_fwd)))) < Math.atan2(0.3, d) + 0.04;
}
function updateStun(dt) {
  const el = $('stun');
  const c = remotes.ceoState;
  const playing = G.phase === 'playing' && me.alive && c && remotes.ceoActive && !cutscenes.active;
  let mode = null, label = '', fill = 0;
  if (playing && c.sn > 0) { mode = 'stunned'; label = `THATCH IS STUNNED · ${Math.ceil(c.sn)}s`; fill = c.sn / (c.sm || STAPLER.stun); }
  else if (playing && c.bl > 0) { mode = 'blind'; label = 'THATCH IS BLINDED'; fill = c.bl / STUN.duration; }
  else if (playing && c.cd > 0) { mode = 'cool'; label = `Flashlight stun recharging · ${Math.ceil(c.cd)}s`; fill = 1 - c.cd / STUN.cooldown; }
  else if (playing) {
    const near = Math.hypot(c.x - me.pos.x, c.z - me.pos.z) < 14;
    if (G.stunWasCooling) { G.stunWasCooling = false; G.stunReadyT = 3; audio.play('stunReady'); }
    if (G.stunReadyT > 0 || (near && me.flashlight)) { mode = 'ready'; label = 'Flashlight stun ready — shine it in his eyes'; fill = 1; }
    G.stunReadyT = Math.max(0, (G.stunReadyT || 0) - dt);
  }
  if (mode === 'cool') G.stunWasCooling = true;
  if (playing && G.grid && G.grid.cell(toTile(c.x), toTile(c.z)) === C.VENT && Math.hypot(c.x - me.pos.x, c.z - me.pos.z) < 12) story.say('you', "He's in the vents! He's coming through the vents!", { key: 'ceovent', cooldown: 40, priority: true });
  if (playing && c.fm === 'monster' && !G.stunTipShown && Math.hypot(c.x - me.pos.x, c.z - me.pos.z) < 16) {
    G.stunTipShown = true;
    setTimeout(() => ui.message('Tip: shine your flashlight straight into his eyes to blind him for 5 seconds.', 7), 2500);
  }
  el.classList.toggle('hidden', !mode);
  el.className = mode ? mode : 'hidden';
  if (mode) { $('stun-label').textContent = label; $('stun-fill').style.width = `${Math.round(fill * 100)}%`; }
  $('crosshair').classList.toggle('stun-aim', !!(playing && !(c.sn > 0) && !(c.bl > 0) && !(c.cd > 0) && aimingAtEyes()));
}

// ---------------------------------------------------------------- the stapler
const stapleFX = new StapleFX(scene, remotes, audio);
const music = new Music(audio);
Object.assign(window.__dbg, { music, stapleFX, G, hands: { useHeld, swapHands, reloadHeld, dropHeld, toggleFlashlight } });
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const raycaster = new THREE.Raycaster();
const STAPLE_BONES = new Set(['Torso', 'Neck', 'Head', 'Arm_R', 'Arm_L', 'Forearm_R', 'Forearm_L', 'Leg_R', 'Leg_L', 'Shin_R', 'Shin_L']);

// ---------------------------------------------------------------- hands
// Main hand = the selected hotbar slot (right side of the screen). The off hand holds one
// more item (left side). Everyone starts with the flashlight in the off hand.
const CONSUMABLE = new Set(['medkit', 'coffee']);
const mainItem = () => ui.selectedItem() || null;
const offItem = () => (G.items || []).find((i) => i.id === G.offId) || null;
const handItem = (which) => (which === 'main' ? mainItem() : offItem());

function refreshInventory() {
  const items = G.items || [];
  if (G.offId && !items.some((i) => i.id === G.offId)) G.offId = null;
  if (!G.offId && !G.offChosen) G.offId = items.find((i) => i.kind === 'flashlight')?.id || null;
  const sel = ui.selectedItem()?.id;
  const hot = items.filter((i) => i.id !== G.offId);
  ui.inventory(hot);
  const k = sel ? hot.findIndex((i) => i.id === sel) : -1;
  if (k >= 0 && k !== ui.selected) ui.select(k);
  // the item you were holding is gone (used up, dropped, crumbled): keep that hand empty
  // rather than letting the next item slide into it and get used by your next click
  else if (sel && k < 0) ui.select(Math.min(7, hot.length));
  ui.offhand(offItem());
  syncHands();
}

function syncHands() {
  const m = mainItem(), o = offItem();
  me.setHand('main', m);
  me.setHand('off', o);
  me.flashHand = m?.kind === 'flashlight' ? 'main' : o?.kind === 'flashlight' ? 'off' : null;
}

// X: the held item goes to the off hand; what was there comes back to the hotbar.
function swapHands() {
  const m = mainItem(), o = offItem();
  if (!m && !o) return;
  G.offChosen = true;
  G.offId = m ? m.id : null;
  refreshInventory();
  if (o) { const k = ui.items.findIndex((i) => i.id === o.id); if (k >= 0) ui.select(k); }
  audio.play('ui');
  syncHands();
}

function toggleFlashlight() {
  if (!me.flashHand) return ui.message('Your flashlight is in your bag. Select it, or press X to hold it in your off hand.', 2.5, true);
  if (me.reloadingFlash) return;
  if (me.battery <= 0) {
    story.noBattery();
    return ui.message((G.items || []).some((i) => i.kind === 'battery') ? 'Dead battery. Press R to put a new one in.' : 'Dead battery. Find a battery.', 2.5, true);
  }
  me.flashlight = !me.flashlight;
  net.emit('noise', 'flashlight'); audio.play('flashlight');
}

function useHeld(which) {
  // empty main hand: a click uses whatever is in your off hand (the flashlight by default)
  if (which === 'main' && !mainItem() && offItem()) which = 'off';
  const it = handItem(which);
  if (!it || me.hidden && it.kind !== 'flashlight') return;
  switch (it.kind) {
    case 'flashlight': toggleFlashlight(); break;
    case 'stapler': case 'gun': fireStapler(it.id, which); break;
    case 'gunammo': tryReload([...(G.weapons || new Map())].find(([, w]) => w.kind === 'gun')?.[0]); break;
    case 'battery': reloadFlashlight(); break;
    case 'staples': tryReload(); break;
    case 'medkit':
      if (me.health >= PLAYER.maxHealth && me.stamina >= PLAYER.maxStamina - 1) return ui.message("You're not hurt, and you've got your breath.", 2, true);
      me.useHandAnim(which); audio.play('medkit'); net.emit('useItem', it.id); break;
    case 'coffee':
      me.useHandAnim(which); net.emit('useItem', it.id); break;
    case 'nothing':
      me.kickHand(which); net.emit('useItem', it.id); break;
    default: ui.message('Use it on something nearby with E.', 1.6, true);
  }
}

// R: reload whatever needs it in your hands (main hand first).
function reloadHeld() {
  for (const which of ['main', 'off']) {
    const it = handItem(which);
    if (WEAPON[it?.kind]) return tryReload(it.id);
    if (it?.kind === 'flashlight') return reloadFlashlight();
  }
  ui.message('Hold the stapler or the flashlight to reload it.', 2, true);
}

// Swapping batteries: about a second and a half with the light off, then the server
// takes the battery and the flashlight is full again.
function reloadFlashlight() {
  if (G.flashReload) return;
  if (!me.flashHand) return ui.message('Hold your flashlight to change its battery.', 2, true);
  if (me.battery >= PLAYER.maxBattery - 1) return ui.message("The battery's still full.", 2, true);
  const bat = (G.items || []).find((i) => i.kind === 'battery');
  if (!bat) { audio.play('dry'); return ui.message('No spare batteries. Find one.', 2.5, true); }
  G.flashReload = { start: performance.now(), end: performance.now() + 1500, battery: bat.id };
  me.reloadingFlash = true;
  audio.play('staplerOpen');
}
function updateFlashReload() {
  const r = G.flashReload;
  if (!r || performance.now() < r.end) return;
  G.flashReload = null;
  me.reloadingFlash = false;
  if ((G.items || []).some((i) => i.id === r.battery)) net.emit('useItem', r.battery);
}

function dropHeld() {
  const it = mainItem();
  if (!it) return;
  if (it.kind === 'flashlight') return ui.message("You can't drop your flashlight.", 2, true);
  net.emit('dropItem', it.id);
}

function tryReload(id) {
  const st = id || [...(G.weapons || new Map())].find(([, w]) => w.kind === 'stapler')?.[0] || [...(G.weapons || new Map()).keys()][0];
  if (!st || G.reloadEnd) return;
  const w = G.weapons.get(st), W = WEAPON[w.kind];
  if (w.ammo >= W.magazine) return ui.message("It's already full.", 2, true);
  if (!G.reserve[W.ammoKind]) { audio.play('dry'); return ui.message(w.kind === 'gun' ? 'No bullets left.' : 'No staples to load. Find a box of staples.', 2.5, true); }
  G.reloadStaplerId = st;
  net.emit('reload', st);
}

// The server decides hits. Our own raycast against his model only says which bone the
// staple should stick to (and where), so it lands on the same spot for everyone.
function fireStapler(id, which) {
  const w = G.weapons?.get(id);
  if (!w) return;
  const W = WEAPON[w.kind], loaded = w.ammo;
  if (G.reloadEnd) return ui.message('Reloading...', 1.2, true);
  const now = performance.now();
  if (now - (G.lastFire || 0) < W.fireInterval * 1000) return;
  if (loaded <= 0) {
    audio.play('dry');
    ui.message(G.reserve[W.ammoKind] ? 'Empty — press R to reload.' : w.kind === 'gun' ? 'Out of bullets.' : 'Out of staples. Find a box of staples.', 2, true);
    return;
  }
  G.lastFire = now;
  const dir = me.forward(new THREE.Vector3());
  let hit = null;
  const rig = remotes.ceoRig;
  if (rig?.model && remotes.ceoActive) {
    raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir);
    raycaster.far = W.range;
    const hits = raycaster.intersectObject(rig.model, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !STAPLE_BONES.has(o.name)) o = o.parent;
      if (!o) continue;
      const local = o.worldToLocal(h.point.clone());
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
      const ln = n.clone().transformDirection(new THREE.Matrix4().copy(o.matrixWorld).invert()).normalize();
      hit = { bone: o.name, local: local.toArray().map((v) => +v.toFixed(3)), normal: ln.toArray().map((v) => +v.toFixed(3)) };
      break;
    }
  }
  net.emit('fire', { id, dir: dir.toArray().map((v) => +v.toFixed(4)), hit });
  w.ammo = loaded - 1; // the server's inventory update follows right away
  audio.play(w.kind === 'gun' ? 'gunshot' : 'staple');
  if (w.kind === 'gun') me.shake = Math.max(me.shake, 0.35);
  me.kickHand(which);
  me.shake = Math.max(me.shake, 0.08);
}

function updateAmmoHud() {
  const el = $('ammo');
  const m = mainItem(), o = offItem();
  // show the weapon you're holding (main hand first), else the first one you carry
  const which = WEAPON[m?.kind] ? 'main' : WEAPON[o?.kind] ? 'off' : null;
  const sid = which ? handItem(which).id : [...(G.weapons || new Map()).keys()][0];
  const wpn = sid ? G.weapons.get(sid) : null;
  const loaded = wpn ? wpn.ammo : 0;
  const reserve = wpn ? G.reserve[WEAPON[wpn.kind].ammoKind] || 0 : 0;
  const show = !!sid && G.phase === 'playing' && me.alive;
  el.classList.toggle('hidden', !show);
  const now = performance.now();
  const reloading = G.reloadEnd > 0;
  const k = reloading ? Math.min(1, (now - G.reloadStart) / (G.reloadEnd - G.reloadStart)) : -1;
  // hand animations: stapler reload in whichever hand holds that stapler, battery swap for the flashlight
  const reload = {};
  for (const w of ['main', 'off']) {
    const it = handItem(w);
    if (reloading && it?.id === G.reloadStaplerId) reload[w] = k;
    if (G.flashReload && it?.kind === 'flashlight') reload[w] = Math.min(1, (now - G.flashReload.start) / (G.flashReload.end - G.flashReload.start));
  }
  me.updateHands(G.dt || 0, { reload });
  // coffee timer
  const left = Math.max(0, me.boostUntil - now) / 1000;
  $('boost').classList.toggle('hidden', !(left > 0 && me.alive && G.phase === 'playing'));
  if (left > 0) $('boost-fill').style.width = `${(left / COFFEE.duration) * 100}%`;
  // dead flashlight in hand: say how to fix it, once
  if (me.flashHand && me.battery <= 0 && !G.deadHint && me.alive) {
    G.deadHint = true;
    ui.message((G.items || []).some((i) => i.kind === 'battery') ? 'Flashlight battery is dead — press R to load a new one.' : 'Flashlight battery is dead. Find a battery.', 4, true);
  }
  if (!show) return;
  $('ammo-name').textContent = WEAPON_NAME[wpn.kind];
  $('ammo-loaded').textContent = loaded;
  $('ammo-reserve').textContent = reserve;
  el.classList.toggle('empty', loaded <= 0);
  el.classList.toggle('reloading', reloading);
  el.classList.toggle('dim', !which && !reloading);
  $('reload-fill').style.width = `${Math.round(Math.max(0, k) * 100)}%`;
  const click = which === 'off' ? 'right click' : 'left click';
  $('ammo-hint').textContent = reloading ? `RELOADING · ${Math.max(0, (G.reloadEnd - now) / 1000).toFixed(1)}s`
    : !which ? `select slot ${ui.items.findIndex((i) => i.id === sid) + 1} to use`
      : loaded <= 0 ? (reserve ? 'EMPTY · press R to reload' : wpn.kind === 'gun' ? 'EMPTY · no bullets left' : 'EMPTY · find a box of staples') : `${click} to fire`;
}

// ---------------------------------------------------------------- music
// One track at a time: chase > elevator > base soundtrack.
function updateMusic() {
  if (audio.ready && !music.ready) music.init();
  if (!music.ready) return;
  let want = null;
  if (G.phase === 'finale') want = finale.shot === 1 ? 'elevator' : null;
  else if (G.phase === 'playing') {
    const c = remotes.ceoState;
    const escape = cutscenes.active === 'elevatorEscape' && !G.escapeClosed;
    const chasing = c && remotes.ceoActive && c.st === 'chase' && !(c.sn > 0) && !(c.bl > 0);
    const inLift = G.travelling || (G.grid && G.grid.cell(toTile(me.pos.x), toTile(me.pos.z)) === C.ELEVATOR);
    want = escape || chasing ? 'chase' : inLift ? 'elevator' : 'base';
  }
  music.set(want);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { G.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  story.update();
  if (G.phase === 'finale') { finale.update(dt); return; }
  if (G.phase !== 'playing' || !G.grid) return;

  input.blocked = !!ui.modal;
  const inp = input.frame();
  const doorOpen = (id) => world.doorOpen(id);

  cutscenes.update(dt);
  if (me.alive && !G.travelling && cutscenes.lockControls) {
    me.update(dt, NEUTRAL, G.grid, doorOpen);
    ui.prompt(null);
  } else if (me.alive && !G.travelling) {
    if (inp.toggleFlash) toggleFlashlight();
    me.update(dt, { ...inp, toggleFlash: false }, G.grid, doorOpen);
    // hands & inventory
    if (inp.slot !== null) ui.select(inp.slot);
    if (inp.wheel) ui.select((ui.selected + inp.wheel + 8) % 8);
    syncHands();
    if (inp.swap) swapHands();
    if (inp.useMain) useHeld('main');
    if (inp.useOff) {
      // right click drinks / heals with what's in your hand, otherwise uses the off hand
      if (CONSUMABLE.has(mainItem()?.kind)) useHeld('main'); else useHeld('off');
    }
    if (inp.reload) reloadHeld();
    if (inp.drop) dropHeld();
    updateFlashReload();
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
  updateStun(dt);
  G.dt = dt;
  updateAmmoHud();
  stapleFX.update(dt);
  updateMusic();
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
  if (cutscenes.applyCamera(dt)) { me.hideHands(); return; }
  if (me.alive && me.hidden) {
    const pr = world.props.get(me.hidden);
    const local = pr?.prop?.userData.hideCam;
    if (pr && local) {
      _v.copy(local); pr.group.localToWorld(_v);
      camera.position.copy(_v);
      camera.rotation.set(me.pitch, me.yaw + Math.PI, 0, 'YXZ');
      me.hideHands();
      return;
    }
  }
  if (me.alive) { me.applyCamera(dt, t); return; }
  me.hideHands();
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
