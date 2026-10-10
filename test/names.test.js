import { describe, it, expect } from 'vitest';
import {
  fileKind, audioStem, subtitleStem, cleanSubtitleName, trackTitle, audioMimeFor, planUpload, ACCEPT,
} from '../src/music/names.js';

const f = (name) => ({ name });

describe('fileKind', () => {
  it('認得 wav / mp3 音檔與 vtt 字幕，大小寫不拘', () => {
    expect(fileKind('a.wav')).toBe('audio');
    expect(fileKind('a.MP3')).toBe('audio');
    expect(fileKind('a.wav.vtt')).toBe('subtitle');
    expect(fileKind('a.VTT')).toBe('subtitle');
  });

  it('其他檔案與沒有副檔名的檔案不收', () => {
    expect(fileKind('a.txt')).toBeNull();
    expect(fileKind('wav')).toBeNull();
    expect(fileKind('.vtt')).toBeNull();
  });

  it('accept 列出所有支援的副檔名', () => {
    expect(ACCEPT).toContain('.wav');
    expect(ACCEPT).toContain('.mp3');
    expect(ACCEPT).toContain('.vtt');
  });
});

describe('檔名清理', () => {
  it('字幕 xxx.wav.vtt 顯示成 xxx.vtt', () => {
    expect(cleanSubtitleName('01_おやすみ.wav.vtt')).toBe('01_おやすみ.vtt');
    expect(cleanSubtitleName('track.mp3.vtt')).toBe('track.vtt');
  });

  it('本來就是 xxx.vtt 的保持不變', () => {
    expect(cleanSubtitleName('track.vtt')).toBe('track.vtt');
  });

  it('檔名中間的點不是音檔副檔名時不亂砍', () => {
    expect(cleanSubtitleName('vol.2 part.1.vtt')).toBe('vol.2 part.1.vtt');
    expect(subtitleStem('vol.2.wav.vtt')).toBe('vol.2');
  });

  it('曲目標題是音檔名去掉副檔名', () => {
    expect(audioStem('a.b.wav')).toBe('a.b');
    expect(trackTitle({ audioName: '雨音.mp3' })).toBe('雨音');
  });

  it('依副檔名推測 MIME', () => {
    expect(audioMimeFor('a.wav')).toBe('audio/wav');
    expect(audioMimeFor('a.mp3')).toBe('audio/mpeg');
    expect(audioMimeFor('a.xyz')).toBe('');
  });
});

describe('planUpload', () => {
  it('xxx.wav 和 xxx.wav.vtt 配成一首', () => {
    const wav = f('a.wav');
    const vtt = f('a.wav.vtt');
    const plan = planUpload([vtt, wav]);
    expect(plan.newTracks).toEqual([{ audio: wav, subtitle: vtt }]);
    expect(plan.orphans).toEqual([]);
  });

  it('xxx.vtt 也能配到 xxx.mp3', () => {
    const mp3 = f('a.mp3');
    const vtt = f('a.vtt');
    expect(planUpload([mp3, vtt]).newTracks).toEqual([{ audio: mp3, subtitle: vtt }]);
  });

  it('同主檔名有 wav 與 mp3 時，xxx.wav.vtt 配給完全同名的 wav', () => {
    const mp3 = f('a.mp3');
    const wav = f('a.wav');
    const vtt = f('a.wav.vtt');
    const plan = planUpload([mp3, wav, vtt]);
    expect(plan.newTracks.find((t) => t.audio === wav).subtitle).toBe(vtt);
    expect(plan.newTracks.find((t) => t.audio === mp3).subtitle).toBeNull();
  });

  it('沒有字幕的音檔照樣加入', () => {
    const wav = f('a.wav');
    expect(planUpload([wav]).newTracks).toEqual([{ audio: wav, subtitle: null }]);
  });

  it('只傳字幕時補到音樂庫裡既有的曲目', () => {
    const vtt = f('a.wav.vtt');
    const plan = planUpload([vtt], [{ id: 7, audioName: 'a.wav' }]);
    expect(plan.newTracks).toEqual([]);
    expect(plan.attach).toEqual([{ trackId: 7, subtitle: vtt }]);
  });

  it('找不到音檔的字幕列為孤兒', () => {
    const vtt = f('b.wav.vtt');
    expect(planUpload([vtt], [{ id: 1, audioName: 'a.wav' }]).orphans).toEqual([vtt]);
  });

  it('音樂庫已有同名音檔時不重複加入，但一起傳的字幕仍會補上', () => {
    const wav = f('a.wav');
    const vtt = f('a.wav.vtt');
    const plan = planUpload([wav, vtt], [{ id: 3, audioName: 'a.wav' }]);
    expect(plan.newTracks).toEqual([]);
    expect(plan.duplicates).toEqual([wav]);
    expect(plan.attach).toEqual([{ trackId: 3, subtitle: vtt }]);
  });

  it('同一批裡重複的音檔只收一次', () => {
    const plan = planUpload([f('a.wav'), f('a.wav')]);
    expect(plan.newTracks).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(1);
  });

  it('不支援的檔案列為略過', () => {
    const txt = f('readme.txt');
    expect(planUpload([txt]).ignored).toEqual([txt]);
  });

  it('配對不分大小寫，也不受 Mac 的 NFD 檔名影響', () => {
    const wav = f('ガ.WAV');                         // NFC
    const vtt = f('ガ.wav.vtt'.normalize('NFD'));     // Mac 傳來的會是拆開的濁音
    expect(planUpload([wav, vtt]).newTracks[0].subtitle).toBe(vtt);
  });
});
