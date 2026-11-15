// BREACHLINE — collision: axis-separated AABB movement, ray-vs-box and
// ray-vs-sphere tests, line of sight. Pure math, no rendering dependency,
// so the fixed-step sim runs on data alone. All queries write into caller
// owned `out` objects; nothing here allocates per call.

import { vLen } from './utils.js';

// Move a capsule approximated by its AABB: feet at pos.y, radius r in x/z,
// height h. Axis-separated: slide along each axis independently, clamping
// to the first solid face hit. Returns via `res`: onGround, hitWall, and
// the (possibly clamped) velocity the caller keeps.
export function moveBody(pos, vel, dt, r, h, solids, res) {
  res.onGround = false;
  res.hitWall = false;
  // X axis.
  pos.x += vel.x * dt;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (overlaps(pos, r, h, s)) {
      if (vel.x > 0) pos.x = s.x0 - r; else if (vel.x < 0) pos.x = s.x1 + r;
      vel.x = 0; res.hitWall = true;
    }
  }
  // Z axis.
  pos.z += vel.z * dt;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (overlaps(pos, r, h, s)) {
      if (vel.z > 0) pos.z = s.z0 - r; else if (vel.z < 0) pos.z = s.z1 + r;
      vel.z = 0; res.hitWall = true;
    }
  }
  // Y axis: ground plane plus box tops and undersides.
  pos.y += vel.y * dt;
  if (pos.y <= 0) { pos.y = 0; if (vel.y < 0) vel.y = 0; res.onGround = true; }
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (overlapsXZ(pos, r, s) && pos.y < s.y1 && pos.y + h > s.y0) {
      if (vel.y <= 0 && pos.y + 0.001 >= s.y0 && pos.y <= s.y1) {
        // Falling onto the top face (only when the feet were above it).
        if (pos.y - vel.y * dt >= s.y1 - 0.001) {
          pos.y = s.y1; vel.y = 0; res.onGround = true;
        }
      } else if (vel.y > 0) {
        pos.y = s.y0 - h; vel.y = 0;
      }
    }
  }
  // Standing check: feet exactly on a top face counts as grounded even
  // with no downward velocity this step.
  if (!res.onGround) {
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (Math.abs(pos.y - s.y1) < 0.001 && overlapsXZ(pos, r, s)) { res.onGround = true; break; }
    }
  }
  return res;
}
function overlaps(pos, r, h, s) {
  return pos.x + r > s.x0 && pos.x - r < s.x1 &&
    pos.z + r > s.z0 && pos.z - r < s.z1 &&
    pos.y + h > s.y0 && pos.y < s.y1;
}
function overlapsXZ(pos, r, s) {
  return pos.x + r > s.x0 && pos.x - r < s.x1 && pos.z + r > s.z0 && pos.z - r < s.z1;
}

// Ray vs one AABB (slab method). Returns the entry distance, or -1.
export function rayBox(ox, oy, oz, dx, dy, dz, s, maxDist) {
  let tmin = 0, tmax = maxDist;
  if (Math.abs(dx) < 1e-9) { if (ox < s.x0 || ox > s.x1) return -1; }
  else {
    let t1 = (s.x0 - ox) / dx, t2 = (s.x1 - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < s.y0 || oy > s.y1) return -1; }
  else {
    let t1 = (s.y0 - oy) / dy, t2 = (s.y1 - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < s.z0 || oz > s.z1) return -1; }
  else {
    let t1 = (s.z0 - oz) / dz, t2 = (s.z1 - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Nearest solid hit along the ray. `out` gets {dist, solid, nx, ny, nz}
// with the face normal, or dist -1 when nothing is hit.
export function raySolids(ox, oy, oz, dx, dy, dz, maxDist, solids, out) {
  let best = -1, bestSolid = null;
  for (let i = 0; i < solids.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, solids[i], maxDist);
    if (t >= 0 && (best < 0 || t < best)) { best = t; bestSolid = solids[i]; }
  }
  out.dist = best; out.solid = bestSolid;
  if (best >= 0) {
    const px = ox + dx * best, py = oy + dy * best, pz = oz + dz * best;
    const s = bestSolid, e = 0.002;
    out.nx = Math.abs(px - s.x0) < e ? -1 : Math.abs(px - s.x1) < e ? 1 : 0;
    out.ny = Math.abs(py - s.y0) < e ? -1 : Math.abs(py - s.y1) < e ? 1 : 0;
    out.nz = Math.abs(pz - s.z0) < e ? -1 : Math.abs(pz - s.z1) < e ? 1 : 0;
  }
  return out;
}

// Ray vs sphere. Returns the entry distance, or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius, maxDist) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  return t >= 0 && t <= maxDist ? t : -1;
}

// True when the segment a->b is not interrupted by a solid or a smoke cloud.
// `smokes` is an optional array of {x, y, z, radius} the segment must avoid.
const _seg = { x: 0, y: 0, z: 0 };
export function lineOfSight(ax, ay, az, bx, by, bz, solids, smokes) {
  _seg.x = bx - ax; _seg.y = by - ay; _seg.z = bz - az;
  const dist = vLen(_seg);
  if (dist < 1e-6) return true;
  const dx = _seg.x / dist, dy = _seg.y / dist, dz = _seg.z / dist;
  for (let i = 0; i < solids.length; i++) {
    const t = rayBox(ax, ay, az, dx, dy, dz, solids[i], dist);
    if (t >= 0 && t < dist - 0.05) return false;
  }
  if (smokes) {
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      if (raySphere(ax, ay, az, dx, dy, dz, s.x, s.y, s.z, s.radius, dist) >= 0) return false;
    }
  }
  return true;
}
