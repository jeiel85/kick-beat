// 한 판(스테이지 1회 플레이)의 모든 게임플레이: 이동, 비트 판정 발차기, 패링, 문짝·가벽 파괴, 가스 폭발,
// 샹들리에, 적 AI, 투사체, 무기 탈취, 점수, 고스트. R 재시작은 이 객체를 버리고 새로 만든다.

import * as THREE from 'three';
import {
  BULLET_TIME,
  DOOR_H,
  ENEMY_SHOTS,
  ENEMY_TYPES,
  EXPLOSION,
  KICK,
  PLAYER,
  SCORE,
  TILE,
  WALL_H,
  WEAPONS,
} from '../config.js';
import { judge } from '../audio/beatClock.js';
import { T } from '../levels/parse.js';
import { getAssets } from './assets.js';
import { GhostRecorder, sampleGhost } from './ghost.js';
import { Grid, flowField } from './grid.js';
import { animateModel, createEnemyModel, spawnRagdoll } from './humanoid.js';
import { CANNON, G_DYN, G_ITEM, G_RAG, G_STATIC, Physics } from './physics.js';
import { addScore, applyJudgement, newStats } from './scoring.js';
import { buildWorld, makePickupMesh } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

function angleBetweenXZ(fx, fz, dx, dz) {
  const l = Math.hypot(dx, dz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / l)));
}

class Enemy {
  constructor(session, spec) {
    this.s = session;
    this.type = spec.type;
    this.cfg = ENEMY_TYPES[spec.type];
    this.pos = { x: Grid.center(spec.tx), z: Grid.center(spec.tz) };
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = this.cfg.hp;
    this.radius = 0.38 * (this.cfg.scale ?? 1);
    this.height = 1.9 * (this.cfg.scale ?? 1);
    this.alert = false;
    this.reaction = 0;
    this.senseT = Math.random() * 0.2;
    this.losT = 0;
    this.hasLos = false;
    this.cooldown = rand(...this.cfg.cooldown) * 0.6;
    this.windup = 0;
    this.burst = [];
    this.stagger = 0;
    this.push = { x: 0, z: 0 };
    this.dead = false;
    this.speedNow = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = rand(1, 2.5);
    this.model = createEnemyModel(spec.type);
    this.model.root.position.set(this.pos.x, 0, this.pos.z);
    session.root.add(this.model.root);
  }

  setAlert(delay) {
    if (this.alert || this.dead) return;
    this.alert = true;
    this.reaction = delay;
    this.model.alert.visible = true;
    this.alertShow = 0.8;
    this.s.sfxAt('alert', this.pos.x, this.pos.z, 0.6);
  }

  update(dt) {
    const s = this.s;
    const p = s.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    let moveX = 0;
    let moveZ = 0;
    let speed = 0;

    if (this.alertShow > 0) {
      this.alertShow -= dt;
      if (this.alertShow <= 0) this.model.alert.visible = false;
    }

    if (!this.alert) {
      this.senseT -= dt;
      if (this.senseT <= 0 && !p.dead) {
        this.senseT = 0.15;
        if (dist < 22 && s.grid.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
          const fx = -Math.sin(this.yaw);
          const fz = -Math.cos(this.yaw);
          if (dist < 5 || angleBetweenXZ(fx, fz, dx, dz) < 1.25) this.setAlert(rand(0.35, 0.55));
        }
      }
      this.yaw += Math.sin(performance.now() * 0.0004 + this.pos.x) * dt * 0.3;
    } else {
      this.losT -= dt;
      if (this.losT <= 0) {
        this.losT = 0.1;
        this.hasLos = !p.dead && s.grid.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
      }
      const targetYaw = Math.atan2(-dx, -dz);
      const turnRate = this.windup > 0 ? 1.6 : 7;
      this.yaw = turnToward(this.yaw, targetYaw, turnRate * dt);

      if (this.reaction > 0) {
        this.reaction -= dt;
      } else if (this.stagger > 0) {
        this.stagger -= dt;
        moveX = this.push.x;
        moveZ = this.push.z;
        speed = 1;
      } else {
        const melee = this.cfg.weapon === 'fists';
        // 이동
        if (this.windup <= 0) {
          let wantX = 0;
          let wantZ = 0;
          if (melee || !this.hasLos || dist > this.cfg.range * 0.75) {
            if (this.hasLos && dist < 8) {
              wantX = dx / dist;
              wantZ = dz / dist;
            } else {
              const step = s.flowStep(this.pos.x, this.pos.z);
              if (step) {
                wantX = step.x;
                wantZ = step.z;
              }
            }
          } else {
            // 사거리 안: 옆걸음으로 조준을 흔든다
            this.strafeT -= dt;
            if (this.strafeT <= 0) {
              this.strafe *= -1;
              this.strafeT = rand(0.8, 2);
            }
            wantX = (-dz / dist) * this.strafe * 0.6;
            wantZ = (dx / dist) * this.strafe * 0.6;
            if (dist < 4 && !melee) {
              wantX -= (dx / dist) * 0.6;
              wantZ -= (dz / dist) * 0.6;
            }
          }
          moveX = wantX;
          moveZ = wantZ;
          speed = this.cfg.speed;
        }
        // 공격
        if (melee) {
          if (this.windup <= 0 && dist < 2.0 && this.hasLos) this.windup = this.cfg.windup;
        } else if (this.hasLos && dist <= this.cfg.range && this.windup <= 0) {
          this.cooldown -= dt;
          if (this.cooldown <= 0) this.windup = this.cfg.windup;
        }
        if (this.windup > 0) {
          speed *= 0.25;
          if (!this.hasLos && !melee) {
            this.windup = 0;
            this.cooldown = 0.4;
          } else {
            this.windup -= dt;
            if (this.windup <= 0) {
              this.windup = 0;
              this.cooldown = rand(...this.cfg.cooldown);
              this.attack(dist);
            }
          }
        }
      }
      if (this.burst.length) {
        for (let i = this.burst.length - 1; i >= 0; i--) {
          this.burst[i] -= dt;
          if (this.burst[i] <= 0) {
            this.burst.splice(i, 1);
            this.fireOne();
          }
        }
      }
    }

    if (speed > 0 && (moveX || moveZ)) {
      const l = Math.hypot(moveX, moveZ);
      this.pos.x += (moveX / l) * speed * dt * Math.min(1, l);
      this.pos.z += (moveZ / l) * speed * dt * Math.min(1, l);
      s.grid.collideCircle(this.pos, this.radius);
    }
    this.speedNow += ((speed > 0 ? speed : 0) - this.speedNow) * Math.min(1, dt * 8);
    this.model.root.position.set(this.pos.x, 0, this.pos.z);
    this.model.root.rotation.y = this.yaw;
    const windupK = this.windup > 0 ? 1 - this.windup / this.cfg.windup : 0;
    animateModel(this.model, dt, { speed: this.speedNow, aiming: this.alert && this.reaction <= 0, windup: windupK });
  }

  attack(dist) {
    const s = this.s;
    if (this.cfg.weapon === 'fists') {
      const p = s.player;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      if (dist < 2.3 && angleBetweenXZ(fx, fz, p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 0.9) {
        s.hurtPlayer(1, { x: fx, z: fz }, 'bruiser');
      }
      s.sfxAt('whoosh', this.pos.x, this.pos.z, 1);
      return;
    }
    const spec = ENEMY_SHOTS[this.cfg.weapon];
    if (spec.burst) {
      this.fireOne();
      for (let i = 1; i < spec.count; i++) this.burst.push(spec.burst * i);
    } else {
      for (let i = 0; i < spec.count; i++) this.fireOne(i === 0);
    }
  }

  fireOne(withSound = true) {
    const s = this.s;
    if (this.dead || s.player.dead) return;
    const spec = ENEMY_SHOTS[this.cfg.weapon];
    const muzzle = new THREE.Vector3();
    this.model.muzzle.getWorldPosition(muzzle);
    // 총구가 벽 속에 있으면 몸 중심에서 쏜다
    if (s.grid.pointBlocked(muzzle.x, muzzle.z)) muzzle.set(this.pos.x, 1.4, this.pos.z);
    const target = new THREE.Vector3(s.player.pos.x, s.player.pos.y + 1.2, s.player.pos.z);
    const dir = target.sub(muzzle).normalize();
    // 한 번 호출 = 탄 한 발(샷건은 attack()이 여러 번 부른다)
    const d = dir.clone();
    d.x += (Math.random() - 0.5) * spec.spread * 2;
    d.y += (Math.random() - 0.5) * spec.spread;
    d.z += (Math.random() - 0.5) * spec.spread * 2;
    d.normalize();
    s.spawnProjectile({ kind: spec.kind, owner: 'enemy', pos: muzzle.clone(), vel: d.multiplyScalar(spec.speed), damage: spec.damage });
    if (withSound) s.sfxAt(spec.kind === 'rocket' ? 'launcher' : 'enemyShot', this.pos.x, this.pos.z, 0.9);
    s.fx.spark(muzzle, dir, 3, 0xff6a3a, 3);
    s.checkGasSpark(muzzle);
  }
}

function turnToward(a, b, maxStep) {
  let d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  if (Math.abs(d) > maxStep) d = Math.sign(d) * maxStep;
  return a + d;
}

export class Session {
  /**
   * @param {object} ctx {scene, camera, vm, audio, input, settings, sneaker, hud, fx}
   * @param {object} level parseLevel 결과
   * @param {object} stage 스테이지 정의(par, challenge 등)
   * @param {object|null} ghost 경쟁할 고스트
   */
  constructor(ctx, level, stage, ghost) {
    this.ctx = ctx;
    this.level = level;
    this.stage = stage;
    this.audio = ctx.audio;
    this.fx = ctx.fx;
    this.hud = ctx.hud;
    this.vm = ctx.vm;
    this.sneaker = ctx.sneaker;
    this.settings = ctx.settings;
    this.camera = ctx.camera;

    this.root = new THREE.Group();
    ctx.scene.add(this.root);
    this.physics = new Physics();
    this.world = buildWorld(level, this.physics, this.root);
    this.grid = this.world.grid;

    this.state = 'playing';
    this.stats = newStats();
    this.time = 0;
    this.timeScale = 1;
    this.btRemaining = 0;
    this.ghostRec = new GhostRecorder();
    this.ghost = ghost;
    this.flow = null;
    this.flowKey = '';
    this.flowT = 0;
    this.pendingExplosions = [];
    this.projectiles = [];
    this.pickups = [];
    this.flyingDoors = [];
    this.debris = [];
    this.ragdolls = [];
    this.clouds = [];
    this.events = [];
    this.lastHint = null;

    const sx = Grid.center(level.start.tx);
    const sz = Grid.center(level.start.tz);
    this.player = {
      pos: { x: sx, y: 0, z: sz },
      vel: { x: 0, y: 0, z: 0 },
      yaw: level.start.yaw,
      pitch: 0,
      hp: PLAYER.maxHp,
      onGround: true,
      invuln: 0,
      weapon: null,
      kickCd: 0,
      fireCd: 0,
      dead: false,
      deadT: 0,
      moveAmt: 0,
    };
    this.vm.setWeapon(null);
    this.vm.setSneaker(this.sneaker);

    this.enemies = level.enemies.map((e) => new Enemy(this, e));
    for (const p of level.pickups) {
      this.addPickup(p.weapon, WEAPONS[p.weapon].ammo, new THREE.Vector3(Grid.center(p.tx), 0.9, Grid.center(p.tz)), null);
    }
    this.aliveCount = this.enemies.length;
    if (this.aliveCount === 0) this.openExit();

    if (ghost) {
      const { mats } = getAssets();
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 10), mats.ghost);
      body.position.y = 0.9;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mats.ghost);
      head.position.y = 1.7;
      g.add(head);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.5), mats.ghost);
      foot.position.set(0.15, 0.6, -0.4);
      foot.visible = false;
      g.add(foot);
      this.ghostMesh = g;
      this.ghostFoot = foot;
      this.ghostDisposables = [body.geometry, head.geometry, foot.geometry];
      g.visible = this.settings.showGhost;
      this.root.add(g);
    }
    this.updateCamera(0);
  }

  dispose() {
    this.ctx.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.userData?.perLevel) o.geometry.dispose();
    });
    this.world.dispose();
    this.ghostDisposables?.forEach((g) => g.dispose());
    this.projectiles.length = 0;
  }

  // ───────── 보조 ─────────

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  sfxAt(name, x, z, vol = 1, extra = {}) {
    const p = this.player;
    const dx = x - p.pos.x;
    const dz = z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    const pan = d > 0.5 ? (dx * rx + dz * rz) / d : 0;
    this.audio.sfx(name, { pan: pan * 0.8, vol: (vol * 1) / (1 + d * 0.07), ...extra });
  }

  forward3() {
    const p = this.player;
    return new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
  }

  eye() {
    const p = this.player;
    return new THREE.Vector3(p.pos.x, p.pos.y + PLAYER.eye, p.pos.z);
  }

  flowStep(x, z) {
    if (!this.flow) return null;
    const tx = Grid.tileOf(x);
    const tz = Grid.tileOf(z);
    const w = this.grid.w;
    const here = this.flow[tz * w + tx];
    if (here <= 0) return null;
    let best = null;
    let bestD = here;
    for (const [ox, oz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const d = this.flow[(tz + oz) * w + tx + ox];
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = [tx + ox, tz + oz];
      }
    }
    if (!best) return null;
    const cx = Grid.center(best[0]) - x;
    const cz = Grid.center(best[1]) - z;
    const l = Math.hypot(cx, cz) || 1;
    return { x: cx / l, z: cz / l };
  }

  noise(x, z, radius) {
    for (const e of this.enemies) {
      if (e.dead || e.alert) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < radius && (d < radius * 0.45 || this.grid.los(x, z, e.pos.x, e.pos.z))) e.setAlert(rand(0.25, 0.5));
    }
  }

  startBulletTime() {
    const dur = BULLET_TIME.duration * this.sneaker.bulletTimeMult;
    if (this.btRemaining <= 0) this.audio.bulletTime(true);
    this.btRemaining = Math.max(this.btRemaining, dur);
  }

  // ───────── 프레임 ─────────

  update(realDt, input) {
    this.events.length = 0;
    const p = this.player;

    // 시간 배율: 불릿타임 중 세계는 느려지고 플레이어는 덜 느려진다
    const target = p.dead ? 0.25 : this.btRemaining > 0 ? BULLET_TIME.scale : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, realDt * (target < this.timeScale ? 30 : 8));
    const dt = realDt * this.timeScale;
    const pdt = realDt * (this.timeScale + (1 - this.timeScale) * 0.55);
    if (this.btRemaining > 0) {
      this.btRemaining -= dt;
      if (this.btRemaining <= 0) this.audio.bulletTime(false);
    }

    // 입력
    const { dx, dy } = input.consumeMouse();
    const sens = 0.0022 * this.settings.sensitivity;
    p.yaw -= dx * sens + input.pad.lookX * realDt * 3.2 * this.settings.sensitivity;
    p.pitch -= (dy * sens + input.pad.lookY * realDt * 2.4 * this.settings.sensitivity) * (this.settings.invertY ? -1 : 1);
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    for (const a of input.consumeActions()) {
      if (a.type === 'restart') this.emit('restart');
      else if (a.type === 'pause') this.emit('pause');
      else if (this.state !== 'playing' || p.dead) continue;
      else if (a.type === 'kick') this.kick(a.time);
      else if (a.type === 'fire') this.fire(true);
      else if (a.type === 'jump' && p.onGround) {
        p.vel.y = PLAYER.jump;
        p.onGround = false;
      } else if (a.type === 'throw') this.throwWeapon();
    }
    if (this.state === 'playing' && !p.dead && input.firing() && p.weapon && WEAPONS[p.weapon.type].auto) this.fire(false);

    if (this.state === 'playing' && !p.dead) {
      this.time += dt;
      this.stats.time = this.time;
      this.movePlayer(pdt, input);
      this.ghostRec.record(dt, p.pos.x, p.pos.z, p.yaw);
    } else if (p.dead) {
      p.deadT += realDt;
    }
    p.kickCd -= pdt;
    p.fireCd -= pdt;
    p.invuln -= dt;

    // 적 경로장(플레이어 타일·맵 변화 시)
    this.flowT -= dt;
    const key = `${Grid.tileOf(p.pos.x)},${Grid.tileOf(p.pos.z)},${this.grid.version}`;
    if (key !== this.flowKey && this.flowT <= 0) {
      this.flowKey = key;
      this.flowT = 0.2;
      this.flow = flowField(this.grid, Grid.tileOf(p.pos.x), Grid.tileOf(p.pos.z));
    }
    for (const e of this.enemies) if (!e.dead) e.update(dt);
    this.separateEnemies();
    this.updateProjectiles(dt);
    this.physics.step(dt);
    this.updateDynamics(dt);
    this.updateClouds(dt);
    this.updatePickups(dt, realDt);
    for (let i = this.pendingExplosions.length - 1; i >= 0; i--) {
      const ex = this.pendingExplosions[i];
      ex.delay -= dt;
      if (ex.delay <= 0) {
        this.pendingExplosions.splice(i, 1);
        this.explode(ex.pos, ex.kind);
      }
    }

    // 출구
    if (this.world.exit.open && this.state === 'playing' && !p.dead) {
      if (Math.hypot(p.pos.x - this.world.exit.x, p.pos.z - this.world.exit.z) < 1.0) {
        this.state = 'cleared';
        this.audio.bulletTime(false);
        this.audio.sfx('clear');
        this.emit('cleared');
      }
    }
    this.updateGhost();
    this.updateHint();
    this.updateCamera(realDt);
    this.vm.update(pdt, this.camera, p.moveAmt);
    this.fx.update(dt, realDt);
    return this.events;
  }

  movePlayer(dt, input) {
    const p = this.player;
    const mv = input.moveVector();
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    // 앞(-z) 기준 회전
    const wishX = mv.x * cos + mv.y * sin;
    const wishZ = -mv.x * sin + mv.y * cos;
    const speed = PLAYER.speed * this.sneaker.moveSpeed;
    const accel = p.onGround ? PLAYER.accel : PLAYER.airAccel;
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 0.01) {
      const tx = (wishX / Math.max(1, wl)) * speed;
      const tz = (wishZ / Math.max(1, wl)) * speed;
      p.vel.x += Math.max(-accel * dt, Math.min(accel * dt, tx - p.vel.x));
      p.vel.z += Math.max(-accel * dt, Math.min(accel * dt, tz - p.vel.z));
    } else if (p.onGround) {
      const f = Math.max(0, 1 - PLAYER.friction * dt);
      p.vel.x *= f;
      p.vel.z *= f;
    }
    p.vel.y -= PLAYER.gravity * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    p.pos.y += p.vel.y * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vel.y = 0;
      p.onGround = true;
    }
    this.grid.collideCircle(p.pos, PLAYER.radius);
    p.moveAmt = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / PLAYER.speed) * (p.onGround ? 1 : 0.2);
  }

  updateCamera(realDt) {
    const p = this.player;
    const cam = this.camera;
    const sh = this.fx.shakeOffset();
    let eyeY = p.pos.y + PLAYER.eye;
    let roll = sh.roll;
    if (p.dead) {
      const k = Math.min(1, p.deadT / 0.7);
      eyeY = Math.max(0.35, eyeY - k * 1.25);
      roll += k * 0.6;
    }
    cam.position.set(p.pos.x + sh.x, eyeY + sh.y, p.pos.z);
    cam.rotation.set(p.pitch, p.yaw, roll, 'YXZ');
    const targetFov = this.settings.fov + (this.btRemaining > 0 ? 6 : 0) + p.moveAmt * 3;
    cam.fov += (targetFov - cam.fov) * Math.min(1, realDt * 8);
    cam.updateProjectionMatrix();
  }

  // ───────── 발차기 ─────────

  kick(evTime) {
    const p = this.player;
    if (p.kickCd > 0) return;
    p.kickCd = KICK.cooldown;
    this.vm.kick();
    this.ghostRec.markKick();
    const heard = this.audio.heardTime(evTime) - this.settings.audioOffsetMs / 1000;
    const delta = this.audio.clock.deltaMs(heard);
    const res = judge(delta, this.sneaker.perfectBonusMs);
    const force = this.sneaker.kickForce * (res === 'perfect' ? 1.6 : res === 'good' ? 1.25 : 1);
    const perfect = res === 'perfect';
    const eye = this.eye();
    const f3 = this.forward3();
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let hit = false;

    // 1) 패링: 앞쪽 원뿔 안의 적 탄
    if (this.sneaker.kickParry) {
      for (const pr of this.projectiles) {
        if (pr.owner !== 'enemy' || pr.dead) continue;
        tmpV.copy(pr.pos).sub(eye);
        const d = tmpV.length();
        if (d < KICK.parryRange && tmpV.angleTo(f3) < KICK.parryCone) {
          this.parry(pr, f3);
          hit = true;
        }
      }
    }

    // 2) 문
    let bestDoor = null;
    let bestD = Infinity;
    for (const d of this.world.doors) {
      if (d.state !== 'closed') continue;
      // 문판 위의 가장 가까운 점
      const box = this.grid.tileBox(d.tx, d.tz);
      const cx = Math.min(Math.max(p.pos.x, box.minX), box.maxX);
      const cz = Math.min(Math.max(p.pos.z, box.minZ), box.maxZ);
      const dist = Math.hypot(cx - p.pos.x, cz - p.pos.z);
      if (dist > KICK.reach) continue;
      if (dist > 0.6 && angleBetweenXZ(fx, fz, cx - p.pos.x, cz - p.pos.z) > KICK.cone) continue;
      if (dist < bestD) {
        bestD = dist;
        bestDoor = d;
      }
    }
    if (bestDoor) {
      if (bestDoor.locked && !this.sneaker.breachReinforced) {
        this.sfxAt('locked', bestDoor.x, bestDoor.z, 1);
        this.hud.toast('잠긴 문 — 옆의 석고보드 벽을 뚫어라');
        this.fx.shake(0.15);
        hit = true;
      } else {
        // 문짝은 문판에 수직한 방향(플레이어 쪽에서 먼 쪽)으로 날아간다
        let nx = bestDoor.axis === 'x' ? 0 : 1;
        let nz = bestDoor.axis === 'x' ? 1 : 0;
        if (nx * (bestDoor.x - p.pos.x) + nz * (bestDoor.z - p.pos.z) < 0) {
          nx = -nx;
          nz = -nz;
        }
        const dir = new THREE.Vector3(nx * 0.7 + fx * 0.3, 0, nz * 0.7 + fz * 0.3).normalize();
        this.breachDoor(bestDoor, dir, force, perfect);
        hit = true;
      }
    }

    // 3) 적
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.pos.x - p.pos.x;
      const ez = e.pos.z - p.pos.z;
      const d = Math.hypot(ex, ez) - e.radius;
      if (d > KICK.reach * 0.85) continue;
      if (d > 0.3 && angleBetweenXZ(fx, fz, ex, ez) > KICK.cone) continue;
      if (!this.grid.los(p.pos.x, p.pos.z, e.pos.x, e.pos.z)) continue;
      const v = new THREE.Vector3(fx, 0.35, fz).normalize().multiplyScalar(KICK.enemySpeed * force);
      v.y += 2.5;
      if (!this.knock(e, v, 'kick', { perfect })) this.sfxAt('kickHit', e.pos.x, e.pos.z, 1);
      hit = true;
    }

    // 4) 석고보드 가벽(또는 스틸토로 잠긴 문 너머 벽은 아님)
    const ray = this.grid.raycast(p.pos.x, p.pos.z, fx, fz, KICK.reach + 0.4);
    if (ray && ray.tile === T.DRYWALL) {
      const dw = this.world.drywalls.get(ray.tz * this.grid.w + ray.tx);
      if (dw) {
        this.breachWall(dw, new THREE.Vector3(fx, 0, fz), force);
        hit = true;
      }
    }

    // 5) 가스관
    for (const pipe of this.world.pipes) {
      if (pipe.state !== 'intact') continue;
      const ex = pipe.x - p.pos.x;
      const ez = pipe.z - p.pos.z;
      const d = Math.hypot(ex, ez);
      if (d < KICK.reach && (d < 0.7 || angleBetweenXZ(fx, fz, ex, ez) < KICK.cone)) {
        this.leakPipe(pipe);
        hit = true;
      }
    }

    // 6) 쓰러진 몸·파편·문짝 저글링
    for (const l of this.physics.links) {
      const b = l.body;
      const ex = b.position.x - p.pos.x;
      const ez = b.position.z - p.pos.z;
      const d = Math.hypot(ex, ez);
      if (d < KICK.reach && b.position.y < 2.2 && angleBetweenXZ(fx, fz, ex, ez) < KICK.cone) {
        b.wakeUp();
        const imp = 9 * force * b.mass;
        b.applyImpulse(new CANNON.Vec3(fx * imp, imp * 0.35, fz * imp));
        hit = true;
      }
    }

    this.hud.judgement(res, delta);
    if (hit) {
      applyJudgement(this.stats, res);
      if (perfect) {
        this.startBulletTime();
        const pts = addScore(this.stats, SCORE.perfectKick);
        this.fx.popup(`PERFECT +${pts}`, eye.clone().addScaledVector(f3, 1.5), 'perfect');
        this.audio.sfx('perfect');
      } else if (res === 'good') this.audio.sfx('good');
      this.audio.sfx('kickHit', { strength: force });
      this.fx.shake(0.25 * force);
    } else {
      this.audio.sfx('whoosh');
    }
  }

  breachDoor(door, dir, force, perfect) {
    door.state = 'flying';
    this.grid.setFloor(door.tx, door.tz);
    this.physics.remove(door.body);
    const panel = door.panel;
    this.root.attach(panel);
    const body = new CANNON.Body({
      mass: 22,
      shape: new CANNON.Box(new CANNON.Vec3(TILE * 0.46, DOOR_H / 2, 0.07)),
      position: new CANNON.Vec3(panel.position.x, panel.position.y + 0.3, panel.position.z),
      quaternion: new CANNON.Quaternion(panel.quaternion.x, panel.quaternion.y, panel.quaternion.z, panel.quaternion.w),
      material: this.physics.matSlick,
      collisionFilterGroup: G_DYN,
      collisionFilterMask: G_STATIC | G_DYN | G_RAG,
      angularDamping: 0.25,
    });
    const speed = KICK.doorSpeed * force;
    body.velocity.set(dir.x * speed, 3.2, dir.z * speed);
    // 수평으로 돌며 날아가게(앞뒤로 구르면 바로 바닥에 박힌다)
    body.angularVelocity.set(rand(-0.8, 0.8), rand(-4, 4) * (perfect ? 1.5 : 1), rand(-0.8, 0.8));
    this.physics.link(body, panel, 12);
    this.flyingDoors.push({ door, body, t: 0, victims: 0 });
    this.noise(door.x, door.z, 16);
    this.sfxAt('door', door.x, door.z, 1.2);
    this.fx.spark(new THREE.Vector3(door.x, 1.2, door.z), dir, 14, 0xffe0a0, 6);
    this.fx.shake(0.35);
  }

  breachWall(dw, dir, force) {
    const { geo, mats } = getAssets();
    this.world.drywalls.delete(dw.tz * this.grid.w + dw.tx);
    this.root.remove(dw.mesh);
    this.physics.remove(dw.body);
    this.grid.setFloor(dw.tx, dw.tz);
    const cx = Grid.center(dw.tx);
    const cz = Grid.center(dw.tz);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(geo.debris, mats.debris);
      const body = new CANNON.Body({
        mass: 1.5,
        shape: new CANNON.Box(new CANNON.Vec3(0.21, 0.21, 0.05)),
        position: new CANNON.Vec3(cx + rand(-0.9, 0.9), rand(0.3, 2.9), cz + rand(-0.9, 0.9)),
        collisionFilterGroup: G_DYN,
        collisionFilterMask: G_STATIC | G_DYN | G_RAG,
      });
      const sp = rand(5, 12) * force;
      body.velocity.set(dir.x * sp + rand(-2, 2), rand(0, 3), dir.z * sp + rand(-2, 2));
      body.angularVelocity.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      this.root.add(mesh);
      this.physics.link(body, mesh, 6);
      this.debris.push({ body, t: 0 });
    }
    // 벽 너머에 붙어 있던 적은 함께 날아간다
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.pos.x - cx;
      const ez = e.pos.z - cz;
      if (Math.hypot(ex, ez) < 2.6 && ex * dir.x + ez * dir.z > -0.4) {
        const v = new THREE.Vector3(dir.x * 9 * force, 3, dir.z * 9 * force);
        this.knock(e, v, 'wall', { perfect: true });
      }
    }
    this.noise(cx, cz, 15);
    this.sfxAt('wall', cx, cz, 1.2);
    this.fx.spark(new THREE.Vector3(cx, 1.4, cz), dir, 18, 0xd9c8b8, 7);
    this.fx.shake(0.45);
  }

  parry(pr, f3) {
    // 시선 25° 안에 적이 있으면 그쪽으로 보정해 돌려보낸다
    const eye = this.eye();
    let aim = f3.clone();
    let bestA = 0.45;
    for (const e of this.enemies) {
      if (e.dead) continue;
      tmpV2.set(e.pos.x, 1.2 * (e.cfg.scale ?? 1), e.pos.z).sub(eye);
      const a = tmpV2.angleTo(f3);
      if (a < bestA && this.grid.los(this.player.pos.x, this.player.pos.z, e.pos.x, e.pos.z)) {
        bestA = a;
        aim = tmpV2.clone().normalize();
      }
    }
    const speed = Math.max(pr.vel.length() * 1.7, 22);
    pr.vel.copy(aim).multiplyScalar(speed);
    pr.owner = 'player';
    pr.parried = true;
    pr.life = 3;
    if (pr.kind !== 'rocket') pr.mesh.material = getAssets().mats.bulletPlayer;
    this.stats.parries++;
    this.audio.sfx('parry');
    this.fx.spark(pr.pos, aim, 10, 0x2bf0ff, 6);
    this.fx.popup('PARRY', pr.pos, 'parry');
  }

  // ───────── 적 처치 ─────────

  knock(e, vel, cause, opts = {}) {
    if (e.dead) return false;
    const heavyCause = ['door', 'explosion', 'crush', 'wall', 'parry'].includes(cause);
    if (e.hp > 1 && !heavyCause && !opts.perfect) {
      e.hp--;
      e.stagger = 0.55;
      const l = Math.hypot(vel.x, vel.z) || 1;
      e.push = { x: (vel.x / l) * 1.2, z: (vel.z / l) * 1.2 };
      e.windup = 0;
      e.setAlert(0);
      this.fx.popup('BLOCK', new THREE.Vector3(e.pos.x, 2.1, e.pos.z), 'block');
      return false;
    }
    e.dead = true;
    this.aliveCount--;
    const rag = spawnRagdoll(this.physics, e.model, this.root, vel, cause === 'explosion' ? 12 : 6);
    this.ragdolls.push({ torso: rag.torso, t: 0, cause });
    if (e.cfg.drop) {
      const pos = new THREE.Vector3(e.pos.x, 1.3, e.pos.z);
      const v = new THREE.Vector3(vel.x * 0.35 + rand(-1.5, 1.5), 5 + rand(0, 2), vel.z * 0.35 + rand(-1.5, 1.5));
      this.addPickup(e.cfg.drop, WEAPONS[e.cfg.drop].ammo, pos, v);
    }
    const base = { kick: SCORE.kick, door: SCORE.door, shot: SCORE.shot, parry: SCORE.parry, explosion: SCORE.explosion, crush: SCORE.crush, thrown: SCORE.thrown, ragdoll: SCORE.ragdoll, wall: SCORE.wall }[cause] ?? 100;
    const pts = addScore(this.stats, base + (e.cfg.score - 100));
    this.stats.kills++;
    if (cause === 'explosion') this.stats.explosionKills++;
    if (cause === 'parry') this.stats.parryKills++;
    const label = { kick: 'KICK', door: 'DOOR', shot: 'SHOT', parry: 'PARRY KILL', explosion: 'BOOM', crush: 'CRUSH', thrown: 'THROWN', ragdoll: 'BOWLING', wall: 'BREACH' }[cause] ?? 'KILL';
    this.fx.popup(`+${pts} ${label}`, new THREE.Vector3(e.pos.x, 1.9, e.pos.z), cause);
    this.noise(e.pos.x, e.pos.z, 8);
    this.emit('kill', { cause });
    if (this.aliveCount === 0) this.openExit();
    return true;
  }

  openExit() {
    const ex = this.world.exit;
    if (ex.open) return;
    ex.open = true;
    const { mats } = getAssets();
    ex.ring.material = mats.exitOn;
    ex.beam.material = mats.exitOn;
    if (this.enemies.length) {
      this.audio.sfx('exitOpen');
      this.hud.banner('출구 개방 — 달려!');
    }
  }

  // ───────── 사격·무기 ─────────

  fire(clicked) {
    const p = this.player;
    if (!p.weapon || p.fireCd > 0) {
      if (!p.weapon && clicked) this.hud.toast('맨손이다 — 적을 차서 총을 빼앗아라');
      return;
    }
    const w = WEAPONS[p.weapon.type];
    if (p.weapon.ammo <= 0) {
      if (clicked) {
        this.audio.sfx('empty');
        this.hud.toast('탄창이 비었다 — Q로 던져라');
      }
      p.fireCd = 0.25;
      return;
    }
    p.weapon.ammo--;
    p.fireCd = w.interval;
    this.vm.fire();
    this.audio.sfx(p.weapon.type);
    this.noise(p.pos.x, p.pos.z, 18);
    const eye = this.eye();
    const f3 = this.forward3();
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const muzzle = eye.clone().addScaledVector(f3, 0.7).addScaledVector(right, 0.22).add(new THREE.Vector3(0, -0.18, 0));
    this.fx.flash(muzzle, 8, 0xffc070, 0.06);
    if (w.rocket) {
      this.spawnProjectile({ kind: 'rocket', owner: 'player', pos: eye.clone().addScaledVector(f3, 0.8), vel: f3.clone().multiplyScalar(19), damage: 2 });
    } else {
      for (let i = 0; i < w.pellets; i++) {
        const d = f3.clone();
        d.x += (Math.random() - 0.5) * w.spread * 2;
        d.y += (Math.random() - 0.5) * w.spread * 2;
        d.z += (Math.random() - 0.5) * w.spread * 2;
        d.normalize();
        this.hitscan(eye, d, w.range, muzzle);
      }
    }
    this.emit('ammo');
  }

  hitscan(o, d, range, muzzle) {
    let maxT = range;
    const dh = Math.hypot(d.x, d.z);
    if (dh > 1e-4) {
      const r = this.grid.raycast(o.x, o.z, d.x / dh, d.z / dh, range * dh);
      if (r) maxT = Math.min(maxT, r.dist / dh);
    }
    if (d.y < 0) maxT = Math.min(maxT, -o.y / d.y);
    if (d.y > 0) maxT = Math.min(maxT, (WALL_H - o.y) / d.y);

    let hitT = maxT;
    let target = null;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const t = rayCylinder(o, d, e.pos.x, e.pos.z, e.radius + 0.05, e.height);
      if (t !== null && t < hitT) {
        hitT = t;
        target = { type: 'enemy', e };
      }
    }
    for (const c of this.world.chandeliers) {
      if (c.state !== 'hanging') continue;
      const t = raySphere(o, d, new THREE.Vector3(c.x, c.y - 0.05, c.z), 0.8);
      if (t !== null && t < hitT) {
        hitT = t;
        target = { type: 'chandelier', c };
      }
    }
    for (const pipe of this.world.pipes) {
      if (pipe.state !== 'intact') continue;
      const t = rayCylinder(o, d, pipe.x, pipe.z, 0.24, WALL_H);
      if (t !== null && t < hitT) {
        hitT = t;
        target = { type: 'pipe', pipe };
      }
    }
    // 총탄이 가스 구름을 지나가면 불꽃이 튄다
    for (const c of this.clouds) {
      if (c.ignited) continue;
      const t = raySphere(o, d, c.pos, c.r);
      if (t !== null && t < hitT) this.igniteCloud(c);
    }
    const hit = o.clone().addScaledVector(d, hitT);
    this.fx.tracer(muzzle, hit);
    if (target?.type === 'enemy') {
      const v = d.clone().multiplyScalar(9);
      v.y = Math.max(v.y, 0) + 2;
      this.knock(target.e, v, 'shot');
      this.fx.spark(hit, d.clone().negate(), 6, 0xff3355, 4);
    } else if (target?.type === 'chandelier') {
      this.dropChandelier(target.c);
    } else if (target?.type === 'pipe') {
      this.leakPipe(target.pipe);
      this.igniteCloud(this.clouds[this.clouds.length - 1], 0.02);
    } else {
      this.fx.spark(hit, d.clone().negate(), 5, 0xffd36b, 4);
    }
  }

  throwWeapon() {
    const p = this.player;
    if (!p.weapon) return;
    const eye = this.eye();
    const f3 = this.forward3();
    this.spawnProjectile({ kind: 'thrown', owner: 'player', pos: eye.clone().addScaledVector(f3, 0.6), vel: f3.clone().multiplyScalar(20).add(new THREE.Vector3(0, 1.5, 0)), damage: 1, weapon: p.weapon.type });
    p.weapon = null;
    this.vm.setWeapon(null);
    this.audio.sfx('throw');
    this.emit('ammo');
  }

  addPickup(weapon, ammo, pos, vel) {
    const mesh = makePickupMesh(weapon);
    mesh.position.copy(pos);
    this.root.add(mesh);
    const pk = { weapon, ammo, mesh, body: null, spin: Math.random() * 6, grounded: !vel };
    if (vel) {
      const body = new CANNON.Body({
        mass: 2,
        shape: new CANNON.Box(new CANNON.Vec3(0.12, 0.1, 0.3)),
        position: new CANNON.Vec3(pos.x, pos.y, pos.z),
        collisionFilterGroup: G_ITEM,
        collisionFilterMask: G_STATIC,
      });
      body.velocity.set(vel.x, vel.y, vel.z);
      body.angularVelocity.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
      this.physics.link(body, mesh, 30);
      pk.body = body;
    }
    this.pickups.push(pk);
  }

  updatePickups(dt, realDt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (!pk.body) {
        pk.spin += realDt * 2;
        pk.mesh.rotation.y = pk.spin;
        pk.mesh.position.y = 0.9 + Math.sin(pk.spin * 2) * 0.08;
      }
      if (p.dead) continue;
      const mp = pk.mesh.position;
      const d = Math.hypot(mp.x - p.pos.x, mp.z - p.pos.z);
      const dy = mp.y - (p.pos.y + 1);
      if (d < 1.5 && Math.abs(dy) < 1.8 && (!p.weapon || p.weapon.ammo <= 0)) {
        const airborne = pk.body && pk.body.position.y > 0.7 && pk.body.velocity.length() > 1.5;
        if (pk.body) this.physics.remove(pk.body);
        this.root.remove(pk.mesh);
        this.pickups.splice(i, 1);
        p.weapon = { type: pk.weapon, ammo: pk.ammo };
        this.vm.setWeapon(pk.weapon);
        this.audio.sfx('pickup');
        if (airborne) {
          this.stats.hijacks++;
          const pts = addScore(this.stats, SCORE.hijack);
          this.fx.popup(`HIJACK +${pts}`, this.eye().addScaledVector(this.forward3(), 1.2), 'hijack');
        }
        this.emit('ammo');
      }
    }
  }

  // ───────── 투사체 ─────────

  spawnProjectile(o) {
    const { mats, geo } = getAssets();
    let mesh;
    if (o.kind === 'rocket') mesh = new THREE.Mesh(geo.rocket, mats.rocket);
    else if (o.kind === 'pellet') mesh = new THREE.Mesh(geo.pellet, o.owner === 'enemy' ? mats.bulletEnemy : mats.bulletPlayer);
    else if (o.kind === 'thrown') mesh = makePickupMesh(o.weapon);
    else mesh = new THREE.Mesh(geo.bullet, o.owner === 'enemy' ? mats.bulletEnemy : mats.bulletPlayer);
    mesh.position.copy(o.pos);
    this.root.add(mesh);
    this.projectiles.push({ ...o, mesh, life: o.kind === 'rocket' ? 6 : 4, radius: o.kind === 'rocket' ? 0.18 : o.kind === 'thrown' ? 0.3 : 0.1, dead: false, spin: 0 });
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      pr.life -= dt;
      if (pr.life <= 0) {
        pr.dead = true;
        continue;
      }
      const stepLen = pr.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(stepLen / 0.25));
      const sdt = dt / steps;
      for (let k = 0; k < steps && !pr.dead; k++) {
        if (pr.kind === 'thrown') pr.vel.y -= 9 * sdt;
        pr.pos.addScaledVector(pr.vel, sdt);
        // 벽·바닥·천장
        if (this.grid.pointBlocked(pr.pos.x, pr.pos.z) || pr.pos.y < 0.02 || pr.pos.y > WALL_H - 0.02) {
          this.projectileImpact(pr);
          break;
        }
        // 가스 구름
        for (const c of this.clouds) {
          if (!c.ignited && pr.kind !== 'thrown' && pr.pos.distanceTo(c.pos) < c.r) this.igniteCloud(c);
        }
        if (pr.owner === 'enemy') {
          if (!p.dead) {
            const cy = Math.min(Math.max(pr.pos.y, p.pos.y + 0.3), p.pos.y + 1.6);
            const d = Math.hypot(pr.pos.x - p.pos.x, pr.pos.y - cy, pr.pos.z - p.pos.z);
            if (d < 0.42 + pr.radius) {
              if (pr.kind === 'rocket') this.projectileImpact(pr);
              else {
                const l = Math.hypot(pr.vel.x, pr.vel.z) || 1;
                this.hurtPlayer(pr.damage, { x: pr.vel.x / l, z: pr.vel.z / l }, pr.kind);
                pr.dead = true;
              }
            }
          }
        } else {
          for (const e of this.enemies) {
            if (e.dead) continue;
            if (Math.hypot(pr.pos.x - e.pos.x, pr.pos.z - e.pos.z) < e.radius + pr.radius + 0.1 && pr.pos.y > 0 && pr.pos.y < e.height) {
              if (pr.kind === 'rocket') {
                this.projectileImpact(pr);
              } else {
                const v = pr.vel.clone().normalize().multiplyScalar(10);
                v.y = 3;
                this.knock(e, v, pr.kind === 'thrown' ? 'thrown' : 'parry', { perfect: pr.kind === 'thrown' });
                pr.dead = true;
              }
              break;
            }
          }
        }
      }
      if (pr.dead) continue;
      pr.mesh.position.copy(pr.pos);
      if (pr.kind === 'thrown') {
        pr.spin += dt * 18;
        pr.mesh.rotation.set(pr.spin, pr.spin * 0.3, 0);
      } else {
        tmpV.copy(pr.vel).normalize();
        pr.mesh.quaternion.setFromUnitVectors(UP, tmpV);
      }
      if (pr.kind === 'rocket' && Math.random() < 0.5) this.fx.spark(pr.pos, pr.vel.clone().normalize().negate(), 1, 0xff9a3a, 2);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead) {
        this.root.remove(this.projectiles[i].mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  projectileImpact(pr) {
    pr.dead = true;
    if (pr.kind === 'rocket') {
      const back = pr.pos.clone().addScaledVector(pr.vel.clone().normalize(), -0.3);
      back.y = Math.max(0.3, Math.min(WALL_H - 0.3, back.y));
      this.explode(back, 'rocket');
    } else {
      this.fx.spark(pr.pos, pr.vel.clone().normalize().negate(), 4, 0xffd36b, 3);
      this.checkGasSpark(pr.pos);
    }
  }

  hurtPlayer(dmg, dir, source) {
    const p = this.player;
    if (p.dead || p.invuln > 0 || this.state !== 'playing') return;
    p.hp -= dmg;
    p.invuln = PLAYER.hurtInvuln;
    this.stats.damageTaken += dmg;
    this.stats.combo = 0;
    this.audio.sfx('hurt');
    this.fx.shake(0.6);
    this.hud.damage(dir ? Math.atan2(dir.x, dir.z) - p.yaw : 0);
    p.vel.x += (dir?.x ?? 0) * 4;
    p.vel.z += (dir?.z ?? 0) * 4;
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      p.deadT = 0;
      this.audio.sfx('death');
      this.audio.bulletTime(true);
      this.emit('died', { source });
    }
  }

  // ───────── 환경 연쇄 ─────────

  leakPipe(pipe) {
    if (pipe.state !== 'intact') return;
    pipe.state = 'leaking';
    const { mats, geo } = getAssets();
    const pos = new THREE.Vector3(pipe.x + pipe.out[0] * 1.2, 1.3, pipe.z + pipe.out[1] * 1.2);
    const g = new THREE.Group();
    g.position.copy(pos);
    const puffs = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo.unitSphere, mats.gas);
      m.position.set(rand(-0.6, 0.6), rand(-0.4, 0.5), rand(-0.6, 0.6));
      g.add(m);
      puffs.push(m);
    }
    this.root.add(g);
    this.clouds.push({ pipe, pos, r: 0.6, life: 14, group: g, puffs, ignited: false, t: 0 });
    this.sfxAt('gas', pipe.x, pipe.z, 1);
    this.fx.spark(pos, new THREE.Vector3(pipe.out[0], 0, pipe.out[1]), 8, 0xb6ff6a, 4);
  }

  igniteCloud(c, delay = 0.06) {
    if (!c || c.ignited) return;
    c.ignited = true;
    c.pipe.state = 'spent';
    this.root.remove(c.group);
    this.pendingExplosions.push({ pos: c.pos.clone(), kind: 'gas', delay });
  }

  checkGasSpark(pos) {
    for (const c of this.clouds) if (!c.ignited && pos.distanceTo(c.pos) < c.r + 0.6) this.igniteCloud(c);
  }

  updateClouds(dt) {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      if (c.ignited) {
        this.clouds.splice(i, 1);
        continue;
      }
      c.t += dt;
      c.life -= dt;
      c.r = Math.min(2.7, 0.6 + c.t * 1.4);
      const fade = Math.min(1, c.life / 2);
      c.puffs.forEach((m, k) => {
        m.scale.setScalar(c.r * (0.55 + 0.12 * Math.sin(c.t * 1.5 + k)) * fade);
      });
      c.group.rotation.y += dt * 0.3;
      if (c.life <= 0) {
        this.root.remove(c.group);
        c.pipe.state = 'spent';
        this.clouds.splice(i, 1);
      }
    }
  }

  dropChandelier(c) {
    if (c.state !== 'hanging') return;
    c.state = 'falling';
    c.chain.visible = false;
    const body = new CANNON.Body({
      mass: 60,
      shape: new CANNON.Sphere(0.6),
      position: new CANNON.Vec3(c.x, c.y, c.z),
      collisionFilterGroup: G_DYN,
      collisionFilterMask: G_STATIC | G_DYN | G_RAG,
      linearDamping: 0.01,
    });
    body.velocity.set(0, -2, 0);
    this.physics.link(body, c.group, 15);
    c.body = body;
    this.sfxAt('chandelier', c.x, c.z, 1);
  }

  explode(pos, kind) {
    const cfg = EXPLOSION[kind];
    const p = this.player;
    this.fx.blast(pos, cfg.radius * 0.9, kind === 'gas' ? 0xff8a2a : 0xffa23a);
    this.sfxAt('explosion', pos.x, pos.z, 1.4, { strength: kind === 'gas' ? 1.2 : 1 });
    const pd = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z);
    this.fx.shake(Math.max(0, 1.2 - pd / 14));

    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.pos.x - pos.x;
      const ez = e.pos.z - pos.z;
      const d = Math.hypot(ex, ez);
      if (d < cfg.radius && this.grid.los(pos.x, pos.z, e.pos.x, e.pos.z)) {
        const k = (1 - d / cfg.radius) * 16 + 4;
        const l = d || 1;
        this.knock(e, new THREE.Vector3((ex / l) * k, 7, (ez / l) * k), 'explosion');
      }
    }
    if (!p.dead && pd < cfg.playerHurtRadius && this.grid.los(pos.x, pos.z, p.pos.x, p.pos.z)) {
      const l = pd || 1;
      this.hurtPlayer(pd < cfg.playerHurtRadius * 0.5 ? 2 : 1, { x: (p.pos.x - pos.x) / l, z: (p.pos.z - pos.z) / l }, 'explosion');
    }
    for (const l of this.physics.links) {
      const b = l.body;
      const d = Math.hypot(b.position.x - pos.x, b.position.y - pos.y, b.position.z - pos.z);
      if (d < cfg.radius) {
        b.wakeUp();
        const k = (1 - d / cfg.radius) * 14 * b.mass;
        const dl = d || 1;
        b.applyImpulse(new CANNON.Vec3(((b.position.x - pos.x) / dl) * k, k * 0.6, ((b.position.z - pos.z) / dl) * k));
      }
    }
    for (const c of this.clouds) {
      if (!c.ignited && c.pos.distanceTo(pos) < cfg.radius + c.r) this.igniteCloud(c, 0.12);
    }
    for (const pipe of this.world.pipes) {
      if (pipe.state === 'intact' && Math.hypot(pipe.x - pos.x, pipe.z - pos.z) < cfg.radius * 0.8) {
        this.leakPipe(pipe);
        this.igniteCloud(this.clouds[this.clouds.length - 1], 0.18);
      }
    }
    for (const c of this.world.chandeliers) {
      if (c.state === 'hanging' && Math.hypot(c.x - pos.x, c.z - pos.z) < cfg.radius * 0.9) this.dropChandelier(c);
    }
    for (const d of this.world.doors) {
      if (d.state !== 'closed' || d.locked) continue;
      const dd = Math.hypot(d.x - pos.x, d.z - pos.z);
      if (dd < cfg.radius * 0.65) {
        const dir = new THREE.Vector3(d.x - pos.x, 0, d.z - pos.z).normalize();
        this.breachDoor(d, dir, 1.1, false);
      }
    }
    for (const dw of [...this.world.drywalls.values()]) {
      const cx = Grid.center(dw.tx);
      const cz = Grid.center(dw.tz);
      const dd = Math.hypot(cx - pos.x, cz - pos.z);
      if (dd < cfg.radius * 0.55) this.breachWall(dw, new THREE.Vector3(cx - pos.x, 0, cz - pos.z).normalize(), 1);
    }
    this.noise(pos.x, pos.z, 24);
  }

  // 날아가는 문짝·파편·래그돌·샹들리에가 살아 있는 적을 친다(볼링)
  updateDynamics(dt) {
    const inv = new THREE.Quaternion();
    for (let i = this.flyingDoors.length - 1; i >= 0; i--) {
      const fd = this.flyingDoors[i];
      fd.t += dt;
      const b = fd.body;
      // 처음 0.35초는 중력을 일부 상쇄해 문짝이 멀리 '날아가게' 한다
      if (fd.t < 0.45) b.applyForce(new CANNON.Vec3(0, b.mass * 22 * 0.8, 0));
      const speed = b.velocity.length();
      if (fd.t > 3 || (fd.t > 0.3 && speed < 2.5)) {
        this.flyingDoors.splice(i, 1);
        continue;
      }
      inv.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w).invert();
      for (const e of this.enemies) {
        if (e.dead) continue;
        tmpV.set(e.pos.x - b.position.x, 1.0 - b.position.y, e.pos.z - b.position.z).applyQuaternion(inv);
        if (Math.abs(tmpV.x) < TILE * 0.46 + e.radius && Math.abs(tmpV.y) < DOOR_H / 2 + 0.7 && Math.abs(tmpV.z) < 0.07 + e.radius + 0.2) {
          const v = new THREE.Vector3(b.velocity.x * 0.85, 3.5, b.velocity.z * 0.85);
          if (this.knock(e, v, 'door')) {
            fd.victims++;
            if (fd.victims === 2) {
              this.stats.strikes++;
              const pts = addScore(this.stats, SCORE.strikeBonus);
              this.hud.banner(`STRIKE! +${pts}`);
              this.audio.sfx('strike');
            } else if (fd.victims > 2) {
              addScore(this.stats, SCORE.strikeBonus);
              this.hud.banner(`STRIKE x${fd.victims}!`);
            }
          }
          b.velocity.scale(0.88, b.velocity);
        }
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      if (d.t > 1.2) {
        this.debris.splice(i, 1);
        continue;
      }
      if (d.body.velocity.length() < 5) continue;
      for (const e of this.enemies) {
        if (!e.dead && Math.hypot(e.pos.x - d.body.position.x, e.pos.z - d.body.position.z) < e.radius + 0.3 && d.body.position.y < e.height) {
          this.knock(e, new THREE.Vector3(d.body.velocity.x * 0.8, 3, d.body.velocity.z * 0.8), 'wall', { perfect: true });
        }
      }
    }
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i];
      r.t += dt;
      if (r.t > 2.5) {
        this.ragdolls.splice(i, 1);
        continue;
      }
      const b = r.torso;
      if (b.velocity.length() < 6.5) continue;
      for (const e of this.enemies) {
        if (!e.dead && Math.hypot(e.pos.x - b.position.x, e.pos.z - b.position.z) < e.radius + 0.45 && b.position.y < e.height) {
          this.knock(e, new THREE.Vector3(b.velocity.x * 0.7, 3, b.velocity.z * 0.7), 'ragdoll');
        }
      }
    }
    for (const c of this.world.chandeliers) {
      if (c.state !== 'falling' || !c.body) continue;
      const b = c.body;
      if (b.position.y < 1.9 && b.velocity.y < -2) {
        for (const e of this.enemies) {
          if (!e.dead && Math.hypot(e.pos.x - b.position.x, e.pos.z - b.position.z) < 1.8) {
            const ex = e.pos.x - b.position.x;
            const ez = e.pos.z - b.position.z;
            const l = Math.hypot(ex, ez) || 1;
            this.knock(e, new THREE.Vector3((ex / l) * 5, 1, (ez / l) * 5), 'crush');
          }
        }
        const p = this.player;
        if (Math.hypot(p.pos.x - b.position.x, p.pos.z - b.position.z) < 1.0) this.hurtPlayer(1, null, 'chandelier');
      }
      if (b.position.y < 0.75) {
        c.state = 'down';
        this.sfxAt('crash', c.x, c.z, 1.3);
        this.fx.spark(new THREE.Vector3(c.x, 0.3, c.z), null, 26, 0xfff1c9, 6);
        this.fx.shake(0.4);
        this.noise(c.x, c.z, 12);
      }
    }
  }

  separateEnemies() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) / 2;
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
    }
  }

  // ───────── 고스트·힌트 ─────────

  updateGhost() {
    if (!this.ghost || !this.ghostMesh) return;
    this.ghostMesh.visible = this.settings.showGhost;
    const g = sampleGhost(this.ghost, this.time);
    this.ghostMesh.position.set(g.x, 0, g.z);
    this.ghostMesh.rotation.y = g.yaw;
    this.ghostFoot.visible = g.kicking;
    this.ghostDone = g.done;
  }

  updateHint() {
    if (!this.settings.showHints) {
      if (this.lastHint) this.hud.hint(null);
      this.lastHint = null;
      return;
    }
    const p = this.player;
    const tx = p.pos.x / TILE - 0.5;
    const tz = p.pos.z / TILE - 0.5;
    const h = this.level.hints.find((x) => Math.hypot(x.tx - tx, x.tz - tz) < x.r) ?? null;
    if (h !== this.lastHint) {
      this.lastHint = h;
      this.hud.hint(h ? h.text : null);
    }
  }

  ghostRecord() {
    return this.ghostRec.finish({ stageId: this.stage.id, time: this.time, score: this.stats.score, sneaker: this.sneaker.id });
  }
}

function rayCylinder(o, d, cx, cz, r, h) {
  const fx = o.x - cx;
  const fz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return null;
  const b = 2 * (fx * d.x + fz * d.z);
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return null;
  const y = o.y + d.y * t;
  return y >= 0 && y <= h ? t : null;
}

function raySphere(o, d, c, r) {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t >= 0 ? t : null;
}

