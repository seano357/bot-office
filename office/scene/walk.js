// Floor routes for the open office. Nodes sit in the aisles, not on the tables, and edges are the
// short clear hops between them. Callers copy a route into their own point buffer; nothing here
// allocates on the walking hot path besides the one-time path rebuild.

export const FACE_CAMERA = Math.PI / 4;

const NODES = [
  { x: -3.8, z: -5.15 }, // 0 window
  { x: -0.4, z: -5.15 }, // 1
  { x: 1.6, z: -5.15 },  // 2
  { x: 3.2, z: -5.05 },  // 3 window by the bar
  { x: -6.85, z: -4.8 }, // 4 left wall
  { x: -6.85, z: -1.3 }, // 5
  { x: -6.85, z: 2.3 },  // 6
  { x: -4.8, z: -1.3 },  // 7 aisle
  { x: -2.1, z: -1.3 },  // 8
  { x: 1.2, z: -1.3 },   // 9
  { x: 3.5, z: -1.3 },   // 10 right
  { x: 3.5, z: -4.2 },   // 11 coffee
  { x: 3.05, z: 2.55 },  // 12 right, clear of the armchair
  { x: -2.0, z: 2.35 },  // 13 in front of the tables
  { x: -5.2, z: 4.55 },  // 14 front edge
  { x: -1.0, z: 4.75 },  // 15
  { x: 2.2, z: 4.55 },   // 16
  { x: 5.0, z: 3.15 },   // 17 couch
  { x: 6.3, z: 3.55 },   // 18 plant, right
  { x: -5.6, z: 3.5 },   // 19 plant, left
];

const LINKS = [
  [1, 4],          // 0
  [0, 2],          // 1
  [1, 3],          // 2
  [2, 11],         // 3
  [0, 5],          // 4
  [4, 6, 7],       // 5
  [5, 13, 19],     // 6
  [5, 8],          // 7
  [7, 9],          // 8
  [8, 10],         // 9
  [9, 11, 12],     // 10
  [3, 10],         // 11
  [10, 16, 17, 18],// 12
  [6, 15],         // 13
  [19, 15],        // 14
  [13, 14, 16],    // 15
  [12, 15],        // 16
  [12, 18],        // 17
  [12, 17],        // 18
  [6, 14],         // 19
];

// Furniture the last hop must not cut through. Aisles are already outside these boxes.
const BLOCKS = [
  { x0: -6.7, x1: 2.45, z0: -4.05, z1: -2.75 },
  { x0: -6.7, x1: 2.45, z0: 0.15, z1: 1.45 },
  { x0: 4.15, x1: 7.9, z0: -6.05, z1: -5.15 },
  { x0: 4.4, x1: 7.4, z0: -0.55, z1: 0.75 },
  { x0: 3.5, x1: 4.8, z0: 1.55, z1: 2.65 },
  { x0: 7.05, x1: 8.2, z0: 1.55, z1: 2.65 },
];

const LINGER = [1, 8, 11, 17, 18, 15];
const FRONT = [14, 15, 16, 13];

const parent = new Int16Array(NODES.length);
const queue = new Int16Array(NODES.length);

export function hashId(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function nearest(x, z) {
  let best = 0, bestD = Infinity, any = false;
  for (let i = 0; i < NODES.length; i++) {
    const d = (NODES[i].x - x) ** 2 + (NODES[i].z - z) ** 2;
    if (d >= bestD || !segmentClear(x, z, NODES[i].x, NODES[i].z)) continue;
    bestD = d; best = i; any = true;
  }
  if (any) return best;
  bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const d = (NODES[i].x - x) ** 2 + (NODES[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function segmentClear(ax, az, bx, bz) {
  const steps = 8;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    for (let i = 0; i < BLOCKS.length; i++) {
      const b = BLOCKS[i];
      if (x > b.x0 - 0.28 && x < b.x1 + 0.28 && z > b.z0 - 0.28 && z < b.z1 + 0.28) return false;
    }
  }
  return true;
}

function pathIds(start, goal) {
  if (start === goal) return [start];
  parent.fill(-1);
  parent[start] = start;
  let qh = 0, qt = 0;
  queue[qt++] = start;
  while (qh < qt) {
    const cur = queue[qh++];
    const links = LINKS[cur];
    for (let i = 0; i < links.length; i++) {
      const n = links[i];
      if (parent[n] !== -1) continue;
      parent[n] = cur;
      if (n === goal) {
        const rev = [];
        let p = n;
        while (p !== start) { rev.push(p); p = parent[p]; }
        rev.push(start);
        rev.reverse();
        return rev;
      }
      queue[qt++] = n;
    }
  }
  return [start];
}

function put(pts, n, x, z, y, yaw) {
  const p = pts[n];
  p.x = x; p.z = z; p.y = y; p.yaw = yaw;
  return n + 1;
}

/** Copy a route from (x,z) to goal into pts. Returns the point count. */
export function writeRoute(pts, x, z, goal) {
  const ids = pathIds(nearest(x, z), nearest(goal.x, goal.z));
  let startAt = 0;
  for (let i = 0; i < ids.length; i++) {
    const node = NODES[ids[i]];
    if (segmentClear(x, z, node.x, node.z)) { startAt = i; break; }
  }
  let n = put(pts, 0, x, z, 0, 0);
  for (let i = startAt; i < ids.length; i++) {
    const node = NODES[ids[i]];
    const prev = pts[n - 1];
    if ((node.x - prev.x) ** 2 + (node.z - prev.z) ** 2 < 0.04) continue;
    if (!segmentClear(prev.x, prev.z, node.x, node.z)) continue;
    n = put(pts, n, node.x, node.z, 0, 0);
  }
  const prev = pts[n - 1];
  const gd = (goal.x - prev.x) ** 2 + (goal.z - prev.z) ** 2;
  if (gd > 0.02 && segmentClear(prev.x, prev.z, goal.x, goal.z)) n = put(pts, n, goal.x, goal.z, goal.y || 0, goal.yaw || 0);
  pts[n - 1].y = goal.y || 0;
  pts[n - 1].yaw = goal.yaw || 0;
  return n;
}

export function lingerPose(i, out) {
  const node = NODES[LINGER[i % LINGER.length]];
  out.x = node.x; out.z = node.z; out.y = 0; out.yaw = FACE_CAMERA;
  return out;
}

export function frontPose(i, out) {
  const node = NODES[FRONT[((i % FRONT.length) + FRONT.length) % FRONT.length]];
  const spread = ((i % 5) - 2) * 0.32;
  out.x = node.x + spread; out.z = node.z; out.y = 0; out.yaw = FACE_CAMERA;
  return out;
}

export const LINGER_COUNT = LINGER.length;

/** 0..1 slowdown when another bot is within 0.7 m ahead. others: {x,z} or actors with root.position. */
export function crowdScale(x, z, dirX, dirZ, others, selfId) {
  let s = 1;
  const reach = 0.7;
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    if (selfId != null && o.id === selfId) continue;
    const ox = o.root ? o.root.position.x : o.x;
    const oz = o.root ? o.root.position.z : o.z;
    const dx = ox - x, dz = oz - z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach || d2 < 1e-4) continue;
    if (dx * dirX + dz * dirZ <= 0) continue;
    const d = Math.sqrt(d2);
    if (d / reach < s) s = d / reach;
  }
  return s;
}

export function smoothRamp(along, len) {
  const edge = Math.min(along, Math.max(0, len - along));
  const t = edge / 0.35;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}
