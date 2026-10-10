import { describe, it, expect } from 'vitest';
import { shuffled, createShuffleQueue } from '../src/music/shuffle.js';

const IDS = [1, 2, 3, 4, 5];
const sorted = (arr) => [...arr].sort((a, b) => a - b);

describe('shuffled', () => {
  it('回傳同一批元素的新陣列，不改原陣列', () => {
    const src = IDS.slice();
    const out = shuffled(src);
    expect(sorted(out)).toEqual(IDS);
    expect(src).toEqual(IDS);
  });
});

describe('createShuffleQueue', () => {
  it('reset 指定第一首時它排第一個並視為正在播', () => {
    const q = createShuffleQueue();
    q.reset(IDS, 3);
    expect(q.current).toBe(3);
    expect(q.order[0]).toBe(3);
    expect(sorted(q.order)).toEqual(IDS);
  });

  it('沒指定第一首時 next 從頭抽', () => {
    const q = createShuffleQueue();
    q.reset(IDS);
    expect(q.current).toBeNull();
    expect(IDS).toContain(q.next());
  });

  it('一輪抽完每首剛好一次', () => {
    const q = createShuffleQueue();
    q.reset(IDS);
    const got = IDS.map(() => q.next());
    expect(sorted(got)).toEqual(IDS);
  });

  it('一輪抽完：wrap 時重洗且不會從剛播完的那首開始；不 wrap 就停', () => {
    for (let n = 0; n < 20; n++) {
      const q = createShuffleQueue();
      q.reset(IDS);
      let lastId;
      IDS.forEach(() => { lastId = q.next(); });
      expect(q.next()).not.toBe(lastId);
    }
    const q = createShuffleQueue();
    q.reset([1]);
    q.next();
    expect(q.next({ wrap: false })).toBeNull();
  });

  it('只有一首時 wrap 還是那首', () => {
    const q = createShuffleQueue();
    q.reset([7], 7);
    expect(q.next()).toBe(7);
  });

  it('prev 沿著抽過的順序往回，到第一首就停', () => {
    const q = createShuffleQueue();
    q.reset(IDS);
    const a = q.next();
    const b = q.next();
    q.next();
    expect(q.prev()).toBe(b);
    expect(q.prev()).toBe(a);
    expect(q.prev()).toBeNull();
  });

  it('moveTo 讓點選的那首成為正在播，之後照原本的洗牌順序繼續', () => {
    const q = createShuffleQueue({ random: () => 0 });
    q.reset([1, 2, 3, 4]);
    const order = q.order;
    q.next();
    q.moveTo(order[3]);
    expect(q.current).toBe(order[3]);
    expect(q.next()).toBe(order[1]);
    expect(q.next()).toBe(order[2]);
  });

  it('moveTo 已經播過的那首也不會亂掉目前位置', () => {
    const q = createShuffleQueue();
    q.reset(IDS);
    const a = q.next();
    q.next();
    q.moveTo(a);
    expect(q.current).toBe(a);
    expect(sorted(q.order)).toEqual(IDS);
  });

  it('sync：刪掉的拿掉、新的插在還沒播的位置，已播的不動', () => {
    const q = createShuffleQueue();
    q.reset([1, 2, 3], 1);
    const cur = q.current;
    q.sync([1, 3, 8, 9]);
    expect(q.current).toBe(cur);
    expect(q.order[0]).toBe(1);
    expect(sorted(q.order)).toEqual([1, 3, 8, 9]);
  });

  it('sync：正在播的被刪掉時，下一首接著還沒播的', () => {
    const q = createShuffleQueue({ random: () => 0 });
    q.reset([1, 2, 3], 2);
    const rest = q.order.slice(1);
    q.sync([1, 3]);
    expect(q.next()).toBe(rest[0]);
  });
});
