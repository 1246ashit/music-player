/**
 * 追蹤用的 log：兩個世界（頁面世界與 content script）都印到同一個 DevTools Console，
 * 在 Console 的篩選欄輸入 [MP] 就能只看這個擴充功能的紀錄。
 *
 * 預設開啟；要關掉就在 Console 執行：
 *   localStorage.setItem('mp-log', 'off')
 * 兩個世界共用同一個網域的 localStorage，所以一個開關就能兩邊一起關。
 */
export const LOG_PREFIX = '[MP]';
export const LOG_SWITCH_KEY = 'mp-log';

function enabledByDefault() {
  try { return globalThis.localStorage.getItem(LOG_SWITCH_KEY) !== 'off'; } catch (_) { return true; }
}

/**
 * 物件先轉成文字再印：Console 的「複製」與「Save as」會把物件折疊成 {…}，
 * 貼給別人看時內容就不見了。
 */
function toText(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

/**
 * @param {string} scope 哪個模組在說話，例如 'like'、'like-api'
 * @param {{sink?:{info:Function}, isEnabled?:()=>boolean}} [opts]
 * @returns {(...args:any[])=>void}
 */
export function createLogger(scope, { sink = console, isEnabled = enabledByDefault } = {}) {
  const tag = `${LOG_PREFIX}[${scope}]`;
  return (...args) => {
    if (!isEnabled()) return;
    const t = new Date().toISOString().slice(11, 23);   // 時:分:秒.毫秒，方便看先後與耗時
    sink.info([`${tag} ${t}`, ...args.filter((a) => a !== '').map(toText)].join(' '));
  };
}

/** 不印任何東西的 logger，給沒有注入 log 的地方當預設。 */
export const silent = () => {};
