import { describe, it, expect, vi } from 'vitest';
import { createGate } from '../src/library/gate.js';
import { CONNECT_TYPE, tokenKey } from '../src/music/protocol.js';

function fakeStorage(token) {
  const data = token ? { [tokenKey(token)]: true } : {};
  return {
    get: vi.fn(async (key) => (key in data ? { [key]: data[key] } : {})),
    remove: vi.fn(async (key) => { delete data[key]; }),
  };
}

const port = () => ({ close: vi.fn() });
const connect = (token, p = port()) => ({ data: { type: CONNECT_TYPE, token }, ports: [p] });

describe('createGate', () => {
  it('token 相符就接受連線，並把 token 用掉', async () => {
    const storage = fakeStorage('secret');
    const onAccept = vi.fn();
    const gate = createGate({ storage, onAccept });
    const p = port();
    expect(await gate(connect('secret', p))).toBe(true);
    expect(onAccept).toHaveBeenCalledWith(p);
    expect(storage.remove).toHaveBeenCalledWith(tokenKey('secret'));
  });

  it('token 不符就關掉連線埠', async () => {
    const onAccept = vi.fn();
    const gate = createGate({ storage: fakeStorage('secret'), onAccept });
    const p = port();
    expect(await gate(connect('guess', p))).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(p.close).toHaveBeenCalled();
  });

  it('儲存空間裡沒有 token 時一律拒絕（包括空 token）', async () => {
    const onAccept = vi.fn();
    const gate = createGate({ storage: fakeStorage(null), onAccept });
    expect(await gate(connect(undefined))).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('已經接受過一條連線後，後來的都拒絕', async () => {
    const onAccept = vi.fn();
    const gate = createGate({ storage: fakeStorage('secret'), onAccept });
    await gate(connect('secret'));
    const p = port();
    expect(await gate(connect('secret', p))).toBe(false);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(p.close).toHaveBeenCalled();
  });

  it('不是握手訊息的一律忽略', async () => {
    const onAccept = vi.fn();
    const gate = createGate({ storage: fakeStorage('secret'), onAccept });
    expect(await gate({ data: { type: 'other' }, ports: [port()] })).toBe(false);
    expect(await gate({ data: { type: CONNECT_TYPE, token: 'secret' }, ports: [] })).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
