import { describe, it, expect } from 'vitest';
import { parseVtt, cueAt } from '../src/music/vtt.js';

const SAMPLE = [
  'WEBVTT',
  'Kind: captions',
  '',
  'NOTE 這是註解',
  '不會出現在字幕裡',
  '',
  '1',
  '00:00:01.000 --> 00:00:03.500 align:center',
  'おはよう',
  '',
  '00:04.000 --> 00:06.000',
  '<v 姉>今日も</v>',
  '<i>いい天気</i> &amp; 晴れ',
  '',
].join('\n');

describe('parseVtt', () => {
  it('解析時間與文字，忽略標頭、NOTE、cue 編號與 cue 設定', () => {
    expect(parseVtt(SAMPLE)).toEqual([
      { start: 1, end: 3.5, text: 'おはよう' },
      { start: 4, end: 6, text: '今日も\nいい天気 & 晴れ' },
    ]);
  });

  it('支援時數與 CRLF 換行、BOM', () => {
    const text = '﻿WEBVTT\r\n\r\n01:00:00.500 --> 01:00:02.000\r\nhi\r\n';
    expect(parseVtt(text)).toEqual([{ start: 3600.5, end: 3602, text: 'hi' }]);
  });

  it('容忍小數點寫成逗號、毫秒位數不足', () => {
    expect(parseVtt('00:00:01,5 --> 00:00:02,25\nx')).toEqual([{ start: 1.5, end: 2.25, text: 'x' }]);
  });

  it('空字幕與沒有時間的區塊略過', () => {
    expect(parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i></i>\n\nSTYLE\n::cue {}')).toEqual([]);
  });

  it('依開始時間排序', () => {
    const cues = parseVtt('00:00:05.000 --> 00:00:06.000\nb\n\n00:00:01.000 --> 00:00:02.000\na');
    expect(cues.map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('沒有內容時回傳空陣列', () => {
    expect(parseVtt('')).toEqual([]);
    expect(parseVtt(null)).toEqual([]);
  });
});

describe('cueAt', () => {
  const cues = parseVtt(SAMPLE);

  it('回傳該時間點的字幕', () => {
    expect(cueAt(cues, 2)).toBe('おはよう');
    expect(cueAt(cues, 5)).toBe('今日も\nいい天気 & 晴れ');
  });

  it('兩句之間、結束時間點與範圍外沒有字幕', () => {
    expect(cueAt(cues, 3.5)).toBe('');
    expect(cueAt(cues, 0)).toBe('');
    expect(cueAt(cues, 99)).toBe('');
  });

  it('重疊的字幕一起顯示', () => {
    const overlap = [{ start: 0, end: 5, text: 'a' }, { start: 1, end: 2, text: 'b' }];
    expect(cueAt(overlap, 1.5)).toBe('a\nb');
  });
});
