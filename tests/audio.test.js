import { describe, expect, it } from 'vitest';
import { BeatClock, judge } from '../src/audio/beatClock.js';
import { analyzeBeats } from '../src/audio/beatDetect.js';
import { mulberry32 } from '../src/levels/rng.js';

describe('BeatClock', () => {
  it('박 위치와 오차(ms)를 오디오 시간으로 계산한다', () => {
    const c = new BeatClock(150, 2); // 주기 0.4s
    expect(c.beatAt(2)).toBe(0);
    expect(c.beatAt(2.8)).toBeCloseTo(2);
    expect(c.deltaMs(2.81)).toBeCloseTo(10, 5);
    expect(c.deltaMs(2.79)).toBeCloseTo(-10, 5);
    expect(c.phaseAt(3.0)).toBeCloseTo(0.5);
  });

  it('BPM이 0 이하이면 거부한다', () => {
    expect(() => new BeatClock(0, 0)).toThrow();
  });
});

describe('judge', () => {
  it('설계서 기준 ±50ms는 PERFECT', () => {
    expect(judge(0)).toBe('perfect');
    expect(judge(-50)).toBe('perfect');
    expect(judge(50.1)).toBe('good');
    expect(judge(-110)).toBe('good');
    expect(judge(111)).toBe('off');
  });
  it('신발 보너스로 PERFECT 창이 넓어진다', () => {
    expect(judge(65, 20)).toBe('perfect');
  });
});

// 합성 트랙: 킥(50~60Hz 감쇠 사인) + 오프비트 하이햇(고역 잡음) + 배경 잡음
function synthTrack({ bpm, offset, seconds, sr = 22050, hats = true, seed = 1 }) {
  const rng = mulberry32(seed);
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const period = 60 / bpm;
  for (let i = 0; i < n; i++) out[i] = (rng.next() - 0.5) * 0.02;
  for (let t = offset; t < seconds; t += period) {
    const s0 = Math.floor(t * sr);
    for (let k = 0; k < sr * 0.18 && s0 + k < n; k++) {
      const tt = k / sr;
      const f = 50 + 90 * Math.exp(-tt * 40);
      out[s0 + k] += Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 14) * 0.9;
    }
    if (hats) {
      const h0 = Math.floor((t + period / 2) * sr);
      for (let k = 0; k < sr * 0.03 && h0 + k < n; k++) out[h0 + k] += (rng.next() - 0.5) * 0.5 * Math.exp(-k / (sr * 0.008));
    }
  }
  return { samples: out, sr };
}

describe('analyzeBeats', () => {
  for (const [bpm, offset] of [
    [128, 0.37],
    [150, 0.05],
    [174, 0.21],
    [96, 0.5],
  ]) {
    it(`${bpm} BPM, 첫 박 ${offset}s 를 찾는다`, () => {
      const { samples, sr } = synthTrack({ bpm, offset, seconds: 40, seed: bpm });
      const r = analyzeBeats(samples, sr);
      // 게임은 4분음표 박을 쓰므로 절반 템포(96→192)로 잡혀도 박 격자는 일치해야 한다
      const ratio = r.bpm / bpm;
      const mult = Math.round(ratio);
      expect([1, 2]).toContain(mult);
      expect(Math.abs(r.bpm - bpm * mult)).toBeLessThan(0.3 * mult);
      const period = 60 / r.bpm;
      // 실제 킥 시각들이 검출된 격자에서 얼마나 떨어져 있나(ms)
      let worst = 0;
      for (let t = offset; t < 40; t += 60 / bpm) {
        const b = (t - r.offset) / period;
        worst = Math.max(worst, Math.abs(b - Math.round(b)) * period * 1000);
      }
      expect(worst).toBeLessThan(25);
      expect(r.loopEnd).toBeGreaterThan(r.loopStart);
      expect(r.energies.length).toBe(12);
    });
  }

  it('무음은 오류로 알린다', () => {
    expect(() => analyzeBeats(new Float32Array(22050 * 10), 22050)).toThrow();
  });

  it('너무 짧은 곡은 거부한다', () => {
    expect(() => analyzeBeats(new Float32Array(22050 * 3), 22050)).toThrow();
  });
});
