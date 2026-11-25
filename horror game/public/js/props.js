// Furniture, machines and items, built from primitives. Every prop faces local +Z
// (toward the open floor); wall-mounted parts sit at local z ≈ -0.95 (the wall face).
import * as THREE from 'three';
import { tex, textTexture } from './textures.js';
import { makeStapler, makeStaplesBox } from './models.js';

const M = new Map();
export function mat(name) {
  if (M.has(name)) return M.get(name);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const defs = {
    wood: () => S({ color: 0x6a4a32, roughness: 0.75 }),
    darkwood: () => S({ color: 0x3a2618, roughness: 0.6 }),
    laminate: () => S({ color: 0x9a8f80, roughness: 0.7 }),
    metal: () => S({ color: 0x80868c, roughness: 0.45, metalness: 0.6 }),
    darkmetal: () => S({ color: 0x33373b, roughness: 0.55, metalness: 0.5 }),
    rust: () => S({ map: tex('metal', [0.5, 0.5]), color: 0x8a7060, roughness: 0.8, metalness: 0.3 }),
    locker: () => S({ color: 0x55666f, roughness: 0.5, metalness: 0.5 }),
    plastic: () => S({ color: 0x2b2d30, roughness: 0.6 }),
    whiteplastic: () => S({ color: 0xd8d6cf, roughness: 0.6 }),
    fabric: () => S({ color: 0x2c3540, roughness: 0.95 }),
    cardboard: () => S({ color: 0x9b7a50, roughness: 0.95 }),
    plant: () => S({ color: 0x2f5a2a, roughness: 0.9 }),
    pot: () => S({ color: 0x5a3a2a, roughness: 0.9 }),
    skin: () => S({ color: 0xc9c2b6, roughness: 0.85 }),
    cloth: () => S({ color: 0x3d4a5a, roughness: 0.95 }),
    sheet: () => S({ color: 0xc8cbc6, roughness: 0.95 }),
    glass: () => new THREE.MeshPhysicalMaterial({ color: 0x9fc6c4, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    liquid: () => S({ color: 0x3f8f4a, emissive: 0x1f6a2a, emissiveIntensity: 0.9, transparent: true, opacity: 0.75, roughness: 0.2 }),
    screen: () => S({ color: 0x0a1a12, emissive: 0x2aa868, emissiveIntensity: 0.9 }),
    screenBlue: () => S({ color: 0x0a1020, emissive: 0x3a7ad8, emissiveIntensity: 0.8 }),
    ledRed: () => S({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 2 }),
    ledGreen: () => S({ color: 0x004000, emissive: 0x20ff40, emissiveIntensity: 2 }),
    ledAmber: () => S({ color: 0x402000, emissive: 0xffa020, emissiveIntensity: 1.6 }),
    paper: () => S({ map: tex('paper'), roughness: 0.95, side: THREE.DoubleSide }),
    blood: () => S({ map: tex('blood'), transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }),
    red: () => S({ color: 0xb01818, roughness: 0.5 }),
    yellow: () => S({ color: 0xc8a020, roughness: 0.5 }),
    keycard: () => S({ color: 0xf0f0f0, roughness: 0.3, emissive: 0x303030 }),
    specimen: () => S({ color: 0x7cff8a, emissive: 0x3aff5a, emissiveIntensity: 1.4, transparent: true, opacity: 0.85 }),
    fire: () => S({ color: 0xff6010, emissive: 0xff4000, emissiveIntensity: 3 }),
    rubber: () => S({ color: 0x151515, roughness: 0.9 }),
  };
  const m = defs[name] ? defs[name]() : new THREE.MeshStandardMaterial({ color: 0xff00ff });
  M.set(name, m);
  return m;
}

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  sph: new THREE.SphereGeometry(1, 12, 10),
  plane: new THREE.PlaneGeometry(1, 1),
};

export function box(g, w, h, d, m, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(G.box, typeof m === 'string' ? mat(m) : m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.ry) mesh.rotation.y = opts.ry;
  if (opts.rz) mesh.rotation.z = opts.rz;
  mesh.castShadow = opts.shadow !== false;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}
export function cyl(g, r, h, m, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(G.cyl, typeof m === 'string' ? mat(m) : m);
  mesh.scale.set(opts.r2 ? r : r, h, opts.r2 ? opts.r2 : r);
  mesh.position.set(x, y, z);
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.rz) mesh.rotation.z = opts.rz;
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}
function sph(g, r, m, x, y, z, sy = 1) {
  const mesh = new THREE.Mesh(G.sph, typeof m === 'string' ? mat(m) : m);
  mesh.scale.set(r, r * sy, r); mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}
function dyn(o) { o.userData.dynamic = true; return o; }
function pivot(g, x, y, z) { const p = new THREE.Group(); p.position.set(x, y, z); dyn(p); g.add(p); return p; }

function computerScreen(text) {
  return new THREE.MeshStandardMaterial({ map: textTexture(text, { w: 256, h: 192, bg: '#06140c', fg: '#4cff9a', font: '22px Courier New' }), emissive: 0xffffff, emissiveIntensity: 0.55, emissiveMap: textTexture(text, { w: 256, h: 192, bg: '#06140c', fg: '#4cff9a', font: '22px Courier New' }) });
}

// Base furniture under items/notes
function deskBase(g, r) {
  box(g, 1.6, 0.05, 0.8, 'laminate', 0, 0.75, 0);
  box(g, 0.05, 0.73, 0.75, 'darkmetal', -0.75, 0.37, 0);
  box(g, 0.05, 0.73, 0.75, 'darkmetal', 0.75, 0.37, 0);
  box(g, 1.5, 0.4, 0.03, 'laminate', 0, 0.5, -0.36);
  if (r() < 0.7) { // monitor
    box(g, 0.5, 0.34, 0.05, 'plastic', -0.35, 1.0, -0.2);
    box(g, 0.46, 0.3, 0.01, r() < 0.3 ? 'screen' : 'plastic', -0.35, 1.0, -0.17);
    box(g, 0.08, 0.1, 0.08, 'plastic', -0.35, 0.82, -0.22);
    box(g, 0.42, 0.02, 0.14, 'plastic', -0.3, 0.785, 0.08);
  }
}

export function buildProp(model, ent, r = Math.random) {
  const g = new THREE.Group();
  g.userData.interactY = 1.0;
  switch (model) {
    case 'desk': deskBase(g, r); if (r() < 0.5) box(g, 0.3, 0.01, 0.22, 'paper', 0.4, 0.785, 0.05, { ry: r() }); break;
    case 'chair': {
      const sp = r() * Math.PI * 2;
      const c = new THREE.Group(); c.rotation.y = sp; g.add(c);
      box(c, 0.5, 0.08, 0.5, 'fabric', 0, 0.48, 0);
      box(c, 0.5, 0.55, 0.07, 'fabric', 0, 0.8, -0.24);
      cyl(c, 0.04, 0.4, 'darkmetal', 0, 0.25, 0);
      box(c, 0.6, 0.04, 0.08, 'darkmetal', 0, 0.05, 0); box(c, 0.08, 0.04, 0.6, 'darkmetal', 0, 0.05, 0);
      if (r() < 0.3) c.rotation.z = 1.4, c.position.y = 0.25;
      break;
    }
    case 'shelf': {
      for (let i = 0; i < 5; i++) box(g, 1.9, 0.04, 0.5, 'metal', 0, 0.1 + i * 0.52, -0.7);
      box(g, 0.04, 2.3, 0.5, 'metal', -0.94, 1.15, -0.7); box(g, 0.04, 2.3, 0.5, 'metal', 0.94, 1.15, -0.7);
      const cols = ['cardboard', 'paper', 'darkwood', 'cloth'];
      for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) {
        if (r() < 0.25) continue;
        box(g, 0.36, 0.3 + r() * 0.12, 0.4, cols[Math.floor(r() * cols.length)], -0.7 + k * 0.46, 0.3 + i * 0.52, -0.7);
      }
      break;
    }
    case 'locker': {
      box(g, 0.9, 2.0, 0.05, 'locker', 0, 1.0, -0.95);
      box(g, 0.05, 2.0, 0.65, 'locker', -0.45, 1.0, -0.65); box(g, 0.05, 2.0, 0.65, 'locker', 0.45, 1.0, -0.65);
      box(g, 0.9, 0.05, 0.65, 'locker', 0, 2.0, -0.65); box(g, 0.9, 0.05, 0.65, 'locker', 0, 0.02, -0.65);
      const door = pivot(g, -0.44, 1.0, -0.33);
      box(door, 0.88, 1.96, 0.03, 'locker', 0.44, 0, 0);
      for (let i = 0; i < 6; i++) box(door, 0.5, 0.025, 0.01, 'plastic', 0.44, 0.65 - i * 0.05, 0.02);
      box(door, 0.04, 0.15, 0.04, 'metal', 0.8, 0, 0.03);
      g.userData.door = door; g.userData.doorOpen = -1.6;
      g.userData.hideCam = new THREE.Vector3(0, 1.55, -0.65);
      g.userData.interactY = 1.2;
      break;
    }
    case 'cabinet': {
      box(g, 1.3, 1.9, 0.05, 'darkwood', 0, 0.95, -0.95);
      box(g, 0.05, 1.9, 0.75, 'darkwood', -0.65, 0.95, -0.6); box(g, 0.05, 1.9, 0.75, 'darkwood', 0.65, 0.95, -0.6);
      box(g, 1.3, 0.05, 0.75, 'darkwood', 0, 1.9, -0.6); box(g, 1.3, 0.05, 0.75, 'darkwood', 0, 0.03, -0.6);
      const dl = pivot(g, -0.64, 0.95, -0.24), dr = pivot(g, 0.64, 0.95, -0.24);
      box(dl, 0.63, 1.84, 0.03, 'wood', 0.32, 0, 0); box(dr, 0.63, 1.84, 0.03, 'wood', -0.32, 0, 0);
      box(dl, 0.03, 0.12, 0.03, 'metal', 0.58, 0, 0.03); box(dr, 0.03, 0.12, 0.03, 'metal', -0.58, 0, 0.03);
      g.userData.door = dl; g.userData.door2 = dr; g.userData.doorOpen = -1.5;
      g.userData.hideCam = new THREE.Vector3(0, 1.45, -0.6);
      g.userData.interactY = 1.1;
      break;
    }
    case 'plant': cyl(g, 0.25, 0.45, 'pot', 0, 0.22, 0, { r2: 0.2 }); for (let i = 0; i < 6; i++) sph(g, 0.22 + r() * 0.1, 'plant', (r() - 0.5) * 0.4, 0.7 + r() * 0.5, (r() - 0.5) * 0.4, 1.4); break;
    case 'gurney': {
      box(g, 1.9, 0.08, 0.7, 'metal', 0, 0.85, 0, { ry: Math.PI / 2 * (r() < 0.5 ? 1 : 0) });
      for (const [x, z] of [[-0.85, -0.3], [0.85, -0.3], [-0.85, 0.3], [0.85, 0.3]]) box(g, 0.04, 0.8, 0.04, 'metal', x, 0.42, z);
      if (r() < 0.6) { box(g, 1.7, 0.12, 0.6, 'sheet', 0, 0.94, 0); sph(g, 0.14, 'sheet', -0.7, 1.02, 0, 0.7); }
      box(g, 0.5, 0.01, 0.4, 'blood', (r() - 0.5) * 0.6, 0.95, 0, { shadow: false });
      break;
    }
    case 'tank': {
      cyl(g, 0.72, 0.25, 'darkmetal', 0, 0.12, 0);
      cyl(g, 0.72, 0.3, 'darkmetal', 0, 2.55, 0);
      cyl(g, 0.66, 2.2, 'glass', 0, 1.35, 0);
      const liq = cyl(g, 0.62, 2.0, 'liquid', 0, 1.3, 0);
      liq.castShadow = false;
      // silhouette
      if (r() < 0.75) {
        const s = new THREE.Group(); s.position.set(0, 1.1, 0); s.rotation.y = r() * 6; g.add(s);
        box(s, 0.35, 0.6, 0.2, 'skin', 0, 0.3, 0); sph(s, 0.14, 'skin', 0, 0.75, 0);
        box(s, 0.1, 0.6, 0.1, 'skin', -0.24, 0.25, 0, { rz: 0.3 }); box(s, 0.1, 0.6, 0.1, 'skin', 0.24, 0.25, 0, { rz: -0.3 });
        box(s, 0.12, 0.6, 0.12, 'skin', -0.1, -0.3, 0); box(s, 0.12, 0.6, 0.12, 'skin', 0.1, -0.3, 0);
      }
      cyl(g, 0.05, 0.6, 'metal', 0.5, 2.9, 0); cyl(g, 0.05, 0.6, 'metal', -0.5, 2.9, 0);
      break;
    }
    case 'boxes': {
      let y = 0;
      for (let i = 0; i < 3; i++) { const h = 0.45 + r() * 0.15; box(g, 0.9 + r() * 0.4, h, 0.8 + r() * 0.3, 'cardboard', (r() - 0.5) * 0.3, y + h / 2, (r() - 0.5) * 0.3, { ry: (r() - 0.5) * 0.4 }); y += h; }
      break;
    }
    case 'crate': box(g, 1.5, 0.75, 1.5, 'wood', 0, 0.375, 0); box(g, 1.52, 0.08, 1.52, 'darkwood', 0, 0.7, 0); box(g, 1.52, 0.08, 1.52, 'darkwood', 0, 0.05, 0); break;
    case 'cooler': box(g, 0.4, 1.0, 0.4, 'whiteplastic', 0, 0.5, -0.7); cyl(g, 0.17, 0.4, new THREE.MeshStandardMaterial({ color: 0x5aa0e0, transparent: true, opacity: 0.6 }), 0, 1.2, -0.7); break;
    case 'body': {
      const s = new THREE.Group(); s.rotation.y = r() * 6; g.add(s);
      box(s, 0.45, 0.22, 0.75, 'cloth', 0, 0.12, 0, { rx: 0.1 });
      sph(s, 0.13, 'skin', 0, 0.15, 0.5);
      box(s, 0.12, 0.1, 0.6, 'cloth', -0.3, 0.06, 0.1, { ry: 0.5 }); box(s, 0.12, 0.1, 0.6, 'cloth', 0.32, 0.06, -0.1, { ry: -0.3 });
      box(s, 0.14, 0.12, 0.8, 'cloth', -0.12, 0.07, -0.7); box(s, 0.14, 0.12, 0.8, 'cloth', 0.14, 0.07, -0.75, { ry: 0.2 });
      const b = new THREE.Mesh(G.plane, mat('blood')); b.rotation.x = -Math.PI / 2; b.position.y = 0.015; b.scale.set(1.6, 1.6, 1); s.add(b);
      break;
    }
    case 'blood': { const b = new THREE.Mesh(G.plane, mat('blood')); b.rotation.x = -Math.PI / 2; b.rotation.z = r() * 6; b.position.y = 0.012; b.scale.set(1.8, 1.8, 1); g.add(b); break; }
    case 'papers': for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(G.plane, mat('paper')); p.rotation.x = -Math.PI / 2; p.rotation.z = r() * 6; p.position.set((r() - 0.5) * 1.4, 0.01 + i * 0.002, (r() - 0.5) * 1.4); p.scale.set(0.22, 0.3, 1); g.add(p); } break;
    case 'terminal': {
      deskBase(g, () => 0.9);
      box(g, 0.62, 0.45, 0.06, 'plastic', 0, 1.05, -0.15);
      const s = box(g, 0.56, 0.4, 0.01, computerScreen('CAT INC.\nTIMEKEEPING\n> LOGIN_'), 0, 1.05, -0.115);
      s.castShadow = false;
      box(g, 0.45, 0.02, 0.16, 'plastic', 0, 0.785, 0.12);
      g.userData.interactY = 1.0;
      break;
    }
    case 'copier': {
      box(g, 1.0, 0.95, 0.7, 'whiteplastic', 0, 0.475, -0.55);
      box(g, 1.0, 0.1, 0.7, 'plastic', 0, 1.0, -0.55);
      box(g, 0.3, 0.12, 0.01, 'screenBlue', 0.3, 1.0, -0.19);
      box(g, 0.5, 0.05, 0.3, 'whiteplastic', -0.6, 0.7, -0.55);
      g.userData.interactY = 1.0;
      break;
    }
    case 'tray': {
      box(g, 0.8, 0.05, 0.35, 'darkwood', 0, 0.95, -0.82);
      box(g, 0.5, 0.12, 0.3, 'darkmetal', 0, 1.03, -0.82);
      g.userData.slots = [box(g, 0.32, 0.03, 0.24, 'paper', 0, 1.07, -0.82)]; dyn(g.userData.slots[0]); g.userData.slots[0].visible = false;
      g.userData.interactY = 1.0;
      break;
    }
    case 'filecab': {
      box(g, 0.8, 1.3, 0.6, 'metal', 0, 0.65, -0.6);
      for (let i = 0; i < 4; i++) { box(g, 0.74, 0.28, 0.02, 'darkmetal', 0, 0.2 + i * 0.31, -0.29); box(g, 0.2, 0.03, 0.03, 'metal', 0, 0.28 + i * 0.31, -0.27); }
      g.userData.interactY = 1.0;
      break;
    }
    case 'breaker': {
      box(g, 0.7, 0.9, 0.18, 'darkmetal', 0, 1.4, -0.9);
      box(g, 0.6, 0.06, 0.05, 'yellow', 0, 1.9, -0.84);
      const lv = pivot(g, 0, 1.4, -0.78);
      box(lv, 0.08, 0.4, 0.06, 'red', 0, 0.18, 0);
      lv.rotation.x = 0.9;
      const led = box(g, 0.08, 0.08, 0.03, 'ledRed', 0.24, 1.75, -0.8); dyn(led);
      g.userData.lever = lv; g.userData.led = led; g.userData.leverOn = -0.9; g.userData.leverOff = 0.9;
      g.userData.interactY = 1.4;
      break;
    }
    case 'valve': {
      const col = new THREE.MeshStandardMaterial({ color: ent?.color ?? 0xaa2222, roughness: 0.4, metalness: 0.3 });
      cyl(g, 0.09, 3, 'rust', 0, 1.5, -0.85);
      cyl(g, 0.09, 0.4, 'rust', 0, 1.2, -0.7, { rx: Math.PI / 2 });
      const wheel = pivot(g, 0, 1.2, -0.48);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 20), col); wheel.add(ring);
      box(wheel, 0.44, 0.04, 0.03, col, 0, 0, 0); box(wheel, 0.04, 0.44, 0.03, col, 0, 0, 0);
      g.userData.wheel = wheel;
      const plate = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ map: textTexture(ent?.label || 'VALVE', { w: 128, h: 48, bg: '#ddd', fg: '#111', font: 'bold 26px Arial' }) }));
      plate.position.set(0, 1.6, -0.93); plate.scale.set(0.36, 0.13, 1); g.add(plate);
      const led = box(g, 0.06, 0.06, 0.03, 'ledRed', 0.25, 1.6, -0.92); dyn(led); g.userData.led = led;
      g.userData.interactY = 1.2;
      break;
    }
    case 'keypad': {
      box(g, 0.25, 0.35, 0.06, 'darkmetal', 0.0, 1.3, -0.95);
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) box(g, 0.05, 0.04, 0.02, 'metal', -0.07 + k * 0.07, 1.38 - i * 0.06, -0.91);
      const led = box(g, 0.05, 0.03, 0.02, 'ledRed', 0, 1.45, -0.91); dyn(led); g.userData.led = led;
      g.userData.interactY = 1.3;
      break;
    }
    case 'lever': {
      box(g, 0.5, 0.6, 0.2, 'darkmetal', 0, 1.2, -0.9);
      const lv = pivot(g, 0, 1.2, -0.78);
      box(lv, 0.07, 0.55, 0.07, 'yellow', 0, 0.25, 0); sph(lv, 0.07, 'red', 0, 0.52, 0);
      lv.rotation.x = 0.8; g.userData.lever = lv; g.userData.leverOn = -0.8; g.userData.leverOff = 0.8;
      const led = box(g, 0.06, 0.06, 0.03, 'ledRed', 0.18, 1.45, -0.8); dyn(led); g.userData.led = led;
      g.userData.interactY = 1.3;
      break;
    }
    case 'fusebox': {
      box(g, 0.6, 0.8, 0.2, 'darkmetal', 0, 1.35, -0.9);
      box(g, 0.5, 0.08, 0.04, 'yellow', 0, 1.7, -0.79);
      g.userData.slots = [];
      for (let i = 0; i < 2; i++) { box(g, 0.12, 0.3, 0.04, 'plastic', -0.12 + i * 0.24, 1.3, -0.79); const f = box(g, 0.08, 0.24, 0.06, 'ledAmber', -0.12 + i * 0.24, 1.3, -0.76); dyn(f); f.visible = false; g.userData.slots.push(f); }
      g.userData.interactY = 1.35;
      break;
    }
    case 'sequencer': {
      box(g, 1.4, 1.1, 0.8, 'whiteplastic', 0, 0.55, -0.5);
      box(g, 0.6, 0.35, 0.02, 'screenBlue', 0, 1.3, -0.75);
      box(g, 0.6, 0.4, 0.05, 'plastic', 0, 1.3, -0.78);
      g.userData.slots = [];
      for (let i = 0; i < 3; i++) { cyl(g, 0.09, 0.05, 'darkmetal', -0.4 + i * 0.4, 1.12, -0.3); const s = cyl(g, 0.07, 0.25, 'specimen', -0.4 + i * 0.4, 1.25, -0.3); dyn(s); s.visible = false; g.userData.slots.push(s); }
      g.userData.interactY = 1.1;
      break;
    }
    case 'generator': {
      const body = pivot(g, 0, 0, 0);
      box(body, 1.6, 1.2, 1.1, 'darkmetal', 0, 0.6, 0);
      cyl(body, 0.35, 1.0, 'rust', -0.4, 0.8, 0, { rz: Math.PI / 2 });
      cyl(body, 0.12, 1.4, 'metal', 0.55, 1.6, -0.3);
      box(body, 0.5, 0.3, 0.05, 'yellow', 0, 0.9, 0.56);
      const led = box(body, 0.1, 0.1, 0.04, 'ledRed', 0.4, 1.05, 0.57); g.userData.led = led;
      g.userData.vibrate = body;
      g.userData.interactY = 1.0;
      break;
    }
    case 'console': {
      box(g, 1.2, 1.0, 0.5, 'darkmetal', 0, 0.5, -0.7);
      box(g, 1.2, 0.08, 0.6, 'plastic', 0, 1.02, -0.65, { rx: -0.3 });
      box(g, 0.5, 0.3, 0.02, 'screen', -0.3, 1.5, -0.93);
      const btn = cyl(g, 0.09, 0.06, 'red', 0.25, 1.07, -0.6); dyn(btn);
      const led = box(g, 0.08, 0.08, 0.03, 'ledRed', 0.45, 1.5, -0.92); dyn(led); g.userData.led = led;
      g.userData.interactY = 1.1;
      break;
    }
    case 'elevatorPanel': {
      box(g, 0.32, 0.6, 0.05, 'metal', 0, 1.3, -0.95);
      for (let i = 0; i < 6; i++) { const b = box(g, 0.08, 0.08, 0.02, i === 0 ? 'ledAmber' : 'plastic', -0.06 + (i % 2) * 0.12, 1.48 - Math.floor(i / 2) * 0.12, -0.92); b.castShadow = false; }
      box(g, 0.16, 0.1, 0.03, 'plastic', 0, 1.1, -0.92);
      const led = box(g, 0.05, 0.02, 0.02, 'ledRed', 0, 1.17, -0.91); dyn(led); g.userData.led = led;
      g.userData.interactY = 1.3;
      break;
    }
    case 'pedestal': cyl(g, 0.3, 0.95, 'darkmetal', 0, 0.475, 0, { r2: 0.35 }); cyl(g, 0.4, 0.05, 'metal', 0, 0.97, 0); break;
    case 'whiteboard': {
      const wb = new THREE.Mesh(G.plane, new THREE.MeshStandardMaterial({ map: textTexture('RETENTION PROGRAM\nNOMINEES:\nMartin K.  Dana R.\n(TBD)\n\nB-LEVELS OFF LIMITS', { w: 384, h: 256, bg: '#f2f2ee', fg: '#203070', font: 'bold 28px Comic Sans MS' }) }));
      wb.position.set(0, 1.5, -0.97); wb.scale.set(1.6, 1.05, 1); g.add(wb);
      box(g, 1.68, 1.12, 0.03, 'metal', 0, 1.5, -0.99);
      g.userData.interactY = 1.5;
      break;
    }
    case 'paperNote': {
      const p = new THREE.Mesh(G.plane, mat('paper')); p.rotation.x = -Math.PI / 2; p.rotation.z = r() * 0.6; p.position.y = 0.012; p.scale.set(0.26, 0.34, 1); g.add(p);
      g.userData.interactY = 0.2;
      break;
    }
    default: break;
  }
  return g;
}

// Small pickup meshes (kept dynamic so they can bob / be hidden)
export function buildItem(kind, key) {
  const g = new THREE.Group();
  switch (kind) {
    case 'keycard': {
      const colors = { key_b1: 0x3a8fd8, key_b2: 0x3ad86a, key_b3: 0xd8c83a, key_b4: 0xd86a3a, key_b5: 0xc83ad8 };
      box(g, 0.09, 0.006, 0.055, 'keycard', 0, 0.02, 0);
      box(g, 0.09, 0.007, 0.018, new THREE.MeshStandardMaterial({ color: colors[key] || 0xffffff, emissive: colors[key] || 0xffffff, emissiveIntensity: 1.2 }), 0, 0.021, -0.012);
      g.scale.setScalar(1.8);
      break;
    }
    case 'battery': cyl(g, 0.025, 0.09, 'yellow', 0, 0.045, 0, { rz: Math.PI / 2 }); cyl(g, 0.026, 0.03, 'plastic', 0.035, 0.045, 0, { rz: Math.PI / 2 }); g.scale.setScalar(1.5); break;
    case 'medkit': box(g, 0.28, 0.14, 0.2, 'whiteplastic', 0, 0.07, 0); box(g, 0.12, 0.01, 0.04, 'red', 0, 0.145, 0); box(g, 0.04, 0.01, 0.12, 'red', 0, 0.146, 0); break;
    case 'file': case 'report': box(g, 0.24, 0.025, 0.32, kind === 'file' ? new THREE.MeshStandardMaterial({ color: 0xd8b85a }) : 'paper', 0, 0.012, 0); break;
    case 'fuse': cyl(g, 0.025, 0.12, 'ledAmber', 0, 0.03, 0, { rz: Math.PI / 2 }); cyl(g, 0.03, 0.025, 'metal', 0.06, 0.03, 0, { rz: Math.PI / 2 }); cyl(g, 0.03, 0.025, 'metal', -0.06, 0.03, 0, { rz: Math.PI / 2 }); g.scale.setScalar(1.6); break;
    case 'specimen': cyl(g, 0.07, 0.22, 'specimen', 0, 0.11, 0); cyl(g, 0.075, 0.03, 'darkmetal', 0, 0.23, 0); break;
    case 'stapler': { const m = makeStapler(); if (m) { m.root.scale.setScalar(1.6); m.root.rotation.y = 0.6; g.add(m.root); } break; }
    case 'staples': { const m = makeStaplesBox(); if (m) { m.scale.setScalar(1.6); m.rotation.y = -0.4; g.add(m); } break; }
    default: box(g, 0.15, 0.15, 0.15, 'yellow', 0, 0.075, 0);
  }
  g.traverse((o) => { o.userData.dynamic = true; });
  return g;
}
