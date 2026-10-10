import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLibraryView, coverEl } from '../src/ui/musiclibrary.js';

beforeEach(() => { document.body.innerHTML = ''; });

const HANDLERS = ['setView', 'play', 'playView', 'createAlbum', 'renameAlbum', 'setCover', 'removeAlbum', 'move', 'reorder', 'remove'];

function setup({ confirm = () => true } = {}) {
  const on = Object.fromEntries(HANDLERS.map((k) => [k, vi.fn()]));
  const view = createLibraryView({ on, confirm });
  document.body.appendChild(view.el);
  const $ = (s) => view.el.querySelector(s);
  const $$ = (s) => [...view.el.querySelectorAll(s)];
  return { view, on, $, $$ };
}

const A = { id: 10, name: '睡前', cover: 'data:image/webp;base64,AAA', createdAt: 1 };
const B = { id: 20, name: '雨', cover: null, createdAt: 2 };
const T = (id, albumId, order, extra = {}) => ({
  id, audioName: `${id}.wav`, size: 1024, subtitleName: null, albumId, order, ...extra,
});
const TRACKS = [
  T(1, 10, 1, { audioName: '01_おやすみ.wav', subtitleName: '01_おやすみ.wav.vtt' }),
  T(2, 10, 0),
  T(3, null, 0, { audioName: 'rain.mp3' }),
];

const state = (over = {}) => ({
  tracks: TRACKS, albums: [A, B], currentId: null, paused: true, scope: 'all', view: 'all', ...over,
});

const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const ids = ($$) => $$('.mp-music-track').map((li) => Number(li.dataset.id));
const tileScopes = ($$) => $$('.mp-lib-tile[data-scope]').map((t) => t.dataset.scope);

function dragEvent(type, { clientY = 0 } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = { setData: vi.fn(), types: ['text/x-mp-track'] };
  e.clientY = clientY;
  return e;
}

describe('專輯列', () => {
  it('全部、各專輯（照建立順序）、有未分類的歌時才列未分類，最後是新專輯', () => {
    const { view, $$ } = setup();
    view.render(state());
    expect(tileScopes($$)).toEqual(['all', '10', '20', 'unsorted']);
    expect($$('.mp-lib-new')).toHaveLength(1);
  });

  it('還沒有專輯時不列未分類（跟全部一樣）', () => {
    const { view, $$ } = setup();
    view.render(state({ albums: [], tracks: [T(3, null, 0)] }));
    expect(tileScopes($$)).toEqual(['all']);
  });

  it('有封面顯示封面，沒封面用名稱第一個字', () => {
    const { view, $ } = setup();
    view.render(state());
    expect($('[data-scope="10"] img').src).toBe(A.cover);
    expect($('[data-scope="20"] .mp-cover').textContent).toBe('雨');
  });

  it('點專輯切換正在看的範圍，並標示目前範圍與正在播的範圍', () => {
    const { view, on, $ } = setup();
    view.render(state({ view: 10, scope: 20, paused: false }));
    expect($('[data-scope="10"]').classList.contains('active')).toBe(true);
    expect($('[data-scope="20"]').classList.contains('playing')).toBe(true);
    click($('[data-scope="all"]'));
    expect(on.setView).toHaveBeenCalledWith('all');
  });

  it('專輯名稱當純文字顯示', () => {
    const { view, $ } = setup();
    view.render(state({ albums: [{ id: 1, name: '<img src=x onerror=alert(1)>', cover: null, createdAt: 1 }] }));
    expect($('.mp-lib-strip img')).toBeNull();
    expect($('[data-scope="1"] .mp-lib-tile-name').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('清單', () => {
  it('全部：依專輯分組並加上組名，未分類放最後', () => {
    const { view, $$ } = setup();
    view.render(state());
    expect($$('.mp-lib-group').map((g) => g.textContent)).toEqual(['睡前', '未分類']);
    expect(ids($$)).toEqual([2, 1, 3]);
  });

  it('專輯：照排好的順序編號，字幕名顯示成 xxx.vtt', () => {
    const { view, $$ } = setup();
    view.render(state({ view: 10 }));
    expect(ids($$)).toEqual([2, 1]);
    const first = $$('.mp-music-track')[1];
    expect(first.querySelector('.mp-music-no').textContent).toBe('2');
    expect(first.querySelector('.mp-music-name').textContent).toBe('01_おやすみ');
    expect(first.querySelector('.mp-music-sub').textContent).toBe('字幕 01_おやすみ.vtt');
  });

  it('點歌播放，標示正在播的那首', () => {
    const { view, on, $$ } = setup();
    view.render(state({ view: 10, currentId: 1 }));
    click($$('.mp-music-pick')[0]);
    expect(on.play).toHaveBeenCalledWith(2);
    expect($$('.mp-music-track.current').map((li) => li.dataset.id)).toEqual(['1']);
  });

  it('刪除要先確認', () => {
    const confirm = vi.fn(() => false);
    const { view, on, $$ } = setup({ confirm });
    view.render(state());
    click($$('.mp-music-del')[0]);
    expect(confirm).toHaveBeenCalled();
    expect(on.remove).not.toHaveBeenCalled();
  });

  it('📁 選單列出其他專輯與未分類，選了就移過去', () => {
    const { view, on, $$ } = setup();
    view.render(state({ view: 10 }));
    const sel = $$('.mp-music-move')[0];
    expect([...sel.options].map((o) => o.textContent)).toEqual(['📁', '雨', '未分類']);
    sel.value = '20';
    sel.dispatchEvent(new Event('change'));
    expect(on.move).toHaveBeenCalledWith([2], 20);
    expect(sel.value).toBe('');
    sel.value = 'none';
    sel.dispatchEvent(new Event('change'));
    expect(on.move).toHaveBeenLastCalledWith([2], null);
  });

  it('沒有專輯時不顯示 📁', () => {
    const { view, $$ } = setup();
    view.render(state({ albums: [] }));
    expect($$('.mp-music-move')).toHaveLength(0);
  });

  it('內容沒變時不重建（時間更新不會把滑鼠停留弄掉）', () => {
    const { view, $ } = setup();
    const s = state();
    view.render(s);
    const first = $('.mp-music-track');
    view.render({ ...s, time: 5, currentId: 1 });
    expect($('.mp-music-track')).toBe(first);
  });

  it('空的專輯顯示怎麼放歌進來', () => {
    const { view, $ } = setup();
    view.render(state({ view: 20 }));
    expect($('.mp-music-empty').hidden).toBe(false);
    expect($('.mp-music-empty').textContent).toContain('拖到');
  });
});

describe('拖曳', () => {
  function rect(li, top) {
    li.getBoundingClientRect = () => ({ top, height: 40, bottom: top + 40, left: 0, right: 100, width: 100 });
  }

  it('在專輯裡把歌拖到另一首的下半部，排到它後面', () => {
    const { view, on, $$ } = setup();
    view.render(state({ tracks: [...TRACKS, T(4, 10, 2)], view: 10 }));
    const rows = $$('.mp-music-track');     // 順序：2, 1, 4
    rows.forEach((li, i) => rect(li, i * 40));
    rows[0].dispatchEvent(dragEvent('dragstart'));
    const over = dragEvent('dragover', { clientY: 110 });
    rows[2].dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(rows[2].classList.contains('drop-after')).toBe(true);
    rows[2].dispatchEvent(dragEvent('drop', { clientY: 110 }));
    expect(on.reorder).toHaveBeenCalledWith([1, 4, 2]);
  });

  it('拖到上半部就排到前面', () => {
    const { view, on, $$ } = setup();
    view.render(state({ view: 10 }));
    const rows = $$('.mp-music-track');     // 2, 1
    rows.forEach((li, i) => rect(li, i * 40));
    rows[1].dispatchEvent(dragEvent('dragstart'));
    rows[0].dispatchEvent(dragEvent('drop', { clientY: 5 }));
    expect(on.reorder).toHaveBeenCalledWith([1, 2]);
  });

  it('全部畫面不能排序', () => {
    const { view, on, $$ } = setup();
    view.render(state());
    const rows = $$('.mp-music-track');
    rows[0].dispatchEvent(dragEvent('dragstart'));
    const over = dragEvent('dragover');
    rows[1].dispatchEvent(over);
    rows[1].dispatchEvent(dragEvent('drop'));
    expect(over.defaultPrevented).toBe(false);
    expect(on.reorder).not.toHaveBeenCalled();
  });

  it('把歌拖到專輯封面上就移進那張專輯（全部畫面也可以）', () => {
    const { view, on, $, $$ } = setup();
    view.render(state());
    const row = $$('.mp-music-track').find((li) => li.dataset.id === '3');
    row.dispatchEvent(dragEvent('dragstart'));
    const tile = $('[data-scope="20"]');
    const over = dragEvent('dragover');
    tile.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    tile.dispatchEvent(dragEvent('drop'));
    expect(on.move).toHaveBeenCalledWith([3], 20);
  });

  it('拖到未分類就移出專輯；拖到全部不做事', () => {
    const { view, on, $, $$ } = setup();
    view.render(state());
    $$('.mp-music-track')[0].dispatchEvent(dragEvent('dragstart'));
    $('[data-scope="unsorted"]').dispatchEvent(dragEvent('drop'));
    expect(on.move).toHaveBeenCalledWith([2], null);
    on.move.mockClear();
    $('[data-scope="all"]').dispatchEvent(dragEvent('drop'));
    expect(on.move).not.toHaveBeenCalled();
  });

  it('不是從清單拖出來的東西，專輯封面不接', () => {
    const { view, on, $ } = setup();
    view.render(state());
    const over = dragEvent('dragover');
    $('[data-scope="20"]').dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    $('[data-scope="20"]').dispatchEvent(dragEvent('drop'));
    expect(on.move).not.toHaveBeenCalled();
  });
});

describe('標頭', () => {
  it('全部：顯示首數與專輯數，可依序或隨機播放', () => {
    const { view, on, $ } = setup();
    view.render(state());
    expect($('.mp-lib-title').textContent).toBe('全部');
    expect($('.mp-lib-sub').textContent).toBe('3 首 · 2 張專輯');
    click($('.mp-lib-play'));
    click($('.mp-lib-shuffle'));
    expect(on.playView.mock.calls).toEqual([[{ shuffle: false }], [{ shuffle: true }]]);
    expect($('.mp-lib-rename')).toBeNull();
  });

  it('專輯：顯示封面、名稱與改名／封面／刪除', () => {
    const { view, $ } = setup();
    view.render(state({ view: 10 }));
    expect($('.mp-lib-head img').src).toBe(A.cover);
    expect($('.mp-lib-title').textContent).toBe('睡前');
    expect($('.mp-lib-sub').textContent).toBe('2 首');
    expect($('.mp-lib-rename')).not.toBeNull();
    expect($('.mp-lib-setcover')).not.toBeNull();
  });

  it('改名：按 ✎ 出現輸入框，Enter 儲存', () => {
    const { view, on, $ } = setup();
    view.render(state({ view: 10 }));
    click($('.mp-lib-rename'));
    const input = $('.mp-lib-edit input');
    expect(input.value).toBe('睡前');
    input.value = '  午睡  ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(on.renameAlbum).toHaveBeenCalledWith(10, '午睡');
    expect($('.mp-lib-edit')).toBeNull();
  });

  it('改名：Esc 或取消就放棄，空白名稱不送出', () => {
    const { view, on, $ } = setup();
    view.render(state({ view: 10 }));
    click($('.mp-lib-rename'));
    $('.mp-lib-edit input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('.mp-lib-edit')).toBeNull();
    click($('.mp-lib-rename'));
    const input = $('.mp-lib-edit input');
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    click($('.mp-lib-ok'));
    expect(on.renameAlbum).not.toHaveBeenCalled();
  });

  it('新專輯：點＋輸入名稱後建立', () => {
    const { view, on, $ } = setup();
    view.render(state());
    click($('.mp-lib-new'));
    const input = $('.mp-lib-edit input');
    expect(document.activeElement).toBe(input);
    input.value = '新的';
    input.dispatchEvent(new Event('input'));
    click($('.mp-lib-ok'));
    expect(on.createAlbum).toHaveBeenCalledWith('新的');
  });

  it('換封面：選圖片後交出檔案', () => {
    const { view, on, $ } = setup();
    view.render(state({ view: 20 }));
    const input = view.el.querySelector('input[type="file"]');
    expect(input.accept).toBe('image/*');
    const img = new File(['x'], 'c.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [img], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(on.setCover).toHaveBeenCalledWith(20, img);
  });

  it('刪除專輯要先確認', () => {
    const confirm = vi.fn(() => true);
    const { view, on, $ } = setup({ confirm });
    view.render(state({ view: 20 }));
    click($('.mp-lib-delalbum'));
    expect(confirm.mock.calls[0][0]).toContain('不會刪');
    expect(on.removeAlbum).toHaveBeenCalledWith(20);
  });

  it('切到別的專輯時放棄進行中的改名', () => {
    const { view, $ } = setup();
    view.render(state({ view: 10 }));
    click($('.mp-lib-rename'));
    view.render(state({ view: 20 }));
    expect($('.mp-lib-edit')).toBeNull();
  });
});

describe('coverEl', () => {
  it('同一個名稱永遠配到同一個顏色', () => {
    const a = coverEl({ name: '雨', cover: null });
    const b = coverEl({ name: '雨', cover: null });
    expect(a.style.background).toBe(b.style.background);
    expect(coverEl(null).textContent).toBe('♪');
  });
});
