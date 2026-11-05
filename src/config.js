// 게임 전역 상수. 튜닝 값은 여기 한곳에 모은다.

export const TILE = 2.4; // 맵 한 칸의 한 변(m)
export const WALL_H = 3.4; // 벽·천장 높이(m)
export const DOOR_H = 2.75; // 문짝 높이(m)
export const DOOR_SLAB = 0.14; // 문짝 충돌 판의 반두께(m)

export const PLAYER = {
  radius: 0.35,
  eye: 1.62,
  speed: 8.4, // 기본 전력 질주 속도(m/s) — 걷기 없음
  accel: 70,
  airAccel: 22,
  friction: 14,
  jump: 7.4,
  gravity: 22,
  maxHp: 3,
  hurtInvuln: 0.6, // 피격 후 무적 시간(게임 초)
};

export const KICK = {
  reach: 2.3, // 발차기 사거리(눈 기준 수평 거리)
  cone: 0.95, // 발차기 판정 반각(rad, 약 54°)
  cooldown: 0.28,
  parryRange: 3.4,
  parryCone: 1.15,
  doorSpeed: 15, // 문짝이 날아가는 기본 속도(m/s)
  enemySpeed: 11,
};

// 비트 판정 창(ms). 설계서: -50~+50ms 퍼펙트
export const JUDGE = {
  perfectMs: 50,
  goodMs: 110,
};

// 퍼펙트 비트 불릿타임. duration은 '게임 시간' 기준 — 실제로는 scale로 나눈 만큼(약 1.6초) 체감된다.
export const BULLET_TIME = {
  scale: 0.3,
  duration: 0.5,
  musicCutoff: 520,
};

export const COMBO = {
  multPerStep: 0.25,
  maxSteps: 12, // 최대 x4
};

export const ENEMY_TYPES = {
  grunt: { hp: 1, speed: 3.2, weapon: 'pistol', windup: 0.5, cooldown: [1.4, 2.0], range: 20, color: 0xff3d7f, drop: 'pistol', score: 100 },
  shotgunner: { hp: 1, speed: 3.0, weapon: 'shotgun', windup: 0.65, cooldown: [1.8, 2.4], range: 13, color: 0xffa21f, drop: 'shotgun', score: 120 },
  uzi: { hp: 1, speed: 3.6, weapon: 'smg', windup: 0.55, cooldown: [1.6, 2.2], range: 18, color: 0xb36bff, drop: 'smg', score: 120 },
  rocketeer: { hp: 1, speed: 2.4, weapon: 'launcher', windup: 0.85, cooldown: [2.6, 3.2], range: 24, color: 0x3dffb4, drop: 'launcher', score: 150 },
  bruiser: { hp: 2, speed: 5.6, weapon: 'fists', windup: 0.38, cooldown: [0.9, 1.2], range: 1.9, color: 0xff2a2a, drop: null, score: 200, scale: 1.22 },
};

export const ENEMY_CODES = { g: 'grunt', s: 'shotgunner', u: 'uzi', r: 'rocketeer', b: 'bruiser' };

// 적 투사체 — 즉발 히트스캔이 아니라 눈에 보이고 피할 수 있는 탄(설계서의 '억까' 해소)
export const ENEMY_SHOTS = {
  pistol: { count: 1, speed: 15, spread: 0.02, kind: 'bullet', damage: 1 },
  shotgun: { count: 5, speed: 12.5, spread: 0.09, kind: 'pellet', damage: 1 },
  smg: { count: 3, speed: 16, spread: 0.05, kind: 'bullet', damage: 1, burst: 0.09 },
  launcher: { count: 1, speed: 9.5, spread: 0, kind: 'rocket', damage: 2 },
};

// 플레이어 무기 — 적에게서 빼앗아 쓴다
export const WEAPONS = {
  pistol: { name: '권총', ammo: 8, interval: 0.2, pellets: 1, spread: 0.008, range: 60, auto: false },
  shotgun: { name: '샷건', ammo: 4, interval: 0.55, pellets: 7, spread: 0.075, range: 16, auto: false },
  smg: { name: '기관단총', ammo: 26, interval: 0.075, pellets: 1, spread: 0.03, range: 45, auto: true },
  launcher: { name: '로켓 런처', ammo: 2, interval: 0.8, pellets: 0, spread: 0, range: 0, auto: false, rocket: true },
};

export const WEAPON_CODES = { 1: 'pistol', 2: 'shotgun', 3: 'smg', 4: 'launcher' };

export const EXPLOSION = {
  gas: { radius: 5.6, playerHurtRadius: 3.2 },
  rocket: { radius: 3.6, playerHurtRadius: 2.4 },
};

export const SCORE = {
  kick: 100,
  door: 150,
  strikeBonus: 100, // 문짝 하나로 2명 이상 쓰러뜨릴 때 추가 1명당
  shot: 100,
  parry: 250,
  explosion: 130,
  crush: 180,
  thrown: 160,
  ragdoll: 140,
  wall: 160,
  perfectKick: 50,
  hijack: 75,
};

export const GHOST_HZ = 20;
