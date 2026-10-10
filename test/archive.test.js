import { describe, it, expect, vi, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { buildArchive, parseArchive } from '../src/library/archive.js';
import { createTrackStore } from '../src/library/store.js';
import { createLibraryService } from '../src/library/service.js';

// jsdom 的 Blob 過不了 fake-indexeddb 的 structured clone，也拼不進 Node 的 Blob；整個測試改用 Node 的
vi.stubGlobal('Blob', NodeBlob);
afterEach(() => { /* 保留 stub：每個測試都需要 */ });

const wav = (text) => new NodeBlob([text], { type: 'audio/wav' });

function service() {
  let t = 1000;
  const store = createTrackStore(new IDBFactory(), { now: () => t++ });
  const audio = new EventTarget();
  Object.assign(audio, { pause() {}, removeAttribute() {}, paused: true, currentTime: 0, duration: NaN });
  return { store, h: createLibraryService({ store, audio, urls: { createObjectURL() {}, revokeObjectURL() {} } }).handlers };
}

async function seed(store) {
  const album = await store.createAlbum('睡前');
  await store.updateAlbum(album.id, { cover: 'data:image/webp;base64,AAA' });
  await store.add({ audio: wav('one'), audioName: 'a.wav', subtitleName: 'a.wav.vtt', subtitleText: 'WEBVTT', albumId: album.id });
  await store.add({ audio: wav('three!'), audioName: 'b.wav', albumId: album.id });
  await store.add({ audio: wav('xx'), audioName: 'c.wav' });
}

describe('搬家檔', () => {
  it('匯出再匯入：專輯、順序、字幕、音檔內容都跟著走', async () => {
    const from = service();
    await seed(from.store);
    const file = await from.h.export();

    const to = service();
    const r = await to.h.import({ file });
    expect(r.added).toBe(3);
    expect(r.duplicates).toEqual([]);

    const { tracks, albums } = r.library;
    expect(albums.map((a) => [a.name, a.cover])).toEqual([['睡前', 'data:image/webp;base64,AAA']]);
    expect(tracks.map((t) => [t.audioName, t.albumId])).toEqual([
      ['a.wav', albums[0].id], ['b.wav', albums[0].id], ['c.wav', null],
    ]);
    const a = tracks[0];
    expect(a.subtitleName).toBe('a.wav.vtt');
    expect(await to.store.getSubtitle(a.id)).toBe('WEBVTT');
    expect(await (await to.store.getAudio(a.id)).text()).toBe('one');
    expect(await (await to.store.getAudio(tracks[1].id)).text()).toBe('three!');
  });

  it('重複匯入同一個檔：同名音檔略過，專輯併進同名的', async () => {
    const from = service();
    await seed(from.store);
    const file = await from.h.export();
    const to = service();
    await to.h.import({ file });
    const r = await to.h.import({ file });
    expect(r.added).toBe(0);
    expect(r.duplicates).toHaveLength(3);
    expect(r.library.albums).toHaveLength(1);
    expect(r.library.tracks).toHaveLength(3);
  });

  it('不是搬家檔、被截斷的檔都會明確報錯', async () => {
    await expect(parseArchive(new NodeBlob(['hello world, not an archive']))).rejects.toThrow('不是音樂庫搬家檔');
    const from = service();
    await seed(from.store);
    const whole = await from.h.export();
    await expect(parseArchive(whole.slice(0, whole.size - 3))).rejects.toThrow('截斷');
    await expect(parseArchive(whole.slice(0, 15))).rejects.toThrow('不完整');
  });

  it('資料庫裡缺音檔的曲目不會被包進去', async () => {
    const blob = await buildArchive({
      tracks: [{ id: 1, audioName: 'x.wav' }], albums: [],
      getAudio: async () => null, getSubtitle: async () => null,
    });
    expect((await parseArchive(blob)).tracks).toEqual([]);
  });
});
