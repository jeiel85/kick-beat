// 절차 생성 스테이지. 시드·BPM·구간별 에너지(0~1)를 받아 parse.js가 읽는 ASCII 맵 정의를 만든다.
// 커스텀 음악 모드에서는 곡의 구간 에너지가 방마다의 적 밀도가 된다(드롭 구간 = 적이 몰린 방).

import { mulberry32 } from './rng.js';

const PALETTES = [
  [0xff2bd6, 0x2bf0ff],
  [0x8a2bff, 0xff2b6a],
  [0x2bffb0, 0xffd12b],
  [0x2b8cff, 0x2bfff0],
  [0xffc42b, 0xff2b5e],
  [0xff5a1f, 0x7a2bff],
];

const MW = 4; // 매크로 격자 가로 칸 수
const MH = 3; // 세로 칸 수

function macroPath(rng, n) {
  // 자기 자신을 피하는 무작위 경로(백트래킹 DFS). 4x3 격자에서 n ≤ 12는 항상 찾을 수 있다.
  const start = [rng.int(0, MW - 1), rng.int(0, MH - 1)];
  const seen = new Set([start.join(',')]);
  const path = [start];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let budget = 20000;
  function dfs() {
    if (path.length === n) return true;
    if (--budget < 0) return false;
    const [ci, cj] = path[path.length - 1];
    const order = dirs.slice().sort(() => rng.next() - 0.5);
    for (const [di, dj] of order) {
      const ni = ci + di;
      const nj = cj + dj;
      const key = `${ni},${nj}`;
      if (ni < 0 || nj < 0 || ni >= MW || nj >= MH || seen.has(key)) continue;
      seen.add(key);
      path.push([ni, nj]);
      if (dfs()) return true;
      path.pop();
      seen.delete(key);
    }
    return false;
  }
  if (!dfs()) {
    // 예산 초과 시 뱀 모양 경로로 대체(항상 유효)
    path.length = 0;
    for (let j = 0; j < MH && path.length < n; j++) {
      for (let k = 0; k < MW && path.length < n; k++) path.push([j % 2 === 0 ? k : MW - 1 - k, j]);
    }
  }
  return path;
}

function weightedPick(rng, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

/**
 * @param {{seed:number, bpm:number, energies:number[], name?:string, id?:string, difficulty?:number}} opts
 */
export function generateStage(opts) {
  const rng = mulberry32(opts.seed);
  const energies = opts.energies.length ? opts.energies : [0.5];
  const n = Math.max(4, Math.min(10, energies.length));
  const energyAt = (k) => energies[Math.min(energies.length - 1, Math.floor((k / n) * energies.length))];
  const difficulty = opts.difficulty ?? 1;

  const path = macroPath(rng, n);
  const cw = Array.from({ length: MW }, () => rng.int(6, 9));
  const rh = Array.from({ length: MH }, () => rng.int(5, 7));
  const X0 = [];
  const Z0 = [];
  let acc = 1;
  for (let i = 0; i < MW; i++) {
    X0.push(acc);
    acc += cw[i] + 1;
  }
  const W = acc;
  acc = 1;
  for (let j = 0; j < MH; j++) {
    Z0.push(acc);
    acc += rh[j] + 1;
  }
  const H = acc;

  const g = Array.from({ length: H }, () => Array(W).fill('#'));
  const rect = ([i, j]) => ({ x0: X0[i], z0: Z0[j], x1: X0[i] + cw[i] - 1, z1: Z0[j] + rh[j] - 1 });
  for (const cell of path) {
    const r = rect(cell);
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) g[z][x] = '.';
  }

  const openings = path.map(() => []); // 방마다 출입구 타일 목록(적 배치 시 피함)
  function connect(ka, kb, forceDoor) {
    const [ai, aj] = path[ka];
    const [bi, bj] = path[kb];
    const ra = rect(path[ka]);
    const horizontal = aj === bj;
    let cells; // 벽선 위 후보 좌표
    if (horizontal) {
      const x = ai < bi ? ra.x1 + 1 : ra.x0 - 1;
      cells = [];
      for (let z = ra.z0; z <= ra.z1; z++) cells.push([x, z]);
    } else {
      const z = aj < bj ? ra.z1 + 1 : ra.z0 - 1;
      cells = [];
      for (let x = ra.x0; x <= ra.x1; x++) cells.push([x, z]);
    }
    const mid = cells.slice(1, -1);
    const pickIdx = rng.int(0, mid.length - 1);
    const [cx, cz] = mid[pickIdx];
    const roll = rng.next();
    let kind = forceDoor ? 'door' : roll < 0.55 ? 'door' : roll < 0.75 ? 'drywall' : 'locked';
    if (kind === 'locked') {
      const far = mid.filter((_, k) => Math.abs(k - pickIdx) >= 2);
      if (!far.length) kind = 'door';
      else {
        const [dx, dz] = rng.pick(far);
        g[cz][cx] = 'L';
        g[dz][dx] = '=';
        openings[ka].push([dx, dz], [cx, cz]);
        openings[kb].push([dx, dz], [cx, cz]);
        return;
      }
    }
    if (kind === 'drywall') {
      g[cz][cx] = '=';
      const k2 = pickIdx + 1 < mid.length ? pickIdx + 1 : pickIdx - 1;
      if (k2 >= 0) {
        const [x2, z2] = mid[k2];
        g[z2][x2] = '=';
      }
    } else {
      g[cz][cx] = 'D';
    }
    openings[ka].push([cx, cz]);
    openings[kb].push([cx, cz]);
  }

  for (let k = 0; k + 1 < n; k++) connect(k, k + 1, k === 0);
  // 지름길(경로상 이웃이 아닌 인접 방) — 루트 선택지를 늘린다
  for (let a = 0; a < n; a++) {
    for (let b = a + 2; b < n; b++) {
      const [ai, aj] = path[a];
      const [bi, bj] = path[b];
      if (Math.abs(ai - bi) + Math.abs(aj - bj) === 1 && rng.chance(0.3)) connect(a, b, false);
    }
  }

  const occupied = new Set();
  const key = (x, z) => `${x},${z}`;
  const nearOpening = (k, x, z, d) => openings[k].some(([ox, oz]) => Math.abs(ox - x) + Math.abs(oz - z) <= d);
  function freeTiles(k, minOpen) {
    const r = rect(path[k]);
    const out = [];
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (g[z][x] !== '.' || occupied.has(key(x, z)) || nearOpening(k, x, z, minOpen)) continue;
        out.push([x, z]);
      }
    }
    return out;
  }
  function place(k, c, minOpen = 2) {
    const free = freeTiles(k, minOpen);
    if (!free.length) return null;
    const [x, z] = rng.pick(free);
    g[z][x] = c;
    occupied.add(key(x, z));
    return [x, z];
  }

  // 기둥·칸막이: 큰 방에만, 벽에서 한 칸 떨어뜨려 길을 막지 않는다
  for (let k = 1; k < n - 1; k++) {
    const r = rect(path[k]);
    if (r.x1 - r.x0 >= 6 && r.z1 - r.z0 >= 4 && rng.chance(0.4)) {
      const cnt = rng.int(1, 2);
      for (let c = 0; c < cnt; c++) {
        const x = rng.int(r.x0 + 2, r.x1 - 2);
        const z = rng.int(r.z0 + 2, r.z1 - 2);
        if (g[z][x] === '.' && !nearOpening(k, x, z, 2)) {
          g[z][x] = rng.chance(0.5) ? '#' : '=';
          occupied.add(key(x, z));
        }
      }
    }
  }

  // 시작 방
  const sr = rect(path[0]);
  const px = Math.floor((sr.x0 + sr.x1) / 2);
  const pz = Math.floor((sr.z0 + sr.z1) / 2);
  g[pz][px] = 'P';
  occupied.add(key(px, pz));
  const [n0i, n0j] = path[1];
  const [s0i, s0j] = path[0];
  const facing = n0i > s0i ? 'E' : n0i < s0i ? 'W' : n0j > s0j ? 'S' : 'N';
  place(0, '1', 1);

  // 출구: 마지막 방에서 입구로부터 가장 먼 타일
  const er = rect(path[n - 1]);
  let best = null;
  for (let z = er.z0; z <= er.z1; z++) {
    for (let x = er.x0; x <= er.x1; x++) {
      if (g[z][x] !== '.') continue;
      const d = Math.min(...openings[n - 1].map(([ox, oz]) => Math.abs(ox - x) + Math.abs(oz - z)));
      if (!best || d > best[2]) best = [x, z, d];
    }
  }
  g[best[1]][best[0]] = 'E';
  occupied.add(key(best[0], best[1]));

  // 적·기믹
  let enemyTotal = 0;
  for (let k = 1; k < n; k++) {
    const e = Math.max(0, Math.min(1, energyAt(k)));
    const ramp = 0.7 + (0.6 * k) / (n - 1);
    const r = rect(path[k]);
    const area = (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1);
    const count = Math.max(1, Math.min(Math.floor(area / 7), Math.round((1 + e * 3.2 * ramp) * difficulty)));
    const pool = [
      ['g', 4],
      ['s', k >= 1 ? 2 : 0],
      ['u', k >= 2 ? 2 : 0],
      ['r', k >= 2 ? 1.4 : 0],
      ['b', k >= 3 ? 1 : 0],
    ].filter(([, w]) => w > 0);
    for (let c = 0; c < count; c++) {
      if (place(k, weightedPick(rng, pool))) enemyTotal++;
    }
    if (rng.chance(0.35)) {
      // 가스관: 콘크리트 벽에 붙은 바닥 타일
      const cands = freeTiles(k, 2).filter(([x, z]) => [g[z - 1][x], g[z + 1][x], g[z][x - 1], g[z][x + 1]].includes('#'));
      if (cands.length) {
        const [x, z] = rng.pick(cands);
        g[z][x] = 'G';
        occupied.add(key(x, z));
      }
    }
    if (rng.chance(0.3)) {
      const cx = Math.floor((r.x0 + r.x1) / 2);
      const cz = Math.floor((r.z0 + r.z1) / 2);
      if (g[cz][cx] === '.') {
        g[cz][cx] = 'C';
        occupied.add(key(cx, cz));
      }
    }
  }

  return {
    id: opts.id ?? `gen-${opts.seed}`,
    name: opts.name ?? `랜덤 레이드 #${opts.seed}`,
    subtitle: `${Math.round(opts.bpm)} BPM · ${n}개 방`,
    bpm: opts.bpm,
    facing,
    par: Math.round(n * 9 + enemyTotal * 2.6),
    challenge: { type: 'perfect', n: Math.max(4, Math.round(n * 1.2)), label: `PERFECT 발차기 ${Math.max(4, Math.round(n * 1.2))}회` },
    palette: PALETTES[opts.seed % PALETTES.length],
    music: { seed: opts.seed, root: 40 + (opts.seed % 6) },
    hints: [],
    rows: g.map((row) => row.join('')),
  };
}
