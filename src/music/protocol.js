/**
 * content script 與音樂庫頁面（library.html）之間的握手約定。
 *
 * library.html 是 web_accessible_resource，X 的頁面腳本也能自己開一個 iframe 來連。
 * 所以 content script 先把一次性 token 寫進 chrome.storage（頁面腳本讀不到），
 * 音樂庫只接受帶著同一個 token 的連線。
 */
export const LIBRARY_PAGE = 'library.html';
export const CONNECT_TYPE = 'mp-music-connect';
export const TOKEN_KEY = 'mpMusicToken';

/**
 * 每個 token 一個鍵：所有網頁共用同一個 chrome.storage，
 * 同時有兩個分頁在連線時，共用一個鍵會互相蓋掉對方的 token。
 */
export const tokenKey = (token) => `${TOKEN_KEY}:${token}`;
