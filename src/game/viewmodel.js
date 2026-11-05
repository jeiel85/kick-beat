// 1인칭 뷰모델: 발차기 다리, 총 든 손, 총구 섬광. 별도 장면에 그려 벽에 파묻히지 않는다.

import * as THREE from 'three';
import { getAssets, makeGunMesh } from './assets.js';

const KICK_DUR = 0.3;

export class Viewmodel {
  constructor(scene, sneaker) {
    const { mats } = getAssets();
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    // 다리 + 스니커즈
    this.leg = new THREE.Group();
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.2), mats.pant);
    shin.position.y = 0.38;
    this.leg.add(shin);
    this.bootMat = new THREE.MeshStandardMaterial({ color: sneaker.color, roughness: 0.5, emissive: new THREE.Color(sneaker.color).multiplyScalar(0.12) });
    this.soleMat = new THREE.MeshBasicMaterial({ color: sneaker.sole, toneMapped: false });
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.46), this.bootMat);
    boot.position.set(0, -0.02, -0.1);
    this.leg.add(boot);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.48), this.soleMat);
    sole.position.set(0, -0.13, -0.1);
    this.leg.add(sole);
    this.leg.visible = false;
    this.root.add(this.leg);

    // 손 + 총
    this.hand = new THREE.Group();
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.14), mats.skin);
    fist.position.set(0, -0.06, 0.05);
    this.hand.add(fist);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.45), mats.pant);
    sleeve.position.set(0.02, -0.08, 0.32);
    this.hand.add(sleeve);
    this.hand.position.set(0.3, -0.3, -0.52);
    this.root.add(this.hand);
    this.gun = null;

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), flashMat);
    this.flash.visible = false;
    this.root.add(this.flash);

    this.kickT = -1;
    this.recoil = 0;
    this.bobT = 0;
    this.flashT = 0;
    this.hand.visible = false;
  }

  setSneaker(sneaker) {
    this.bootMat.color.set(sneaker.color);
    this.bootMat.emissive.set(sneaker.color).multiplyScalar(0.12);
    this.soleMat.color.set(sneaker.sole);
  }

  setWeapon(type) {
    if (this.gun) {
      this.hand.remove(this.gun);
      this.gun = null;
    }
    this.hand.visible = !!type;
    if (type) {
      this.gun = makeGunMesh(type);
      this.gun.scale.setScalar(0.75);
      this.gun.position.set(0, 0, -0.08);
      this.hand.add(this.gun);
    }
  }

  kick() {
    this.kickT = 0;
    this.leg.visible = true;
  }

  fire() {
    this.recoil = 1;
    this.flashT = 0.045;
  }

  update(dt, camera, moveAmount) {
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);

    this.bobT += dt * (4 + moveAmount * 8);
    const bob = Math.sin(this.bobT) * 0.012 * moveAmount;
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.hand.position.set(0.3 + Math.cos(this.bobT * 0.5) * 0.008 * moveAmount, -0.3 + bob, -0.52 + this.recoil * 0.08);
    this.hand.rotation.x = this.recoil * 0.25;

    if (this.kickT >= 0) {
      this.kickT += dt;
      const k = this.kickT / KICK_DUR;
      // 0~0.35 뻗기, 0.35~0.6 유지, 이후 회수
      const ext = k < 0.35 ? easeOut(k / 0.35) : k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
      this.leg.position.set(0.12 - ext * 0.06, -1.25 + ext * 0.68, -0.25 - ext * 0.75);
      this.leg.rotation.x = 0.9 - ext * 1.15;
      if (k >= 1) {
        this.kickT = -1;
        this.leg.visible = false;
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flash.position.set(0.3, -0.26, -1.05);
      this.flash.rotation.z = Math.random() * Math.PI;
    } else this.flash.visible = false;
  }
}

function easeOut(x) {
  return 1 - (1 - x) * (1 - x);
}
