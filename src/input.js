// 키보드·마우스·게임패드 입력. 발차기·사격은 이벤트 시각(performance 시계)을 함께 기록해 비트 판정에 쓴다.

const PAD_DEAD = 0.18;

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.mouse = { left: false, right: false, dx: 0, dy: 0 };
    this.actions = []; // {type:'kick'|'fire'|'jump'|'throw'|'restart'|'pause', time}
    this.pad = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, prev: [] };
    this.enabled = false;
    this.locked = false;

    this._onKey = (e) => this._key(e, e.type === 'keydown');
    this._onMouseDown = (e) => this._mouse(e, true);
    this._onMouseUp = (e) => this._mouse(e, false);
    this._onMove = (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    };
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) {
        this.mouse.left = this.mouse.right = false;
        this.keys.clear();
      }
      this.onLockChange?.(this.locked);
    };
    this._onBlur = () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    target.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMove);
    document.addEventListener('pointerlockchange', this._onLock);
    window.addEventListener('blur', this._onBlur);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    if (document.pointerLockElement === this.target) return Promise.resolve();
    try {
      const r = this.target.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof r.catch === 'function') {
        return r.catch(() => this.target.requestPointerLock()); // unadjustedMovement 미지원 브라우저
      }
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _push(type, time) {
    if (!this.enabled) return;
    this.actions.push({ type, time });
  }

  _key(e, down) {
    if (e.repeat) return;
    const k = e.code;
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!down) return;
    if (k === 'KeyF' || k === 'KeyE') this._push('kick', e.timeStamp);
    else if (k === 'Space') this._push('jump', e.timeStamp);
    else if (k === 'KeyQ' || k === 'KeyG') this._push('throw', e.timeStamp);
    else if (k === 'KeyR') this._push('restart', e.timeStamp);
    if (this.enabled && ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
  }

  _mouse(e, down) {
    if (e.button === 0) {
      this.mouse.left = down;
      if (down && this.locked) this._push('fire', e.timeStamp);
    } else if (e.button === 2) {
      this.mouse.right = down;
      if (down && this.locked) this._push('kick', e.timeStamp);
    }
  }

  // 표준 매핑 게임패드: 왼스틱 이동, 오른스틱 시점, A 점프, RB/LB 발차기, RT 사격, X 던지기, Y 재시작, Start 일시정지
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = Array.from(pads).find((x) => x && x.connected);
    if (!p) {
      this.pad.moveX = this.pad.moveY = this.pad.lookX = this.pad.lookY = 0;
      this.pad.fire = false;
      return false;
    }
    const dz = (v) => (Math.abs(v) < PAD_DEAD ? 0 : (v - Math.sign(v) * PAD_DEAD) / (1 - PAD_DEAD));
    this.pad.moveX = dz(p.axes[0] ?? 0);
    this.pad.moveY = dz(p.axes[1] ?? 0);
    this.pad.lookX = dz(p.axes[2] ?? 0);
    this.pad.lookY = dz(p.axes[3] ?? 0);
    const b = (i) => !!p.buttons[i]?.pressed;
    const now = performance.now();
    const edge = (i, type) => {
      if (b(i) && !this.pad.prev[i]) this._push(type, now);
    };
    edge(0, 'jump');
    edge(4, 'kick');
    edge(5, 'kick');
    edge(6, 'kick');
    edge(7, 'fire');
    edge(2, 'throw');
    edge(3, 'restart');
    edge(9, 'pause');
    this.pad.fire = b(7);
    this.pad.prev = p.buttons.map((x) => x.pressed);
    return true;
  }

  moveVector() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    x += this.pad.moveX;
    y += this.pad.moveY;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  firing() {
    return (this.locked && this.mouse.left) || this.pad.fire;
  }

  consumeActions() {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  consumeMouse() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = this.mouse.dy = 0;
    return d;
  }
}
