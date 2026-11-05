// 앱 진입점: 렌더러·후처리·조명, 화면 상태 머신(타이틀/메뉴/플레이/일시정지/결과), 저장, 커스텀 음악, 보정.

import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AudioEngine } from './audio/engine.js';
import { analyzeBeats } from './audio/beatDetect.js';
import { STAGES, stageById } from './levels/levels.js';
import { parseLevel, validateLevel } from './levels/parse.js';
import { generateStage } from './levels/generate.js';
import { hash32 } from './levels/rng.js';
import { Input } from './input.js';
import { Fx } from './game/fx.js';
import { Session } from './game/session.js';
import { Viewmodel } from './game/viewmodel.js';
import { rankFor, starsFor } from './game/scoring.js';
import { SNEAKERS, isUnlocked, sneakerById } from './game/sneakers.js';
import { validateGhost } from './game/ghost.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { WEBGL_HELP, showFatal, webgl2Available } from './ui/fatal.js';
import { loadGhost, loadSave, recordResult, storeGhost, totalStars, writeSave } from './save.js';

const canvas = document.getElementById('game');
const menuRoot = document.getElementById('menu');

// WebGL2가 없거나 컨텍스트 생성이 실패하면 빈 화면 대신 원인과 해결 방법을 보여 주고 부팅을 멈춘다.
// (모듈 최상위에서 다시 던져 이후 초기화가 실행되지 않게 한다 — 오류는 콘솔에도 그대로 남는다)
function createRenderer() {
  if (!webgl2Available()) {
    showFatal(menuRoot, { title: '3D 그래픽을 시작할 수 없습니다', lines: WEBGL_HELP });
    throw new Error('WebGL2를 사용할 수 없어 시작을 중단했다');
  }
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (e) {
    showFatal(menuRoot, { title: '3D 그래픽을 시작할 수 없습니다', lines: WEBGL_HELP, error: e });
    throw e;
  }
}
const renderer = createRenderer();
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07050b);
scene.fog = new THREE.FogExp2(0x0a0612, 0.028);
const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 160);
scene.add(new THREE.HemisphereLight(0xb39cff, 0x2a1838, 2.8));
scene.add(new THREE.AmbientLight(0x4a4258, 1.4));
const playerLight = new THREE.PointLight(0xffe2cc, 11, 14, 1.5);
scene.add(playerLight);
const flashLight = new THREE.PointLight(0xffb347, 0, 20, 1.6);
scene.add(flashLight);

const vmScene = new THREE.Scene();
vmScene.add(new THREE.HemisphereLight(0xc9b8ff, 0x231a2e, 1.6));
const vmSun = new THREE.DirectionalLight(0xffffff, 1.4);
vmSun.position.set(1, 2, 1);
vmScene.add(vmSun);

const composer = new EffectComposer(renderer);
const mainPass = new RenderPass(scene, camera);
const vmPass = new RenderPass(vmScene, camera);
vmPass.clear = false;
vmPass.clearDepth = true;
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.45, 0.62);
composer.addPass(mainPass);
composer.addPass(vmPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const save = loadSave();
const audio = new AudioEngine();
audio.settings.music = save.settings.music;
audio.settings.sfx = save.settings.sfx;
const input = new Input(canvas);
const hud = new Hud(document.getElementById('hud'));
const fx = new Fx(scene, camera, hud.popupLayer, flashLight);
const vm = new Viewmodel(vmScene, sneakerById(save.sneaker));

const app = {
  save,
  audio,
  rivalGhosts: new Map(),
  touchOnly: matchMedia('(hover: none) and (pointer: coarse)').matches,
  state: 'title',
  session: null,
  current: null, // {kind, stage, level, ghost}
  custom: null, // {buffer, analysis, name}
  calib: null,
};
const menus = new Menus(menuRoot, app);

function quality() {
  return save.settings.quality;
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = quality() === 'high' ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 1) * 0.8;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function persist() {
  const err = writeSave(save);
  if (err) hud.toast(err);
  return err;
}

// ───────── 앱 동작(메뉴에서 호출) ─────────

app.begin = async () => {
  try {
    await audio.init();
  } catch (e) {
    menus.show('title');
    alert(`오디오를 시작하지 못했습니다: ${e.message}`);
    return;
  }
  audio.playSynth({ bpm: 150, seed: 11, root: 45 });
  app.state = 'menu';
  menus.show('main');
};

function sessionCtx() {
  return { scene, camera, vm, audio, input, settings: save.settings, sneaker: sneakerById(save.sneaker), hud, fx };
}

function launch(cur) {
  if (app.session) app.session.dispose();
  fx.reset();
  // 죽음·불릿타임 중 재시작해도 음악의 저역 필터가 남지 않게(세션이 바뀌면 필터를 해제할 주체가 없다)
  audio.bulletTime(false);
  app.current = cur;
  // 라이벌 고스트(파일) > 내 최고 기록 고스트
  const ghost = app.rivalGhosts.get(cur.stage.id) ?? (cur.kind === 'campaign' ? loadGhost(cur.stage.id) : null);
  app.session = new Session(sessionCtx(), cur.level, cur.stage, ghost);
  const best = save.progress[cur.stage.id]?.bestTime ?? null;
  hud.setStage(cur.stage.name, cur.stage.subtitle, ghost ? ghost.time : best);
  hud.show(true);
  menus.show(null);
  input.enabled = true;
  input.consumeActions();
  input.consumeMouse();
  app.state = 'playing';
  input.requestLock().catch(() => hud.toast('화면을 클릭하면 마우스가 고정됩니다'));
  audio.resume();
}

function ensureMusic(cur) {
  if (cur.kind === 'custom') {
    const key = `buffer:${app.custom.analysis.bpm}:${app.custom.buffer.duration.toFixed(2)}`;
    if (audio.songKey !== key || audio.musicMode !== 'buffer') audio.playBuffer(app.custom.buffer, app.custom.analysis);
    return;
  }
  const m = cur.stage.music;
  const key = `synth:${cur.stage.bpm}:${m.seed}:${m.root}`;
  if (audio.songKey !== key || audio.musicMode !== 'synth') audio.playSynth({ bpm: cur.stage.bpm, seed: m.seed, root: m.root });
}

app.startCampaign = (id) => {
  const stage = stageById(id);
  if (!stage) return;
  const level = parseLevel(stage);
  const cur = { kind: 'campaign', stage, level };
  ensureMusic(cur);
  launch(cur);
};

app.startRandom = (seed, bpm) => {
  const energies = Array.from({ length: 6 + (seed % 3) }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(seed * 0.37 + i * 1.3)));
  const def = generateStage({ seed, bpm, energies, id: `random-${seed}-${bpm}`, name: `랜덤 레이드 #${seed}` });
  const level = parseLevel(def);
  const problems = validateLevel(level);
  if (problems.length) {
    // 생성기 테스트로 막아 둔 경우지만, 만약 생기면 숨기지 않고 알린다
    menus.show('random');
    hud.toast(`맵 생성 오류: ${problems[0]}`);
    console.error('[random] invalid level', problems, def.rows.join('\n'));
    return;
  }
  const cur = { kind: 'random', stage: def, level };
  ensureMusic(cur);
  launch(cur);
};

app.loadCustomTrack = async (file) => {
  if (file.size > 80 * 1024 * 1024) {
    menus.show('custom', { error: '파일이 너무 크다(80MB 이하)' });
    return;
  }
  menus.show('custom', { busy: true });
  try {
    const buf = await file.arrayBuffer();
    const audioBuffer = await audio.ctx.decodeAudioData(buf);
    const ch0 = audioBuffer.getChannelData(0);
    let mono = ch0;
    if (audioBuffer.numberOfChannels > 1) {
      const ch1 = audioBuffer.getChannelData(1);
      mono = new Float32Array(ch0.length);
      for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
    await new Promise((r) => setTimeout(r, 30)); // '분석 중' 표시가 그려지도록
    const analysis = analyzeBeats(mono, audioBuffer.sampleRate);
    const rooms = Math.max(4, Math.min(10, Math.round(analysis.duration / 22)));
    app.custom = { buffer: audioBuffer, analysis, name: file.name, rooms };
    menus.show('custom', { analysis, name: file.name, rooms });
  } catch (e) {
    console.error('[custom] 분석 실패', e);
    menus.show('custom', { error: `분석하지 못했다: ${e.message || e}` });
  }
  menus.bindDrop();
};

app.adjustCustomBpm = (k) => {
  const c = app.custom;
  if (!c) return;
  const a = c.analysis;
  const bpm = a.bpm * k;
  if (bpm < 50 || bpm > 260) return;
  const period = 60 / bpm;
  const beats = Math.floor((a.duration - a.offset) / period);
  c.analysis = { ...a, bpm: Math.round(bpm * 100) / 100, offset: a.offset % period, loopStart: a.offset % period, loopEnd: (a.offset % period) + beats * period };
  menus.show('custom', { analysis: c.analysis, name: c.name, rooms: c.rooms });
  menus.bindDrop();
};

app.startCustom = () => {
  const c = app.custom;
  if (!c) return;
  const a = c.analysis;
  const seed = hash32([Math.round(a.bpm * 100), Math.round(a.duration * 10), ...a.energies.map((e) => Math.round(e * 100))]) % 999983;
  const energies = Array.from({ length: c.rooms }, (_, i) => a.energies[Math.floor((i / c.rooms) * a.energies.length)]);
  const def = generateStage({ seed: seed + 1, bpm: a.bpm, energies, id: `custom-${seed}`, name: c.name.replace(/\.[^.]+$/, '').slice(0, 40) });
  const level = parseLevel(def);
  const cur = { kind: 'custom', stage: def, level };
  ensureMusic(cur);
  launch(cur);
};

app.restart = () => {
  if (!app.current) return;
  launch(app.current);
};

app.resume = () => {
  if (!app.session) return;
  menus.show(null);
  hud.show(true);
  app.state = 'playing';
  input.enabled = true;
  input.consumeActions();
  input.consumeMouse();
  audio.resume();
  input.requestLock().catch(() => hud.toast('화면을 클릭하면 마우스가 고정됩니다'));
};

function pause() {
  if (app.state !== 'playing') return;
  app.state = 'paused';
  input.enabled = false;
  audio.suspend();
  menus.show('pause');
}

app.quitToMenu = () => {
  if (app.session) app.session.dispose();
  app.session = null;
  app.current = null;
  fx.reset();
  hud.show(false);
  input.enabled = false;
  input.exitLock();
  audio.resume();
  audio.bulletTime(false);
  app.state = 'menu';
  menus.show('main');
};

app.nextStage = () => {
  const i = STAGES.findIndex((s) => s.id === app.current?.stage.id);
  if (i >= 0 && i + 1 < STAGES.length) app.startCampaign(STAGES[i + 1].id);
};

app.equip = (id) => {
  const s = sneakerById(id);
  if (!isUnlocked(s, totalStars(save.progress))) return;
  save.sneaker = id;
  vm.setSneaker(s);
  persist();
};

app.setSetting = (key, value) => {
  save.settings[key] = value;
  if (key === 'music' || key === 'sfx') audio.setVolumes(save.settings.music, save.settings.sfx);
  if (key === 'quality') resize();
  persist();
};

app.importGhost = async (stageId, file) => {
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('파일이 너무 크다');
    const g = JSON.parse(await file.text());
    const err = validateGhost(g, stageId);
    if (err) throw new Error(err);
    app.rivalGhosts.set(stageId, g);
    menus.show('stages');
  } catch (e) {
    menus.show('stages');
    alert(`고스트를 불러오지 못했습니다: ${e.message}`);
  }
};

app.exportGhost = () => {
  const g = app.lastGhost;
  if (!g) return;
  const blob = new Blob([JSON.stringify(g)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kickbeat-ghost-${g.stageId}-${g.time.toFixed(2)}s.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ───────── 싱크 보정 ─────────

app.startCalibration = () => {
  app.calib = { taps: [], need: 12, from: menus.data?.from };
  audio.resume();
  audio.playSynth({ bpm: 120, seed: 1 }, { calib: true });
  menus.show('calibrate', { taps: 0, need: 12 });
};

app.calibrationTap = (perfMs) => {
  const c = app.calib;
  if (!c) return;
  const heard = audio.heardTime(perfMs);
  c.taps.push(audio.clock.deltaMs(heard));
  if (c.taps.length > 2 && c.taps.length <= c.need) {
    menus.root.querySelector('#calib-count').textContent = `${c.taps.length} / ${c.need}`;
  } else {
    const el = menus.root.querySelector('#calib-count');
    if (el) el.textContent = `${c.taps.length} / ${c.need}`;
  }
  if (c.taps.length >= c.need) {
    // 처음 두 번은 박을 잡는 중이라 버리고, 나머지의 중앙값을 쓴다
    const used = c.taps.slice(2).sort((a, b) => a - b);
    const med = used[Math.floor(used.length / 2)];
    const spread = used[used.length - 1] - used[0];
    if (spread > 220) {
      c.result = `탭 간격이 너무 들쭉날쭉하다(${Math.round(spread)}ms). 다시 해 보자.`;
      c.taps = [];
    } else {
      const offset = Math.round(Math.max(-250, Math.min(250, med)));
      save.settings.audioOffsetMs = offset;
      persist();
      c.result = `보정값 ${offset}ms 적용 완료`;
    }
    menus.root.querySelector('#calib-result').textContent = c.result;
    menus.root.querySelector('#calib-count').textContent = `${c.taps.length} / ${c.need}`;
  }
};

app.endCalibration = () => {
  const from = app.calib?.from;
  app.calib = null;
  if (app.current) ensureMusic(app.current);
  else audio.playSynth({ bpm: 150, seed: 11, root: 45 });
  if (from === 'pause') {
    audio.suspend();
    menus.show('settings', { from: 'pause' });
  } else menus.show('settings');
};

window.addEventListener(
  'keydown',
  (e) => {
    if (menus.current === 'calibrate' && (e.code === 'Space' || e.code === 'KeyF')) {
      e.preventDefault();
      app.calibrationTap(e.timeStamp);
    } else if (app.state === 'results' && e.code === 'KeyR') {
      app.restart();
    } else if (app.state === 'results' && e.code === 'Enter') {
      if (app.current?.kind === 'campaign') app.nextStage();
    }
  },
  true,
);

// ───────── 결과 ─────────

function finishStage() {
  const s = app.session;
  const cur = app.current;
  const stats = { ...s.stats };
  const stars = starsFor(cur.stage, stats);
  const rank = rankFor(cur.stage, stats);
  const before = totalStars(save.progress);
  const { newBestTime, newBestScore } = recordResult(save, cur.stage.id, { time: stats.time, score: stats.score, stars, rank });
  let saveError = persist();
  const ghost = s.ghostRecord();
  app.lastGhost = ghost;
  if (newBestTime && cur.kind === 'campaign') saveError = storeGhost(cur.stage.id, ghost) ?? saveError;
  const after = totalStars(save.progress);
  const unlocked = SNEAKERS.filter((sn) => sn.unlockStars > before && sn.unlockStars <= after).map((sn) => sn.name).join(', ');
  const i = STAGES.findIndex((x) => x.id === cur.stage.id);
  const ghostDelta = s.ghost ? stats.time - s.ghost.time : null;
  app.state = 'results';
  input.enabled = false;
  input.exitLock();
  hud.show(false);
  menus.show('results', { stage: cur.stage, stats, stars, rank, newBestTime, newBestScore, next: cur.kind === 'campaign' && i >= 0 && i + 1 < STAGES.length, canExportGhost: true, unlocked, saveError, ghostDelta });
}

// ───────── 포인터 고정·포커스 ─────────

input.onLockChange = (locked) => {
  if (!locked && app.state === 'playing' && !app.session?.player.dead) pause();
};
canvas.addEventListener('click', () => {
  if (app.state !== 'playing') return;
  if (app.session?.player.dead) {
    app.restart();
    return;
  }
  if (!input.locked) input.requestLock().catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (app.state === 'playing') pause();
    else audio.suspend();
  } else if (app.state !== 'paused') audio.resume();
});

// ───────── 루프 ─────────

let last = performance.now();
let deadShown = false;
function frame(now) {
  requestAnimationFrame(frame);
  if (app.state === 'error') return; // 오류 화면에서는 실패한 갱신·렌더를 반복하지 않는다
  try {
    step(now);
  } catch (e) {
    onFrameError(e);
  }
}

// 프레임 처리 중 예외: 같은 오류가 매 프레임 반복되며 화면이 굳는 대신, 멈추고 알리고 복구 수단을 준다
function onFrameError(e) {
  console.error('[frame] 게임 루프 오류 — 세션을 멈춘다', e);
  const hadSession = !!app.current;
  app.state = 'error';
  input.enabled = false;
  input.exitLock();
  hud.show(false);
  audio.bulletTime(false);
  showFatal(menuRoot, {
    title: '게임 진행 중 오류가 발생했습니다',
    lines: ['이번 판을 멈췄습니다. 다시 시작하면 대부분 이어서 플레이할 수 있습니다.', '같은 오류가 반복되면 아래 내용을 저장소 이슈로 알려 주세요.'],
    error: e,
    actions: [
      ...(hadSession ? [{ label: '이 스테이지 다시 시작', onClick: () => recover(true) }] : []),
      { label: '메뉴로', onClick: () => recover(false) },
    ],
  });
}

function recover(restart) {
  menuRoot.classList.remove('on');
  app.state = 'menu';
  try {
    if (restart && app.current) app.restart();
    else app.quitToMenu();
  } catch (e) {
    onFrameError(e);
  }
}

function step(now) {
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  input.pollGamepad();
  const s = app.session;

  if (s && app.state === 'playing') {
    const events = s.update(realDt, input);
    for (const ev of events) {
      if (ev.type === 'restart') {
        app.restart();
        return;
      }
      if (ev.type === 'pause') pause();
      if (ev.type === 'cleared') setTimeout(() => app.state === 'playing' && app.session === s && finishStage(), 700);
    }
    if (s.player.dead !== deadShown) {
      deadShown = s.player.dead;
      hud.death(deadShown);
    }
  } else if (app.state !== 'playing' && deadShown) {
    deadShown = false;
    hud.death(false);
  }

  // 비트에 맞춰 네온·스피커가 맥동
  const heard = audio.ready ? audio.heardTime(now) - save.settings.audioOffsetMs / 1000 : 0;
  const phase = audio.ready ? audio.clock.phaseAt(heard) : 0;
  const pulse = Math.exp(-phase * 7);
  if (s) {
    s.world.neonMat.color.setScalar(0.55 + pulse * 1.6);
    s.world.coneMat.color.copy(s.world.palette[0]).multiplyScalar(0.6 + pulse * 1.8);
    for (const c of s.world.speakers) c.scale.setScalar(1 + pulse * 0.25);
    playerLight.position.set(camera.position.x, camera.position.y + 0.3, camera.position.z);
    if (app.state === 'playing') hud.update(s, { phase }, realDt);
  }

  if (s) {
    bloom.enabled = quality() === 'high';
    composer.render();
  } else {
    renderer.setClearColor(0x07050b, 1);
    renderer.clear();
  }
}
requestAnimationFrame(frame);

menus.show('title');

// 개발 중 브라우저 자동 점검용 훅(프로덕션 빌드에는 포함되지 않는다)
if (import.meta.env.DEV) {
  window.__kb = { app, input, audio, scene, camera, menus, hud, STAGES, renderer, composer, vmScene };
}
