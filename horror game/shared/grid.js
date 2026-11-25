// Tile-grid level representation shared by server (AI navigation, line of sight,
// validation) and client (rendering, collision). Levels are authored as ASCII maps.
import { TILE, WALL_H, VENT_CEIL } from './constants.js';

export const C = {
  WALL: 0, FLOOR: 1, VENT: 2, GLASS: 3, ELEVATOR: 4, DOOR: 5,
};

// Generic map symbols. Anything not listed here must be defined in level.marks.
const GENERIC = {
  '#': { cell: C.WALL },
  ' ': { cell: C.WALL },
  '.': { cell: C.FLOOR },
  'v': { cell: C.VENT },
  'g': { cell: C.GLASS },
  'E': { cell: C.ELEVATOR },
  '+': { cell: C.DOOR, ent: { type: 'door' } },
  'c': { cell: C.FLOOR, ent: { type: 'prop', model: 'crate', solid: 0.75 } },
  'L': { cell: C.FLOOR, ent: { type: 'hide', model: 'locker', solid: 2.0, wallFacing: true } },
  'K': { cell: C.FLOOR, ent: { type: 'hide', model: 'cabinet', solid: 1.9, wallFacing: true } },
  'T': { cell: C.FLOOR, ent: { type: 'prop', model: 'desk', solid: 0.78 } },
  'S': { cell: C.FLOOR, ent: { type: 'prop', model: 'shelf', solid: 2.3, wallFacing: true } },
  'P': { cell: C.FLOOR, ent: { type: 'prop', model: 'plant', solid: 1.2 } },
  'R': { cell: C.FLOOR, ent: { type: 'prop', model: 'gurney', solid: 0.9 } },
  'A': { cell: C.FLOOR, ent: { type: 'prop', model: 'tank', solid: 2.7 } },
  'X': { cell: C.FLOOR, ent: { type: 'prop', model: 'boxes', solid: 1.6 } },
  'W': { cell: C.FLOOR, ent: { type: 'prop', model: 'cooler', solid: 1.3, wallFacing: true } },
  'Y': { cell: C.FLOOR, ent: { type: 'decor', model: 'body' } },
  'J': { cell: C.FLOOR, ent: { type: 'decor', model: 'blood' } },
  'Z': { cell: C.FLOOR, ent: { type: 'decor', model: 'chair' } },
  'p': { cell: C.FLOOR, ent: { type: 'decor', model: 'papers' } },
  '*': { cell: C.FLOOR, ent: { type: 'light' } },
  '!': { cell: C.FLOOR, ent: { type: 'light', flicker: true } },
  '%': { cell: C.FLOOR, ent: { type: 'light', broken: true } },
  'B': { cell: C.FLOOR, ent: { type: 'item', kind: 'battery', name: 'Battery' } },
  'H': { cell: C.FLOOR, ent: { type: 'item', kind: 'medkit', name: 'First-aid kit' } },
};

const CELL_NAMES = { wall: C.WALL, floor: C.FLOOR, vent: C.VENT, glass: C.GLASS, elevator: C.ELEVATOR, door: C.DOOR };

export const tileCenter = (t) => t * TILE + TILE / 2;
export const toTile = (v) => Math.floor(v / TILE);

const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export class Grid {
  constructor(level) {
    const rows = level.map.split('\n').filter((r) => r.length > 0);
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
    this.cells = new Uint8Array(this.w * this.h);
    this.solidTop = new Float32Array(this.w * this.h); // >0 means a solid prop of that height
    this.opaqueProp = new Uint8Array(this.w * this.h);
    this.doorAt = new Map(); // tile index -> door entity
    this.entities = [];
    this.lights = [];
    const counters = {};
    const usedMarks = new Set();
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const ch = rows[z][x] ?? ' ';
        let def = GENERIC[ch];
        let markDef = null;
        if (!def) {
          markDef = level.marks?.[ch];
          if (!markDef) throw new Error(`Level ${level.id}: unknown map symbol '${ch}' at ${x},${z}`);
          if (usedMarks.has(ch) && !markDef.repeat) throw new Error(`Level ${level.id}: mark '${ch}' used twice`);
          usedMarks.add(ch);
          const cell = markDef.cell ? CELL_NAMES[markDef.cell] : (markDef.type === 'door' || markDef.type === 'keydoor' ? C.DOOR : C.FLOOR);
          def = { cell, ent: markDef };
        }
        const i = z * this.w + x;
        this.cells[i] = def.cell;
        if (def.ent) {
          const src = def.ent;
          const ent = { ...src, tx: x, tz: z, x: tileCenter(x), z: tileCenter(z) };
          delete ent.cell; delete ent.repeat;
          if (!ent.id) {
            counters[ent.type] = (counters[ent.type] || 0) + 1;
            ent.id = `${ent.type}_${counters[ent.type]}`;
          } else if (markDef?.repeat) {
            counters[ent.id] = (counters[ent.id] || 0) + 1;
            ent.id = `${ent.id}_${counters[ent.id]}`;
          }
          if (ent.type === 'light') this.lights.push(ent);
          else this.entities.push(ent);
          if (ent.solid) {
            this.solidTop[i] = ent.solid;
            if (ent.solid > 1.6) this.opaqueProp[i] = 1;
          }
          if (def.cell === C.DOOR) this.doorAt.set(i, ent);
        }
      }
    }
    if (level.marks) {
      for (const k of Object.keys(level.marks)) {
        if (!usedMarks.has(k) && !level.marks[k].optional) throw new Error(`Level ${level.id}: mark '${k}' not placed on the map`);
      }
    }
    // Orientation for doors and wall-facing props.
    for (const e of this.entities) {
      if (this.cells[e.tz * this.w + e.tx] === C.DOOR) {
        // A door spans between two wall tiles. axis 'x' => panel runs along X (walls left/right).
        const wl = this.isWallish(e.tx - 1, e.tz), wr = this.isWallish(e.tx + 1, e.tz);
        e.axis = wl && wr ? 'x' : 'z';
        e.facing = e.axis === 'x' ? 0 : Math.PI / 2;
      } else if (e.facing === undefined) {
        e.facing = this.autoFacing(e.tx, e.tz, e.wallFacing);
      }
    }
    this.elevatorTiles = [];
    for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) if (this.cells[z * this.w + x] === C.ELEVATOR) this.elevatorTiles.push([x, z]);
  }

  isWallish(x, z) {
    const c = this.cell(x, z);
    return c === C.WALL || c === C.GLASS;
  }

  // Yaw so the prop's front (+Z local) points at an open neighbour (away from the wall when wallFacing).
  autoFacing(tx, tz, wallFacing) {
    const yawFor = (dx, dz) => Math.atan2(dx, dz);
    if (wallFacing) {
      for (const [dx, dz] of DIRS) {
        if (this.cell(tx - dx, tz - dz) === C.WALL && this.isOpen(tx + dx, tz + dz)) return yawFor(dx, dz);
      }
    }
    for (const [dx, dz] of DIRS) if (this.isOpen(tx + dx, tz + dz)) return yawFor(dx, dz);
    return 0;
  }

  isOpen(x, z) {
    const c = this.cell(x, z);
    return (c === C.FLOOR || c === C.ELEVATOR || c === C.DOOR) && !this.solidTop[z * this.w + x];
  }

  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.w && z < this.h; }
  cell(x, z) { return this.inBounds(x, z) ? this.cells[z * this.w + x] : C.WALL; }
  index(x, z) { return z * this.w + x; }
  doorAtTile(x, z) { return this.inBounds(x, z) ? this.doorAt.get(z * this.w + x) : undefined; }

  // ---- Player collision -------------------------------------------------
  // Returns vertical solid intervals {minX,maxX,minZ,maxZ,bottom,top} near a world position.
  solidsNear(px, pz, doorOpen, out = []) {
    out.length = 0;
    const cx = toTile(px), cz = toTile(pz);
    for (let z = cz - 1; z <= cz + 1; z++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const minX = x * TILE, minZ = z * TILE, maxX = minX + TILE, maxZ = minZ + TILE;
        const c = this.cell(x, z);
        if (c === C.WALL || c === C.GLASS) { out.push({ minX, maxX, minZ, maxZ, bottom: -10, top: 50 }); continue; }
        if (c === C.VENT) { out.push({ minX, maxX, minZ, maxZ, bottom: VENT_CEIL, top: 50 }); continue; }
        if (c === C.DOOR) {
          const d = this.doorAt.get(z * this.w + x);
          if (d && !doorOpen(d.id)) {
            // thin closed door slab across the tile middle
            if (d.axis === 'x') out.push({ minX, maxX, minZ: minZ + TILE / 2 - 0.12, maxZ: minZ + TILE / 2 + 0.12, bottom: -10, top: 50 });
            else out.push({ minX: minX + TILE / 2 - 0.12, maxX: minX + TILE / 2 + 0.12, minZ, maxZ, bottom: -10, top: 50 });
          }
          continue;
        }
        const top = this.solidTop[z * this.w + x];
        if (top > 0) {
          const inset = top < 1 ? 0.2 : 0.15;
          out.push({ minX: minX + inset, maxX: maxX - inset, minZ: minZ + inset, maxZ: maxZ - inset, bottom: -10, top });
        }
      }
    }
    return out;
  }

  // ---- AI navigation ----------------------------------------------------
  // CEO walkability: floors, elevators and doors that are open or merely closed (not locked).
  ceoWalkable(x, z, doorPassable) {
    const c = this.cell(x, z);
    if (c === C.FLOOR || c === C.ELEVATOR) return !this.solidTop[z * this.w + x];
    if (c === C.VENT) return !!this.ceoVents; // Hard difficulty: he crawls through vents
    if (c === C.DOOR) { const d = this.doorAt.get(z * this.w + x); return !!d && doorPassable(d.id); }
    return false;
  }

  // A* over the grid with 8-neighbour movement (no corner cutting).
  findPath(sx, sz, gx, gz, doorPassable, maxNodes = 4000) {
    if (!this.ceoWalkable(gx, gz, doorPassable)) return null;
    const W = this.w;
    const start = sz * W + sx, goal = gz * W + gx;
    if (start === goal) return [[gx, gz]];
    const g = new Map([[start, 0]]);
    const came = new Map();
    const open = new MinHeap();
    const hfn = (i) => { const x = i % W, z = (i / W) | 0; const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    open.push(start, hfn(start));
    const closed = new Set();
    let n = 0;
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) {
        const path = [];
        let c = cur;
        while (c !== undefined) { path.push([c % W, (c / W) | 0]); c = came.get(c); }
        return path.reverse();
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (++n > maxNodes) return null;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.ceoWalkable(nx, nz, doorPassable)) continue;
        if (dx && dz) {
          // diagonal: both orthogonal neighbours must be plain walkable (doors can't be cut through)
          if (!this.ceoWalkable(cx + dx, cz, doorPassable) || !this.ceoWalkable(cx, cz + dz, doorPassable)) continue;
          if (this.cell(cx + dx, cz) === C.DOOR || this.cell(cx, cz + dz) === C.DOOR || this.cell(nx, nz) === C.DOOR || this.cell(cx, cz) === C.DOOR) continue;
        }
        const ni = nz * W + nx;
        const step = (dx && dz ? 1.414 : 1) + (this.cell(nx, nz) === C.DOOR ? 0.6 : 0);
        const ng = g.get(cur) + step;
        if (ng < (g.get(ni) ?? Infinity)) {
          g.set(ni, ng); came.set(ni, cur); open.push(ni, ng + hfn(ni));
        }
      }
    }
    return null;
  }

  // Is the straight segment between two world points walkable for a body of radius r (CEO)?
  segmentWalkable(x1, z1, x2, z2, doorPassable, r = 0.45) {
    const dist = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(2, Math.ceil(dist / 0.4));
    const nx = -(z2 - z1) / (dist || 1), nz = (x2 - x1) / (dist || 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      for (const o of [-r, 0, r]) {
        const tx = toTile(x + nx * o), tz = toTile(z + nz * o);
        if (!this.ceoWalkable(tx, tz, doorPassable)) return false;
        if (this.cell(tx, tz) === C.DOOR) return false; // never shortcut through doors; path through tile centres instead
      }
    }
    return true;
  }

  // ---- Vision ------------------------------------------------------------
  tileOpaque(x, z, doorOpen) {
    const c = this.cell(x, z);
    if (c === C.WALL) return true;
    if (c === C.VENT) return !this.ceoVents; // a vent he can crawl into is a tunnel he can see along
    if (c === C.DOOR) { const d = this.doorAt.get(z * this.w + x); return !d || !doorOpen(d.id); }
    return this.opaqueProp[z * this.w + x] === 1;
  }

  // Line of sight between two world points (x,z). Uses a dense march; cheap enough at our scales.
  lineOfSight(x1, z1, x2, z2, doorOpen) {
    const dist = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.ceil(dist / 0.25);
    const sTx = toTile(x1), sTz = toTile(z1), eTx = toTile(x2), eTz = toTile(z2);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = toTile(x1 + (x2 - x1) * t), tz = toTile(z1 + (z2 - z1) * t);
      if ((tx === sTx && tz === sTz) || (tx === eTx && tz === eTz)) continue;
      if (this.tileOpaque(tx, tz, doorOpen)) return false;
    }
    return true;
  }

  randomFloorTile(rng, filter) {
    for (let i = 0; i < 500; i++) {
      const x = Math.floor(rng() * this.w), z = Math.floor(rng() * this.h);
      if (this.cell(x, z) === C.FLOOR && !this.solidTop[z * this.w + x] && (!filter || filter(x, z))) return [x, z];
    }
    return null;
  }

  // Breadth-first reachability for players (used by tests/validation): vents & crates count as reachable.
  playerReachable(sx, sz, doorPassable) {
    const seen = new Uint8Array(this.w * this.h);
    const q = [[sx, sz]]; seen[sz * this.w + sx] = 1;
    while (q.length) {
      const [x, z] = q.shift();
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (!this.inBounds(nx, nz) || seen[nz * this.w + nx]) continue;
        const c = this.cell(nx, nz);
        const i = nz * this.w + nx;
        let ok = c === C.FLOOR || c === C.ELEVATOR || c === C.VENT;
        if (c === C.DOOR) { const d = this.doorAt.get(i); ok = !!d && doorPassable(d.id); }
        if (ok && this.solidTop[i] > 1.0) ok = false; // tall props block, low ones can be jumped
        if (ok) { seen[i] = 1; q.push([nx, nz]); }
      }
    }
    return seen;
  }
}

export { WALL_H, VENT_CEIL };

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const a = this.k, b = this.p; a.push(k); b.push(p);
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (b[j] <= b[i]) break; [a[i], a[j]] = [a[j], a[i]]; [b[i], b[j]] = [b[j], b[i]]; i = j; }
  }
  pop() {
    const a = this.k, b = this.p; const top = a[0];
    const lk = a.pop(), lp = b.pop();
    if (a.length) {
      a[0] = lk; b[0] = lp; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; [b[i], b[m]] = [b[m], b[i]]; i = m;
      }
    }
    return top;
  }
}

// Small deterministic RNG so server-generated puzzle data is reproducible per seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
