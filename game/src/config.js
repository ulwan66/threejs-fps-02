// BREACHLINE — tuning: every number the sim reads lives here, so a balance
// pass touches one file. Angles are radians, distances metres, time seconds.

export const SIM_DT = 1 / 60;
export const GRAVITY = 14.5;
export const JUMP_SPEED = 5.6;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.16;
export const BODY_RADIUS = 0.35;
export const BODY_HEIGHT = 1.78;
export const BODY_HEIGHT_CROUCH = 1.28;
export const WALK_SPEED = 4.3;
export const CROUCH_SPEED = 2.15;
export const GROUND_ACCEL = 42;
export const GROUND_FRICTION = 11;
export const AIR_ACCEL = 8;

export const ROUND_TIME = 100; // seconds before defenders win on the clock
export const FREEZE_TIME = 3; // spawn freeze: buy, plan, then the round goes live
export const BUY_TIME = 15; // buy menu stays open this long after the round starts
export const BOMB_TIME = 35; // fuse once the charge is planted
export const PLANT_TIME = 3; // channel to plant
export const DEFUSE_TIME = 5; // channel to defuse
export const ROUNDS_TO_WIN = 7;
export const MAX_ROUNDS = 13;
export const START_MONEY = 800;
export const MAX_MONEY = 9000;
export const KILL_REWARD = 300;
export const WIN_REWARD = 1400;
export const LOSS_REWARD = 1000;
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;
export const ARMOR_PRICE = 650;
export const ARMOR_VALUE = 50; // absorbs half of each hit until spent

// Palette: dusk foundry — warm sodium lamps against cold slate.
export const PALETTE = {
  sky: 0x141a2e,
  fog: 0x1a2138,
  floor: 0x4a4d55,
  wall: 0x6d6f78,
  wallDark: 0x4c4e56,
  metal: 0x7a5c42,
  rust: 0x8a5a3b,
  crate: 0x9a7b52,
  crateDark: 0x6f5a3e,
  hazard: 0xd9a441,
  lamp: 0xffb347,
  vanguard: 0xe08a2e, // attackers: amber
  sentinel: 0x3fa7c4, // defenders: teal
  accent: 0xffd27a,
  charge: 0xff5a3c,
};

// One weapon per slot class. spread is in radians: base still-standing cone,
// bloom added per shot (decays), move penalty while moving, max cap.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 SIDEARM', slot: 'side', price: 0, damage: 26, headMult: 3.0,
    rpm: 352, mag: 12, reserve: 48, reload: 1.9, auto: false, pellets: 1,
    spread: { base: 0.006, bloom: 0.011, move: 0.030, crouch: 0.55, max: 0.075 },
    recoil: { pitch: 0.011, yaw: 0.004 }, falloff: { near: 14, far: 32, mult: 0.6 },
    range: 60, noise: 22, tracer: 0xffd27a, kick: 0.012,
  },
  k7: {
    id: 'k7', name: 'K7 RAPTOR', slot: 'main', price: 900, damage: 22, headMult: 2.5,
    rpm: 750, mag: 30, reserve: 90, reload: 2.2, auto: true, pellets: 1,
    spread: { base: 0.014, bloom: 0.009, move: 0.034, crouch: 0.6, max: 0.11 },
    recoil: { pitch: 0.008, yaw: 0.005 }, falloff: { near: 12, far: 28, mult: 0.55 },
    range: 55, noise: 26, tracer: 0xffd27a, kick: 0.009,
  },
  ar4: {
    id: 'ar4', name: 'AR-4 LONGARM', slot: 'main', price: 2200, damage: 30, headMult: 3.5,
    rpm: 600, mag: 30, reserve: 90, reload: 2.5, auto: true, pellets: 1,
    spread: { base: 0.008, bloom: 0.008, move: 0.038, crouch: 0.55, max: 0.09 },
    recoil: { pitch: 0.010, yaw: 0.004 }, falloff: { near: 16, far: 38, mult: 0.65 },
    range: 70, noise: 30, tracer: 0xffe9b0, kick: 0.011,
  },
  m870: {
    id: 'm870', name: 'M870 BREACHER', slot: 'main', price: 1400, damage: 9, headMult: 2.0,
    rpm: 70, mag: 6, reserve: 24, reload: 2.9, auto: false, pellets: 8,
    spread: { base: 0.055, bloom: 0.02, move: 0.05, crouch: 0.7, max: 0.16 },
    recoil: { pitch: 0.03, yaw: 0.012 }, falloff: { near: 8, far: 20, mult: 0.4 },
    range: 30, noise: 30, tracer: 0xffc98a, kick: 0.035,
  },
  dmr9: {
    id: 'dmr9', name: 'DMR-9 HALBERD', slot: 'main', price: 3200, damage: 70, headMult: 4.0,
    rpm: 48, mag: 10, reserve: 30, reload: 3.1, auto: false, pellets: 1, zoomFov: 34,
    spread: { base: 0.002, bloom: 0.05, move: 0.09, crouch: 0.5, max: 0.14 },
    recoil: { pitch: 0.035, yaw: 0.008 }, falloff: { near: 30, far: 60, mult: 0.85 },
    range: 90, noise: 34, tracer: 0xbfe8ff, kick: 0.03,
  },
};

export const WEAPON_ORDER = ['p9', 'k7', 'ar4', 'm870', 'dmr9'];

export const GRENADES = {
  frag: { id: 'frag', name: 'FRAG', price: 400, fuse: 2.1, radius: 6.5, damage: 105, noise: 45 },
  flash: { id: 'flash', name: 'FLASH', price: 250, fuse: 1.5, radius: 22, blind: 2.6, noise: 40 },
  smoke: { id: 'smoke', name: 'SMOKE', price: 300, fuse: 1.1, radius: 5.5, life: 14, noise: 12 },
};
export const GRENADE_ORDER = ['frag', 'flash', 'smoke'];
export const MAX_GRENADES = 3;

// Bots: one skill draw per bot, 0..1, scales reaction, aim error, aggression.
export const BOT = {
  thinkHz: 10,
  visionRange: 46,
  visionFov: 1.45, // half-angle the bot can notice a target in (~83 deg)
  hearGun: 30,
  hearStep: 7,
  hearStepCrouch: 2.5,
  reaction: { min: 0.24, max: 0.52 },
  aimError: { min: 0.008, max: 0.032 }, // radians of aim wander, best to worst
  burst: { min: 3, max: 5 },
  burstPause: { min: 0.28, max: 0.6 },
  holdScan: 2.4, // seconds between angle sweeps while holding
};

export const PLAYER_NAMES = ['YOU', 'Rook', 'Ivy', 'Bram', 'Kessler'];
export const ENEMY_NAMES = ['Vex', 'Hollow', 'Sable', 'Mire', 'Quill'];
