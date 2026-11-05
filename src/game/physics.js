// cannon-es 래퍼: 날아가는 문짝·파편·래그돌·샹들리에·떨어진 무기만 강체로 시뮬레이션한다.

import * as CANNON from 'cannon-es';

export const G_STATIC = 1;
export const G_DYN = 2;
export const G_RAG = 4;
export const G_ITEM = 8;

export class Physics {
  constructor() {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    world.solver.iterations = 8;
    world.defaultContactMaterial.friction = 0.38;
    world.defaultContactMaterial.restitution = 0.18;
    this.world = world;
    // 정적 충돌체 재질 / 미끄러운 재질(날아가는 문짝이 바닥에 걸려 바로 멈추지 않게)
    this.matStatic = new CANNON.Material('static');
    this.matSlick = new CANNON.Material('slick');
    world.addContactMaterial(new CANNON.ContactMaterial(this.matStatic, this.matSlick, { friction: 0.05, restitution: 0.25 }));
    this.links = []; // {body, mesh, life, frozen}
  }

  addStaticBox(cx, cy, cz, hx, hy, hz) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      position: new CANNON.Vec3(cx, cy, cz),
      material: this.matStatic,
      collisionFilterGroup: G_STATIC,
      collisionFilterMask: G_DYN | G_RAG | G_ITEM,
    });
    this.world.addBody(body);
    return body;
  }

  addPlane(y, up) {
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: this.matStatic, collisionFilterGroup: G_STATIC, collisionFilterMask: G_DYN | G_RAG | G_ITEM });
    body.position.set(0, y, 0);
    body.quaternion.setFromEuler(up ? -Math.PI / 2 : Math.PI / 2, 0, 0);
    this.world.addBody(body);
    return body;
  }

  /** 메시를 강체에 묶는다. life(초) 후에는 강체를 빼고 메시는 그 자리에 남긴다. */
  link(body, mesh, life = 8) {
    this.world.addBody(body);
    const l = { body, mesh, life, frozen: false };
    this.links.push(l);
    return l;
  }

  _dropBody(body) {
    // 래그돌 관절처럼 이 강체를 참조하는 제약도 함께 뺀다
    for (let i = this.world.constraints.length - 1; i >= 0; i--) {
      const c = this.world.constraints[i];
      if (c.bodyA === body || c.bodyB === body) this.world.removeConstraint(c);
    }
    this.world.removeBody(body);
  }

  remove(body) {
    this._dropBody(body);
    const i = this.links.findIndex((l) => l.body === body);
    if (i >= 0) this.links.splice(i, 1);
  }

  step(dt) {
    if (dt <= 0) return;
    this.world.step(1 / 60, dt, 3);
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      l.mesh.position.copy(l.body.position);
      l.mesh.quaternion.copy(l.body.quaternion);
      l.life -= dt;
      if (l.life <= 0 || (l.body.sleepState === CANNON.Body.SLEEPING && l.life < 6)) {
        this._dropBody(l.body);
        this.links.splice(i, 1);
      }
    }
  }
}

export { CANNON };
