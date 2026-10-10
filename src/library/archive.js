/**
 * 音樂庫的搬家檔（.mplib）：把整個音樂庫包成單一檔案，換到另一個擴充功能時匯入。
 *
 * IndexedDB 綁在擴充功能的來源上，新舊兩個擴充功能互相讀不到，只能經過檔案。
 * 格式：魔術字串 + 4 位元組標頭長度 + 標頭 JSON + 依序串起來的音檔。
 * 音檔用 Blob 拼接、讀的時候用 slice，幾百 MB 的 wav 不必整份讀進記憶體。
 */

export const ARCHIVE_EXT = '.mplib';
const MAGIC = 'MPLIB1\n';
const VERSION = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param {object} deps
 * @param {Array} deps.tracks 曲目資訊（依播放順序）
 * @param {Array} deps.albums
 * @param {(id:number)=>Promise<Blob|null>} deps.getAudio
 * @param {(id:number)=>Promise<string|null>} deps.getSubtitle
 * @returns {Promise<Blob>}
 */
export async function buildArchive({ tracks, albums, getAudio, getSubtitle }) {
  const blobs = [];
  const entries = [];
  for (const t of tracks) {
    const audio = await getAudio(t.id);
    if (!audio) continue;   // 資料庫裡少了音檔就沒東西可搬
    blobs.push(audio);
    entries.push({
      audioName: t.audioName,
      audioType: t.audioType || audio.type || '',
      size: audio.size,
      subtitleName: t.subtitleName || null,
      subtitleText: await getSubtitle(t.id),
      albumKey: t.albumId == null ? null : t.albumId,
    });
  }
  const header = encoder.encode(JSON.stringify({
    version: VERSION,
    albums: albums.map((a) => ({ key: a.id, name: a.name, cover: a.cover || null, createdAt: a.createdAt })),
    tracks: entries,
  }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, header.length);
  return new Blob([MAGIC, len, header, ...blobs], { type: 'application/octet-stream' });
}

/**
 * @param {Blob} file
 * @returns {Promise<{albums:Array, tracks:Array<{audio:Blob}>}>} 曲目已依搬家檔裡的順序排好
 */
export async function parseArchive(file) {
  const magicLen = MAGIC.length;
  const head = new Uint8Array(await file.slice(0, magicLen + 4).arrayBuffer());
  if (head.length < magicLen + 4 || decoder.decode(head.subarray(0, magicLen)) !== MAGIC) {
    throw new Error('這不是音樂庫搬家檔');
  }
  const headerLen = new DataView(head.buffer).getUint32(magicLen);
  const start = magicLen + 4;
  if (start + headerLen > file.size) throw new Error('搬家檔不完整');
  let meta;
  try {
    meta = JSON.parse(decoder.decode(new Uint8Array(await file.slice(start, start + headerLen).arrayBuffer())));
  } catch (_) {
    throw new Error('搬家檔的標頭壞了');
  }
  if (meta.version !== VERSION) throw new Error('搬家檔的版本不支援');

  let offset = start + headerLen;
  const tracks = meta.tracks.map((t) => {
    const audio = file.slice(offset, offset + t.size, t.audioType || undefined);
    offset += t.size;
    return { ...t, audio };
  });
  if (offset > file.size) throw new Error('搬家檔不完整，音檔被截斷了');
  return { albums: meta.albums, tracks };
}
