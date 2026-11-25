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
};
