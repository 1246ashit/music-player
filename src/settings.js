/** 使用者設定：預設值、載入、寫回 chrome.storage。 */

export const DEFAULTS = {
  launchPos: null,     // 啟動按鈕被拖曳過的位置 {left, top}；null 用 CSS 預設
  musicVolume: 0.8,    // 音樂音量 0~1
  musicTrackId: null,  // 上次播的曲目（音樂庫的 id），重開時選回來
  musicRepeat: 'all',  // all：循環全部 | one：單曲循環
  musicCaptions: true, // 顯示 .vtt 台詞
  musicShuffle: false, // 隨機播放
  musicScope: 'all',   // 播放範圍：'all' | 'unsorted' | 專輯 id
  musicView: 'all',    // 面板上正在看的範圍，同上
};

function normalize(patch) {
  const out = { ...patch };
  if ('musicVolume' in out) {
    const v = Number(out.musicVolume);
    out.musicVolume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULTS.musicVolume;
  }
  return out;
}

/** 連續改值（拖音量滑桿一秒幾十次）時，等停下來這麼久才寫一次儲存空間。 */
export const WRITE_DELAY_MS = 300;

/**
 * 改值在記憶體裡立刻生效；寫進儲存空間則合併成一次，離開頁面前要呼叫 flush() 補寫。
 *
 * @param {{get:Function,set:Function}} storage chrome.storage.local 或等價物
 */
export function createSettings(storage, {
  writeDelayMs = WRITE_DELAY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  const values = { ...DEFAULTS };
  let pending = null;

  function write() {
    pending = null;
    try { storage.set({ ...values }); } catch (_) {}
  }

  return {
    values,

    load() {
      return new Promise((resolve) => {
        try {
          storage.get(DEFAULTS, (v) => {
            Object.assign(values, DEFAULTS, v || {});
            resolve();
          });
        } catch (_) {
          resolve();
        }
      });
    },

    update(patch) {
      Object.assign(values, normalize(patch));
      if (pending !== null) clearTimer(pending);
      pending = setTimer(write, writeDelayMs);
      return values;
    },

    /** 還沒寫進儲存空間的改動馬上寫掉。 */
    flush() {
      if (pending === null) return;
      clearTimer(pending);
      write();
    },
  };
}
