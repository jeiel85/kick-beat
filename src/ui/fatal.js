// 복구할 수 없는 오류 안내 화면. 빈 검은 화면으로 멈추는 대신 무엇이 왜 안 되는지와 할 수 있는 일을 보여 준다.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {HTMLElement} root 메뉴 레이어
 * @param {{title:string, lines:string[], error?:unknown, actions?:{label:string, onClick:()=>void}[]}} o
 */
export function showFatal(root, o) {
  const detail = o.error ? (o.error instanceof Error ? `${o.error.name}: ${o.error.message}` : String(o.error)) : '';
  root.innerHTML = `
    <div class="screen screen-fatal" role="alert">
      <div class="logo small">KICK<span>BEAT</span></div>
      <h2>${esc(o.title)}</h2>
      ${o.lines.map((l) => `<p class="fine">${esc(l)}</p>`).join('')}
      ${detail ? `<pre class="fatal-detail">${esc(detail)}</pre>` : ''}
      <div class="menu-list row" id="fatal-actions"></div>
    </div>`;
  const box = root.querySelector('#fatal-actions');
  for (const a of o.actions ?? []) {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.addEventListener('click', a.onClick);
    box.appendChild(b);
  }
  root.classList.add('on');
}

// three.js r16x 이상은 WebGL2가 필요하다. 렌더러를 만들기 전에 확인해 원인을 정확히 알린다.
export function webgl2Available() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export const WEBGL_HELP = [
  '이 게임은 WebGL 2로 3D 화면을 그립니다. 지금 브라우저에서 WebGL 2를 사용할 수 없습니다.',
  '브라우저 설정에서 "하드웨어 가속 사용"을 켜고 브라우저를 다시 시작해 보세요.',
  '최신 Chrome·Edge·Firefox·Safari에서 플레이할 수 있습니다. 원격 데스크톱이나 가상 머신에서는 GPU가 막혀 있을 수 있습니다.',
];
