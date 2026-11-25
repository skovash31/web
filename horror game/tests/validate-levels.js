// Static validation of every level map: parsing, row widths, door placement, reachability
// of every interactable from the spawn, CEO navigation connectivity and patrol coverage.
import { LEVELS } from '../shared/levels/index.js';
import { Grid, C } from '../shared/grid.js';

let failures = 0;
const fail = (lvl, msg) => { failures++; console.log(`  FAIL [${lvl}] ${msg}`); };

export function validateLevels(verbose = false) {
  failures = 0;
  for (const level of LEVELS) {
    const rows = level.map.split('\n').filter((r) => r.length);
    const widths = new Set(rows.map((r) => r.length));
    if (widths.size !== 1) fail(level.id, `row widths differ: ${rows.map((r, i) => `${i}:${r.length}`).filter((s, i) => rows[i].length !== rows[0].length).join(' ')} (expected ${rows[0].length})`);
    let grid;
    try { grid = new Grid(level); } catch (e) { fail(level.id, e.message); continue; }
    // Outer border must be solid.
    for (let x = 0; x < grid.w; x++) for (const z of [0, grid.h - 1]) if (grid.cell(x, z) !== C.WALL) fail(level.id, `border open at ${x},${z}`);
    for (let z = 0; z < grid.h; z++) for (const x of [0, grid.w - 1]) if (grid.cell(x, z) !== C.WALL) fail(level.id, `border open at ${x},${z}`);
    // Doors must sit between two walls on one axis and open tiles on the other.
    for (const e of grid.entities.filter((e) => grid.cell(e.tx, e.tz) === C.DOOR)) {
      const a = e.axis === 'x' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
      const b = e.axis === 'x' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      if (!a.every(([dx, dz]) => grid.isWallish(e.tx + dx, e.tz + dz))) fail(level.id, `door ${e.id} at ${e.tx},${e.tz} not framed by walls`);
      if (!b.every(([dx, dz]) => { const c = grid.cell(e.tx + dx, e.tz + dz); return c !== C.WALL && c !== C.GLASS; })) fail(level.id, `door ${e.id} at ${e.tx},${e.tz} does not connect two open tiles`);
    }
    const spawn = grid.entities.find((e) => e.type === 'spawn') ? [grid.entities.find((e) => e.type === 'spawn').tx, grid.entities.find((e) => e.type === 'spawn').tz] : grid.elevatorTiles[0];
    if (!spawn) { fail(level.id, 'no spawn / elevator tiles'); continue; }
    if (!grid.entities.find((e) => e.type === 'elevator')) fail(level.id, 'no elevator panel');
    const reach = grid.playerReachable(spawn[0], spawn[1], () => true);
    const near = (e) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = e.tx + dx, z = e.tz + dz;
        if (grid.inBounds(x, z) && reach[z * grid.w + x]) return true;
      }
      return false;
    };
    for (const e of grid.entities) {
      if (['decor', 'prop', 'ceoSpawn'].includes(e.type)) continue;
      if (!near(e)) fail(level.id, `${e.type} ${e.id} at ${e.tx},${e.tz} unreachable from spawn`);
    }
    // Objective marker targets must name real entities.
    const ids = new Set(grid.entities.map((e) => e.id));
    for (const o of level.objectives || []) for (const t of [...(o.targets || []), ...(o.then || [])]) if (!ids.has(t)) fail(level.id, `objective marker target '${t}' does not exist`);
    // Elevator tiles must be reachable.
    for (const [x, z] of grid.elevatorTiles) if (!reach[z * grid.w + x]) fail(level.id, `elevator tile ${x},${z} unreachable`);
    // CEO checks
    if (level.ceo) {
      const cs = grid.entities.find((e) => e.type === 'ceoSpawn');
      if (!cs) fail(level.id, 'CEO config but no ceoSpawn mark');
      else {
        let reachable = 0, total = 0;
        for (let z = 0; z < grid.h; z++) for (let x = 0; x < grid.w; x++) {
          if (!grid.ceoWalkable(x, z, () => true) || !reach[z * grid.w + x]) continue;
          total++;
          if (grid.findPath(cs.tx, cs.tz, x, z, () => true, 20000)) reachable++;
        }
        if (reachable / total < 0.85) fail(level.id, `CEO can only reach ${reachable}/${total} walkable tiles`);
        if (verbose) console.log(`  [${level.id}] CEO reaches ${reachable}/${total} tiles`);
      }
    }
    if (verbose) console.log(`  [${level.id}] ${grid.w}x${grid.h}, ${grid.entities.length} entities, ${grid.lights.length} lights`);
  }
  return failures;
}

if (process.argv[1] && process.argv[1].endsWith('validate-levels.js')) {
  const f = validateLevels(true);
  console.log(f ? `${f} level validation failures` : 'All levels valid');
  process.exit(f ? 1 : 0);
}
