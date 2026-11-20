# 架構

純前端、沒有後端、沒有 build。瀏覽器直接載入 ES modules。

```
index.html            導覽列、CSP、#page（畫面）、#modal（共用的 <dialog>）、#toast-container
css/style.css         全部樣式（finance-watcher 深色主題）
js/config.js          APP_ID、APP_NAME、CLIENT_ID（★ 開新專案改這裡）
js/db.js              本機資料：SCHEMA（★ 改這裡）、localStorage、待同步、合併、備份
js/cloud/auth.js      Google 登入（GIS token model）
js/cloud/sheets.js    Google Sheets / Drive API
js/cloud/sync.js      同步排程與狀態（右上角 sync-pill 讀這個）
js/aiimport.js        AI 匯入的共用部分
js/ui.js              畫面元件（圖示、訊息、視窗、按鈕組、表單、確認、列印）
js/update.js          偵測新版本
js/app.js             畫面與事件（★ 換成你的功能）
test/                 node --test
```

## 原則

- **畫面和規則分開**：計算、商業規則放獨立模組（例如 color-picker 的 `calc.js`、`ledger.js`），有單元測試；`app.js` 只負責畫面。
- **寫入集中**：會影響正確性的寫入（帳務、鎖定）包在一個模組裡（color-picker 的 `shipping.js`），畫面不直接 `db.update` 那些表。
- **存四捨五入後的值、存快照**：單據的金額在產生當下算好存起來，之後規則改了、價格變了，舊單據重印還是一樣。
- **本機優先**：所有操作同步寫進 localStorage，雲端同步在背景。網路斷了照常用。
- **一個 id 規則**：`db.insert` 用時間產生遞增 id，多台裝置同時新增不會撞號。跨裝置辨識列用 `SCHEMA[t].key`（預設 `id`）。
- **事件委派**：所有按鈕 `data-action`，`document` 上一個 click handler 查 `ACTIONS`。CSP 擋 inline script，也讓重畫畫面後不用重新綁事件。
- **路由**：`location.hash`（`#items`、`#customer=12`），`render()` 依 hash 畫頁面。

## 資料流

```
使用者操作 → db.insert/update/remove → localStorage ＋ 記成待同步 → db.onChange → 重畫提醒條、sync-pill
                                                     ↓ 2 秒後
                              sync.syncNow → 讀試算表 → mergeTable → 寫回 → window.appRefresh() 重畫
```

## 本機執行

`start.bat`（雙擊）＝ `python -m http.server 8020 --bind 127.0.0.1`。直接雙擊 `index.html` 是空白頁（瀏覽器不允許從 file:// 載入模組）。
資料綁定網址：一直用同一個網址（`localhost:8020`）打開，換 port 等於換一個空的資料庫。
