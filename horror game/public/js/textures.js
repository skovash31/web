// Procedural canvas textures — no external image assets needed.
import * as THREE from 'three';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function noise(ctx, w, h, amount, r, alpha = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    d[i + 3] = d[i + 3] * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

function stains(ctx, w, h, r, count, color, maxR) {
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, rad = maxR * (0.3 + r() * 0.7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

function finish(c, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const GEN = {
  carpet(r) {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#3d4650'; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 38, r);
    x.globalAlpha = 0.12;
    for (let i = 0; i < 256; i += 8) { x.fillStyle = i % 16 ? '#2a3038' : '#56606a'; x.fillRect(0, i, 256, 3); }
    x.globalAlpha = 1;
    stains(x, 256, 256, r, 3, 'rgba(30,25,20,0.25)', 40);
    return c;
  },
  oldCarpet(r) {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#4a3a2c'; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 45, r);
    stains(x, 256, 256, r, 8, 'rgba(20,15,10,0.45)', 60);
    return c;
  },
  ceiling(r) {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#d6d3cb'; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 18, r);
    for (let i = 0; i < 400; i++) { x.fillStyle = 'rgba(90,90,80,0.35)'; x.fillRect(r() * 256, r() * 256, 1.5, 1.5); }
    x.strokeStyle = '#8b8a84'; x.lineWidth = 5;
    x.strokeRect(0, 0, 128, 128); x.strokeRect(128, 0, 128, 128); x.strokeRect(0, 128, 128, 128); x.strokeRect(128, 128, 128, 128);
    stains(x, 256, 256, r, 2, 'rgba(120,95,40,0.3)', 45);
    return c;
  },
  wallPaint(r, base = '#b9b19f', trim = '#5b5348') {
    const [c, x] = canvas(256, 384);
    x.fillStyle = base; x.fillRect(0, 0, 256, 384);
    noise(x, 256, 384, 14, r);
    stains(x, 256, 384, r, 3, 'rgba(70,60,40,0.18)', 80);
    x.fillStyle = trim; x.fillRect(0, 360, 256, 24);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 356, 256, 4);
    return c;
  },
  wood(r) {
    const [c, x] = canvas(256, 384);
    x.fillStyle = '#4b3423'; x.fillRect(0, 0, 256, 384);
    for (let i = 0; i < 256; i += 32) {
      x.fillStyle = `rgb(${60 + r() * 25},${40 + r() * 15},${25 + r() * 10})`;
      x.fillRect(i, 0, 31, 384);
      for (let k = 0; k < 30; k++) { x.strokeStyle = 'rgba(25,15,8,0.25)'; x.beginPath(); const yy = r() * 384; x.moveTo(i, yy); x.bezierCurveTo(i + 10, yy + 8, i + 20, yy - 6, i + 31, yy + 4); x.stroke(); }
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(i + 31, 0, 1, 384);
    }
    noise(x, 256, 384, 16, r);
    x.fillStyle = '#2a1c12'; x.fillRect(0, 150, 256, 10);
    return c;
  },
  concrete(r, tint = [118, 118, 114]) {
    const [c, x] = canvas(256, 256);
    x.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 40, r);
    stains(x, 256, 256, r, 10, 'rgba(40,38,30,0.3)', 50);
    x.strokeStyle = 'rgba(40,40,40,0.4)'; x.lineWidth = 1;
    for (let i = 0; i < 4; i++) { x.beginPath(); let px = r() * 256, py = r() * 256; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
    return c;
  },
  concreteWall(r) {
    const [c, x] = canvas(256, 384);
    x.fillStyle = '#6f706c'; x.fillRect(0, 0, 256, 384);
    noise(x, 256, 384, 36, r);
    x.fillStyle = 'rgba(30,30,28,0.35)';
    for (let y = 0; y < 384; y += 64) x.fillRect(0, y, 256, 2);
    for (let y = 0; y < 384; y += 64) for (let xx = (y / 64) % 2 ? 0 : 64; xx < 256; xx += 128) x.fillRect(xx, y, 2, 64);
    stains(x, 256, 384, r, 6, 'rgba(60,40,20,0.35)', 70);
    x.fillStyle = 'rgba(160,120,20,0.8)'; x.fillRect(0, 340, 256, 14);
    x.fillStyle = 'rgba(20,20,20,0.9)'; for (let i = -40; i < 256; i += 28) { x.beginPath(); x.moveTo(i, 354); x.lineTo(i + 14, 340); x.lineTo(i + 24, 340); x.lineTo(i + 10, 354); x.fill(); }
    return c;
  },
  tiles(r, a = '#d8dcdc', b = '#c8cccc', grout = '#7c8282', n = 4) {
    const [c, x] = canvas(256, 256);
    const s = 256 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? a : b; x.fillRect(i * s, j * s, s, s); }
    noise(x, 256, 256, 14, r);
    x.strokeStyle = grout; x.lineWidth = 3;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * s); x.lineTo(256, i * s); x.stroke(); }
    stains(x, 256, 256, r, 3, 'rgba(60,60,40,0.25)', 50);
    return c;
  },
  labWall(r, base = '#d9dee0', stripe = '#2f6f9f') {
    const [c, x] = canvas(256, 384);
    x.fillStyle = base; x.fillRect(0, 0, 256, 384);
    noise(x, 256, 384, 10, r);
    x.strokeStyle = 'rgba(0,0,0,0.15)'; x.lineWidth = 2;
    x.strokeRect(2, 2, 124, 380); x.strokeRect(130, 2, 124, 380);
    x.fillStyle = stripe; x.fillRect(0, 230, 256, 14);
    x.fillStyle = '#6d7377'; x.fillRect(0, 364, 256, 20);
    stains(x, 256, 384, r, 2, 'rgba(80,70,40,0.2)', 60);
    return c;
  },
  metal(r, base = '#4a4f54') {
    const [c, x] = canvas(256, 384);
    x.fillStyle = base; x.fillRect(0, 0, 256, 384);
    noise(x, 256, 384, 22, r);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
      x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 3; x.strokeRect(i * 128 + 2, j * 128 + 2, 124, 124);
      x.fillStyle = 'rgba(200,200,200,0.35)';
      for (const [px, py] of [[10, 10], [118, 10], [10, 118], [118, 118]]) { x.beginPath(); x.arc(i * 128 + px, j * 128 + py, 3, 0, 7); x.fill(); }
    }
    stains(x, 256, 384, r, 8, 'rgba(110,55,20,0.4)', 50);
    return c;
  },
  grate(r) {
    const [c, x] = canvas(128, 128);
    x.fillStyle = '#2b2e31'; x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#5a6066';
    for (let i = 0; i < 128; i += 16) { x.fillRect(i, 0, 5, 128); x.fillRect(0, i, 128, 5); }
    noise(x, 128, 128, 20, r);
    return c;
  },
  bioWall(r) { return GEN.labWall(r, '#a9b8a8', '#4f7a3a'); },
  bioFloor(r) { return GEN.tiles(r, '#6f8a72', '#647e67', '#2f3f31', 4); },
  marble(r) {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#1d1b1c'; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 12, r);
    for (let i = 0; i < 14; i++) {
      x.strokeStyle = `rgba(${180 + r() * 60},${160 + r() * 40},${120 + r() * 30},${0.15 + r() * 0.25})`; x.lineWidth = 0.5 + r() * 1.5;
      x.beginPath(); let px = r() * 256, py = 0; x.moveTo(px, py);
      while (py < 256) { px += (r() - 0.5) * 30; py += 10 + r() * 20; x.lineTo(px, py); }
      x.stroke();
    }
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 2; x.strokeRect(0, 0, 256, 256);
    return c;
  },
  execWall(r) {
    const [c, x] = canvas(256, 384);
    x.fillStyle = '#3b1416'; x.fillRect(0, 0, 256, 384);
    noise(x, 256, 384, 12, r);
    x.globalAlpha = 0.09;
    for (let i = 0; i < 256; i += 16) for (let j = 0; j < 256; j += 32) { x.fillStyle = '#b08a4a'; x.beginPath(); x.moveTo(i + 8, j + 4); x.lineTo(i + 13, j + 16); x.lineTo(i + 8, j + 28); x.lineTo(i + 3, j + 16); x.fill(); }
    x.globalAlpha = 1;
    const w = GEN.wood(r);
    x.drawImage(w, 0, 0, 256, 384, 0, 256, 256, 128);
    x.fillStyle = '#b08a4a'; x.fillRect(0, 252, 256, 6);
    return c;
  },
  paper(r) {
    const [c, x] = canvas(128, 160);
    x.fillStyle = '#e9e4d4'; x.fillRect(0, 0, 128, 160);
    noise(x, 128, 160, 12, r);
    x.fillStyle = 'rgba(30,30,40,0.55)';
    for (let y = 18; y < 150; y += 9) x.fillRect(12, y, 60 + r() * 50, 2);
    return c;
  },
  blood(r) {
    const [c, x] = canvas(256, 256);
    x.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 12; i++) {
      const px = 128 + (r() - 0.5) * 120, py = 128 + (r() - 0.5) * 120, rad = 10 + r() * 50;
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, 'rgba(70,4,4,0.95)'); g.addColorStop(0.7, 'rgba(50,2,2,0.7)'); g.addColorStop(1, 'rgba(40,0,0,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
    }
    return c;
  },
};

export function tex(name, repeat = [1, 1], ...args) {
  const key = name + repeat.join(',') + args.join(',');
  if (cache.has(key)) return cache.get(key);
  const seed = [...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const t = finish(GEN[name](rand(seed), ...args), repeat);
  cache.set(key, t);
  return t;
}

// Text label rendered onto a texture (signs, screens, nameplates).
export function textTexture(text, { w = 256, h = 64, bg = '#111', fg = '#eee', font = 'bold 30px Arial', border = null } = {}) {
  const [c, x] = canvas(w, h);
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  if (border) { x.strokeStyle = border; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4); }
  x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  const lines = String(text).split('\n');
  lines.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (parseInt(font.match(/(\d+)px/)?.[1] || 30) * 1.15)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
