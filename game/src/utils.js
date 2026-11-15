// BREACHLINE — small math helpers and the seeded RNG. No allocations in the
// hot path: vector helpers write into an `out` object the caller owns.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

// Shortest signed difference between two angles, in (-PI, PI].
export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function turnToward(current, target, maxStep) {
  const d = angleDiff(target, current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

// mulberry32: deterministic, good enough for bot decisions and staging.
export function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randRange(rng, lo, hi) { return lo + rng() * (hi - lo); }
export function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
// Roughly normal in [-1, 1] from three uniforms — aim error, recoil drift.
export function gauss(rng) { return (rng() + rng() + rng()) / 1.5 - 1; }

// Plain-object vectors: {x, y, z}. Every helper takes an out parameter.
export function v3(x = 0, y = 0, z = 0) { return { x, y, z }; }
export function vSet(out, x, y, z) { out.x = x; out.y = y; out.z = z; return out; }
export function vCopy(out, a) { out.x = a.x; out.y = a.y; out.z = a.z; return out; }
export function vAdd(out, a, b) { out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z; return out; }
export function vSub(out, a, b) { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; }
export function vScale(out, a, s) { out.x = a.x * s; out.y = a.y * s; out.z = a.z * s; return out; }
export function vLen(a) { return Math.hypot(a.x, a.y, a.z); }
export function vLenSq(a) { return a.x * a.x + a.y * a.y + a.z * a.z; }
export function vDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
export function vDistSq(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
export function vNorm(out, a) {
  const l = vLen(a) || 1;
  out.x = a.x / l; out.y = a.y / l; out.z = a.z / l;
  return out;
}
// Yaw/pitch (radians, yaw 0 faces -Z, pitch positive looks up) to a unit dir.
export function dirFromAngles(out, yaw, pitch) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}
export function yawPitchFromDir(dir) {
  return { yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(clamp(dir.y, -1, 1)) };
}
