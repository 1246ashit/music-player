import { describe, it, expect, vi } from 'vitest';
import { createClient, serve, CLOSED_MSG } from '../src/music/channel.js';
import { fakePorts } from './fakeports.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('request / serve', () => {
  it('把結果送回對應的請求', async () => {
    const [a, b] = fakePorts();
    serve(b, { add: ({ x, y }) => x + y });
    await expect(createClient(a).request('add', { x: 1, y: 2 })).resolves.toBe(3);
  });

  it('支援 async handler，多個請求各自對應', async () => {
    const [a, b] = fakePorts();
    serve(b, { echo: async ({ v }) => v });
    const client = createClient(a);
    expect(await Promise.all([client.request('echo', { v: 1 }), client.request('echo', { v: 2 })])).toEqual([1, 2]);
  });

  it('handler 丟錯時請求被拒絕，並保留錯誤名稱', async () => {
    const [a, b] = fakePorts();
    serve(b, { play: () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; } });
    const err = await createClient(a).request('play').catch((e) => e);
    expect(err.message).toBe('no');
    expect(err.name).toBe('NotAllowedError');
  });

  it('未知的操作回報錯誤，也不會誤用原型上的屬性', async () => {
    const [a, b] = fakePorts();
    serve(b, {});
    const client = createClient(a);
    await expect(client.request('nope')).rejects.toThrow('nope');
    await expect(client.request('toString')).rejects.toThrow('toString');
  });
});

describe('事件', () => {
  it('emit 的事件送到 on 的監聽者，取消後不再收到', async () => {
    const [a, b] = fakePorts();
    const server = serve(b, {});
    const client = createClient(a);
    const cb = vi.fn();
    const off = client.on('state', cb);
    server.emit('state', { t: 1 });
    await flush();
    expect(cb).toHaveBeenCalledWith({ t: 1 });
    off();
    server.emit('state', { t: 2 });
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('close', () => {
  it('拒絕還在等的請求，之後的請求直接失敗', async () => {
    const [a, b] = fakePorts();
    serve(b, { slow: () => new Promise(() => {}) });
    const client = createClient(a);
    const pending = client.request('slow');
    client.close();
    await expect(pending).rejects.toThrow(CLOSED_MSG);
    await expect(client.request('slow')).rejects.toThrow(CLOSED_MSG);
    expect(a.close).toHaveBeenCalled();
  });
});
