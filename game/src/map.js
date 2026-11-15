// BREACHLINE — FOUNDRY-9, an original three-lane map: a decommissioned
// foundry yard at dusk. Vanguard spawn west, Sentinel spawn east, a north
// lane to Site A (Furnace), a south lane to Site B (Stores), and a middle
// conveyor hall with two connector stairs. All collision is axis-aligned
// boxes; the same data drives rendering, movement, bullets and bot routes.
//
// Layout (x east, z south, metres). Walls are 4.5 high, crates ~1 high
// and jumpable, pillars break up the long sightlines.

function box(x0, z0, x1, z1, y1, kind) {
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: 0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), kind };
}
function crate(x, z, s = 2, h = 1) {
  return box(x - s / 2, z - s / 2, x + s / 2, z + s / 2, h, 'crate');
}

const WALL = 4.5;
export const SOLIDS = [
  // Perimeter.
  box(-33, -25, 33, -24, WALL, 'wall'),
  box(-33, 24, 33, 25, WALL, 'wall'),
  box(-33, -25, -32, 25, WALL, 'wall'),
  box(32, -25, 33, 25, WALL, 'wall'),
  // North separator (A lane / mid), with a peek window at x -4..-2 (sill at
  // 1.1 m, header from 2.2 m up — open to shoot through) and the A-connector
  // gap at x 6..12.
  box(-32, -13, -4, -12, WALL, 'wall'),
  box(-4, -13, -2, -12, 1.1, 'wall'),
  { x0: -4, x1: -2, y0: 2.2, y1: WALL, z0: -13, z1: -12, kind: 'wall' },
  box(12, -13, 22, -12, WALL, 'wall'),
  // South separator (B lane / mid), mirrored.
  box(-32, 12, -4, 13, WALL, 'wall'),
  box(-4, 12, -2, 13, 1.1, 'wall'),
  { x0: -4, x1: -2, y0: 2.2, y1: WALL, z0: 12, z1: 13, kind: 'wall' },
  box(12, 12, 22, 13, WALL, 'wall'),
  // Mid double doors: wall at x 8..9 with a 2 m gap.
  box(8, -4, 9, -1, WALL, 'wall'),
  box(8, 1, 9, 4, WALL, 'wall'),
  // Furnace pillars, north lane — set back from the lane centreline so the
  // waypoint line clears them.
  box(-12.5, -20, -11.5, -19, WALL, 'pillar'),
  box(3.5, -20, 4.5, -19, WALL, 'pillar'),
  // Stores pillars, south lane, mirrored.
  box(-12.5, 19, -11.5, 20, WALL, 'pillar'),
  box(3.5, 19, 4.5, 20, WALL, 'pillar'),
  // Mid conveyor: two blocks flanking the centreline, leaving the
  // waypoint line through the double doors clear.
  box(-2, -3.5, 2, -1.5, 1.1, 'crate'),
  box(-2, 1.5, 2, 3.5, 1.1, 'crate'),
  // Crates, north lane and Site A — all offset from the waypoint lines.
  crate(-18, -20), crate(-8, -20), crate(2, -16), crate(8, -20, 2, 1.2),
  crate(18, -19, 2, 1), crate(24, -15, 2, 1), crate(17.5, -15.5, 1.6, 1),
  crate(22, -22.5, 2, 1), box(25, -23.5, 28, -20.5, 1, 'platform'),
  // Crates, south lane and Site B.
  crate(-18, 20), crate(-8, 20), crate(2, 16), crate(8, 20, 2, 1.2),
  crate(18, 19, 2, 1), crate(24, 15, 2, 1), crate(17.5, 15.5, 1.6, 1),
  box(16.5, 22, 19.5, 23.5, 1.2, 'crate'),
  // Mid cover, clear of the centreline.
  crate(-14, 2.5, 2, 1), crate(16, -2, 2, 1), crate(16, 2, 2, 1),
];

export const SITES = {
  A: { name: 'A · FURNACE', x0: 14, x1: 28, z0: -24, z1: -12.5, cx: 21, cz: -18 },
  B: { name: 'B · STORES', x0: 14, x1: 28, z0: 12.5, z1: 24, cx: 21, cz: 18 },
};

export const SPAWNS = {
  vanguard: [
    { x: -29.5, z: -3 }, { x: -29.5, z: 3 }, { x: -28, z: 0 },
    { x: -30.5, z: -5 }, { x: -30.5, z: 5 },
  ],
  sentinel: [
    { x: 29.5, z: -3 }, { x: 29.5, z: 3 }, { x: 28, z: 0 },
    { x: 30.5, z: -5 }, { x: 30.5, z: 5 },
  ],
};

// Waypoint graph: [x, z] nodes, edges by index. Bots walk node to node;
// every edge is a straight, unobstructed run (verified against SOLIDS).
export const WAYPOINTS = [
  [-29, 0], [-27, -4], [-27, 4], // 0-2 vanguard spawn
  [-24, -18], [-16, -18], [-8, -18], [0, -18], [8, -18], [14, -18], // 3-8 A lane
  [20, -19], [24, -17], [17, -21], [24, -20.5], // 9-12 site A
  [-24, 18], [-16, 18], [-8, 18], [0, 18], [8, 18], [14, 18], // 13-18 B lane
  [20, 19], [24, 17], [17, 21], [25, 21], // 19-22 site B
  [-24, 0], [-14, 0], [-6, 0], [4, 0], [11, 0], [18, 0], [24, 0], // 23-29 mid
  [9, -8], [9, 8], // 30-31 connectors
  [24, -9], [27, -3], [24, 9], [27, 3], // 32-35 links
  [29, 0], [27, -4], [27, 4], // 36-38 sentinel spawn
];
const EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 13], [0, 23],
  [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [8, 11], [11, 9], [9, 12], [12, 10],
  [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [18, 21], [21, 19], [19, 22], [22, 20],
  [23, 24], [24, 25], [25, 26], [26, 27], [27, 28], [28, 29],
  [26, 30], [30, 7], [26, 31], [31, 17],
  [29, 36], [29, 33], [29, 35], [36, 37], [36, 38],
  [37, 33], [33, 32], [32, 10], [28, 32],
  [38, 35], [35, 34], [34, 20], [28, 34],
];
export const NAV = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) { NAV[a].push(b); NAV[b].push(a); }

// Defender hold spots: position + the yaw to watch. yaw 0 faces north (-Z),
// PI/2 faces west, PI faces south, -PI/2 faces east.
export const HOLD_SPOTS = {
  A: [
    { x: 25.5, z: -19.5, yaw: Math.PI / 2 },
    { x: 16, z: -14, yaw: Math.PI * 0.75 },
  ],
  B: [
    { x: 25.5, z: 19.5, yaw: Math.PI / 2 },
    { x: 16, z: 14, yaw: Math.PI * 0.25 },
  ],
  MID: [{ x: 14, z: -2, yaw: Math.PI / 2 }],
};

// Attacker routes: waypoint chains from spawn to each site.
export const ROUTES = {
  A: [1, 3, 4, 5, 6, 7, 8, 9],
  A_MID: [23, 24, 25, 26, 30, 7, 8, 9],
  B: [2, 13, 14, 15, 16, 17, 18, 19],
  B_MID: [23, 24, 25, 26, 31, 17, 18, 19],
  MID: [23, 24, 25, 26, 27, 28, 29],
};

// Decorative props (visual only, no collision beyond SOLIDS): chimneys and
// silos outside the walls, barrels, pipes, lamps and fences inside.
export const PROPS = [
  { type: 'chimney', x: -20, z: -29, h: 16 }, { type: 'chimney', x: 8, z: -29, h: 19 },
  { type: 'silo', x: 26, z: -29 }, { type: 'silo', x: -34, z: 10 },
  { type: 'silo', x: 36, z: -12 }, { type: 'chimney', x: 34, z: 28, h: 14 },
  { type: 'barrel', x: -10, z: -22 }, { type: 'barrel', x: -9, z: -21 },
  { type: 'barrel', x: 26, z: 14 }, { type: 'barrel', x: 12, z: 22 },
  { type: 'barrel', x: -26, z: 10 }, { type: 'barrel', x: 6, z: -10 },
  { type: 'pipe', x: -30, z: -11 }, { type: 'pipe', x: 20, z: -11 },
  { type: 'pipe', x: -30, z: 11 }, { type: 'pipe', x: 20, z: 11 },
  { type: 'fence', x: -6, z: -6 }, { type: 'fence', x: -6, z: 6 },
  { type: 'lampPost', x: -20, z: 3.5 }, { type: 'lampPost', x: 12, z: -3.5 },
  { type: 'lampPost', x: 20, z: -18 }, { type: 'lampPost', x: 20, z: 18 },
  { type: 'lampPost', x: -16, z: -18 }, { type: 'lampPost', x: -16, z: 18 },
];

export const LAMPS = [
  { x: -20, z: 3.5 }, { x: 12, z: -3.5 }, { x: 20, z: -18 },
  { x: 20, z: 18 }, { x: -16, z: -18 }, { x: -16, z: 18 },
  { x: -29, z: 0 }, { x: 29, z: 0 },
];

// Breadth-first path over the waypoint graph. Returns waypoint indices from
// the node nearest `from` to the node nearest `to`, inclusive.
const _prev = new Int32Array(WAYPOINTS.length);
const _queue = new Int32Array(WAYPOINTS.length);
export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x, dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
export function findPath(fromX, fromZ, toX, toZ) {
  const start = nearestWaypoint(fromX, fromZ);
  const goal = nearestWaypoint(toX, toZ);
  if (start === goal) return [goal];
  _prev.fill(-1);
  _prev[start] = start;
  let head = 0, tail = 0;
  _queue[tail++] = start;
  while (head < tail) {
    const n = _queue[head++];
    if (n === goal) break;
    const links = NAV[n];
    for (let i = 0; i < links.length; i++) {
      const m = links[i];
      if (_prev[m] === -1) { _prev[m] = n; _queue[tail++] = m; }
    }
  }
  if (_prev[goal] === -1) return [goal];
  const path = [];
  let n = goal;
  while (n !== start) { path.push(n); n = _prev[n]; }
  path.push(start);
  path.reverse();
  return path;
}
export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return key;
  }
  return null;
}
