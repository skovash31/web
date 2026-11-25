// B4 — Biological Research. Gas-flooded specimen labs; purge the air and harvest the samples.
export default {
  id: 'b4',
  index: 4,
  name: 'Biological Research',
  label: 'SUBLEVEL B4',
  theme: 'bio',
  intro: ['SUBLEVEL B4', 'Biological Research', 'The tanks are not empty.'],
  startLights: 'on',
  map: `
########################################
#A..A..A..A..#A.A.A..A.A.A#..A..A..A..A#
#............#......q.....#............#
#.R.R.%..R.R.#.R..y....R..#.R.R..%.R.R.#
#............#....!.......#............#
#A..A.x..A..A#A.A....J.A.A#A..A..A..A..#
#............#.....b......#.....z......#
#.Y..J...R.Y.######+#######.Y.......R..#
#....!.......#3...*....*.5#.......!....#
#L..........L#.........k..#L..........L#
#...T..T..a..+.....T..T...+..T..d..T...#
#............#......B.....#............#
#K....H.....K#..*......*..#K....B.....K#
######v#############+############v######
#..*.........!.......*........!.....*..#
#.......B.....................B........#
#........*.........................*...#
######+############9############+#######
#.X..c...X..L#####EE8######L..X...c..X.#
#K....p....H.#####EEE######.K...B.....K#
########################################`,
  marks: {
    3: { type: 'switch', id: 'vent_switch', group: 'purge', model: 'breaker', wallFacing: true, title: 'Ventilation purge', repeatable: true },
    5: { type: 'socket', id: 'sequencer', group: 'specimens', accepts: 'specimen', model: 'sequencer', solid: 1.3, wallFacing: true, title: 'Genome sequencer', emptyMsg: 'GENOME SEQUENCER — insert 3 specimen samples to authenticate.' },
    8: { type: 'elevator', id: 'elevator', cell: 'elevator', key: 'key_b5', next: 'b5', wallFacing: true },
    9: { type: 'door', id: 'elevator_door', elevatorDoor: true, lock: 'script' },
    k: { type: 'item', id: 'key_b5', kind: 'keycard', key: 'key_b5', name: 'B5 Keycard — Executive Level', hidden: true, base: 'desk', solid: 0.78 },
    x: { type: 'item', id: 'spec_1', kind: 'specimen', name: 'Specimen jar (West lab)', base: 'pedestal', solid: 1.0 },
    y: { type: 'item', id: 'spec_2', kind: 'specimen', name: 'Specimen jar (North lab)', base: 'pedestal', solid: 1.0 },
    z: { type: 'item', id: 'spec_3', kind: 'specimen', name: 'Specimen jar (East lab)', base: 'pedestal', solid: 1.0 },
    q: { type: 'ceoSpawn' },
    a: { type: 'note', id: 'b4_note_a', title: 'Biohazard notice',
      text: 'WARNING: Containment breach in all three specimen labs.\nAtmosphere is TOXIC. Do not enter without purging.\n\nVentilation purge (control room) clears the air for about 30 seconds before the tanks vent again.' },
    b: { type: 'note', id: 'b4_note_b', title: 'Specimen tag',
      text: 'SAMPLE LINE "T" — Generation 41\nHost compatibility: any adult employee.\nNotes: Gen 1 was implanted into C. Thatch at his request (terminal illness, 1987).\nGen 1 has since requested that all further generations be destroyed. "There can only be one of me."' },
    d: { type: 'note', id: 'b4_note_d', title: 'Sequencer manual (page 3)',
      text: 'The genome sequencer requires three reference samples to authenticate an Executive keycard.\nThe B5 card will be printed at the station to the left of the sequencer.\n\nNever bring a live sample to the Executive Level.' },
  },
  groups: {
    purge: { kind: 'timedFlag', flag: 'vent', time: 30, cooldown: 6,
      do: [{ sound: 'purge' }, { msg: 'Ventilation purge running — the gas is clearing for 30 seconds!', dur: 4 }, { noise: 14 }],
      endDo: [{ msg: 'The purge stops. Gas is seeping back into the labs.', dur: 4 }] },
    specimens: { kind: 'socket', need: 3, onProgress: 'Specimen loaded: {n}/3',
      do: [{ show: 'key_b5' }, { sound: 'powerup' }, { msg: 'SEQUENCE AUTHENTICATED. A keycard slides out onto the desk.' }, { flag: 'sequenced' }, { noise: 20 }] },
  },
  hazards: [
    { type: 'gas', rect: [1, 1, 12, 8], offFlag: 'vent', dps: 14 },
    { type: 'gas', rect: [14, 1, 25, 6], offFlag: 'vent', dps: 14 },
    { type: 'gas', rect: [27, 1, 38, 8], offFlag: 'vent', dps: 14 },
  ],
  objectives: [
    { text: 'Run the ventilation purge in the control room', flag: 'ventUsed', targets: ['vent_switch'] },
    { text: 'Collect 3 specimen jars from the gas-filled labs', flag: 'sequenced', targets: ['spec_1', 'spec_2', 'spec_3'], then: ['sequencer'] },
    { text: 'Load the specimens into the genome sequencer', flag: 'sequenced', targets: [] },
    { text: 'Take the B5 keycard', flag: 'got_key_b5', after: 'sequenced', targets: ['key_b5'] },
    { text: 'Return to the elevator', flag: 'never', after: 'got_key_b5', targets: ['elevator'] },
  ],
  rules: [],
  zones: [
    { id: 'z_labA', rect: [1, 1, 12, 8], once: true, do: [{ say: { who: 'you', text: "The thing in that tank just turned its head." } }, { ceo: 'hunt' }] },
    { id: 'z_labB', rect: [14, 1, 25, 6], once: true, do: [{ say: { who: 'you', text: "These aren't experiments. They're people. Every tank is a person." } }, { blackout: 2 }] },
    { id: 'z_labC', rect: [27, 1, 38, 8], once: true, do: [{ blackout: 3 }, { say: { who: 'thatch', text: "Careful with those samples. They're family.", dur: 4 } }, { ceo: 'hunt' }] },
    { id: 'z_after_seq', rect: [14, 8, 25, 12], requires: 'sequenced', once: true, do: [{ lights: 'alarm' }, { sound: 'alarm' }, { say: { who: 'you', text: "That alarm is going to bring him right to us!" } }, { ceo: 'hunt' }] },
  ],
  ceo: {
    active: true,
    walk: 2.05, run: 4.85, search: 2.6,
    vision: 19, darkVision: 8, fov: 115,
    hearing: 1.4, searchTime: 22, chaseLose: 7,
    hideCheck: 0.25, huntInterval: 32,
  },
};
