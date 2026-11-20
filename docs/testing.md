# 測試

## 單元測試

```sh
node --test          # 在專案資料夾裡；不用裝任何套件（Node 22+）
```

- `test/core.test.mjs`：骨架（型別整理、待同步、同步合併、備份、分頁編號、AI 匯入解析）。保留。
- `test/ui.test.mjs`：UI 規則（見 [ui-guidelines.md](ui-guidelines.md)）。新增畫面檔案要加進它的 `FILES`。
- 你的規則（計算、帳務、匯入配對）每條都要有測試，**只用假資料**。改計算一定補測試再跑。
- 測試裡要用 `db` 時先 `db._reset({ 表: [...] })`，不會碰到 localStorage。

## 畫面截圖（UI 改完一定跑）

```sh
python -m http.server 8765 --bind 127.0.0.1                 # 另開一個視窗，在專案資料夾裡
node tools/shot.mjs shots http://localhost:8765/ "#items" "#settings"
```

- 用無頭 Edge（Windows）／Chrome，每頁截電腦 1280 寬（`d-*.png`）和手機 390 寬（`m-*.png`）。
- 最後印出「手機有沒有左右捲動」和畫面上的 console error；有錯誤時 exit code 1。
- **自己打開截圖看**。
- 要點按鈕、填表單：複製 `tools/shot.mjs`，在 ★ 那段用 `evalJS()` 操作，例如：

```js
await evalJS(`document.querySelector('[data-action=new-item]').click()`);
await evalJS(`(() => { const f = document.querySelector('#modal form'); f.elements.name.value = '測試'; f.requestSubmit(); })()`);
await shot('d-after-add', false);
console.log(await evalJS(`(async () => (await import('/js/db.js')).count('items'))()`));
```

- 列印版面：CDP 的 `Page.printToPDF` 可以輸出 PDF 檢查（color-picker 用來核對單據）。
- 截圖資料夾不要 commit（裡面可能有資料）。
