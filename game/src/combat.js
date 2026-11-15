// BREACHLINE — combat: hitscan fire, damage and death, grenade physics and
// detonation. Bullets are rays against the map boxes and three spheres per
// fighter (head, chest, pelvis); the nearest hit wins, so a headshot is a
// geometric fact, not a dice roll. Explosions respect walls: no line of
// sight, quarter damage.

import {
  GRAVITY, GRENADES, KILL_REWARD,
} from './config.js';
import { rayBox, raySolids, raySphere, lineOfSight } from './collision.js';
import { SOLIDS } from './map.js';
import {
  addKillfeed, chestSphere, eyeHeight, headSphere, pelvisSphere, pushEvent,
  pushNoise,
} from './state.js';
import { applyRecoil, currentAmmo, currentWeapon, damageAt, spreadNow } from './weapons.js';
import { clamp, dirFromAngles, gauss, v3 } from './utils.js';

const _dir = v3(), _right = v3(), _up = v3(), _origin = v3();
const _muzzle = v3(), _hit = { dist: -1, solid: null, nx: 0, ny: 0, nz: 0 };
const _sphere = { x: 0, y: 0, z: 0, r: 0 };
const _eye = v3();

export function eyePos(f, out) {
  out.x = f.pos.x; out.y = f.pos.y + eyeHeight(f); out.z = f.pos.z;
  return out;
}

export function fireWeapon(state, shooter) {
  const w = currentWeapon(shooter);
  const ammo = currentAmmo(shooter);
  if (ammo.mag <= 0 || shooter.reloading) return false;
  ammo.mag -= 1;
  shooter.fireCooldown = 60 / w.rpm;
  shooter.muzzleUntil = state.time + 0.045;
  const rng = state.rng;
  const zoomed = !!shooter.zoomed;
  const spread = spreadNow(shooter, w, zoomed);
  applyRecoil(shooter, w, rng);
  pushNoise(state, shooter.pos.x, shooter.pos.z, w.noise, 'shot', shooter.id);
  pushEvent(state, { kind: 'shot', fighter: shooter.id, weapon: w.id });

  eyePos(shooter, _origin);
  dirFromAngles(_dir, shooter.yaw + shooter.recoilYaw, shooter.pitch + shooter.recoilPitch);
  // Muzzle offset: forward and to the gun side, so tracers start at the gun.
  _right.x = -_dir.z; _right.y = 0; _right.z = _dir.x;
  const rl = Math.hypot(_right.x, _right.z) || 1;
  _right.x /= rl; _right.z /= rl;
  _muzzle.x = _origin.x + _dir.x * 0.45 + _right.x * 0.18;
  _muzzle.y = _origin.y + _dir.y * 0.45 - 0.14;
  _muzzle.z = _origin.z + _dir.z * 0.45 + _right.z * 0.18;

  for (let p = 0; p < w.pellets; p++) {
    // Random point in the spread disc, perpendicular to the aim.
    const a = rng() * Math.PI * 2;
    const r = spread * Math.sqrt(rng());
    const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    // True perpendicular: up = right x dir (right is horizontal).
    _up.x = -_right.z * _dir.y;
    _up.y = _right.z * _dir.x - _right.x * _dir.z;
    _up.z = _right.x * _dir.y;
    let dx = _dir.x + _right.x * ox + _up.x * oy;
    let dy = _dir.y + _right.y * ox + _up.y * oy;
    let dz = _dir.z + _right.z * ox + _up.z * oy;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;

    raySolids(_origin.x, _origin.y, _origin.z, dx, dy, dz, w.range, SOLIDS, _hit);
    const wallDist = _hit.dist >= 0 ? _hit.dist : w.range;

    // Nearest enemy sphere along the ray.
    let bestDist = wallDist, victim = null, head = false;
    for (const f of state.fighters) {
      if (!f.alive || f.team === shooter.team) continue;
      headSphere(f, _sphere);
      let t = raySphere(_origin.x, _origin.y, _origin.z, dx, dy, dz, _sphere.x, _sphere.y, _sphere.z, _sphere.r, wallDist);
      let isHead = t >= 0;
      if (t < 0 || t > bestDist) {
        chestSphere(f, _sphere);
        const tc = raySphere(_origin.x, _origin.y, _origin.z, dx, dy, dz, _sphere.x, _sphere.y, _sphere.z, _sphere.r, wallDist);
        if (tc >= 0 && tc < bestDist) { t = tc; isHead = false; }
      }
      if (t < 0 || t > bestDist) {
        pelvisSphere(f, _sphere);
        const tp = raySphere(_origin.x, _origin.y, _origin.z, dx, dy, dz, _sphere.x, _sphere.y, _sphere.z, _sphere.r, wallDist);
        if (tp >= 0 && tp < bestDist) { t = tp; isHead = false; }
      }
      if (t >= 0 && t < bestDist) { bestDist = t; victim = f; head = isHead; }
    }

    const hx = _origin.x + dx * bestDist;
    const hy = _origin.y + dy * bestDist;
    const hz = _origin.z + dz * bestDist;
    state.tracers.push({ fx: _muzzle.x, fy: _muzzle.y, fz: _muzzle.z, tx: hx, ty: hy, tz: hz, color: w.tracer, until: state.time + 0.07 });
    if (state.tracers.length > 28) state.tracers.shift();

    if (victim) {
      const dmg = damageAt(w, bestDist) * (head ? w.headMult : 1);
      state.impacts.push({ x: hx, y: hy, z: hz, nx: -dx, ny: -dy, nz: -dz, kind: 'flesh', until: state.time + 0.4 });
      damageFighter(state, victim, shooter, dmg, head, w.id);
    } else if (_hit.dist >= 0) {
      state.impacts.push({ x: hx, y: hy, z: hz, nx: _hit.nx, ny: _hit.ny, nz: _hit.nz, kind: 'wall', until: state.time + 20 });
      if (state.impacts.length > 60) state.impacts.shift();
    }
  }
  return true;
}

export function damageFighter(state, victim, attacker, dmg, head, weaponId) {
  if (!victim.alive) return;
  let amount = dmg;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, amount * 0.5);
    victim.armor -= absorbed;
    amount -= absorbed;
  }
  victim.hp -= amount;
  if (attacker) attacker.damageDealt += amount;
  pushEvent(state, {
    kind: 'damaged', victim: victim.id, attacker: attacker ? attacker.id : -1,
    amount, head, weapon: weaponId,
  });
  if (victim.hp <= 0) killFighter(state, victim, attacker, head, weaponId);
}

function killFighter(state, victim, attacker, head, weaponId) {
  victim.hp = 0;
  victim.alive = false;
  victim.deaths += 1;
  victim.deathTime = state.time;
  victim.channel = null;
  victim.reloading = false;
  if (victim.hasCharge) {
    victim.hasCharge = false;
    state.charge.state = 'dropped';
    state.charge.pos.x = victim.pos.x;
    state.charge.pos.y = 0;
    state.charge.pos.z = victim.pos.z;
  }
  if (attacker && attacker !== victim) {
    attacker.kills += 1;
    attacker.money = Math.min(9000, attacker.money + KILL_REWARD);
  }
  const wname = weaponId ? weaponId.toUpperCase() : 'FRAG';
  addKillfeed(state, `${attacker ? attacker.name : '—'} ${head ? '◉ ' : ''}${wname} ${victim.name}`, attacker ? attacker.team : null);
  pushEvent(state, { kind: 'kill', killer: attacker ? attacker.id : -1, victim: victim.id, head, weapon: weaponId });
}

export function startReload(state, f) {
  const w = currentWeapon(f);
  const ammo = currentAmmo(f);
  if (f.reloading || ammo.mag >= w.mag || ammo.reserve <= 0) return;
  f.reloading = true;
  f.reloadUntil = state.time + w.reload;
  pushEvent(state, { kind: 'reload', fighter: f.id, weapon: w.id });
}

export function throwGrenade(state, f, kind) {
  if (!kind || f.grenades[kind] <= 0) return false;
  const def = GRENADES[kind];
  f.grenades[kind] -= 1;
  f.throwUntil = state.time + 0.35;
  f.fireCooldown = Math.max(f.fireCooldown, 0.4);
  dirFromAngles(_dir, f.yaw, f.pitch);
  eyePos(f, _eye);
  state.grenades.push({
    kind, owner: f.id, team: f.team,
    pos: { x: _eye.x + _dir.x * 0.4, y: _eye.y - 0.1, z: _eye.z + _dir.z * 0.4 },
    vel: { x: _dir.x * 15 + f.vel.x * 0.4, y: _dir.y * 15 + 3.2, z: _dir.z * 15 + f.vel.z * 0.4 },
    fuse: def.fuse, spin: 0,
  });
  if (f.grenades[kind] <= 0 && f.current === 'grenade') {
    f.current = f.weapons.main ? 'main' : 'side';
  }
  pushEvent(state, { kind: 'throw', fighter: f.id, grenade: kind });
  return true;
}

function solidAt(x, y, z, r) {
  for (const s of SOLIDS) {
    if (x + r > s.x0 && x - r < s.x1 && y + r > s.y0 && y - r < s.y1 && z + r > s.z0 && z - r < s.z1) return s;
  }
  return null;
}

export function updateGrenades(state, dt) {
  const list = state.grenades;
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    g.vel.y -= GRAVITY * dt;
    g.spin += dt * 9;
    const r = 0.12;
    g.pos.x += g.vel.x * dt;
    if (solidAt(g.pos.x, g.pos.y, g.pos.z, r)) { g.pos.x -= g.vel.x * dt; g.vel.x *= -0.35; g.vel.y *= 0.7; g.vel.z *= 0.7; }
    g.pos.z += g.vel.z * dt;
    if (solidAt(g.pos.x, g.pos.y, g.pos.z, r)) { g.pos.z -= g.vel.z * dt; g.vel.z *= -0.35; g.vel.x *= 0.7; g.vel.y *= 0.7; }
    g.pos.y += g.vel.y * dt;
    if (g.pos.y < r) {
      g.pos.y = r;
      if (g.vel.y < 0) { g.vel.y *= -0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    } else {
      const s = solidAt(g.pos.x, g.pos.y, g.pos.z, r);
      if (s) {
        if (g.vel.y <= 0 && g.pos.y >= s.y1 - 0.25) { g.pos.y = s.y1 + r; g.vel.y *= -0.3; }
        else { g.pos.y -= g.vel.y * dt; g.vel.y *= -0.3; }
      }
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      detonate(state, g);
      list[i] = list[list.length - 1];
      list.pop();
    }
  }
  // Smoke clouds expire.
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (state.time > state.smokes[i].until) state.smokes.splice(i, 1);
  }
}

function detonate(state, g) {
  const def = GRENADES[g.kind];
  const p = g.pos;
  if (g.kind === 'frag') {
    pushEvent(state, { kind: 'explosion', x: p.x, y: p.y, z: p.z });
    pushNoise(state, p.x, p.z, def.noise, 'explosion', g.owner);
    const owner = state.fighters[g.owner];
    for (const f of state.fighters) {
      if (!f.alive) continue;
      eyePos(f, _eye);
      const d = Math.hypot(_eye.x - p.x, _eye.y - p.y, _eye.z - p.z);
      if (d > def.radius) continue;
      let dmg = def.damage * (1 - (d / def.radius) * 0.75);
      if (!lineOfSight(p.x, p.y, p.z, _eye.x, _eye.y, _eye.z, SOLIDS, null)) dmg *= 0.25;
      if (dmg > 1) damageFighter(state, f, owner, dmg, false, 'frag');
    }
  } else if (g.kind === 'flash') {
    pushEvent(state, { kind: 'flashbang', x: p.x, y: p.y, z: p.z });
    pushNoise(state, p.x, p.z, def.noise, 'explosion', g.owner);
    for (const f of state.fighters) {
      if (!f.alive) continue;
      eyePos(f, _eye);
      const dx = p.x - _eye.x, dy = p.y - _eye.y, dz = p.z - _eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > def.radius) continue;
      if (!lineOfSight(p.x, p.y, p.z, _eye.x, _eye.y, _eye.z, SOLIDS, null)) continue;
      // Facing the blast blinds fully; looking away still flashes up close.
      dirFromAngles(_dir, f.yaw, f.pitch);
      const facing = (_dir.x * dx + _dir.y * dy + _dir.z * dz) / (d || 1);
      const closeness = 1 - d / def.radius;
      const amount = clamp(closeness * (facing > 0 ? 1 : 0.45) + (d < 4 ? 0.4 : 0), 0, 1);
      if (amount > 0.15) {
        f.flashUntil = state.time + def.blind * amount;
        f.flashPeak = Math.max(f.flashPeak, amount);
      }
    }
  } else if (g.kind === 'smoke') {
    state.smokes.push({ x: p.x, y: Math.max(0.9, p.y), z: p.z, radius: def.radius, until: state.time + def.life, born: state.time });
    pushEvent(state, { kind: 'smoke', x: p.x, y: p.y, z: p.z });
  }
}
