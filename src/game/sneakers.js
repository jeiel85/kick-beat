// 스니커즈(발차기 장비). 별을 모아 해금한다.

export const SNEAKERS = [
  {
    id: 'baseline',
    name: '베이스라인 하이탑',
    desc: '균형 잡힌 기본 킥. 탄 패링 가능.',
    kickForce: 1,
    moveSpeed: 1,
    breachReinforced: false,
    kickParry: true,
    perfectBonusMs: 0,
    bulletTimeMult: 1,
    unlockStars: 0,
    color: 0xf2f2f2,
    sole: 0x2bf0ff,
  },
  {
    id: 'bpm-runner',
    name: 'BPM 러너',
    desc: '이동 속도 +15%, 발차기 힘 -15%. 스피드런용.',
    kickForce: 0.85,
    moveSpeed: 1.15,
    breachReinforced: false,
    kickParry: true,
    perfectBonusMs: 0,
    bulletTimeMult: 1,
    unlockStars: 3,
    color: 0x2bff9a,
    sole: 0xffffff,
  },
  {
    id: 'steel-toe',
    name: '스틸토 브리처',
    desc: '잠긴 강철문까지 걷어찬다. 발차기 힘 +35%, 이동 -8%.',
    kickForce: 1.35,
    moveSpeed: 0.92,
    breachReinforced: true,
    kickParry: true,
    perfectBonusMs: 0,
    bulletTimeMult: 1,
    unlockStars: 6,
    color: 0x6b6f7a,
    sole: 0xffb02b,
  },
  {
    id: 'drop-hammer',
    name: '드롭 해머',
    desc: 'PERFECT 판정 창 +20ms, 불릿타임 1.5배, 발차기 힘 +10%.',
    kickForce: 1.1,
    moveSpeed: 1,
    breachReinforced: false,
    kickParry: true,
    perfectBonusMs: 20,
    bulletTimeMult: 1.5,
    unlockStars: 9,
    color: 0xff2bd6,
    sole: 0xffe14a,
  },
];

export function sneakerById(id) {
  return SNEAKERS.find((s) => s.id === id) ?? SNEAKERS[0];
}

export function isUnlocked(sneaker, totalStars) {
  return totalStars >= sneaker.unlockStars;
}
