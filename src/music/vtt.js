/**
 * WebVTT 台詞檔解析。只取時間與文字：播放器只需要知道「現在該顯示哪句」，
 * 位置、樣式這類 cue 設定一律忽略。
 */

// 時間戳：時可省略；小數點容忍逗號（有些工具把 SRT 直接改副檔名）
const TIME = '(?:(\\d+):)?(\\d{1,2}):(\\d{2})[.,](\\d{1,3})';
const TIMING = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}`);

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '', '&rlm;': '' };

function seconds(h, m, s, ms) {
  return (Number(h) || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/** 拿掉 <v 說話者>、<i>、<c.class>、<00:00:01.000> 這類標籤，還原實體字元。 */
function cleanText(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (m) => ENTITIES[m])
    .trim();
}

/**
 * @param {string} text .vtt 檔內容
 * @returns {Array<{start:number, end:number, text:string}>} 依開始時間排序
 */
export function parseVtt(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const cues = [];
  let cur = null;

  const flush = () => {
    if (cur) {
      const t = cleanText(cur.lines.join('\n'));
      if (t) cues.push({ start: cur.start, end: cur.end, text: t });
    }
    cur = null;
  };

  lines.forEach((line) => {
    if (!line.trim()) { flush(); return; }
    const m = TIMING.exec(line);
    if (m) {
      flush();
      cur = { start: seconds(m[1], m[2], m[3], m[4]), end: seconds(m[5], m[6], m[7], m[8]), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
    // 其他（WEBVTT 標頭、NOTE、STYLE、cue 編號）都不在 cue 內，直接略過
  });
  flush();

  return cues.sort((a, b) => a.start - b.start);
}

/** 某個時間點該顯示的字幕；重疊的 cue 依序換行並列，沒有就回空字串。 */
export function cueAt(cues, time) {
  const hits = [];
  for (const c of cues) {
    if (c.start > time) break;
    if (time < c.end) hits.push(c.text);
  }
  return hits.join('\n');
}
