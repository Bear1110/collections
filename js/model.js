// 收藏的資料規則（沒有畫面，有測試：test/model.test.mjs）。
// 三種收藏（衣服、書、代購）的欄位寫死在 KINDS；物品的欄位值放在 items.data（JSON，key 是 f1、f2…）。
//
// 欄位定義：{ key, label, type, options, filter, list, quick, noSum, qty, def }
//   key     代號（f1、f2…）。舊資料用這個對應，不要改號、不要重用
//   type    text | number | money | date | choice | tags | url
//   options 單選（choice）的基本選項；物品上出現過的其他值也會列出來，新增時可以直接輸入新的
//   filter  在列表上方顯示成篩選按鈕
//   list    在列表顯示這一欄
//   quick   （單選）列表上直接改，不用打開編輯視窗
//   noSum   （單選）這些選項的物品不算進金額合計（例如缺貨）
//   qty     （金額）乘以哪個數字欄位（數量）算小計
//   def     （單選）新增時預設的值
//   fixed   （單選）只能從選項選，不能輸入新的
//   chips   （單選）用最近用過的值當快速按鈕（可以按 ✕ 不再推薦），也能輸入新的
//   twdOnly （金額）只能填台幣
//   quietValues （單選）手機卡片上不寫的值（常態，例如衣服的「在穿」）
//   hideValues （單選）這些值的物品平常不顯示，篩選這一欄選到它才看得到（衣服的「已丟」）

export const CURRENCIES = ['TWD', 'JPY', 'USD', 'EUR'];
const CURRENCY_SIGN = { TWD: 'NT$', JPY: '¥', USD: 'US$', EUR: '€' };

export const EMPTY = '（未填）';

const f = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

/** 三種收藏。group_by：用哪一欄分組 */
export const KINDS = {
  clothes: {
    name: '衣服', icon: 'shirt', group_by: 'f1',
    fields: [
      f('f1', '部位', 'choice', { options: ['短袖', '長袖', '外套', '長褲', '短褲'], filter: true, fixed: true }),
      f('f2', '款式', 'choice', { options: [], filter: true, list: true, chips: true }),
      f('f3', '品牌', 'choice', { options: [], filter: true, list: true, chips: true }),
      f('f4', '尺寸', 'text'),
      f('f5', '顏色', 'text', { list: true }),
      f('f6', '色系', 'choice', { options: ['黑', '白', '灰', '藍', '綠', '棕', '米', '紅', '橘', '黃', '紫', '粉', '牛仔', '多色'], filter: true, fixed: true }),
      f('f7', '價格', 'money', { list: true }),
      f('f8', '購入', 'date', { list: true }),
      f('f9', '狀態', 'choice', { options: ['在穿', '想丟', '已丟'], filter: true, list: true, def: '在穿', fixed: true, hideValues: ['已丟'], quietValues: ['在穿'] }),
      f('f10', '網址', 'url', { list: true }),
      f('f11', '商品編號', 'text'),
    ],
  },
  books: {
    name: '書', icon: 'book', group_by: 'f1',
    fields: [
      f('f1', '作者／社團', 'text', { list: true }),
      f('f2', '語言', 'choice', { options: ['中文', '日文', '英文'], filter: true, list: true }),
      f('f3', '形式', 'choice', { options: ['實體', '電子'], filter: true, list: true, fixed: true }),
      f('f4', '購買管道', 'choice', { options: [], filter: true }),
      f('f5', '價格', 'money'),
      f('f6', '購入', 'date'),
      f('f7', '標籤', 'tags', { list: true }),
      f('f8', '網址', 'url', { list: true }),
    ],
  },
  proxy: {
    name: '代購', icon: 'bag', group_by: 'f1',
    fields: [
      f('f1', '幫誰買', 'choice', { options: [], filter: true, list: true, chips: true }),
      f('f2', '狀態', 'choice', { options: ['待買', '已買', '缺貨', '已交貨'], filter: true, list: true, quick: true, noSum: ['缺貨'], def: '待買', fixed: true }),
      f('f3', '收錢', 'choice', { options: ['未收', '已收'], filter: true, list: true, quick: true, def: '未收', fixed: true }),
      // f4 是舊版的「批次」欄，改成備註裡的 #標籤（見 migrateBatch），代號不要重用
      f('f5', '規格', 'text', { list: true }),
      f('f6', '型號', 'text'),
      f('f7', '數量', 'number', { list: true }),
      f('f8', '單價', 'money', { list: true, qty: 'f7' }),
      f('f9', '台灣價格', 'money', { qty: 'f7', twdOnly: true }),
      f('f10', '網址', 'url', { list: true }),
    ],
  },
};

export const KIND_IDS = Object.keys(KINDS);
export const fieldsOf = (kind) => KINDS[kind]?.fields ?? [];

// ---------------------------------------------------------------- 讀 JSON 欄位

/** JSON 字串 → 值；壞掉或空白回傳 fallback */
export function parseJSON(text, fallback) {
  try {
    const v = JSON.parse(text || '');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** 物品的自訂欄位值 */
export function dataOf(item) {
  const d = parseJSON(item?.data, {});
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}


// ---------------------------------------------------------------- 各型別的值

/**
 * 日期：可以只填年份或年月。'2023/3/5' → '2023-03-05'、'2018' → '2018'、'2024/12' → '2024-12'。
 * 看不懂的回傳 null（呼叫的人決定要報錯還是放進備註）。
 */
export function normDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const m = /^(\d{4})(?:\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2})\s*日?)?\s*月?)?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (mo && (Number(mo) < 1 || Number(mo) > 12)) return null;
  if (d && (Number(d) < 1 || Number(d) > 31)) return null;
  return [y, mo && mo.padStart(2, '0'), d && d.padStart(2, '0')].filter(Boolean).join('-');
}

/** 金額：{ a: 原幣金額, c: 幣別, r: 匯率（1 原幣 = r 台幣） }。台幣的匯率固定 1 */
export function normMoney(v) {
  if (v == null || v === '') return null;
  const a = Number(typeof v === 'object' ? v.a : v);
  if (!Number.isFinite(a) || (typeof v === 'object' && (v.a === '' || v.a == null))) return null;
  const c = CURRENCIES.includes(v?.c) ? v.c : 'TWD';
  const r = c === 'TWD' ? 1 : Number(v?.r);
  return { a, c, r: Number.isFinite(r) && r > 0 ? r : null };
}

/** 換算成台幣（四捨五入到整數）；外幣沒填匯率就算不出來 */
export function moneyTWD(v) {
  const m = normMoney(v);
  if (!m || m.r == null) return null;
  return Math.round(m.a * m.r);
}

const num = (n) => n.toLocaleString('zh-TW', { maximumFractionDigits: 2 });

/** 顯示用：'NT$725'；外幣 '¥7,980（NT$1,756）'；沒匯率 '¥7,980' */
export function fmtMoney(v) {
  const m = normMoney(v);
  if (!m) return '';
  const own = `${CURRENCY_SIGN[m.c]}${num(m.a)}`;
  if (m.c === 'TWD') return own;
  const twd = moneyTWD(m);
  return twd == null ? own : `${own}（NT$${num(twd)}）`;
}

/** 標籤：字串或陣列 → 去重複、去空白的陣列。可以用逗號、頓號分隔 */
export function normTags(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,，、]/);
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
}

/**
 * 網址欄：http(s) 直接連；www. 開頭補上 https；其他文字（商品名稱、型號）連到 Google 搜尋。
 * 回傳 { href, text, search }，空白回傳 null。
 */
export function linkOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\/\S+$/i.test(s)) {
    let host = s;
    try { host = new URL(s).hostname.replace(/^www\./, ''); } catch { /* 留原文 */ }
    return { href: s, text: host, search: false };
  }
  if (/^www\.\S+$/i.test(s)) return { href: `https://${s}`, text: s.replace(/^www\./i, '').split('/')[0], search: false };
  return { href: `https://www.google.com/search?q=${encodeURIComponent(s)}`, text: s, search: true };
}

/** 依欄位型別整理一個值（存檔前用）。空的回傳 undefined（不存） */
export function normValue(field, v) {
  switch (field.type) {
    case 'number': {
      if (v === '' || v == null) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'money': {
      const m = normMoney(field.twdOnly && v && typeof v === 'object' ? { ...v, c: 'TWD' } : v);
      return m ?? undefined;
    }
    case 'date': {
      const d = normDate(v);
      if (d === null) throw new Error(`「${field.label}」看不懂：請填 2024、2024-03 或 2024-03-05`);
      return d || undefined;
    }
    case 'tags': {
      const t = normTags(v);
      return t.length ? t : undefined;
    }
    default: {
      const s = String(v ?? '').trim();
      return s || undefined;
    }
  }
}

/** 顯示成一行文字（列表、搜尋、匯出 CSV 用） */
export function textOf(field, v) {
  if (v == null || v === '') return '';
  switch (field.type) {
    case 'money': return fmtMoney(v);
    case 'tags': return normTags(v).join('、');
    case 'number': return Number.isFinite(Number(v)) ? num(Number(v)) : String(v);
    default: return String(v);
  }
}

// ---------------------------------------------------------------- 物品

/** 表單的值 → 要存的列：{ name, note, data }（空的欄位不存） */
export function buildItem(kind, values) {
  const name = String(values.name ?? '').trim();
  if (!name) throw new Error('請填「名稱」');
  const data = {};
  for (const fd of fieldsOf(kind)) {
    const v = normValue(fd, values[fd.key]);
    if (v !== undefined) data[fd.key] = v;
  }
  return { name, note: String(values.note ?? '').trim(), data: JSON.stringify(data) };
}

/** 搜尋：名稱、備註、所有看得到的欄位 */
export function itemMatches(item, fields, q) {
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return true;
  const d = dataOf(item);
  const hay = [item.name, item.note, ...fields.map((fd) => textOf(fd, d[fd.key]))].join('\n').toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

/**
 * 篩選：filters 是 { 欄位 key: 值 }，值是 EMPTY 表示「沒填的」。標籤欄位只要有那個標籤就算。
 */
export function filterItems(items, fields, { filters = {}, q = '' } = {}) {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  return items.filter((item) => {
    const d = dataOf(item);
    for (const [k, want] of Object.entries(filters)) {
      if (!want || !byKey[k]) continue;
      const v = d[k];
      if (want === EMPTY) { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) return false; continue; }
      if (byKey[k].type === 'tags' ? !normTags(v).includes(want) : String(v ?? '') !== want) return false;
    }
    return itemMatches(item, fields, q);
  });
}

/** 一個欄位出現過的值（單選照選項順序，其他照出現次數多到少），附件數。沒填的放最後 */
export function countBy(items, field) {
  const counts = new Map();
  for (const item of items) {
    const v = dataOf(item)[field.key];
    const vals = field.type === 'tags' ? normTags(v) : [v == null || v === '' ? '' : textOf(field, v)];
    for (const x of vals.length ? vals : ['']) counts.set(x || EMPTY, (counts.get(x || EMPTY) ?? 0) + 1);
  }
  const order = field.type === 'choice' ? field.options ?? [] : [];
  const rank = (v) => (v === EMPTY ? Infinity : order.includes(v) ? order.indexOf(v) : order.length);
  return [...counts].map(([value, n]) => ({ value, n }))
    .sort((a, b) => rank(a.value) - rank(b.value) || b.n - a.n || a.value.localeCompare(b.value, 'zh-Hant'));
}

/** 分組：[{ value, items }]，順序同 countBy。標籤欄位不能分組（一件會出現好幾次） */
export function groupItems(items, field) {
  if (!field || field.type === 'tags') return [{ value: '', items }];
  const buckets = new Map();
  for (const i of items) {
    const v = dataOf(i)[field.key];
    const t = (v == null || v === '' ? '' : textOf(field, v)) || EMPTY;
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t).push(i);
  }
  return countBy(items, field).map(({ value }) => ({ value, items: buckets.get(value) }));
}

/** 數量：金額欄位設了 qty（數字欄位的 key）就用那一欄，沒填或不是正數當 1 */
export function qtyOf(field, data) {
  if (!field.qty) return 1;
  const n = Number(data[field.qty]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 一件的台幣小計：單價換台幣 × 數量。算不出來回傳 null */
export function lineTWD(field, data) {
  const t = moneyTWD(data[field.key]);
  return t == null ? null : Math.round(t * qtyOf(field, data));
}

/** 單選欄位標成「不算錢」的選項（例如狀態＝缺貨）：這些物品不算進合計 */
export function countsTowardSum(item, fields) {
  const d = dataOf(item);
  return !fields.some((f) => f.type === 'choice' && (f.noSum ?? []).length && f.noSum.includes(d[f.key]));
}

/** 金額欄位的台幣合計（含數量；不算錢的物品跳過；沒匯率的外幣不算，另外回報幾筆） */
export function sumTWD(items, field, fields = []) {
  let total = 0;
  let missing = 0;
  for (const i of items) {
    if (!countsTowardSum(i, fields)) continue;
    const d = dataOf(i);
    if (d[field.key] == null) continue;
    const t = lineTWD(field, d);
    if (t == null) missing++; else total += t;
  }
  return { total, missing };
}

/** 整批改匯率：items 裡所有金額欄位是這個幣別的，匯率改成 rate。回傳 [{ id, data }]，不寫資料庫 */
export function setRate(items, fields, currency, rate) {
  const r = Number(rate);
  if (!(r > 0)) throw new Error('匯率要大於 0');
  if (currency === 'TWD') throw new Error('台幣不用匯率');
  const money = fields.filter((f) => f.type === 'money');
  const changes = [];
  for (const i of items) {
    const d = dataOf(i);
    let hit = false;
    for (const f of money) {
      const m = normMoney(d[f.key]);
      if (m && m.c === currency && m.r !== r) { d[f.key] = { ...m, r }; hit = true; }
    }
    if (hit) changes.push({ id: i.id, data: JSON.stringify(d) });
  }
  return changes;
}

/** 這些物品用到的外幣（整批改匯率要選的） */
export function foreignCurrencies(items, fields) {
  const set = new Set();
  for (const i of items) {
    const d = dataOf(i);
    for (const f of fields) if (f.type === 'money') { const m = normMoney(d[f.key]); if (m && m.c !== 'TWD') set.add(m.c); }
  }
  return CURRENCIES.filter((c) => set.has(c));
}

/** 新增時提醒「是不是已經有了」：名稱互相包含，或去掉空白、大小寫後一樣 */
export function similarItems(items, name, limit = 3) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s　\-_~～・·.,，、!！?？()（）[\]【】《》「」]/g, '');
  const n = norm(name);
  if (n.length < 2) return [];
  return items.filter((i) => {
    const m = norm(i.name);
    return m && (m.includes(n) || n.includes(m));
  }).slice(0, limit);
}

// ---------------------------------------------------------------- 單選的選項

/** 選項清單＋物品實際用到的值，各有幾件（沒用到的也列出來，件數 0） */
export function optionValues(field, items) {
  const counts = new Map((field.options ?? []).map((o) => [o, 0]));
  for (const i of items) {
    const v = dataOf(i)[field.key];
    for (const x of field.type === 'tags' ? normTags(v) : v == null || v === '' ? [] : [String(v)]) counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  return [...counts].map(([value, n]) => ({ value, n }));
}


// ---------------------------------------------------------------- 舊資料（可以自己加種類的那一版）

const KIND_BY_NAME = Object.fromEntries(Object.entries(KINDS).map(([id, k]) => [k.name, id]));

/**
 * 舊版的資料表 { collections, items(collection_id) } → 新版 { items(kind) }。
 * 種類名稱是衣服、書、代購的物品才留下（其他種類現在沒有頁面）。已經是新版就原樣回傳。
 */
export function migrateTables(tables) {
  if (!tables || !Array.isArray(tables.collections)) return { tables, dropped: 0 };
  const kindOf = {};
  for (const c of tables.collections) kindOf[c.id] = KIND_BY_NAME[c.name];
  const items = [];
  let dropped = 0;
  for (const { collection_id: cid, ...i } of tables.items ?? []) {
    if (kindOf[cid]) items.push({ ...i, kind: kindOf[cid] }); else dropped++;
  }
  const { collections, ...rest } = tables;
  void collections;
  return { tables: { ...rest, items }, dropped };
}

// ---------------------------------------------------------------- 匯出 CSV

const csvCell = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** 一個種類攤開成 CSV（金額用台幣小計）。前面加 BOM 讓 Excel 認得中文 */
export function toCSV(kind, items) {
  const fields = fieldsOf(kind);
  const head = ['名稱', ...fields.map((fd) => fd.label), '備註'];
  const rows = items.map((i) => {
    const d = dataOf(i);
    return [i.name, ...fields.map((fd) => (fd.type === 'money' ? (lineTWD(fd, d) ?? '') : textOf(fd, d[fd.key]))), i.note];
  });
  return '\ufeff' + [head, ...rows].map((r) => r.map((c) => csvCell(String(c ?? ''))).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- 備註裡的 #標籤（代購的批次，例如 #2026楓葉之旅）
// 和 finance-watcher 收支的備註一樣：#後面接到空白或標點為止；大小寫不分，第一次的寫法為準。

export const TAG_RE = /[#＃]([^\s#＃,，、。.;；:：!！?？()（）[\]【】「」『』《》<>"'“”]+)/g;
export const noteTags = (note) => [...String(note || '').matchAll(TAG_RE)].map((m) => `#${m[1]}`);
export const sameTag = (a, b) => a.toLowerCase() === b.toLowerCase();

/** 備註拿掉某個標籤（連同旁邊一個空白），其他文字照原樣 */
export function removeTag(note, tag) {
  let s = String(note || '');
  for (const m of [...s.matchAll(TAG_RE)].reverse()) {
    if (!sameTag(`#${m[1]}`, tag)) continue;
    let a = m.index;
    let b = a + m[0].length;
    if (s[a - 1] === ' ') a--; else if (s[b] === ' ') b++;
    s = s.slice(0, a) + s.slice(b);
  }
  return s.trim();
}

/** 有就拿掉、沒有就加在最後 */
export function toggleTag(note, tag) {
  const has = noteTags(note).some((t) => sameTag(t, tag));
  return has ? removeTag(note, tag) : `${String(note || '').trim()} ${tag}`.trim();
}

/** 批次名稱 → 標籤（空白拿掉，因為標籤到空白為止） */
export const batchToTag = (name) => `#${String(name).trim().replace(/^[#＃]/, '').replace(/\s+/g, '')}`;

/** 沒有 #標籤 的代購 */
export const NO_BATCH = '零星';

/** 物品是不是在這個批次（NO_BATCH＝沒有標籤的；空白＝全部） */
export function inBatch(item, batch) {
  if (!batch) return true;
  const tags = noteTags(item.note);
  if (batch === NO_BATCH) return !tags.length;
  return tags.some((t) => sameTag(t, batch));
}

/** 出現過的標籤，新的在前（看物品 id），附件數；大小寫不同算同一個 */
export function batchesOf(items) {
  const map = new Map();
  for (const i of [...items].sort((a, b) => b.id - a.id)) {
    for (const t of noteTags(i.note)) {
      const k = t.toLowerCase();
      if (!map.has(k)) map.set(k, { tag: t, n: 0 });
      map.get(k).n++;
    }
  }
  return [...map.values()];
}

/** 單選欄位最近用過的值（新的在前、不重複），跳過 hidden（小寫比對） */
export function recentValues(items, key, { hidden = [], max = 8 } = {}) {
  const skip = new Set(hidden.map((h) => h.toLowerCase()));
  const out = [];
  for (const i of [...items].sort((a, b) => b.id - a.id)) {
    const v = dataOf(i)[key];
    if (!v || skip.has(String(v).toLowerCase()) || out.includes(v)) continue;
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------- 代購：結清

/** 不用再處理的：缺貨，或已交貨而且已收錢 */
export function proxyDone(item) {
  const d = dataOf(item);
  return d.f2 === '缺貨' || (d.f2 === '已交貨' && d.f3 === '已收');
}

/** 收起來的：有標籤而且標籤結清了；沒標籤的（零星）處理完就自動收起來。closed 是結清的標籤（小寫） */
export function isArchived(item, closed) {
  const tags = noteTags(item.note);
  if (tags.length) return tags.some((t) => closed.has(t.toLowerCase()));
  return proxyDone(item);
}

/** 結清前的提醒：還沒買的、買了還沒交的、還沒收錢的（缺貨的不用收） */
export function unfinished(items) {
  const fields = fieldsOf('proxy');
  const price = fields.find((x) => x.key === 'f8');
  let toBuy = 0;
  let notDelivered = 0;
  const unpaidItems = [];
  for (const i of items) {
    if (!countsTowardSum(i, fields)) continue; // 缺貨的不用買、不用收
    const d = dataOf(i);
    if (!d.f2 || d.f2 === '待買') toBuy++;
    else if (d.f2 === '已買') notDelivered++;
    if (d.f3 !== '已收') unpaidItems.push(i);
  }
  return { toBuy, notDelivered, unpaid: unpaidItems.length, unpaidTWD: sumTWD(unpaidItems, price, fields).total };
}

/** 一批的摘要：件數、合計、每個人多少（缺貨不算） */
export function batchSummary(items) {
  const fields = fieldsOf('proxy');
  const price = fields.find((x) => x.key === 'f8');
  const who = fields.find((x) => x.key === 'f1');
  const byPerson = groupItems(items, who).map((g) => ({ who: g.value, n: g.items.length, total: sumTWD(g.items, price, fields).total }));
  return { n: items.length, total: sumTWD(items, price, fields).total, byPerson };
}

/** 舊版的「批次」欄（f4）→ 備註的 #標籤。不用轉回傳 null */
export function migrateBatch(item) {
  const d = dataOf(item);
  if (!d.f4) return null;
  const tag = batchToTag(d.f4);
  delete d.f4;
  const note = inBatch(item, tag) ? item.note : toggleTag(item.note, tag);
  return { note, data: JSON.stringify(d) };
}

/** 平常不顯示的物品（hideValues），除非那一欄正在篩選。回傳 { items: 留下的, hidden: [{ field, n }] } */
export function hideByDefault(items, fields, filters = {}) {
  const hidden = [];
  let out = items;
  for (const fd of fields) {
    if (!fd.hideValues?.length || filters[fd.key]) continue;
    const keep = out.filter((i) => !fd.hideValues.includes(dataOf(i)[fd.key]));
    if (keep.length < out.length) hidden.push({ field: fd, n: out.length - keep.length });
    out = keep;
  }
  return { items: out, hidden };
}
