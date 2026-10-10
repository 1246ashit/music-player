import { vi } from 'vitest';

/** 一對會互相轉送的假連線埠（非同步送達，跟真的 MessagePort 一樣）。 */
export function fakePorts() {
  const make = () => ({
    onmessage: null,
    peer: null,
    close: vi.fn(),
    postMessage(data) {
      const peer = this.peer;
      queueMicrotask(() => { if (peer.onmessage) peer.onmessage({ data }); });
    },
  });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
