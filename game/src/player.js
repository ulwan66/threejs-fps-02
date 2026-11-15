// BREACHLINE — the human player: look, movement, weapon handling and the
// plant channel. Movement is acceleration/friction based with a crouch and
// a jump; firing, reload and grenade throws delegate to combat.js. Bots
// never run this code — they have their own controller in bots.js.

import {
  AIR_ACCEL, BODY_RADIUS, BOMB_TIME, CROUCH_SPEED, GRAVITY, GROUND_ACCEL,
  GROUND_FRICTION, JUMP_SPEED, PLANT_REWARD, PLANT_TIME, WALK_SPEED,
  GRENADE_ORDER,
} from './config.js';
import { moveBody } from './collision.js';
import { SOLIDS, siteAt } from './map.js';
import { bodyHeight, pushEvent, pushNoise } from './state.js';
import { currentWeapon, currentAmmo } from './weapons.js';
import { fireWeapon, startReload, throwGrenade } from './combat.js';
import { clamp } from './utils.js';

const _move = { onGround: false, hitWall: false };

export function updatePlayer(state, f, input, dt) {
  if (!f.alive) return;
  const playing = state.phase === 'live' || state.phase === 'freeze';
  const live = state.phase === 'live';

  // Look: pointer-lock deltas, recoil offset applied by the renderer.
  const look = input.takeLook();
  if (input.locked) {
    f.yaw -= look.dx * input.sensitivity;
    f.pitch = clamp(f.pitch - look.dy * input.sensitivity, -1.45, 1.45);
  }

  // Buy menu toggle (only while the buy window is open).
  if (input.takePressed('KeyB') && state.phase !== 'menu' && state.time < state.buyUntil) {
    state.buyOpen = !state.buyOpen;
    if (state.buyOpen) input.releaseLock(); else input.requestLock();
  }
  if (state.buyOpen) { return; }

  // Crouch is a hold; Shift is a slow, quiet walk.
  f.crouch = input.isDown('ControlLeft') || input.isDown('KeyC');
  const slow = input.isDown('ShiftLeft') || input.isDown('ShiftRight');

  // Wish direction in world space from the keys.
  let ix = 0, iz = 0;
  if (playing) {
    if (input.isDown('KeyW')) iz -= 1;
    if (input.isDown('KeyS')) iz += 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;
  }
  const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
  // Wish = right * ix + forward * (-iz): forward is (-sin yaw, -cos yaw),
  // right is (cos yaw, -sin yaw), and W gives iz = -1.
  let wx = ix * cy + iz * sy;
  let wz = -ix * sy + iz * cy;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  const maxSpeed = f.crouch ? CROUCH_SPEED : slow ? WALK_SPEED * 0.5 : WALK_SPEED;
  if (f.onGround) {
    // Ground: accelerate toward the wish velocity, friction when idle.
    const tx = wx * maxSpeed, tz = wz * maxSpeed;
    const k = wl > 0 ? GROUND_ACCEL : GROUND_FRICTION * 2.2;
    f.vel.x += clamp(tx - f.vel.x, -k * dt, k * dt);
    f.vel.z += clamp(tz - f.vel.z, -k * dt, k * dt);
    if (input.takePressed('Space') && playing) {
      f.vel.y = JUMP_SPEED;
      f.onGround = false;
    }
  } else {
    f.vel.x += wx * AIR_ACCEL * dt;
    f.vel.z += wz * AIR_ACCEL * dt;
    f.vel.y -= GRAVITY * dt;
  }
  const h = bodyHeight(f);
  moveBody(f.pos, f.vel, dt, BODY_RADIUS, h, SOLIDS, _move);
  f.onGround = _move.onGround;
  f.speed2d = Math.hypot(f.vel.x, f.vel.z);
  f.moveDir = wl > 0 ? Math.atan2(wx, wz) : f.moveDir;
  f.walkPhase += f.speed2d * dt * 1.9;

  // Footsteps: audible to nearby bots, quieter while crouched or slow.
  if (f.onGround && f.speed2d > 0.6 && playing) {
    f.stepAcc = (f.stepAcc || 0) + f.speed2d * dt;
    const stride = f.crouch || slow ? 3.4 : 2.3;
    if (f.stepAcc > stride) {
      f.stepAcc = 0;
      const radius = f.crouch ? 2.5 : slow ? 4 : 7;
      pushNoise(state, f.pos.x, f.pos.z, radius, 'step', f.id);
      pushEvent(state, { kind: 'step', fighter: f.id, loud: radius > 3 });
    }
  }

  // Weapon switching.
  if (input.takePressed('Digit1') && f.weapons.main) { f.current = 'main'; f.reloading = false; }
  if (input.takePressed('Digit2')) { f.current = 'side'; f.reloading = false; }
  if (input.takePressed('Digit3')) {
    // Cycle the held grenade type; the throw is G or the fire button.
    const have = GRENADE_ORDER.filter((g) => f.grenades[g] > 0);
    if (have.length) {
      const i = have.indexOf(f.heldGrenade);
      f.heldGrenade = have[(i + 1) % have.length];
      f.current = 'grenade';
      f.reloading = false;
    }
  }
  if (input.takePressed('KeyQ')) {
    f.current = f.current === 'main' ? 'side' : 'main';
    if (!f.weapons.main) f.current = 'side';
    f.reloading = false;
  }

  // Reload: R, or automatically when the trigger is pulled on an empty mag.
  const w = currentWeapon(f);
  const ammo = currentAmmo(f);
  if (f.current !== 'grenade') {
    if (input.takePressed('KeyR') && ammo.mag < w.mag && ammo.reserve > 0) startReload(state, f);
    if (f.reloading && state.time >= f.reloadUntil) {
      const take = Math.min(w.mag - ammo.mag, ammo.reserve);
      ammo.mag += take; ammo.reserve -= take;
      f.reloading = false;
      pushEvent(state, { kind: 'reloaded', fighter: f.id });
    }
  }

  // Fire / throw.
  const firing = input.mouseDown[0];
  if (live && firing && !f.reloading && f.fireCooldown <= 0) {
    if (f.current === 'grenade') {
      if (input.takeClick(0) || input.takePressed('KeyG')) throwGrenade(state, f, f.heldGrenade);
    } else if (w.auto || input.takeClick(0)) {
      if (ammo.mag > 0) fireWeapon(state, f);
      else { startReload(state, f); pushEvent(state, { kind: 'dry', fighter: f.id }); }
    }
  }
  if (input.takePressed('KeyG') && f.current === 'grenade' && live && !f.reloading) {
    throwGrenade(state, f, f.heldGrenade);
  }
  // DMR zoom: right button held. Guarded first: with a grenade held there
  // is no current weapon, and reading zoomFov off it would throw.
  f.zoomed = f.current !== 'grenade' && !!w && !!w.zoomFov && input.mouseDown[2];

  // Plant channel: hold E inside a site while carrying the charge.
  const site = siteAt(f.pos.x, f.pos.z);
  const canPlant = live && f.hasCharge && site && state.charge.state === 'carried';
  if (canPlant && input.isDown('KeyE') && f.speed2d < 0.5) {
    if (!f.channel) f.channel = { kind: 'plant', site, until: state.time + PLANT_TIME, total: PLANT_TIME };
    if (state.time >= f.channel.until) {
      state.charge.state = 'planted';
      state.charge.site = site;
      state.charge.fuse = BOMB_TIME;
      state.charge.pos.x = f.pos.x; state.charge.pos.z = f.pos.z; state.charge.pos.y = 0;
      f.hasCharge = false;
      f.channel = null;
      f.money += PLANT_REWARD;
      pushEvent(state, { kind: 'planted', fighter: f.id, site });
    }
  } else if (f.channel && f.channel.kind === 'plant') {
    f.channel = null; // moving or releasing E breaks the channel
  }

  // Pick up a dropped charge by walking over it.
  if (live && state.charge.state === 'dropped' && f.team === 'vanguard') {
    const dx = f.pos.x - state.charge.pos.x, dz = f.pos.z - state.charge.pos.z;
    if (dx * dx + dz * dz < 1.2) {
      state.charge.state = 'carried';
      state.charge.carrier = f.id;
      f.hasCharge = true;
      pushEvent(state, { kind: 'pickup', fighter: f.id });
    }
  }

  // Recoil recovery is ticked centrally in sim.js for every fighter.
}
