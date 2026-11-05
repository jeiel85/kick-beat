// 공유 재질·지오메트리·절차 텍스처. 레벨을 다시 만들어도 재사용해 즉시 재시작이 가볍다.

import * as THREE from 'three';
import { DOOR_H, TILE, WALL_H } from '../config.js';
import { mulberry32 } from '../levels/rng.js';

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function speckle(g, s, rng, n, color, alpha) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.globalAlpha = rng.next() * alpha;
    g.fillRect(rng.next() * s, rng.next() * s, 1 + rng.next() * 3, 1 + rng.next() * 3);
  }
  g.globalAlpha = 1;
}

let cache = null;

export function getAssets() {
  if (cache) return cache;
  const rng = mulberry32(7);

  const floorTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#2a2236';
    g.fillRect(0, 0, s, s);
    speckle(g, s, rng, 1400, '#4a3d5e', 0.6);
    g.strokeStyle = '#1a1422';
    g.lineWidth = 4;
    g.strokeRect(2, 2, s - 4, s - 4);
    g.strokeStyle = '#3d2f52';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(s / 2, 0);
    g.lineTo(s / 2, s);
    g.moveTo(0, s / 2);
    g.lineTo(s, s / 2);
    g.stroke();
  });

  const wallTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#3a2f4c';
    g.fillRect(0, 0, s, s);
    speckle(g, s, rng, 900, '#000000', 0.5);
    g.fillStyle = '#4b3d63';
    for (let i = 0; i < 4; i++) g.fillRect((i * s) / 4 + 2, 0, 3, s);
    g.fillStyle = '#120e18';
    g.fillRect(0, s * 0.82, s, s * 0.18);
  });

  const drywallTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#b9a7a2';
    g.fillRect(0, 0, s, s);
    speckle(g, s, rng, 2200, '#7d6c69', 0.45);
    g.strokeStyle = '#4d3f3c';
    g.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      // 금(crack)
      let x = rng.next() * s;
      let y = rng.next() * s;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (rng.next() - 0.5) * 50;
        y += (rng.next() - 0.5) * 50;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // 스프레이 X 표시 — '여긴 뚫린다'는 시각 언어
    g.strokeStyle = '#ff2bd6';
    g.lineWidth = 10;
    g.globalAlpha = 0.75;
    g.beginPath();
    g.moveTo(s * 0.3, s * 0.3);
    g.lineTo(s * 0.7, s * 0.7);
    g.moveTo(s * 0.7, s * 0.3);
    g.lineTo(s * 0.3, s * 0.7);
    g.stroke();
    g.globalAlpha = 1;
  });

  const doorTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#3b1f2e';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${90 + rng.int(0, 40)},${40 + rng.int(0, 20)},${60 + rng.int(0, 20)},0.25)`;
      g.fillRect(0, rng.next() * s, s, 1 + rng.next() * 2);
    }
    g.strokeStyle = '#1c0e16';
    g.lineWidth = 6;
    g.strokeRect(24, 20, s - 48, s * 0.4);
    g.strokeRect(24, s * 0.52, s - 48, s * 0.4);
  });

  const lockedTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#3a3f48';
    g.fillRect(0, 0, s, s);
    speckle(g, s, rng, 1500, '#1b1e22', 0.6);
    for (let i = -s; i < s * 2; i += 40) {
      g.fillStyle = '#e8c21a';
      g.beginPath();
      g.moveTo(i, s * 0.42);
      g.lineTo(i + 20, s * 0.42);
      g.lineTo(i + 40, s * 0.58);
      g.lineTo(i + 20, s * 0.58);
      g.fill();
    }
    g.fillStyle = '#c21c2c';
    g.fillRect(s * 0.42, s * 0.36, s * 0.16, s * 0.28);
  });

  const ceilTex = canvasTex(256, (g, s) => {
    g.fillStyle = '#1a1424';
    g.fillRect(0, 0, s, s);
    speckle(g, s, rng, 500, '#30263e', 0.6);
  });

  const mats = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.15 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 }),
    drywall: new THREE.MeshStandardMaterial({ map: drywallTex, roughness: 0.95 }),
    door: new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7 }),
    locked: new THREE.MeshStandardMaterial({ map: lockedTex, roughness: 0.4, metalness: 0.6 }),
    ceiling: new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 }),
    debris: new THREE.MeshStandardMaterial({ color: 0xa8958f, roughness: 1 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.35, metalness: 0.5, emissive: 0x3a0005 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8c8f99, roughness: 0.3, metalness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.25, metalness: 1, emissive: 0x2a1a00 }),
    crystal: new THREE.MeshBasicMaterial({ color: 0xfff1c9, toneMapped: false }),
    gun: new THREE.MeshStandardMaterial({ color: 0x24242b, roughness: 0.4, metalness: 0.7 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd9a07a, roughness: 0.8 }),
    boot: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, emissive: 0x111111 }),
    sole: new THREE.MeshBasicMaterial({ color: 0x2bf0ff, toneMapped: false }),
    pant: new THREE.MeshStandardMaterial({ color: 0x1f2333, roughness: 0.9 }),
    exitOn: new THREE.MeshBasicMaterial({ color: 0x29ff8a, toneMapped: false, transparent: true, opacity: 0.85 }),
    exitOff: new THREE.MeshBasicMaterial({ color: 0xff2b4a, toneMapped: false, transparent: true, opacity: 0.6 }),
    ghost: new THREE.MeshBasicMaterial({ color: 0x5ef3ff, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }),
    gas: new THREE.MeshBasicMaterial({ color: 0x9dff4a, transparent: true, opacity: 0.18, depthWrite: false }),
    blast: new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    tracer: new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
    bulletEnemy: new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false }),
    bulletPlayer: new THREE.MeshBasicMaterial({ color: 0x2bf0ff, toneMapped: false }),
    rocket: new THREE.MeshBasicMaterial({ color: 0xff7a1a, toneMapped: false }),
    spark: new THREE.MeshBasicMaterial({ color: 0xffd36b, toneMapped: false }),
    telegraph: new THREE.MeshBasicMaterial({ color: 0xff2b4a, toneMapped: false, transparent: true, opacity: 0.9 }),
  };

  const geo = {
    wallBox: new THREE.BoxGeometry(TILE, WALL_H, TILE),
    doorPanel: new THREE.BoxGeometry(TILE * 0.92, DOOR_H, 0.14),
    lintel: new THREE.BoxGeometry(TILE, WALL_H - DOOR_H, TILE),
    debris: new THREE.BoxGeometry(0.42, 0.42, 0.1),
    pipe: new THREE.CylinderGeometry(0.13, 0.13, WALL_H, 10),
    valve: new THREE.TorusGeometry(0.16, 0.035, 6, 12),
    bullet: new THREE.CapsuleGeometry(0.05, 0.28, 2, 6),
    pellet: new THREE.SphereGeometry(0.07, 6, 4),
    rocket: new THREE.CylinderGeometry(0.08, 0.1, 0.55, 8),
    spark: new THREE.BoxGeometry(0.05, 0.05, 0.2),
    unitSphere: new THREE.SphereGeometry(1, 16, 12),
    exitRing: new THREE.TorusGeometry(0.9, 0.06, 8, 32),
    exitBeam: new THREE.CylinderGeometry(0.85, 0.85, WALL_H, 24, 1, true),
    tracer: new THREE.BoxGeometry(0.03, 0.03, 1),
  };

  // 네온 띠 재질은 스테이지 팔레트마다 색이 달라 레벨 생성 시 만든다(world.js)
  cache = { mats, geo };
  return cache;
}

// 무기 모델(적 손·바닥·1인칭 공용). 지오메트리를 공유하는 복제본을 돌려준다.
const gunTemplates = new Map();
export function makeGunMesh(type) {
  if (!gunTemplates.has(type)) gunTemplates.set(type, buildGun(type));
  return gunTemplates.get(type).clone();
}

function buildGun(type) {
  const { mats } = getAssets();
  const g = new THREE.Group();
  const add = (w, h, d, x, y, z, m = mats.gun) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  switch (type) {
    case 'shotgun':
      add(0.07, 0.08, 0.75, 0, 0, -0.25);
      add(0.06, 0.13, 0.22, 0, -0.07, 0.12, mats.metal);
      break;
    case 'smg':
      add(0.07, 0.12, 0.42, 0, 0, -0.12);
      add(0.04, 0.16, 0.05, 0, -0.12, -0.05, mats.metal);
      break;
    case 'launcher':
      {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 10), mats.metal);
        tube.rotation.x = Math.PI / 2;
        tube.position.z = -0.2;
        g.add(tube);
        add(0.05, 0.12, 0.08, 0, -0.12, 0.05);
      }
      break;
    default:
      add(0.06, 0.1, 0.26, 0, 0, -0.08);
      add(0.05, 0.12, 0.06, 0, -0.08, 0.02, mats.metal);
  }
  return g;
}
