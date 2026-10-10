/* 音樂播放器 - 音樂庫頁面（library.html）的進入點
 * 以看不見的 iframe 開在網頁裡：音檔存在擴充功能自己的 IndexedDB，也在這裡播放。
 */
import { createTrackStore } from './store.js';
import { createLibraryService } from './service.js';
import { createGate } from './gate.js';
import { createLogger } from '../log.js';

const log = createLogger('music-lib');
const audio = new Audio();
audio.preload = 'auto';

const service = createLibraryService({ store: createTrackStore(indexedDB), audio, log });

window.addEventListener('message', createGate({
  storage: chrome.storage.local,
  onAccept: (port) => service.attach(port),
  log,
}));
