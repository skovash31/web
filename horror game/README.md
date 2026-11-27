# CAT INCORPORATED

Online co-op (1–4 players) first-person survival horror. HTML/CSS/JS + Three.js client, Node.js + Socket.IO server.
CAT = **Consolidated Advanced Technologies**, an ordinary corporation with something under the basement.

## Run

```
npm install
npm start          # http://localhost:3000
npm test           # level validation, CEO AI, stun/difficulty/item/locker tests, stapler + held-item tests, full 2-player online playthrough
node server/index.js --debug   # enables window.dbg({...}) cheats in the browser console
```

Friends on your network join via `http://<your-ip>:3000` and the 5-letter room code.

## Controls
WASD move · Mouse look (click the game to capture the mouse, Esc releases) · Shift sprint · Ctrl or C crouch · Space jump · E interact/hide ·
**Left click** use what's in your hand · **Right click** use your off-hand item (or drink coffee / use a first-aid kit you're holding) · **F** flashlight on/off ·
**X** put the held item in your off hand (swap) · **R** reload what you're holding (stapler from staples, flashlight from a battery) · **Q**/G drop the held item ·
1–8/wheel select item · J journal · T chat

## Hands and items
You have two hands. The **main hand** (right of the screen) holds the selected hotbar slot; the **off hand** (left, the slot above the hotbar) holds one more item. Whatever you hold shows in your hand using its model from `3d models/` (flashlight, stapler, battery, first-aid kit, folder, fuse, coffee, staples).
- **Flashlight**: everyone carries one; it starts in your off hand. It only shines while you hold it, can't be dropped and stays with you when you die. Batteries go into your inventory; when it runs low or dies, hold it and press **R** to swap in a battery (about 1.5 s).
- **First-aid kit**: right click (or left click) while holding it: +60 health, full stamina, no more exhaustion.
- **Coffee** (found on desks: 2 in the office, 1 per sublevel): 20 seconds of running 35% faster without using stamina. It carries between floors.
- The stapler can be used from either hand (left click main, right click off hand).
- **Nothing Button**: 2–4 in the office, 1 on every other floor, somewhere random. Press it (left click). It does nothing… usually. Each press has a **1% chance** to give you a **pistol** (loaded with 6, plus a box of 12 bullets). After **5 presses** the button crumbles away.
- **Pistol**: a hit **stuns Mr. Thatch for 30 seconds** (a bullet during a staple stun upgrades it to 30 s; nothing ever adds up). Gunshots are loud — he hears them from 30 m. R reloads in 3 s. Spare **boxes of bullets** (12 each) turn up rarely: each lower floor (B1–B5) has a 20% chance of hiding one.

## Story
1. **The workday.** Clock in, print and deliver the quarterly report, file folders. Delivering the report brings out **Mr. Thatch, the CEO, in his human form** to introduce himself.
2. **After hours.** The office empties. Dana's email points to Pruitt's desk. Taking the B1 card makes Thatch (still human) come after you; run for the restricted elevator.
3. **The reveal.** At the elevator Thatch transforms into the monster. In a cutscene the team piles in and the doors slam in his face, and the car goes *down*.
4. **B1–B5.** Every floor adds new puzzles, scripted scares (blackouts, his voice on the intercom, him hunting toward you) and a faster, sharper monster.
5. **The ending.** Burn him in the B5 incinerator, the elevator returns, and you ride up, walk out into the night, get in your car and drive home.

Your character comments on what they find and pick up, and teammates' lines show with their names. All of it is in `public/js/story.js`; cutscenes are in `public/js/cutscene.js` and `public/js/ending.js`.

## Flashlight stun
Shine your flashlight **straight into Mr. Thatch's eyes** (he has to be facing you, within ~11 m, nothing in between) and hold it for a moment: he's **blinded for 5 seconds**: he freezes with his hands over his face, can't see, hear or catch anyone, and loses track of you afterwards. The stun then **recharges for 15 seconds** (shared by the team). The HUD shows *THATCH IS BLINDED* / *recharging* / *ready*, and the crosshair turns into a gold ring while your beam is on his eyes. It works on his human form too, but not during cutscenes. The server decides every blind (`server/CEO.js`, `BLIND`).

## Stapler
Every floor hides a **heavy-duty stapler** and boxes of staples (1 box in the office, 2 on each sublevel) at random reachable spots, re-rolled each time a floor loads. A stapler starts **empty**; each **box holds 20 staples**.
- Select the stapler (it is auto-selected when you pick it up) and **left-click** to fire (one shot every 0.4 s, 16 m range).
- **R** (or **Q** on the stapler) reloads: it takes **exactly 5 seconds**, only works if you carry staples, and you can't fire meanwhile. The HUD shows `loaded / spare` and a reload bar; the held stapler tips up and flips open.
- A hit **stuns Mr. Thatch for exactly 10 seconds**: he can't move, attack or chase, and loses track of you afterwards. The staple **sticks where it hit** on his model (same spot for every player) and the staples fall out when he recovers. More hits during a stun stick but never extend or restart it.
- The server decides every shot, hit and stun (`Room.handleFire`, `CEO.staple`); staplers and staples carry over between floors with their ammo.

## The Lurker
Something lives in the lockers and cabinets. **Hide too long** and it wakes up: **10 seconds before** the limit you hear it breathing and scratching behind you (only the hider hears it). At the limit it **bursts out, shoves you into the hall facing the locker, and takes half your current health** (it never kills on its own). Teammates nearby see it lunge out. That locker stays off-limits for 20 s, and hiding time only drains back slowly once you're out (1 s per second), so hopping straight into the next locker doesn't reset the clock.

| Difficulty | Easy | Normal | Medium | Hard |
|---|---|---|---|---|
| Time you can hide | 45 s | 35 s | 30 s | 25 s |

Tuning: `LURKER` and `DIFFICULTIES.hideLimit` in `shared/constants.js`; server logic in `Room.lurker`; the creature is `public/js/lurker.js`.

## Music
Tracks from `music/`: `Basesoundtrack.mp3` during normal play, `chase.mp3` whenever Mr. Thatch is actively chasing anyone (not while he's blinded or stunned), `elevator.mp3` while you're in an elevator (and on the ride up in the ending). Priority is chase › elevator › base; only one track is ever audible (the old one fades out before the next fades in), base and elevator resume where they paused, and a chase theme only restarts for a new chase. See `public/js/music.js`.

## Difficulty
The host picks it under **Lobby settings** (Normal by default; locked once the shift starts; shown on each floor's intro card).

| Difficulty | Monster |
|---|---|
| Easy | 0.5× speed, **cannot open doors** (doors you leave open still let him through); 45 s in a locker before the Lurker wakes |
| Normal | standard behaviour and speed |
| Medium | 1.2× speed, faster detection and sharper hearing, checks more lockers, searches longer, hunts more often, opens doors faster |
| Hard | **1.5× speed**, Medium's senses, and he **crawls through vents** after you (vents are no longer safe); only 25 s in a locker |

Tuning lives in `shared/constants.js` (`DIFFICULTIES`).

## Random items
Batteries, first-aid kits and the office's misplaced folders are scattered to a new random spot every time a floor loads (new game, next floor or checkpoint reload). Each one stays inside the same door-bounded area it was designed for and lands only on open floor or on a desk, crate or gurney, never in a wall, a sealed room, a gas cloud or a doorway. Story items (keycards, fuses, specimens) keep their places. See `Floor.randomizeItems()`.

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
- `server/` – authoritative simulation. `Room.js` (lobby, 20 Hz tick, snapshots, checkpoints, death/reload), `Floor.js` (doors, items, puzzles via a data-driven action DSL, hazards, trap), `CEO.js` (patrol / investigate / search / chase / kill state machine, vision cones with LOS, hearing, A* + path smoothing, opens doors, can't use vents except on Hard, flashlight stun, difficulty scaling, never teleports), `saves.js` (checkpoint JSON in `saves/<CODE>.json`).
- `shared/` – used by both sides: tile grid (collision, nav, line of sight), constants, ASCII level definitions.
- `public/js/` – `main.js` (glue), `world.js` (instanced/batched level geometry, light pool, doors, gas), `props.js`, `textures.js` (procedural), `models.js` (GLB rigs with procedural animation), `player.js` (controller), `remotes.js` (interpolation), `audio.js` (procedural HRTF spatial audio and music), `ui.js`, `input.js`.
- `3d models/` – `player.glb` (employees), `boss.glb` (Mr. Thatch's human form), `monster.glb` (his true form; jointed elbows and knees are animated, and the stun aims at his real eye position), `flashlight.glb` (held in first person and by teammates) and `car.glb` (the car you drive home in).

Saving: every floor arrival writes a checkpoint under the room code. Use **Continue from save** with that code to resume. If the whole team dies, everyone reloads the floor's checkpoint; dead players spectate teammates until the next floor.
