// 고스트 타임어택: 플레이 궤적을 20Hz로 기록·압축하고, 다음 판에 반투명 잔영으로 재생한다.
// 파일로 내보내 친구와 주고받으면 비동기 레이스가 된다.

import { GHOST_HZ } from '../config.js';

export const GHOST_FORMAT = 'kickbeat-ghost';
export const GHOST_VERSION = 1;

export class GhostRecorder {
  constructor() {
    this.samples = []; // [x*100, z*100, yaw*1000] 정수 평탄 배열
    this.kicks = [];
    this.acc = 0;
  }

  // gameTime 기준으로 고정 간격 샘플링
  record(dt, x, z, yaw) {
    const step = 1 / GHOST_HZ;
    if (this.samples.length === 0) {
      // 첫 샘플 = 0초. 이 프레임의 dt까지 누적하면 같은 위치가 두 번 들어가 재생이 한 칸 늦어진다
      this._push(x, z, yaw);
      return;
    }
    this.acc += dt;
    while (this.acc >= step) {
      this.acc -= step;
      this._push(x, z, yaw);
    }
  }

  markKick() {
    this.kicks.push(Math.max(0, this.samples.length / 3 - 1));
  }

  _push(x, z, yaw) {
    this.samples.push(Math.round(x * 100), Math.round(z * 100), Math.round(wrapAngle(yaw) * 1000));
  }

  finish(meta) {
    return {
      format: GHOST_FORMAT,
      version: GHOST_VERSION,
      hz: GHOST_HZ,
      stageId: meta.stageId,
      time: meta.time,
      score: meta.score,
      sneaker: meta.sneaker,
      date: new Date().toISOString(),
      samples: this.samples.slice(),
      kicks: this.kicks.slice(),
    };
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// 불러온 고스트 검증(파일·localStorage 모두 외부 입력으로 취급)
export function validateGhost(g, stageId) {
  if (!g || typeof g !== 'object') return '고스트 데이터가 아니다';
  if (g.format !== GHOST_FORMAT) return '킥비트 고스트 파일이 아니다';
  if (g.version !== GHOST_VERSION) return `지원하지 않는 고스트 버전(${g.version})`;
  if (stageId && g.stageId !== stageId) return `다른 스테이지의 고스트다(${g.stageId})`;
  if (!Number.isFinite(g.time) || g.time <= 0) return '기록 시간이 잘못됐다';
  if (!Array.isArray(g.samples) || g.samples.length < 6 || g.samples.length % 3 !== 0) return '궤적 데이터가 잘못됐다';
  if (g.samples.length > 3 * GHOST_HZ * 60 * 30) return '궤적이 너무 길다';
  if (!g.samples.every((v) => Number.isInteger(v) && Math.abs(v) < 1e7)) return '궤적 값이 잘못됐다';
  if (!Array.isArray(g.kicks) || !g.kicks.every((v) => Number.isFinite(v))) return '발차기 데이터가 잘못됐다';
  if (g.hz !== GHOST_HZ) return '샘플링 주기가 다르다';
  return null;
}

// t초 시점의 위치·방향(선형 보간). 기록이 끝났으면 마지막 위치에 머문다.
export function sampleGhost(g, t) {
  const n = g.samples.length / 3;
  const f = Math.max(0, t * g.hz);
  const i = Math.min(n - 1, Math.floor(f));
  const j = Math.min(n - 1, i + 1);
  const a = f - i;
  const s = g.samples;
  const lerp = (p, q) => p + (q - p) * Math.min(1, a);
  let y0 = s[i * 3 + 2] / 1000;
  let y1 = s[j * 3 + 2] / 1000;
  if (y1 - y0 > Math.PI) y1 -= Math.PI * 2;
  if (y0 - y1 > Math.PI) y1 += Math.PI * 2;
  return {
    x: lerp(s[i * 3], s[j * 3]) / 100,
    z: lerp(s[i * 3 + 1], s[j * 3 + 1]) / 100,
    yaw: lerp(y0, y1),
    done: f >= n - 1,
    kicking: g.kicks.some((k) => f >= k && f < k + GHOST_HZ * 0.25),
  };
}
