/** 音樂面板：正在播放、播放控制、上傳，以及下方的音樂庫瀏覽（ui/musiclibrary.js）。 */
import { ACCEPT, trackTitle, cleanSubtitleName } from '../music/names.js';
import { albumOfTrack, scopeLabel, ALL } from '../music/library.js';
import { createLibraryView, coverEl, formatSize } from './musiclibrary.js';
import { setMarqueeText, scheduleMarquees } from './marquee.js';

export { formatSize };

const REPEAT_LABEL = {
  all: { icon: '🔁', title: '循環（按一下改成單曲循環）' },
  one: { icon: '🔂', title: '單曲循環（按一下改成循環）' },
};

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 上傳結果的一句話摘要。字幕名一律顯示清過的 `xxx.vtt`。 */
export function describeUpload(r) {
  const parts = [];
  if (r.added) parts.push(`新增 ${r.added} 首`);
  if (r.attached.length) parts.push(`補上 ${r.attached.length} 個字幕`);
  if (r.duplicates.length) parts.push(`${r.duplicates.length} 首已在音樂庫裡，略過`);
  if (r.orphans.length) parts.push(`找不到對應音檔的字幕：${r.orphans.map(cleanSubtitleName).join('、')}`);
  if (r.ignored.length) parts.push(`不支援的檔案：${r.ignored.join('、')}`);
  return parts.join('；') || '沒有可加入的檔案';
}

/** 外部拖進來的檔案才算上傳；清單裡拖曳排序的不算。 */
function hasFiles(e) {
  return !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
}

/**
 * @param {object} deps
 * @param {object} deps.on 播放控制：upload, toggle, next, prev, seek, volume, repeat, shuffle, captions, hide；
 *   其餘（setView, play, playView, 專輯操作…）交給 ui/musiclibrary.js
 * @param {(msg:string)=>boolean} [deps.confirm]
 */
export function createMusicPanel({ on, confirm }) {
  const root = document.createElement('div');
  root.className = 'mp-music';
  root.hidden = true;
  root.innerHTML = `
    <div class="mp-music-head">
      <strong>🎵 音樂</strong>
      <span class="mp-spacer"></span>
      <button class="mp-music-hide" title="收起面板（音樂會繼續播）">✕</button>
    </div>
    <div class="mp-music-now">
      <span class="mp-music-art"></span>
      <div class="mp-music-nowtext">
        <div class="mp-music-title">還沒選歌</div>
        <div class="mp-music-album"></div>
      </div>
    </div>
    <input class="mp-music-seek" type="range" min="0" max="0" step="0.1" value="0">
    <div class="mp-music-time"><span class="mp-music-pos">0:00</span><span class="mp-music-dur">0:00</span></div>
    <div class="mp-music-ctrl">
      <button data-a="prev" title="上一首">⏮</button>
      <button data-a="toggle" class="mp-music-play" title="播放／暫停">▶</button>
      <button data-a="next" title="下一首">⏭</button>
      <button data-a="shuffle" class="mp-music-shuffle" title="隨機播放">🔀</button>
      <button data-a="repeat" class="mp-music-repeat"></button>
      <button data-a="captions" class="mp-music-cc" title="顯示／隱藏字幕">字幕</button>
      <input class="mp-music-vol" type="range" min="0" max="1" step="0.05" title="音量">
    </div>
    <label class="mp-music-upload">
      <input type="file" multiple>
      <span class="mp-music-upload-text">＋ 上傳音樂／字幕</span>
    </label>
    <div class="mp-music-mig">
      <label class="mp-lib-btn mp-music-import" title="匯入 .mplib 搬家檔">
        匯入音樂庫<input type="file" accept=".mplib" hidden>
      </label>
      <button class="mp-music-export" title="把整個音樂庫存成一個 .mplib 檔，可以匯入另一個擴充功能">匯出音樂庫</button>
    </div>
    <div class="mp-music-status"></div>
  `;

  const q = (s) => root.querySelector(s);
  const artEl = q('.mp-music-art');
  const titleEl = q('.mp-music-title');
  const albumEl = q('.mp-music-album');
  const seekEl = q('.mp-music-seek');
  const posEl = q('.mp-music-pos');
  const durEl = q('.mp-music-dur');
  const playBtn = q('.mp-music-play');
  const shuffleBtn = q('.mp-music-shuffle');
  const repeatBtn = q('.mp-music-repeat');
  const ccBtn = q('.mp-music-cc');
  const volEl = q('.mp-music-vol');
  const fileEl = q('.mp-music-upload input');
  const uploadText = q('.mp-music-upload-text');
  const statusEl = q('.mp-music-status');
  fileEl.accept = ACCEPT;

  const library = createLibraryView({ on, ...(confirm ? { confirm } : {}) });
  root.appendChild(library.el);

  let seeking = false;
  let volumeDragging = false;
  let artKey = null;

  const api = {
    el: root,
    get visible() { return !root.hidden; },

    show() {
      root.hidden = false;
      scheduleMarquees(root);   // 收起時量不到寬度，打開後重量
    },
    hide() { root.hidden = true; },

    setStatus(text) { statusEl.textContent = text || ''; },

    /** @param {object} s player 的 snapshot 加上 view（面板正在看的範圍） */
    render(s) {
      const lib = { tracks: s.tracks, albums: s.albums };
      const cur = s.tracks.find((t) => t.id === s.currentId);
      const album = albumOfTrack(lib, cur);
      titleEl.textContent = cur ? trackTitle(cur) : '還沒選歌';
      const albumText = cur ? (album ? album.name : '未分類') : '';
      if (albumEl.dataset.mq !== albumText) {
        setMarqueeText(albumEl, albumText);
        scheduleMarquees(albumEl.parentNode);
      }
      const key = album ? `${album.id}|${album.name}|${album.cover}` : '';
      if (key !== artKey) {
        artKey = key;
        artEl.replaceChildren(coverEl(album, 'mp-music-artimg'));
      }

      playBtn.textContent = s.paused ? '▶' : '⏸';
      root.classList.toggle('playing', !s.paused);

      seekEl.disabled = !cur;
      seekEl.max = String(s.duration || 0);
      if (!seeking) {
        seekEl.value = String(s.time || 0);
        posEl.textContent = formatTime(s.time);
      }
      durEl.textContent = formatTime(s.duration);

      shuffleBtn.classList.toggle('active', !!s.shuffle);
      shuffleBtn.title = s.shuffle ? '隨機播放：開' : '隨機播放：關';
      const rep = REPEAT_LABEL[s.repeat] || REPEAT_LABEL.all;
      repeatBtn.textContent = rep.icon;
      repeatBtn.title = rep.title;
      ccBtn.classList.toggle('active', !!s.captions);
      if (!volumeDragging) volEl.value = String(s.volume);

      uploadText.textContent = s.view === ALL || s.view === undefined
        ? '＋ 上傳音樂／字幕'
        : `＋ 上傳到「${scopeLabel(lib, s.view)}」`;

      library.render(s);
    },
  };

  q('.mp-music-hide').addEventListener('click', () => on.hide());
  root.querySelectorAll('.mp-music-ctrl button').forEach((b) => {
    b.addEventListener('click', () => on[b.dataset.a]());
  });

  q('.mp-music-export').addEventListener('click', () => on.exportLib());
  const importEl = q('.mp-music-import input');
  importEl.addEventListener('change', () => {
    const file = importEl.files[0];
    importEl.value = '';
    if (file) on.importLib(file);
  });

  seekEl.addEventListener('input', () => {
    seeking = true;
    posEl.textContent = formatTime(seekEl.value);
  });
  seekEl.addEventListener('change', () => {
    seeking = false;
    on.seek(Number(seekEl.value));
  });

  volEl.addEventListener('input', () => { volumeDragging = true; on.volume(Number(volEl.value)); });
  volEl.addEventListener('change', () => { volumeDragging = false; });

  fileEl.addEventListener('change', () => {
    const files = [...fileEl.files];
    fileEl.value = '';   // 清掉，同一批檔案才能再選一次
    if (files.length) on.upload(files);
  });

  root.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    root.classList.add('dragover');
  });
  root.addEventListener('dragleave', (e) => {
    if (!root.contains(e.relatedTarget)) root.classList.remove('dragover');
  });
  root.addEventListener('drop', (e) => {
    root.classList.remove('dragover');
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) on.upload(files);
  });

  return api;
}
