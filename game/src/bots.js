// BREACHLINE — bot AI: one brain per bot, shared by both teams. Decisions
// run at 10 Hz (think), steering every sim step. Bots see through a vision
// cone gated by line of sight and a reaction delay, hear gunshots and steps
// through the noise queue, follow waypoint routes, hold angles, rotate on
// sound, plant, retake and defuse. Skill (0..1) scales reaction, aim error
// and aggression, so a round has both sharp and shaky opponents.

import {
  BODY_RADIUS, BOT, DEFUSE_TIME, GRAVITY, GROUND_ACCEL, GROUND_FRICTION,
  PLANT_TIME, WALK_SPEED, CROUCH_SPEED, WEAPONS,
} from './config.js';
import { moveBody, lineOfSight } from './collision.js';
import {
  HOLD_SPOTS, ROUTES, SITES, WAYPOINTS, findPath, nearestWaypoint, siteAt,
} from './map.js';
import { SOLIDS } from './map.js';
import { bodyHeight, eyeHeight, pushNoise } from './state.js';
import { eyePos, fireWeapon, startReload, throwGrenade } from './combat.js';
import { completeDefuse, completePlant } from './rounds.js';
import { currentAmmo, currentWeapon, giveWeapon, refillAmmo } from './weapons.js';
import {
  angleDiff, clamp, dirFromAngles, gauss, lerp, pick, randRange, turnToward, v3,
} from './utils.js';

const _move = { onGround: false, hitWall: false };
const _eye = v3(), _target = v3(), _fwd = v3(), _to = v3();

// Role assignment at round start: defenders take hold spots (2 A, 2 B,
// 1 mid), attackers draw a route weighted toward the sites.
export function assignBotRoles(state) {
  const rng = state.rng;
  const defenders = state.fighters.filter((f) => f.team === 'sentinel' && !f.isPlayer);
  const holds = [...HOLD_SPOTS.A, ...HOLD_SPOTS.B, ...HOLD_SPOTS.MID];
  defenders.forEach((f, i) => {
    const b = f.bot;
    b.hold = holds[i % holds.length];
    b.mode = 'route';
    b.path = pathTo(state, f, b.hold.x, b.hold.z);
    b.pathIdx = 0;
    b.dest = { x: b.hold.x, z: b.hold.z };
    b.target = -1;
    b.investigate = null;
  });
  const attackers = state.fighters.filter((f) => f.team === 'vanguard' && !f.isPlayer);
  attackers.forEach((f) => {
    const b = f.bot;
    const roll = rng();
    b.route = roll < 0.35 ? 'A' : roll < 0.7 ? 'B' : roll < 0.85 ? 'A_MID' : 'B_MID';
    b.path = ROUTES[b.route].map((i) => ({ x: WAYPOINTS[i][0], z: WAYPOINTS[i][1] }));
    b.pathIdx = 0;
    b.dest = b.path[b.path.length - 1];
    b.mode = 'route';
    b.target = -1;
    b.investigate = null;
  });
}

function pathTo(state, f, x, z) {
  const idx = findPath(f.pos.x, f.pos.z, x, z);
  const pts = idx.map((i) => ({ x: WAYPOINTS[i][0], z: WAYPOINTS[i][1] }));
  pts.push({ x, z });
  return pts;
}

export function botBuy(state, f) {
  const b = f.bot;
  if (b.bought) return;
  b.bought = true;
  refillAmmo(f);
  if (!f.weapons.main) {
    if (f.money >= 2200) { giveWeapon(f, 'ar4'); f.money -= 2200; }
    else if (f.money >= 1400) { giveWeapon(f, 'm870'); f.money -= 1400; }
    else if (f.money >= 900) { giveWeapon(f, 'k7'); f.money -= 900; }
  }
  if (f.money >= 650 && f.armor <= 0) { f.armor = 50; f.money -= 650; }
  if (f.money >= 400 && f.grenades.frag < 1) { f.grenades.frag += 1; f.money -= 400; }
  if (f.money >= 250 && f.grenades.flash < 1) { f.grenades.flash += 1; f.money -= 250; }
  if (f.weapons.main) f.current = 'main';
}

function canSee(state, f, enemy) {
  if (state.time < f.flashUntil) return false;
  eyePos(f, _eye);
  _target.x = enemy.pos.x; _target.y = enemy.pos.y + eyeHeight(enemy) * 0.8; _target.z = enemy.pos.z;
  _to.x = _target.x - _eye.x; _to.y = _target.y - _eye.y; _to.z = _target.z - _eye.z;
  const dist = Math.hypot(_to.x, _to.y, _to.z);
  let range = BOT.visionRange;
  if (enemy.crouch && enemy.speed2d < 0.5) range *= 0.7;
  if (dist > range) return false;
  dirFromAngles(_fwd, f.yaw, 0);
  const dot = (_fwd.x * _to.x + _fwd.z * _to.z) / (dist || 1);
  if (dot < Math.cos(BOT.visionFov) && dist > 3) return false;
  return lineOfSight(_eye.x, _eye.y, _eye.z, _target.x, _target.y, _target.z, SOLIDS, state.smokes);
}

function think(state, f) {
  const b = f.bot;
  const now = state.time;
  const rng = state.rng;

  // --- Perception: nearest visible enemy becomes the target.
  let seen = null, seenDist = Infinity;
  for (const e of state.fighters) {
    if (!e.alive || e.team === f.team) continue;
    if (!canSee(state, f, e)) continue;
    const d = Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z);
    if (d < seenDist) { seenDist = d; seen = e; }
  }
  if (seen) {
    if (b.target !== seen.id) {
      b.target = seen.id;
      const react = lerp(BOT.reaction.max, BOT.reaction.min, b.skill) * (1 + seenDist / 70);
      b.reactUntil = now + react + (seen.crouch ? 0.08 : 0);
      b.trackTime = 0;
      b.burstLeft = 0;
    }
    b.lastKnown.x = seen.pos.x; b.lastKnown.y = seen.pos.y; b.lastKnown.z = seen.pos.z;
    b.lastKnownTime = now;
    b.investigate = null;
  } else if (b.target !== -1 && now - b.lastKnownTime > 1.4) {
    // Lost sight: go look where the target was last seen.
    b.investigate = { x: b.lastKnown.x, z: b.lastKnown.z, until: now + 6 };
    b.target = -1;
  }

  // --- Hearing: unheard noises inside their radius pull attention.
  // Teammates' noise is ignored — bots know their own team's fire and
  // steps, so only the enemy's sounds divert them.
  for (const n of state.noises) {
    if (n.time <= b.heardUntil) continue;
    if (n.source >= 0 && state.fighters[n.source].team === f.team) continue;
    const d2 = (n.x - f.pos.x) ** 2 + (n.z - f.pos.z) ** 2;
    if (d2 < n.radius * n.radius && b.target === -1) {
      b.investigate = { x: n.x, z: n.z, until: now + 4 };
      // Defenders rotate toward a loud noise at the other site.
      if (f.team === 'sentinel' && n.kind !== 'step') {
        const site = siteAt(n.x, n.z);
        if (site && b.hold) {
          const holdSite = b.hold.z < 0 ? 'A' : b.hold.z > 0 ? 'B' : 'MID';
          if (site !== holdSite && rng() < 0.5) {
            b.hold = null;
            b.mode = 'retake';
            b.path = pathTo(state, f, n.x, n.z);
            b.pathIdx = 0;
            b.dest = { x: n.x, z: n.z };
          }
        }
      }
    }
  }
  b.heardUntil = now;

  // --- Mode selection.
  const charge = state.charge;
  if (charge.state === 'planted') {
    if (f.team === 'sentinel') {
      if (b.mode !== 'retake' && b.mode !== 'defuse') {
        b.mode = 'retake';
        const s = SITES[charge.site];
        b.path = pathTo(state, f, s.cx, s.cz);
        b.pathIdx = 0;
        b.dest = { x: s.cx, z: s.cz };
      }
    } else if (b.mode !== 'combat') {
      // Attackers defend the planted charge from nearby cover.
      if (b.mode !== 'hold') {
        b.mode = 'hold';
        const s = SITES[charge.site];
        const spot = { x: s.cx + randRange(rng, -5, 5), z: s.cz + randRange(rng, -4, 4), yaw: rng() * Math.PI * 2 };
        b.hold = spot;
        b.path = pathTo(state, f, spot.x, spot.z);
        b.pathIdx = 0;
        b.dest = { x: spot.x, z: spot.z };
      }
    }
  } else if (f.hasCharge && b.mode !== 'plant') {
    b.mode = 'plant';
    const site = nearestSite(f);
    const s = SITES[site];
    b.path = pathTo(state, f, s.cx, s.cz);
    b.pathIdx = 0;
    b.dest = { x: s.cx, z: s.cz };
  } else if (charge.state === 'dropped' && f.team === 'vanguard' && b.target === -1) {
    // Nearest living attacker fetches the dropped charge.
    const fetchers = state.fighters.filter((o) => o.alive && o.team === 'vanguard' && !o.isPlayer);
    let nearest = null, nd = Infinity;
    for (const o of fetchers) {
      const d = (o.pos.x - charge.pos.x) ** 2 + (o.pos.z - charge.pos.z) ** 2;
      if (d < nd) { nd = d; nearest = o; }
    }
    if (nearest === f && b.mode !== 'fetch') {
      b.mode = 'fetch';
      b.path = pathTo(state, f, charge.pos.x, charge.pos.z);
      b.pathIdx = 0;
      b.dest = { x: charge.pos.x, z: charge.pos.z };
    }
  } else if (b.target !== -1) {
    b.mode = 'combat';
  } else if (b.investigate && now < b.investigate.until && b.mode !== 'seek') {
    b.mode = 'seek';
    b.path = pathTo(state, f, b.investigate.x, b.investigate.z);
    b.pathIdx = 0;
    b.dest = { x: b.investigate.x, z: b.investigate.z };
  } else if (b.mode === 'seek' && (!b.investigate || now >= b.investigate.until)) {
    b.mode = 'route';
    if (f.team === 'sentinel' && b.hold) {
      b.path = pathTo(state, f, b.hold.x, b.hold.z);
      b.pathIdx = 0;
      b.dest = { x: b.hold.x, z: b.hold.z };
    }
  }

  // --- Grenades: lob a frag at a remembered position when the target
  // is hiding behind cover, sparingly.
  if (b.target === -1 && now - b.lastKnownTime < 2.5 && now > b.grenadeAt &&
      f.grenades.frag > 0 && b.mode !== 'plant' && b.mode !== 'defuse') {
    const d = Math.hypot(b.lastKnown.x - f.pos.x, b.lastKnown.z - f.pos.z);
    if (d > 10 && d < 26 && rng() < 0.4) {
      const dx = b.lastKnown.x - f.pos.x, dz = b.lastKnown.z - f.pos.z;
      f.yaw = Math.atan2(-dx, -dz);
      f.pitch = 0.5;
      throwGrenade(state, f, 'frag');
      b.grenadeAt = now + 14;
    }
  }

  // Reload when safe: no visible target and the mag is low.
  const w = currentWeapon(f);
  const ammo = currentAmmo(f);
  if (b.target === -1 && ammo.mag <= w.mag * 0.35 && ammo.reserve > 0 && !f.reloading) {
    startReload(state, f);
  }
}

function nearestSite(f) {
  const da = (f.pos.x - SITES.A.cx) ** 2 + (f.pos.z - SITES.A.cz) ** 2;
  const db = (f.pos.x - SITES.B.cx) ** 2 + (f.pos.z - SITES.B.cz) ** 2;
  return da < db ? 'A' : 'B';
}

function updateAim(state, f, dt) {
  const b = f.bot;
  const now = state.time;
  let wantYaw = f.yaw, wantPitch = 0;
  if (b.target !== -1) {
    const t = state.fighters[b.target];
    if (t && t.alive) {
      b.trackTime += dt;
      if (now >= b.aimErrAt) {
        b.aimErrAt = now + 0.14;
        const err = lerp(BOT.aimError.max, BOT.aimError.min, b.skill) *
          (1 + t.speed2d * 0.12) * (f.speed2d > 1 ? 1.7 : 1) *
          Math.max(0.45, 1 - b.trackTime * 0.12);
        b.aimErrYaw = gauss(state.rng) * err;
        b.aimErrPitch = gauss(state.rng) * err * 0.7;
      }
      eyePos(f, _eye);
      _to.x = t.pos.x - _eye.x;
      _to.y = t.pos.y + eyeHeight(t) * 0.75 - _eye.y;
      _to.z = t.pos.z - _eye.z;
      wantYaw = Math.atan2(-_to.x, -_to.z) + b.aimErrYaw;
      wantPitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z)) + b.aimErrPitch;
    }
  } else if (b.mode === 'hold' && b.hold && arrived(f, b.dest)) {
    // Hold the assigned angle, sweeping it slowly.
    if (now >= b.scanAt) {
      b.scanAt = now + BOT.holdScan;
      b.scanYaw = b.hold.yaw + randRange(state.rng, -0.5, 0.5);
    }
    wantYaw = b.scanYaw;
  } else if (b.dest) {
    // Look where the bot is walking, with a glance at the investigate point.
    const dx = b.dest.x - f.pos.x, dz = b.dest.z - f.pos.z;
    if (Math.hypot(dx, dz) > 1) wantYaw = Math.atan2(-dx, -dz);
  }
  const turnRate = lerp(2.2, 6.5, b.skill);
  f.yaw = turnToward(f.yaw, wantYaw, turnRate * dt);
  f.pitch = clamp(lerp(f.pitch, wantPitch, Math.min(1, 8 * dt)), -1.45, 1.45);
}

function arrived(f, dest) {
  if (!dest) return true;
  const dx = f.pos.x - dest.x, dz = f.pos.z - dest.z;
  return dx * dx + dz * dz < 1.4;
}

function updateMove(state, f, dt) {
  const b = f.bot;
  let wx = 0, wz = 0, wantSpeed = 0;
  const inCombat = b.target !== -1;

  if (inCombat) {
    // Strafe perpendicular to the aim, changing direction on a timer.
    if (state.time >= b.strafeUntil) {
      b.strafeUntil = state.time + randRange(state.rng, 0.7, 1.5);
      b.strafeDir = state.rng() < 0.5 ? -1 : 1;
      if (state.rng() < 0.45) b.strafeDir = 0; // plant feet and shoot
    }
    const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
    wx = cy * b.strafeDir; wz = -sy * b.strafeDir;
    wantSpeed = WALK_SPEED * 0.45;
    f.crouch = false;
  } else if (b.pathIdx < b.path.length) {
    const wp = b.path[b.pathIdx];
    const dx = wp.x - f.pos.x, dz = wp.z - f.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.3) { b.pathIdx++; }
    else { wx = dx / d; wz = dz / d; wantSpeed = WALK_SPEED * 0.95; }
    f.crouch = false;
  } else if (b.mode === 'hold') {
    // Settled on a hold: skilled bots crouch behind their cover line.
    f.crouch = b.skill > 0.55;
  }

  // Stuck detection: barely moved while trying to walk.
  const moved = Math.hypot(f.pos.x - b.lastX, f.pos.z - b.lastZ);
  if (wantSpeed > 0 && moved < 0.02) {
    b.stuckAt += dt;
    if (b.stuckAt > 1.2 && b.repaths < 3) {
      b.stuckAt = 0; b.repaths++;
      if (b.dest) { b.path = pathTo(state, f, b.dest.x, b.dest.z); b.pathIdx = 0; }
    }
  } else b.stuckAt = 0;
  b.lastX = f.pos.x; b.lastZ = f.pos.z;

  // Stuck sidestep: walking head-on into a crate corner zeroes velocity
  // without progress, so bias the wish direction sideways, alternating,
  // until the bot slides around the obstacle.
  if (b.stuckAt > 0.4 && wantSpeed > 0) {
    const s = (Math.floor(state.time * 2.2) % 2 === 0) ? 1 : -1;
    const ox = wx, oz = wz;
    wx = ox - oz * s * 0.85;
    wz = oz + ox * s * 0.85;
    const l = Math.hypot(wx, wz) || 1;
    wx /= l; wz /= l;
  }

  const maxSpeed = f.crouch ? CROUCH_SPEED : wantSpeed;
  if (f.onGround) {
    const tx = wx * maxSpeed, tz = wz * maxSpeed;
    const k = wantSpeed > 0 ? GROUND_ACCEL : GROUND_FRICTION * 2.2;
    f.vel.x += clamp(tx - f.vel.x, -k * dt, k * dt);
    f.vel.z += clamp(tz - f.vel.z, -k * dt, k * dt);
  } else {
    f.vel.y -= GRAVITY * dt;
  }
  moveBody(f.pos, f.vel, dt, BODY_RADIUS, bodyHeight(f), SOLIDS, _move);
  f.onGround = _move.onGround;
  f.speed2d = Math.hypot(f.vel.x, f.vel.z);
  f.walkPhase += f.speed2d * dt * 1.9;
  if (f.onGround && f.speed2d > 0.6) {
    f.stepAcc = (f.stepAcc || 0) + f.speed2d * dt;
    if (f.stepAcc > 2.3) {
      f.stepAcc = 0;
      pushNoise(state, f.pos.x, f.pos.z, f.crouch ? 2.5 : 7, 'step', f.id);
    }
  }
}

function updateCombat(state, f) {
  const b = f.bot;
  if (b.target === -1) return;
  const t = state.fighters[b.target];
  if (!t || !t.alive) { b.target = -1; return; }
  if (state.time < b.reactUntil) return;
  if (state.time < f.flashUntil) return;
  if (f.reloading) return;
  const w = currentWeapon(f);
  const ammo = currentAmmo(f);
  if (ammo.mag <= 0) { startReload(state, f); return; }

  // Burst discipline: short bursts, pauses, and only while the target is
  // still actually visible from the bot's eyes.
  if (!canSee(state, f, t)) return;
  const now = state.time;
  if (b.burstLeft <= 0) {
    if (now < b.burstPauseUntil) return;
    b.burstLeft = Math.round(randRange(state.rng, BOT.burst.min, BOT.burst.max));
    if (!w.auto) b.burstLeft = 1;
  }
  if (f.fireCooldown <= 0) {
    if (fireWeapon(state, f)) {
      b.burstLeft--;
      if (b.burstLeft <= 0) b.burstPauseUntil = now + randRange(state.rng, BOT.burstPause.min, BOT.burstPause.max);
    }
  }
}

function updateObjective(state, f) {
  const b = f.bot;
  const charge = state.charge;
  // Planting: carrier stands in the site and channels.
  if (b.mode === 'plant' && f.hasCharge && charge.state === 'carried') {
    const site = siteAt(f.pos.x, f.pos.z);
    if (site && b.target === -1) {
      if (!f.channel) f.channel = { kind: 'plant', site, until: state.time + PLANT_TIME, total: PLANT_TIME };
      if (state.time >= f.channel.until) {
        f.channel = null;
        completePlant(state, f, site);
        b.mode = 'hold';
      }
      return;
    }
  }
  if (f.channel && f.channel.kind === 'plant' && (b.target !== -1 || f.speed2d > 0.5)) {
    f.channel = null;
  }
  // Fetching: pick up the charge by walking over it.
  if (b.mode === 'fetch' && charge.state === 'dropped' && f.team === 'vanguard') {
    const dx = f.pos.x - charge.pos.x, dz = f.pos.z - charge.pos.z;
    if (dx * dx + dz * dz < 1.2) {
      charge.state = 'carried';
      charge.carrier = f.id;
      f.hasCharge = true;
      b.mode = 'plant';
      const s = SITES[nearestSite(f)];
      b.path = pathTo(state, f, s.cx, s.cz);
      b.pathIdx = 0;
      b.dest = { x: s.cx, z: s.cz };
    }
  }
  // Defusing: a defender at the planted site with no enemy in sight channels.
  if (b.mode === 'retake' && charge.state === 'planted') {
    const s = SITES[charge.site];
    const nearSite = Math.hypot(f.pos.x - s.cx, f.pos.z - s.cz) < 6;
    const enemyNear = state.fighters.some((e) => e.alive && e.team !== f.team &&
      Math.hypot(e.pos.x - s.cx, e.pos.z - s.cz) < 12 && canSee(state, f, e));
    if (nearSite && !enemyNear && b.target === -1) {
      if (!f.channel) f.channel = { kind: 'defuse', site: charge.site, until: state.time + DEFUSE_TIME, total: DEFUSE_TIME };
      if (state.time >= f.channel.until) {
        f.channel = null;
        completeDefuse(state, f);
      }
      return;
    }
    if (f.channel && f.channel.kind === 'defuse') f.channel = null;
  }
}

export function updateBot(state, f, dt) {
  if (!f.alive || !f.bot) return;
  const b = f.bot;
  if (state.phase === 'freeze') { botBuy(state, f); return; }
  if (state.phase !== 'live') return;
  if (state.time >= b.thinkAt) {
    b.thinkAt = state.time + 1 / BOT.thinkHz + (f.id % 5) * 0.013;
    think(state, f);
  }
  updateAim(state, f, dt);
  updateObjective(state, f);
  const channeling = !!f.channel;
  if (!channeling) updateMove(state, f, dt);
  else { f.vel.x = 0; f.vel.z = 0; f.speed2d = 0; }
  updateCombat(state, f);
  if (f.reloading && state.time >= f.reloadUntil) {
    const w = currentWeapon(f);
    const ammo = currentAmmo(f);
    const take = Math.min(w.mag - ammo.mag, ammo.reserve);
    ammo.mag += take; ammo.reserve -= take;
    f.reloading = false;
  }
}
