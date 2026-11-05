// 인게임 HUD(DOM). 비트 링·비트 바·판정·점수·체력·탄약·힌트·알림.

import { PLAYER, WEAPONS } from '../config.js';
import { comboMultiplier, formatTime } from '../game/scoring.js';

const JUDGE_TEXT = { perfect: 'PERFECT', good: 'GOOD', off: 'OFFBEAT' };

export class Hud {
  constructor(el) {
    this.el = el;
    el.innerHTML = `
      <div class="hud-tl">
        <div class="hud-stage"><span id="h-stage"></span><small id="h-sub"></small></div>
        <div class="hud-time" id="h-time">00:00.00</div>
        <div class="hud-best" id="h-best"></div>
      </div>
      <div class="hud-tr">
        <div class="hud-score" id="h-score">0</div>
        <div class="hud-mult"><span id="h-mult">x1.00</span> <small id="h-combo"></small></div>
        <div class="hud-left" id="h-left"></div>
      </div>
      <div class="hud-center">
        <div class="beat-ring" id="h-ring"></div>
        <div class="crosshair"></div>
        <div class="judge" id="h-judge"></div>
      </div>
      <div class="beat-bar"><div class="beat-mark"></div><div id="h-ticks"></div></div>
      <div class="hud-bl" id="h-hp"></div>
      <div class="hud-br"><div class="hud-weapon" id="h-weapon">맨손</div><div class="hud-ammo" id="h-ammo"></div></div>
      <div class="hud-hint" id="h-hint"></div>
      <div class="hud-toast" id="h-toast"></div>
      <div class="hud-banner" id="h-banner"></div>
      <div class="vignette-bt" id="h-bt"></div>
      <div class="vignette-dmg" id="h-dmg"></div>
      <div class="popups" id="h-popups"></div>
      <div class="hud-death" id="h-death">
        <div class="ko">K.O.</div>
        <div>R · 클릭 · 패드 Y — 즉시 재시작</div>
      </div>`;
    const $ = (id) => el.querySelector(`#${id}`);
    this.e = {
      stage: $('h-stage'),
      sub: $('h-sub'),
      time: $('h-time'),
      best: $('h-best'),
      score: $('h-score'),
      mult: $('h-mult'),
      combo: $('h-combo'),
      left: $('h-left'),
      ring: $('h-ring'),
      judge: $('h-judge'),
      ticks: $('h-ticks'),
      hp: $('h-hp'),
      weapon: $('h-weapon'),
      ammo: $('h-ammo'),
      hint: $('h-hint'),
      toast: $('h-toast'),
      banner: $('h-banner'),
      bt: $('h-bt'),
      dmg: $('h-dmg'),
      death: $('h-death'),
    };
    this.popupLayer = $('h-popups');
    this.tickEls = [];
    for (let i = 0; i < 8; i++) {
      const t = document.createElement('div');
      t.className = 'beat-tick';
      this.e.ticks.appendChild(t);
      this.tickEls.push(t);
    }
    this.hpEls = [];
    for (let i = 0; i < PLAYER.maxHp; i++) {
      const h = document.createElement('div');
      h.className = 'hp-pip';
      this.e.hp.appendChild(h);
      this.hpEls.push(h);
    }
    this.toastT = 0;
    this.bannerT = 0;
    this.judgeT = 0;
    this.cache = {};
  }

  show(on) {
    this.el.classList.toggle('on', on);
  }

  setStage(name, sub, bestTime) {
    this.e.stage.textContent = name;
    this.e.sub.textContent = sub ? ` · ${sub}` : '';
    this.bestTime = bestTime;
    this.e.best.textContent = bestTime != null ? `BEST ${formatTime(bestTime)}` : '';
    this.e.death.classList.remove('on');
    this.e.hint.classList.remove('on');
    this.e.banner.classList.remove('on');
    this.e.judge.className = 'judge';
  }

  _set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  update(session, beat, realDt) {
    const st = session.stats;
    const p = session.player;
    this._set('time', this.e.time, formatTime(session.time));
    const over = this.bestTime != null && session.time > this.bestTime;
    this.e.time.classList.toggle('over', over);
    this._set('score', this.e.score, st.score.toLocaleString());
    this._set('mult', this.e.mult, `x${comboMultiplier(st.combo).toFixed(2)}`);
    this._set('combo', this.e.combo, st.combo > 1 ? `${st.combo} COMBO` : '');
    this._set('left', this.e.left, session.aliveCount > 0 ? `남은 적 ${session.aliveCount}` : '출구로!');
    this.hpEls.forEach((h, i) => h.classList.toggle('lost', i >= p.hp));
    if (p.weapon) {
      this._set('weapon', this.e.weapon, WEAPONS[p.weapon.type].name);
      this._set('ammo', this.e.ammo, p.weapon.ammo > 0 ? `${p.weapon.ammo} / ${WEAPONS[p.weapon.type].ammo}` : '빈 총 — Q 던지기');
    } else {
      this._set('weapon', this.e.weapon, '맨손');
      this._set('ammo', this.e.ammo, '적을 차서 총을 빼앗아라');
    }

    // 비트 링: 다음 박을 향해 줄어든다
    const ph = beat.phase;
    const ringScale = 1 + (1 - ph) * 0.95;
    this.e.ring.style.transform = `translate(-50%,-50%) scale(${ringScale.toFixed(3)})`;
    this.e.ring.style.opacity = (0.35 + ph * 0.65).toFixed(2);
    this.e.ring.classList.toggle('hit', ph < 0.12 || ph > 0.96);
    // 비트 바: 다음 4박이 양쪽에서 가운데로
    for (let i = 0; i < 4; i++) {
      const until = i + 1 - ph; // 박까지 남은 박 수
      const x = (until / 4) * 46;
      this.tickEls[i * 2].style.transform = `translateX(${(-x).toFixed(2)}vw)`;
      this.tickEls[i * 2 + 1].style.transform = `translateX(${x.toFixed(2)}vw)`;
      const op = (1 - until / 4.2).toFixed(2);
      this.tickEls[i * 2].style.opacity = op;
      this.tickEls[i * 2 + 1].style.opacity = op;
    }
    this.e.bt.classList.toggle('on', session.btRemaining > 0);

    if (this.toastT > 0) {
      this.toastT -= realDt;
      if (this.toastT <= 0) this.e.toast.classList.remove('on');
    }
    if (this.bannerT > 0) {
      this.bannerT -= realDt;
      if (this.bannerT <= 0) this.e.banner.classList.remove('on');
    }
    if (this.judgeT > 0) {
      this.judgeT -= realDt;
      if (this.judgeT <= 0) this.e.judge.classList.remove('on');
    }
  }

  judgement(res, deltaMs) {
    const j = this.e.judge;
    j.className = `judge ${res}`;
    j.innerHTML = `${JUDGE_TEXT[res]}<small>${deltaMs >= 0 ? '+' : ''}${Math.round(deltaMs)}ms</small>`;
    void j.offsetWidth; // 애니메이션 재시작
    j.classList.add('on');
    this.judgeT = 0.5;
  }

  toast(text) {
    if (this.e.toast.textContent === text && this.toastT > 0.8) return;
    this.e.toast.textContent = text;
    this.e.toast.classList.add('on');
    this.toastT = 1.6;
  }

  banner(text) {
    this.e.banner.textContent = text;
    this.e.banner.classList.remove('on');
    void this.e.banner.offsetWidth;
    this.e.banner.classList.add('on');
    this.bannerT = 1.4;
  }

  hint(text) {
    if (text) {
      this.e.hint.textContent = text;
      this.e.hint.classList.add('on');
    } else this.e.hint.classList.remove('on');
  }

  damage() {
    const d = this.e.dmg;
    d.classList.remove('on');
    void d.offsetWidth;
    d.classList.add('on');
  }

  death(on) {
    this.e.death.classList.toggle('on', on);
  }
}
