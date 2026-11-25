// B3 — Employee Containment. The missing employees. The CEO hunts actively here.
export default {
  id: 'b3',
  index: 3,
  name: 'Employee Containment',
  label: 'SUBLEVEL B3',
  theme: 'containment',
  intro: ['SUBLEVEL B3', 'Employee Containment', 'You recognize some of the faces behind the glass.'],
  startLights: 'on',
  map: `
######################################
#EE8#####.Y.#J..#.L.#Y..#.p.##S..k..S#
#EEE#####...#...#...#...#...##...*...#
##9######.%.#.%.#.%.#.%.#.%.##.T.w...#
#...B...#ggg#ggg#g+g#ggg#ggg##..Z....#
#..*....#....*.....*.....*...#L.....K#
#L.....L#....................####6####
#.......+..!.......B.....!...+..*....#
#..1....#....................#......5#
#L..H..L#....*.....*.....*...#l......#
###+#####ggg#ggg#g+g#ggg#ggg#####G####
#.......#...#...#...#...#...##.B.....#
#.T.T.f.#.Y.#...#d..#.J.#Y.Y##.Y.!.Y.#
#...*...#.%.#J.Y#.%.#..Y#.%.##R..u..R#
#K.....K##########+###########.......#
#.......##########.###########.J.Y.J.#
###+##############.##############v####
#..*.......*.......*.......*.......q.#
#...........B......................H.#
#....!.........B.........!...........#
######################################`,
  marks: {
    1: { type: 'note', id: 'b3_intake', base: 'desk', solid: 0.78, title: 'Intake log',
      text: 'RETENTION PROGRAM — INTAKE\n\nMARTIN KOWALSKI — Accounts — "Calm on arrival." Cell 4.\nPRIYA SHAH — IT — "Asked for her phone." Cell 2.\nDANA REYES — Records — Escaped holding. Located. Isolation.\nRICHARD PRUITT — Management — (Pending. Board approval.)\n\nFeeding schedule posted in Warden\'s office.' },
    5: { type: 'socket', id: 'fusebox', group: 'fuses', accepts: 'fuse', model: 'fusebox', wallFacing: true, title: 'Cell block fusebox', emptyMsg: 'The fusebox for the Warden\'s office door. Two fuses are missing.' },
    6: { type: 'door', id: 'warden_door', lock: 'script', heavy: true, lockMsg: "WARDEN'S OFFICE — NO POWER TO LOCK. The fusebox nearby is missing fuses.", sign: 'WARDEN' },
    8: { type: 'elevator', id: 'elevator', cell: 'elevator', key: 'key_b4', next: 'b4', wallFacing: true },
    9: { type: 'door', id: 'elevator_door', elevatorDoor: true, lock: 'script' },
    G: { type: 'door', id: 'iso_gate', lock: 'script', gate: true, lockMsg: 'ISOLATION GATE. It only opens while the lever is held.', sign: 'ISOLATION' },
    l: { type: 'lever', id: 'iso_lever', door: 'iso_gate', time: 9, soloTime: 16, wallFacing: true, title: 'Isolation gate lever' },
    k: { type: 'item', id: 'key_b4', kind: 'keycard', key: 'key_b4', name: 'B4 Keycard — Biological Research', base: 'desk', solid: 0.78 },
    f: { type: 'item', id: 'fuse_1', kind: 'fuse', name: 'Fuse', base: 'desk', solid: 0.78 },
    u: { type: 'item', id: 'fuse_2', kind: 'fuse', name: 'Fuse', fixed: true }, // stays in the timed-gate room
    w: { type: 'note', id: 'b3_warden', title: "Warden's log",
      text: 'He comes down more often now. He used to come once a month. Now it is every night.\n\nHe does not walk the corridors like before. He HUNTS. He knows where they are hiding — he listens for the heartbeat, I swear it.\n\nThe lockers are not safe if he saw you get in.\n\nI am requesting a transfer to B1.' },
    d: { type: 'note', id: 'b3_dana', title: "Dana's notebook",
      text: 'If someone finds this — I made it further than the others.\n\nB4 is where they grow it. The thing wearing Thatch is not a man. It was a sample. It got into him in \'87 and it has been running the company ever since.\n\nThe Executive Level has a furnace. That is how it ends. Get it inside and burn it.\n\nTell my sister I\'m sorry.\n— Dana' },
    q: { type: 'ceoSpawn' },
  },
  groups: {
    fuses: { kind: 'socket', need: 2, onProgress: 'Fuse inserted: {n}/2', do: [{ unlock: 'warden_door' }, { open: 'warden_door' }, { sound: 'powerup' }, { msg: "The Warden's office door shudders open." }, { flag: 'wardenOpen' }, { noise: 16 }] },
  },
  objectives: [
    { text: 'Find two fuses for the cell block fusebox', flag: 'wardenOpen', targets: ['fuse_1'], then: ['fusebox'] },
    { text: 'One fuse is in Isolation — hold the gate lever (or sprint!)', flag: 'got_fuse_2', targets: ['iso_lever', 'fuse_2'] },
    { text: "Take the B4 keycard from the Warden's office", flag: 'got_key_b4', after: 'wardenOpen', targets: ['key_b4'] },
    { text: 'Return to the elevator', flag: 'never', after: 'got_key_b4', targets: ['elevator'] },
  ],
  rules: [],
  zones: [
    { id: 'z_cells', rect: [9, 4, 27, 10], once: true, do: [{ say: { who: 'you', text: "Those are name badges. Martin from Accounts... Priya from IT. They didn't quit. They were brought here." } }] },
    { id: 'z_iso', rect: [30, 11, 36, 15], once: true, do: [{ say: { who: 'you', text: "Dana...? Oh no. No, no, no." } }, { ceo: 'hunt' }] },
    { id: 'z_guard', rect: [1, 11, 7, 15], once: true, do: [{ blackout: 3 }, { say: { who: 'you', text: "Lights — come on, come on!" } }, { ceo: 'hunt' }] },
    { id: 'z_south', rect: [20, 17, 36, 19], once: true, do: [{ say: { who: 'thatch', text: "I can hear your heart from here. Such a strong, healthy heart.", dur: 5 } }, { ceo: 'hunt' }] },
  ],
  ceo: {
    active: true,
    walk: 1.95, run: 4.6, search: 2.5,
    vision: 18, darkVision: 7.5, fov: 110,
    hearing: 1.25, searchTime: 20, chaseLose: 6,
    hideCheck: 0.15, huntInterval: 45,
  },
};
