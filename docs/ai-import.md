# AI 匯入

讓使用者用**自己的** AI（ChatGPT、Claude、Gemini、Copilot）把報價單、對帳單、截圖、PDF 整理成 JSON，再貼回網站匯入。
網站不呼叫任何 AI API：沒有 API key、不花錢、資料不經過我們。程式：`template/js/aiimport.js`，範例畫面在 `app.js` 的 `importModal`。

## 流程

1. **提示詞**（`buildPrompt`）：只有格式說明，**不含使用者資料**。回覆格式固定 `{ "format": "<APP_ID>-import", "version": 1, "<種類>": [...] }`。
2. **AI 按鈕**（`AI_SITES`、`openAI`）：點一下複製提示詞並開新分頁到那個 AI。ChatGPT、Claude 支援用網址 `?q=` 直接把提示詞帶進對話框（提示詞 ≤ 7000 字時，`AI_LINK_MAX`）；其他的要貼上。
   使用者在那邊貼上提示詞＋自己的資料。
3. **貼回來**：`extractJSON` 寬鬆解析：容許 ```` ```json ```` 外框、前後說明文字；JSON 不完整（AI 回到一半被截斷）會明確說「不完整」。
4. **預覽**（`planImport`，只讀不寫）：每列整理成要寫入的樣子，標出**錯誤**（缺必填，不能勾）和**重複**（已經有了，預設不勾）。使用者可以逐列勾選。
5. **確認**後整批寫入，訊息顯示匯入幾筆。

## 寫一個新的匯入

```js
const PROMPT = buildPrompt({
  intro: '你是資料整理工具。請把我給你的報價單整理成 JSON。',
  kinds: { quotes: '一筆一個物件：{ "supplier": "供應商", "model": "型號", "price": 單價, "currency": "USD", "date": "YYYY-MM-DD" }' },
  rules: ['同一個型號有多個包裝就拆成多筆。'],
});

function planImport(text) {
  const data = extractJSON(text);
  return (data.quotes ?? []).map((r) => {
    const row = { model: str(r.model), price: num(r.price), date: date(r.date, db.today()) };
    row.errors = [!row.model && '沒有型號', row.price == null && '沒有價格'].filter(Boolean);
    row.duplicate = /* 用自然鍵比對已經有的資料 */ false;
    return row;
  });
}
```

- 轉換用 `str`、`num`（「1,250」「$3.5」都行）、`date`（「2026/3/5」「2026年3月5日」→ `2026-03-05`）、`bool`（是／否／Y／N）。
- **重複判斷用自然鍵**（名稱＋日期、供應商＋型號＋日期…），不要用 AI 給的 id。
- 需要「對應」的資料（例如供應商型號 → 自己的品項），預覽時讓使用者選，選過記住（color-picker 的 `supplier_items`），下次自動對上。

## 提示詞要點

- 只要 JSON、放在 code block 裡、不要說明。
- 數字不要千分位與單位、日期 YYYY-MM-DD、看不清楚留空**不要猜**。
- 欄位說明用使用者的語言寫，附一個物件範例。
- 範例裡**不能有真實資料**（真實的批號、價格、客戶名）：提示詞會 commit 進 repo。
- 提示詞越短越好：超過 7000 字就不能用網址帶入，只能複製貼上。
