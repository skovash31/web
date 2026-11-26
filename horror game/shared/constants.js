// Values shared by the server and the browser client.
export const TILE = 2;            // metres per map tile
export const WALL_H = 3;          // wall / ceiling height
export const VENT_CEIL = 1.15;    // ceiling height inside crawl vents
export const MAX_PLAYERS = 4;
export const TICK_RATE = 20;      // server simulation + snapshot rate (Hz)
export const SEND_RATE = 20;      // client state upload rate (Hz)

export const PLAYER = {
  radius: 0.3,
  standHeight: 1.7,
  crouchHeight: 1.05,
  eyeStand: 1.6,
  eyeCrouch: 0.95,
  walkSpeed: 2.7,
  sprintSpeed: 5.1,
  crouchSpeed: 1.4,
  jumpSpeed: 4.6,
  gravity: 13,
  stepHeight: 0.36,
  maxStamina: 100,
  sprintDrain: 20,     // per second
  staminaRegen: 14,    // per second
  exhaustedUntil: 30,  // stamina needed before sprinting again after hitting 0
  maxHealth: 100,
  maxBattery: 100,
  batteryDrain: 0.9,   // per second with flashlight on
  interactRange: 2.6,
  inventorySize: 8,
};

// Noise radii (metres) emitted by player actions. The CEO hears these.
export const NOISE = {
  crouch: 1.5,
  walk: 6,
  sprint: 14,
  land: 8,
  flashlight: 3,
  door: 9,
  pickup: 4,
  fail: 26,
  scream: 30,
};

export const PLAYER_COLORS = [0x4fa3ff, 0xffb347, 0x7ee081, 0xe47cff];

export const ITEM_INFO = {
  keycard: { label: 'Keycard', icon: 'card' },
  battery: { label: 'Battery', icon: 'battery' },
  medkit: { label: 'First-aid kit', icon: 'med' },
  file: { label: 'Misplaced folder', icon: 'file' },
  report: { label: 'Quarterly report', icon: 'file' },
  fuse: { label: 'Fuse', icon: 'fuse' },
  specimen: { label: 'Specimen jar', icon: 'jar' },
  tape: { label: 'Access tape', icon: 'tape' },
  stapler: { label: 'Stapler', icon: 'stapler' },
  flashlight: { label: 'Flashlight', icon: 'flashlight' },
  coffee: { label: 'Cup of coffee', icon: 'coffee' },
  nothing: { label: 'Nothing Button', icon: 'nothing' },
  staples: { label: 'Box of staples', icon: 'staples' },
};

// Office coffee: a speed boost that doesn't cost stamina.
export const COFFEE = { duration: 20, speed: 1.35 };
// First-aid kit: patches you up and gets your breath back.
export const MEDKIT = { heal: 60 };

// The heavy-duty office stapler: fires staples that stun Mr. Thatch.
export const STAPLER = {
  magazine: 20,      // staples the stapler holds
  perBox: 20,        // staples in one box
  reloadTime: 5,     // seconds
  fireInterval: 0.4, // seconds between shots
  range: 16,         // metres
  stun: 10,          // seconds a hit stuns him
  noise: 5,          // a sharp CLACK he can hear
};

// Lobby difficulty (host picks it). Multipliers are applied to each floor's CEO config.
//   speed:   walk / run / search speed      doors: may open closed doors himself
//   vents:   crawls through vents (vents stop being safe and he can see along them)
export const DIFFICULTIES = {
  easy:   { label: 'Easy',   desc: 'He moves at half speed and cannot open doors.', speed: 0.5, doors: false, vents: false, detect: 1, hearing: 1, hideCheck: 0, searchTime: 1, hunt: 1, doorTime: 1 },
  normal: { label: 'Normal', desc: 'The intended experience.', speed: 1, doors: true, vents: false, detect: 1, hearing: 1, hideCheck: 0, searchTime: 1, hunt: 1, doorTime: 1 },
  medium: { label: 'Medium', desc: 'Faster, sharper senses, checks more lockers and hunts more often.', speed: 1.2, doors: true, vents: false, detect: 1.25, hearing: 1.25, hideCheck: 0.12, searchTime: 1.3, hunt: 0.75, doorTime: 0.7 },
  hard:   { label: 'Hard',   desc: '1.5x speed, sharp senses, and he crawls through the vents after you.', speed: 1.5, doors: true, vents: true, detect: 1.3, hearing: 1.3, hideCheck: 0.15, searchTime: 1.4, hunt: 0.6, doorTime: 0.6 },
};
export const DEFAULT_DIFFICULTY = 'normal';
