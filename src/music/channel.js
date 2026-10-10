/**
 * MessagePort 上的一問一答與事件推送：content script（UI）↔ 擴充功能的音樂庫頁面。
 *
 * 用 MessageChannel 私下連線而不是 window.postMessage：
 * 後者會被 X 自己的頁面腳本收到，音樂庫的內容不該讓它看見。
 */
import { silent } from '../log.js';

export const CLOSED_MSG = '音樂庫連線已關閉';

/**
 * @param {MessagePort} port
 * @returns {{request:(op:string, args?:object)=>Promise<any>, on:(event:string, cb:Function)=>()=>void, close:()=>void}}
 */
export function createClient(port) {
  let seq = 0;
  let closed = false;
  const pending = new Map();
  const listeners = new Map();

  port.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.event) {
      (listeners.get(msg.event) || []).slice().forEach((cb) => cb(msg.data));
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) { p.resolve(msg.result); return; }
    const err = new Error(msg.error);
    if (msg.name) err.name = msg.name;
    p.reject(err);
  };

  return {
    request(op, args = {}) {
      if (closed) return Promise.reject(new Error(CLOSED_MSG));
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ id, op, args });
      });
    },

    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(cb);
      return () => {
        const arr = listeners.get(event) || [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      };
    },

    close() {
      if (closed) return;
      closed = true;
      pending.forEach((p) => p.reject(new Error(CLOSED_MSG)));
      pending.clear();
      listeners.clear();
      try { port.close(); } catch (_) {}
    },
  };
}

/**
 * @param {MessagePort} port
 * @param {Object<string, (args:object)=>any>} handlers 可以是 async
 * @returns {{emit:(event:string, data?:any)=>void}}
 */
export function serve(port, handlers, { log = silent } = {}) {
  port.onmessage = async (e) => {
    const { id, op, args } = e.data || {};
    if (id === undefined) return;
    try {
      const h = Object.prototype.hasOwnProperty.call(handlers, op) ? handlers[op] : null;
      if (!h) throw new Error(`未知的操作：${op}`);
      port.postMessage({ id, ok: true, result: await h(args || {}) });
    } catch (err) {
      log(`${op} 失敗`, err);
      port.postMessage({ id, ok: false, error: (err && err.message) || String(err), name: err && err.name });
    }
  };
  return { emit: (event, data) => port.postMessage({ event, data }) };
}
