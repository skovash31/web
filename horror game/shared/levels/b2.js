// B2 — Research & Development. Valve puzzle across a glass wall, then the first major chase.
export default {
  id: 'b2',
  index: 2,
  name: 'Research & Development',
  label: 'SUBLEVEL B2',
  theme: 'lab',
  intro: ['SUBLEVEL B2', 'Research & Development', 'Something is scratching behind a door nearby.'],
  startLights: 'on',
  map: `
####################################
#T1T..*..#2..*...3#..A..A..#S.S.S.S#
#ZZZ.....g........#.T....T.#.......#
#........g...cc...#.T.!..T.#S.S*S.S#
#...*....g........#........#.......#
#........g4......5#.A.a..A.#S.S.S.S#
#.p....L.#....*...#........#....b..#
####+########+########+########+####
#..*.......*.......*.......*.......#
#................................B.#
#....!..........B..........!.......#
####+########+#########6#######7####
#.B*.....#.T..*..T.#...*....#..q...#
#........#.Z..T..Z.#.R.R.R..#.Y..J.#
#.K......v.........#........#..X...#
#........#.T..T..T.#R..k..R.#......#
#L.....L.#.Z..Z..Z.v..!...c.#X....X#
####9#####....H....#.d......########
#..EE8####.........#.....B..########
#..EEE##############################
####################################`,
  marks: {
    1: { type: 'monitor', id: 'valve_monitor', group: 'valves', solid: 0.78, base: 'desk', title: 'Pressure control monitor' },
    2: { type: 'valve', id: 'valve_red', group: 'valves', label: 'RED', color: 0xd83a3a, wallFacing: true },
    3: { type: 'valve', id: 'valve_blue', group: 'valves', label: 'BLUE', color: 0x3a6ad8, wallFacing: true },
    4: { type: 'valve', id: 'valve_green', group: 'valves', label: 'GREEN', color: 0x3ad860, wallFacing: true },
    5: { type: 'valve', id: 'valve_yellow', group: 'valves', label: 'YELLOW', color: 0xe0c53a, wallFacing: true },
    6: { type: 'door', id: 'proto_door', lock: 'script', heavy: true, lockMsg: 'PROTOTYPE LAB — PRESSURE LOCK ENGAGED. Equalize the pressure valves.', sign: 'PROTOTYPE' },
    7: { type: 'door', id: 'closet_door', lock: 'script', heavy: true, lockMsg: 'SPECIMEN HOLDING. Something on the other side is breathing.', sign: 'HOLDING' },
    8: { type: 'elevator', id: 'elevator', cell: 'elevator', key: 'key_b3', next: 'b3', wallFacing: true },
    9: { type: 'door', id: 'elevator_door', elevatorDoor: true, lock: 'script' },
    k: { type: 'item', id: 'key_b3', kind: 'keycard', key: 'key_b3', name: 'B3 Keycard — Employee Containment', base: 'desk', solid: 0.78,
      onPickup: [{ open: 'closet_door' }, { unlock: 'closet_door' }, { sound: 'alarm' }, { lights: 'alarm' }, { msg: 'ALARM. The holding cell door slams open. RUN.', dur: 5 }, { ceo: 'activate' }, { ceo: 'chase' }, { flag: 'chase' }] },
    q: { type: 'ceoSpawn' },
    a: { type: 'note', id: 'b2_note_a', title: 'Lab notebook — Dr. Okafor',
      text: 'Day 212. Subject T. no longer requires the suit. Skin has regenerated fully, but it is wrong — too white, too smooth. The smile does not stop.\n\nDay 213. It asked for "staff." I think it means to eat.\n\nDay 230. We do not run the subject anymore. It runs us.' },
    b: { type: 'note', id: 'b2_note_b', title: 'Server printout',
      text: 'PRESSURE LOCK — PROTOTYPE LAB\nValves must be opened in the sequence shown on the observation monitor.\nINCORRECT SEQUENCE WILL TRIGGER THE ALARM.\nSpecimen holding is adjacent. Please keep noise to a minimum.' },
    d: { type: 'note', id: 'b2_note_d', title: 'Scrawled on a clipboard',
      text: 'if you take the card he will know. he always knows when his things are taken.\n\nthe vents. the vents are too small for him. crouch and crawl — the cafeteria vent comes out right by the elevator.' },
  },
  groups: {
    valves: { kind: 'sequence', count: 4, failLimit: 2,
      onProgress: 'Valve {n}/4 opens with a hiss.',
      onFail: 'Wrong valve! Pressure vents with a deafening shriek. Something slams against a door nearby.',
      failDo: [{ msg: 'The banging stops. A door groans open somewhere...', dur: 5 }, { open: 'closet_door' }, { unlock: 'closet_door' }, { ceo: 'activate' }],
      do: [{ unlock: 'proto_door' }, { open: 'proto_door' }, { sound: 'vault' }, { msg: 'Pressure equalized. The Prototype Lab unseals.' }, { flag: 'protoOpen' }] },
  },
  objectives: [
    { text: 'Read the valve sequence on the observation monitor', flag: 'readMonitor', targets: ['valve_monitor'] },
    { text: 'Open the pressure valves in the correct order', flag: 'protoOpen', after: 'readMonitor', targets: ['valve_red', 'valve_blue', 'valve_green', 'valve_yellow'] },
    { text: 'Take the B3 keycard from the Prototype Lab', flag: 'got_key_b3', after: 'protoOpen', targets: ['key_b3'] },
    { text: 'ESCAPE to the elevator — use the vents!', flag: 'never', after: 'got_key_b3', targets: ['elevator'] },
  ],
  rules: [],
  zones: [
    { id: 'z_cafe', rect: [10, 12, 18, 18], once: true, do: [{ say: { who: 'you', text: "Lunch trays still on the tables. They never even finished eating." } }] },
    { id: 'z_closet', rect: [28, 8, 34, 10], once: true, do: [{ sound: 'bang', at: true }, { say: { who: 'you', text: "Something just hit that door. From the inside." } }] },
    { id: 'z_tanks', rect: [19, 1, 26, 6], once: true, do: [{ say: { who: 'you', text: "Chemical tanks... and something floating in that one. Don't look at it. Keep moving." } }] },
  ],
  ceo: {
    active: false,
    walk: 1.75, run: 4.35, search: 2.3,
    vision: 17, darkVision: 7, fov: 105,
    hearing: 1.0, searchTime: 16, chaseLose: 5,
    hideCheck: 0.05, huntInterval: 0,
  },
};
