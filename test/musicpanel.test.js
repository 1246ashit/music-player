import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMusicPanel, formatTime, formatSize, describeUpload } from '../src/ui/musicpanel.js';

beforeEach(() => { document.body.innerHTML = ''; });

const HANDLERS = [
  'upload', 'toggle', 'next', 'prev', 'seek', 'volume', 'repeat', 'shuffle', 'captions', 'hide',
  'setView', 'play', 'playView', 'createAlbum', 'renameAlbum', 'setCover', 'removeAlbum', 'move', 'reorder', 'remove',
];

function setup({ confirm = () => true } = {}) {
  const on = Object.fromEntries(HANDLERS.map((k) => [k, vi.fn()]));
  const panel = createMusicPanel({ on, confirm });
  document.body.appendChild(panel.el);
  return { panel, on, $: (s) => panel.el.querySelector(s) };
}

const ALBUM = { id: 10, name: '睡前', cover: 'data:image/webp;base64,AAA', createdAt: 1 };
const TRACKS = [
  { id: 1, audioName: '01_おやすみ.wav', size: 50 * 1024 * 1024, subtitleName: '01_おやすみ.wav.vtt', albumId: 10, order: 0 },
  { id: 2, audioName: 'rain.mp3', size: 3000, subtitleName: null, albumId: null, order: 1 },
];

const state = (over = {}) => ({
  tracks: TRACKS, albums: [ALBUM], currentId: null, paused: true, time: 0, duration: 0,
  volume: 0.8, repeat: 'all', captions: true, shuffle: false, scope: 'all', view: 'all', ...over,
});

const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('格式化', () => {
  it('時間：分:秒，超過一小時加上時', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(NaN)).toBe('0:00');
  });

  it('檔案大小', () => {
    expect(formatSize(50 * 1024 * 1024)).toBe('50.0 MB');
    expect(formatSize(3000)).toBe('3 KB');
  });

  it('上傳摘要裡的字幕名一律清成 xxx.vtt', () => {
    const text = describeUpload({ added: 2, attached: [5], duplicates: ['a.wav'], orphans: ['b.wav.vtt'], ignored: ['c.txt'] });
    expect(text).toContain('新增 2 首');
    expect(text).toContain('補上 1 個字幕');
    expect(text).toContain('b.vtt');
    expect(text).not.toContain('b.wav.vtt');
    expect(text).toContain('c.txt');
  });

  it('什麼都沒加入時也有說明', () => {
    expect(describeUpload({ added: 0, attached: [], duplicates: [], orphans: [], ignored: [] })).toBe('沒有可加入的檔案');
  });
});

describe('正在播放', () => {
  it('顯示曲名、所屬專輯、封面、時間與播放鍵狀態', () => {
    const { panel, $ } = setup();
    panel.render(state({ currentId: 1, paused: false, time: 65, duration: 3725 }));
    expect($('.mp-music-title').textContent).toBe('01_おやすみ');
    expect($('.mp-music-album').textContent).toBe('睡前');
    expect($('.mp-music-art img').src).toBe(ALBUM.cover);
    expect($('.mp-music-pos').textContent).toBe('1:05');
    expect($('.mp-music-dur').textContent).toBe('1:02:05');
    expect($('.mp-music-play').textContent).toBe('⏸');
  });

  it('未分類的歌顯示「未分類」；還沒選歌時空白', () => {
    const { panel, $ } = setup();
    panel.render(state({ currentId: 2 }));
    expect($('.mp-music-album').textContent).toBe('未分類');
    panel.render(state());
    expect($('.mp-music-title').textContent).toBe('還沒選歌');
    expect($('.mp-music-album').textContent).toBe('');
  });

  it('拖進度條時不被時間更新蓋掉，放開才 seek', () => {
    const { panel, on, $ } = setup();
    panel.render(state({ currentId: 1, duration: 100, time: 1 }));
    const seek = $('.mp-music-seek');
    seek.value = '50';
    seek.dispatchEvent(new Event('input'));
    panel.render(state({ currentId: 1, duration: 100, time: 2 }));
    expect(seek.value).toBe('50');
    seek.dispatchEvent(new Event('change'));
    expect(on.seek).toHaveBeenCalledWith(50);
  });

  it('隨機、循環模式與字幕開關的樣式', () => {
    const { panel, $ } = setup();
    panel.render(state({ repeat: 'one', captions: false, shuffle: true }));
    expect($('.mp-music-repeat').textContent).toBe('🔂');
    expect($('.mp-music-cc').classList.contains('active')).toBe(false);
    expect($('.mp-music-shuffle').classList.contains('active')).toBe(true);
  });
});

describe('操作', () => {
  it('控制鍵對應到各自的回呼', () => {
    const { on, $ } = setup();
    ['prev', 'toggle', 'next', 'shuffle', 'repeat', 'captions'].forEach((a) => click($(`[data-a="${a}"]`)));
    click($('.mp-music-hide'));
    ['prev', 'toggle', 'next', 'shuffle', 'repeat', 'captions', 'hide'].forEach((k) => expect(on[k]).toHaveBeenCalled());
  });

  it('調音量回報數值', () => {
    const { on, $ } = setup();
    const vol = $('.mp-music-vol');
    vol.value = '0.3';
    vol.dispatchEvent(new Event('input'));
    expect(on.volume).toHaveBeenCalledWith(0.3);
  });

  it('選檔上傳：只收 wav/mp3/vtt 等副檔名，選完交出檔案', () => {
    const { on, $ } = setup();
    const input = $('.mp-music-upload input');
    expect(input.accept).toContain('.vtt');
    expect(input.multiple).toBe(true);
    const files = [new File(['x'], 'a.wav'), new File(['y'], 'a.wav.vtt')];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(on.upload).toHaveBeenCalledWith(files);
  });

  it('上傳鈕標示會放進哪裡', () => {
    const { panel, $ } = setup();
    panel.render(state({ view: 10 }));
    expect($('.mp-music-upload-text').textContent).toBe('＋ 上傳到「睡前」');
    panel.render(state({ view: 'all' }));
    expect($('.mp-music-upload-text').textContent).toBe('＋ 上傳音樂／字幕');
  });

  it('從外面拖檔案進面板也能上傳', () => {
    const { panel, on } = setup();
    const files = [new File(['x'], 'a.mp3')];
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    drop.dataTransfer = { types: ['Files'], files };
    panel.el.dispatchEvent(drop);
    expect(on.upload).toHaveBeenCalledWith(files);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('清單裡拖曳排序放開時不當成上傳', () => {
    const { panel, on } = setup();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    drop.dataTransfer = { types: ['text/x-mp-track'], files: [] };
    panel.el.dispatchEvent(drop);
    expect(on.upload).not.toHaveBeenCalled();
  });

  it('show / hide 切換顯示', () => {
    const { panel } = setup();
    expect(panel.visible).toBe(false);
    panel.show();
    expect(panel.visible).toBe(true);
    panel.hide();
    expect(panel.visible).toBe(false);
  });
});
