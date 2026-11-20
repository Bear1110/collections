// 一次性：把舊的 Google 試算表匯出的 CSV 轉成本網站的備份檔（設定 → 匯入）。
//
// 用法：node tools/convert-csv.mjs REALDATA REALDATA/collection-backup-import.json
//       node tools/convert-csv.mjs --proxy "REALDATA/代購 - 工作表1.csv" REALDATA/proxy-pack.json 第一批（代購：產生「加入檔」，匯入時加進去、不取代）
//   第一個參數是放 CSV 的資料夾；檔名裡有「同人誌」的轉成「書」，其他（短袖、長袖、外套、長褲、短褲）轉成「衣服」，
//   檔名的最後一段（「Archive區 - 短袖.csv」的「短袖」）就是衣服的「部位」。
// 輸出檔含真實資料，放在 REALDATA/（不進 git）。下面的規則有測試：test/convert.test.mjs（只用假資料）。

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { normDate, batchToTag, KINDS } from '../js/model.js';
import { nowSQL } from '../js/db.js';
import { APP_ID } from '../js/config.js';

// ---------------------------------------------------------------- CSV

/** RFC 4180：引號、引號裡的逗號和換行 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------- 衣服

/** 名稱開頭的品牌簡稱 → 品牌（名稱裡的簡稱拿掉） */
const BRANDS = [
  [/^UQ\s*/i, 'UNIQLO'],
  [/^GU\s*/, 'GU'],
  [/^NET\s*/i, 'NET'],
  [/^無印\s*/, '無印良品'],
  [/^50%\s*/, '50%'],
  [/^levi'?s?\s*/i, "Levi's"],
  [/^ADD?IDA?S?\s*/i, 'adidas'],
  [/^freak'?s store\s*/i, "FREAK'S STORE"],
  [/^佐丹奴\s*/, '佐丹奴'],
  [/^蝦皮\s*/, '蝦皮'],
  [/^MH500\b/, '迪卡儂'],
];

export function splitBrand(name) {
  const n = name.trim();
  for (const [re, brand] of BRANDS) {
    if (!re.test(n)) continue;
    const rest = brand === '迪卡儂' ? n : n.replace(re, '').trim();
    return { brand, name: rest || n };
  }
  return { brand: '', name: n };
}

/** 顏色文字 → 色系（看不出來就空白） */
const COLOR_FAMILY = [
  [/牛仔/, '牛仔'],
  [/黑白|條紋|相間/, '多色'],
  [/BLACK|黑/i, '黑'],
  [/OFF WHITE|WHITE|白/i, '白'],
  [/GRAY|GREY|灰/i, '灰'],
  [/NAVY|BLUE|藍/i, '藍'],
  [/OLIVE|GREEN|綠/i, '綠'],
  [/BROWN|棕|褐|駝|大地|奶茶/i, '棕'],
  [/BEIGE|米|卡其/i, '米'],
  [/RED|紅/i, '紅'],
  [/ORANGE|橘|橙/i, '橘'],
  [/YELLOW|黃/i, '黃'],
  [/PURPLE|紫/i, '紫'],
  [/PINK|粉/i, '粉'],
];
export function colorFamily(color) {
  for (const [re, fam] of COLOR_FAMILY) if (re.test(color)) return fam;
  return '';
}

const SIZE_RE = /^(XXS|XS|S|M|L|XL|XXL|\d{2})$/i;

/**
 * 一列衣服 → { name, note, data }。欄位用名稱傳：{ name, kind（類別）, price, size, color, url, bought }，沒有的欄位不用給。
 * 處理舊表的毛病：價格欄放了尺寸（整列往左偏一格）、購入時間放了備註、網址欄放了商品編號或商品名稱。
 */
export function clothingRow(part, { name, kind = '', price = '', size = '', color = '', url = '', bought = '' }) {
  // 價格欄是尺寸 → 這列往左偏了一格
  if (price && !Number.isFinite(Number(price)) && SIZE_RE.test(price.trim())) {
    [price, size, color, url, bought] = ['', price, size, color, url];
  }
  const notes = [];
  const { brand, name: short } = splitBrand(name);
  const data = { f1: part };
  if (kind.trim()) data.f2 = kind.trim();
  if (brand) data.f3 = brand;
  if (size.trim()) data.f4 = size.trim();
  if (color.trim()) {
    data.f5 = color.trim();
    const fam = colorFamily(color);
    if (fam) data.f6 = fam;
  }
  const p = Number(price);
  if (price.trim() && Number.isFinite(p) && p > 0) data.f7 = { a: Math.round(p), c: 'TWD', r: 1 };
  const d = normDate(bought);
  if (d) data.f8 = d; else if (d === null) notes.push(bought.trim());
  const u = url.trim();
  if (/^\d{5,7}$/.test(u)) data.f11 = u; else if (u) data.f10 = u;
  const note = notes.join('；');
  data.f9 = /丟/.test(note) ? '想丟' : '在穿';
  return { name: short, note, data };
}

/** 一張衣服的表（第一列是標題）→ 物品。只看前 7 欄：右邊那幾欄是手算的統計，App 會自己算 */
export function clothingTable(part, rows) {
  const head = rows[0].map((h) => h.trim());
  const hasKind = head[1] === '類別';
  const out = [];
  for (const r of rows.slice(1)) {
    const c = (i) => (r[i] ?? '').trim();
    if (!c(0)) continue;
    const k = hasKind ? 1 : 0;
    out.push(clothingRow(part, { name: c(0), kind: hasKind ? c(1) : '', price: c(1 + k), size: c(2 + k), color: c(3 + k), url: c(4 + k), bought: c(5 + k) }));
  }
  return out;
}

// ---------------------------------------------------------------- 書

/** 這幾類不轉（見 NOTES.md） */
const SKIP_BOOK = /JC|JS|JK|蘿|幼|ロリ|正太|ショタ|メスガキ|小学|中学|小學|中學|學姐|学園|學園|スクール|放學|放課後/i;

/** 書：品名、語言、作者。拿掉店家頁面標題的尾巴，標出購買管道和電子書 */
export function bookTable(rows) {
  const out = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    let title = (r[0] ?? '').trim();
    const lang = (r[1] ?? '').trim();
    const author = (r[2] ?? '').trim();
    if (!title) continue;
    if (SKIP_BOOK.test(title) || SKIP_BOOK.test(author)) { skipped++; continue; }
    const data = {};
    const shop = /\s*(?:通販\s*)?-\s*メロンブックス\s*$/;
    if (shop.test(title)) { data.f4 = 'メロンブックス'; title = title.replace(shop, '').trim(); }
    if (/\s*電子書籍\s*$/.test(title)) { data.f3 = '電子'; title = title.replace(/\s*電子書籍\s*$/, '').trim(); }
    if (author) data.f1 = author;
    if (lang) data.f2 = lang;
    out.push({ name: title, note: '', data });
  }
  return { items: out, skipped };
}

// ---------------------------------------------------------------- 組成備份檔

/** 衣服、書 → 本網站的備份檔（設定 → 匯入，整個取代） */
export function buildBackup(groups) {
  const now = nowSQL();
  const items = [];
  let id = 1;
  for (const { kind, list } of groups) {
    for (const i of list) items.push({ id: id++, kind, name: i.name, note: i.note, data: JSON.stringify(i.data), created_at: now });
  }
  return { format: `${APP_ID}-backup`, version: 2, exported_at: now, tables: { items, settings: [] } };
}

// ---------------------------------------------------------------- 代購

const yen = (s) => Number(String(s).replace(/[,，\s円¥]/g, ''));

/**
 * 代購表的價格欄：'4,990' → 單價；'3990 -> 2990' → 單價 2990、備註原價；
 * '1,990円 (台幣590)' → 單價＋台灣價格；'2000 內可以買' → 備註預算；其他文字 → 備註。
 * 金額都當日圓，匯率先空著（之後用「匯率」整批填）。
 */
export function parseProxyPrice(text) {
  const s = String(text ?? '').trim();
  const out = { notes: [] };
  let m;
  if (!s) return out;
  if ((m = /^([\d,]+)\s*(?:->|→)\s*([\d,]+)$/.exec(s))) { out.price = yen(m[2]); out.notes.push(`原價 ¥${m[1]}`); }
  else if ((m = /^([\d,]+)\s*円?\s*[(（]\s*台幣\s*([\d,]+)\s*[)）]$/.exec(s))) { out.price = yen(m[1]); out.tw = yen(m[2]); }
  else if ((m = /^([\d,]+)\s*內可以買$/.exec(s))) out.notes.push(`預算 ¥${m[1]} 內`);
  else if (/^[\d,]+\s*円?$/.test(s)) out.price = yen(s);
  else out.notes.push(s);
  return out;
}

/** 商品頁標題 → 品名（拿掉「ユニクロ公式 | 」和「| [公式]某店 通販」） */
export function cleanTitle(t) {
  return String(t ?? '').trim()
    .replace(/^ユニクロ公式\s*[|｜]\s*/, '')
    .replace(/\s*[|｜]\s*\[公式\].*$/, '')
    .trim();
}

/**
 * 代購表：[幫誰買, 買了沒(✅), 品名, 尺寸, 顏色, 型號, 價格, 數量, 備註, …]。
 * 商品頁標題整段留在「網址」欄（點了會用 Google 搜尋那個商品）。
 */
export function proxyTable(rows, batch) {
  const out = [];
  for (const r of rows.slice(1)) {
    const c = (i) => (r[i] ?? '').trim();
    const title = c(2);
    if (!title) continue;
    const data = {};
    if (c(0)) data.f1 = c(0);
    data.f2 = /✅|✔|v|已買/i.test(c(1)) ? '已買' : '待買';
    const spec = [c(3), c(4).replace(/^カラー\s*[:：]\s*/, '')].filter(Boolean).join('／');
    if (spec) data.f5 = spec;
    if (c(5)) data.f6 = c(5);
    const q = Number(c(7));
    if (c(7) && q > 0) data.f7 = q;
    const p = parseProxyPrice(c(6));
    if (p.price > 0) data.f8 = { a: p.price, c: 'JPY', r: null };
    const notes = [...p.notes];
    let tw = p.tw;
    const extra = c(8);
    const m = /^台幣\s*([\d,]+)$/.exec(extra);
    if (m && tw == null) tw = yen(m[1]); else if (extra) notes.push(extra);
    if (tw > 0) data.f9 = { a: tw, c: 'TWD', r: 1 };
    if (/[|｜]/.test(title)) data.f10 = title;
    // 批次寫成備註最後的 #標籤（下面）
    out.push({ name: cleanTitle(title), note: [notes.join('；'), batch && batchToTag(batch)].filter(Boolean).join(' '), data });
  }
  return out;
}

/** 「加入檔」：設定 → 匯入 時把物品加進那個種類，不會取代原本的資料 */
export function buildPack(kind, list) {
  const now = nowSQL();
  return { format: `${APP_ID}-pack`, version: 2, exported_at: now, kind, items: list.map((i) => ({ name: i.name, note: i.note, data: JSON.stringify(i.data) })) };
}

// ---------------------------------------------------------------- 執行

if (process.argv[1] && basename(process.argv[1]) === 'convert-csv.mjs' && process.argv[2] === '--proxy') {
  // node tools/convert-csv.mjs --proxy <代購.csv> <輸出.json> [批次名稱]
  const [, file, out, batch = '第一批'] = process.argv.slice(2);
  const list = proxyTable(parseCSV(readFileSync(file, 'utf8')), batch);
  writeFileSync(out, JSON.stringify(buildPack('proxy', list), null, 1));
  const who = [...new Set(list.map((i) => i.data.f1))].map((w) => `${w} ${list.filter((i) => i.data.f1 === w).length}`).join('、');
  console.log(`代購 ${list.length} 件（${who}）；已買 ${list.filter((i) => i.data.f2 === '已買').length} 件；沒有價格 ${list.filter((i) => !i.data.f8).length} 件；有台灣價格 ${list.filter((i) => i.data.f9).length} 件`);
  console.log(`→ ${out}`);
} else if (process.argv[1] && basename(process.argv[1]) === 'convert-csv.mjs') {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) { console.error('用法：node tools/convert-csv.mjs <CSV 資料夾> <輸出.json>'); process.exit(1); }
  const PART_ORDER = KINDS.clothes.fields.find((f) => f.key === 'f1').options;
  const files = readdirSync(dir).filter((f) => f.endsWith('.csv'));
  const clothes = [];
  let books = { items: [], skipped: 0 };
  for (const part of PART_ORDER) {
    const f = files.find((x) => x.replace(/\.csv$/, '').split('-').pop().trim() === part);
    if (f) clothes.push(...clothingTable(part, parseCSV(readFileSync(join(dir, f), 'utf8'))));
  }
  const bookFile = files.find((f) => f.includes('同人誌'));
  if (bookFile) books = bookTable(parseCSV(readFileSync(join(dir, bookFile), 'utf8')));
  if (!clothes.length && !books.items.length) { console.error(`${dir} 裡找不到衣服或書的 CSV，沒有輸出（不覆蓋 ${out}）`); process.exit(1); }
  const backup = buildBackup([{ kind: 'clothes', list: clothes }, { kind: 'books', list: books.items }]);
  writeFileSync(out, JSON.stringify(backup, null, 1));
  const byPart = PART_ORDER.map((p) => `${p} ${clothes.filter((c) => c.data.f1 === p).length}`).join('、');
  console.log(`衣服 ${clothes.length} 件（${byPart}）`);
  console.log(`書 ${books.items.length} 本（跳過 ${books.skipped} 本）`);
  console.log(`想丟 ${clothes.filter((c) => c.data.f9 === '想丟').length} 件；有備註 ${clothes.filter((c) => c.note).length} 件`);
  console.log(`→ ${out}`);
}
