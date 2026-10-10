/**
 * 放不下的文字改成跑馬燈：從右往左捲，每輪開頭停一下讓人讀。
 *
 * 放不放得下要等排版後才量得到，所以先建好結構，再用 scheduleMarquees() 在下一個畫格量；
 * 面板收起時量到的寬度是 0，要等重新打開再量一次。
 * 捲動的是「文字＋間隔＋複本」，捲到複本剛好接回原位，循環才看不出接縫。
 */

export const SPEED_PX_S = 40;   // 捲動速度
const HOLD = 0.2;               // 每輪開頭停住的比例（與 CSS keyframes 的 20% 一致）

function span(className, text) {
  const e = document.createElement('span');
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 把 box 的內容換成跑馬燈結構；文字沒變就不動（重建會讓捲到一半的動畫跳回開頭）。 */
export function setMarqueeText(box, text) {
  const value = String(text == null ? '' : text);
  if (box.dataset.mq === value && box.firstChild) return box;
  box.dataset.mq = value;
  box.title = value;
  box.classList.add('mp-mq');
  box.classList.remove('mp-mq-on');
  const track = span('mp-mq-track');
  track.appendChild(span('mp-mq-text', value));
  box.replaceChildren(track);
  return box;
}

/** 建一個跑馬燈元素。 */
export function marqueeText(tag, className, text) {
  const box = document.createElement(tag);
  box.className = className;
  return setMarqueeText(box, text);
}

/** 量 root 裡每個跑馬燈：放不下的開始捲，放得下的恢復靜止。 */
export function measureMarquees(root) {
  root.querySelectorAll('.mp-mq').forEach((box) => {
    const track = box.firstChild;
    const text = track && track.firstChild;
    if (!text || !box.clientWidth) return;    // 還沒排版（面板收起中）就等下次
    const overflow = text.offsetWidth > box.clientWidth + 1;
    let copy = text.nextSibling;
    if (!overflow) {
      if (copy) copy.remove();
      box.classList.remove('mp-mq-on');
      return;
    }
    if (!copy) {
      copy = span('mp-mq-text mp-mq-copy', text.textContent);
      copy.setAttribute('aria-hidden', 'true');
      track.appendChild(copy);
    }
    const distance = copy.offsetLeft - text.offsetLeft;
    box.style.setProperty('--mp-mq-shift', `-${distance}px`);
    box.style.setProperty('--mp-mq-dur', `${(distance / SPEED_PX_S / (1 - HOLD)).toFixed(2)}s`);
    box.classList.add('mp-mq-on');
  });
}

const pending = new WeakSet();
const nextFrame = (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16));

/** 等排版完成再量；同一個畫格內多次呼叫只量一次。 */
export function scheduleMarquees(root) {
  if (pending.has(root)) return;
  pending.add(root);
  nextFrame(() => {
    pending.delete(root);
    measureMarquees(root);
  });
}
