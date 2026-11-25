# CAT INCORPORATED

Online co-op (1–4 players) first-person survival horror. HTML/CSS/JS + Three.js client, Node.js + Socket.IO server.
CAT = **Consolidated Advanced Technologies**, an ordinary corporation with something under the basement.

## Run

```
npm install
npm start          # http://localhost:3000
npm test           # level validation + CEO AI tests + full 2-player online playthrough
node server/index.js --debug   # enables window.dbg({...}) cheats in the browser console
```

Friends on your network join via `http://<your-ip>:3000` and the 5-letter room code.

## Controls
WASD move · Mouse look (click the game to capture the mouse, Esc releases) · Shift sprint · Ctrl or C crouch · Space jump ·
E interact/hide · Right-click or F flashlight (batteries you grab load straight in) · 1–8/wheel select item · Q use battery/medkit · G drop item (hand off keycards) · J journal · T chat

## Story
1. **The workday.** Clock in, print and deliver the quarterly report, file folders. Delivering the report brings out **Mr. Thatch, the CEO, in his human form** to introduce himself.
2. **After hours.** The office empties. Dana's email points to Pruitt's desk. Taking the B1 card makes Thatch (still human) come after you; run for the restricted elevator.
3. **The reveal.** At the elevator Thatch transforms into the monster. In a cutscene the team piles in and the doors slam in his face, and the car goes *down*.
4. **B1–B5.** Every floor adds new puzzles, scripted scares (blackouts, his voice on the intercom, him hunting toward you) and a faster, sharper monster.
5. **The ending.** Burn him in the B5 incinerator, the elevator returns, and you ride up, walk out into the night, get in your car and drive home.

Your character comments on what they find and pick up, and teammates' lines show with their names. All of it is in `public/js/story.js`; cutscenes are in `public/js/cutscene.js` and `public/js/ending.js`.

## Objective markers
Gold diamond markers (with distance) point at whatever your current objectives need next — through walls, and as arrows on the screen edge when the target is behind you. They update as items are taken, notes read and switches thrown. The host can turn them off for everyone under **Lobby settings** (on by default). Targets are defined per objective in `shared/levels/*.js` (`targets`, plus `then` once those are done).

## Floors
| Floor | Objective | Threat |
|---|---|---|
| Level G – Offices | Clock in, print & deliver the report, file folders → after hours, find Pruitt's B1 card | none |
| B1 – Restricted Archives | Throw two far-apart breakers together, find 4 vault digits in notes, open the vault | slow CEO, wakes when power returns |
| B2 – Research & Development | Read the valve order on the monitor, open valves in order, take the card → **chase**, escape via vents | dormant until disturbed, then scripted chase |
| B3 – Employee Containment | Two fuses (one behind a timed lever gate), Warden's office | active hunting, checks lockers |
| B4 – Biological Research | Purge toxic gas, collect 3 specimens, sequencer prints card | faster CEO, gas hazards |
| B5 – Executive Level | Start 3 loud generators, arm the incinerator, lure Thatch inside | fastest, most perceptive CEO |

## Architecture
- `server/` – authoritative simulation. `Room.js` (lobby, 20 Hz tick, snapshots, checkpoints, death/reload), `Floor.js` (doors, items, puzzles via a data-driven action DSL, hazards, trap), `CEO.js` (patrol / investigate / search / chase / kill state machine, vision cones with LOS, hearing, A* + path smoothing, opens doors, can't use vents, never teleports), `saves.js` (checkpoint JSON in `saves/<CODE>.json`).
- `shared/` – used by both sides: tile grid (collision, nav, line of sight), constants, ASCII level definitions.
- `public/js/` – `main.js` (glue), `world.js` (instanced/batched level geometry, light pool, doors, gas), `props.js`, `textures.js` (procedural), `models.js` (GLB rigs with procedural animation), `player.js` (controller), `remotes.js` (interpolation), `audio.js` (procedural HRTF spatial audio and music), `ui.js`, `input.js`.
- `3d models/` – player, monster (the CEO) and flashlight GLBs.

Saving: every floor arrival writes a checkpoint under the room code. Use **Continue from save** with that code to resume. If the whole team dies, everyone reloads the floor's checkpoint; dead players spectate teammates until the next floor.
