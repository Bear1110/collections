# UI／UX 準則

來源是 finance-watcher（調最多的那個）。`template/css/style.css` 和 `template/js/ui.js` 就是這些規則的實作，
`template/test/ui.test.mjs` 會自動檢查其中幾條。

## 版面

- **導覽列**：左邊 logo＋名稱，中間分頁（`<a class="tab-btn" href="#頁面">` ＋ `<span class="tab-icon" data-icon="…">`），右邊同步狀態。
  手機（< 600px）分頁自動變成**底部分頁列**，不用另外寫。分頁最多 5 個，再多就把次要的收進「設定」或頁面裡的子分頁。
- **右上角同步狀態（sync-pill）**：雲朵圖示表示狀態，寬螢幕加文字（「已同步」「待同步 · 3」），手機只有圖示＋待同步筆數。
  顏色：已同步綠、待同步／同步中藍（同步中會閃）、需要重新連線黃、失敗紅、本機／未登入灰。
  點它：過期或未登入 → 直接跳 Google 登入；其他 → 到設定頁。滑鼠移上去（手機點一下）看詳細與錯誤訊息。
- **提醒條**（`#banner`）：頁面最上面，一次只放一則，有優先順序（新版本 > 登入過期 > 資料只在這台電腦）。
- 每頁最重要的數字要在**手機第一個畫面**就看得到；教學說明用 `guide()`（`<details>`）預設收起。
- 斷點：手機 < 600、平板 600–899、電腦 ≥ 900。手機上表格在卡片裡左右滑、第一欄固定；整頁**不能**左右捲（`tools/shot.mjs` 會檢查）。

## 卡片標題列（`.card-header`）

```
┌──────────────────────────────────────────────────────────┐
│ ▤ 標題 ⓘ 狀態小字            [切換][篩選] [次要按鈕] [主要按鈕] │  ← .card-header
│ 這張卡是什麼、怎麼用的一行說明                                │  ← p.form-hint.card-hint
│ 內容…                                                     │
│ 內容下方的補充（選用）                                       │  ← p.form-hint.chart-note
```

- **左邊是 `<h3>`**：前面可加 `icon('名稱')`；名詞定義、公式用 `info('說明文字')`（ⓘ，滑鼠移上去或手機點一下顯示）；
  會變的狀態（筆數、日期區間、更新時間）放 h3 裡的 `<small class="card-meta">`。
- **右邊只放控制項**，包在 `<div class="header-actions">`。不放說明文字（測試會擋）。
- **按鈕順序**：切換／篩選 → 次要（`btn btn-outline btn-sm`）→ 主要（`btn btn-primary btn-sm`，**一張卡最多一個，放最右**）。
  AI 匯入是 outline 按鈕加 `sparkles` 圖示。
- **說明行**：標題列正下方 `<p class="form-hint card-hint">`；不要用 inline `style` 調間距，也不要自創 `xxx-hint` class（測試會擋）。

## 元件（`js/ui.js`）

| 要做的事 | 用 |
| --- | --- |
| 圖示 | `<span data-icon="名稱">`（`applyIcons`）、`icon('名稱')`（文字前的小圖示）、`svgIcon('名稱')`。新圖示加進 `ICONS`（24×24 線條） |
| 列上的編輯／刪除 | `rowBtn('edit', 'edit-item', { id })`：只有圖示的方形按鈕，文字在 tooltip，包在 `.action-buttons` |
| 訊息 | `toast('已儲存')`、`toast('失敗', 'error')`、`toast('已刪除', 'info', { action: { label: '復原', run } })` |
| 彈出視窗 | `formModal({...})`、`openModal(html)`／`closeModal()`；自己組就用 `modalHeader(title, '儲存')` ＋ `.form-actions` |
| 少數固定選項 | `<select data-segmented>` → 一排按鈕（照常用 `change`、`.value`）。字太長給 `<option data-short="短名">`；會變多的清單用 `data-segmented="6"`（其餘收進「更多 ▾」）；真的要下拉加 `data-keep-select` |
| 危險動作 | `confirmTyped({...})`：要打字才按得下去（見 [danger-zone.md](danger-zone.md)） |
| 列印／PDF | `printDoc(html, 檔名)`：瀏覽器列印，「另存為 PDF」 |
| 下載檔案 | `downloadFile(檔名, 內容)` |

- **彈出視窗一律用 `<dialog class="modal-overlay">`**（測試會擋）：Esc 關閉、焦點留在視窗裡、背景不能操作；點暗色區域關閉。
  手機上自動變**全螢幕**：上面「✕｜標題｜儲存」，下面固定按鈕列。
- 開著的視窗在瀏覽器最上層（top layer），z-index 蓋不過它：要浮在視窗上的東西（訊息、ⓘ 說明框）做成 `popover`，用 `raise(el)` 拉到最前面（`toast`、`openModal` 已經處理）。
- 單一勾選框＋一句話用 `<label class="inline-check">`。
- **少用下拉選單**：5 個以內的固定選項一律按鈕；`formModal` 的 select 自動是按鈕（`data-segmented="5"`）。

## 互動

- **CSP 不允許 inline script**：不能寫 `onclick=`（測試會擋）。按鈕寫 `data-action="名稱"`（＋`data-id` 等參數），在 `app.js` 的 `ACTIONS` 處理。
- 每個 `<button>` 都寫 `type`（表單裡沒寫會送出表單；測試會擋）。
- 會開 Google 登入彈窗的動作，必須在點擊事件裡**同步**呼叫（前面不能有 `await`），否則被瀏覽器擋。
- 單筆刪除：直接刪＋訊息給「復原」，不要跳 `confirm()`；整批、不能復原的才用 `confirmTyped`。
- 存檔失敗時錯誤顯示在**視窗裡**（`.form-error`），視窗不關，使用者填的東西不會不見。
- 搜尋框重畫畫面時要保留游標位置（範例 `renderItems` 有寫）。

## 文字

- 介面文字用繁體中文、白話。說明寫「使用者能做什麼、這個數字代表什麼」，不寫實作細節。
- 數字附單位與比較基準（「比上月」「佔總額」）；估算或假設要寫出來。
- 按鈕用動詞（「匯出」「刪除所有資料」），確認視窗的按鈕和標題用同一個動詞。
- 空狀態告訴使用者下一步（「還沒有資料。按『新增』或『AI 匯入』。」）。

## 改完要看

`tools/shot.mjs` 截電腦 1280 和手機 390 各一張，**自己打開圖看**：標題列有沒有擠、按鈕有沒有換行換得很醜、手機有沒有左右捲、視窗在手機上是不是全螢幕。見 [testing.md](testing.md)。
