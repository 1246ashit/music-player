/**
 * 音檔與字幕檔的檔名處理：判斷種類、配對、顯示用的乾淨名稱。
 *
 * 字幕檔常見兩種命名：`xxx.wav.vtt`（整個音檔名後面接 .vtt，轉字幕工具的預設）
 * 與 `xxx.vtt`。兩種都要能配到 `xxx.wav`，顯示時一律清成 `xxx.vtt`。
 */

export const AUDIO_EXTS = ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus'];
export const SUBTITLE_EXT = 'vtt';

/** <input type=file> 的 accept。 */
export const ACCEPT = [...AUDIO_EXTS, SUBTITLE_EXT].map((e) => '.' + e).join(',');

const MIME = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
};

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** @returns {'audio'|'subtitle'|null} */
export function fileKind(name) {
  const ext = extOf(name);
  if (ext === SUBTITLE_EXT) return 'subtitle';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  return null;
}

export function audioMimeFor(name) {
  return MIME[extOf(name)] || '';
}

/** `xxx.wav` → `xxx` */
export function audioStem(name) {
  return stripExt(name);
}

/** `xxx.wav.vtt` 與 `xxx.vtt` → `xxx` */
export function subtitleStem(name) {
  const stem = stripExt(name);
  return AUDIO_EXTS.includes(extOf(stem)) ? stripExt(stem) : stem;
}

/** 顯示用：`xxx.wav.vtt` → `xxx.vtt` */
export function cleanSubtitleName(name) {
  return `${subtitleStem(name)}.${SUBTITLE_EXT}`;
}

/** 曲目標題：音檔名去掉副檔名。 */
export function trackTitle(track) {
  return audioStem(track.audioName);
}

/**
 * Mac 存的日文／中文檔名是 NFD（濁音符號拆開），Windows 是 NFC；
 * 不先正規化的話，看起來同名的檔案會配不起來。
 */
function norm(name) {
  return name.normalize('NFC').toLowerCase();
}

/**
 * 一次上傳的檔案要怎麼進音樂庫。
 * 字幕先找「完全同名的音檔」（`xxx.wav.vtt` → `xxx.wav`），再找同主檔名的；
 * 這批新上傳的音檔優先於音樂庫裡既有的。
 *
 * @param {Array<{name:string}>} files
 * @param {Array<{id:any, audioName:string}>} tracks 音樂庫裡已有的曲目
 */
export function planUpload(files, tracks = []) {
  const plan = { newTracks: [], attach: [], duplicates: [], orphans: [], ignored: [] };
  const existing = new Map(tracks.map((t) => [norm(t.audioName), t.id]));
  const byName = new Map();
  const byStem = new Map();
  const index = (name, target) => {
    if (!byName.has(norm(name))) byName.set(norm(name), target);
    const stem = norm(audioStem(name));
    if (!byStem.has(stem)) byStem.set(stem, target);
  };

  const subtitles = [];
  files.forEach((f) => {
    const kind = fileKind(f.name);
    if (kind === 'subtitle') { subtitles.push(f); return; }
    if (kind !== 'audio') { plan.ignored.push(f); return; }
    const key = norm(f.name);
    if (existing.has(key)) {
      plan.duplicates.push(f);
      index(f.name, { trackId: existing.get(key) });
    } else if (byName.has(key)) {
      plan.duplicates.push(f);
    } else {
      const entry = { audio: f, subtitle: null };
      plan.newTracks.push(entry);
      index(f.name, { entry });
    }
  });
  tracks.forEach((t) => index(t.audioName, { trackId: t.id }));

  const attach = new Map();
  subtitles.forEach((sub) => {
    const target = byName.get(norm(stripExt(sub.name))) || byStem.get(norm(subtitleStem(sub.name)));
    if (!target) plan.orphans.push(sub);
    else if (target.entry) target.entry.subtitle = sub;
    else attach.set(target.trackId, sub);
  });
  attach.forEach((subtitle, trackId) => plan.attach.push({ trackId, subtitle }));

  return plan;
}
