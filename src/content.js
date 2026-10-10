/* 音樂播放器 - content script 進入點
 * 在任何網頁上放一顆浮動按鈕，點開音樂面板；音檔存在擴充功能自己的音樂庫，
 * 所有網站共用同一個，也不受網站 CSP 影響（見 music/frame.js）。
 */
import { createSettings } from './settings.js';
import { createMusicBox } from './ui/musicbox.js';
import { injectLaunchButton } from './ui/chrome.js';
import { connectLibraryFrame } from './music/frame.js';
import { createLogger } from './log.js';

const BUTTON_RECHECK_MS = 3000;

/** 輸入文字時的 Alt+M 不攔，免得干擾打字。 */
function isTyping(target) {
  return !!(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
}

async function start() {
  const settings = createSettings(chrome.storage.local);
  await settings.load();
  // 設定的寫入會稍微延後合併；離開頁面時把還沒寫的補寫掉
  window.addEventListener('pagehide', () => settings.flush());

  let launchBtn = null;
  const music = createMusicBox({
    connect: (parent) => connectLibraryFrame(parent, {
      storage: chrome.storage.local,
      getURL: (path) => chrome.runtime.getURL(path),
      log: createLogger('music'),
    }),
    settings: settings.values,
    updateSettings: (patch) => settings.update(patch),
    onStatus: ({ visible, playing }) => {
      if (!launchBtn) return;
      launchBtn.classList.toggle('active', visible);
      launchBtn.classList.toggle('playing', playing);
    },
    log: createLogger('music'),
  });

  // 單頁應用程式可能重繪 body，按鈕不見時補回來，並沿用使用者拖到的位置
  const ensureButton = () => {
    const btn = injectLaunchButton(() => music.toggle(), {
      position: settings.values.launchPos,
      onMove: (pos) => settings.update({ launchPos: pos }),
    });
    if (btn) {
      launchBtn = btn;
      btn.classList.toggle('active', music.visible);
      btn.classList.toggle('playing', music.playing);
    }
  };
  ensureButton();
  setInterval(ensureButton, BUTTON_RECHECK_MS);

  // 用 code 比對，開著中文輸入法也能用
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (isTyping(e.target)) return;
    e.preventDefault();
    music.toggle();
  }, true);
}

// 沒有 body 的文件（例如瀏覽器內建的 PDF 檢視）沒有地方放按鈕
if (!window.__musicPlayerLoaded && document.body) {
  window.__musicPlayerLoaded = true;
  start();
}
