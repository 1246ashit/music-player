/**
 * 音樂庫的 IndexedDB（在擴充功能自己的來源底下）。
 *
 * 曲目資訊、音檔、字幕分開存：列清單時只讀小小的曲目資訊，
 * 不用把幾百 MB 的 wav 一起拉出來。專輯的封面是縮過的小圖（data URL），直接放在專輯資料裡。
 *
 * 曲目的 `order` 只是排序用的數字：新加入或移進專輯的用當下時間，自然排在最後；
 * 在專輯裡拖曳排序時才改寫成 0, 1, 2…。
 */
import { audioMimeFor } from '../music/names.js';

export const DB_NAME = 'mp-music';
const DB_VERSION = 2;
const TRACKS = 'tracks';
const AUDIO = 'audio';
const SUBTITLES = 'subtitles';
const ALBUMS = 'albums';
const TRACK_STORES = [TRACKS, AUDIO, SUBTITLES];

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 只聽 abort：請求失敗會讓整個交易 abort；自己呼叫 abort() 時 tx.error 是 null，
 * 而那時被取消的請求也會冒出 error 事件，聽 onerror 會拿到 null 當錯誤。
 */
function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('音樂庫寫入中止'));
  });
}

function upgrade(db, tx, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore(TRACKS, { keyPath: 'id', autoIncrement: true });
    db.createObjectStore(AUDIO);
    db.createObjectStore(SUBTITLES);
  }
  if (oldVersion < 2) {
    db.createObjectStore(ALBUMS, { keyPath: 'id', autoIncrement: true });
    // v1 的曲目沒有專輯與順序：全部歸到未分類，照加入時間排
    const tracks = tx.objectStore(TRACKS);
    const all = tracks.getAll();
    all.onsuccess = () => all.result.forEach((t) => {
      if (t.albumId === undefined) tracks.put({ ...t, albumId: null, order: t.addedAt });
    });
  }
}

/** 在同一個交易裡逐一讀出、改寫；有任何一筆不存在就整筆交易取消。 */
function updateEach(store, ids, change) {
  ids.forEach((id, i) => {
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) { store.transaction.abort(); return; }
      store.put({ ...req.result, ...change(req.result, i) });
    };
  });
}

const byOrder = (a, b) => a.order - b.order || a.id - b.id;

/**
 * @param {IDBFactory} idb
 * @param {{now?:()=>number}} [opts]
 */
export function createTrackStore(idb, { now = () => Date.now() } = {}) {
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = idb.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => upgrade(req.result, req.transaction, e.oldVersion);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
      });
    }
    return dbPromise;
  }

  async function readOne(storeName, key) {
    const db = await open();
    return request(db.transaction(storeName).objectStore(storeName).get(key));
  }

  async function readAll(storeName) {
    const db = await open();
    return request(db.transaction(storeName).objectStore(storeName).getAll());
  }

  return {
    /** 曲目資訊（不含音檔），依 order 排。 */
    async list() {
      return (await readAll(TRACKS)).sort(byOrder);
    },

    /** 專輯依建立順序排。 */
    async listAlbums() {
      return (await readAll(ALBUMS)).sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    },

    /**
     * @param {{audio:Blob, audioName:string, subtitleName?:string|null, subtitleText?:string|null, albumId?:number|null}} t
     */
    async add({ audio, audioName, subtitleName = null, subtitleText = null, albumId = null }) {
      const db = await open();
      const tx = db.transaction(TRACK_STORES, 'readwrite');
      const addedAt = now();
      const meta = {
        audioName,
        audioType: audio.type || audioMimeFor(audioName),
        size: audio.size,
        subtitleName: subtitleText == null ? null : subtitleName,
        addedAt,
        albumId,
        order: addedAt,
      };
      // 同一個交易裡接著寫：先拿到自動編號，再用它當音檔與字幕的 key
      const req = tx.objectStore(TRACKS).add(meta);
      req.onsuccess = () => {
        tx.objectStore(AUDIO).put(audio, req.result);
        if (subtitleText != null) tx.objectStore(SUBTITLES).put(subtitleText, req.result);
      };
      await finished(tx);
      return { ...meta, id: req.result };
    },

    async setSubtitle(id, subtitleName, subtitleText) {
      const db = await open();
      const tx = db.transaction([TRACKS, SUBTITLES], 'readwrite');
      updateEach(tx.objectStore(TRACKS), [id], () => {
        tx.objectStore(SUBTITLES).put(subtitleText, id);
        return { subtitleName };
      });
      await finished(tx);
    },

    async getAudio(id) {
      return (await readOne(AUDIO, id)) || null;
    },

    async getSubtitle(id) {
      const text = await readOne(SUBTITLES, id);
      return text == null ? null : text;
    },

    async remove(id) {
      const db = await open();
      const tx = db.transaction(TRACK_STORES, 'readwrite');
      TRACK_STORES.forEach((name) => tx.objectStore(name).delete(id));
      await finished(tx);
    },

    /** 移到某張專輯（null 是未分類），照給的順序接在最後面。 */
    async moveTracks(ids, albumId) {
      const db = await open();
      const tx = db.transaction(TRACKS, 'readwrite');
      const base = now();
      updateEach(tx.objectStore(TRACKS), ids, (_, i) => ({ albumId, order: base + i }));
      await finished(tx);
    },

    /** 依給的順序重排（通常是某張專輯裡的全部曲目）。 */
    async reorder(ids) {
      const db = await open();
      const tx = db.transaction(TRACKS, 'readwrite');
      updateEach(tx.objectStore(TRACKS), ids, (_, i) => ({ order: i }));
      await finished(tx);
    },

    async createAlbum(name) {
      const db = await open();
      const tx = db.transaction(ALBUMS, 'readwrite');
      const album = { name, cover: null, createdAt: now() };
      const req = tx.objectStore(ALBUMS).add(album);
      await finished(tx);
      return { ...album, id: req.result };
    },

    /** @param {{name?:string, cover?:string|null}} patch */
    async updateAlbum(id, patch) {
      const db = await open();
      const tx = db.transaction(ALBUMS, 'readwrite');
      updateEach(tx.objectStore(ALBUMS), [id], () => patch);
      await finished(tx);
    },

    /** 刪專輯不刪歌：裡面的歌照原本順序移到未分類的最後面。 */
    async removeAlbum(id) {
      const db = await open();
      const tx = db.transaction([ALBUMS, TRACKS], 'readwrite');
      tx.objectStore(ALBUMS).delete(id);
      const tracks = tx.objectStore(TRACKS);
      const all = tracks.getAll();
      const base = now();
      all.onsuccess = () => all.result
        .filter((t) => t.albumId === id)
        .sort(byOrder)
        .forEach((t, i) => tracks.put({ ...t, albumId: null, order: base + i }));
      await finished(tx);
    },
  };
}
