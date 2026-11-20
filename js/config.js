// ★ 開新專案時要改的設定都在這裡。

// 專案代號：英文小寫、不重複。用在 localStorage 的鍵、備份檔格式、AI 匯入格式、找回試算表的標記。
// 同一台電腦的不同專案靠它分開資料，所以每個專案都要不一樣。
export const APP_ID = 'collection';

// 顯示名稱：標題、試算表檔名
export const APP_NAME = '收藏整理';
export const SPREADSHEET_TITLE = `${APP_NAME} 資料`;

// Google 雲端同步（選用）。留空時網站照樣能用，資料只存在這台電腦的瀏覽器。
// 設定方式見 docs/cloud-sync.md。用戶端 ID 本來就會出現在前端，不是機密；
// 真正的保護是 Google Cloud「已授權的 JavaScript 來源」只允許你的網址。
// 共用的「只給自己用」用戶端（only-for-me 專案，見 reze-helper 的 CLAUDE.md）。client_secret 前端用不到，不要放進來。
export const CLIENT_ID = '53507935370-je6hmoco30706c47qrkagjc89t5e7964.apps.googleusercontent.com';

// drive.file：只能存取本網站建立的試算表、和使用者用檔案選擇器選過的試算表（非敏感權限）；openid email：顯示目前登入的帳號
export const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email';

// ★ 同步到哪一份試算表（開新專案時決定，見 docs/cloud-sync.md）：
//   'own'  固定一份：網站自己建立、自己找回，使用者不用選
//   'pick' 自己選：這個網站建立過的表、用檔案選擇器選別份（要 PICKER_API_KEY），或建立新的；
//          一個 Google 帳號可以有好幾份（例如家裡一份、公司一份），每台電腦記住自己選的
export const SHEET_MODE = 'pick';

// Google 檔案選擇器（SHEET_MODE 'pick' 選別份、開別人分享的表）用的 API 金鑰。留空就不顯示「選別份」。
// 跟用戶端 ID 一樣會出現在前端，不是機密；保護靠 Google Cloud 裡的限制：只允許自己的網址、只能呼叫 Google Picker API
export const PICKER_API_KEY = '';

// 標記在試算表的 Drive appProperties 上，用來找回網站建立的那份檔案
export const APP_PROPERTY = { key: APP_ID, value: '1' };
