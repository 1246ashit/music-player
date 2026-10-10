import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connectLibraryFrame, RELOAD_NEEDED } from '../src/music/frame.js';
import { serve } from '../src/music/channel.js';
import { CONNECT_TYPE, tokenKey } from '../src/music/protocol.js';

beforeEach(() => { document.body.innerHTML = ''; });

const URL_ = 'chrome-extension://abc/library.html';
const tick = () => new Promise((r) => setTimeout(r, 0));
// 沒掛進文件的 iframe 在 jsdom 裡沒有 contentWindow
const mount = () => document.body.appendChild(document.createElement('div'));

function deps(overrides = {}) {
  return {
    storage: { set: vi.fn(async () => {}) },
    getURL: vi.fn(() => URL_),
    createToken: () => 'tok',
    timeoutMs: 50,
    ...overrides,
  };
}

/** 等 iframe 掛上去後，模擬音樂庫頁面：收下握手、開始服務，再觸發 load。 */
async function actAsLibrary(parent, handlers = { hello: () => true }) {
  await tick();
  const frame = parent.querySelector('iframe');
  const received = [];
  frame.contentWindow.postMessage = vi.fn((data, origin, ports) => {
    received.push({ data, origin });
    serve(ports[0], handlers);
  });
  frame.dispatchEvent(new Event('load'));
  return { frame, received };
}

describe('connectLibraryFrame', () => {
  it('先寫好 token 再開 iframe，握手時帶著 token 並指定擴充功能的來源', async () => {
    const parent = mount();
    const d = deps();
    const pending = connectLibraryFrame(parent, d);
    const { frame, received } = await actAsLibrary(parent);
    const conn = await pending;

    expect(d.storage.set).toHaveBeenCalledWith({ [tokenKey('tok')]: true });
    expect(frame.getAttribute('src')).toBe(URL_);
    expect(frame.getAttribute('allow')).toBe('autoplay');
    expect(received).toEqual([{ data: { type: CONNECT_TYPE, token: 'tok' }, origin: 'chrome-extension://abc' }]);
    await expect(conn.client.request('hello')).resolves.toBe(true);
  });

  it('destroy 會移除 iframe 並關掉連線', async () => {
    const parent = mount();
    const pending = connectLibraryFrame(parent, deps());
    await actAsLibrary(parent);
    const conn = await pending;
    conn.destroy();
    expect(parent.querySelector('iframe')).toBeNull();
    await expect(conn.client.request('hello')).rejects.toThrow();
  });

  it('iframe 一直沒載入就逾時，並清掉 iframe', async () => {
    const parent = mount();
    await expect(connectLibraryFrame(parent, deps())).rejects.toThrow('逾時');
    expect(parent.querySelector('iframe')).toBeNull();
  });

  it('音樂庫拒絕連線（不回應）時也會逾時並清掉', async () => {
    const parent = mount();
    const pending = connectLibraryFrame(parent, deps());
    await tick();
    const frame = parent.querySelector('iframe');
    frame.contentWindow.postMessage = vi.fn();   // 收下但不服務，像 token 不符
    frame.dispatchEvent(new Event('load'));
    await expect(pending).rejects.toThrow('沒有回應');
    expect(parent.querySelector('iframe')).toBeNull();
  });

  it('擴充功能被重新載入過（舊分頁）時，提示重新整理頁面，也不會留下 iframe', async () => {
    const parent = mount();
    const storage = { set: vi.fn(async () => { throw new Error('Extension context invalidated.'); }) };
    const err = await connectLibraryFrame(parent, deps({ storage })).catch((e) => e);
    expect(err.name).toBe(RELOAD_NEEDED);
    expect(err.message).toContain('重新整理');
    expect(parent.querySelector('iframe')).toBeNull();
  });

  it('其他錯誤照原樣丟出', async () => {
    const parent = mount();
    const storage = { set: vi.fn(async () => { throw new Error('QUOTA'); }) };
    await expect(connectLibraryFrame(parent, deps({ storage }))).rejects.toThrow('QUOTA');
  });
});
