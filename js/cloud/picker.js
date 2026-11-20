// Google 檔案選擇器（Picker）：SHEET_MODE 'pick' 時選別份試算表（自己的、或別人分享的）。
//
// 網站的權限是 drive.file，只看得到自己建立的檔案；使用者在這裡選過的檔案，
// Google 才會開放給網站存取（要 setAppId，而且是同一個 Cloud 專案）。
// Picker 是 iframe，不是彈窗，不用在點擊事件裡同步呼叫。來源：color-picker。

import { CLIENT_ID, PICKER_API_KEY, APP_NAME } from '../config.js';

const LOADER = 'https://apis.google.com/js/api.js';
const CLOUD_PROJECT = CLIENT_ID.split('-')[0]; // Cloud 專案編號

let loading = null;

export const pickerAvailable = () => !!(CLIENT_ID && PICKER_API_KEY);

function loadPicker() {
  loading ??= new Promise((resolve, reject) => {
    const done = () => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('picker_load_failed')) });
    if (window.gapi) return done();
    const s = document.createElement('script');
    s.src = LOADER;
    s.onload = done;
    s.onerror = () => reject(new Error('picker_load_failed'));
    document.head.append(s);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

/** 讓使用者選一份試算表。回傳檔案 id；取消回傳 null。 */
export async function pickSpreadsheet(token) {
  await loadPicker();
  const { picker } = window.google;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
      .setMode(picker.DocsViewMode.LIST)
      .setIncludeFolders(false);
    new picker.PickerBuilder()
      .setAppId(CLOUD_PROJECT)
      .setOAuthToken(token)
      .setDeveloperKey(PICKER_API_KEY)
      .setLocale('zh-TW')
      .setTitle(`選擇「${APP_NAME}」的資料表`)
      .addView(view)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
