import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMusicBox } from '../src/ui/musicbox.js';
import { DEFAULTS } from '../src/settings.js';

beforeEach(() => { document.body.innerHTML = ''; });

const tick = () => new Promise((r) => setTimeout(r, 0));

const snap = (over = {}) => ({
  tracks: [], albums: [], currentId: null, paused: true, time: 0, duration: 0,
  volume: 1, repeat: 'all', captions: true, shuffle: false, scope: 'all', ...over,
});

/** 假的播放控制：記錄被呼叫的方法，並能模擬狀態與字幕更新。 */
function fakePlayerFactory() {
  const made = [];
  const factory = (deps) => {
    const p = {
      deps,
      init: vi.fn(async () => {}),
      toggle: vi.fn(async () => {}),
      play: vi.fn(async () => {}),
      playScope: vi.fn(async () => {}),
      // 跟真的一樣：先通知畫面有新專輯，再回傳
      createAlbum: vi.fn(async (name) => {
        const album = { id: 42, name, cover: null, createdAt: 9 };
        deps.onChange(snap({ albums: [album] }));
        return album;
      }),
      removeAlbum: vi.fn(async () => {}),
      upload: vi.fn(async () => ({ added: 1, attached: [], duplicates: [], orphans: [], ignored: [] })),
      dispose: vi.fn(),
    };
    made.push(p);
    return p;
  };
  factory.latest = () => made[made.length - 1];
  factory.count = () => made.length;
  return factory;
}

function setup({ connect, settings = {} } = {}) {
  const conn = { client: {}, destroy: vi.fn() };
  const deps = {
    connect: connect || vi.fn(async () => conn),
    settings: { ...DEFAULTS, ...settings },
    updateSettings: vi.fn(function (patch) { Object.assign(deps.settings, patch); }),
    onStatus: vi.fn(),
    toast: vi.fn(),
    createPlayer: fakePlayerFactory(),
  };
  const box = createMusicBox(deps);
  return { box, deps, conn };
}

describe('連線', () => {
  it('建立時只掛上隱藏的面板，第一次打開才連音樂庫', async () => {
    const { box, deps } = setup();
    expect(document.querySelector('.mp-music-layer')).not.toBeNull();
    expect(document.querySelector('.mp-music').hidden).toBe(true);
    expect(deps.connect).not.toHaveBeenCalled();

    box.toggle();
    await tick();
    expect(deps.connect).toHaveBeenCalledWith(document.querySelector('.mp-music-layer'));
    expect(deps.createPlayer.latest().init).toHaveBeenCalled();
  });

  it('重複打開不會重複連線', async () => {
    const { box, deps } = setup();
    box.toggle(true);
    box.toggle(false);
    box.toggle(true);
    await tick();
    expect(deps.connect).toHaveBeenCalledTimes(1);
    expect(deps.createPlayer.count()).toBe(1);
  });

  it('連不上時提示，下次打開再試一次', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error('逾時')).mockResolvedValue({ client: {}, destroy: vi.fn() });
    const { box, deps } = setup({ connect });
    box.toggle(true);
    await tick();
    expect(deps.toast).toHaveBeenCalled();
    expect(document.querySelector('.mp-music-status').textContent).toContain('逾時');

    box.toggle(false);
    box.toggle(true);
    await tick();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('擴充功能被重新載入過時，直接提示重新整理頁面', async () => {
    const err = Object.assign(new Error('擴充功能剛更新過，請重新整理這個頁面'), { name: 'ExtensionReloaded' });
    const { box, deps } = setup({ connect: vi.fn().mockRejectedValue(err) });
    box.toggle(true);
    await tick();
    expect(deps.toast).toHaveBeenCalledWith(err.message);
  });

  it('連線途中就被關掉時，連好也立刻收掉', async () => {
    let resolve;
    const conn = { client: {}, destroy: vi.fn() };
    const { box, deps } = setup({ connect: () => new Promise((r) => { resolve = r; }) });
    box.toggle(true);
    box.destroy();
    resolve(conn);
    await tick();
    expect(conn.destroy).toHaveBeenCalled();
    expect(deps.createPlayer.count()).toBe(0);
  });
});

describe('操作與狀態', () => {
  it('面板上的按鈕會先連線再交給播放控制', async () => {
    const { deps } = setup();
    document.querySelector('[data-a="toggle"]').click();
    await tick();
    expect(deps.createPlayer.latest().toggle).toHaveBeenCalled();
  });

  it('togglePlay（M 鍵）不用打開面板也能播', async () => {
    const { box, deps } = setup();
    await box.togglePlay();
    expect(deps.createPlayer.latest().toggle).toHaveBeenCalled();
    expect(box.visible).toBe(false);
  });

  it('上傳後在面板顯示結果摘要', async () => {
    const { box } = setup();
    box.toggle(true);
    await tick();
    const input = document.querySelector('.mp-music-upload input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.wav')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await tick();
    expect(document.querySelector('.mp-music-status').textContent).toBe('新增 1 首');
  });

  it('播放控制出錯時提示，不會讓例外漏出去', async () => {
    const { box, deps } = setup();
    box.toggle(true);
    await tick();
    deps.createPlayer.latest().toggle.mockRejectedValueOnce(new Error('壞了'));
    await box.togglePlay();
    expect(deps.toast).toHaveBeenCalledWith(expect.stringContaining('壞了'));
  });

  it('播放狀態變化時回報給工具列', async () => {
    const { box, deps } = setup();
    box.toggle(true);
    await tick();
    expect(deps.onStatus).toHaveBeenLastCalledWith({ visible: true, playing: false });
    deps.createPlayer.latest().deps.onChange(snap({ paused: false }));
    expect(deps.onStatus).toHaveBeenLastCalledWith({ visible: true, playing: true });
    expect(box.playing).toBe(true);
  });

  it('字幕顯示在畫面上，沒字幕時藏起來', async () => {
    const { box, deps } = setup();
    box.toggle(true);
    await tick();
    const caption = document.querySelector('.mp-music-caption');
    deps.createPlayer.latest().deps.onCue('おはよう');
    expect(caption.textContent).toBe('おはよう');
    expect(caption.hidden).toBe(false);
    deps.createPlayer.latest().deps.onCue('');
    expect(caption.hidden).toBe(true);
  });
});

describe('destroy', () => {
  it('收掉播放控制、連線與整層 DOM', async () => {
    const { box, deps, conn } = setup();
    box.toggle(true);
    await tick();
    box.destroy();
    expect(deps.createPlayer.latest().dispose).toHaveBeenCalled();
    expect(conn.destroy).toHaveBeenCalled();
    expect(document.querySelector('.mp-music-layer')).toBeNull();
  });
});

describe('正在看的範圍', () => {
  const A = { id: 10, name: '睡前', cover: null, createdAt: 1 };

  async function connected(settings) {
    const ctx = setup({ settings });
    ctx.box.toggle(true);
    await tick();
    const player = ctx.deps.createPlayer.latest();
    return { ...ctx, player };
  }

  it('在專輯裡點歌，播放範圍就是那張專輯', async () => {
    const { player } = await connected({ musicView: 10 });
    player.deps.onChange(snap({ albums: [A], tracks: [{ id: 1, audioName: 'a.wav', size: 1, albumId: 10, order: 0 }] }));
    document.querySelector('.mp-music-pick').click();
    await tick();
    expect(player.play).toHaveBeenCalledWith(1, 10);
  });

  it('依序／隨機播放用正在看的範圍', async () => {
    const { player } = await connected({ musicView: 10 });
    player.deps.onChange(snap({ albums: [A] }));
    document.querySelector('.mp-lib-shuffle').click();
    await tick();
    expect(player.playScope).toHaveBeenCalledWith(10, { shuffle: true });
  });

  it('點專輯切換範圍並記住', async () => {
    const { player, deps } = await connected();
    player.deps.onChange(snap({ albums: [A] }));
    document.querySelector('[data-scope="10"]').click();
    expect(deps.settings.musicView).toBe(10);
    expect(document.querySelector('.mp-lib-title').textContent).toBe('睡前');
  });

  it('上傳時放進正在看的專輯', async () => {
    const { player } = await connected({ musicView: 10 });
    player.deps.onChange(snap({ albums: [A] }));
    const input = document.querySelector('.mp-music-upload input');
    const files = [new File(['x'], 'a.wav')];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await tick();
    expect(player.upload).toHaveBeenCalledWith(files, 10);
  });

  it('建立專輯後直接切過去', async () => {
    const { player, deps } = await connected();
    player.deps.onChange(snap());
    document.querySelector('.mp-lib-new').click();
    const input = document.querySelector('.mp-lib-edit input');
    input.value = '新的';
    input.dispatchEvent(new Event('input'));
    document.querySelector('.mp-lib-ok').click();
    await tick();
    expect(player.createAlbum).toHaveBeenCalledWith('新的');
    expect(deps.settings.musicView).toBe(42);
  });

  it('還沒連上音樂庫前不會忘記上次看的專輯', () => {
    const { deps } = setup({ settings: { musicView: 10 } });
    expect(deps.settings.musicView).toBe(10);
  });

  it('正在看的專輯不見了（被刪掉）就回到全部', async () => {
    const { player, deps } = await connected({ musicView: 10 });
    player.deps.onChange(snap({ albums: [A] }));
    player.deps.onChange(snap({ albums: [] }));
    expect(deps.settings.musicView).toBe('all');
    expect(document.querySelector('.mp-lib-title').textContent).toBe('全部');
  });
});
