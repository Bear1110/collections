// AI 匯入的共用部分。流程（見 docs/ai-import.md）：
//   1. 產生提示詞（只有格式說明，不含使用者資料）
//   2. 使用者按一個 AI 網站：複製提示詞並打開網站，在那邊貼上提示詞＋自己的資料（文字、PDF、截圖）
//   3. 把 AI 的回覆貼回來 → extractJSON 寬鬆解析 → 預覽（每列標出錯誤、重複）→ 確認後整批寫入
// 各專案自己寫「欄位說明」和「一列怎麼檢查、怎麼寫入」，其他都用這裡的。

import { APP_ID } from './config.js';

export const FORMAT = `${APP_ID}-import`;

/**
 * 提示詞。kinds：{ items: '一筆一個物件：{ "name": "...", ... }' }（每種資料一段說明）。
 * 回覆格式固定是 { "format": FORMAT, "version": 1, "<kind>": [...] }。
 */
export function buildPrompt({ intro, kinds, rules = [] }) {
  const example = Object.fromEntries([['format', FORMAT], ['version', 1], ...Object.keys(kinds).map((k) => [k, ['…']])]);
  return `${intro}
只回覆一個 JSON（放在 \`\`\`json 區塊裡），不要其他說明。

格式：
${JSON.stringify(example, null, 2)}

${Object.entries(kinds).map(([k, desc]) => `「${k}」：${desc}`).join('\n')}

規則：
- 數字一律用阿拉伯數字，不要千分位逗號、單位或貨幣符號。
- 日期一律 YYYY-MM-DD；看不出年份時用今年。
- 看不清楚或沒有的資料留空字串或 null，不要猜。
${rules.map((r) => `- ${r}`).join('\n')}

以下是我的資料：
`;
}

/** 從 AI 回覆取出 JSON：容許 ```json 外框、前後的說明文字。 */
export function extractJSON(text) {
  const s = String(text ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('回覆裡找不到 JSON');
  const close = body[start] === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  if (end < start) throw new Error('JSON 不完整（可能被截斷了，請 AI 分批回覆）');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    throw new Error(`JSON 格式錯誤：${e.message}`);
  }
}

// ---- 寬鬆轉換：AI 常給字串數字、斜線日期、「是／否」
export const str = (v) => (v == null ? '' : String(v).trim());
export function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,\s$]/g, ''));
  return Number.isFinite(n) ? n : null;
}
export const bool = (v) => v === true || /^(true|yes|y|1|是|有)$/i.test(str(v));
export function date(v, today = '') {
  const s = str(v).replace(/[/.年月]/g, '-').replace(/日$/, '');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : today;
}

// ---- AI 網站按鈕：提示詞夠短時用 ?q= 預先填好（不會自動送出）；太長或網站不支援就靠剪貼簿
export const AI_LINK_MAX = 7000;
export const AI_SITES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/', prefill: true },
  { name: 'Claude', url: 'https://claude.ai/new', prefill: true },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'Copilot', url: 'https://copilot.microsoft.com/' },
];

/** 點 AI 網站按鈕時呼叫（在 click 事件裡）：設定連結網址並複製提示詞。回傳 Promise（複製完成）。 */
export function openAI(anchor, prompt) {
  const site = AI_SITES.find((s) => s.name === anchor.dataset.site);
  const q = encodeURIComponent(prompt);
  anchor.href = site?.prefill && q.length <= AI_LINK_MAX ? `${site.url}?q=${q}` : site?.url ?? anchor.href;
  return navigator.clipboard.writeText(prompt);
}
