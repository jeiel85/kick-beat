// 적 인간형 모델(블록 카툰 스타일)과 래그돌 변환.

import * as THREE from 'three';
import { ENEMY_TYPES } from '../config.js';
import { getAssets, makeGunMesh } from './assets.js';
import { CANNON, G_DYN, G_RAG, G_STATIC } from './physics.js';

const geoCache = {};
function geo(key, make) {
  if (!geoCache[key]) geoCache[key] = make();
  return geoCache[key];
}
const matCache = new Map();
function typeMats(type) {
  if (matCache.has(type)) return matCache.get(type);
  const color = new THREE.Color(ENEMY_TYPES[type].color);
  const m = {
    jacket: new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.7 }),
    visor: new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  };
  matCache.set(type, m);
  return m;
}

let alertTex = null;
function alertSprite() {
  if (!alertTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 56px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffe14a';
    g.strokeStyle = '#000';
    g.lineWidth = 6;
    g.strokeText('!', 32, 34);
    g.fillText('!', 32, 34);
    alertTex = new THREE.CanvasTexture(c);
    alertTex.colorSpace = THREE.SRGBColorSpace;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTex, depthTest: false, toneMapped: false }));
  s.scale.set(0.5, 0.5, 0.5);
  s.renderOrder = 10;
  return s;
}

// 부위 치수(m, 배율 1 기준)
const DIM = {
  torso: [0.56, 0.68, 0.32],
  arm: [0.15, 0.62, 0.15],
  leg: [0.2, 0.8, 0.22],
  head: 0.19,
};

export function createEnemyModel(type) {
  const cfg = ENEMY_TYPES[type];
  const { mats } = getAssets();
  const tm = typeMats(type);
  const s = cfg.scale ?? 1;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(s);
  root.add(body);

  const torso = new THREE.Mesh(geo('torso', () => new THREE.BoxGeometry(...DIM.torso)), tm.jacket);
  torso.position.y = 1.18;
  body.add(torso);

  const head = new THREE.Mesh(geo('head', () => new THREE.SphereGeometry(DIM.head, 12, 10)), mats.skin);
  head.position.y = 1.72;
  const visor = new THREE.Mesh(geo('visor', () => new THREE.BoxGeometry(0.32, 0.08, 0.06)), tm.visor);
  visor.position.set(0, 0.03, -0.16);
  head.add(visor);
  body.add(head);

  const mkLimb = (dims, px, py, mat) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    const m = new THREE.Mesh(geo(`limb${dims.join()}`, () => new THREE.BoxGeometry(...dims)), mat);
    m.position.y = -dims[1] / 2;
    pivot.add(m);
    body.add(pivot);
    return { pivot, mesh: m };
  };
  const armL = mkLimb(DIM.arm, -0.36, 1.46, tm.jacket);
  const armR = mkLimb(DIM.arm, 0.36, 1.46, tm.jacket);
  const legL = mkLimb(DIM.leg, -0.14, 0.82, mats.pant);
  const legR = mkLimb(DIM.leg, 0.14, 0.82, mats.pant);

  let gun = null;
  let muzzle = new THREE.Object3D();
  if (cfg.weapon !== 'fists') {
    gun = makeGunMesh(cfg.weapon);
    gun.position.set(0, -0.62, -0.05);
    gun.rotation.x = Math.PI / 2;
    armR.pivot.add(gun);
    muzzle.position.set(0, 0, -0.55);
    gun.add(muzzle);
  } else {
    muzzle.position.set(0, -0.65, 0);
    armR.pivot.add(muzzle);
  }
  const telegraph = new THREE.Mesh(getAssets().geo.unitSphere, mats.telegraph);
  telegraph.scale.setScalar(0.001);
  telegraph.visible = false;
  muzzle.add(telegraph);

  const alert = alertSprite();
  alert.position.y = 2.25 * s;
  alert.visible = false;
  root.add(alert);

  return { root, body, torso, head, armL, armR, legL, legR, gun, muzzle, telegraph, alert, scale: s, phase: Math.random() * 6 };
}

/**
 * @param {*} m 모델
 * @param {number} dt
 * @param {{speed:number, aiming:boolean, windup:number}} st windup: 0~1 공격 예고 진행도
 */
export function animateModel(m, dt, st) {
  m.phase += dt * (2 + st.speed * 2.6);
  const sw = Math.min(1, st.speed / 3) * 0.7;
  const a = Math.sin(m.phase) * sw;
  m.legL.pivot.rotation.x = a;
  m.legR.pivot.rotation.x = -a;
  const aimX = st.aiming ? -Math.PI / 2 + 0.08 : -a * 0.6;
  m.armR.pivot.rotation.x += (aimX - m.armR.pivot.rotation.x) * Math.min(1, dt * 12);
  const leftX = st.aiming && m.gun ? -Math.PI / 2.4 : a * 0.6;
  m.armL.pivot.rotation.x += (leftX - m.armL.pivot.rotation.x) * Math.min(1, dt * 12);
  m.armL.pivot.rotation.z = st.aiming && m.gun ? 0.5 : 0;
  m.body.position.y = Math.abs(Math.sin(m.phase)) * 0.05 * sw;
  if (st.windup > 0) {
    m.telegraph.visible = true;
    const k = 0.06 + st.windup * 0.16 + Math.sin(st.windup * 40) * 0.015;
    m.telegraph.scale.setScalar(k);
  } else if (m.telegraph.visible) {
    m.telegraph.visible = false;
  }
}

/**
 * 모델을 래그돌 강체 묶음으로 바꾼다. 메시는 parent(레벨 루트)로 옮겨져 강체를 따라간다.
 * @returns {{torso: CANNON.Body, bodies: CANNON.Body[]}}
 */
export function spawnRagdoll(physics, m, parent, vel, spin = 6) {
  m.root.updateMatrixWorld(true);
  const s = m.scale;
  const parts = [
    { mesh: m.torso, shape: new CANNON.Box(new CANNON.Vec3((DIM.torso[0] / 2) * s, (DIM.torso[1] / 2) * s, (DIM.torso[2] / 2) * s)), mass: 14 },
    { mesh: m.head, shape: new CANNON.Sphere(DIM.head * s), mass: 4 },
    { mesh: m.armL.mesh, shape: new CANNON.Box(new CANNON.Vec3((DIM.arm[0] / 2) * s, (DIM.arm[1] / 2) * s, (DIM.arm[2] / 2) * s)), mass: 3, joint: m.armL.pivot },
    { mesh: m.armR.mesh, shape: new CANNON.Box(new CANNON.Vec3((DIM.arm[0] / 2) * s, (DIM.arm[1] / 2) * s, (DIM.arm[2] / 2) * s)), mass: 3, joint: m.armR.pivot },
    { mesh: m.legL.mesh, shape: new CANNON.Box(new CANNON.Vec3((DIM.leg[0] / 2) * s, (DIM.leg[1] / 2) * s, (DIM.leg[2] / 2) * s)), mass: 6, joint: m.legL.pivot },
    { mesh: m.legR.mesh, shape: new CANNON.Box(new CANNON.Vec3((DIM.leg[0] / 2) * s, (DIM.leg[1] / 2) * s, (DIM.leg[2] / 2) * s)), mass: 6, joint: m.legR.pivot },
  ];
  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const ws = new THREE.Vector3();
  const bodies = [];
  for (const p of parts) {
    p.mesh.matrixWorld.decompose(wp, wq, ws);
    const b = new CANNON.Body({
      mass: p.mass,
      shape: p.shape,
      position: new CANNON.Vec3(wp.x, Math.max(wp.y, 0.2), wp.z),
      quaternion: new CANNON.Quaternion(wq.x, wq.y, wq.z, wq.w),
      collisionFilterGroup: G_RAG,
      collisionFilterMask: G_STATIC | G_DYN,
      linearDamping: 0.05,
      angularDamping: 0.35,
    });
    b.allowSleep = true;
    b.sleepSpeedLimit = 0.4;
    b.velocity.set(vel.x + (Math.random() - 0.5) * 1.5, vel.y + Math.random() * 1.2, vel.z + (Math.random() - 0.5) * 1.5);
    b.angularVelocity.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    p.body = b;
    // 메시를 레벨 루트로 옮기고(월드 변환 유지), 스케일은 메시에 직접 굽는다
    p.mesh.removeFromParent();
    p.mesh.position.copy(wp);
    p.mesh.quaternion.copy(wq);
    p.mesh.scale.copy(ws);
    parent.add(p.mesh);
    physics.link(b, p.mesh, 7);
    bodies.push(b);
  }
  // 관절: 몸통과 머리·팔다리를 점 관절로 잇는다
  const torso = parts[0].body;
  const joint = (b, worldPt) => {
    const pa = new CANNON.Vec3();
    const pb = new CANNON.Vec3();
    torso.pointToLocalFrame(new CANNON.Vec3(worldPt.x, worldPt.y, worldPt.z), pa);
    b.pointToLocalFrame(new CANNON.Vec3(worldPt.x, worldPt.y, worldPt.z), pb);
    physics.world.addConstraint(new CANNON.PointToPointConstraint(torso, pa, b, pb, 1e4));
  };
  const neck = new THREE.Vector3();
  m.head.getWorldPosition(neck);
  neck.y -= DIM.head * s;
  joint(parts[1].body, neck);
  for (const p of parts.slice(2)) {
    p.joint.getWorldPosition(wp);
    joint(p.body, wp);
  }
  // 무기와 알림 표시 등 남은 부분은 숨긴다
  m.root.visible = false;
  return { torso, bodies };
}
