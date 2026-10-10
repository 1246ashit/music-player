import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { marqueeText, setMarqueeText, measureMarquees, scheduleMarquees, SPEED_PX_S } from '../src/ui/marquee.js';

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); });

/** jsdom 沒有排版：手動給寬度與位置。 */
function layout(box, { boxWidth, textWidth, gap = 30 }) {
  Object.defineProperty(box, 'clientWidth', { value: boxWidth, configurable: true });
  const text = box.querySelector('.mp-mq-text');
  Object.defineProperty(text, 'offsetWidth', { value: textWidth, configurable: true });
  Object.defineProperty(text, 'offsetLeft', { value: 0, configurable: true });
  // 複本在量的時候才建立，所以攔 appendChild 幫它補上位置
  const track = box.querySelector('.mp-mq-track');
  const append = track.appendChild.bind(track);
  track.appendChild = (node) => {
    Object.defineProperty(node, 'offsetLeft', { value: textWidth + gap, configurable: true });
    return append(node);
  };
}

function mount(text) {
  const box = marqueeText('div', 'mp-lib-title', text);
  document.body.appendChild(box);
  return box;
}

describe('結構', () => {
  it('保留原本的 class，文字放在裡面，並以 title 顯示完整名稱', () => {
    const box = mount('很長的專輯名稱');
    expect(box.className).toContain('mp-lib-title');
    expect(box.className).toContain('mp-mq');
    expect(box.textContent).toBe('很長的專輯名稱');
    expect(box.title).toBe('很長的專輯名稱');
  });

  it('名稱當純文字', () => {
    const box = mount('<img src=x onerror=alert(1)>');
    expect(box.querySelector('img')).toBeNull();
  });

  it('文字沒變時不重建（不然捲到一半會跳回開頭）', () => {
    const box = mount('A');
    const track = box.firstChild;
    setMarqueeText(box, 'A');
    expect(box.firstChild).toBe(track);
    setMarqueeText(box, 'B');
    expect(box.firstChild).not.toBe(track);
    expect(box.textContent).toBe('B');
  });
});

describe('measureMarquees', () => {
  it('放不下時開始捲：加上複本，捲動距離 = 文字寬 + 間隔', () => {
    const box = mount('很長的專輯名稱');
    layout(box, { boxWidth: 100, textWidth: 250, gap: 30 });
    measureMarquees(document.body);
    expect(box.classList.contains('mp-mq-on')).toBe(true);
    const copies = box.querySelectorAll('.mp-mq-copy');
    expect(copies).toHaveLength(1);
    expect(copies[0].getAttribute('aria-hidden')).toBe('true');
    expect(box.style.getPropertyValue('--mp-mq-shift')).toBe('-280px');
    // 移動 280px 的時間佔整輪的 80%，其餘是開頭停住
    expect(parseFloat(box.style.getPropertyValue('--mp-mq-dur'))).toBeCloseTo(280 / SPEED_PX_S / 0.8, 1);
  });

  it('放得下就不捲，也不多一份複本', () => {
    const box = mount('短');
    layout(box, { boxWidth: 100, textWidth: 40 });
    measureMarquees(document.body);
    expect(box.classList.contains('mp-mq-on')).toBe(false);
    expect(box.querySelector('.mp-mq-copy')).toBeNull();
  });

  it('重量不會一直加複本；變得放得下時收回', () => {
    const box = mount('很長的專輯名稱');
    layout(box, { boxWidth: 100, textWidth: 250 });
    measureMarquees(document.body);
    measureMarquees(document.body);
    expect(box.querySelectorAll('.mp-mq-copy')).toHaveLength(1);
    Object.defineProperty(box, 'clientWidth', { value: 400, configurable: true });
    measureMarquees(document.body);
    expect(box.classList.contains('mp-mq-on')).toBe(false);
    expect(box.querySelector('.mp-mq-copy')).toBeNull();
  });

  it('還沒排版（面板收起、寬度 0）時先不動，等下次再量', () => {
    const box = mount('很長的專輯名稱');
    layout(box, { boxWidth: 0, textWidth: 250 });
    measureMarquees(document.body);
    expect(box.classList.contains('mp-mq-on')).toBe(false);
  });
});

describe('scheduleMarquees', () => {
  it('等到下一個畫格才量，同一個畫格只量一次', () => {
    vi.useFakeTimers();
    const box = mount('很長的專輯名稱');
    layout(box, { boxWidth: 100, textWidth: 250 });
    const spy = vi.spyOn(document.body, 'querySelectorAll');
    scheduleMarquees(document.body);
    scheduleMarquees(document.body);
    expect(box.classList.contains('mp-mq-on')).toBe(false);
    vi.advanceTimersByTime(50);
    expect(box.classList.contains('mp-mq-on')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
