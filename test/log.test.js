import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from '../src/log.js';

afterEach(() => { localStorage.setItem('mp-log', 'off'); });

describe('createLogger', () => {
  it('加上 [MP][模組] 前綴與時間，方便在 Console 篩選', () => {
    const sink = { info: vi.fn() };
    createLogger('like', { sink, isEnabled: () => true })('hello', { a: 1 });
    expect(sink.info.mock.calls[0][0]).toMatch(/^\[MP\]\[like\] \d{2}:\d{2}:\d{2}\.\d{3} hello \{"a":1\}$/);
  });

  it('整行都是純文字，複製出來不會變成 {…}；錯誤印出訊息', () => {
    const sink = { info: vi.fn() };
    createLogger('like', { sink, isEnabled: () => true })('結果', { postId: '1', liked: true }, '', new Error('boom'));
    const line = sink.info.mock.calls[0][0];
    expect(sink.info.mock.calls[0]).toHaveLength(1);
    expect(line).toContain('{"postId":"1","liked":true}');
    expect(line).toContain('boom');
  });

  it('關掉時不印', () => {
    const sink = { info: vi.fn() };
    createLogger('like', { sink, isEnabled: () => false })('hello');
    expect(sink.info).not.toHaveBeenCalled();
  });

  it('預設看 localStorage 的 mp-log 開關', () => {
    const sink = { info: vi.fn() };
    localStorage.setItem('mp-log', 'on');
    createLogger('like', { sink })('a');
    localStorage.setItem('mp-log', 'off');
    createLogger('like', { sink })('b');
    expect(sink.info).toHaveBeenCalledTimes(1);
  });
});
