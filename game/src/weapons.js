// BREACHLINE — weapon behaviour: spread, recoil and damage. The tables live
// in config.js; this module turns a fighter's state into the numbers a shot
// actually uses. Stopping to aim pays: movement and jumping widen the cone
// hard, crouching tightens it, and every shot blooms the next one.

import { WEAPONS, WALK_SPEED } from './config.js';
import { clamp } from './utils.js';

export function currentWeapon(f) {
  return WEAPONS[f.weapons[f.current]];
}
export function currentAmmo(f) {
  return f.ammo[f.weapons[f.current]];
}

// Current spread cone half-angle in radians.
export function spreadNow(f, w, zoomed) {
  const s = w.spread;
  let spread = s.base * (zoomed ? 0.35 : 1);
  if (f.crouch) spread *= s.crouch;
  const speedFrac = clamp(f.speed2d / WALK_SPEED, 0, 1);
  spread += s.move * speedFrac;
  if (!f.onGround) spread += 0.05;
  spread += f.bloom;
  return Math.min(spread, s.max);
}

// Damage at range, with the headshot multiplier applied by the caller.
export function damageAt(w, dist) {
  const f = w.falloff;
  if (dist <= f.near) return w.damage;
  if (dist >= f.far) return w.damage * f.mult;
  const t = (dist - f.near) / (f.far - f.near);
  return w.damage * (1 + (f.mult - 1) * t);
}

// Recoil applied to a shot: the camera kicks and partly recovers, while a
// fraction climbs permanently so long bursts walk upward.
export function applyRecoil(f, w, rng) {
  const kickP = w.recoil.pitch * (0.85 + rng() * 0.3);
  const kickY = w.recoil.yaw * (rng() * 2 - 1);
  f.recoilPitch += kickP;
  f.recoilYaw += kickY;
  f.pitch = clamp(f.pitch + kickP * 0.35, -1.45, 1.45);
  f.yaw += kickY * 0.35;
  f.bloom = Math.min(f.bloom + w.spread.bloom, w.spread.max);
}

// Recovery each sim step: bloom and the recoverable kick decay back.
export function recoverRecoil(f, dt) {
  const k = Math.exp(-5.5 * dt);
  f.bloom *= k;
  f.recoilPitch *= Math.exp(-7 * dt);
  f.recoilYaw *= Math.exp(-7 * dt);
}

export function giveWeapon(f, id) {
  const w = WEAPONS[id];
  f.weapons[w.slot] = id;
  f.ammo[id] = { mag: w.mag, reserve: w.reserve };
  f.current = w.slot;
  f.reloading = false;
}

export function refillAmmo(f) {
  for (const id of Object.keys(f.weapons)) {
    const wid = f.weapons[id];
    if (!wid) continue;
    f.ammo[wid] = { mag: WEAPONS[wid].mag, reserve: WEAPONS[wid].reserve };
  }
}
