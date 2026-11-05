// 점수·콤보·랭크·별(서브 미션) 계산. 순수 함수만 둔다(테스트 대상).

import { COMBO } from '../config.js';

export function comboMultiplier(combo) {
  return 1 + Math.min(combo, COMBO.maxSteps) * COMBO.multPerStep;
}

export function newStats() {
  return {
    time: 0,
    score: 0,
    kills: 0,
    perfects: 0,
    goods: 0,
    offs: 0,
    combo: 0,
    maxCombo: 0,
    strikes: 0,
    explosionKills: 0,
    parryKills: 0,
    parries: 0,
    hijacks: 0,
    damageTaken: 0,
  };
}

// 박자 판정을 반영. 박에 맞으면 콤보가 오르고, 빗나가면 끊긴다.
export function applyJudgement(stats, result) {
  if (result === 'perfect') stats.perfects++;
  else if (result === 'good') stats.goods++;
  else stats.offs++;
  if (result === 'off') stats.combo = 0;
  else {
    stats.combo++;
    stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
  }
}

export function addScore(stats, base) {
  const pts = Math.round(base * comboMultiplier(stats.combo));
  stats.score += pts;
  return pts;
}

export function challengeMet(challenge, stats) {
  if (!challenge) return false;
  switch (challenge.type) {
    case 'perfect':
      return stats.perfects >= challenge.n;
    case 'strike':
      return stats.strikes >= challenge.n;
    case 'explosion':
      return stats.explosionKills >= challenge.n;
    case 'parry':
      return stats.parryKills >= challenge.n;
    case 'combo':
      return stats.maxCombo >= challenge.n;
    case 'noDamage':
      return stats.damageTaken === 0;
    default:
      return false;
  }
}

// 별 3개: 클리어 / 기준 시간 안 / 스테이지 과제
export function starsFor(stage, stats) {
  return [true, stats.time <= stage.par, challengeMet(stage.challenge, stats)];
}

export function rankFor(stage, stats) {
  const judged = stats.perfects + stats.goods + stats.offs;
  const onBeat = judged ? (stats.perfects + stats.goods) / judged : 0;
  const t = stats.time / stage.par;
  if (t <= 0.8 && onBeat >= 0.6) return 'S';
  if (t <= 1) return 'A';
  if (t <= 1.4) return 'B';
  return 'C';
}

export function formatTime(sec) {
  if (!Number.isFinite(sec)) return '--:--.--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
