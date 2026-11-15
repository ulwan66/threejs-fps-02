// BREACHLINE — the one state object. Every sim module reads and writes this
// and nothing else holds game state; rendering, HUD and audio only read it
// (plus the event queue, which they drain). Fighters are plain data: no
// three.js object ever lives here, so the fixed-step sim is render-free.

import {
  ARMOR_VALUE, BODY_HEIGHT, BODY_RADIUS, GRENADES, MAX_ROUNDS, ROUND_TIME,
  START_MONEY, WEAPONS, ENEMY_NAMES, PLAYER_NAMES,
} from './config.js';
import { makeRng, randRange, v3 } from './utils.js';
import { SPAWNS } from './map.js';

export function createFighter(id, team, name, isPlayer) {
  const f = {
    id, team, name, isPlayer,
    pos: v3(), vel: v3(), yaw: 0, pitch: 0,
    hp: 100, armor: 0, alive: true,
    crouch: false, onGround: true,
    weapons: { main: null, side: 'p9' },
    current: 'side',
    ammo: {},
    grenades: { frag: 0, flash: 0, smoke: 0 },
    money: START_MONEY,
    fireCooldown: 0, reloading: false, reloadUntil: 0,
    bloom: 0, recoilPitch: 0, recoilYaw: 0,
    flashUntil: 0, flashPeak: 0,
    channel: null, // { kind: 'plant' | 'defuse', site, until, total }
    hasCharge: false,
    heldGrenade: 'frag',
    zoomed: false,
    stepAcc: 0,
    bot: null,
    walkPhase: 0, speed2d: 0, moveDir: 0,
    deathTime: 0, muzzleUntil: 0, throwUntil: 0,
    kills: 0, deaths: 0, damageDealt: 0,
  };
  for (const id of Object.keys(WEAPONS)) f.ammo[id] = { mag: 0, reserve: 0 };
  f.ammo.p9 = { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve };
  return f;
}

export function createState(seed = 1337) {
  const fighters = [];
  for (let i = 0; i < 5; i++) {
    fighters.push(createFighter(i, 'vanguard', PLAYER_NAMES[i], i === 0));
  }
  for (let i = 0; i < 5; i++) {
    fighters.push(createFighter(5 + i, 'sentinel', ENEMY_NAMES[i], false));
  }
  return {
    seed,
    rng: makeRng(seed),
    time: 0,
    phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
    phaseTime: 0,
    round: 1,
    maxRounds: MAX_ROUNDS,
    score: { vanguard: 0, sentinel: 0 },
    roundTime: ROUND_TIME,
    buyUntil: 0,
    fighters,
    player: fighters[0],
    charge: {
      state: 'carried', // carried | dropped | planted | gone
      carrier: 0, site: null, fuse: 0,
      pos: v3(),
    },
    grenades: [],
    smokes: [],
    noises: [],
    tracers: [],
    impacts: [],
    sparks: [],
    killfeed: [],
    messages: [],
    events: [],
    spectate: -1,
    buyOpen: false,
    needsRoles: false,
    paused: false,
    shotMode: null,
    matchWinner: null,
    roundWinner: null,
    roundReason: '',
    muted: false,
  };
}

export function eyeHeight(f) {
  return f.crouch ? 1.16 : 1.62;
}
export function bodyHeight(f) {
  return f.crouch ? 1.28 : BODY_HEIGHT;
}
// Head sphere centre (world) and radius for hitscan.
export function headSphere(f, out) {
  out.x = f.pos.x;
  out.y = f.pos.y + (f.crouch ? 1.12 : 1.56);
  out.z = f.pos.z;
  out.r = 0.24;
  return out;
}
// Chest sphere: the main body target.
export function chestSphere(f, out) {
  out.x = f.pos.x;
  out.y = f.pos.y + (f.crouch ? 0.72 : 1.12);
  out.z = f.pos.z;
  out.r = 0.36;
  return out;
}
// Pelvis sphere: low body shots still count.
export function pelvisSphere(f, out) {
  out.x = f.pos.x;
  out.y = f.pos.y + (f.crouch ? 0.36 : 0.62);
  out.z = f.pos.z;
  out.r = 0.32;
  return out;
}

export function radiusOf() { return BODY_RADIUS; }

export function spawnFighter(state, f, indexInTeam) {
  const list = SPAWNS[f.team];
  const s = list[indexInTeam % list.length];
  f.pos.x = s.x; f.pos.y = 0; f.pos.z = s.z;
  f.vel.x = 0; f.vel.y = 0; f.vel.z = 0;
  f.yaw = f.team === 'vanguard' ? -Math.PI / 2 : Math.PI / 2;
  f.pitch = 0;
  f.hp = 100; f.alive = true;
  f.crouch = false; f.onGround = true;
  f.fireCooldown = 0; f.reloading = false;
  f.bloom = 0; f.recoilPitch = 0; f.recoilYaw = 0;
  f.flashUntil = 0; f.flashPeak = 0;
  f.channel = null;
  f.hasCharge = false;
  f.muzzleUntil = 0; f.throwUntil = 0;
  f.walkPhase = 0; f.speed2d = 0;
}

export function giveArmor(f) {
  f.armor = ARMOR_VALUE;
}

// A fresh bot brain: skill draw plus the decision state bots.js maintains.
export function makeBrain(rng, team) {
  return {
    skill: randRange(rng, 0.35, 0.9),
    team,
    mode: 'route',
    route: null,
    hold: null,
    path: [],
    pathIdx: 0,
    dest: null,
    target: -1,
    reactUntil: 0,
    lastKnown: v3(),
    lastKnownTime: -99,
    trackTime: 0,
    aimErrYaw: 0, aimErrPitch: 0, aimErrAt: 0,
    burstLeft: 0, burstPauseUntil: 0,
    thinkAt: 0,
    strafeDir: 1, strafeUntil: 0,
    investigate: null,
    scanAt: 0, scanYaw: 0,
    stuckAt: 0, lastX: 0, lastZ: 0, repaths: 0,
    grenadeAt: 0,
    bought: false,
    heardUntil: 0,
  };
}

export function pushEvent(state, ev) {
  // Ring: under heavy fire the oldest events drop so the newest (kills,
  // explosions, round changes) are never lost behind a full queue.
  if (state.events.length >= 256) state.events.shift();
  state.events.push(ev);
}
export function pushNoise(state, x, z, radius, kind, source = -1) {
  state.noises.push({ x, z, radius, kind, source, time: state.time });
  if (state.noises.length > 32) state.noises.splice(0, state.noises.length - 32);
}
export function announce(state, text, sub = '', dur = 2.6) {
  state.messages.push({ text, sub, until: state.time + dur });
  if (state.messages.length > 3) state.messages.shift();
}
export function addKillfeed(state, text, team) {
  state.killfeed.unshift({ text, team, until: state.time + 5 });
  if (state.killfeed.length > 5) state.killfeed.pop();
}
