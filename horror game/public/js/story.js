// Inner monologue, teammate lines and Mr. Thatch's voice, shown as subtitles.
// Lines are triggered by pickups, documents, discoveries, flags and danger.
const PICKUP_ID = {
  key_b1: 'A B1 keycard... so this is how Dana got downstairs.',
  key_b2: 'B2. Research and Development. Further down we go.',
  key_b3: 'Got it — wait. Did that door just open?',
  key_b4: "Biological Research. I really don't want to know what they research.",
  key_b5: 'Executive Level. This is where he lives.',
  fuse_2: "Got the fuse — now get out before that gate shuts!",
};
const PICKUP_KIND = {
  keycard: ['I wonder where this goes...', 'Another keycard. Where does this one lead?'],
  battery: ['Batteries. Thank god.', "That'll keep the light on a little longer."],
  medkit: ['A first-aid kit. I might need this.', 'Bandages. Better than nothing.'],
  file: ['One of the missing folders.', "There's another folder.", "That's a folder. How do these keep getting lost?"],
  report: ['The quarterly report. Still warm from the copier.'],
  fuse: ['A fuse. The fusebox should take this.'],
  specimen: ["It's warm. And something inside is... moving.", "Don't drop it. Don't drop it.", 'That makes three. Back to the sequencer.'],
  stapler: ['A heavy-duty stapler. This thing could actually hurt.', 'Another stapler. Good — one for everyone.'],
  staples: ['A box of staples. Twenty in a strip.', 'More staples. Keep them coming.'],
  coffee: ["Someone's coffee. Still warm... I'm not asking.", 'More coffee. Bless whoever left this.'],
  flashlight: ['My flashlight.'],
  nothing: ['A big red button labelled "NOTHING". Of course I\'m taking it.', 'Another Nothing Button. Now I can do nothing twice.'],
};
const READ = {
  memo_pruitt: "'Nominees should not be informed'... nominated for what?",
  whiteboard: "Retention Program nominees... Dana's name is on there.",
  clock_after: "Dana sent this tonight. She's somewhere down there.",
  b1_vault_note: "1987... Thatch has run this company since 1987. He hasn't aged a day.",
  b1_code_1: "A digit for the vault. It's in the journal now.",
  b1_code_2: 'Another digit. Keep looking.',
  b1_code_3: "'Turn your light off. Stay low.' Got it.",
  b1_code_4: "That's the last digit. Now the keypad.",
  b2_note_a: "'It runs us.' What is this place?",
  b2_note_b: 'Wrong sequence sets off the alarm. Better get this right.',
  b2_note_d: "The vents. He can't follow me into the vents.",
  valve_monitor: 'I need to remember this order.',
  b3_intake: "Pruitt's on the list too. Even management isn't safe.",
  b3_warden: "'He HUNTS.' Great. Just great.",
  b3_dana: "Dana... I'm sorry. I'll finish it. I promise.",
  b4_note_a: 'Thirty seconds of clean air. I have to be fast.',
  b4_note_b: "Generation 41... there's more than one of him.",
  b4_note_d: 'Three samples, then the card.',
  b5_journal: "'There is always another employee.' Not anymore.",
  b5_board: "They're still sitting there. All of them.",
  b5_furnace: "Get him inside and burn it. Okay. Okay... I can do this.",
};
const FLAG = {
  clockedIn: 'Clocked in. Another Tuesday.',
  endOfDay: 'Wait... where did everyone go? It was just busy in here.',
  filed: "That's the last folder. Records can stop emailing me now.",
  power: "Power's back. Now I can see... and so can whatever's down here.",
  vaultOpen: 'It worked!',
  protoOpen: 'The lab is open.',
  wardenOpen: "The Warden's office is open!",
  sequenced: "It's printing a card!",
  gensOnline: "That's all three. He definitely heard that.",
  trapArmed: 'Armed. Now he just has to follow me in... and I have to get out.',
};
const ARRIVAL = {
  office: [['you', 'Tuesday. Clock in, file some paperwork, go home. Easy.']],
  b1: [['you', "It's pitch black. I need to find the power."], ['you', "And whatever that thing was... I hope it didn't follow us down."]],
  b2: [['thatch', 'Welcome to Research and Development. Please, touch nothing. I will be with you shortly.']],
  b3: [['thatch', "Containment. You'll be seeing some familiar faces down here."]],
  b4: [['thatch', 'This is where we grow. I think you will find it... inspiring.']],
  b5: [['thatch', "You came all this way to see me. I'm flattered."], ['you', 'Dana said there was a furnace. This ends here.']],
};
const SIGHTING = {
  b1: 'What... what IS that?!',
  b2: "It's him. That's Thatch.",
  b3: "He's faster down here. Don't let him see you.",
  b4: "He's bigger than before... how is he bigger?",
  b5: "There he is. Come on, then. Follow me.",
};
const CHASE = ['Run. RUN!', "He's seen me!", 'Go, go, go!', "Don't look back. Just run!"];
const LOST = ['...I think I lost him.', 'Is he gone? I think he\'s gone.'];
const HIDE = ["Stay quiet... don't breathe...", 'Shh. Shh. Shh.', 'Please walk past. Please walk past.'];
const HIDE_NEAR = ["He's right outside...", "Please don't open it. Please don't open it."];
const DISCOVER = {
  tank: "There's something floating in that tank...",
  body: 'Is that... a person?',
  hide: 'I could hide in there if I have to.',
  vent: 'A vent. If I crouch I could crawl through.',
  crate: 'I could climb over that.',
  blood: "That's... a lot of blood.",
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Story {
  constructor(el) {
    this.el = el;
    this.queue = [];
    this.current = null;
    this.cool = new Map();
    this.said = new Set();
    this.kindCount = {};
    this.discoveredFloor = new Set();
  }

  reset() { this.queue.length = 0; this.discoveredFloor.clear(); (this.timers || []).forEach(clearTimeout); this.timers = []; this.current = null; this.el.classList.remove('show'); }

  // who: 'you' | 'thatch' | a teammate's name; priority lines jump the queue
  say(who, text, { dur, priority = false, key, cooldown = 0 } = {}) {
    if (!text) return;
    const now = performance.now();
    if (key) {
      if (cooldown <= 0 && this.said.has(key)) return;
      if (cooldown > 0 && now < (this.cool.get(key) || 0)) return;
      this.said.add(key);
      if (cooldown > 0) this.cool.set(key, now + cooldown * 1000);
    }
    const line = { who, text, dur: dur || Math.max(2.4, Math.min(7, text.split(' ').length * 0.32 + 1)), at: now };
    if (priority) this.queue.unshift(line); else this.queue.push(line);
    if (this.queue.length > 4) this.queue.splice(1, this.queue.length - 4);
  }

  update() {
    const now = performance.now();
    if (this.current && now > this.current.end) { this.current = null; this.el.classList.remove('show'); }
    if (!this.current && this.queue.length) {
      let line;
      do { line = this.queue.shift(); } while (line && now - line.at > 9000 && this.queue.length);
      if (!line) return;
      this.current = { ...line, end: now + line.dur * 1000 };
      const name = line.who === 'you' ? 'You' : line.who === 'thatch' ? 'Mr. Thatch' : line.who;
      this.el.className = 'show ' + (line.who === 'you' ? 'you' : line.who === 'thatch' ? 'thatch' : 'mate');
      this.el.innerHTML = `<b>${escape(name)}</b> ${escape(line.text)}`;
    }
  }

  // ----- triggers
  pickup(item) {
    if (PICKUP_ID[item.id]) return this.say('you', PICKUP_ID[item.id], { key: 'pick_' + item.id });
    const lines = PICKUP_KIND[item.kind];
    if (!lines) return;
    const n = (this.kindCount[item.kind] = (this.kindCount[item.kind] || 0) + 1);
    if (item.kind === 'battery' || item.kind === 'medkit') return this.say('you', pick(lines), { key: 'kind_' + item.kind, cooldown: 25 });
    this.say('you', lines[Math.min(n - 1, lines.length - 1)]);
  }
  read(id) { if (READ[id]) setTimeout(() => this.say('you', READ[id], { key: 'read_' + id }), 600); }
  flag(name) { if (FLAG[name]) this.say('you', FLAG[name], { key: 'flag_' + name }); }
  arrival(levelId) {
    this.timers = this.timers || [];
    (ARRIVAL[levelId] || []).forEach(([who, text], i) => this.timers.push(setTimeout(() => this.say(who, text, { key: `arr_${levelId}_${i}` }), 3500 + i * 4200)));
  }
  sighting(levelId) { if (SIGHTING[levelId]) this.say('you', SIGHTING[levelId], { key: 'see_' + levelId, priority: true }); }
  chase() { this.say('you', pick(CHASE), { key: 'chase', cooldown: 18, priority: true }); }
  lost() { this.say('you', pick(LOST), { key: 'lost', cooldown: 30 }); }
  hide() { this.say('you', pick(HIDE), { key: 'hide', cooldown: 35 }); }
  hideNear() { this.say('you', pick(HIDE_NEAR), { key: 'hidenear', cooldown: 20, priority: true }); }
  discover(kind, levelId) {
    if (!DISCOVER[kind]) return;
    const perFloor = kind === 'tank' || kind === 'body' || kind === 'blood';
    const k = perFloor ? `disc_${kind}_${levelId}` : `disc_${kind}`;
    if (this.discoveredFloor.has(k) || this.said.has(k)) return;
    this.discoveredFloor.add(k);
    this.say('you', DISCOVER[kind], { key: k });
  }
  lowBattery() { this.say('you', "Come on, don't die on me now...", { key: 'lowbat', cooldown: 60 }); }
  noBattery() { this.say('you', "It's dead. I need batteries.", { key: 'nobat', cooldown: 40 }); }
  batteryIn() { this.say('you', pick(['Fresh batteries. Much better.', "There. Light's back."]), { key: 'batin', cooldown: 10 }); }
  gas() { this.say('you', pick(["I can't breathe in here!", 'The air — it burns!']), { key: 'gas', cooldown: 20, priority: true }); }
  teammateDown(name) { this.say('you', `No — ${name}!`, { priority: true }); }
  exhausted() { this.say('you', "I can't... catch my breath...", { key: 'tired', cooldown: 45 }); }
}

function escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
