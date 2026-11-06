// 커스텀 음악 비트 분석: 저역(킥 드럼) 에너지의 온셋 → 자기상관으로 템포 후보 → 위상 접기(fold)로 BPM·첫 박 정밀화.
// 찾은 격자가 곡 전체에서 맞는지(중간에 템포가 바뀌지 않는지)도 창별로 확인한다. 순수 함수라 Node 테스트에서 합성 신호로 검증한다.

const HOP_SEC = 0.01;
const FOLD_BINS = 96;
export const BPM_MIN = 75;
export const BPM_MAX = 200;

function lowpassEnergy(samples, sampleRate, hop) {
  // 160Hz 1극 저역 통과 2단 → 킥 드럼 대역 에너지
  const a = 1 - Math.exp((-2 * Math.PI * 160) / sampleRate);
  let y1 = 0;
  let y2 = 0;
  const frames = Math.floor(samples.length / hop);
  const low = new Float32Array(frames);
  const full = new Float32Array(frames);
  let i = 0;
  for (let f = 0; f < frames; f++) {
    let sl = 0;
    let sf = 0;
    for (let k = 0; k < hop; k++, i++) {
      const x = samples[i];
      y1 += a * (x - y1);
      y2 += a * (y1 - y2);
      sl += y2 * y2;
      sf += x * x;
    }
    low[f] = sl / hop;
    full[f] = sf / hop;
  }
  return { low, full };
}

function onsetEnvelope(env) {
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length || 1;
  if (!(mean > 1e-10)) return null;
  const c = 50 / mean;
  const n = env.length;
  const on = new Float32Array(n);
  let prev = Math.log1p(c * env[0]);
  for (let i = 1; i < n; i++) {
    const l = Math.log1p(c * env[i]);
    on[i] = Math.max(0, l - prev);
    prev = l;
  }
  // 적응형 임계: 0.3초 이동 평균을 빼서 지속음의 완만한 변화 제거
  const win = 15;
  const out = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += on[i];
    if (i - 2 * win - 1 >= 0) sum -= on[i - 2 * win - 1];
    const center = i - win;
    if (center >= 0) {
      const count = Math.min(i + 1, 2 * win + 1);
      out[center] = Math.max(0, on[center] - (sum / count) * 1.1);
    }
  }
  return out;
}

function tempoPrior(bpm) {
  const d = Math.log2(bpm / 145) / 0.7;
  return Math.exp(-0.5 * d * d);
}

// 주어진 BPM으로 온셋을 한 주기 위에 접었을 때 얼마나 한곳에 몰리는가(정확한 템포일수록 뾰족)
function foldScore(on, bpm, hopSec, bins = FOLD_BINS) {
  const P = 60 / bpm / hopSec; // 프레임 단위 주기(실수)
  const hist = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < on.length; i++) {
    const v = on[i];
    if (v === 0) continue;
    const ph = (i % P) / P;
    hist[Math.floor(ph * bins) % bins] += v;
    total += v;
  }
  // 원형 평활 [1,2,1]
  let best = -1;
  let bestBin = 0;
  const sm = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    sm[b] = hist[(b - 1 + bins) % bins] + 2 * hist[b] + hist[(b + 1) % bins];
    if (sm[b] > best) {
      best = sm[b];
      bestBin = b;
    }
  }
  const mean = (4 * total) / bins;
  // 포물선 보간으로 정점 위치를 빈 이하 정밀도로
  const l = sm[(bestBin - 1 + bins) % bins];
  const r = sm[(bestBin + 1) % bins];
  const denom = l - 2 * best + r;
  const shift = denom !== 0 ? (0.5 * (l - r)) / denom : 0;
  const phase = (((bestBin + 0.5 + shift) / bins) % 1 + 1) % 1;
  return { score: mean > 0 ? best / mean : 0, phase, sm };
}

function autocorrCandidates(on, maxFrames, hopSec) {
  const n = Math.min(on.length, maxFrames);
  const lagMin = Math.floor(60 / BPM_MAX / hopSec) - 1;
  const lagMax = Math.ceil(60 / (BPM_MIN / 2) / hopSec) + 1;
  const ac = new Float64Array(lagMax + 2);
  for (let L = lagMin; L <= lagMax + 1; L++) {
    let s = 0;
    for (let i = 0; i + L < n; i++) s += on[i] * on[i + L];
    ac[L] = s / (n - L);
  }
  const peaks = [];
  for (let L = lagMin + 1; L <= lagMax; L++) {
    if (ac[L] > ac[L - 1] && ac[L] >= ac[L + 1] && ac[L] > 0) peaks.push({ L, v: ac[L] });
  }
  peaks.sort((a, b) => b.v - a.v);
  return peaks.slice(0, 4).map((p) => 60 / (p.L * hopSec));
}

function foldBest(on, lo, hi, step, hopSec) {
  let best = { score: -1, bpm: lo, phase: 0 };
  for (let bpm = lo; bpm <= hi + 1e-9; bpm += step) {
    const r = foldScore(on, bpm, hopSec);
    if (r.score > best.score) best = { score: r.score, bpm, phase: r.phase };
  }
  return best;
}

// ───────── 템포 안정성 ─────────
// 격자는 BPM 하나로 곡 끝까지 이어지므로, 곡 중간에 템포가 바뀌거나 흔들리면 그 뒤 박이 어긋난다.
// 곡 전체를 창으로 나눠 창마다 두 가지를 본다.
//  ① 템포: 온셋을 8분음표 주기로 접은 원형 평균 크기(한 위상에 몰리면 1, 흩어지면 0)가 창 안에서 가장 잘 맞는
//     템포보다 크게 낮으면 템포가 다르다. 8분음표 기준이라 하프타임(박 하나 건너)·더블타임(반박 추가)은 맞는 것으로 본다.
//  ② 위상: 템포가 같아도 박이 밀렸으면(흔들림·멈춤 뒤 재시작) 접은 히스토그램의 박·반박 자리에 봉우리가 없다.
const STAB_WIN_SEC = 16;
const STAB_HOP_SEC = 8;
const STAB_TOL_SEC = 0.035; // 격자 자리 허용 오차(PERFECT ±50ms의 70%)
const STAB_CLEAR = 0.4; // 창 안 최적 템포의 원형 평균이 이 미만이면 박이 뚜렷하지 않은 구간 → 판단 보류
const STAB_FIT = 0.5; // 찾은 격자의 원형 평균이 창 안 최적 템포의 이 비율 미만이면 템포가 다르다
const STAB_ON_GRID = 0.5; // 박·반박 자리 봉우리가 히스토그램 정점의 이 비율 미만이면 박이 밀렸다
const STAB_QUIET = 0.25; // 창 온셋 총량이 곡 중앙값의 이 비율 미만이면 조용한 구간으로 보고 건너뛴다
const STAB_RUN = 2; // 연속으로 이만큼 어긋난 창이 나와야 경고(필인·전환 한두 마디는 무시)
const STAB_BINS = 64;
const STAB_COS = Float64Array.from({ length: STAB_BINS }, (_, b) => Math.cos((2 * Math.PI * (b + 0.5)) / STAB_BINS));
const STAB_SIN = Float64Array.from({ length: STAB_BINS }, (_, b) => Math.sin((2 * Math.PI * (b + 0.5)) / STAB_BINS));

// 8분음표 주기 Q(프레임)로 접은 온셋의 원형 평균 크기. 박·반박 어디에 몰려도 같은 위상이 된다.
// 히스토그램으로 모아 계산해 템포 후보 수백 개를 훑어도 싸다.
function eighthFit(seg, Q, hist) {
  hist.fill(0);
  let tot = 0;
  for (let i = 0; i < seg.length; i++) {
    const v = seg[i];
    if (v === 0) continue;
    hist[Math.floor(((i % Q) / Q) * STAB_BINS) % STAB_BINS] += v;
    tot += v;
  }
  let re = 0;
  let im = 0;
  for (let b = 0; b < STAB_BINS; b++) {
    re += hist[b] * STAB_COS[b];
    im += hist[b] * STAB_SIN[b];
  }
  return tot > 0 ? Math.hypot(re, im) / tot : 0;
}

/**
 * @returns {{tempoStable:boolean, unstableFrom:number|null, fitRatio:number}}
 *   unstableFrom: 격자가 음악과 어긋나기 시작하는 대략의 시각(초). fitRatio: 박이 뚜렷한 창 중 격자와 맞는 비율.
 */
export function tempoStability(on, hopSec, bpm, offset) {
  const P = 60 / bpm / hopSec; // 박 주기(프레임)
  const expect = ((offset / hopSec / P) % 1 + 1) % 1; // 곡 전체 기준 첫 박의 위상
  const tolPh = STAB_TOL_SEC / hopSec / P;
  const winF = Math.round(STAB_WIN_SEC / hopSec);
  const hopF = Math.round(STAB_HOP_SEC / hopSec);
  const n = on.length;
  const starts = [];
  for (let a = 0; a + winF <= n; a += hopF) starts.push(a);
  if (starts.length === 0) starts.push(0);
  else if (n - (starts[starts.length - 1] + winF) > hopF / 2) starts.push(n - winF);

  const wins = starts.map((a) => {
    const seg = on.subarray(a, a + winF);
    let tot = 0;
    for (let i = 0; i < seg.length; i++) tot += seg[i];
    return { a, seg, tot };
  });
  const tots = wins.map((w) => w.tot).sort((x, y) => x - y);
  const median = tots[Math.floor(tots.length / 2)];
  const hist = new Float64Array(STAB_BINS);

  let clear = 0;
  let bad = 0;
  let run = 0;
  let runStart = 0;
  let unstableFrom = null;
  for (let w = 0; w < wins.length; w++) {
    const { a, seg, tot } = wins[w];
    if (!(tot > 0) || tot < median * STAB_QUIET) continue;
    let best = 0;
    for (let b = BPM_MIN * 0.97; b <= BPM_MAX * 1.03; b += 0.5) best = Math.max(best, eighthFit(seg, 30 / b / hopSec, hist));
    if (best < STAB_CLEAR) continue; // 박이 뚜렷하지 않은 구간(앰비언트·브레이크)은 판단하지 않는다
    clear++;
    let off = eighthFit(seg, P / 2, hist) < best * STAB_FIT; // ①
    if (!off) {
      // ② 창 첫 프레임 기준으로 옮긴 박·반박 자리 근처에 봉우리가 있는가
      const g = foldScore(seg, bpm, hopSec);
      const e = (((expect - (a % P) / P) % 1) + 1) % 1;
      const bins = g.sm.length;
      let peak = 0;
      let onGrid = 0;
      for (let b = 0; b < bins; b++) {
        peak = Math.max(peak, g.sm[b]);
        let d = ((b + 0.5) / bins - e) * 2; // 반박 주기 단위 → 박·반박 둘 다 정수
        d = Math.abs(d - Math.round(d)) / 2;
        if (d <= tolPh) onGrid = Math.max(onGrid, g.sm[b]);
      }
      off = onGrid < peak * STAB_ON_GRID;
    }
    if (!off) {
      run = 0;
      continue;
    }
    bad++;
    if (run++ === 0) runStart = w;
    if (run === STAB_RUN && unstableFrom === null) {
      // 앞 창이 맞았다면 바뀐 지점은 두 창이 겹치는 구간 어딘가 → 그 가운데로 어림
      unstableFrom = runStart === 0 ? 0 : (wins[runStart].a + (winF - hopF) / 2) * hopSec;
    }
  }
  return { tempoStable: unstableFrom === null, unstableFrom, fitRatio: clear ? (clear - bad) / clear : 1 };
}

/**
 * @param {Float32Array} samples 모노 PCM
 * @param {number} sampleRate
 * @returns {{bpm:number, offset:number, confidence:number, duration:number, energies:number[], loopStart:number, loopEnd:number, tempoStable:boolean, unstableFrom:number|null}}
 *   tempoStable=false면 곡 일부(대략 unstableFrom초부터, 0이면 앞부분)가 격자와 맞지 않는다 — tempoStability 참고
 */
export function analyzeBeats(samples, sampleRate, { sections = 12 } = {}) {
  const duration = samples.length / sampleRate;
  if (duration < 8) throw new Error('곡이 너무 짧다(8초 이상 필요)');
  const hop = Math.max(1, Math.round(sampleRate * HOP_SEC));
  const hopSec = hop / sampleRate; // 반올림된 실제 홉 길이로 계산해야 템포가 0.2%씩 틀어지지 않는다
  const { low, full } = lowpassEnergy(samples, sampleRate, hop);
  const on = onsetEnvelope(low);
  if (!on) throw new Error('소리가 거의 없다 — 비트를 찾지 못했다');

  // 분석은 최대 3분 구간으로(긴 곡도 몇 초 안에 끝나도록)
  const maxFrames = Math.round(180 / hopSec);
  const onA = on.length > maxFrames ? on.subarray(0, maxFrames) : on;

  const raw = autocorrCandidates(onA, Math.round(60 / hopSec), hopSec);
  const cands = new Set();
  for (const b of raw) {
    for (const m of [0.5, 1, 2]) {
      const v = b * m;
      if (v >= BPM_MIN * 0.97 && v <= BPM_MAX * 1.03) cands.add(Math.round(v * 10) / 10);
    }
  }
  if (cands.size === 0) throw new Error('일정한 박자를 찾지 못했다');

  let best = null;
  for (const c of cands) {
    const coarse = foldBest(onA, c * 0.97, c * 1.03, 0.1, hopSec);
    const fine = foldBest(onA, coarse.bpm - 0.12, coarse.bpm + 0.12, 0.01, hopSec);
    const weighted = fine.score * tempoPrior(fine.bpm);
    if (!best || weighted > best.weighted) best = { ...fine, weighted };
  }

  let bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, best.bpm));
  const period = 60 / bpm;
  // phase는 프레임 i의 위상. 프레임 i의 에너지 상승 = 그 프레임 안에서 시작된 타격이므로 프레임 시작 시각을 쓴다.
  let offset = best.phase * period;
  offset = ((offset % period) + period) % period;

  // 구간별 에너지(전대역 RMS) → 0~1 정규화
  const energies = [];
  const per = Math.max(1, Math.floor(full.length / sections));
  for (let s = 0; s < sections; s++) {
    let sum = 0;
    let cnt = 0;
    for (let i = s * per; i < Math.min(full.length, (s + 1) * per); i++) {
      sum += full[i];
      cnt++;
    }
    energies.push(cnt ? Math.sqrt(sum / cnt) : 0);
  }
  const sorted = [...energies].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.floor(sorted.length * 0.95)] || lo + 1e-6;
  const norm = energies.map((e) => Math.max(0, Math.min(1, (e - lo) / Math.max(1e-9, hi - lo))));

  const loopStart = offset;
  const beats = Math.floor((duration - offset) / period);
  const loopEnd = offset + beats * period;
  bpm = Math.round(bpm * 100) / 100;
  // 격자 판정은 곡 전체(3분 이후 포함)에 대해, 게임이 실제로 쓰는 반올림된 BPM으로 한다
  const { tempoStable, unstableFrom, fitRatio } = tempoStability(on, hopSec, bpm, offset);
  // 접기 점수는 맞는 구간만으로도 높게 나오므로, 템포가 바뀌는 곡은 격자와 맞는 구간 비율만큼 낮춘다
  const confidence = Math.max(0, Math.min(1, (best.score - 1.5) / 4)) * (tempoStable ? 1 : fitRatio);
  return { bpm, offset, confidence, duration, energies: norm, loopStart, loopEnd, tempoStable, unstableFrom };
}
