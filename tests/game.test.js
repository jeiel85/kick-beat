import { describe, expect, it } from 'vitest';
import { addScore, applyJudgement, comboMultiplier, formatTime, newStats, rankFor, starsFor } from '../src/game/scoring.js';
import { GhostRecorder, sampleGhost, validateGhost } from '../src/game/ghost.js';
import { SNEAKERS, isUnlocked, sneakerById } from '../src/game/sneakers.js';
import { Grid } from '../src/game/grid.js';
import { parseLevel } from '../src/levels/parse.js';
import { TILE } from '../src/config.js';

describe('점수·콤보', () => {
  it('박에 맞으면 콤보가 오르고 빗나가면 끊긴다', () => {
    const st = newStats();
    applyJudgement(st, 'perfect');
    applyJudgement(st, 'good');
    expect(st.combo).toBe(2);
    applyJudgement(st, 'off');
    expect(st.combo).toBe(0);
    expect(st.maxCombo).toBe(2);
  });

  it('배율은 x4에서 멈춘다', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(12)).toBe(4);
    expect(comboMultiplier(50)).toBe(4);
  });

  it('점수에 콤보 배율이 곱해진다', () => {
    const st = newStats();
    st.combo = 4;
    expect(addScore(st, 100)).toBe(200);
    expect(st.score).toBe(200);
  });

  it('별: 클리어 / 기준 시간 / 과제', () => {
    const stage = { par: 60, challenge: { type: 'perfect', n: 3 } };
    const st = { ...newStats(), time: 55, perfects: 3 };
    expect(starsFor(stage, st)).toEqual([true, true, true]);
    expect(starsFor(stage, { ...st, time: 61, perfects: 2 })).toEqual([true, false, false]);
  });

  it('랭크: 빠르고 박자도 맞으면 S', () => {
    const stage = { par: 100 };
    expect(rankFor(stage, { ...newStats(), time: 70, perfects: 8, offs: 2 })).toBe('S');
    expect(rankFor(stage, { ...newStats(), time: 70, perfects: 1, offs: 9 })).toBe('A');
    expect(rankFor(stage, { ...newStats(), time: 150 })).toBe('C');
  });

  it('시간 표기', () => {
    expect(formatTime(83.456)).toBe('01:23.46');
    expect(formatTime(Infinity)).toBe('--:--.--');
  });
});

describe('고스트', () => {
  it('기록 → 검증 → 보간 재생', () => {
    const rec = new GhostRecorder();
    for (let i = 0; i <= 40; i++) rec.record(0.05, i * 0.5, 2, 0.1);
    rec.markKick();
    const g = rec.finish({ stageId: 's', time: 2, score: 10, sneaker: 'baseline' });
    expect(validateGhost(g, 's')).toBeNull();
    const mid = sampleGhost(g, 1.0);
    expect(mid.x).toBeCloseTo(10, 0);
    expect(mid.z).toBeCloseTo(2, 5);
    expect(sampleGhost(g, 999).done).toBe(true);
  });

  it('다른 스테이지·깨진 데이터는 거부한다', () => {
    const rec = new GhostRecorder();
    for (let i = 0; i < 5; i++) rec.record(0.05, i, 0, 0);
    const g = rec.finish({ stageId: 'a', time: 1, score: 0, sneaker: 'x' });
    expect(validateGhost(g, 'b')).toMatch(/다른 스테이지/);
    expect(validateGhost({ ...g, samples: [1, 2] }, 'a')).toMatch(/궤적/);
    expect(validateGhost({ ...g, format: 'x' }, 'a')).toMatch(/고스트 파일이 아니다/);
    expect(validateGhost(null)).toBeTruthy();
  });
});

describe('스니커즈', () => {
  it('별 개수로 해금', () => {
    expect(isUnlocked(SNEAKERS[0], 0)).toBe(true);
    expect(isUnlocked(sneakerById('steel-toe'), 5)).toBe(false);
    expect(isUnlocked(sneakerById('steel-toe'), 6)).toBe(true);
    expect(sneakerById('없음').id).toBe('baseline');
  });
});

describe('Grid', () => {
  const lv = parseLevel({ id: 't', rows: ['#######', '#P..#.#', '#...D.#', '#...#E#', '#######'] });
  const g = new Grid(lv);

  it('원 충돌: 벽 밖으로 밀어낸다', () => {
    const pos = { x: TILE + 0.1, z: TILE * 2.5 };
    g.collideCircle(pos, 0.35);
    expect(pos.x).toBeCloseTo(TILE + 0.35, 5);
  });

  it('광선: 닫힌 문의 얇은 판에서 멈춘다', () => {
    const r = g.raycast(TILE * 1.5, TILE * 2.5, 1, 0, 50);
    expect(r.tile).toBe(3);
    expect(r.dist).toBeCloseTo(TILE * 3 - 0.14, 3);
  });

  it('문이 열리면 시야가 트인다', () => {
    expect(g.los(TILE * 1.5, TILE * 2.5, TILE * 5.5, TILE * 2.5)).toBe(false);
    g.setFloor(4, 2);
    expect(g.los(TILE * 1.5, TILE * 2.5, TILE * 5.5, TILE * 2.5)).toBe(true);
  });
});
