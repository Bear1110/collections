# Google 試算表同步

資料存在**使用者自己的** Google 雲端硬碟裡的一份試算表。沒有後端、沒有資料庫，網站只能碰它自己建的那份檔案。
程式在 `template/js/db.js`（本機資料）、`template/js/cloud/`（auth、sheets、sync）。

## 運作方式

1. **本機優先**：每次修改立刻存進 localStorage，並記成「待同步」（pending）。沒網路、沒登入都能用。
2. **同步**（修改後 2 秒、每 5 分鐘、回到前景、按「立即同步」）：
   讀試算表全部分頁 → 疊上這台的待同步修改（以列為單位，最後寫入者勝；刪除也算修改）→ 跟試算表不一樣的分頁寫回去 → 合併結果存回本機。
3. **一張表一個分頁**，第一列是欄位名稱。欄位**依標題名稱**對應，所以使用者在試算表裡調欄位順序、多加自己的欄位都沒關係。
4. 找試算表：建立時在 Drive 檔案上加 `appProperties`（`config.js` 的 `APP_PROPERTY`），之後用它搜尋，不靠檔名（使用者可以改名）。

## 新增資料表或欄位

- 在 `db.js` 的 `SCHEMA` 加。欄位型別：`int`、`real`、`text`、`nint`（選填的 id，非正整數一律 null）。
- `sheetId` 是試算表分頁的固定編號：**只能新增、不能改號、不能重用**。停用的表把編號放進 `RETIRED_SHEET_IDS`（試算表裡可能還留著那個分頁）。`sheets.js` 會檢查。
- 新欄位直接加，不用 migration：舊的列讀進來時缺的欄位會套 `defaults`。
- `synced: false` 的表只存在這台裝置（快取、UI 狀態）。

## 第一次設定（每個專案一次）

1. [Google Cloud Console](https://console.cloud.google.com/) → 建立專案（名稱隨意）。
2. 「API 和服務 → 程式庫」啟用 **Google Sheets API** 和 **Google Drive API**。
3. 「OAuth 同意畫面」：
   - 使用者類型：外部
   - 範圍：`drive.file`、`openid`、`userinfo.email`（`drive.file` 只能碰網站自己建的檔案，不用 Google 審查）
   - 發布狀態：自己和少數人用就停在「**測試中**」，把要用的 Google 帳號加為「測試使用者」（最多 100 個）。
     測試中的限制：登入時會看到「Google 尚未驗證這個應用程式」，按「繼續」即可。
4. 「憑證 → 建立憑證 → OAuth 用戶端 ID」→ 網頁應用程式。**已授權的 JavaScript 來源**填：
   - `http://localhost:8020`（本機，`start.bat` 的網址）
   - 正式網址，例如 `https://<帳號>.github.io` 或 `https://<名稱>.<帳號>.workers.dev`
   - 只填 origin：**不要結尾斜線、不要路徑**（GitHub Pages 的 `/repo名/` 不用填）
   - 「已授權的重新導向 URI」不用填（token model 用彈窗）
5. 把用戶端 ID 填進 `js/config.js` 的 `CLIENT_ID`。**用戶端 ID 不是機密**，可以 commit。
6. 改完 origin 要等幾分鐘才生效；在那之前登入會出現 `origin_mismatch`。

## 踩過的坑

| 現象 | 原因／解法 |
| --- | --- |
| 按登入沒反應／彈窗被擋 | `requestToken()` 前面有 `await`。必須在點擊事件裡同步呼叫（`ACTIONS['sign-in']`、`onSyncPillClick`） |
| `origin_mismatch` | 授權來源沒加這個網址，或多了結尾斜線，或剛改完還沒生效 |
| `access_denied` | 帳號不在「測試使用者」名單 |
| 一小時後要重新登入 | token model 沒有 refresh token，權杖最多 1 小時。狀態變「需要重新連線」（黃），點右上角就重新登入；資料先存在本機，不會丟 |
| 空白欄位同步回來變成預設值 | 文字欄位的空字串要保留成 `''`，只有「欄位不存在」才套預設（`db.coerce`，有測試） |
| 寫入失敗 `exceeds the maximum`… | 一格最多 50,000 字元。大圖（logo）要先壓縮（color-picker 壓到 40k 以下）；`sheets.js` 的 `MAX_CELL` 會擋 |
| 數字變日期／前導 0 不見 | 讀取用 `UNFORMATTED_VALUE`，寫入 `RAW`；依 `SCHEMA` 型別轉回 |
| 兩台同時改同一列 | 最後寫入者勝（以列為單位）。需要更細的合併（例如帳務）就別讓兩台改同一列：已結帳的資料鎖住 |
| 試算表被使用者手動刪掉 | 下次同步找不到，會建一份新的，並把這台的資料全部標成待同步上傳 |

## CSP

`index.html` 的 Content-Security-Policy 需要：
`script-src https://accounts.google.com/gsi/client`、`connect-src https://sheets.googleapis.com https://www.googleapis.com https://accounts.google.com/gsi/`、`frame-src https://accounts.google.com/gsi/`。
新增其他外部連線（例如匯率 API）要加在 `connect-src`。
