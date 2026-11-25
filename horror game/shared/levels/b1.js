// B1 — Restricted Archives. Introduces stealth: dark stacks, abandoned offices, a slow hunter.
export default {
  id: 'b1',
  index: 1,
  name: 'Restricted Archives',
  label: 'SUBLEVEL B1',
  theme: 'archives',
  intro: ['SUBLEVEL B1', 'Restricted Archives', 'The air smells of mould and toner.'],
  startLights: 'emergency',
  map: `
##################################
#############...k...##############
#############.S.*.S.##############
#############..n....##############
################1#################
#..*.....*...#.2.*.#.T..#.T..#.T.#
#.SSSS..SSSS.#.....#.Z*.#.Z!.#.Z.#
#......B.....#.....#...p#..a.#..3#
#.SSSS..SSSS.#..*..##+####+####+##
#.....b......+.....+..*....*...*.#
#.SSSS..SSSS.#.....#.............#
#............#..*..##+####+####+##
#.SSSS..SSSS.#.....#T...#T...#K.T#
#.K..*....K..#.....#BZ.!#.Ze.#...#
#....d...H...#.....#...K#p...#.B.#
###+##########.....###############
#4..*.###..*...T...*...#.Y..J...##
#......vvv.............+....!....#
#.K..X.###.............#..K....q.#
#L.....#########9#######.%.......#
#.......#######EE8######..S...S..#
###############EEE################
##################################`,
  marks: {
    1: { type: 'door', id: 'vault_door', lock: 'script', lockMsg: 'ARCHIVE VAULT. A heavy door with a four-digit keypad beside it.', heavy: true },
    2: { type: 'keypad', id: 'vault_keypad', group: 'vault', wallFacing: true, title: 'Vault keypad' },
    3: { type: 'switch', id: 'breaker_b', group: 'breakers', model: 'breaker', wallFacing: true, title: 'Breaker panel B' },
    4: { type: 'switch', id: 'breaker_a', group: 'breakers', model: 'breaker', wallFacing: true, title: 'Breaker panel A' },
    8: { type: 'elevator', id: 'elevator', cell: 'elevator', key: 'key_b2', next: 'b2', wallFacing: true },
    9: { type: 'door', id: 'elevator_door', elevatorDoor: true, lock: 'script' },
    k: { type: 'item', id: 'key_b2', kind: 'keycard', key: 'key_b2', name: 'B2 Keycard — Research & Development', base: 'pedestal', solid: 1.0 },
    q: { type: 'ceoSpawn' },
    n: { type: 'note', id: 'b1_vault_note', base: 'desk', solid: 0.78, title: 'Minutes — Board of Directors, 1987',
      text: 'MINUTES OF THE EXTRAORDINARY MEETING\nCAT Incorporated — Consolidated Advanced Technologies\n\nPresent: C. Thatch (CEO), the Board.\n\n1. Mr. Thatch reports Project LONGEVITY a complete success. He has "never felt better."\n2. Dr. Okafor raises concerns about the subject\'s "appetite." Concerns noted.\n3. Motion to establish an employee Retention Program to "sustain executive vitality." Passed unanimously.\n4. Dr. Okafor\'s resignation accepted. Dr. Okafor will be retained.\n\nThe meeting was adjourned when the lights failed.' },
    a: { type: 'note', id: 'b1_code_2', base: 'desk', solid: 0.78, title: 'Sticky note on a monitor',
      text: 'VAULT — 2nd digit is {code:vault:1}\n(changed it again after the auditor went missing)' },
    b: { type: 'note', id: 'b1_code_1', title: 'Archive index card',
      text: 'INDEX: RETENTION PROGRAM — DRAWERS 1–400\nVault access: see facilities.\nPenciled on the back: "first = {code:vault:0}"' },
    d: { type: 'note', id: 'b1_code_4', base: 'desk', solid: 0.78, title: 'Facilities work order',
      text: 'WORK ORDER #5521\nVault keypad replaced (claw damage).\nCode reset. LAST digit: {code:vault:3}\nTechnician did not sign out.' },
    e: { type: 'note', id: 'b1_code_3', base: 'desk', solid: 0.78, title: 'Torn diary page',
      text: '…he walks the stacks at night. You hear him before you see him — slow, heavy, like he is listening. Turn your light off. Stay low. Hide in the cabinets if he comes.\n\nI got one number before the lights went: third digit {code:vault:2}.\n\nThe breakers are at opposite ends of the floor. You have to throw them together or they trip again.' },
  },
  groups: {
    breakers: { kind: 'switchWindow', window: 12, soloWindow: 45,
      onProgress: 'Breaker thrown. The other one must be thrown within {t} seconds!',
      onReset: 'The breaker trips with a loud bang. Both must be thrown together.',
      do: [{ flag: 'power' }, { lights: 'on' }, { sound: 'powerup' }, { msg: 'Power restored. Somewhere in the dark, something heavy starts to move.', dur: 6 }, { ceo: 'activate' }] },
    vault: { kind: 'code', digits: 4, do: [{ unlock: 'vault_door' }, { open: 'vault_door' }, { sound: 'vault' }, { msg: 'The vault unlocks with a deep clunk.' }, { flag: 'vaultOpen' }], requires: 'power', failMsg: 'The keypad is dead. No power.' },
  },
  objectives: [
    { text: 'Restore power: throw both breakers at the same time', flag: 'power', targets: ['breaker_a', 'breaker_b'] },
    { text: 'Find the four vault digits in the archives', flag: 'vaultOpen', after: 'power', targets: ['b1_code_1', 'b1_code_2', 'b1_code_3', 'b1_code_4'], then: ['vault_keypad'] },
    { text: 'Take the B2 keycard from the vault', flag: 'got_key_b2', after: 'vaultOpen', targets: ['key_b2'] },
    { text: 'Return to the elevator', flag: 'never', after: 'got_key_b2', targets: ['elevator'] },
  ],
  rules: [],
  zones: [
    { id: 'z_stacks', rect: [1, 5, 12, 14], once: true, do: [{ say: { who: 'you', text: 'Rows and rows of personnel files... every one stamped RETAINED.' } }] },
    { id: 'z_offices', rect: [20, 5, 32, 14], once: true, do: [{ say: { who: 'you', text: "Coffee still in the mugs. Like everyone just stood up in the middle of the day and left." } }] },
    { id: 'z_lair', rect: [24, 16, 32, 20], once: true, do: [{ say: { who: 'you', text: 'Claw marks in the carpet... something sleeps in here.' } }] },
    { id: 'z_after_power', rect: [14, 5, 18, 18], requires: 'power', once: true, do: [{ blackout: 2.5 }, { say: { who: 'you', text: "No, no, no — come on, stay on..." } }, { ceo: 'hunt' }] },
  ],
  ceo: {
    active: false,
    walk: 1.55, run: 3.7, search: 2.1,
    vision: 15, darkVision: 6.5, fov: 100,
    hearing: 0.8, searchTime: 14, chaseLose: 4,
    hideCheck: 0, huntInterval: 0,
  },
};
