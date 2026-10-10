/**
 * 隨機播放的洗牌佇列：一輪裡每首都播到一次才重洗，不會連續抽到同一首；
 * 記得抽過的順序，「上一首」才回得去。
 */

/** Fisher–Yates，回傳新陣列。 */
export function shuffled(ids, random = Math.random) {
  const out = ids.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** @param {{random?:()=>number}} [opts] */
export function createShuffleQueue({ random = Math.random } = {}) {
  let bag = [];
  let pos = -1;   // 目前播到 bag 的哪一格；-1 表示還沒開始

  return {
    get current() { return pos >= 0 ? bag[pos] : null; },
    get order() { return bag.slice(); },

    /** 重新洗牌；有給 firstId 就讓它排第一個並視為正在播。 */
    reset(ids, firstId = null) {
      const has = firstId != null && ids.includes(firstId);
      bag = shuffled(ids.filter((id) => id !== firstId), random);
      if (has) bag.unshift(firstId);
      pos = has ? 0 : -1;
    },

    /**
     * 範圍裡的歌變了（上傳、刪除、移動）：留下來的維持原本順序，
     * 新的隨機插在還沒播到的位置。
     */
    sync(ids) {
      const set = new Set(ids);
      const before = bag.slice(0, pos + 1).filter((id) => set.has(id));
      const after = bag.slice(pos + 1).filter((id) => set.has(id));
      const known = new Set(bag);
      shuffled(ids.filter((id) => !known.has(id)), random).forEach((id) => {
        after.splice(Math.floor(random() * (after.length + 1)), 0, id);
      });
      bag = before.concat(after);
      pos = before.length - 1;
    },

    /** 使用者自己點了某首：從它繼續往下抽，已抽過的不動。 */
    moveTo(id) {
      const i = bag.indexOf(id);
      if (i < 0 || i === pos) return;
      bag.splice(i, 1);
      if (i < pos) pos -= 1;
      bag.splice(pos + 1, 0, id);
      pos += 1;
    },

    /** @param {{wrap?:boolean}} [opts] wrap：一輪播完要不要重洗再來 */
    next({ wrap = true } = {}) {
      if (pos + 1 < bag.length) return bag[++pos];
      if (!wrap || !bag.length) return null;
      const last = bag[pos];
      bag = shuffled(bag, random);
      // 新的一輪別從剛播完的那首開始
      if (bag.length > 1 && bag[0] === last) [bag[0], bag[1]] = [bag[1], bag[0]];
      pos = 0;
      return bag[0];
    },

    prev() {
      return pos > 0 ? bag[--pos] : null;
    },
  };
}
