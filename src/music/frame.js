/**
 * 在網頁裡開一個看不見的音樂庫 iframe（擴充功能自己的頁面），並建立私下連線。
 *
 * 音檔存在擴充功能自己的 IndexedDB、也在那裡播放：
 * 不佔該網站的儲存空間、清網站資料也不會被清掉，也不受該網站 CSP 的限制，各網站共用同一個音樂庫。
 */
import { createClient } from './channel.js';
import { LIBRARY_PAGE, CONNECT_TYPE, tokenKey } from './protocol.js';
import { silent } from '../log.js';

export const CONNECT_TIMEOUT_MS = 8000;
export const RELOAD_NEEDED = 'ExtensionReloaded';
export const RELOAD_MSG = '擴充功能剛更新過，請重新整理這個頁面（F5）再開音樂';

/**
 * 在 chrome://extensions 重新載入擴充功能後，已開著的分頁還在跑舊的 content script，
 * 它的 chrome.* 全部失效，呼叫時丟「Extension context invalidated」。只能重新整理頁面。
 */
function reloadNeeded(err) {
  if (!/Extension context invalidated/i.test((err && err.message) || '')) return err;
  const e = new Error(RELOAD_MSG);
  e.name = RELOAD_NEEDED;
  return e;
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 有些環境對非標準 scheme 的 URL.origin 回 'null'，自己組比較保險。 */
function originOf(url) {
  const u = new URL(url);
  return u.origin !== 'null' ? u.origin : `${u.protocol}//${u.host}`;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {Element} parent iframe 要掛在哪裡；它被移除時音樂也跟著停
 * @param {object} deps
 * @param {{set:(obj:object)=>Promise<void>}} deps.storage chrome.storage.local
 * @param {(path:string)=>string} deps.getURL chrome.runtime.getURL
 * @returns {Promise<{client:ReturnType<typeof createClient>, destroy:()=>void}>}
 */
export async function connectLibraryFrame(parent, {
  storage,
  getURL,
  createToken = randomToken,
  timeoutMs = CONNECT_TIMEOUT_MS,
  log = silent,
}) {
  const token = createToken();
  let src;
  try {
    await storage.set({ [tokenKey(token)]: true });
    src = getURL(LIBRARY_PAGE);
  } catch (err) {
    throw reloadNeeded(err);
  }

  const frame = parent.ownerDocument.createElement('iframe');
  frame.className = 'mp-music-frame';
  // 使用者是在 X 頁面上按播放，要把自動播放權限交給 iframe，不然 play() 會被擋
  frame.setAttribute('allow', 'autoplay');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.src = src;
  parent.appendChild(frame);

  let client = null;
  const destroy = () => {
    if (client) client.close();
    frame.remove();
  };

  try {
    await withTimeout(loaded, timeoutMs, '音樂庫載入逾時');
    const { port1, port2 } = new MessageChannel();
    client = createClient(port1);
    // 指定 targetOrigin：iframe 若被換成別的網址，連線埠不會送錯人
    frame.contentWindow.postMessage({ type: CONNECT_TYPE, token }, originOf(src), [port2]);
    await withTimeout(client.request('hello'), timeoutMs, '音樂庫沒有回應');
    log('音樂庫已連線');
    return { client, destroy };
  } catch (err) {
    destroy();
    throw err;
  }
}
