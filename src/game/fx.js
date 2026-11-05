// 시각 효과: 불꽃 파티클, 폭발 구, 예광탄, 점수 팝업(DOM), 화면 흔들림, 섬광.

import * as THREE from 'three';
import { getAssets } from './assets.js';

const MAX_SPARKS = 240;

export class Fx {
  constructor(scene, camera, popupLayer, flashLight) {
    const { mats, geo } = getAssets();
    this.scene = scene;
    this.camera = camera;
    this.popupLayer = popupLayer;
    this.flashLight = flashLight;
    this.flashT = 0;
    this.shakeAmt = 0;

    this.sparkMesh = new THREE.InstancedMesh(geo.spark, mats.spark, MAX_SPARKS);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.count = 0;
    this.sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3);
    scene.add(this.sparkMesh);
    this.sparks = [];

    // 폭발: 가산 혼합 바깥 구 + 밝은 안쪽 구(평평한 덩어리로 보이지 않게)
    this.blasts = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo.unitSphere, mats.blast.clone());
      const core = new THREE.Mesh(geo.unitSphere, mats.blast.clone());
      core.material.color.set(0xfff2c0);
      m.add(core);
      m.visible = false;
      scene.add(m);
      this.blasts.push({ mesh: m, core, t: 0, dur: 0, r: 0 });
    }
    this.tracers = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geo.tracer, mats.tracer.clone());
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, t: 0 });
    }
    this.popups = [];
    this._m4 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._c = new THREE.Color();
  }

  reset() {
    this.sparks.length = 0;
    this.sparkMesh.count = 0;
    for (const b of this.blasts) b.mesh.visible = false;
    for (const t of this.tracers) t.mesh.visible = false;
    for (const p of this.popups) p.el.remove();
    this.popups.length = 0;
    this.shakeAmt = 0;
    this.flashT = 0;
    this.flashLight.intensity = 0;
  }

  spark(pos, dir, count = 10, color = 0xffd36b, speed = 7) {
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
      if (dir) v.addScaledVector(dir, 1.6);
      v.normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.sparks.push({ p: pos.clone(), v, life: 0.25 + Math.random() * 0.35, color: new THREE.Color(color) });
    }
  }

  blast(pos, radius, color = 0xffb347) {
    const b = this.blasts.find((x) => !x.mesh.visible) ?? this.blasts[0];
    b.mesh.position.copy(pos);
    b.mesh.material.color.set(color);
    b.mesh.visible = true;
    b.t = 0;
    b.dur = 0.45;
    b.r = radius;
    this.flash(pos, 60, color, 0.35);
    this.spark(pos, null, 40, 0xffc04a, 14);
  }

  flash(pos, intensity, color, dur) {
    this.flashLight.position.copy(pos);
    this.flashLight.color.set(color);
    this.flashLight.intensity = intensity;
    this.flashT = dur;
    this.flashDur = dur;
    this.flashPeak = intensity;
  }

  tracer(from, to) {
    const t = this.tracers.find((x) => !x.mesh.visible) ?? this.tracers[0];
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.t = 0.07;
  }

  shake(a) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + a);
  }

  popup(text, worldPos, cls = '') {
    const el = document.createElement('div');
    el.className = `popup ${cls}`;
    el.textContent = text;
    this.popupLayer.appendChild(el);
    this.popups.push({ el, pos: worldPos.clone().add(new THREE.Vector3(0, 0.3, 0)), t: 0, dur: 1.0 });
    if (this.popups.length > 14) this.popups.shift().el.remove();
  }

  update(dt, realDt) {
    // 불꽃
    const g = 14;
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.v.y -= g * dt;
      s.p.addScaledVector(s.v, dt);
      if (s.p.y < 0.02) {
        s.p.y = 0.02;
        s.v.y *= -0.3;
        s.v.x *= 0.6;
        s.v.z *= 0.6;
      }
    }
    for (const s of this.sparks) {
      this._v.copy(s.p).add(s.v);
      this._m4.lookAt(s.p, this._v, THREE.Object3D.DEFAULT_UP);
      this._q.setFromRotationMatrix(this._m4);
      this._m4.compose(s.p, this._q, new THREE.Vector3(1, 1, 0.5 + s.v.length() * 0.12));
      this.sparkMesh.setMatrixAt(n, this._m4);
      this._c.copy(s.color).multiplyScalar(1 + s.life * 3);
      this.sparkMesh.setColorAt(n, this._c);
      n++;
    }
    this.sparkMesh.count = n;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;

    for (const b of this.blasts) {
      if (!b.mesh.visible) continue;
      b.t += dt;
      const k = b.t / b.dur;
      if (k >= 1) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.scale.setScalar(b.r * (0.25 + 0.85 * Math.pow(k, 0.4)));
      b.mesh.material.opacity = 0.55 * (1 - k) * (1 - k);
      b.core.scale.setScalar(0.55 * (1 - k * 0.6));
      b.core.material.opacity = 0.8 * Math.max(0, 1 - k * 2.2);
    }
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.t -= realDt;
      t.mesh.material.opacity = Math.max(0, t.t / 0.07) * 0.9;
      if (t.t <= 0) t.mesh.visible = false;
    }
    if (this.flashT > 0) {
      this.flashT -= realDt;
      this.flashLight.intensity = Math.max(0, (this.flashT / this.flashDur) * this.flashPeak);
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - realDt * 2.4);

    // 팝업: 월드 좌표를 화면에 투영
    const w = this.popupLayer.clientWidth;
    const h = this.popupLayer.clientHeight;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += realDt;
      if (p.t >= p.dur) {
        p.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      this._v.copy(p.pos);
      this._v.y += p.t * 0.6;
      this._v.project(this.camera);
      if (this._v.z > 1) {
        p.el.style.opacity = '0';
        continue;
      }
      const x = (this._v.x * 0.5 + 0.5) * w;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.15 - p.t) * 3})`;
      p.el.style.opacity = String(Math.min(1, (p.dur - p.t) * 3));
    }
  }

  shakeOffset() {
    const a = this.shakeAmt * this.shakeAmt * 0.12;
    return { x: (Math.random() - 0.5) * a, y: (Math.random() - 0.5) * a, roll: (Math.random() - 0.5) * a * 0.3 };
  }
}
