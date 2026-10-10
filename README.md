# 音樂播放器

從 X Media Slider 拆出來的獨立 Chrome 擴充功能（MV3）：在任何網頁右下角放一顆 🎵 浮動按鈕，點開音樂面板，
上傳自己的音樂與 `.vtt` 台詞、建專輯、拖曳排序、隨機播放。

## 安裝

```bash
npm install && npm run build   # 產生 dist/
```

到 `chrome://extensions` 開啟「開發人員模式」→「載入未封裝項目」→ 選 `dist/`。

## 使用

- 點 🎵 開關面板（長按可拖曳位置）；`Alt+M` 也可以。收起面板音樂會繼續播。
- 音樂庫存在這個擴充功能自己的 IndexedDB，所有網站共用同一份；每個分頁各自播放（開兩個分頁會同時出聲）。

## 從 X Media Slider 搬音樂庫

1. 舊插件（需是有「匯出音樂庫」按鈕的版本，`npm run build` 後重新載入）：在 x.com 開音樂面板 → 按「匯出音樂庫」，會下載 `music-library-日期.mplib`。
2. 新插件：任一網頁開面板 → 按「匯入音樂庫」→ 選那個檔。專輯、順序、字幕、封面都會帶過來；同名音檔會略過。

## 開發

```bash
npm test
npm run build:watch
```

架構同舊插件的音樂部分：音檔與 `<audio>` 都在擴充功能自己的 `library.html`（隱形 iframe）裡，
content script 透過 `MessageChannel` 遙控；握手 token 以「每個 token 一個鍵」寫進 `chrome.storage.local`，多個分頁同時連線不會互蓋。
