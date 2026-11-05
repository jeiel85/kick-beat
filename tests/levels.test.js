import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/levels/levels.js';
import { parseLevel, validateLevel, T } from '../src/levels/parse.js';
import { generateStage } from '../src/levels/generate.js';

describe('캠페인 스테이지', () => {
  for (const def of STAGES) {
    it(`${def.id}: 파싱되고 출구·모든 적에 도달할 수 있다`, () => {
      const lv = parseLevel(def);
      expect(validateLevel(lv)).toEqual([]);
      expect(lv.enemies.length).toBeGreaterThan(0);
      expect(lv.bpm).toBeGreaterThanOrEqual(140);
    });
  }

  it('스테이지 id가 겹치지 않는다', () => {
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(STAGES.length);
  });

  it('BPM이 스테이지마다 오르고 마지막은 200BPM', () => {
    for (let i = 1; i < STAGES.length; i++) expect(STAGES[i].bpm).toBeGreaterThan(STAGES[i - 1].bpm);
    expect(STAGES.at(-1).bpm).toBe(200);
  });
});

describe('parseLevel', () => {
  it('문의 방향(축)을 주변 벽으로 정한다', () => {
    const lv = parseLevel({
      id: 't',
      rows: ['#####', '#P#.#', '#.D.#', '#.#E#', '#####'],
    });
    expect(lv.doors).toEqual([{ tx: 2, tz: 2, axis: 'z', locked: false }]);
  });

  it('벽 사이에 끼지 않은 문은 오류', () => {
    expect(() => parseLevel({ id: 't', rows: ['#####', '#PD.#', '#...#', '#..E#', '#####'] })).toThrow(/문/);
  });

  it('잠긴 문만 있는 길은 클리어 불가로 판정한다', () => {
    const lv = parseLevel({ id: 't', rows: ['#####', '#P#E#', '#.L.#', '#.#.#', '#####'] });
    expect(validateLevel(lv)).toContain('출구에 도달할 수 없다');
  });

  it('가스관은 콘크리트 벽에 붙어야 한다', () => {
    expect(() => parseLevel({ id: 't', rows: ['#####', '#P..#', '#.G.#', '#..E#', '#####'] })).toThrow(/가스관/);
  });

  it('알 수 없는 문자는 오류', () => {
    expect(() => parseLevel({ id: 't', rows: ['###', '#PX', '#E#'] })).toThrow(/알 수 없는/);
  });

  it('행 길이가 달라도 공백(벽)으로 채운다', () => {
    const lv = parseLevel({ id: 't', rows: ['####', '#PE#', '###'] });
    expect(lv.w).toBe(4);
    expect(lv.tiles[2 * 4 + 3]).toBe(T.VOID);
  });
});

describe('generateStage', () => {
  it('여러 시드에서 항상 유효한 맵을 만든다', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const energies = Array.from({ length: 4 + (seed % 9) }, (_, i) => ((i * 37 + seed) % 10) / 10);
      const def = generateStage({ seed, bpm: 120 + (seed % 80), energies });
      const lv = parseLevel(def);
      const problems = validateLevel(lv);
      if (problems.length) throw new Error(`seed ${seed}: ${problems.join(', ')}\n${def.rows.join('\n')}`);
      expect(lv.enemies.length).toBeGreaterThan(0);
    }
  });

  it('같은 시드는 같은 맵', () => {
    const a = generateStage({ seed: 42, bpm: 160, energies: [0.2, 0.9, 0.5, 1, 0.3, 0.7] });
    const b = generateStage({ seed: 42, bpm: 160, energies: [0.2, 0.9, 0.5, 1, 0.3, 0.7] });
    expect(a.rows).toEqual(b.rows);
  });

  it('에너지가 높은 곡일수록 적이 많다', () => {
    let calm = 0;
    let loud = 0;
    for (let seed = 1; seed <= 40; seed++) {
      calm += parseLevel(generateStage({ seed, bpm: 150, energies: Array(8).fill(0.05) })).enemies.length;
      loud += parseLevel(generateStage({ seed, bpm: 150, energies: Array(8).fill(0.95) })).enemies.length;
    }
    expect(loud).toBeGreaterThan(calm * 1.4);
  });
});
