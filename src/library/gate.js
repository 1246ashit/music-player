/**
 * 音樂庫頁面的門口：只放行帶著正確一次性 token 的連線（見 music/protocol.js）。
 */
import { CONNECT_TYPE, tokenKey } from '../music/protocol.js';
import { silent } from '../log.js';

/**
 * @param {object} deps
 * @param {{get:Function, remove:Function}} deps.storage chrome.storage.local（Promise 風格）
 * @param {(port:MessagePort)=>void} deps.onAccept
 * @returns {(e:MessageEvent)=>Promise<boolean>} 掛在 window 的 message 事件上
 */
export function createGate({ storage, onAccept, log = silent }) {
  let busy = false;
  let accepted = false;

  return async function handleMessage(e) {
    const port = e.ports && e.ports[0];
    if (!port || !e.data || e.data.type !== CONNECT_TYPE) return false;
    // 一個 iframe 只服務一個頁面；重複的連線一律拒絕
    if (busy || accepted) { port.close(); return false; }
    busy = true;
    try {
      const token = e.data.token;
      const key = typeof token === 'string' && token ? tokenKey(token) : null;
      const saved = key ? (await storage.get(key))[key] : null;
      if (!saved) {
        log('連線 token 不符，拒絕');
        port.close();
        return false;
      }
      await storage.remove(key);   // 用過即丟，別人拿到舊的也連不進來
      accepted = true;
      onAccept(port);
      return true;
    } finally {
      busy = false;
    }
  };
}
