// B5 — Executive Level. The company's secret, and the final confrontation in the furnace.
export default {
  id: 'b5',
  index: 5,
  name: 'Executive Level',
  label: 'SUBLEVEL B5',
  theme: 'executive',
  intro: ['SUBLEVEL B5', 'Executive Level', 'Mr. Thatch will see you now.'],
  startLights: 'on',
  elevatorLeaves: 7,
  elevatorLeavesMsg: 'The elevator doors slide shut behind you, and the car rises away. There is no way back up.',
  map: `
########################################
#S.........S#S..S..SS..S..S#X..X...X..X#
#..Y.Y.Y.Y..#...........B..#...........#
#..TTTTTTT..#.....TnT......#.....2.....#
#..Y.Y.Y.Y..#.......*......#..!........#
#.*...b...*.#.P....q.....P.#c....c..L..#
#K.........K#..e.....K.....#...........#
######+#############+#############+#####
#..*.......*.......*.......*.......*...#
#..............................B.......#
#..P.....!..............!...........P..#
######+############+#############F###+##
#...........#..*.......*...###......#.##
#..X..1..X..#....TTTT......###......#.##
#...!.......#...B..........###..JJ..#.##
#L....H....L#.P..........P.###......#.##
###v##############9###########......#.##
#.3.........#####EE8#############N###.##
#.K.....c..K#####EEE#############.....o#
#....B.................................#
########################################`,
  marks: {
    1: { type: 'switch', id: 'gen_1', group: 'gens', model: 'generator', solid: 1.5, title: 'Furnace generator 1' },
    2: { type: 'switch', id: 'gen_2', group: 'gens', model: 'generator', solid: 1.5, title: 'Furnace generator 2' },
    3: { type: 'switch', id: 'gen_3', group: 'gens', model: 'generator', solid: 1.5, title: 'Furnace generator 3' },
    F: { type: 'door', id: 'furnace_front', heavy: true, sign: 'INCINERATOR' },
    N: { type: 'door', id: 'furnace_back', heavy: true, sign: 'INCINERATOR' },
    o: { type: 'console', id: 'furnace_console', wallFacing: true, title: 'Incinerator control', requires: 'gensOnline',
      failMsg: 'INCINERATOR CONTROL — NO POWER. Restart all three furnace generators.' },
    8: { type: 'elevator', id: 'elevator', cell: 'elevator', key: null, next: 'surface', wallFacing: true },
    9: { type: 'door', id: 'elevator_door', elevatorDoor: true, lock: 'script' },
    q: { type: 'ceoSpawn' },
    n: { type: 'note', id: 'b5_journal', base: 'desk', solid: 0.78, title: "C. Thatch — private journal",
      text: 'They think the company feeds me. They have it backwards.\n\nI AM the company. Every quarter it grows, and every quarter I must grow with it. Consolidated. Advanced. Together.\n\nThe Board were the first to be retained. They still attend every meeting.\n\nI will not die in a hospital bed again. I will not die at all. There is always another employee.' },
    b: { type: 'note', id: 'b5_board', title: 'Boardroom place card',
      text: 'BOARD OF DIRECTORS — ANNUAL MEETING\n\nThe members around this table have not moved in a very long time. Their skin is papery, hollow, white as chalk. Each one wears the same frozen smile as Thatch.\n\nThe agenda reads only: "1. Growth."' },
    e: { type: 'note', id: 'b5_furnace', title: 'Facilities: Incinerator procedure',
      text: 'INCINERATOR (EAST WING)\n1. Bring all three furnace generators online (they are LOUD).\n2. Arm the chamber at the control panel behind the rear door.\n3. When armed, the chamber seals automatically once a large body is detected inside and no personnel are present.\n\nIt will follow you. Let it.' },
  },
  groups: {
    gens: { kind: 'switchPermanent', need: 3, onProgress: 'Generator online: {n}/3. The roar echoes through the whole floor.',
      eachDo: [{ noise: 22 }, { sound: 'generator' }],
      do: [{ flag: 'gensOnline' }, { msg: 'All generators online. The incinerator control panel is live.', dur: 5 }, { sound: 'powerup' }] },
  },
  trap: { zone: [30, 12, 35, 16], doors: ['furnace_front', 'furnace_back'], armFlag: 'trapArmed' },
  objectives: [
    { text: 'Read the incinerator procedure in Thatch\'s office', flag: 'read_b5_furnace', targets: ['b5_furnace'] },
    { text: 'Bring all three furnace generators online', flag: 'gensOnline', targets: ['gen_1', 'gen_2', 'gen_3'] },
    { text: 'Arm the incinerator at the control panel', flag: 'trapArmed', after: 'gensOnline', targets: ['furnace_console'] },
    { text: 'Lure Thatch into the incinerator chamber — and get out', flag: 'thatchDead', after: 'trapArmed', targets: ['furnace_front'] },
    { text: 'Take the elevator back to the surface', flag: 'never', after: 'elevatorBack', targets: ['elevator'] },
  ],
  rules: [],
  zones: [
    { id: 'z_board', rect: [1, 1, 11, 6], once: true, do: [{ blackout: 4 }, { say: { who: 'thatch', text: 'The Board is in session. Please — take a seat.', dur: 5 } }, { ceo: 'hunt' }] },
    { id: 'z_office', rect: [13, 1, 26, 6], once: true, do: [{ say: { who: 'thatch', text: "You're standing in my office. Nobody stands in my office.", dur: 5 } }, { ceo: 'hunt' }] },
    { id: 'z_furnace', rect: [28, 12, 38, 19], once: true, do: [{ say: { who: 'you', text: "The incinerator. Dana was right — this is how it ends." } }] },
  ],
  ceo: {
    active: true,
    walk: 2.25, run: 5.05, search: 2.8,
    vision: 21, darkVision: 9, fov: 120,
    hearing: 1.6, searchTime: 25, chaseLose: 8,
    hideCheck: 0.35, huntInterval: 22,
  },
};
