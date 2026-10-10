/** 疊在網頁上的小零件：音樂按鈕與提示訊息。 */

const TOAST_MS = 2500;
const LONG_PRESS_MS = 400;   // 按住多久才進入拖曳
const MOVE_TOLERANCE = 5;    // 長按判定前移動超過這距離就當作是捲動，不是長按
const BUTTON_SIZE = 52;      // 量不到尺寸時（剛建好、測試環境）的後備值

export function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'mp-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), TOAST_MS);
  return t;
}

/** 位置一律夾回視窗內，換螢幕或縮視窗時按鈕才不會跑不見。 */
function placeButton(btn, left, top) {
  const w = btn.offsetWidth || BUTTON_SIZE;
  const h = btn.offsetHeight || BUTTON_SIZE;
  const x = Math.max(0, Math.min(window.innerWidth - w, left));
  const y = Math.max(0, Math.min(window.innerHeight - h, top));
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;
  btn.style.right = 'auto';
  btn.style.bottom = 'auto';
  return { left: x, top: y };
}

/**
 * 長按後才能拖曳，短按仍然是點擊。
 * @param {HTMLElement} btn
 * @param {(pos:{left:number,top:number})=>void} [onMove] 放開時回報新位置
 */
function enableLongPressDrag(btn, onMove) {
  let timer = null;
  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0, offsetX = 0, offsetY = 0;
  let pos = null;

  const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  btn.addEventListener('pointerdown', (e) => {
    if (e.button) return; // 只吃左鍵／單指
    const rect = btn.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    moved = false;
    pos = null;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      dragging = true;
      btn.classList.add('mp-dragging');
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    }, LONG_PRESS_MS);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!dragging) {
      const far = Math.abs(e.clientX - startX) > MOVE_TOLERANCE
        || Math.abs(e.clientY - startY) > MOVE_TOLERANCE;
      if (far) cancelTimer();
      return;
    }
    e.preventDefault();
    moved = true;
    pos = placeButton(btn, e.clientX - offsetX, e.clientY - offsetY);
  });

  const finish = (e) => {
    cancelTimer();
    if (!dragging) return;
    dragging = false;
    btn.classList.remove('mp-dragging');
    try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
    // 拖過就別再觸發播放；click 緊接在 pointerup 之後、計時器之前送出
    btn.dataset.mpDragged = moved ? '1' : '';
    setTimeout(() => { btn.dataset.mpDragged = ''; }, 0);
    if (moved && pos && onMove) onMove(pos);
  };

  btn.addEventListener('pointerup', finish);
  btn.addEventListener('pointercancel', finish);
  // 手機長按會跳出系統選單，拖曳中要擋掉
  btn.addEventListener('contextmenu', (e) => { if (dragging) e.preventDefault(); });
}

/** 單頁應用程式可能重繪整頁，按鈕不見時要能重複呼叫補回來。 */
export function injectLaunchButton(onLaunch, opts = {}) {
  if (document.querySelector('.mp-launch')) return null;
  const btn = document.createElement('button');
  btn.className = 'mp-launch';
  btn.textContent = '🎵';
  btn.title = '音樂播放器（Alt+M 開關面板，長按可拖曳位置）';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (btn.dataset.mpDragged) return;
    onLaunch();
  });
  enableLongPressDrag(btn, opts.onMove);
  document.body.appendChild(btn);
  if (opts.position) placeButton(btn, opts.position.left, opts.position.top);
  return btn;
}
