// ASCII 맵 → 레벨 데이터. 손으로 만든 스테이지와 절차 생성 스테이지가 같은 파서를 쓴다.
//
// 범례
//   #  콘크리트 벽          (공백) 바깥(벽 취급)       .  바닥
//   =  석고보드 가벽(발로 뚫림)  D  문짝(발로 참)      L  잠긴 문(일반 신발로는 안 열림)
//   P  시작 지점            E  출구
//   g/s/u/r/b  적(권총/샷건/기관단총/로켓/브루저)
//   1/2/3/4    바닥에 놓인 무기(권총/샷건/기관단총/로켓 런처)
//   G  고압 가스관(인접한 벽에 붙는다)    C  천장 샹들리에

import { ENEMY_CODES, WEAPON_CODES } from '../config.js';

export const T = Object.freeze({ FLOOR: 0, WALL: 1, DRYWALL: 2, DOOR: 3, LOCKED: 4, VOID: 5 });

const FACING = { N: 0, W: Math.PI / 2, S: Math.PI, E: -Math.PI / 2 };
const DIRS = [
  ['N', 0, -1],
  ['E', 1, 0],
  ['S', 0, 1],
  ['W', -1, 0],
];

export function isSolidCode(t) {
  return t !== T.FLOOR;
}

export function parseLevel(def) {
  if (!def || !Array.isArray(def.rows) || def.rows.length === 0) {
    throw new Error(`레벨 ${def?.id ?? '?'}: rows가 비어 있다`);
  }
  const h = def.rows.length;
  const w = Math.max(...def.rows.map((r) => r.length));
  const tiles = new Uint8Array(w * h).fill(T.VOID);
  const at = (x, z) => (x < 0 || z < 0 || x >= w || z >= h ? T.VOID : tiles[z * w + x]);

  const out = {
    id: def.id,
    name: def.name ?? def.id,
    subtitle: def.subtitle ?? '',
    bpm: def.bpm,
    w,
    h,
    tiles,
    start: null,
    exit: null,
    enemies: [],
    doors: [],
    pipes: [],
    chandeliers: [],
    pickups: [],
    hints: (def.hints ?? []).map((hn) => ({ tx: hn.at[0], tz: hn.at[1], r: hn.r ?? 2.5, text: hn.text })),
    par: def.par ?? 60,
    challenge: def.challenge ?? null,
    palette: def.palette ?? [0xff2bd6, 0x2bf0ff],
    music: def.music ?? { seed: 1 },
  };

  const pending = [];
  for (let z = 0; z < h; z++) {
    const row = def.rows[z];
    for (let x = 0; x < w; x++) {
      const c = x < row.length ? row[x] : ' ';
      let t = T.FLOOR;
      switch (c) {
        case '#':
          t = T.WALL;
          break;
        case ' ':
          t = T.VOID;
          break;
        case '=':
          t = T.DRYWALL;
          break;
        case 'D':
          t = T.DOOR;
          pending.push(['door', x, z, false]);
          break;
        case 'L':
          t = T.LOCKED;
          pending.push(['door', x, z, true]);
          break;
        case '.':
          break;
        case 'P':
          if (out.start) throw new Error(`레벨 ${def.id}: 시작 지점(P)이 둘 이상`);
          out.start = { tx: x, tz: z, yaw: FACING[def.facing ?? 'N'] ?? 0 };
          break;
        case 'E':
          if (out.exit) throw new Error(`레벨 ${def.id}: 출구(E)가 둘 이상`);
          out.exit = { tx: x, tz: z };
          break;
        case 'G':
          pending.push(['pipe', x, z]);
          break;
        case 'C':
          out.chandeliers.push({ tx: x, tz: z });
          break;
        default:
          if (ENEMY_CODES[c]) out.enemies.push({ type: ENEMY_CODES[c], tx: x, tz: z });
          else if (WEAPON_CODES[c]) out.pickups.push({ weapon: WEAPON_CODES[c], tx: x, tz: z });
          else throw new Error(`레벨 ${def.id}: 알 수 없는 문자 '${c}' (${x},${z})`);
      }
      tiles[z * w + x] = t;
    }
  }

  if (!out.start) throw new Error(`레벨 ${def.id}: 시작 지점(P)이 없다`);
  if (!out.exit) throw new Error(`레벨 ${def.id}: 출구(E)가 없다`);

  for (const p of pending) {
    const [kind, x, z] = p;
    if (kind === 'door') {
      const solidLR = isSolidCode(at(x - 1, z)) && isSolidCode(at(x + 1, z));
      const solidUD = isSolidCode(at(x, z - 1)) && isSolidCode(at(x, z + 1));
      const openLR = !isSolidCode(at(x - 1, z)) && !isSolidCode(at(x + 1, z));
      const openUD = !isSolidCode(at(x, z - 1)) && !isSolidCode(at(x, z + 1));
      let axis;
      if (solidLR && openUD) axis = 'x';
      else if (solidUD && openLR) axis = 'z';
      else throw new Error(`레벨 ${def.id}: 문 (${x},${z})은 벽 사이에 끼고 양쪽이 트여 있어야 한다`);
      out.doors.push({ tx: x, tz: z, axis, locked: p[3] });
    } else if (kind === 'pipe') {
      const d = DIRS.find(([, dx, dz]) => at(x + dx, z + dz) === T.WALL);
      if (!d) throw new Error(`레벨 ${def.id}: 가스관 (${x},${z}) 옆에 콘크리트 벽이 없다`);
      out.pipes.push({ tx: x, tz: z, dir: d[0] });
    }
  }
  return out;
}

// 4방향 BFS. passable(t)로 통과 규칙을 정한다. 반환: 거리 배열(-1 = 도달 불가)
export function bfs(level, sx, sz, passable) {
  const { w, h, tiles } = level;
  const dist = new Int32Array(w * h).fill(-1);
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  dist[sz * w + sx] = 0;
  q[tail++] = sz * w + sx;
  while (head < tail) {
    const i = q[head++];
    const x = i % w;
    const z = (i / w) | 0;
    for (const [, dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      const j = nz * w + nx;
      if (dist[j] !== -1 || !passable(tiles[j])) continue;
      dist[j] = dist[i] + 1;
      q[tail++] = j;
    }
  }
  return dist;
}

// 기본 신발 기준 클리어 가능성 검사: 문·가벽은 통과, 잠긴 문은 막힘.
export function validateLevel(level) {
  const problems = [];
  const pass = (t) => t === T.FLOOR || t === T.DOOR || t === T.DRYWALL;
  const dist = bfs(level, level.start.tx, level.start.tz, pass);
  const idx = (x, z) => z * level.w + x;
  if (dist[idx(level.exit.tx, level.exit.tz)] < 0) problems.push('출구에 도달할 수 없다');
  level.enemies.forEach((e) => {
    if (dist[idx(e.tx, e.tz)] < 0) problems.push(`적 ${e.type} (${e.tx},${e.tz})에 도달할 수 없다`);
  });
  level.pickups.forEach((p) => {
    if (dist[idx(p.tx, p.tz)] < 0) problems.push(`무기 ${p.weapon} (${p.tx},${p.tz})에 도달할 수 없다`);
  });
  // 바깥 테두리가 막혀 있어야 한다(플레이어가 맵 밖으로 나가지 않도록)
  for (let x = 0; x < level.w; x++) {
    for (const z of [0, level.h - 1]) if (level.tiles[idx(x, z)] === T.FLOOR) problems.push(`테두리 (${x},${z})가 열려 있다`);
  }
  for (let z = 0; z < level.h; z++) {
    for (const x of [0, level.w - 1]) if (level.tiles[idx(x, z)] === T.FLOOR) problems.push(`테두리 (${x},${z})가 열려 있다`);
  }
  return problems;
}
