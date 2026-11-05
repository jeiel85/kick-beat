// 타일 격자 위의 충돌·광선·시야 판정. 플레이어와 살아 있는 적은 물리 엔진 대신 이 격자로 움직인다(반응이 즉각적이고 결정적).

import { DOOR_SLAB, TILE } from '../config.js';
import { T } from '../levels/parse.js';

export class Grid {
  constructor(level) {
    this.w = level.w;
    this.h = level.h;
    this.tiles = level.tiles.slice();
    this.doorAxis = new Map();
    for (const d of level.doors) this.doorAxis.set(d.tz * this.w + d.tx, d.axis);
    this.version = 0; // 맵이 바뀔 때마다 증가(경로 탐색 캐시 무효화)
    this.props = []; // 타일 밖 소품 AABB(스피커 등) — 이동 충돌에만 쓴다
  }

  get(tx, tz) {
    if (tx < 0 || tz < 0 || tx >= this.w || tz >= this.h) return T.VOID;
    return this.tiles[tz * this.w + tx];
  }

  setFloor(tx, tz) {
    this.tiles[tz * this.w + tx] = T.FLOOR;
    this.version++;
  }

  static tileOf(v) {
    return Math.floor(v / TILE);
  }

  static center(t) {
    return (t + 0.5) * TILE;
  }

  passable(tx, tz) {
    return this.get(tx, tz) === T.FLOOR;
  }

  // 타일 안의 고체 부분 AABB(문은 가운데의 얇은 판)
  tileBox(tx, tz) {
    const t = this.get(tx, tz);
    if (t === T.FLOOR) return null;
    const x0 = tx * TILE;
    const z0 = tz * TILE;
    if (t === T.DOOR || t === T.LOCKED) {
      const axis = this.doorAxis.get(tz * this.w + tx);
      const c = axis === 'x' ? z0 + TILE / 2 : x0 + TILE / 2;
      if (axis === 'x') return { minX: x0, maxX: x0 + TILE, minZ: c - DOOR_SLAB, maxZ: c + DOOR_SLAB };
      return { minX: c - DOOR_SLAB, maxX: c + DOOR_SLAB, minZ: z0, maxZ: z0 + TILE };
    }
    return { minX: x0, maxX: x0 + TILE, minZ: z0, maxZ: z0 + TILE };
  }

  pointBlocked(x, z) {
    const b = this.tileBox(Grid.tileOf(x), Grid.tileOf(z));
    return !!b && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  // 원(반지름 r)을 벽 밖으로 밀어낸다. pos {x,z}를 직접 수정하고 충돌 여부를 반환
  collideCircle(pos, r) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const tx0 = Grid.tileOf(pos.x - r);
      const tx1 = Grid.tileOf(pos.x + r);
      const tz0 = Grid.tileOf(pos.z - r);
      const tz1 = Grid.tileOf(pos.z + r);
      const boxes = [];
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const b = this.tileBox(tx, tz);
          if (b) boxes.push(b);
        }
      }
      for (const b of this.props) {
        if (b.maxX > pos.x - r && b.minX < pos.x + r && b.maxZ > pos.z - r && b.minZ < pos.z + r) boxes.push(b);
      }
      {
        for (const b of boxes) {
          const cx = Math.min(Math.max(pos.x, b.minX), b.maxX);
          const cz = Math.min(Math.max(pos.z, b.minZ), b.maxZ);
          const dx = pos.x - cx;
          const dz = pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          hit = true;
          moved = true;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            pos.x += (dx / d) * (r - d);
            pos.z += (dz / d) * (r - d);
          } else {
            // 중심이 상자 안: 가장 얕은 축으로 밀어낸다
            const pushes = [
              [b.minX - r - pos.x, 0],
              [b.maxX + r - pos.x, 0],
              [0, b.minZ - r - pos.z],
              [0, b.maxZ + r - pos.z],
            ];
            pushes.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
            pos.x += pushes[0][0];
            pos.z += pushes[0][1];
          }
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  /**
   * 수평면 광선. (dx,dz)는 정규화된 방향. 반환: {dist, tx, tz, tile} 또는 maxDist까지 막힘 없으면 null
   */
  raycast(ox, oz, dx, dz, maxDist) {
    let tx = Grid.tileOf(ox);
    let tz = Grid.tileOf(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(TILE / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (tx + 1) * TILE : tx * TILE) - ox) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (tz + 1) * TILE : tz * TILE) - oz) / dz : Infinity;
    let tEnter = 0;
    for (let guard = 0; guard < 512; guard++) {
      if (tEnter > maxDist) return null;
      const b = this.tileBox(tx, tz);
      if (b) {
        const hitT = rayBox(ox, oz, dx, dz, b, tEnter, Math.min(tMaxX, tMaxZ));
        if (hitT !== null && hitT <= maxDist) return { dist: hitT, tx, tz, tile: this.get(tx, tz) };
      }
      if (tMaxX < tMaxZ) {
        tEnter = tMaxX;
        tMaxX += tDeltaX;
        tx += stepX;
      } else {
        tEnter = tMaxZ;
        tMaxZ += tDeltaZ;
        tz += stepZ;
      }
    }
    return null;
  }

  los(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return true;
    return this.raycast(ax, az, dx / d, dz / d, d - 0.05) === null;
  }
}

function rayBox(ox, oz, dx, dz, b, tLo, tHi) {
  let t0 = tLo - 1e-6;
  let t1 = tHi + 1e-6;
  if (dx !== 0) {
    let a = (b.minX - ox) / dx;
    let c = (b.maxX - ox) / dx;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
  } else if (ox < b.minX || ox > b.maxX) return null;
  if (dz !== 0) {
    let a = (b.minZ - oz) / dz;
    let c = (b.maxZ - oz) / dz;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
  } else if (oz < b.minZ || oz > b.maxZ) return null;
  return t0 <= t1 ? Math.max(0, t0) : null;
}

// 4방향 BFS 거리장(플레이어 타일 기준). 적은 값이 작아지는 이웃으로 이동한다.
export function flowField(grid, sx, sz) {
  const { w, h } = grid;
  const dist = new Int16Array(w * h).fill(-1);
  if (!grid.passable(sx, sz)) return dist;
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  dist[sz * w + sx] = 0;
  q[tail++] = sz * w + sx;
  while (head < tail) {
    const i = q[head++];
    const x = i % w;
    const z = (i / w) | 0;
    const nd = dist[i] + 1;
    if (x > 0 && dist[i - 1] < 0 && grid.tiles[i - 1] === T.FLOOR) (dist[i - 1] = nd), (q[tail++] = i - 1);
    if (x < w - 1 && dist[i + 1] < 0 && grid.tiles[i + 1] === T.FLOOR) (dist[i + 1] = nd), (q[tail++] = i + 1);
    if (z > 0 && dist[i - w] < 0 && grid.tiles[i - w] === T.FLOOR) (dist[i - w] = nd), (q[tail++] = i - w);
    if (z < h - 1 && dist[i + w] < 0 && grid.tiles[i + w] === T.FLOOR) (dist[i + w] = nd), (q[tail++] = i + w);
  }
  return dist;
}
