// LEVEL G — The ordinary workday at CAT INCORPORATED (Consolidated Advanced Technologies).
export default {
  id: 'office',
  index: 0,
  name: 'Corporate Offices',
  label: 'LEVEL G',
  theme: 'office',
  intro: ['CAT INCORPORATED', 'Regional Headquarters', '8:58 AM. Another Tuesday.'],
  startLights: 'on',
  map: `
################################
#.....#..*.....*.....*...#.....#
#.s...+..................+....2#
#.*...#..TT..TT..TT..TT..#..*..#
#1....#..ZZ..ZZ..ZZ..ZZ..#..p..#
#W....#.........f........#..q..#
###+###..TT..TT..TT..TT..#######
#.*..W#..ZZ..ZZ..ZZ..ZZ..#.k.n.#
#.....+....h.............3..*..#
#P.w..#..TT..TT..TT..TT.5#....P#
#.....#..*......*.....*..#######
###+######+########+############
#..*......*......*......*......#
####+#########+###########7#####
#..*.....#..X..*..X..#....!....#
#6..K.K..#.X..j....X.#####9#####
#....p...#...c..B....###EE8#####
#S.S.S.S.#X.........X###EEE#####
################################`,
  marks: {
    s: { type: 'spawn' },
    1: { type: 'terminal', id: 'clock', title: 'EMPLOYEE TERMINAL — TIMEKEEPING', solid: 1.0, model: 'terminal', wallFacing: true,
      text: 'Welcome back.\n\nPlease clock in to begin your shift.\nRemember: a productive employee is a retained employee.\n\n— Human Resources',
      setFlag: 'clockedIn', useMsg: 'You clocked in. 8:59 AM.',
      after: { flag: 'endOfDay', setFlag: 'readEmail', title: 'NEW MESSAGE (1)', text: 'FROM: dana.reyes@cat-inc.com\nSENT: 6:41 PM\nSUBJECT: (no subject)\n\nIf you are reading this I am already downstairs.\n\nThe "retention program" is not a bonus scheme. Nobody who gets selected comes back up. I saw Martin go into the restricted elevator in March and his desk was cleared by lunch.\n\nPruitt keeps a B1 keycard in his desk. His office is open now — the cleaners unlock it at end of day.\n\nDon\'t trust Thatch. Don\'t let him see you.\n\n— D.' } },
    2: { type: 'dispenser', id: 'copier', model: 'copier', solid: 1.1, wallFacing: true, title: 'Copier',
      give: { kind: 'report', name: 'Quarterly report' }, setFlag: 'hasReport', requires: 'clockedIn', failMsg: 'The copier asks for your employee login. Clock in first.', useMsg: 'The copier groans and prints the quarterly report.', once: true },
    3: { type: 'door', id: 'pruitt_door', lock: 'script', lockMsg: 'R. PRUITT — REGIONAL MANAGER. Locked.' },
    5: { type: 'socket', id: 'inbox', group: 'inbox', accepts: 'report', model: 'tray', title: "Pruitt's inbox tray", emptyMsg: "Pruitt's inbox. He's waiting for the quarterly report." },
    6: { type: 'socket', id: 'records', group: 'records', accepts: 'file', model: 'filecab', solid: 1.3, wallFacing: true, title: 'Records cabinet', emptyMsg: 'Three folders are missing from this cabinet. They are probably on someone\'s desk.' },
    7: { type: 'door', id: 'restricted_door', lock: { key: 'key_b1' }, lockMsg: 'RESTRICTED — AUTHORIZED PERSONNEL ONLY. Card reader blinks red.', sign: 'RESTRICTED' },
    8: { type: 'elevator', id: 'elevator', cell: 'elevator', key: 'key_b1', next: 'b1', wallFacing: true },
    9: { type: 'door', id: 'elevator_door', elevatorDoor: true, lock: { key: 'key_b1' }, lockMsg: 'A private elevator. The reader wants a B1 card.' },
    k: { type: 'item', id: 'key_b1', kind: 'keycard', key: 'key_b1', name: 'B1 Keycard — Restricted Archives', hidden: true, base: 'desk', solid: 0.78,
      onPickup: [
        { say: { who: 'thatch', text: 'Richard always was careless with that card. And you... always so diligent.', dur: 5 } },
        { ceo: 'activate' }, { ceo: 'chase' }, { flag: 'officeChase' },
        { msg: 'Mr. Thatch is coming. RUN to the restricted elevator!', dur: 5 },
      ] },
    q: { type: 'ceoSpawn' },
    n: { type: 'note', id: 'memo_pruitt', base: 'desk', solid: 0.78, title: 'Internal memo — CONFIDENTIAL',
      text: 'TO: R. Pruitt\nFROM: Office of the CEO\n\nRichard,\n\nThe Board thanks you for your nominations for this quarter\'s Retention Program. Mr. Thatch personally reviewed each file.\n\nAs always, nominees should not be informed. Their access cards will be revoked upon descent.\n\nMr. Thatch is hungry for results.\n\nKeep the B1 card in your desk. Do not lose it again.' },
    w: { type: 'note', id: 'whiteboard', model: 'whiteboard', title: 'Break room whiteboard',
      text: 'CONGRATS TO OUR RETENTION PROGRAM NOMINEES!\n  - Martin K.  - Dana R.  - (TBD)\n\nReminder: The lower levels are OFF LIMITS.\nMr. Thatch is visiting this Friday — please look busy!\n\nCAT INC: "Consolidated. Advanced. Together."' },
    f: { type: 'item', id: 'file_1', kind: 'file', name: 'Misplaced folder (Accounts)' },
    h: { type: 'item', id: 'file_2', kind: 'file', name: 'Misplaced folder (Payroll)' },
    j: { type: 'item', id: 'file_3', kind: 'file', name: 'Misplaced folder (Personnel)' },
  },
  groups: {
    records: { kind: 'socket', need: 3, onProgress: 'Folders filed: {n}/3', do: [{ flag: 'filed' }, { msg: 'All folders filed. Records will be pleased.' }] },
    inbox: { kind: 'socket', need: 1, do: [{ flag: 'delivered' }, { msg: 'Report delivered. Pruitt never even comes out of his office.' }] },
  },
  objectives: [
    { text: 'Clock in at the reception terminal', flag: 'clockedIn', targets: ['clock'] },
    { text: 'Print the quarterly report at the copier', flag: 'hasReport', after: 'clockedIn', targets: ['copier'] },
    { text: "Deliver the report to Pruitt's inbox", flag: 'delivered', after: 'hasReport', targets: ['inbox'] },
    { text: 'Return 3 misplaced folders to the records cabinet', flag: 'filed', targets: ['file_1', 'file_2', 'file_3'], then: ['records'] },
    { text: 'Check the reception terminal', flag: 'readEmail', after: 'endOfDay', targets: ['clock'] },
    { text: "Find the keycard in Pruitt's office", flag: 'got_key_b1', after: 'endOfDay', targets: ['key_b1'] },
    { text: 'RUN to the restricted elevator!', flag: 'never', after: 'got_key_b1', targets: ['restricted_door', 'elevator'] },
  ],
  rules: [
    {
      when: ['clockedIn', 'filed', 'delivered'],
      do: [
        { lights: 'dim' },
        { sound: 'powerdown' },
        { msg: '6:47 PM. The office has emptied out around you. The lights shut off one floor at a time.', dur: 7 },
        { flag: 'endOfDay' },
        { unlock: 'pruitt_door' }, { open: 'pruitt_door' },
        { show: 'key_b1' },
      ],
    },
  ],
  zones: [
    { id: 'z_escape', rect: [22, 14, 30, 14], requires: 'officeChase', once: true, do: [{ cutscene: 'elevatorEscape' }] },
  ],
  // Mr. Thatch, still wearing his human face. He can't be outrun forever, but he's no sprinter.
  ceo: {
    active: false, form: 'human',
    walk: 1.6, run: 3.55, search: 2.0,
    vision: 30, darkVision: 22, fov: 160,
    hearing: 2, searchTime: 30, chaseLose: 999,
    hideCheck: 1, huntInterval: 0,
  },
};
