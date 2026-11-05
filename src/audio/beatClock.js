// 비트 시계: 오디오 컨텍스트 시간(초)을 마스터 클록으로 박자 위치를 계산한다.
// 렌더 프레임이 아니라 오디오 시간 기준이라 프레임 드랍이 판정에 영향을 주지 않는다.

import { JUDGE } from '../config.js';

export class BeatClock {
  constructor(bpm = 150, startTime = 0) {
    this.set(bpm, startTime);
  }

  set(bpm, startTime) {
    if (!(bpm > 0)) throw new Error(`잘못된 BPM: ${bpm}`);
    this.bpm = bpm;
    this.startTime = startTime; // 0번째 박이 울리는 오디오 시간
    this.period = 60 / bpm;
  }

  beatAt(t) {
    return (t - this.startTime) / this.period;
  }

  // 0~1: 직전 박 이후 경과 비율
  phaseAt(t) {
    const b = this.beatAt(t);
    return b - Math.floor(b);
  }

  // 가장 가까운 박과의 오차(ms). 음수 = 박보다 이르게 입력
  deltaMs(t) {
    const b = this.beatAt(t);
    return (b - Math.round(b)) * this.period * 1000;
  }

  nearestBeat(t) {
    return Math.round(this.beatAt(t));
  }
}

/**
 * 오차(ms) → 판정. perfectBonusMs는 신발 효과로 퍼펙트 창을 넓힐 때 쓴다.
 * @returns {'perfect'|'good'|'off'}
 */
export function judge(deltaMs, perfectBonusMs = 0) {
  const a = Math.abs(deltaMs);
  if (a <= JUDGE.perfectMs + perfectBonusMs) return 'perfect';
  if (a <= JUDGE.goodMs + perfectBonusMs) return 'good';
  return 'off';
}
