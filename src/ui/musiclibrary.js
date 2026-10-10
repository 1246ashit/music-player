/**
 * 音樂面板裡「瀏覽音樂庫」的部分：上方的專輯列、目前範圍的標頭（播放、改名、封面），
 * 以及曲目清單（拖曳排序、拖到專輯封面上移動）。
 */
import { trackTitle, cleanSubtitleName, extOf } from '../music/names.js';
import {
  ALL, UNSORTED, groupByAlbum, tracksIn, findAlbum, scopeLabel, moveId,
} from '../music/library.js';
import { marqueeText, scheduleMarquees } from './marquee.js';

const DRAG_TYPE = 'text/x-mp-track';

export function formatSize(bytes) {
  const mb = (Number(bytes) || 0) / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;   // 名稱一律當純文字，不進 innerHTML
  return e;
}

function button(className, text, title, onClick) {
  const b = el('button', className, text);
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** 沒有封面時，用專輯名的第一個字配一個固定的顏色，一眼分得出來。 */
function placeholderHue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

/** @param {{cover?:string|null, name:string}|null} album */
export function coverEl(album, className) {
  const box = el('span', `mp-cover ${className || ''}`.trim());
  if (album && album.cover) {
    const img = el('img');
    img.src = album.cover;
    img.alt = '';
    box.appendChild(img);
  } else if (album) {
    box.textContent = [...album.name][0] || '♪';
    box.style.background = `hsl(${placeholderHue(album.name)} 45% 35%)`;
  } else {
    box.textContent = '♪';
  }
  return box;
}

/**
 * @param {object} deps
 * @param {object} deps.on setView, playView, play, createAlbum, renameAlbum, setCover, removeAlbum, move, reorder, remove
 * @param {(msg:string)=>boolean} [deps.confirm]
 */
export function createLibraryView({ on, confirm = (msg) => window.confirm(msg) }) {
  const root = el('div', 'mp-lib');
  const strip = el('div', 'mp-lib-strip');
  const head = el('div', 'mp-lib-head');
  const list = el('ol', 'mp-music-list');
  const empty = el('div', 'mp-music-empty');
  const coverInput = el('input');
  coverInput.type = 'file';
  coverInput.accept = 'image/*';
  coverInput.hidden = true;
  root.append(strip, head, list, empty, coverInput);

  let s = null;             // 最近一次的狀態
  let rendered = null;      // 上次重建時的 tracks/albums/view，沒變就不重建
  let editing = null;       // { kind:'create'|'rename', value }
  let draggingId = null;

  const lib = () => ({ tracks: s.tracks, albums: s.albums });

  // ---- 專輯列 ----

  function tile(scope, label, count, cover) {
    const t = el('button', 'mp-lib-tile');
    t.dataset.scope = String(scope);
    t.title = `${label}（${count} 首）`;
    t.appendChild(cover);
    t.appendChild(marqueeText('span', 'mp-lib-tile-name', label));
    t.addEventListener('click', () => on.setView(scope));
    if (scope !== ALL) {
      // 把歌拖到專輯封面上 = 移進那張專輯
      const albumId = scope === UNSORTED ? null : scope;
      t.addEventListener('dragover', (e) => {
        if (draggingId == null) return;
        e.preventDefault();
        t.classList.add('drop');
      });
      t.addEventListener('dragleave', () => t.classList.remove('drop'));
      t.addEventListener('drop', (e) => {
        t.classList.remove('drop');
        if (draggingId == null) return;
        e.preventDefault();
        e.stopPropagation();
        on.move([draggingId], albumId);
      });
    }
    return t;
  }

  function renderStrip(groups) {
    strip.textContent = '';
    const allIcon = el('span', 'mp-cover mp-cover-all', '♫');
    strip.appendChild(tile(ALL, '全部', s.tracks.length, allIcon));
    groups.filter((g) => g.album).forEach((g) => {
      strip.appendChild(tile(g.album.id, g.album.name, g.tracks.length, coverEl(g.album)));
    });
    const unsorted = groups[groups.length - 1];
    if (s.albums.length && (unsorted.tracks.length || s.view === UNSORTED)) {
      strip.appendChild(tile(UNSORTED, '未分類', unsorted.tracks.length, el('span', 'mp-cover mp-cover-none', '…')));
    }
    const add = button('mp-lib-tile mp-lib-new', '', '建立新專輯', () => startEdit('create', ''));
    add.appendChild(el('span', 'mp-cover mp-cover-add', '＋'));
    add.appendChild(el('span', 'mp-lib-tile-name', '新專輯'));
    strip.appendChild(add);
  }

  // ---- 標頭 ----

  function startEdit(kind, value) {
    editing = { kind, value };
    renderHead();
    const input = head.querySelector('input');
    if (input) { input.focus(); input.select(); }
  }

  function finishEdit(save) {
    const cur = editing;
    editing = null;
    renderHead();
    const name = cur && cur.value.trim();
    if (!save || !name) return;
    if (cur.kind === 'create') on.createAlbum(name);
    else on.renameAlbum(s.view, name);
  }

  function editRow(placeholder, okText) {
    const row = el('div', 'mp-lib-edit');
    const input = el('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.maxLength = 80;
    input.value = editing.value;
    input.addEventListener('input', () => { editing.value = input.value; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
    });
    row.append(
      input,
      button('mp-lib-btn mp-lib-ok', okText, '', () => finishEdit(true)),
      button('mp-lib-btn', '取消', '', () => finishEdit(false)),
    );
    return row;
  }

  function renderHead() {
    head.textContent = '';
    scheduleMarquees(head);
    if (!s) return;
    if (editing && editing.kind === 'create') {
      head.appendChild(el('div', 'mp-lib-title', '新專輯'));
      head.appendChild(editRow('專輯名稱', '建立'));
      return;
    }

    const album = typeof s.view === 'number' ? findAlbum(lib(), s.view) : null;
    const tracks = tracksIn(lib(), s.view);
    const info = el('div', 'mp-lib-info');

    if (album) {
      const cover = coverEl(album, 'mp-lib-cover');
      cover.title = '換封面';
      cover.addEventListener('click', () => coverInput.click());
      head.appendChild(cover);
    }

    if (editing && editing.kind === 'rename') {
      info.appendChild(editRow('專輯名稱', '儲存'));
    } else {
      info.appendChild(marqueeText('div', 'mp-lib-title', scopeLabel(lib(), s.view)));
      const sub = s.view === ALL ? `${tracks.length} 首 · ${s.albums.length} 張專輯` : `${tracks.length} 首`;
      info.appendChild(el('div', 'mp-lib-sub', sub));
    }

    const actions = el('div', 'mp-lib-actions');
    actions.append(
      button('mp-lib-btn mp-lib-play', '▶ 依序播放', '從第一首依序播放', () => on.playView({ shuffle: false })),
      button('mp-lib-btn mp-lib-shuffle', '🔀 隨機播放', '在這個範圍裡隨機播放', () => on.playView({ shuffle: true })),
    );
    if (album && !editing) {
      actions.append(
        button('mp-lib-btn mp-lib-rename', '✎', '改名', () => startEdit('rename', album.name)),
        button('mp-lib-btn mp-lib-setcover', '🖼', '換封面', () => coverInput.click()),
        button('mp-lib-btn mp-lib-delalbum', '🗑', '刪除專輯（歌會移到未分類）', () => {
          if (confirm(`要刪除專輯「${album.name}」嗎？裡面的歌不會刪，會移到未分類。`)) on.removeAlbum(album.id);
        }),
      );
    }
    info.appendChild(actions);
    head.appendChild(info);
  }

  coverInput.addEventListener('change', () => {
    const file = coverInput.files && coverInput.files[0];
    coverInput.value = '';
    if (file && typeof s.view === 'number') on.setCover(s.view, file);
  });

  // ---- 清單 ----

  function moveSelect(track) {
    const sel = el('select', 'mp-music-move');
    sel.title = '移到專輯';
    const opt = (value, text) => { const o = el('option', '', text); o.value = value; return o; };
    sel.appendChild(opt('', '📁'));
    s.albums.forEach((a) => { if (a.id !== track.albumId) sel.appendChild(opt(String(a.id), a.name)); });
    if (track.albumId != null) sel.appendChild(opt('none', '未分類'));
    sel.addEventListener('change', () => {
      const v = sel.value;
      sel.value = '';
      if (v) on.move([track.id], v === 'none' ? null : Number(v));
    });
    return sel;
  }

  function row(track, index, sortable) {
    const li = el('li', 'mp-music-track');
    li.dataset.id = String(track.id);
    li.draggable = true;

    li.appendChild(el('span', 'mp-music-grip', sortable ? '⠿' : ''));
    li.appendChild(el('span', 'mp-music-no', String(index + 1)));

    const pick = el('button', 'mp-music-pick');
    pick.title = '播放這首';
    pick.appendChild(el('span', 'mp-music-name', trackTitle(track)));
    pick.appendChild(el('span', 'mp-music-meta', `${extOf(track.audioName).toUpperCase()} · ${formatSize(track.size)}`));
    pick.appendChild(track.subtitleName
      ? el('span', 'mp-music-sub', `字幕 ${cleanSubtitleName(track.subtitleName)}`)
      : el('span', 'mp-music-sub mp-music-nosub', '無字幕'));
    pick.addEventListener('click', () => on.play(track.id));
    li.appendChild(pick);

    if (s.albums.length) li.appendChild(moveSelect(track));
    li.appendChild(button('mp-music-del', '🗑', '從音樂庫刪除', () => {
      if (confirm(`要從音樂庫刪除「${trackTitle(track)}」嗎？`)) on.remove(track.id);
    }));

    li.addEventListener('dragstart', (e) => {
      draggingId = track.id;
      li.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DRAG_TYPE, String(track.id));
      }
    });
    li.addEventListener('dragend', () => {
      draggingId = null;
      li.classList.remove('dragging');
      list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    });

    if (sortable) {
      const isAfter = (e) => {
        const r = li.getBoundingClientRect();
        return e.clientY > r.top + r.height / 2;
      };
      li.addEventListener('dragover', (e) => {
        if (draggingId == null || draggingId === track.id) return;
        e.preventDefault();
        const after = isAfter(e);
        li.classList.toggle('drop-after', after);
        li.classList.toggle('drop-before', !after);
      });
      li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
      li.addEventListener('drop', (e) => {
        li.classList.remove('drop-before', 'drop-after');
        if (draggingId == null || draggingId === track.id) return;
        e.preventDefault();
        e.stopPropagation();
        const ids = tracksIn(lib(), s.view).map((t) => t.id);
        on.reorder(moveId(ids, draggingId, track.id, isAfter(e)));
      });
    }
    return li;
  }

  function renderList(groups) {
    list.textContent = '';
    if (s.view === ALL) {
      // 全部：依專輯分組列出；排序要進專輯裡拖
      const grouped = s.albums.length > 0;
      let n = 0;
      groups.forEach((g) => {
        if (!g.tracks.length) return;
        if (grouped) list.appendChild(marqueeText('li', 'mp-lib-group', g.album ? g.album.name : '未分類'));
        g.tracks.forEach((t) => list.appendChild(row(t, n++, false)));
      });
    } else {
      tracksIn(lib(), s.view).forEach((t, i) => list.appendChild(row(t, i, true)));
    }

    const hasTracks = list.querySelector('.mp-music-track') !== null;
    empty.hidden = hasTracks;
    empty.textContent = s.view === ALL
      ? '支援 .wav .mp3 與 .vtt 字幕。音檔和字幕一起選（或拖進這裡），同名的會自動配對。'
      : '這裡還沒有歌：在這裡上傳，或把其他歌拖到上面的專輯封面。';
  }

  function markState() {
    list.querySelectorAll('.mp-music-track').forEach((li) => {
      li.classList.toggle('current', li.dataset.id === String(s.currentId));
    });
    strip.querySelectorAll('.mp-lib-tile[data-scope]').forEach((t) => {
      t.classList.toggle('active', t.dataset.scope === String(s.view));
      t.classList.toggle('playing', !s.paused && t.dataset.scope === String(s.scope));
    });
  }

  return {
    el: root,

    /** @param {object} state player 的 snapshot 加上 view */
    render(state) {
      s = state;
      const key = rendered;
      if (!key || key.tracks !== s.tracks || key.albums !== s.albums || key.view !== s.view) {
        // 換到別的範圍就放棄編輯中的改名
        if (key && key.view !== s.view && editing && editing.kind === 'rename') editing = null;
        rendered = { tracks: s.tracks, albums: s.albums, view: s.view };
        const groups = groupByAlbum(lib());
        renderStrip(groups);
        renderHead();
        renderList(groups);
        scheduleMarquees(root);
      }
      markState();
    },
  };
}
