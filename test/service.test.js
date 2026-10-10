import { describe, it, expect, vi } from 'vitest';
import { createLibraryService } from '../src/library/service.js';
import { createClient } from '../src/music/channel.js';
import { fakePorts } from './fakeports.js';

/** 記憶體裡的音樂庫。 */
function fakeStore() {
  let seq = 0;
  let albumSeq = 100;
  const tracks = [];
  const albums = [];
  const audio = new Map();
  const subs = new Map();
  return {
    tracks,
    albums,
    list: vi.fn(async () => tracks.map((t) => ({ ...t }))),
    listAlbums: vi.fn(async () => albums.map((a) => ({ ...a }))),
    add: vi.fn(async ({ audio: blob, audioName, subtitleName, subtitleText, albumId = null }) => {
      const meta = { id: ++seq, audioName, size: blob.size, subtitleName: subtitleText == null ? null : subtitleName, albumId };
      tracks.push(meta);
      audio.set(meta.id, blob);
      if (subtitleText != null) subs.set(meta.id, subtitleText);
      return meta;
    }),
    setSubtitle: vi.fn(async (id, name, text) => {
      tracks.find((t) => t.id === id).subtitleName = name;
      subs.set(id, text);
    }),
    getAudio: vi.fn(async (id) => audio.get(id) || null),
    getSubtitle: vi.fn(async (id) => (subs.has(id) ? subs.get(id) : null)),
    remove: vi.fn(async (id) => {
      tracks.splice(tracks.findIndex((t) => t.id === id), 1);
      audio.delete(id);
      subs.delete(id);
    }),
    moveTracks: vi.fn(async (ids, albumId) => { tracks.forEach((t) => { if (ids.includes(t.id)) t.albumId = albumId; }); }),
    reorder: vi.fn(async () => {}),
    createAlbum: vi.fn(async (name) => {
      const a = { id: ++albumSeq, name, cover: null, createdAt: albumSeq };
      albums.push(a);
      return { ...a };
    }),
    updateAlbum: vi.fn(async (id, patch) => { Object.assign(albums.find((a) => a.id === id), patch); }),
    removeAlbum: vi.fn(async (id) => {
      albums.splice(albums.findIndex((a) => a.id === id), 1);
      tracks.forEach((t) => { if (t.albumId === id) t.albumId = null; });
    }),
  };
}

/** 夠用的假 <audio>。 */
function fakeAudio() {
  const a = new EventTarget();
  Object.assign(a, {
    paused: true,
    currentTime: 0,
    duration: NaN,
    volume: 1,
    src: '',
    play: vi.fn(async () => { a.paused = false; }),
    pause: vi.fn(() => { a.paused = true; }),
    removeAttribute: vi.fn(() => { a.src = ''; }),
  });
  return a;
}

const file = (name, text = 'data') => new File([text], name);

function setup() {
  const store = fakeStore();
  const audio = fakeAudio();
  const urls = { createObjectURL: vi.fn(() => 'blob:x/' + Math.random()), revokeObjectURL: vi.fn() };
  const thumbnail = vi.fn(async () => 'data:image/webp;base64,AAA');
  const service = createLibraryService({ store, audio, urls, thumbnail });
  const { handlers: h } = service;
  return { store, audio, urls, thumbnail, service, h };
}

describe('add', () => {
  it('音檔與同名字幕配對存進音樂庫，字幕以文字保存', async () => {
    const { h, store } = setup();
    const r = await h.add({ files: [file('a.wav'), file('a.wav.vtt', 'WEBVTT')] });
    expect(r.added).toBe(1);
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({
      audioName: 'a.wav', subtitleName: 'a.wav.vtt', subtitleText: 'WEBVTT',
    }));
    expect(r.library.tracks).toHaveLength(1);
    expect(r.library.albums).toEqual([]);
  });

  it('只傳字幕時補到既有曲目，回報補了哪幾首', async () => {
    const { h, store } = setup();
    await h.add({ files: [file('a.wav')] });
    const r = await h.add({ files: [file('a.vtt', 'WEBVTT')] });
    expect(r.added).toBe(0);
    expect(r.attached).toEqual([1]);
    expect(store.setSubtitle).toHaveBeenCalledWith(1, 'a.vtt', 'WEBVTT');
  });

  it('回報重複、孤兒字幕與不支援的檔名', async () => {
    const { h } = setup();
    await h.add({ files: [file('a.wav')] });
    const r = await h.add({ files: [file('a.wav'), file('b.wav.vtt'), file('c.txt')] });
    expect(r.duplicates).toEqual(['a.wav']);
    expect(r.orphans).toEqual(['b.wav.vtt']);
    expect(r.ignored).toEqual(['c.txt']);
  });
});

describe('專輯', () => {
  it('list 一次給曲目與專輯', async () => {
    const { h } = setup();
    await h.createAlbum({ name: 'A' });
    const lib = await h.list();
    expect(lib.albums.map((a) => a.name)).toEqual(['A']);
    expect(lib.tracks).toEqual([]);
  });

  it('建立專輯時去掉前後空白，空白名稱不收', async () => {
    const { h } = setup();
    const { album, library } = await h.createAlbum({ name: '  睡前  ' });
    expect(album.name).toBe('睡前');
    expect(library.albums).toHaveLength(1);
    await expect(h.createAlbum({ name: '   ' })).rejects.toThrow('空白');
  });

  it('名稱太長會截斷', async () => {
    const { h } = setup();
    const { album } = await h.createAlbum({ name: 'x'.repeat(500) });
    expect(album.name).toHaveLength(80);
  });

  it('上傳到專輯時新歌直接放進去', async () => {
    const { h, store } = setup();
    const { album } = await h.createAlbum({ name: 'A' });
    await h.add({ files: [file('a.wav')], albumId: album.id });
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ albumId: album.id }));
  });

  it('上傳到不存在的專輯會失敗，不會存進去', async () => {
    const { h, store } = setup();
    await expect(h.add({ files: [file('a.wav')], albumId: 5 })).rejects.toThrow('專輯');
    expect(store.add).not.toHaveBeenCalled();
  });

  it('移動到專輯與移回未分類', async () => {
    const { h } = setup();
    const { album } = await h.createAlbum({ name: 'A' });
    await h.add({ files: [file('a.wav')] });
    let lib = await h.moveTracks({ ids: [1], albumId: album.id });
    expect(lib.tracks[0].albumId).toBe(album.id);
    lib = await h.moveTracks({ ids: [1], albumId: null });
    expect(lib.tracks[0].albumId).toBeNull();
    await expect(h.moveTracks({ ids: [1], albumId: 12345 })).rejects.toThrow('專輯');
  });

  it('排序交給 store 並回傳新的音樂庫', async () => {
    const { h, store } = setup();
    const lib = await h.reorder({ ids: [2, 1] });
    expect(store.reorder).toHaveBeenCalledWith([2, 1]);
    expect(lib).toHaveProperty('tracks');
  });

  it('改名', async () => {
    const { h } = setup();
    const { album } = await h.createAlbum({ name: 'A' });
    const lib = await h.renameAlbum({ id: album.id, name: ' B ' });
    expect(lib.albums[0].name).toBe('B');
    await expect(h.renameAlbum({ id: album.id, name: '' })).rejects.toThrow();
  });

  it('封面先縮成小圖再存；給 null 是拿掉封面', async () => {
    const { h, thumbnail } = setup();
    const { album } = await h.createAlbum({ name: 'A' });
    const img = new File(['x'], 'c.png', { type: 'image/png' });
    let lib = await h.setAlbumCover({ id: album.id, file: img });
    expect(thumbnail).toHaveBeenCalledWith(img);
    expect(lib.albums[0].cover).toBe('data:image/webp;base64,AAA');
    lib = await h.setAlbumCover({ id: album.id, file: null });
    expect(lib.albums[0].cover).toBeNull();
  });

  it('封面不是圖片就拒絕', async () => {
    const { h, thumbnail } = setup();
    const { album } = await h.createAlbum({ name: 'A' });
    await expect(h.setAlbumCover({ id: album.id, file: file('a.wav') })).rejects.toThrow('圖片');
    expect(thumbnail).not.toHaveBeenCalled();
  });

  it('刪除專輯後歌還在，回到未分類', async () => {
    const { h } = setup();
    const { album } = await h.createAlbum({ name: 'A' });
    await h.add({ files: [file('a.wav')], albumId: album.id });
    const lib = await h.removeAlbum({ id: album.id });
    expect(lib.albums).toEqual([]);
    expect(lib.tracks[0].albumId).toBeNull();
  });
});

describe('播放', () => {
  it('load 把音檔變成 blob 網址交給 <audio>', async () => {
    const { h, audio, urls } = setup();
    await h.add({ files: [file('a.wav')] });
    const s = await h.load({ id: 1 });
    expect(audio.src).toBe(urls.createObjectURL.mock.results[0].value);
    expect(s.trackId).toBe(1);
  });

  it('換歌時釋放上一首的 blob 網址', async () => {
    const { h, urls } = setup();
    await h.add({ files: [file('a.wav'), file('b.wav')] });
    await h.load({ id: 1 });
    const first = urls.createObjectURL.mock.results[0].value;
    await h.load({ id: 2 });
    expect(urls.revokeObjectURL).toHaveBeenCalledWith(first);
  });

  it('找不到音檔時 load 失敗', async () => {
    const { h } = setup();
    await expect(h.load({ id: 9 })).rejects.toThrow();
  });

  it('還沒選歌就 play 會失敗；選了之後 play 回報播放中', async () => {
    const { h } = setup();
    await expect(h.play()).rejects.toThrow();
    await h.add({ files: [file('a.wav')] });
    await h.load({ id: 1 });
    expect((await h.play()).paused).toBe(false);
  });

  it('seek 不會跑到負數，音量夾在 0~1', async () => {
    const { h, audio } = setup();
    h.seek({ time: -5 });
    expect(audio.currentTime).toBe(0);
    h.seek({ time: 12.5 });
    expect(audio.currentTime).toBe(12.5);
    h.volume({ value: 3 });
    expect(audio.volume).toBe(1);
  });

  it('刪掉正在播的曲目時停止播放並卸載', async () => {
    const { h, audio } = setup();
    await h.add({ files: [file('a.wav')] });
    await h.load({ id: 1 });
    await h.play();
    const lib = await h.remove({ id: 1 });
    expect(lib.tracks).toEqual([]);
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.src).toBe('');
  });
});

describe('事件推送', () => {
  it('<audio> 的狀態變化與播完都會推給 content 端', async () => {
    const { service, h, audio } = setup();
    const [a, b] = fakePorts();
    service.attach(b);
    const client = createClient(a);
    const states = [];
    const ended = vi.fn();
    client.on('state', (s) => states.push(s));
    client.on('ended', ended);

    await client.request('add', { files: [file('a.wav')] });
    await h.load({ id: 1 });
    audio.duration = 60;
    audio.currentTime = 3;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 0));

    expect(states.at(-1)).toMatchObject({ trackId: 1, time: 3, duration: 60 });
    expect(ended).toHaveBeenCalledWith({ trackId: 1 });
  });

  it('沒有載入曲目時的 error 事件不回報（清 src 也會觸發）', async () => {
    const { service, audio } = setup();
    const [a, b] = fakePorts();
    service.attach(b);
    const onError = vi.fn();
    createClient(a).on('error', onError);
    audio.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).not.toHaveBeenCalled();
  });
});
