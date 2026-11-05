// localStorage 저장. 읽은 값은 모두 검증하고, 저장 실패는 호출자에게 알린다(조용히 삼키지 않는다).

import { validateGhost } from './game/ghost.js';

const KEY = 'kickbeat.save.v1';
const GHOST_KEY = (id) => `kickbeat.ghost.v1.${id}`;

export const DEFAULT_SETTINGS = {
  sensitivity: 1,
  invertY: false,
  fov: 90,
  music: 0.8,
  sfx: 0.9,
  audioOffsetMs: 0,
  quality: 'high',
  showGhost: true,
  showHints: true,
};

const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);

function sanitizeSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    sensitivity: num(s.sensitivity, 0.1, 4, DEFAULT_SETTINGS.sensitivity),
    invertY: bool(s.invertY, DEFAULT_SETTINGS.invertY),
    fov: num(s.fov, 65, 115, DEFAULT_SETTINGS.fov),
    music: num(s.music, 0, 1, DEFAULT_SETTINGS.music),
    sfx: num(s.sfx, 0, 1, DEFAULT_SETTINGS.sfx),
    audioOffsetMs: num(s.audioOffsetMs, -250, 250, DEFAULT_SETTINGS.audioOffsetMs),
    quality: s.quality === 'low' ? 'low' : 'high',
    showGhost: bool(s.showGhost, DEFAULT_SETTINGS.showGhost),
    showHints: bool(s.showHints, DEFAULT_SETTINGS.showHints),
  };
}

function sanitizeProgress(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  for (const [id, r] of Object.entries(p)) {
    if (!r || typeof r !== 'object' || typeof id !== 'string' || id.length > 80) continue;
    out[id] = {
      bestTime: num(r.bestTime, 0, 1e6, null),
      bestScore: num(r.bestScore, 0, 1e9, 0),
      stars: Array.isArray(r.stars) ? [0, 1, 2].map((i) => r.stars[i] === true) : [false, false, false],
      rank: ['S', 'A', 'B', 'C'].includes(r.rank) ? r.rank : null,
    };
  }
  return out;
}

export function loadSave() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) {
    console.warn('[save] 저장 데이터를 읽지 못해 기본값을 쓴다:', e);
  }
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    settings: sanitizeSettings(raw.settings),
    progress: sanitizeProgress(raw.progress),
    sneaker: typeof raw.sneaker === 'string' ? raw.sneaker : 'baseline',
    seenIntro: raw.seenIntro === true,
  };
}

/** @returns {string|null} 오류 메시지(성공 시 null) */
export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return null;
  } catch (e) {
    console.error('[save] 저장 실패:', e);
    return '브라우저 저장 공간에 기록하지 못했다(사생활 보호 모드이거나 공간이 부족할 수 있다)';
  }
}

export function totalStars(progress) {
  return Object.values(progress).reduce((s, r) => s + r.stars.filter(Boolean).length, 0);
}

/** 결과를 반영하고 갱신 여부를 돌려준다 */
export function recordResult(save, stageId, { time, score, stars, rank }) {
  const prev = save.progress[stageId] ?? { bestTime: null, bestScore: 0, stars: [false, false, false], rank: null };
  const newBestTime = prev.bestTime == null || time < prev.bestTime;
  const order = ['C', 'B', 'A', 'S'];
  save.progress[stageId] = {
    bestTime: newBestTime ? time : prev.bestTime,
    bestScore: Math.max(prev.bestScore, score),
    stars: prev.stars.map((s, i) => s || stars[i]),
    rank: prev.rank == null || order.indexOf(rank) > order.indexOf(prev.rank) ? rank : prev.rank,
  };
  return { newBestTime, newBestScore: score > prev.bestScore };
}

export function loadGhost(stageId) {
  try {
    const g = JSON.parse(localStorage.getItem(GHOST_KEY(stageId)) || 'null');
    if (!g) return null;
    const err = validateGhost(g, stageId);
    if (err) {
      console.warn(`[save] 고스트(${stageId}) 무시: ${err}`);
      return null;
    }
    return g;
  } catch (e) {
    console.warn('[save] 고스트를 읽지 못했다:', e);
    return null;
  }
}

/** @returns {string|null} 오류 메시지 */
export function storeGhost(stageId, ghost) {
  try {
    localStorage.setItem(GHOST_KEY(stageId), JSON.stringify(ghost));
    return null;
  } catch (e) {
    console.error('[save] 고스트 저장 실패:', e);
    return '고스트를 저장하지 못했다(저장 공간 부족)';
  }
}
