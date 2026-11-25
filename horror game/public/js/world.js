// Builds and animates a floor: tile geometry, props, doors, items, lights, hazards.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Grid, C, tileCenter, toTile } from '../shared/grid.js';
import { TILE, WALL_H, VENT_CEIL } from '../shared/constants.js';
import { LEVEL_BY_ID } from '../shared/levels/index.js';
import { tex, textTexture } from './textures.js';
import { buildProp, buildItem, box, mat } from './props.js';

export const THEMES = {
  office: { floor: 'carpet', wall: 'wallPaint', ceil: 'ceiling', fog: 0x15161a, fogD: 0.018, amb: 0.85, light: 0xfff1dc, lightI: 42, surface: 'carpet', door: 'wood' },
  archives: { floor: 'oldCarpet', wall: 'wood', ceil: 'ceiling', fog: 0x040302, fogD: 0.05, amb: 0.06, light: 0xffcf90, lightI: 24, surface: 'carpet', door: 'wood' },
  lab: { floor: 'tiles', wall: 'labWall', ceil: 'ceiling', fog: 0x06080a, fogD: 0.04, amb: 0.14, light: 0xe4f0ff, lightI: 30, surface: 'tile', door: 'metal' },
  containment: { floor: 'concrete', wall: 'concreteWall', ceil: 'concrete', fog: 0x030304, fogD: 0.055, amb: 0.07, light: 0xc8d4ff, lightI: 24, surface: 'concrete', door: 'metal' },
  bio: { floor: 'bioFloor', wall: 'bioWall', ceil: 'concrete', fog: 0x020503, fogD: 0.055, amb: 0.08, light: 0xc0ffcc, lightI: 24, surface: 'tile', door: 'metal' },
  executive: { floor: 'marble', wall: 'execWall', ceil: 'ceiling', fog: 0x060304, fogD: 0.045, amb: 0.08, light: 0xffd8a8, lightI: 26, surface: 'marble', door: 'wood' },
};

const INTERACT = new Set(['door', 'item', 'note', 'terminal', 'dispenser', 'socket', 'switch', 'valve', 'monitor', 'keypad', 'lever', 'console', 'elevator', 'hide']);
const POOL = 10;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = null;
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 15, 1.25);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
    this.hemi = new THREE.HemisphereLight(0x8899aa, 0x222018, 0.1);
    scene.add(this.hemi);
    this.time = 0;
  }

  dispose() {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry && o.userData.ownGeo) o.geometry.dispose(); });
    this.root = null;
  }

  build(levelId, state) {
    this.dispose();
    const level = LEVEL_BY_ID[levelId];
    this.level = level;
    this.grid = new Grid(level);
    this.theme = THEMES[level.theme];
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.doorState = new Map(state.doors.map((d) => [d.id, { ...d }]));
    this.flags = new Set(state.flags);
    this.lightsMode = state.lights;
    this.codes = state.codes;
    this.ents = new Map(this.grid.entities.map((e) => [e.id, e]));
    this.props = new Map();
    this.doorViews = new Map();
    this.itemViews = new Map();
    this.items = new Map();
    this.interactables = [];
    this.hazardViews = [];
    this.fire = null;
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    const th = this.theme;
    this.scene.fog = new THREE.FogExp2(th.fog, th.fogD);
    this.scene.background = new THREE.Color(th.fog);
    this.hemi.intensity = th.amb;

    this.buildTiles(th);
    const staticGroup = new THREE.Group();
    this.root.add(staticGroup);
    // Entities
    for (const e of this.grid.entities) {
      let model = e.model;
      if (!model) model = { hide: 'locker', terminal: 'terminal', elevator: 'elevatorPanel', keypad: 'keypad', valve: 'valve', lever: 'lever', console: 'console', switch: 'breaker', note: e.base ? null : 'paperNote' }[e.type];
      if (e.type === 'monitor') model = null;
      const g = new THREE.Group();
      g.position.set(e.x, 0, e.z);
      g.rotation.y = e.facing || 0;
      if (e.base && e.type !== 'monitor') { const b = buildProp(e.base === 'pedestal' ? 'pedestal' : 'desk', e, rnd); g.add(b); }
      if (e.type === 'monitor') {
        const m = buildProp('terminal', e, rnd); g.add(m);
      }
      if (e.type === 'note' && e.base) { const p = buildProp('paperNote', e, rnd); p.position.y = (e.solid || 0.78) + 0.01; p.scale.setScalar(1.2); g.add(p); }
      let pr = null;
      if (model && e.type !== 'door') { pr = buildProp(model, e, rnd); g.add(pr); }
      staticGroup.add(g);
      this.props.set(e.id, { group: g, prop: pr, ent: e });
      if (e.type === 'door') this.buildDoor(e, staticGroup);
      if (INTERACT.has(e.type) && e.type !== 'item') {
        const iy = e.type === 'note' ? (e.base ? 0.9 : 0.2) : (pr?.userData.interactY ?? (e.type === 'door' ? 1.2 : 1.0));
        // wall-mounted panels: the interact point is on the wall face behind the tile centre
        const wallMounted = ['switch', 'valve', 'keypad', 'lever', 'elevator', 'socket', 'console'].includes(e.type) && !e.solid && e.model !== 'generator';
        const off = wallMounted ? -0.8 : 0;
        const f = e.facing || 0;
        this.interactables.push({ id: e.id, ent: e, x: e.x + Math.sin(f) * off, y: iy, z: e.z + Math.cos(f) * off });
      }
    }
    // Items
    for (const it of state.items) this.updateItem(it);
    // Switch / valve / socket visual state
    for (const [id, on] of Object.entries(state.switches || {})) this.setSwitch(id, on);
    for (const [id, on] of Object.entries(state.valves || {})) this.setValve(id, on);
    this.batchStatic(staticGroup);
    this.buildLights(th);
    this.buildHazards();
    this.applyLights(this.lightsMode);
    if (state.trap?.sealed) this.setTrapSealed();
    return this.grid;
  }

  // ------------------------------------------------------------ tiles
  buildTiles(th) {
    const g = this.grid;
    const floorTiles = [], ceilTiles = [], wallTiles = [], ventTiles = [], elevTiles = [], glassTiles = [];
    const isOpenish = (x, z) => { const c = g.cell(x, z); return c !== C.WALL; };
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) {
      const c = g.cell(x, z);
      if (c === C.WALL) {
        let adj = false;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isOpenish(x + dx, z + dz)) adj = true;
        if (adj) wallTiles.push([x, z]);
        continue;
      }
      if (c === C.ELEVATOR) elevTiles.push([x, z]); else floorTiles.push([x, z]);
      if (c === C.VENT) ventTiles.push([x, z]); else ceilTiles.push([x, z]);
      if (c === C.GLASS) glassTiles.push([x, z]);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const inst = (geo, material, list, fn) => {
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach(([x, z], i) => { fn(m4, x, z); im.setMatrixAt(i, m4); });
      im.receiveShadow = true;
      im.userData.ownGeo = true;
      this.root.add(im);
      return im;
    };
    const plane = new THREE.PlaneGeometry(TILE, TILE);
    const floorMat = new THREE.MeshStandardMaterial({ map: tex(th.floor), roughness: th.floor === 'marble' ? 0.25 : th.floor === 'tiles' ? 0.4 : 0.9, metalness: th.floor === 'marble' ? 0.1 : 0 });
    const rotDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const rotUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const one = new THREE.Vector3(1, 1, 1);
    inst(plane, floorMat, floorTiles, (m, x, z) => m.compose(new THREE.Vector3(tileCenter(x), 0, tileCenter(z)), rotDown, one));
    const elevMat = new THREE.MeshStandardMaterial({ map: tex('grate', [2, 2]), roughness: 0.5, metalness: 0.6, color: 0x999999 });
    inst(plane, elevMat, elevTiles, (m, x, z) => m.compose(new THREE.Vector3(tileCenter(x), 0.005, tileCenter(z)), rotDown, one));
    const ceilMat = new THREE.MeshStandardMaterial({ map: tex(th.ceil), roughness: 0.95 });
    inst(plane, ceilMat, ceilTiles, (m, x, z) => m.compose(new THREE.Vector3(tileCenter(x), WALL_H, tileCenter(z)), rotUp, one));
    const wallGeo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
    const wallMat = new THREE.MeshStandardMaterial({ map: tex(th.wall), roughness: 0.85 });
    const walls = inst(wallGeo, wallMat, wallTiles, (m, x, z) => m.compose(new THREE.Vector3(tileCenter(x), WALL_H / 2, tileCenter(z)), q, one));
    walls.castShadow = true;
    // Vents: duct block above the crawlspace
    const ventGeo = new THREE.BoxGeometry(TILE, WALL_H - VENT_CEIL, TILE);
    const ventMat = new THREE.MeshStandardMaterial({ map: tex('metal'), color: 0x8a9096, roughness: 0.6, metalness: 0.5 });
    const vents = inst(ventGeo, ventMat, ventTiles, (m, x, z) => m.compose(new THREE.Vector3(tileCenter(x), VENT_CEIL + (WALL_H - VENT_CEIL) / 2, tileCenter(z)), q, one));
    vents.castShadow = true;
    const ventFloorMat = new THREE.MeshStandardMaterial({ map: tex('grate', [3, 3]), roughness: 0.6, metalness: 0.5 });
    inst(plane, ventFloorMat, ventTiles, (m, x, z) => m.compose(new THREE.Vector3(tileCenter(x), 0.01, tileCenter(z)), rotDown, one));
    // Vent grates at openings to normal floor
    const grateMat = new THREE.MeshStandardMaterial({ map: tex('grate', [2, 1]), color: 0x777777, metalness: 0.5, roughness: 0.6 });
    for (const [x, z] of ventTiles) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = g.cell(x + dx, z + dz);
        if (c === C.FLOOR || c === C.ELEVATOR) {
          const frame = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.12, 0.12), mat('darkmetal'));
          frame.position.set(tileCenter(x) + dx * TILE / 2, VENT_CEIL - 0.06, tileCenter(z) + dz * TILE / 2);
          frame.rotation.y = dx ? Math.PI / 2 : 0;
          this.root.add(frame);
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), new THREE.MeshBasicMaterial({ map: textTexture('VENT ▸ CROUCH', { w: 256, h: 64, bg: '#c8a020', fg: '#111', font: 'bold 30px Arial' }) }));
          sign.position.set(tileCenter(x) + dx * (TILE / 2 + 0.01), VENT_CEIL + 0.25, tileCenter(z) + dz * (TILE / 2 + 0.01));
          sign.rotation.y = Math.atan2(dx, dz);
          this.root.add(sign);
          void grateMat;
        }
      }
    }
    // Glass partitions
    for (const [x, z] of glassTiles) {
      const alongX = g.isWallish(x - 1, z) || g.isWallish(x + 1, z);
      const grp = new THREE.Group();
      grp.position.set(tileCenter(x), 0, tileCenter(z));
      grp.rotation.y = alongX ? 0 : Math.PI / 2;
      box(grp, TILE, 2.6, 0.05, 'glass', 0, 1.6, 0, { shadow: false });
      box(grp, TILE, 0.3, 0.2, 'darkmetal', 0, 0.15, 0);
      box(grp, TILE, 0.12, 0.15, 'darkmetal', 0, 2.94, 0);
      box(grp, 0.08, 3, 0.12, 'darkmetal', -0.98, 1.5, 0); box(grp, 0.08, 3, 0.12, 'darkmetal', 0.98, 1.5, 0);
      // bars inside containment cells
      if (this.level.theme === 'containment') for (let i = -3; i <= 3; i++) box(grp, 0.03, 2.6, 0.03, 'darkmetal', i * 0.26, 1.6, 0.06);
      this.root.add(grp);
    }
  }

  // ------------------------------------------------------------ doors
  buildDoor(e, staticGroup) {
    const g = new THREE.Group();
    g.position.set(e.x, 0, e.z);
    g.rotation.y = e.axis === 'x' ? 0 : Math.PI / 2;
    const th = this.theme;
    const metal = th.door === 'metal' || e.heavy || e.elevatorDoor || e.gate;
    // lintel + frame
    const frameMat = e.elevatorDoor ? 'metal' : metal ? 'darkmetal' : 'darkwood';
    box(g, TILE, WALL_H - 2.45, 0.3, frameMat, 0, 2.45 + (WALL_H - 2.45) / 2, 0);
    box(g, 0.1, 2.45, 0.32, frameMat, -0.95, 1.225, 0); box(g, 0.1, 2.45, 0.32, frameMat, 0.95, 1.225, 0);
    staticGroup.add(g);
    const dynG = new THREE.Group();
    dynG.position.copy(g.position); dynG.rotation.copy(g.rotation);
    dynG.userData.dynamic = true;
    this.root.add(dynG);
    const panels = [];
    const mk = (w, x, m) => {
      const p = new THREE.Group(); p.position.x = x; dynG.add(p);
      box(p, w, 2.4, 0.08, m, 0, 1.2, 0);
      return p;
    };
    if (e.gate) {
      const p = new THREE.Group(); dynG.add(p);
      for (let i = 0; i < 9; i++) box(p, 0.05, 2.4, 0.05, 'darkmetal', -0.85 + i * 0.21, 1.2, 0);
      box(p, 1.9, 0.1, 0.08, 'yellow', 0, 0.4, 0); box(p, 1.9, 0.1, 0.08, 'yellow', 0, 2.2, 0);
      panels.push({ g: p, dir: 1, base: 0 });
    } else if (e.elevatorDoor || e.heavy) {
      const m = e.elevatorDoor ? 'metal' : 'rust';
      const l = mk(0.92, -0.47, m), r = mk(0.92, 0.47, m);
      if (e.heavy) { box(l, 0.9, 0.15, 0.1, 'yellow', 0, 1.0, 0); box(r, 0.9, 0.15, 0.1, 'yellow', 0, 1.0, 0); }
      panels.push({ g: l, dir: -1, base: -0.47 }, { g: r, dir: 1, base: 0.47 });
    } else {
      const p = mk(1.85, 0, metal ? 'metal' : 'wood');
      box(p, 0.06, 0.06, 0.16, 'metal', 0.75, 1.05, 0);
      if (!metal) box(p, 0.5, 0.7, 0.02, new THREE.MeshStandardMaterial({ color: 0x223, transparent: true, opacity: 0.55 }), 0, 1.75, 0.045);
      panels.push({ g: p, dir: 1, base: 0 });
    }
    // lock indicator / card reader on both sides
    const st = this.doorState.get(e.id);
    const leds = [];
    if (e.lock) {
      for (const s of [1, -1]) {
        box(g, 0.14, 0.22, 0.05, 'plastic', 0.75, 1.3, s * 0.17);
        const led = box(this.root, 0.05, 0.05, 0.02, st?.locked ? 'ledRed' : 'ledGreen', 0, 0, 0);
        led.position.set(0.75, 1.36, s * 0.2).applyEuler(g.rotation).add(g.position);
        led.userData.dynamic = true;
        leds.push(led);
      }
    }
    if (e.sign) {
      for (const s of [1, -1]) {
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.25), new THREE.MeshBasicMaterial({ map: textTexture(e.sign, { w: 256, h: 64, bg: '#1a1a1a', fg: '#e8e0c0', font: 'bold 34px Arial', border: '#c8a020' }) }));
        sg.position.set(0, 2.72, s * 0.16); sg.rotation.y = s > 0 ? 0 : Math.PI;
        g.add(sg);
      }
    }
    const open = st?.open ? 1 : 0;
    this.doorViews.set(e.id, { ent: e, panels, open, target: open, leds, gate: !!e.gate });
    this.applyDoorPose(this.doorViews.get(e.id));
  }

  applyDoorPose(v) {
    for (const p of v.panels) {
      if (v.gate) p.g.position.y = v.open * 2.35;
      else p.g.position.x = p.base + p.dir * v.open * (v.panels.length > 1 ? 0.92 : 1.85);
    }
  }

  setDoor(id, open, locked) {
    const s = this.doorState.get(id);
    if (s) { s.open = open; if (locked !== undefined) s.locked = locked; }
    const v = this.doorViews.get(id);
    if (v) {
      v.target = open ? 1 : 0;
      for (const l of v.leds) l.material = mat(s?.locked ? 'ledRed' : 'ledGreen');
    }
  }
  doorOpen(id) { return !!this.doorState.get(id)?.open; }
  // Cutscene-only: animate a door without changing its gameplay state.
  setDoorVisual(id, open) {
    const v = this.doorViews.get(id);
    if (v) v.target = open ? 1 : (this.doorState.get(id)?.open ? 1 : 0);
  }

  // ------------------------------------------------------------ items
  updateItem(it) {
    this.items.set(it.id, it);
    let v = this.itemViews.get(it.id);
    const visible = it.state === 'world';
    if (!v && visible) {
      const mesh = buildItem(it.kind, it.key);
      this.root.add(mesh);
      v = { mesh, item: it };
      this.itemViews.set(it.id, v);
    }
    if (v) {
      v.item = it;
      v.mesh.visible = visible;
      v.mesh.position.set(it.x, (it.y || 0) + 0.02, it.z);
    }
  }

  // ------------------------------------------------------------ switches
  setSwitch(id, on) {
    const p = this.props.get(id)?.prop;
    if (!p) return;
    p.userData.on = on;
    if (p.userData.led) p.userData.led.material = mat(on ? 'ledGreen' : 'ledRed');
  }
  setValve(id, on) {
    const p = this.props.get(id)?.prop;
    if (!p) return;
    p.userData.on = on;
    if (p.userData.led) p.userData.led.material = mat(on ? 'ledGreen' : 'ledRed');
  }
  setSocket(id, count) {
    const p = this.props.get(id)?.prop;
    if (!p?.userData.slots) return;
    p.userData.slots.forEach((s, i) => { s.visible = i < count; });
  }
  setHidden(spotId, on) {
    const p = this.props.get(spotId)?.prop;
    if (p) p.userData.peek = on ? 0.6 : 0; // briefly swing door
  }
  hideCheck(spotId) { const p = this.props.get(spotId)?.prop; if (p) p.userData.forceOpen = 1.6; }

  // ------------------------------------------------------------ lights
  buildLights(th) {
    const lights = [...this.grid.lights];
    // every elevator car gets its own steady ceiling light
    const panel = this.grid.entities.find((e) => e.type === 'elevator');
    if (panel && this.grid.elevatorTiles.length) {
      const xs = this.grid.elevatorTiles.map(([x]) => x), zs = this.grid.elevatorTiles.map(([, z]) => z);
      lights.push({ x: (Math.min(...xs) + Math.max(...xs) + 1) * TILE / 2, z: (Math.min(...zs) + Math.max(...zs) + 1) * TILE / 2, elevator: true });
    }
    this.lightEnts = lights.map((l, i) => ({ ...l, i, phase: Math.random() * 100, cur: 0, base: 1 }));
    const geo = new THREE.BoxGeometry(1.3, 0.05, 0.35);
    this.fixtureMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.fixtures = new THREE.InstancedMesh(geo, this.fixtureMat, Math.max(1, this.lightEnts.length));
    this.fixtures.userData.ownGeo = true;
    const m4 = new THREE.Matrix4();
    this.lightEnts.forEach((l, i) => { m4.makeTranslation(l.x, WALL_H - 0.03, l.z); this.fixtures.setMatrixAt(i, m4); this.fixtures.setColorAt(i, new THREE.Color(0)); });
    this.root.add(this.fixtures);
    const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.04, 0.45), mat('darkmetal'), Math.max(1, this.lightEnts.length));
    this.lightEnts.forEach((l, i) => { m4.makeTranslation(l.x, WALL_H - 0.01, l.z); housing.setMatrixAt(i, m4); });
    this.root.add(housing);
    this.lightColor = new THREE.Color(th.light);
    this.lightTimer = 0;
  }

  applyLights(mode) {
    this.lightsMode = mode;
    const k = { on: 1, dim: 0.12, emergency: 0.5, alarm: 0.6, off: 0.05 }[mode] ?? 1;
    this.hemi.intensity = this.theme.amb * k;
    if (this.scene.fog && this.level.theme === 'office') this.scene.fog.density = mode === 'on' ? this.theme.fogD : 0.05;
  }

  lightIntensity(l, t) {
    const mode = this.lightsMode;
    if (l.broken) return (Math.sin(t * 37 + l.phase) > 0.97) ? 0.8 : 0;
    if (l.elevator) { l.color = ELEVATOR_LIGHT; return this.lightsMode === 'off' ? 0 : 0.55; }
    let base = 1;
    let color = this.lightColor;
    if (mode === 'off') return 0;
    if (mode === 'emergency') { if (l.i % 2) return 0; base = 0.35; color = EMERGENCY; }
    if (mode === 'alarm') { base = 0.25 + 0.75 * Math.max(0, Math.sin(t * 4 + l.i * 0.3)); color = EMERGENCY; }
    if (mode === 'dim') { if (l.i % 3) return 0; base = 0.45; }
    let f = 1;
    if (l.flicker || (mode === 'dim' && l.i % 2 === 0)) {
      const n = Math.sin(t * 13 + l.phase) * Math.sin(t * 7.3 + l.phase * 2) + Math.sin(t * 2.1 + l.phase);
      f = n > 0.9 ? 0.05 : n > 0.6 ? 0.5 : 1;
    }
    l.color = color;
    return base * f;
  }

  updateLights(dt, cam) {
    const t = this.time;
    const col = new THREE.Color();
    for (const l of this.lightEnts) {
      l.cur = this.lightIntensity(l, t);
      col.copy(l.color || this.lightColor).multiplyScalar(l.cur * 1.6 + (l.broken ? 0 : 0.03));
      this.fixtures.setColorAt(l.i, col);
    }
    if (this.fixtures.instanceColor) this.fixtures.instanceColor.needsUpdate = true;
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.25;
      const sorted = this.lightEnts.filter((l) => l.cur > 0.01 || l.flicker || this.lightsMode === 'alarm' || l.broken)
        .map((l) => [l, (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2]).sort((a, b) => a[1] - b[1]);
      this.assigned = sorted.slice(0, POOL).map((s) => s[0]);
    }
    this.pool.forEach((pl, i) => {
      const l = this.assigned?.[i];
      if (!l) { pl.intensity = 0; return; }
      pl.position.set(l.x, WALL_H - 0.35, l.z);
      pl.color.copy(l.color || this.lightColor);
      pl.intensity = l.cur * this.theme.lightI;
    });
    if (this.fire) {
      this.fire.light.intensity = 30 + Math.sin(t * 20) * 8 + Math.random() * 10;
    }
  }

  // ------------------------------------------------------------ hazards
  buildHazards() {
    const sprite = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.puff = sprite;
    for (const h of this.level.hazards || []) {
      const [x1, z1, x2, z2] = h.rect;
      const n = Math.min(500, (x2 - x1 + 1) * (z2 - z1 + 1) * 5);
      const pos = new Float32Array(n * 3);
      const vel = [];
      for (let i = 0; i < n; i++) {
        pos[i * 3] = x1 * TILE + Math.random() * (x2 - x1 + 1) * TILE;
        pos[i * 3 + 1] = Math.random() * 2.4;
        pos[i * 3 + 2] = z1 * TILE + Math.random() * (z2 - z1 + 1) * TILE;
        vel.push((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({ color: 0x7aff6a, size: 1.6, map: sprite, transparent: true, opacity: 0.16, depthWrite: false, sizeAttenuation: true });
      const pts = new THREE.Points(geo, m);
      pts.userData.ownGeo = true;
      this.root.add(pts);
      this.hazardViews.push({ h, pts, vel, rect: [x1 * TILE, z1 * TILE, (x2 + 1) * TILE, (z2 + 1) * TILE], amount: 1 });
    }
  }

  inHazard(x, z) {
    for (const v of this.hazardViews) {
      if (v.h.offFlag && this.flags.has(v.h.offFlag)) continue;
      const [a, b, c, d] = v.rect;
      if (x >= a && x < c && z >= b && z < d) return true;
    }
    return false;
  }

  setTrapSealed() {
    if (this.fire || !this.level.trap) return;
    const [x1, z1, x2, z2] = this.level.trap.zone;
    const cx = (x1 + x2 + 1) * TILE / 2, cz = (z1 + z2 + 1) * TILE / 2;
    const light = new THREE.PointLight(0xff6010, 30, 22, 1.5);
    light.position.set(cx, 1.5, cz);
    this.root.add(light);
    const n = 400; const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = x1 * TILE + Math.random() * (x2 - x1 + 1) * TILE; pos[i * 3 + 1] = Math.random() * 3; pos[i * 3 + 2] = z1 * TILE + Math.random() * (z2 - z1 + 1) * TILE; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff7020, size: 1.2, map: this.puff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.root.add(pts);
    this.fire = { light, pts, rect: [x1 * TILE, z1 * TILE, (x2 + 1) * TILE, (z2 + 1) * TILE] };
  }

  // ------------------------------------------------------------ per frame
  update(dt, cam) {
    this.time += dt;
    const t = this.time;
    for (const v of this.doorViews.values()) {
      if (v.open !== v.target) {
        const sp = v.gate ? 0.9 : 2.2;
        v.open += Math.sign(v.target - v.open) * Math.min(Math.abs(v.target - v.open), dt * sp);
        this.applyDoorPose(v);
      }
    }
    for (const [id, v] of this.itemViews) {
      if (!v.mesh.visible) continue;
      v.mesh.rotation.y = t * 0.8 + id.length;
      v.mesh.position.y = (v.item.y || 0) + 0.04 + Math.sin(t * 2 + id.length) * 0.02;
    }
    for (const { prop } of this.props.values()) {
      if (!prop) continue;
      const u = prop.userData;
      if (u.lever) { const tgt = u.on ? u.leverOn : u.leverOff; u.lever.rotation.x += (tgt - u.lever.rotation.x) * Math.min(1, dt * 8); }
      if (u.wheel && u.on) u.wheel.rotation.z += dt * 2;
      if (u.vibrate && u.on) { u.vibrate.position.x = (Math.random() - 0.5) * 0.015; u.vibrate.position.z = (Math.random() - 0.5) * 0.015; }
      if (u.float) u.float.position.y = 1.1 + Math.sin(t * 0.7 + prop.id) * 0.06;
      if (u.door) {
        if (u.forceOpen > 0) u.forceOpen -= dt;
        if (u.peek > 0) u.peek -= dt;
        const tgt = u.forceOpen > 0 ? u.doorOpen : u.peek > 0 ? u.doorOpen * 0.7 : 0;
        u.door.rotation.y += (tgt - u.door.rotation.y) * Math.min(1, dt * 10);
        if (u.door2) u.door2.rotation.y = -u.door.rotation.y;
      }
    }
    // Gas
    for (const v of this.hazardViews) {
      const off = v.h.offFlag && this.flags.has(v.h.offFlag);
      v.amount += ((off ? 0 : 1) - v.amount) * Math.min(1, dt * 0.6);
      v.pts.material.opacity = 0.16 * v.amount;
      v.pts.visible = v.amount > 0.02;
      const p = v.pts.geometry.attributes.position.array;
      const [a, b, c, d] = v.rect;
      for (let i = 0; i < p.length; i += 3) {
        p[i] += v.vel[i] * dt; p[i + 1] += v.vel[i + 1] * dt + Math.sin(t + i) * 0.002; p[i + 2] += v.vel[i + 2] * dt;
        if (p[i] < a) p[i] = c; if (p[i] > c) p[i] = a; if (p[i + 2] < b) p[i + 2] = d; if (p[i + 2] > d) p[i + 2] = b;
        if (p[i + 1] < 0 || p[i + 1] > 2.6) v.vel[i + 1] *= -1;
      }
      v.pts.geometry.attributes.position.needsUpdate = true;
    }
    if (this.fire) {
      const p = this.fire.pts.geometry.attributes.position.array;
      const [a, b, c, d] = this.fire.rect;
      for (let i = 0; i < p.length; i += 3) { p[i + 1] += dt * (1 + Math.random() * 2); if (p[i + 1] > 3) { p[i + 1] = 0; p[i] = a + Math.random() * (c - a); p[i + 2] = b + Math.random() * (d - b); } }
      this.fire.pts.geometry.attributes.position.needsUpdate = true;
    }
    this.updateLights(dt, cam);
  }

  // Nearest light brightness at a point — used for audio buzz and visibility hints.
  lightAt(x, z) {
    let best = 0;
    for (const l of this.lightEnts || []) {
      const d2 = (l.x - x) ** 2 + (l.z - z) ** 2;
      if (d2 < 36) best = Math.max(best, l.cur * (1 - Math.sqrt(d2) / 6));
    }
    return best;
  }

  // ------------------------------------------------------------ batching
  // Merge every static mesh by material into one draw call per material.
  batchStatic(group) {
    group.updateMatrixWorld(true);
    const buckets = new Map();
    const remove = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      let a = o, dynamic = false;
      while (a && a !== group) { if (a.userData.dynamic) { dynamic = true; break; } a = a.parent; }
      if (dynamic) return;
      const key = o.material.uuid;
      if (!buckets.has(key)) buckets.set(key, { material: o.material, geos: [], shadow: false });
      const b = buckets.get(key);
      const geo = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      b.geos.push(geo.index ? geo : geo);
      b.shadow = b.shadow || o.castShadow;
      remove.push(o);
    });
    for (const o of remove) o.parent.remove(o);
    for (const b of buckets.values()) {
      const indexed = b.geos.filter((g) => g.index), nonIndexed = b.geos.filter((g) => !g.index);
      for (const set of [indexed, nonIndexed]) {
        if (!set.length) continue;
        const merged = mergeGeometries(set, false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, b.material);
        mesh.castShadow = b.shadow; mesh.receiveShadow = true;
        mesh.userData.ownGeo = true;
        this.root.add(mesh);
      }
      for (const g of b.geos) g.dispose();
    }
  }
}

const EMERGENCY = new THREE.Color(0xff2a10);
const ELEVATOR_LIGHT = new THREE.Color(0xffe2b0);
