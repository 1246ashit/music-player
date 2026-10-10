import { describe, it, expect } from 'vitest';
import {
  ALL, UNSORTED, groupByAlbum, tracksIn, scopeExists, albumOfTrack, scopeLabel, albumIdForScope, moveId, sortedAlbums,
} from '../src/music/library.js';

const t = (id, albumId, order) => ({ id, albumId, order });
const LIB = {
  albums: [
    { id: 20, name: '後建的', createdAt: 2 },
    { id: 10, name: '先建的', createdAt: 1 },
    { id: 30, name: '空的', createdAt: 3 },
  ],
  tracks: [t(1, null, 5), t(2, 10, 1), t(3, 10, 0), t(4, 20, 0), t(5, null, 1), t(6, 404, 0)],
};

describe('groupByAlbum', () => {
  it('專輯照建立順序、組內照 order，未分類放最後', () => {
    const groups = groupByAlbum(LIB);
    expect(groups.map((g) => g.album && g.album.id)).toEqual([10, 20, 30, null]);
    expect(groups[0].tracks.map((x) => x.id)).toEqual([3, 2]);
    expect(groups[2].tracks).toEqual([]);
  });

  it('指到不存在專輯的歌算未分類', () => {
    expect(groupByAlbum(LIB).at(-1).tracks.map((x) => x.id)).toEqual([6, 5, 1]);
  });
});

describe('tracksIn', () => {
  it('全部 = 各組依序接起來', () => {
    expect(tracksIn(LIB, ALL).map((x) => x.id)).toEqual([3, 2, 4, 6, 5, 1]);
  });

  it('單一專輯、未分類、不存在的專輯', () => {
    expect(tracksIn(LIB, 10).map((x) => x.id)).toEqual([3, 2]);
    expect(tracksIn(LIB, UNSORTED).map((x) => x.id)).toEqual([6, 5, 1]);
    expect(tracksIn(LIB, 999)).toEqual([]);
  });
});

describe('其他', () => {
  it('scopeExists', () => {
    expect(scopeExists(LIB, ALL)).toBe(true);
    expect(scopeExists(LIB, UNSORTED)).toBe(true);
    expect(scopeExists(LIB, 20)).toBe(true);
    expect(scopeExists(LIB, 404)).toBe(false);
  });

  it('albumOfTrack 與 scopeLabel', () => {
    expect(albumOfTrack(LIB, LIB.tracks[1]).name).toBe('先建的');
    expect(albumOfTrack(LIB, LIB.tracks[0])).toBeNull();
    expect(albumOfTrack(LIB, undefined)).toBeNull();
    expect(scopeLabel(LIB, ALL)).toBe('全部');
    expect(scopeLabel(LIB, UNSORTED)).toBe('未分類');
    expect(scopeLabel(LIB, 20)).toBe('後建的');
  });

  it('上傳到全部或未分類時不放進專輯', () => {
    expect(albumIdForScope(ALL)).toBeNull();
    expect(albumIdForScope(UNSORTED)).toBeNull();
    expect(albumIdForScope(10)).toBe(10);
  });

  it('sortedAlbums 不改原陣列', () => {
    const src = LIB.albums.slice();
    expect(sortedAlbums(src).map((a) => a.id)).toEqual([10, 20, 30]);
    expect(src).toEqual(LIB.albums);
  });
});

describe('moveId', () => {
  it('拖到目標前面或後面', () => {
    expect(moveId([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
    expect(moveId([1, 2, 3, 4], 1, 3, true)).toEqual([2, 3, 1, 4]);
    expect(moveId([1, 2, 3, 4], 1, 4, true)).toEqual([2, 3, 4, 1]);
  });

  it('拖到自己身上或目標不存在時不變', () => {
    expect(moveId([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 2, 9)).toEqual([1, 2, 3]);
  });
});
