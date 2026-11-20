# collection（收藏整理）— 給 Claude 的工作準則

用 `E:\reze-helper` 的骨架開的純前端工具。骨架的規則照 `docs/`（UI 準則、同步、危險區…）。

## 架構

- 三種收藏寫死：衣服（clothes）、書（books）、代購（proxy）。欄位定義在 `js/model.js` 的 `KINDS`，**要改欄位就改這裡**。
  欄位代號（f1、f2…）是舊資料的對應，不要改號、不要重用；拿掉欄位時舊值會留在 data 裡，不影響。
- `js/model.js`：資料規則（金額換算、日期、網址、篩選、分組、合計、整批改匯率、舊資料轉換）。**改規則一定補 `test/model.test.mjs`。**
- `js/app.js`：只負責畫面。路由 `#clothes`、`#books`、`#proxy`、`#settings`，分頁列固定。
- `js/db.js` 的 `SCHEMA`：`items`（kind、name、data JSON、note）和 `settings`。舊版的 `collections` 表已停用（sheetId 2 退休），
  開網站時 `migrateLocal()` 會把舊的本機資料轉成新版；匯入舊版備份也會轉。
- 單選欄位：`fixed` 只能選；`chips` 是最近用過的快速按鈕（✕ 隱藏的記在 settings `hidden.<kind>.<key>`）；其他的選項＝寫死的基本選項＋物品上出現過的值。
- 代購的批次是備註裡的 #標籤；結清的批次記在 settings `closed.proxy`。
- 同步：共用的 only-for-me 用戶端、`SHEET_MODE: 'pick'`（自己選表），見 `docs/cloud-sync.md`。
- 金額存 `{ a: 原幣金額, c: 幣別, r: 匯率 }`，台幣由 `moneyTWD` 算；各幣別上次用的匯率存在 settings `rate.<幣別>`。
- `tools/convert-csv.mjs`：一次性把舊試算表的 CSV 轉成備份檔／加入檔（測試 `test/convert.test.mjs`）。

## 一定要遵守

- 用繁體中文、白話；UI 照 `docs/ui-guidelines.md`；改完 `node --test` 全過，UI 改了跑 `tools/shot.mjs` 看電腦＋手機截圖。
- **真實資料不進 git**：CSV、轉出來的備份檔都在 `REALDATA/`（gitignore）。測試、範例、截圖腳本只用假資料。
- commit 前先問使用者。
