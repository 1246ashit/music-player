/**
 * 音樂庫頁面提供的服務：管理曲目與專輯、實際播放音檔，並把播放狀態推回 content script。
 * 這裡只是「遙控的 <audio>」；播哪首、播完接哪首由 content 端的 music/player.js 決定。
 * 會改動音樂庫的操作都回傳整份 {tracks, albums}，content 端直接換掉，不用自己拼。
 */
import { serve } from '../music/channel.js';
import { planUpload } from '../music/names.js';
import { buildArchive, parseArchive } from './archive.js';
import { silent } from '../log.js';

const STATE_EVENTS = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'seeked', 'emptied'];

export const COVER_PX = 300;
export const MAX_ALBUM_NAME = 80;

function readText(file) {
  return typeof file.text === 'function' ? file.text() : new Response(file).text();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * 封面裁成置中的正方形並縮小：原圖可能是好幾 MB 的照片，
 * 每次列清單都要整份傳給 content 端，只留小圖。
 */
export async function makeThumbnail(file, px = COVER_PX) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(px, side);
  const canvas = new OffscreenCanvas(out, out);
  canvas.getContext('2d').drawImage(
    bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out,
  );
  bitmap.close();
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 }));
}

function albumName(name) {
  const clean = String(name == null ? '' : name).trim().slice(0, MAX_ALBUM_NAME);
  if (!clean) throw new Error('專輯名稱不能空白');
  return clean;
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./store.js').createTrackStore>} deps.store
 * @param {HTMLAudioElement} deps.audio
 * @param {{createObjectURL:Function, revokeObjectURL:Function}} [deps.urls]
 * @param {(file:Blob)=>Promise<string>} [deps.thumbnail] 封面縮圖，回傳 data URL
 */
export function createLibraryService({ store, audio, urls = URL, thumbnail = makeThumbnail, log = silent }) {
  let currentId = null;
  let currentUrl = null;
  let emit = () => {};

  function snapshot() {
    return {
      trackId: currentId,
      paused: audio.paused,
      time: audio.currentTime || 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    };
  }
  const push = () => emit('state', snapshot());

  STATE_EVENTS.forEach((ev) => audio.addEventListener(ev, push));
  audio.addEventListener('ended', () => { push(); emit('ended', { trackId: currentId }); });
  audio.addEventListener('error', () => {
    if (currentId === null) return;   // 卸載音檔時清掉 src 也會觸發，不算錯
    emit('error', { trackId: currentId, message: '這個音檔無法播放' });
  });

  function releaseUrl() {
    if (currentUrl) urls.revokeObjectURL(currentUrl);
    currentUrl = null;
  }

  function unload() {
    currentId = null;
    audio.pause();
    audio.removeAttribute('src');
    releaseUrl();
  }

  async function library() {
    const [tracks, albums] = await Promise.all([store.list(), store.listAlbums()]);
    return { tracks, albums };
  }

  /** null 是未分類；其他的必須是還存在的專輯。 */
  async function checkAlbum(albumId) {
    if (albumId == null) return null;
    if (!(await store.listAlbums()).some((a) => a.id === albumId)) throw new Error('找不到這張專輯');
    return albumId;
  }

  const handlers = {
    hello: () => true,

    list: () => library(),

    /** @param {{files:File[], albumId?:number|null}} args 新的歌直接放進正在看的那張專輯 */
    async add({ files = [], albumId = null }) {
      const target = await checkAlbum(albumId);
      const plan = planUpload(files, await store.list());
      for (const { audio: file, subtitle } of plan.newTracks) {
        await store.add({
          audio: file,
          audioName: file.name,
          subtitleName: subtitle ? subtitle.name : null,
          subtitleText: subtitle ? await readText(subtitle) : null,
          albumId: target,
        });
      }
      for (const { trackId, subtitle } of plan.attach) {
        await store.setSubtitle(trackId, subtitle.name, await readText(subtitle));
      }
      const names = (arr) => arr.map((f) => f.name);
      log(`上傳：新增 ${plan.newTracks.length}、補字幕 ${plan.attach.length}`);
      return {
        added: plan.newTracks.length,
        attached: plan.attach.map((a) => a.trackId),
        duplicates: names(plan.duplicates),
        orphans: names(plan.orphans),
        ignored: names(plan.ignored),
        library: await library(),
      };
    },

    async remove({ id }) {
      if (id === currentId) { unload(); push(); }
      await store.remove(id);
      return library();
    },

    async moveTracks({ ids = [], albumId = null }) {
      await store.moveTracks(ids, await checkAlbum(albumId));
      return library();
    },

    async reorder({ ids = [] }) {
      await store.reorder(ids);
      return library();
    },

    async createAlbum({ name }) {
      const album = await store.createAlbum(albumName(name));
      return { album, library: await library() };
    },

    async renameAlbum({ id, name }) {
      await store.updateAlbum(id, { name: albumName(name) });
      return library();
    },

    /** @param {{id:number, file:Blob|null}} args 給 null 是拿掉封面 */
    async setAlbumCover({ id, file }) {
      if (file && !/^image\//.test(file.type || '')) throw new Error('封面要是圖片檔');
      await store.updateAlbum(id, { cover: file ? await thumbnail(file) : null });
      return library();
    },

    async removeAlbum({ id }) {
      await store.removeAlbum(id);
      return library();
    },

    /** 整個音樂庫包成單一搬家檔（.mplib），給另一個擴充功能匯入。 */
    async export() {
      const { tracks, albums } = await library();
      return buildArchive({
        tracks, albums,
        getAudio: (id) => store.getAudio(id),
        getSubtitle: (id) => store.getSubtitle(id),
      });
    },

    /** @param {{file:Blob}} args 搬家檔；同名音檔略過，同名專輯併進去 */
    async import({ file }) {
      const { albums, tracks } = await parseArchive(file);
      const have = new Set((await store.list()).map((t) => String(t.audioName).normalize('NFC').toLowerCase()));
      const albumIds = new Map();
      const current = await store.listAlbums();
      for (const a of albums) {
        const same = current.find((c) => c.name === a.name);
        if (same) { albumIds.set(a.key, same.id); continue; }
        const created = await store.createAlbum(albumName(a.name));
        if (a.cover) await store.updateAlbum(created.id, { cover: a.cover });
        albumIds.set(a.key, created.id);
      }
      let added = 0;
      const duplicates = [];
      for (const t of tracks) {
        const key = String(t.audioName).normalize('NFC').toLowerCase();
        if (have.has(key)) { duplicates.push(t.audioName); continue; }
        have.add(key);
        await store.add({
          audio: t.audio,
          audioName: t.audioName,
          subtitleName: t.subtitleName,
          subtitleText: t.subtitleText,
          albumId: t.albumKey == null ? null : (albumIds.get(t.albumKey) ?? null),
        });
        added++;
      }
      log(`匯入：新增 ${added}、略過 ${duplicates.length}`);
      return { added, duplicates, library: await library() };
    },

    subtitle: ({ id }) => store.getSubtitle(id),

    async load({ id }) {
      const blob = await store.getAudio(id);
      if (!blob) throw new Error('音樂庫裡找不到這首');
      unload();
      currentUrl = urls.createObjectURL(blob);
      currentId = id;
      audio.src = currentUrl;
      return snapshot();
    },

    async play() {
      if (currentId === null) throw new Error('還沒選歌');
      await audio.play();
      return snapshot();
    },

    pause() {
      audio.pause();
      return snapshot();
    },

    seek({ time }) {
      audio.currentTime = Math.max(0, Number(time) || 0);
      return snapshot();
    },

    volume({ value }) {
      audio.volume = Math.max(0, Math.min(1, Number(value)));
      return audio.volume;
    },
  };

  return {
    handlers,
    attach(port) { emit = serve(port, handlers, { log }).emit; },
  };
}
