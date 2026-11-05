// 메뉴 화면(DOM): 타이틀, 메인, 스테이지, 랜덤 레이드, 커스텀 음악, 스니커즈, 설정(오프셋 보정), 조작법, 일시정지, 결과.

import { STAGES } from '../levels/levels.js';
import { formatTime } from '../game/scoring.js';
import { SNEAKERS, isUnlocked } from '../game/sneakers.js';
import { totalStars } from '../save.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const stars = (arr) => arr.map((s) => `<span class="star ${s ? 'on' : ''}">★</span>`).join('');

export class Menus {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.current = null;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      this.app.audio.sfx('ui');
      this.onAct(b.dataset.act, b.dataset, b);
    });
    root.addEventListener('input', (e) => this.onInput(e.target));
    root.addEventListener('change', (e) => this.onChange(e.target));
  }

  show(name, data) {
    this.current = name;
    this.data = data;
    this.root.classList.toggle('on', !!name);
    if (!name) {
      this.root.innerHTML = '';
      return;
    }
    const html = this[`render_${name}`](data);
    this.root.innerHTML = `<div class="screen screen-${name}">${html}</div>`;
    this.after?.();
    this.after = null;
  }

  // ───────── 화면 ─────────

  render_title() {
    return `
      <div class="logo">KICK<span>BEAT</span></div>
      <div class="tagline">비트에 맞춰 문짝을 걷어차라 · Rhythm-Reactive Door Breacher</div>
      <button class="big" data-act="start">▶ 클릭해서 시작</button>
      <div class="fine">소리를 켜고 플레이하세요 · 음악과 효과음은 전부 코드로 실시간 합성됩니다</div>
      ${this.app.touchOnly ? '<div class="warn">이 게임은 키보드+마우스 또는 게임패드가 필요합니다.</div>' : ''}`;
  }

  render_main() {
    const ts = totalStars(this.app.save.progress);
    return `
      <div class="logo small">KICK<span>BEAT</span></div>
      <div class="menu-list">
        <button data-act="go" data-to="stages">캠페인 <small>5 스테이지 · 150→200 BPM</small></button>
        <button data-act="go" data-to="random">랜덤 레이드 <small>시드로 만드는 무한 스테이지</small></button>
        <button data-act="go" data-to="custom">내 음악으로 플레이 <small>음원의 BPM·킥을 분석해 맵 생성</small></button>
        <button data-act="go" data-to="sneakers">스니커즈 <small>★ ${ts} 모음</small></button>
        <button data-act="go" data-to="settings">설정 · 싱크 보정</button>
        <button data-act="go" data-to="controls">조작법</button>
      </div>
      <div class="fine">Bass Syndicate가 도시의 모든 스피커를 장악했다. 지하 하역장부터 펜트하우스까지, 박자에 맞춰 문을 걷어차며 올라가라.</div>`;
  }

  render_stages() {
    const prog = this.app.save.progress;
    const cards = STAGES.map((s, i) => {
      const r = prog[s.id];
      const prevClear = i === 0 || prog[STAGES[i - 1].id]?.stars?.[0];
      const rival = this.app.rivalGhosts.get(s.id);
      return `
        <div class="card ${prevClear ? '' : 'locked'}">
          <div class="card-head"><b>${esc(s.name)}</b> <small>${esc(s.subtitle)}</small><span class="bpm">${s.bpm} BPM</span></div>
          <div class="card-body">
            <div>${stars(r?.stars ?? [false, false, false])} <small>★2 기준 ${formatTime(s.par)} · ★3 ${esc(s.challenge.label)}</small></div>
            <div><small>최고 기록 ${r?.bestTime != null ? formatTime(r.bestTime) : '—'} · 점수 ${(r?.bestScore ?? 0).toLocaleString()} ${r?.rank ? `· 랭크 ${r.rank}` : ''}</small></div>
            ${rival ? `<div><small class="rival">라이벌 고스트 ${formatTime(rival.time)} 불러옴</small></div>` : ''}
          </div>
          <div class="card-actions">
            ${prevClear ? `<button data-act="play" data-id="${s.id}">플레이</button>` : '<button disabled>이전 스테이지 클리어 시 열림</button>'}
            <label class="filebtn">고스트 불러오기<input type="file" accept=".json,application/json" data-ghost="${s.id}"></label>
          </div>
        </div>`;
    }).join('');
    return `<h2>캠페인</h2><div class="cards">${cards}</div><button data-act="go" data-to="main">← 뒤로</button>`;
  }

  render_random() {
    const seed = this.app.lastSeed ?? Math.floor(Math.random() * 99999) + 1;
    return `
      <h2>랜덤 레이드</h2>
      <p class="fine">같은 시드는 같은 맵·같은 음악입니다. 시드를 친구에게 알려 주고 기록을 겨뤄 보세요.</p>
      <div class="form">
        <label>시드 <input id="rnd-seed" type="number" min="1" max="999999" value="${seed}"></label>
        <button data-act="reroll">🎲 무작위</button>
        <label>BPM <select id="rnd-bpm">${[150, 160, 170, 180, 190, 200].map((b) => `<option ${b === 170 ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      </div>
      <button class="big" data-act="random-go">출격</button>
      <button data-act="go" data-to="main">← 뒤로</button>`;
  }

  render_custom(d = {}) {
    const a = d.analysis;
    return `
      <h2>내 음악으로 플레이</h2>
      <p class="fine">MP3·WAV·FLAC·OGG 파일을 놓으면 브라우저 안에서 킥 드럼과 BPM을 분석해 곡 길이·에너지에 맞는 스테이지를 만듭니다. 파일은 어디에도 업로드되지 않습니다.</p>
      <label class="drop" id="drop">
        <input type="file" accept="audio/*" id="custom-file">
        <div>${d.busy ? '분석 중…' : a ? esc(d.name) : '여기에 음악 파일을 끌어 놓거나 클릭해서 고르기'}</div>
      </label>
      ${d.error ? `<div class="warn">${esc(d.error)}</div>` : ''}
      ${
        a
          ? `<div class="analysis">
              <div><b>${a.bpm.toFixed(2)}</b> BPM <small>신뢰도 ${(a.confidence * 100).toFixed(0)}%</small></div>
              <div><small>첫 박 ${(a.offset * 1000).toFixed(0)}ms · 길이 ${formatTime(a.duration)} · 방 ${d.rooms}개</small></div>
              <div class="row"><button data-act="bpm-mul" data-k="0.5">BPM ÷2</button><button data-act="bpm-mul" data-k="2">BPM ×2</button></div>
              <p class="fine">박이 어긋나 들리면 BPM을 절반/두 배로 바꿔 보세요. 너무 느린 곡은 두 배가 더 신납니다.</p>
            </div>
            <button class="big" data-act="custom-go">이 곡으로 출격</button>`
          : ''
      }
      <button data-act="go" data-to="main">← 뒤로</button>`;
  }

  render_sneakers() {
    const ts = totalStars(this.app.save.progress);
    const cards = SNEAKERS.map((s) => {
      const un = isUnlocked(s, ts);
      const eq = this.app.save.sneaker === s.id;
      return `
        <div class="card sneaker ${un ? '' : 'locked'} ${eq ? 'equipped' : ''}">
          <div class="swatch" style="--c:#${s.color.toString(16).padStart(6, '0')};--s:#${s.sole.toString(16).padStart(6, '0')}"></div>
          <div class="card-head"><b>${esc(s.name)}</b></div>
          <div class="card-body"><small>${esc(s.desc)}</small></div>
          <div class="card-actions">${un ? (eq ? '<button disabled>장착 중</button>' : `<button data-act="equip" data-id="${s.id}">장착</button>`) : `<button disabled>★ ${s.unlockStars}개 필요</button>`}</div>
        </div>`;
    }).join('');
    return `<h2>스니커즈 <small>★ ${ts}</small></h2><div class="cards">${cards}</div><button data-act="go" data-to="main">← 뒤로</button>`;
  }

  render_settings(d = {}) {
    const s = this.app.save.settings;
    const back = d.from === 'pause' ? 'pause' : 'main';
    return `
      <h2>설정</h2>
      <div class="settings">
        <label>마우스 감도 <input type="range" min="0.1" max="4" step="0.05" value="${s.sensitivity}" data-set="sensitivity"><output>${s.sensitivity.toFixed(2)}</output></label>
        <label>시야각(FOV) <input type="range" min="65" max="115" step="1" value="${s.fov}" data-set="fov"><output>${s.fov}</output></label>
        <label>음악 볼륨 <input type="range" min="0" max="1" step="0.05" value="${s.music}" data-set="music"><output>${Math.round(s.music * 100)}</output></label>
        <label>효과음 볼륨 <input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-set="sfx"><output>${Math.round(s.sfx * 100)}</output></label>
        <label>오디오 싱크 보정(ms) <input type="range" min="-250" max="250" step="1" value="${s.audioOffsetMs}" data-set="audioOffsetMs"><output>${s.audioOffsetMs}</output></label>
        <div class="row"><button data-act="calibrate">싱크 자동 보정 (탭 테스트)</button><small>블루투스 이어폰처럼 지연이 큰 기기에서 판정이 늦을 때</small></div>
        <label class="check"><input type="checkbox" ${s.invertY ? 'checked' : ''} data-set="invertY"> 마우스 Y축 반전</label>
        <label class="check"><input type="checkbox" ${s.quality === 'high' ? 'checked' : ''} data-set="quality"> 고품질(블룸 효과)</label>
        <label class="check"><input type="checkbox" ${s.showGhost ? 'checked' : ''} data-set="showGhost"> 고스트 표시</label>
        <label class="check"><input type="checkbox" ${s.showHints ? 'checked' : ''} data-set="showHints"> 튜토리얼 힌트</label>
      </div>
      <button data-act="go" data-to="${back}">← 뒤로</button>`;
  }

  render_calibrate(d = {}) {
    return `
      <h2>싱크 보정</h2>
      <p>메트로놈 소리(킥)에 맞춰 <b>Space</b> 또는 <b>클릭</b>을 ${d.need ?? 12}번 누르세요.</p>
      <div class="calib-count" id="calib-count">${d.taps ?? 0} / ${d.need ?? 12}</div>
      <div class="calib-result" id="calib-result">${d.result ? esc(d.result) : ''}</div>
      <button data-act="calib-tap" class="big">탭</button>
      <button data-act="calib-done">완료</button>`;
  }

  render_controls() {
    const rows = [
      ['WASD / 방향키', '이동 (항상 전력 질주)'],
      ['마우스', '시점'],
      ['F · E · 우클릭', '발차기 — 비트에 맞으면 PERFECT + 불릿타임'],
      ['좌클릭', '사격 (빼앗은 총)'],
      ['Q · G', '총 던지기'],
      ['Space', '점프'],
      ['R', '즉시 재시작 (언제든)'],
      ['Esc', '일시정지'],
      ['게임패드', '왼스틱 이동 · 오른스틱 시점 · LB/RB/LT 발차기 · RT 사격 · A 점프 · X 던지기 · Y 재시작 · Start 일시정지'],
    ];
    return `
      <h2>조작법</h2>
      <table class="controls">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <ul class="fine tips">
        <li>화면 가운데 링이 작아지며 닫히는 순간이 박입니다. 아래 비트 바의 눈금이 가운데에서 만날 때도 같습니다.</li>
        <li>문 바로 뒤에 선 적은 문짝째로 날려 버릴 수 있습니다. 한 문짝으로 두 명 이상 = STRIKE.</li>
        <li>날아오는 탄·로켓을 발로 차면 되돌아갑니다(패링). 적은 쏘기 전에 총구가 빨갛게 빛납니다.</li>
        <li>잠긴 문 옆에는 X 표시가 된 석고보드 벽이 있습니다. 벽째로 걷어차세요.</li>
        <li>빨간 가스관을 차서 가스를 새게 한 뒤 총을 쏘면 폭발합니다. 적의 총격 불꽃으로도 터집니다.</li>
      </ul>
      <button data-act="go" data-to="main">← 뒤로</button>`;
  }

  render_pause() {
    return `
      <h2>일시정지</h2>
      <div class="menu-list">
        <button data-act="resume">계속하기</button>
        <button data-act="restart">재시작 (R)</button>
        <button data-act="go" data-to="settings" data-from="pause">설정</button>
        <button data-act="quit">메뉴로 나가기</button>
      </div>`;
  }

  render_results(r) {
    const labels = ['클리어', `기준 시간 ${formatTime(r.stage.par)} 이내`, r.stage.challenge?.label ?? '과제'];
    return `
      <div class="rank rank-${r.rank}">${r.rank}</div>
      <h2>${esc(r.stage.name)} 클리어</h2>
      <div class="results">
        <div>시간 <b>${formatTime(r.stats.time)}</b> ${r.newBestTime ? '<span class="badge">신기록</span>' : ''}</div>
        <div>점수 <b>${r.stats.score.toLocaleString()}</b> ${r.newBestScore ? '<span class="badge">최고점</span>' : ''}</div>
        <div>처치 <b>${r.stats.kills}</b> · PERFECT <b>${r.stats.perfects}</b> · GOOD <b>${r.stats.goods}</b> · 최대 콤보 <b>${r.stats.maxCombo}</b></div>
        <div>STRIKE <b>${r.stats.strikes}</b> · 패링 처치 <b>${r.stats.parryKills}</b> · 폭발 처치 <b>${r.stats.explosionKills}</b> · 탈취 <b>${r.stats.hijacks}</b></div>
        ${r.ghostDelta != null ? `<div>고스트 대비 <b class="${r.ghostDelta <= 0 ? 'good' : 'bad'}">${r.ghostDelta <= 0 ? '' : '+'}${r.ghostDelta.toFixed(2)}초</b></div>` : ''}
      </div>
      <div class="stars-row">${r.stars.map((s, i) => `<div class="star-item ${s ? 'on' : ''}"><span class="star ${s ? 'on' : ''}">★</span><small>${esc(labels[i])}</small></div>`).join('')}</div>
      ${r.unlocked ? `<div class="banner-inline">새 스니커즈 해금: ${esc(r.unlocked)}</div>` : ''}
      ${r.saveError ? `<div class="warn">${esc(r.saveError)}</div>` : ''}
      <div class="menu-list row">
        ${r.next ? '<button data-act="next" class="big">다음 스테이지 →</button>' : ''}
        <button data-act="restart">재도전 (R)</button>
        ${r.canExportGhost ? '<button data-act="export-ghost">고스트 파일 저장</button>' : ''}
        <button data-act="quit">메뉴</button>
      </div>`;
  }

  // ───────── 이벤트 ─────────

  onAct(act, ds) {
    const app = this.app;
    switch (act) {
      case 'start':
        app.begin();
        break;
      case 'go':
        this.show(ds.to, ds.from ? { from: ds.from } : this.data);
        break;
      case 'play':
        app.startCampaign(ds.id);
        break;
      case 'reroll':
        this.root.querySelector('#rnd-seed').value = String(Math.floor(Math.random() * 99999) + 1);
        break;
      case 'random-go': {
        const seed = Math.max(1, Math.min(999999, parseInt(this.root.querySelector('#rnd-seed').value, 10) || 1));
        const bpm = parseInt(this.root.querySelector('#rnd-bpm').value, 10) || 170;
        app.lastSeed = seed;
        app.startRandom(seed, bpm);
        break;
      }
      case 'bpm-mul':
        app.adjustCustomBpm(parseFloat(ds.k));
        break;
      case 'custom-go':
        app.startCustom();
        break;
      case 'equip':
        app.equip(ds.id);
        this.show('sneakers');
        break;
      case 'calibrate':
        app.startCalibration();
        break;
      case 'calib-tap':
        app.calibrationTap(performance.now());
        break;
      case 'calib-done':
        app.endCalibration();
        break;
      case 'resume':
        app.resume();
        break;
      case 'restart':
        app.restart();
        break;
      case 'quit':
        app.quitToMenu();
        break;
      case 'next':
        app.nextStage();
        break;
      case 'export-ghost':
        app.exportGhost();
        break;
      default:
        break;
    }
  }

  onInput(t) {
    if (!t.dataset.set || t.type !== 'range') return;
    const v = parseFloat(t.value);
    const out = t.parentElement.querySelector('output');
    const key = t.dataset.set;
    if (out) out.textContent = key === 'music' || key === 'sfx' ? Math.round(v * 100) : key === 'sensitivity' ? v.toFixed(2) : String(v);
    this.app.setSetting(key, v);
  }

  onChange(t) {
    if (t.dataset.set && t.type === 'checkbox') {
      const key = t.dataset.set;
      this.app.setSetting(key, key === 'quality' ? (t.checked ? 'high' : 'low') : t.checked);
      return;
    }
    if (t.dataset.ghost && t.files?.[0]) {
      this.app.importGhost(t.dataset.ghost, t.files[0]);
      return;
    }
    if (t.id === 'custom-file' && t.files?.[0]) this.app.loadCustomTrack(t.files[0]);
  }

  bindDrop() {
    const drop = this.root.querySelector('#drop');
    if (!drop) return;
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer.files?.[0];
      if (f) this.app.loadCustomTrack(f);
    });
  }
}
