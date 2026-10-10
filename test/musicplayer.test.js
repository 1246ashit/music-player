import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMusicPlayer, MUSIC_MSG } from '../src/music/player.js';
import { DEFAULTS } from '../src/settings.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n一句\n\n00:00:05.000 --> 00:00:06.000\n二句';

const track = (id, albumId = null, order = id) => ({ id, audioName: `${id}.wav`, albumId, order });

/**
 * 假的音樂庫：行為像 service.js。預設兩首未分類的歌。
 * 專輯 10 裡有 3、4 兩首時，用 withAlbum()。
 */
function fakeBackend({ tracks = [track(1), track(2)], albums = [], subtitles = { 1: VTT } } = {}) {
  let lib = { tracks, albums };
  const listeners = {};
  const state = { trackId: null, paused: true, time: 0, duration: 100 };
  const snap = () => ({ ...state });
  const calls = [];
  const setLib = (next) => { lib = next; return lib; };
  const handlers = {
    list: () => lib,
    volume: ({ value }) => value,
    load: ({ id }) => { Object.assign(state, { trackId: id, paused: true, time: 0 }); return snap(); },
    subtitle: ({ id }) => subtitles[id] || null,
    play: () => { state.paused = false; return snap(); },
    pause: () => { state.paused = true; return snap(); },
    seek: ({ time }) => { state.time = time; return snap(); },
    remove: ({ id }) => setLib({ ...lib, tracks: lib.tracks.filter((t) => t.id !== id) }),
    add: () => ({ added: 0, attached: [], duplicates: [], orphans: [], ignored: [], library: lib }),
    createAlbum: ({ name }) => {
      const album = { id: 99, name, cover: null, createdAt: 99 };
      return { album, library: setLib({ ...lib, albums: [...lib.albums, album] }) };
    },
    removeAlbum: ({ id }) => setLib({
      tracks: lib.tracks.map((t) => (t.albumId === id ? { ...t, albumId: null } : t)),
      albums: lib.albums.filter((a) => a.id !== id),
    }),
    moveTracks: ({ ids, albumId }) => setLib({
      ...lib, tracks: lib.tracks.map((t) => (ids.includes(t.id) ? { ...t, albumId } : t)),
    }),
    reorder: ({ ids }) => setLib({
      ...lib, tracks: lib.tracks.map((t) => (ids.includes(t.id) ? { ...t, order: ids.indexOf(t.id) } : t)),
    }),
    renameAlbum: ({ id, name }) => setLib({ ...lib, albums: lib.albums.map((a) => (a.id === id ? { ...a, name } : a)) }),
    setAlbumCover: () => lib,
  };
  return {
    calls,
    state,
    handlers,
    request: vi.fn(async (op, args = {}) => {
      calls.push([op, args]);
      return handlers[op](args);
    }),
    on: (event, cb) => { (listeners[event] = listeners[event] || []).push(cb); return () => {}; },
    emit: (event, data) => (listeners[event] || []).forEach((cb) => cb(data)),
  };
}

const withAlbum = () => fakeBackend({
  tracks: [track(1), track(2), track(3, 10, 1), track(4, 10, 0)],
  albums: [{ id: 10, name: 'A', cover: null, createdAt: 1 }],
});

/** random 固定回 0：洗牌結果可預期（Fisher–Yates 每次都跟第 0 格交換）。 */
function setup({ backend = fakeBackend(), settings: s = {}, random = () => 0 } = {}) {
  const settings = { ...DEFAULTS, ...s };
  const updateSettings = vi.fn((patch) => Object.assign(settings, patch));
  const onChange = vi.fn();
  const onCue = vi.fn();
  const onError = vi.fn();
  const player = createMusicPlayer({ backend, settings, updateSettings, onChange, onCue, onError, random });
  return { player, backend, settings, updateSettings, onChange, onCue, onError };
}

const last = (fn) => fn.mock.calls.at(-1)[0];
const ops = (backend) => backend.calls.map((c) => c[0]);
const loaded = (backend) => backend.calls.filter((c) => c[0] === 'load').map((c) => c[1].id);

describe('init', () => {
  it('套用音量、拿到音樂庫並通知 UI', async () => {
    const { player, backend, onChange } = setup({ settings: { musicVolume: 0.4 } });
    await player.init();
    expect(backend.request).toHaveBeenCalledWith('volume', { value: 0.4 });
    expect(last(onChange).tracks).toHaveLength(2);
    expect(last(onChange).albums).toEqual([]);
    expect(last(onChange).currentId).toBeNull();
  });

  it('選回上次播的那首，但不自動播放', async () => {
    const { player, backend, onChange } = setup({ settings: { musicTrackId: 2 } });
    await player.init();
    expect(last(onChange).currentId).toBe(2);
    expect(ops(backend)).not.toContain('play');
  });

  it('上次那首已被刪掉就不選', async () => {
    const { player, backend } = setup({ settings: { musicTrackId: 99 } });
    await player.init();
    expect(ops(backend)).not.toContain('load');
  });

  it('記住的播放範圍（專輯）已不存在時退回全部', async () => {
    const { player, settings } = setup({ settings: { musicScope: 77 } });
    await player.init();
    expect(settings.musicScope).toBe('all');
  });
});

describe('播放控制', () => {
  it('還沒選歌時按播放，從目前範圍的第一首開始', async () => {
    const { player, onChange, updateSettings } = setup();
    await player.init();
    await player.toggle();
    expect(last(onChange)).toMatchObject({ currentId: 1, paused: false });
    expect(updateSettings).toHaveBeenCalledWith({ musicTrackId: 1 });
  });

  it('播放中再按一次是暫停', async () => {
    const { player, onChange } = setup();
    await player.init();
    await player.toggle();
    await player.toggle();
    expect(last(onChange).paused).toBe(true);
  });

  it('下一首到底會繞回第一首', async () => {
    const { player, onChange } = setup();
    await player.init();
    await player.play(2);
    await player.next();
    expect(last(onChange).currentId).toBe(1);
  });

  it('播超過 3 秒時「上一首」是回到開頭', async () => {
    const { player, backend, onChange } = setup();
    await player.init();
    await player.play(2);
    await player.seek(10);
    await player.prev();
    expect(last(onChange).currentId).toBe(2);
    expect(backend.state.time).toBe(0);
  });

  it('剛開始播時「上一首」才是真的換到上一首', async () => {
    const { player, onChange } = setup();
    await player.init();
    await player.play(2);
    await player.prev();
    expect(last(onChange).currentId).toBe(1);
  });

  it('瀏覽器擋下播放時提示再按一次', async () => {
    const backend = fakeBackend();
    backend.handlers.play = () => { const e = new Error('blocked'); e.name = 'NotAllowedError'; throw e; };
    const { player, onError } = setup({ backend });
    await player.init();
    await player.play(1);
    expect(onError).toHaveBeenCalledWith(MUSIC_MSG.blocked);
  });

  it('調音量會記住並送到音樂庫', async () => {
    const { player, backend, settings } = setup();
    await player.init();
    await player.setVolume(0.25);
    expect(settings.musicVolume).toBe(0.25);
    expect(backend.request).toHaveBeenLastCalledWith('volume', { value: 0.25 });
  });
});

describe('播放範圍與順序', () => {
  it('專輯裡依排好的順序播，不是加入順序', async () => {
    const { player, backend } = setup({ backend: withAlbum() });
    await player.init();
    await player.playScope(10);
    await player.next();
    await player.next();
    expect(loaded(backend)).toEqual([4, 3, 4]);
  });

  it('從專輯裡點的歌，下一首只在那張專輯裡', async () => {
    const { player, backend, settings } = setup({ backend: withAlbum() });
    await player.init();
    await player.play(3, 10);
    expect(settings.musicScope).toBe(10);
    await player.next();
    expect(loaded(backend).at(-1)).toBe(4);
  });

  it('全部：依專輯分組，專輯的歌先、未分類最後', async () => {
    const { player, backend } = setup({ backend: withAlbum() });
    await player.init();
    await player.playScope('all');
    for (let i = 0; i < 3; i++) await player.next();
    expect(loaded(backend)).toEqual([4, 3, 1, 2]);
  });

  it('未分類只播沒有專輯的歌', async () => {
    const { player, backend } = setup({ backend: withAlbum() });
    await player.init();
    await player.playScope('unsorted');
    await player.next();
    await player.next();
    expect(loaded(backend)).toEqual([1, 2, 1]);
  });

  it('空的範圍提示沒有歌', async () => {
    const backend = fakeBackend({ tracks: [], albums: [{ id: 5, name: 'E', createdAt: 1 }] });
    const { player, onError } = setup({ backend });
    await player.init();
    await player.playScope(5);
    expect(onError).toHaveBeenCalledWith(MUSIC_MSG.empty);
  });

  it('依序播放會關掉隨機', async () => {
    const { player, settings } = setup({ settings: { musicShuffle: true } });
    await player.init();
    await player.playScope('all');
    expect(settings.musicShuffle).toBe(false);
  });
});

describe('隨機播放', () => {
  const many = () => fakeBackend({ tracks: [1, 2, 3, 4, 5].map((n) => track(n)) });

  it('一輪裡每首都播到一次、不重複', async () => {
    const { player, backend } = setup({ backend: many(), random: Math.random });
    await player.init();
    await player.playScope('all', { shuffle: true });
    for (let i = 0; i < 4; i++) await player.next();
    expect([...loaded(backend)].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('範圍可以只限一張專輯', async () => {
    const { player, backend } = setup({ backend: withAlbum(), random: Math.random });
    await player.init();
    await player.playScope(10, { shuffle: true });
    for (let i = 0; i < 5; i++) await player.next();
    expect(loaded(backend).every((id) => id === 3 || id === 4)).toBe(true);
  });

  it('上一首回到剛剛抽到的那首', async () => {
    const { player, backend } = setup({ backend: many(), random: Math.random });
    await player.init();
    await player.playScope('all', { shuffle: true });
    await player.next();
    const [first, second] = loaded(backend);
    await player.prev();
    expect(loaded(backend).at(-1)).toBe(first);
    expect(second).not.toBe(first);
  });

  it('播放中打開隨機，從正在播的這首往後洗', async () => {
    const { player, backend, settings } = setup({ backend: many(), random: Math.random });
    await player.init();
    await player.play(3);
    player.toggleShuffle();
    expect(settings.musicShuffle).toBe(true);
    for (let i = 0; i < 4; i++) await player.next();
    expect([...loaded(backend)].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('隨機時播完一首接著抽下一首', async () => {
    const { player, backend } = setup({ backend: many(), random: Math.random });
    await player.init();
    await player.playScope('all', { shuffle: true });
    backend.emit('ended', {});
    await vi.waitFor(() => expect(loaded(backend)).toHaveLength(2));
    expect(new Set(loaded(backend)).size).toBe(2);
  });
});

describe('播完', () => {
  it('循環：接下一首', async () => {
    const { player, backend, onChange } = setup();
    await player.init();
    await player.play(1);
    backend.emit('ended', { trackId: 1 });
    await vi.waitFor(() => expect(last(onChange)).toMatchObject({ currentId: 2, paused: false }));
  });

  it('單曲循環：從頭再播同一首', async () => {
    const { player, backend, onChange } = setup({ settings: { musicRepeat: 'one' } });
    await player.init();
    await player.play(1);
    await player.seek(99);
    backend.emit('ended', { trackId: 1 });
    await vi.waitFor(() => expect(backend.state.time).toBe(0));
    expect(last(onChange)).toMatchObject({ currentId: 1, paused: false });
  });

  it('cycleRepeat 在兩種模式間切換', async () => {
    const { player, settings } = setup();
    player.cycleRepeat();
    expect(settings.musicRepeat).toBe('one');
    player.cycleRepeat();
    expect(settings.musicRepeat).toBe('all');
  });
});

describe('專輯整理', () => {
  it('建立專輯後回傳新專輯，音樂庫跟著更新', async () => {
    const { player, backend, onChange } = setup();
    await player.init();
    const album = await player.createAlbum('新的');
    expect(backend.request).toHaveBeenCalledWith('createAlbum', { name: '新的' });
    expect(album.id).toBe(99);
    expect(last(onChange).albums.map((a) => a.name)).toEqual(['新的']);
  });

  it('上傳時帶著要放進的專輯', async () => {
    const { player, backend } = setup({ backend: withAlbum() });
    await player.init();
    const files = [new File(['x'], 'z.wav')];
    await player.upload(files, 10);
    expect(backend.request).toHaveBeenCalledWith('add', { files, albumId: 10 });
  });

  it('移動、排序、改名、換封面都送到音樂庫並更新清單', async () => {
    const { player, backend, onChange } = setup({ backend: withAlbum() });
    await player.init();
    await player.moveTracks([1], 10);
    expect(last(onChange).tracks.find((t) => t.id === 1).albumId).toBe(10);
    await player.reorder([3, 4]);
    expect(backend.request).toHaveBeenCalledWith('reorder', { ids: [3, 4] });
    await player.renameAlbum(10, 'B');
    expect(last(onChange).albums[0].name).toBe('B');
    const img = new File(['x'], 'c.png', { type: 'image/png' });
    await player.setAlbumCover(10, img);
    expect(backend.request).toHaveBeenCalledWith('setAlbumCover', { id: 10, file: img });
  });

  it('刪掉正在播的專輯時，播放範圍退回全部', async () => {
    const { player, settings } = setup({ backend: withAlbum() });
    await player.init();
    await player.playScope(10);
    await player.removeAlbum(10);
    expect(settings.musicScope).toBe('all');
  });

  it('排序後依新順序播', async () => {
    const { player, backend } = setup({ backend: withAlbum() });
    await player.init();
    await player.reorder([3, 4]);
    await player.playScope(10);
    await player.next();
    expect(loaded(backend)).toEqual([3, 4]);
  });
});

describe('字幕', () => {
  it('依播放時間顯示對應的台詞', async () => {
    const { player, backend, onCue } = setup();
    await player.init();
    await player.play(1);
    backend.emit('state', { trackId: 1, paused: false, time: 1.5, duration: 100 });
    expect(last(onCue)).toBe('一句');
    backend.emit('state', { trackId: 1, paused: false, time: 3, duration: 100 });
    expect(last(onCue)).toBe('');
  });

  it('兩次狀態更新之間也會依經過的時間推進', async () => {
    const { player, backend, onCue } = setup();
    await player.init();
    await player.play(1);
    backend.emit('state', { trackId: 1, paused: false, time: 4.5, duration: 100 });
    expect(player.cue).toBe('');
    vi.advanceTimersByTime(700);
    expect(last(onCue)).toBe('二句');
  });

  it('暫停時不推進', async () => {
    const { player, backend } = setup();
    await player.init();
    await player.play(1);
    backend.emit('state', { trackId: 1, paused: true, time: 4.5, duration: 100 });
    vi.advanceTimersByTime(2000);
    expect(player.cue).toBe('');
  });

  it('沒有字幕的曲目不顯示任何台詞', async () => {
    const { player, backend, onChange } = setup();
    await player.init();
    await player.play(2);
    backend.emit('state', { trackId: 2, paused: false, time: 1.5, duration: 100 });
    expect(player.cue).toBe('');
    expect(last(onChange).hasSubtitle).toBe(false);
  });

  it('關掉字幕時清空，打開又出現', async () => {
    const { player, backend, onCue } = setup();
    await player.init();
    await player.play(1);
    backend.emit('state', { trackId: 1, paused: true, time: 1.5, duration: 100 });
    player.toggleCaptions();
    expect(last(onCue)).toBe('');
    player.toggleCaptions();
    expect(last(onCue)).toBe('一句');
  });

  it('上傳補上目前這首的字幕時馬上生效', async () => {
    const backend = fakeBackend({ subtitles: {} });
    const { player, onCue } = setup({ backend });
    await player.init();
    await player.play(1);
    backend.emit('state', { trackId: 1, paused: true, time: 1.5, duration: 100 });
    expect(player.cue).toBe('');

    backend.handlers.subtitle = () => VTT;
    backend.handlers.add = () => ({
      added: 0, attached: [1], duplicates: [], orphans: [], ignored: [], library: backend.handlers.list(),
    });
    await player.upload([]);
    expect(last(onCue)).toBe('一句');
  });
});

describe('刪除與結束', () => {
  it('刪掉正在播的曲目時清掉目前曲目與記住的 id', async () => {
    const { player, onChange, settings } = setup();
    await player.init();
    await player.play(1);
    await player.remove(1);
    expect(last(onChange)).toMatchObject({ currentId: null, paused: true });
    expect(last(onChange).tracks.map((t) => t.id)).toEqual([2]);
    expect(settings.musicTrackId).toBeNull();
  });

  it('dispose 之後清掉字幕、不再通知 UI', async () => {
    const { player, backend, onChange, onCue } = setup();
    await player.init();
    await player.play(1);
    backend.emit('state', { trackId: 1, paused: false, time: 1.5, duration: 100 });
    player.dispose();
    expect(last(onCue)).toBe('');
    const n = onChange.mock.calls.length;
    backend.emit('state', { trackId: 1, paused: false, time: 5, duration: 100 });
    vi.advanceTimersByTime(1000);
    expect(onChange.mock.calls.length).toBe(n);
  });
});
