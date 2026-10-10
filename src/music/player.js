/**
 * 音樂播放控制：播放範圍（全部／未分類／某張專輯）、依序或隨機、上一首／下一首、
 * 播完接哪首、字幕同步，以及專輯的整理操作。
 * 真正發聲的 <audio> 在音樂庫 iframe 裡，這裡只透過注入的 backend（channel client）遙控它。
 */
import { parseVtt, cueAt } from './vtt.js';
import { ALL, tracksIn, scopeExists } from './library.js';
import { createShuffleQueue } from './shuffle.js';
import { silent } from '../log.js';

const TICK_MS = 100;          // 字幕更新頻率；timeupdate 一秒只來約 4 次，字幕會慢半拍
const RESTART_AFTER_S = 3;    // 播超過這麼久按「上一首」是回到這首開頭

export const MUSIC_MSG = {
  blocked: '瀏覽器擋下了播放，請再按一次 ▶',
  playFail: '這首播不出來，詳情請看 Console 的 [MP] 紀錄',
  empty: '這裡還沒有歌',
};

/**
 * @param {object} deps
 * @param {{request:Function, on:Function}} deps.backend
 * @param {object} deps.settings 會被 updateSettings 就地更新
 * @param {(patch:object)=>void} deps.updateSettings
 * @param {(state:object)=>void} [deps.onChange] 狀態改變時給 UI 重畫
 * @param {(text:string)=>void} [deps.onCue] 目前該顯示的字幕
 * @param {(msg:string)=>void} [deps.onError]
 * @param {()=>number} [deps.now]
 * @param {()=>number} [deps.random] 洗牌用
 */
export function createMusicPlayer({
  backend,
  settings,
  updateSettings,
  onChange = () => {},
  onCue = () => {},
  onError = () => {},
  log = silent,
  now = () => Date.now(),
  random = Math.random,
}) {
  let lib = { tracks: [], albums: [] };
  let state = { trackId: null, paused: true, time: 0, duration: 0 };
  let stateAt = now();
  let cues = [];
  let cueText = '';
  let ticker = null;
  let loadSeq = 0;
  let disposed = false;
  const offs = [];
  const bag = createShuffleQueue({ random });

  const queue = () => tracksIn(lib, settings.musicScope).map((t) => t.id);

  /** 兩次 timeupdate 之間用經過的時間推算，字幕才跟得上。 */
  function currentTime() {
    if (state.paused) return state.time;
    const t = state.time + (now() - stateAt) / 1000;
    return state.duration ? Math.min(t, state.duration) : t;
  }

  function snapshot() {
    return {
      tracks: lib.tracks,
      albums: lib.albums,
      currentId: state.trackId,
      paused: state.paused,
      time: currentTime(),
      duration: state.duration,
      volume: settings.musicVolume,
      repeat: settings.musicRepeat,
      captions: settings.musicCaptions,
      scope: settings.musicScope,
      shuffle: settings.musicShuffle,
      hasSubtitle: cues.length > 0,
    };
  }

  function changed() {
    if (!disposed) onChange(snapshot());
  }

  function updateCue() {
    const text = !disposed && settings.musicCaptions && state.trackId !== null ? cueAt(cues, currentTime()) : '';
    if (text === cueText) return;
    cueText = text;
    onCue(text);
  }

  function syncTicker() {
    const want = !disposed && !state.paused;
    if (want && !ticker) ticker = setInterval(updateCue, TICK_MS);
    else if (!want && ticker) { clearInterval(ticker); ticker = null; }
  }

  function applyState(s) {
    if (!s || disposed) return;
    state = { trackId: s.trackId, paused: s.paused, time: s.time, duration: s.duration };
    stateAt = now();
    syncTicker();
    updateCue();
    changed();
  }

  /** 換上音樂庫回傳的新內容；正在播的範圍若被刪掉就退回「全部」。 */
  function setLibrary(next) {
    lib = next;
    if (!scopeExists(lib, settings.musicScope)) {
      updateSettings({ musicScope: ALL });
      bag.reset(queue(), state.trackId);
    } else {
      bag.sync(queue());
    }
  }

  async function mutate(op, args) {
    setLibrary(await backend.request(op, args));
    changed();
  }

  async function loadSubtitles(id, seq) {
    let text = null;
    try { text = await backend.request('subtitle', { id }); } catch (err) { log('讀字幕失敗', err); }
    if (seq !== loadSeq) return;       // 等待期間又換了歌
    cues = text ? parseVtt(text) : [];
    updateCue();
  }

  async function playNow() {
    try {
      applyState(await backend.request('play'));
    } catch (err) {
      log('播放失敗', err);
      onError(err && err.name === 'NotAllowedError' ? MUSIC_MSG.blocked : MUSIC_MSG.playFail);
    }
  }

  async function select(id, { play = true } = {}) {
    const seq = ++loadSeq;
    cues = [];
    applyState(await backend.request('load', { id }));
    updateSettings({ musicTrackId: id });
    await loadSubtitles(id, seq);
    changed();
    if (play && seq === loadSeq) await playNow();
  }

  async function step(dir) {
    const q = queue();
    if (!q.length) return;
    let id;
    if (settings.musicShuffle) {
      id = dir > 0 ? bag.next() : bag.prev();
      if (id == null) {
        if (dir < 0) await api.seek(0);   // 已經是這輪抽到的第一首
        return;
      }
    } else {
      const i = q.indexOf(state.trackId);
      id = i < 0 ? q[dir > 0 ? 0 : q.length - 1] : q[(i + dir + q.length) % q.length];
    }
    await select(id);
  }

  async function handleEnded() {
    if (settings.musicRepeat === 'one') {
      await api.seek(0);
      await playNow();
    } else {
      await step(1);
    }
  }

  const api = {
    get cue() { return cueText; },
    snapshot,

    /** 連上音樂庫後：拿清單、套用音量，並選回上次那首（不自動播）。 */
    async init() {
      offs.push(
        backend.on('state', applyState),
        backend.on('ended', () => handleEnded().catch((err) => log('接下一首失敗', err))),
        backend.on('error', (e) => onError((e && e.message) || MUSIC_MSG.playFail)),
      );
      await backend.request('volume', { value: settings.musicVolume });
      setLibrary(await backend.request('list'));
      const last = settings.musicTrackId;
      const resume = lib.tracks.some((t) => t.id === last);
      bag.reset(queue(), resume ? last : null);
      if (resume) await select(last, { play: false });
      changed();
    },

    /**
     * @param {File[]} files
     * @param {number|null} [albumId] 放進哪張專輯；null 是未分類
     * @returns {Promise<object>} 音樂庫回報的上傳結果
     */
    async upload(files, albumId = null) {
      const result = await backend.request('add', { files, albumId });
      setLibrary(result.library);
      // 剛補上字幕的正是這首，要馬上看得到
      if (state.trackId !== null && result.attached.includes(state.trackId)) {
        await loadSubtitles(state.trackId, loadSeq);
      }
      changed();
      return result;
    },

    /**
     * 使用者點了某首。
     * @param {*} [scope] 從哪個範圍點的；之後的上一首／下一首就在這個範圍裡
     */
    async play(id, scope) {
      if (scope !== undefined && scope !== settings.musicScope) {
        updateSettings({ musicScope: scope });
        bag.reset(queue(), id);
      } else if (bag.order.includes(id)) {
        bag.moveTo(id);
      } else {
        bag.reset(queue(), id);
      }
      await select(id);
    },

    /** 從頭播一個範圍：依序從第一首，或隨機抽。 */
    async playScope(scope, { shuffle = false } = {}) {
      updateSettings({ musicScope: scope, musicShuffle: shuffle });
      const q = queue();
      if (!q.length) { onError(MUSIC_MSG.empty); changed(); return; }
      bag.reset(q);
      await select(shuffle ? bag.next() : q[0]);
    },

    async toggle() {
      if (state.trackId === null) {
        await api.playScope(settings.musicScope, { shuffle: settings.musicShuffle });
        return;
      }
      if (state.paused) await playNow();
      else applyState(await backend.request('pause'));
    },

    next: () => step(1),

    async prev() {
      if (currentTime() > RESTART_AFTER_S) return api.seek(0);
      return step(-1);
    },

    async seek(time) {
      applyState(await backend.request('seek', { time }));
    },

    async setVolume(value) {
      updateSettings({ musicVolume: value });
      await backend.request('volume', { value: settings.musicVolume });
      changed();
    },

    cycleRepeat() {
      updateSettings({ musicRepeat: settings.musicRepeat === 'one' ? 'all' : 'one' });
      changed();
    },

    /** 開隨機時從正在播的這首往後洗。 */
    toggleShuffle() {
      const on = !settings.musicShuffle;
      updateSettings({ musicShuffle: on });
      if (on) bag.reset(queue(), state.trackId);
      changed();
    },

    toggleCaptions() {
      updateSettings({ musicCaptions: !settings.musicCaptions });
      updateCue();
      changed();
    },

    /** @returns {Promise<Blob>} 整個音樂庫的搬家檔 */
    exportLibrary: () => backend.request('export'),

    /** @param {File} file 搬家檔 */
    async importLibrary(file) {
      const result = await backend.request('import', { file });
      setLibrary(result.library);
      changed();
      return result;
    },

    async remove(id) {
      const wasCurrent = id === state.trackId;
      setLibrary(await backend.request('remove', { id }));
      if (wasCurrent) {
        loadSeq++;
        cues = [];
        updateSettings({ musicTrackId: null });
        applyState({ trackId: null, paused: true, time: 0, duration: 0 });
      }
      changed();
    },

    /** @returns {Promise<object>} 新建的專輯 */
    async createAlbum(name) {
      const { album, library } = await backend.request('createAlbum', { name });
      setLibrary(library);
      changed();
      return album;
    },

    renameAlbum: (id, name) => mutate('renameAlbum', { id, name }),
    setAlbumCover: (id, file) => mutate('setAlbumCover', { id, file }),
    removeAlbum: (id) => mutate('removeAlbum', { id }),
    moveTracks: (ids, albumId) => mutate('moveTracks', { ids, albumId }),
    reorder: (ids) => mutate('reorder', { ids }),

    dispose() {
      if (cueText) onCue('');
      cueText = '';
      disposed = true;
      offs.forEach((off) => off());
      syncTicker();
    },
  };

  return api;
}
