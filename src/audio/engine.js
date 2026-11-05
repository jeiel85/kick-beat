// Web Audio 엔진: 하드베이스 신스 시퀀서, 커스텀 음원 재생, 합성 효과음, 불릿타임 저역 필터.
// 음원 파일 없이 모든 소리를 코드로 만든다.

import { BULLET_TIME } from '../config.js';
import { mulberry32 } from '../levels/rng.js';
import { BeatClock } from './beatClock.js';

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PROGRESSIONS = [
  [0, 5, 2, 6],
  [0, 3, 5, 4],
  [0, 6, 5, 6],
  [0, 5, 3, 4],
  [0, 2, 5, 6],
];

function degreeToSemis(deg) {
  const oct = Math.floor(deg / 7);
  return MINOR[((deg % 7) + 7) % 7] + oct * 12;
}

// 시드 → 곡 구성(코드 진행, 베이스·리드 리듬). 같은 시드는 같은 곡.
export function songFromSeed(seed, root = 45) {
  const rng = mulberry32(seed * 7919 + 13);
  const prog = PROGRESSIONS[seed % PROGRESSIONS.length];
  const bass = Array(16).fill(0);
  for (const s of [2, 6, 10, 14]) bass[s] = 1; // 하드베이스 특유의 오프비트 베이스
  for (const s of [3, 7, 11, 15]) if (rng.chance(0.35)) bass[s] = 2; // 16분 추가타(옥타브 위)
  const lead = Array(16).fill(0);
  const leadHits = rng.int(4, 6);
  for (let k = 0; k < leadHits; k++) lead[rng.int(0, 15)] = 1;
  lead[0] = 1;
  const leadOct = rng.pick([12, 24]);
  return { prog, bass, lead, root, leadOct, hatOpen: rng.chance(0.5) };
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.clock = new BeatClock(150, 0);
    this.musicMode = 'none'; // 'synth' | 'buffer' | 'calib' | 'none'
    this._timer = null;
    this.settings = { music: 0.8, sfx: 0.9 };
  }

  get ready() {
    return !!this.ctx;
  }

  // 사용자 제스처 안에서 호출해야 한다(브라우저 자동재생 정책)
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('이 브라우저는 Web Audio를 지원하지 않는다');
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.comp.connect(this.master).connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.btFilter = ctx.createBiquadFilter();
    this.btFilter.type = 'lowpass';
    this.btFilter.frequency.value = 20000;
    this.btFilter.Q.value = 0.9;
    this.musicGain.connect(this.btFilter).connect(this.comp);

    this.sfxGain = ctx.createGain();
    this.sfxGain.connect(this.comp);

    // 킥 버스: 소프트 클리핑으로 하드베이스 킥의 찌그러진 질감
    this.kickBus = ctx.createWaveShaper();
    this.kickBus.curve = this._softClip(3.2);
    this.kickBus.oversample = '2x';
    const kickOut = ctx.createGain();
    kickOut.gain.value = 0.55;
    this.kickBus.connect(kickOut).connect(this.musicGain);

    // 리드용 딜레이 센드
    this.delay = ctx.createDelay(1.5);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.32;
    this.delayOut = ctx.createGain();
    this.delayOut.gain.value = 0.28;
    this.delay.connect(this.delayFb).connect(this.delay);
    this.delay.connect(this.delayOut).connect(this.musicGain);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    const rng = mulberry32(99);
    for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1;

    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(this.settings.music * 0.85, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx, t, 0.02);
  }

  setVolumes(music, sfx) {
    this.settings.music = music;
    this.settings.sfx = sfx;
    this.applyVolumes();
  }

  _softClip(k) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return c;
  }

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  // 지금 스피커로 '들리고 있는' 오디오 시간. 판정은 이 시간 기준이어야 출력 지연이 상쇄된다.
  heardTime(perfMs = performance.now()) {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return ctx.currentTime - lat - (performance.now() - perfMs) / 1000;
  }

  bulletTime(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.btFilter.frequency.cancelScheduledValues(t);
    this.btFilter.frequency.setTargetAtTime(on ? BULLET_TIME.musicCutoff : 20000, t, on ? 0.04 : 0.12);
  }

  // ───────── 음악 ─────────

  stopMusic() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this.bufferSource) {
      try {
        this.bufferSource.stop();
      } catch {
        // 이미 멈춘 소스 — 무시해도 되는 유일한 경우
      }
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }
    this.musicMode = 'none';
  }

  playSynth({ bpm, seed = 1, root = 45 }, { calib = false } = {}) {
    this.stopMusic();
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.12;
    this.clock.set(bpm, t0);
    this.song = songFromSeed(seed, root);
    this.stepDur = 60 / bpm / 4;
    this.step = 0;
    this.t0 = t0;
    this.musicMode = calib ? 'calib' : 'synth';
    this.songKey = calib ? 'calib' : `synth:${bpm}:${seed}:${root}`;
    const tick = () => this._schedule();
    tick();
    this._timer = setInterval(tick, 25);
  }

  playBuffer(buffer, analysis) {
    this.stopMusic();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = analysis.loopStart;
    src.loopEnd = analysis.loopEnd;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(this.musicGain);
    const t0 = ctx.currentTime + 0.12;
    src.start(t0);
    this.bufferSource = src;
    // 첫 박 = 시작 시각 + 곡 안의 첫 박 위치. 루프 구간 길이가 박 주기의 정수배라 격자가 이어진다.
    this.clock.set(analysis.bpm, t0 + analysis.offset);
    this.musicMode = 'buffer';
    this.songKey = `buffer:${analysis.bpm}:${buffer.duration.toFixed(2)}`;
  }

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.15;
    // 오래 멈춰 있었다면 지난 스텝은 소리 없이 건너뛴다(한꺼번에 몰려 재생되는 것 방지)
    let next = this.t0 + this.step * this.stepDur;
    if (next < ctx.currentTime - 0.05) {
      this.step = Math.ceil((ctx.currentTime - this.t0) / this.stepDur);
      next = this.t0 + this.step * this.stepDur;
    }
    while (next < ahead) {
      this._playStep(this.step, next);
      this.step++;
      next = this.t0 + this.step * this.stepDur;
    }
  }

  _playStep(step, t) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    if (this.musicMode === 'calib') {
      if (s % 4 === 0) this._kick(t, 1);
      if (s === 0) this._blip(t, 1760, 0.05, 0.12);
      return;
    }
    const song = this.song;
    const cyc = bar % 16;
    const section = cyc < 4 ? 'intro' : cyc < 12 ? 'main' : 'drop';
    const chordDeg = song.prog[Math.floor(bar / 2) % 4];
    const rootSemis = song.root + degreeToSemis(chordDeg);

    if (s % 4 === 0) this._kick(t, s === 0 ? 1 : 0.92);
    if (section !== 'intro' && (s === 4 || s === 12)) this._clap(t);
    if (s % 4 === 2) this._hat(t, song.hatOpen && s === 14 && section !== 'intro');
    if (section === 'drop' && s % 2 === 1) this._hat(t, false, 0.35);

    const b = song.bass[s];
    if (b && (section !== 'intro' || s % 4 === 2)) {
      const f = midiHz(rootSemis - 12 + (b === 2 ? 12 : 0));
      this._bass(t, f, this.stepDur * (b === 2 ? 0.9 : 1.7), section === 'intro' ? 0.6 : 1);
    }
    if (section === 'drop' && song.lead[s]) {
      const triad = [0, 2, 4].map((k) => midiHz(song.root + song.leadOct + degreeToSemis(chordDeg + k)));
      this._stab(t, triad, this.stepDur * 1.6);
    }
    if (cyc === 11 && s === 0) this._riser(t, this.stepDur * 16);
    if (cyc === 12 && s === 0) this._crash(t);
  }

  // ───────── 신스 보이스 ─────────

  _env(g, t, peak, attack, decay) {
    peak = Math.max(0.0002, peak); // 지수 램프는 0을 목표로 할 수 없다
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _noise(t, dur, out, { type = 'highpass', freq = 6000, q = 0.7, peak = 0.3, attack = 0.002 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, peak, attack, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.02);
    return { src, f, g };
  }

  _kick(t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(175, t);
    o.frequency.exponentialRampToValueAtTime(47, t + 0.085);
    const g = ctx.createGain();
    this._env(g, t, vel, 0.003, 0.3);
    o.connect(g).connect(this.kickBus);
    o.start(t);
    o.stop(t + 0.34);
    this._noise(t, 0.012, this.kickBus, { freq: 2500, peak: 0.35 * vel });
  }

  _hat(t, open, vel = 1) {
    this._noise(t, open ? 0.16 : 0.035, this.musicGain, { freq: 8200, peak: 0.12 * vel });
  }

  _clap(t) {
    for (let k = 0; k < 3; k++) {
      this._noise(t + k * 0.011, k === 2 ? 0.14 : 0.012, this.musicGain, { type: 'bandpass', freq: 1300, q: 0.9, peak: 0.32 });
    }
  }

  _bass(t, freq, dur, vel) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(320, t + dur * 0.85);
    const g = ctx.createGain();
    this._env(g, t, 0.26 * vel, 0.004, dur);
    f.connect(g).connect(this.musicGain);
    for (const det of [-11, 11]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = freq / 2;
    const sg = ctx.createGain();
    sg.gain.value = 0.35;
    sub.connect(sg).connect(f);
    sub.start(t);
    sub.stop(t + dur + 0.05);
  }

  _stab(t, freqs, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.07, 0.005, dur);
    f.connect(g);
    g.connect(this.musicGain);
    g.connect(this.delay);
    this.delay.delayTime.setValueAtTime(this.stepDur * 3, t);
    for (const fr of freqs) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      o.detune.value = (Math.random() - 0.5) * 14;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  _riser(t, dur) {
    const n = this._noise(t, dur, this.musicGain, { type: 'bandpass', freq: 400, q: 2, peak: 0.12, attack: dur * 0.9 });
    n.f.frequency.setValueAtTime(400, t);
    n.f.frequency.exponentialRampToValueAtTime(7000, t + dur);
  }

  _crash(t) {
    this._noise(t, 1.1, this.musicGain, { freq: 5000, peak: 0.16 });
  }

  _blip(t, freq, dur, peak, out = this.musicGain, type = 'sine') {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    this._env(g, t, peak, 0.003, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  // ───────── 효과음 ─────────

  _sfxOut(pan, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.sfxGain);
    } else g.connect(this.sfxGain);
    return g;
  }

  /**
   * @param {string} name
   * @param {{pan?:number, vol?:number, strength?:number}} [o]
   */
  sfx(name, o = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    const out = this._sfxOut(o.pan ?? 0, o.vol ?? 1);
    const s = o.strength ?? 1;
    switch (name) {
      case 'whoosh':
        {
          const n = this._noise(t, 0.12, out, { type: 'bandpass', freq: 600, q: 1.2, peak: 0.25, attack: 0.03 });
          n.f.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
        }
        break;
      case 'kickHit': {
        const o1 = this._blip(t, 120, 0.16, 0.7 * s, out);
        o1.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        this._noise(t, 0.05, out, { type: 'lowpass', freq: 2200, peak: 0.5 * s });
        break;
      }
      case 'door': {
        const o1 = this._blip(t, 190, 0.22, 0.5, out, 'triangle');
        o1.frequency.exponentialRampToValueAtTime(70, t + 0.2);
        this._noise(t, 0.35, out, { type: 'lowpass', freq: 1800, peak: 0.6 });
        this._noise(t + 0.03, 0.2, out, { type: 'bandpass', freq: 3200, q: 1.5, peak: 0.25 });
        break;
      }
      case 'wall':
        this._noise(t, 0.6, out, { type: 'lowpass', freq: 1100, peak: 0.7 });
        for (let k = 1; k < 6; k++) this._noise(t + k * 0.05 + Math.random() * 0.03, 0.06, out, { type: 'bandpass', freq: 900 + Math.random() * 2000, q: 2, peak: 0.25 });
        break;
      case 'locked': {
        const o1 = this._blip(t, 85, 0.18, 0.6, out, 'triangle');
        o1.frequency.exponentialRampToValueAtTime(55, t + 0.15);
        this._noise(t, 0.08, out, { type: 'bandpass', freq: 400, q: 3, peak: 0.25 });
        break;
      }
      case 'pistol':
      case 'smg':
      case 'shotgun': {
        const big = name === 'shotgun' ? 1.5 : name === 'smg' ? 0.7 : 1;
        this._noise(t, 0.09 * big, out, { type: 'lowpass', freq: 5200, peak: 0.55 * Math.min(1.2, big) });
        const o1 = this._blip(t, 150 * (2 - big * 0.5), 0.1 * big, 0.6, out);
        o1.frequency.exponentialRampToValueAtTime(45, t + 0.1 * big);
        break;
      }
      case 'launcher':
        this._noise(t, 0.4, out, { type: 'bandpass', freq: 700, q: 0.8, peak: 0.5, attack: 0.02 });
        break;
      case 'enemyShot':
        this._noise(t, 0.07, out, { type: 'bandpass', freq: 2400, q: 1, peak: 0.35 });
        this._blip(t, 420, 0.06, 0.15, out, 'square');
        break;
      case 'parry': {
        this._blip(t, 1320, 0.25, 0.35, out, 'square');
        this._blip(t + 0.02, 1980, 0.3, 0.25, out, 'sine');
        const n = this._noise(t, 0.1, out, { type: 'bandpass', freq: 3000, q: 4, peak: 0.3 });
        n.f.frequency.exponentialRampToValueAtTime(8000, t + 0.1);
        break;
      }
      case 'explosion': {
        this._noise(t, 1.3 * s, out, { type: 'lowpass', freq: 900, peak: 0.95, attack: 0.004 });
        const o1 = this._blip(t, 70, 0.9, 0.9, out);
        o1.frequency.exponentialRampToValueAtTime(28, t + 0.8);
        this._noise(t, 0.25, out, { type: 'highpass', freq: 3000, peak: 0.25 });
        break;
      }
      case 'perfect':
        this._blip(t, 1568, 0.12, 0.18, out);
        this._blip(t + 0.045, 2093, 0.18, 0.15, out);
        break;
      case 'good':
        this._blip(t, 1175, 0.1, 0.12, out);
        break;
      case 'hurt': {
        const o1 = this._blip(t, 160, 0.3, 0.5, out, 'sawtooth');
        o1.frequency.exponentialRampToValueAtTime(60, t + 0.28);
        this._noise(t, 0.2, out, { type: 'lowpass', freq: 600, peak: 0.4 });
        break;
      }
      case 'death': {
        const o1 = this._blip(t, 300, 0.9, 0.45, out, 'sawtooth');
        o1.frequency.exponentialRampToValueAtTime(40, t + 0.85);
        break;
      }
      case 'pickup':
        this._blip(t, 660, 0.07, 0.25, out, 'square');
        this._blip(t + 0.06, 990, 0.1, 0.22, out, 'square');
        break;
      case 'empty':
        this._noise(t, 0.015, out, { type: 'bandpass', freq: 4000, q: 5, peak: 0.3 });
        break;
      case 'throw':
        this._noise(t, 0.15, out, { type: 'bandpass', freq: 1200, q: 1.5, peak: 0.25, attack: 0.04 });
        break;
      case 'alert':
        this._blip(t, 880, 0.06, 0.12, out, 'square');
        this._blip(t + 0.07, 1175, 0.08, 0.1, out, 'square');
        break;
      case 'gas': {
        const n = this._noise(t, 1.4, out, { type: 'highpass', freq: 2500, peak: 0.22, attack: 0.08 });
        n.f.frequency.setValueAtTime(2500, t);
        break;
      }
      case 'chandelier':
        for (let k = 0; k < 5; k++) this._blip(t + k * 0.04, 2000 + Math.random() * 2500, 0.35, 0.08, out, 'triangle');
        this._noise(t, 0.4, out, { type: 'highpass', freq: 4000, peak: 0.2 });
        break;
      case 'crash':
        this._noise(t, 0.5, out, { type: 'lowpass', freq: 1500, peak: 0.7 });
        for (let k = 0; k < 6; k++) this._blip(t + k * 0.03, 2500 + Math.random() * 3000, 0.25, 0.07, out, 'triangle');
        break;
      case 'exitOpen':
        [0, 4, 7, 12].forEach((iv, k) => this._blip(t + k * 0.07, midiHz(72 + iv), 0.35, 0.12, out, 'triangle'));
        break;
      case 'clear':
        [0, 7, 12, 16, 19, 24].forEach((iv, k) => this._blip(t + k * 0.06, midiHz(67 + iv), 0.5, 0.12, out, 'square'));
        break;
      case 'ui':
        this._blip(t, 880, 0.04, 0.12, out, 'square');
        break;
      case 'strike':
        [0, 5, 10].forEach((iv, k) => this._blip(t + k * 0.05, midiHz(79 + iv), 0.2, 0.14, out, 'square'));
        break;
      default:
        break;
    }
  }
}
