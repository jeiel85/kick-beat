// 레벨 데이터 → Three.js 장면 + 정적 충돌체 + 상호작용 오브젝트(문·가벽·가스관·샹들리에·출구·무기).

import * as THREE from 'three';
import { DOOR_H, DOOR_SLAB, TILE, WALL_H } from '../config.js';
import { T } from '../levels/parse.js';
import { hash32 } from '../levels/rng.js';
import { getAssets, makeGunMesh } from './assets.js';
import { Grid } from './grid.js';

const DIR_VEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export function buildWorld(level, physics, root) {
  const { mats, geo } = getAssets();
  const grid = new Grid(level);
  const W = level.w;
  const H = level.h;
  const cx = (t) => (t + 0.5) * TILE;
  const disposables = [];

  // 바닥·천장
  const floorGeo = new THREE.PlaneGeometry(W * TILE, H * TILE);
  floorGeo.attributes.uv.array.forEach((_, i, a) => {
    a[i] *= i % 2 === 0 ? W : H;
  });
  floorGeo.attributes.uv.needsUpdate = true;
  disposables.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((W * TILE) / 2, 0, (H * TILE) / 2);
  root.add(floor);
  const ceil = new THREE.Mesh(floorGeo, mats.ceiling);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set((W * TILE) / 2, WALL_H, (H * TILE) / 2);
  root.add(ceil);
  physics.addPlane(0, true);
  physics.addPlane(WALL_H, false);

  const isOpenish = (t) => t !== T.WALL && t !== T.VOID;
  const touchesOpen = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && isOpenish(grid.get(x + dx, z + dz))) return true;
    return false;
  };

  // 콘크리트 벽: 보이는 것만 인스턴싱, 충돌체는 가로 연속 구간을 하나로 합친다
  const wallTiles = [];
  for (let z = 0; z < H; z++) {
    let runStart = -1;
    for (let x = 0; x <= W; x++) {
      const solid = x < W && (grid.get(x, z) === T.WALL || grid.get(x, z) === T.VOID) && touchesOpen(x, z);
      if (solid) {
        wallTiles.push([x, z]);
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        const len = x - runStart;
        physics.addStaticBox((runStart + len / 2) * TILE, WALL_H / 2, cx(z), (len * TILE) / 2, WALL_H / 2, TILE / 2);
        runStart = -1;
      }
    }
  }
  const walls = new THREE.InstancedMesh(geo.wallBox, mats.wall, wallTiles.length);
  const m4 = new THREE.Matrix4();
  wallTiles.forEach(([x, z], i) => {
    m4.makeTranslation(cx(x), WALL_H / 2, cx(z));
    walls.setMatrixAt(i, m4);
  });
  walls.instanceMatrix.needsUpdate = true;
  root.add(walls);
  disposables.push(walls);

  // 네온 띠: 바닥 타일이 콘크리트 벽과 맞닿는 면마다 위·아래 두 줄
  const palette = level.palette.map((c) => new THREE.Color(c));
  const strips = [];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (grid.get(x, z) !== T.FLOOR) continue;
      for (const [d, [dx, dz]] of Object.entries(DIR_VEC)) {
        if (grid.get(x + dx, z + dz) !== T.WALL) continue;
        const chunk = hash32(`${Math.floor(x / 6)},${Math.floor(z / 5)}`) % palette.length;
        strips.push({ x, z, d, dx, dz, color: palette[chunk] });
      }
    }
  }
  const stripGeo = new THREE.BoxGeometry(TILE, 0.07, 0.05);
  disposables.push(stripGeo);
  const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  disposables.push(neonMat);
  const neon = new THREE.InstancedMesh(stripGeo, neonMat, strips.length * 2);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  strips.forEach((s, i) => {
    const rotY = s.dx !== 0 ? Math.PI / 2 : 0;
    q.setFromAxisAngle(up, rotY);
    const fx = cx(s.x) + s.dx * (TILE / 2 - 0.03);
    const fz = cx(s.z) + s.dz * (TILE / 2 - 0.03);
    pos.set(fx, WALL_H - 0.35, fz);
    m4.compose(pos, q, scl);
    neon.setMatrixAt(i * 2, m4);
    neon.setColorAt(i * 2, s.color);
    pos.set(fx, 0.12, fz);
    m4.compose(pos, q, scl);
    neon.setMatrixAt(i * 2 + 1, m4);
    neon.setColorAt(i * 2 + 1, s.color.clone().multiplyScalar(0.6));
  });
  neon.instanceMatrix.needsUpdate = true;
  if (neon.instanceColor) neon.instanceColor.needsUpdate = true;
  root.add(neon);
  disposables.push(neon);

  // 비트에 맞춰 울리는 스피커(방 모서리 장식) — 격자 충돌용 소품 상자로도 등록
  const speakers = [];
  const spkGeo = new THREE.BoxGeometry(0.85, 1.3, 0.85);
  const coneGeo = new THREE.CircleGeometry(0.28, 16);
  disposables.push(spkGeo, coneGeo);
  const spkMat = new THREE.MeshStandardMaterial({ color: 0x15121c, roughness: 0.6 });
  const coneMat = new THREE.MeshBasicMaterial({ color: palette[0], toneMapped: false });
  disposables.push(spkMat, coneMat);
  grid.props = [];
  for (let z = 1; z < H - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid.get(x, z) !== T.FLOOR) continue;
      const n = grid.get(x, z - 1) === T.WALL;
      const s = grid.get(x, z + 1) === T.WALL;
      const e = grid.get(x + 1, z) === T.WALL;
      const w = grid.get(x - 1, z) === T.WALL;
      if (!((n || s) && (e || w))) continue;
      if (hash32(`spk${x},${z},${level.id}`) % 100 > 30) continue;
      const occupied =
        level.enemies.some((en) => en.tx === x && en.tz === z) ||
        level.pickups.some((p) => p.tx === x && p.tz === z) ||
        level.pipes.some((p) => p.tx === x && p.tz === z) ||
        (level.start.tx === x && level.start.tz === z) ||
        (level.exit.tx === x && level.exit.tz === z);
      if (occupied) continue;
      const sx = cx(x) + (e ? 1 : -1) * (TILE / 2 - 0.45);
      const sz = cx(z) + (s ? 1 : -1) * (TILE / 2 - 0.45);
      const g = new THREE.Group();
      const box = new THREE.Mesh(spkGeo, spkMat);
      box.position.y = 0.65;
      g.add(box);
      const faceDir = new THREE.Vector3(e ? -1 : 1, 0, s ? -1 : 1).normalize();
      for (const yy of [0.4, 0.95]) {
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(faceDir.x * 0.43, yy, faceDir.z * 0.43);
        cone.lookAt(faceDir.x * 2, yy, faceDir.z * 2);
        g.add(cone);
        speakers.push(cone);
      }
      g.position.set(sx, 0, sz);
      root.add(g);
      grid.props.push({ minX: sx - 0.43, maxX: sx + 0.43, minZ: sz - 0.43, maxZ: sz + 0.43 });
      physics.addStaticBox(sx, 0.65, sz, 0.43, 0.65, 0.43);
    }
  }

  // 석고보드 가벽
  const drywalls = new Map();
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (grid.get(x, z) !== T.DRYWALL) continue;
      const mesh = new THREE.Mesh(geo.wallBox, mats.drywall);
      mesh.position.set(cx(x), WALL_H / 2, cx(z));
      root.add(mesh);
      const body = physics.addStaticBox(cx(x), WALL_H / 2, cx(z), TILE / 2, WALL_H / 2, TILE / 2);
      drywalls.set(z * W + x, { tx: x, tz: z, mesh, body });
    }
  }

  // 문
  const doorFrameMat = new THREE.MeshBasicMaterial({ color: palette[palette.length - 1].clone().multiplyScalar(0.9), toneMapped: false });
  disposables.push(doorFrameMat);
  const doors = level.doors.map((d) => {
    const g = new THREE.Group();
    g.position.set(cx(d.tx), 0, cx(d.tz));
    if (d.axis === 'z') g.rotation.y = Math.PI / 2;
    const panel = new THREE.Mesh(geo.doorPanel, d.locked ? mats.locked : mats.door);
    panel.position.y = DOOR_H / 2;
    g.add(panel);
    const lintel = new THREE.Mesh(geo.lintel, mats.wall);
    lintel.position.y = DOOR_H + (WALL_H - DOOR_H) / 2;
    g.add(lintel);
    // 문틀 네온(잠긴 문은 빨강) — 어디를 차야 하는지 한눈에
    const frameMat = d.locked ? mats.exitOff : doorFrameMat;
    for (const sx of [-1, 1]) {
      const bar = new THREE.Mesh(stripGeo, frameMat);
      bar.scale.set(0.03, DOOR_H / 0.07, 1.6);
      bar.position.set((sx * TILE) / 2 - sx * 0.02, DOOR_H / 2, 0);
      g.add(bar);
    }
    root.add(g);
    const hx = d.axis === 'x' ? TILE / 2 : DOOR_SLAB;
    const hz = d.axis === 'x' ? DOOR_SLAB : TILE / 2;
    const body = physics.addStaticBox(cx(d.tx), DOOR_H / 2, cx(d.tz), hx, DOOR_H / 2, hz);
    return { ...d, group: g, panel, body, state: 'closed', x: cx(d.tx), z: cx(d.tz) };
  });

  // 가스관
  const pipes = level.pipes.map((p) => {
    const [dx, dz] = DIR_VEC[p.dir];
    const px = cx(p.tx) + dx * (TILE / 2 - 0.2);
    const pz = cx(p.tz) + dz * (TILE / 2 - 0.2);
    const g = new THREE.Group();
    g.position.set(px, 0, pz);
    const pipe = new THREE.Mesh(geo.pipe, mats.pipe);
    pipe.position.y = WALL_H / 2;
    g.add(pipe);
    const valve = new THREE.Mesh(geo.valve, mats.metal);
    valve.position.set(-dx * 0.17, 1.25, -dz * 0.17);
    valve.rotation.y = Math.atan2(-dx, -dz); // 고리 면이 방 안쪽을 향하도록
    g.add(valve);
    const warn = new THREE.Mesh(stripGeo, mats.exitOff);
    warn.scale.set(0.12, 3, 4);
    warn.position.set(-dx * 0.14, 1.8, -dz * 0.14);
    g.add(warn);
    root.add(g);
    return { ...p, group: g, x: px, z: pz, out: [-dx, -dz], state: 'intact' };
  });

  // 샹들리에
  const chandeliers = level.chandeliers.map((c) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 20), mats.gold);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    disposables.push(ring.geometry);
    const crystalGeo = new THREE.OctahedronGeometry(0.1);
    disposables.push(crystalGeo);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const cr = new THREE.Mesh(crystalGeo, mats.crystal);
      cr.position.set(Math.cos(a) * 0.62, -0.18, Math.sin(a) * 0.62);
      g.add(cr);
    }
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mats.crystal);
    core.position.y = -0.1;
    disposables.push(core.geometry);
    g.add(core);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), mats.metal);
    chain.position.y = 0.42;
    disposables.push(chain.geometry);
    g.add(chain);
    const y = WALL_H - 0.85;
    g.position.set(cx(c.tx), y, cx(c.tz));
    root.add(g);
    return { ...c, group: g, chain, x: cx(c.tx), z: cx(c.tz), y, state: 'hanging', body: null };
  });

  // 출구
  const exit = (() => {
    const g = new THREE.Group();
    g.position.set(cx(level.exit.tx), 0, cx(level.exit.tz));
    const ring = new THREE.Mesh(geo.exitRing, mats.exitOff);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    const beam = new THREE.Mesh(geo.exitBeam, mats.exitOff);
    beam.position.y = WALL_H / 2;
    beam.material = mats.exitOff;
    g.add(beam);
    root.add(g);
    return { group: g, ring, beam, x: cx(level.exit.tx), z: cx(level.exit.tz), open: false };
  })();

  return {
    grid,
    walls,
    neon,
    neonMat,
    coneMat,
    speakers,
    drywalls,
    doors,
    pipes,
    chandeliers,
    exit,
    palette,
    dispose() {
      for (const d of disposables) d.dispose?.();
    },
  };
}

// 바닥에 놓인(또는 공중에 뜬) 무기
export function makePickupMesh(weapon) {
  const g = new THREE.Group();
  const gun = makeGunMesh(weapon);
  gun.scale.setScalar(1.6);
  g.add(gun);
  return g;
}
