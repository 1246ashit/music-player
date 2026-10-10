import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { createTrackStore, DB_NAME } from '../src/library/store.js';

// jsdom 的 Blob 過不了 fake-indexeddb 的 structured clone，用 Node 的
const audio = (bytes = 4, type = 'audio/wav') => new NodeBlob([new Uint8Array(bytes)], { type });

function setup(idb = new IDBFactory()) {
  let t = 1000;
  return createTrackStore(idb, { now: () => t++ });
}

describe('add / list', () => {
  it('加入後清單有曲目資訊，但不含音檔本體', async () => {
    const store = setup();
    const meta = await store.add({ audio: audio(10), audioName: 'a.wav' });
    expect(meta).toMatchObject({ audioName: 'a.wav', audioType: 'audio/wav', size: 10, subtitleName: null });
    const list = await store.list();
    expect(list).toEqual([meta]);
    expect(list[0].audio).toBeUndefined();
  });

  it('依加入順序排列', async () => {
    const store = setup();
    await store.add({ audio: audio(), audioName: 'b.wav' });
    await store.add({ audio: audio(), audioName: 'a.wav' });
    expect((await store.list()).map((t) => t.audioName)).toEqual(['b.wav', 'a.wav']);
  });

  it('音檔沒有 MIME 時依副檔名補上', async () => {
    const store = setup();
    const meta = await store.add({ audio: audio(1, ''), audioName: 'a.mp3' });
    expect(meta.audioType).toBe('audio/mpeg');
  });

  it('可以一起存字幕', async () => {
    const store = setup();
    const meta = await store.add({ audio: audio(), audioName: 'a.wav', subtitleName: 'a.wav.vtt', subtitleText: 'WEBVTT' });
    expect(meta.subtitleName).toBe('a.wav.vtt');
    expect(await store.getSubtitle(meta.id)).toBe('WEBVTT');
  });
});

describe('讀取', () => {
  it('getAudio 取回音檔，沒有就回 null', async () => {
    const store = setup();
    const { id } = await store.add({ audio: audio(7), audioName: 'a.wav' });
    expect((await store.getAudio(id)).size).toBe(7);
    expect(await store.getAudio(999)).toBeNull();
  });

  it('沒有字幕時 getSubtitle 回 null', async () => {
    const store = setup();
    const { id } = await store.add({ audio: audio(), audioName: 'a.wav' });
    expect(await store.getSubtitle(id)).toBeNull();
  });
});

describe('setSubtitle', () => {
  it('幫既有的曲目補上字幕', async () => {
    const store = setup();
    const { id } = await store.add({ audio: audio(), audioName: 'a.wav' });
    await store.setSubtitle(id, 'a.vtt', 'WEBVTT\n');
    expect((await store.list())[0].subtitleName).toBe('a.vtt');
    expect(await store.getSubtitle(id)).toBe('WEBVTT\n');
  });

  it('曲目不存在時失敗，也不會留下沒主人的字幕', async () => {
    const store = setup();
    await expect(store.setSubtitle(42, 'x.vtt', 'x')).rejects.toBeTruthy();
    expect(await store.getSubtitle(42)).toBeNull();
  });
});

describe('remove', () => {
  it('曲目、音檔、字幕一起刪掉', async () => {
    const store = setup();
    const { id } = await store.add({ audio: audio(), audioName: 'a.wav', subtitleName: 'a.vtt', subtitleText: 'x' });
    await store.remove(id);
    expect(await store.list()).toEqual([]);
    expect(await store.getAudio(id)).toBeNull();
    expect(await store.getSubtitle(id)).toBeNull();
  });
});

describe('專輯', () => {
  it('新歌預設未分類，排在最後面', async () => {
    const store = setup();
    const a = await store.add({ audio: audio(), audioName: 'a.wav' });
    const b = await store.add({ audio: audio(), audioName: 'b.wav' });
    expect(a.albumId).toBeNull();
    expect(b.order).toBeGreaterThan(a.order);
  });

  it('建立、改名、換封面、列出專輯', async () => {
    const store = setup();
    const first = await store.createAlbum('A');
    await store.createAlbum('B');
    await store.updateAlbum(first.id, { name: 'A2', cover: 'data:x' });
    const albums = await store.listAlbums();
    expect(albums.map((x) => x.name)).toEqual(['A2', 'B']);
    expect(albums[0].cover).toBe('data:x');
    expect(albums[1].cover).toBeNull();
  });

  it('改不存在的專輯會失敗', async () => {
    const store = setup();
    await expect(store.updateAlbum(9, { name: 'x' })).rejects.toBeTruthy();
  });

  it('可以直接加進專輯', async () => {
    const store = setup();
    const album = await store.createAlbum('A');
    const t = await store.add({ audio: audio(), audioName: 'a.wav', albumId: album.id });
    expect((await store.list())[0]).toMatchObject({ id: t.id, albumId: album.id });
  });

  it('移進專輯的歌照給的順序接在最後面', async () => {
    const store = setup();
    const album = await store.createAlbum('A');
    const inAlbum = await store.add({ audio: audio(), audioName: 'x.wav', albumId: album.id });
    const a = await store.add({ audio: audio(), audioName: 'a.wav' });
    const b = await store.add({ audio: audio(), audioName: 'b.wav' });
    await store.moveTracks([b.id, a.id], album.id);
    const tracks = (await store.list()).filter((t) => t.albumId === album.id);
    expect(tracks.map((t) => t.id)).toEqual([inAlbum.id, b.id, a.id]);
  });

  it('reorder 依給的順序改寫', async () => {
    const store = setup();
    const a = await store.add({ audio: audio(), audioName: 'a.wav' });
    const b = await store.add({ audio: audio(), audioName: 'b.wav' });
    const c = await store.add({ audio: audio(), audioName: 'c.wav' });
    await store.reorder([c.id, a.id, b.id]);
    expect((await store.list()).map((t) => t.id)).toEqual([c.id, a.id, b.id]);
  });

  it('其中一首不存在時整批不動', async () => {
    const store = setup();
    const a = await store.add({ audio: audio(), audioName: 'a.wav' });
    const b = await store.add({ audio: audio(), audioName: 'b.wav' });
    await expect(store.reorder([b.id, 999, a.id])).rejects.toBeTruthy();
    expect((await store.list()).map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('刪除專輯：歌保留原順序，移到未分類最後面', async () => {
    const store = setup();
    const album = await store.createAlbum('A');
    const loose = await store.add({ audio: audio(), audioName: 'z.wav' });
    const a = await store.add({ audio: audio(), audioName: 'a.wav', albumId: album.id });
    const b = await store.add({ audio: audio(), audioName: 'b.wav', albumId: album.id });
    await store.reorder([b.id, a.id]);
    await store.removeAlbum(album.id);
    expect(await store.listAlbums()).toEqual([]);
    const tracks = await store.list();
    expect(tracks.every((t) => t.albumId === null)).toBe(true);
    expect(tracks.map((t) => t.id)).toEqual([loose.id, b.id, a.id]);
    expect(await store.getAudio(a.id)).not.toBeNull();
  });
});

describe('從 v1 升級', () => {
  /** 用 v1 的結構建一個舊資料庫：沒有 albums，曲目沒有 albumId / order。 */
  function openV1(idb) {
    return new Promise((resolve, reject) => {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('audio');
        db.createObjectStore('subtitles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  it('舊曲目歸到未分類、照加入時間排，音檔都還在', async () => {
    const idb = new IDBFactory();
    const db = await openV1(idb);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['tracks', 'audio'], 'readwrite');
      tx.objectStore('tracks').add({ id: 1, audioName: 'new.wav', size: 1, subtitleName: null, addedAt: 500 });
      tx.objectStore('tracks').add({ id: 2, audioName: 'old.wav', size: 1, subtitleName: null, addedAt: 100 });
      tx.objectStore('audio').put(audio(3), 1);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const store = setup(idb);
    const tracks = await store.list();
    expect(tracks.map((t) => [t.id, t.albumId, t.order])).toEqual([[2, null, 100], [1, null, 500]]);
    expect(await store.listAlbums()).toEqual([]);
    expect((await store.getAudio(1)).size).toBe(3);
  });
});
