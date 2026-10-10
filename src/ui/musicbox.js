/**
 * 把音樂面板、字幕、播放控制與音樂庫連線組在一起。
 *
 * 掛在獨立的一層：iframe 只要一被移動或移除就會重新載入，音樂就斷了。
 * 第一次打開面板才連音樂庫，沒用到音樂的網頁不多開一個 iframe。
 */
import { createMusicPanel, describeUpload } from './musicpanel.js';
import { createMusicPlayer } from '../music/player.js';
import { ALL, albumIdForScope, scopeExists } from '../music/library.js';
import { showToast } from './chrome.js';
import { RELOAD_NEEDED } from '../music/frame.js';
import { silent } from '../log.js';

const MSG = {
  connectFail: '音樂庫連不上，詳情請看 Console 的 [MP] 紀錄',
  fail: '音樂操作失敗：',
  saving: '儲存中…（wav 檔比較大，請稍等）',
};

/** 瀏覽器下載：用暫時的 blob 網址點一個隱形連結。 */
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * @param {object} deps
 * @param {(parent:Element)=>Promise<{client:object, destroy:()=>void}>} deps.connect
 * @param {object} deps.settings
 * @param {(patch:object)=>void} deps.updateSettings
 * @param {(state:{visible:boolean, playing:boolean})=>void} [deps.onStatus] 給工具列的 🎵 顯示狀態
 */
export function createMusicBox({
  connect,
  settings,
  updateSettings,
  onStatus = () => {},
  toast = showToast,
  log = silent,
  confirm,
  createPlayer = createMusicPlayer,
}) {
  const layer = document.createElement('div');
  layer.className = 'mp-music-layer';
  const caption = document.createElement('div');
  caption.className = 'mp-music-caption';
  caption.hidden = true;

  let player = null;
  let conn = null;
  let connecting = null;
  let destroyed = false;
  let playing = false;
  // 還沒連上音樂庫前先畫一個空的面板
  let lastState = {
    tracks: [], albums: [], currentId: null, paused: true, time: 0, duration: 0,
    volume: settings.musicVolume, repeat: settings.musicRepeat, captions: settings.musicCaptions,
    scope: settings.musicScope, shuffle: settings.musicShuffle,
  };

  const report = () => {
    layer.classList.toggle('mp-panel-open', panel.visible);
    onStatus({ visible: panel.visible, playing });
  };

  let synced = false;   // 拿到音樂庫的內容了沒

  /**
   * 面板正在看的範圍；那張專輯被刪掉了就回到「全部」。
   * 還沒連上時清單是空的，別因此把記住的專輯當成不存在。
   */
  function currentView() {
    const lib = { tracks: lastState.tracks, albums: lastState.albums };
    if (synced && !scopeExists(lib, settings.musicView)) updateSettings({ musicView: ALL });
    return settings.musicView;
  }

  function render(s) {
    lastState = s;
    panel.render({ ...s, view: currentView() });
  }

  function setView(view) {
    updateSettings({ musicView: view });
    render(lastState);
  }

  function setCaption(text) {
    caption.textContent = text;
    caption.hidden = !text;
  }

  function ensurePlayer() {
    if (player) return Promise.resolve(player);
    if (!connecting) {
      panel.setStatus('連線音樂庫中…');
      connecting = connect(layer)
        .then(async (c) => {
          if (destroyed) { c.destroy(); return null; }
          conn = c;
          const p = createPlayer({
            backend: c.client,
            settings,
            updateSettings,
            onChange: (s) => {
              synced = true;
              render(s);
              if (playing !== !s.paused) { playing = !s.paused; report(); }
            },
            onCue: setCaption,
            onError: (msg) => toast(msg),
            log,
          });
          await p.init();
          player = p;
          panel.setStatus('');
          return p;
        })
        .catch((err) => {
          connecting = null;
          log('音樂庫連線失敗', err);
          panel.setStatus(`連不上音樂庫：${err.message}`);
          toast(err.name === RELOAD_NEEDED ? err.message : MSG.connectFail);
          return null;
        });
    }
    return connecting;
  }

  /** 每個操作都先確定連上了，失敗統一提示。 */
  const act = (fn) => async (...args) => {
    const p = await ensurePlayer();
    if (!p || destroyed) return;
    try {
      await fn(p, ...args);
    } catch (err) {
      log('音樂操作失敗', err);
      toast(MSG.fail + err.message);
    }
  };

  const panel = createMusicPanel({
    ...(confirm ? { confirm } : {}),
    on: {
      hide: () => api.toggle(false),
      upload: act(async (p, files) => {
        panel.setStatus(MSG.saving);
        try {
          panel.setStatus(describeUpload(await p.upload(files, albumIdForScope(currentView()))));
        } catch (err) {
          panel.setStatus('');
          throw err;
        }
      }),
      // 從哪個畫面點的歌，之後就在那個範圍裡接下一首
      play: act((p, id) => p.play(id, currentView())),
      playView: act((p, { shuffle }) => p.playScope(currentView(), { shuffle })),
      setView,
      createAlbum: act(async (p, name) => { setView((await p.createAlbum(name)).id); }),
      renameAlbum: act((p, id, name) => p.renameAlbum(id, name)),
      setCover: act((p, id, file) => p.setAlbumCover(id, file)),
      removeAlbum: act((p, id) => p.removeAlbum(id)),
      move: act((p, ids, albumId) => p.moveTracks(ids, albumId)),
      reorder: act((p, ids) => p.reorder(ids)),
      shuffle: act((p) => p.toggleShuffle()),
      toggle: act((p) => p.toggle()),
      next: act((p) => p.next()),
      prev: act((p) => p.prev()),
      seek: act((p, t) => p.seek(t)),
      volume: act((p, v) => p.setVolume(v)),
      repeat: act((p) => p.cycleRepeat()),
      captions: act((p) => p.toggleCaptions()),
      remove: act((p, id) => p.remove(id)),
      exportLib: act(async (p) => {
        panel.setStatus('打包音樂庫中…（wav 檔比較大，請稍等）');
        try {
          saveBlob(await p.exportLibrary(), `music-library-${stamp()}.mplib`);
          panel.setStatus('已匯出，檔案在瀏覽器的下載資料夾');
        } catch (err) {
          panel.setStatus('');
          throw err;
        }
      }),
      importLib: act(async (p, file) => {
        panel.setStatus('匯入中…（wav 檔比較大，請稍等）');
        try {
          const r = await p.importLibrary(file);
          const dup = r.duplicates.length ? `；${r.duplicates.length} 首已在音樂庫裡，略過` : '';
          panel.setStatus(`匯入完成：新增 ${r.added} 首${dup}`);
        } catch (err) {
          panel.setStatus('');
          throw err;
        }
      }),
    },
  });

  render(lastState);
  layer.appendChild(caption);
  layer.appendChild(panel.el);
  document.body.appendChild(layer);

  const api = {
    get visible() { return panel.visible; },
    get playing() { return playing; },

    /** @param {boolean} [show] 不給就切換 */
    toggle(show = !panel.visible) {
      if (destroyed) return;
      if (show) { panel.show(); ensurePlayer(); } else panel.hide();
      report();
    },

    /** 播放／暫停（快捷鍵用）；還沒連上就順便連。 */
    togglePlay: act((p) => p.toggle()),

    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (player) player.dispose();
      if (conn) conn.destroy();
      layer.remove();
    },
  };

  return api;
}
