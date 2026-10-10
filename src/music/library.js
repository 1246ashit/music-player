/**
 * 音樂庫的整理方式（純資料）：專輯分組、播放範圍、拖曳排序後的新順序。
 *
 * 「範圍」（scope）同時用在「正在看哪裡」與「從哪裡開始播」：
 * `'all'` 全部、`'unsorted'` 未分類，或專輯的 id（數字）。
 */

export const ALL = 'all';
export const UNSORTED = 'unsorted';

const byOrder = (a, b) => a.order - b.order || a.id - b.id;

export function sortedAlbums(albums) {
  return [...albums].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

/** 指到不存在的專輯（例如剛被刪掉）的歌，一律當成未分類。 */
function isUnsorted(track, albumIds) {
  return track.albumId == null || !albumIds.has(track.albumId);
}

/**
 * 依專輯分組：專輯照建立順序，未分類放最後；空的專輯也列出來。
 * @returns {Array<{album:object|null, tracks:object[]}>} album 為 null 的是未分類
 */
export function groupByAlbum({ tracks, albums }) {
  const ids = new Set(albums.map((a) => a.id));
  const groups = sortedAlbums(albums).map((album) => ({
    album,
    tracks: tracks.filter((t) => t.albumId === album.id).sort(byOrder),
  }));
  groups.push({ album: null, tracks: tracks.filter((t) => isUnsorted(t, ids)).sort(byOrder) });
  return groups;
}

/** 某個範圍裡的曲目，依播放順序。 */
export function tracksIn(lib, scope) {
  const groups = groupByAlbum(lib);
  if (scope === ALL) return groups.flatMap((g) => g.tracks);
  const g = scope === UNSORTED
    ? groups[groups.length - 1]
    : groups.find((x) => x.album && x.album.id === scope);
  return g ? g.tracks : [];
}

export function scopeExists(lib, scope) {
  return scope === ALL || scope === UNSORTED || lib.albums.some((a) => a.id === scope);
}

export function findAlbum(lib, id) {
  return lib.albums.find((a) => a.id === id) || null;
}

/** 曲目所屬的專輯；未分類回 null。 */
export function albumOfTrack(lib, track) {
  return track ? findAlbum(lib, track.albumId) : null;
}

export function scopeLabel(lib, scope) {
  if (scope === ALL) return '全部';
  if (scope === UNSORTED) return '未分類';
  const a = findAlbum(lib, scope);
  return a ? a.name : '';
}

/** 上傳到這個範圍時，新歌該放進哪張專輯（全部與未分類都是 null）。 */
export function albumIdForScope(scope) {
  return typeof scope === 'number' ? scope : null;
}

/**
 * 把 id 拖到 targetId 的前面或後面，回傳新的順序。
 * @param {Array} ids 目前順序
 */
export function moveId(ids, id, targetId, after = false) {
  if (id === targetId) return ids.slice();
  const rest = ids.filter((x) => x !== id);
  const i = rest.indexOf(targetId);
  if (i < 0) return ids.slice();
  rest.splice(after ? i + 1 : i, 0, id);
  return rest;
}
