// 本機資料表（記憶體 + localStorage），可選擇同步到使用者自己的 Google 試算表。
//
// 每張表在記憶體裡是一個陣列，每次修改後存進 localStorage。synced 的表各對應試算表的一個分頁
// （見 js/cloud/sync.js）；其他是本機快取。每次修改 synced 的列都記進 pending，
// 同步時把這台裝置的修改套到試算表目前的內容上（以列為單位，最後寫入者勝）。
//
// ★ 開新專案：改 SCHEMA（下面）就好。其他不用動。

import { APP_ID } from './config.js';

export const STORAGE_KEY = `${APP_ID}.db.v1`;
const PENDING_KEY = `${APP_ID}.pending.v1`;
const CACHE_KEY = `${APP_ID}.cache.v1`;

// 欄位型別：int、real、text、nint（選填的關聯 id：不是正整數就是 null）。
// key：跨裝置辨識一列用的欄位（預設 'id'）。sheetId：同步到試算表時的分頁編號，
// ★ 只能新增、不能改號、不能重複用（使用者改分頁名稱也不會壞，靠的就是這個編號）。
// defaults：欄位缺值時的預設。文字欄位的 '' 是真的空白，不會被預設值取代。
export const SCHEMA = {
  // 所有物品都在這張表，kind 是 clothes／books／proxy（欄位定義寫死在 js/model.js 的 KINDS）；data 是欄位值（JSON 字串）。
  // sheetId 3 沿用舊版的 items；2 是舊版的 collections（停用，見 RETIRED_SHEET_IDS）
  items: {
    synced: true, sheetId: 3,
    columns: { id: 'int', kind: 'text', name: 'text', data: 'text', note: 'text', created_at: 'text' },
    defaults: { data: '{}' },
  },
  settings: {
    synced: true, sheetId: 1, key: 'key',
    columns: { id: 'int', key: 'text', value: 'text' },
    defaults: {},
  },
};

// 停用的表用過的 sheetId：試算表裡可能還留著那個分頁當封存，新表不能再用這些編號
export const RETIRED_SHEET_IDS = [2];

// Values reported for settings nobody has saved yet.
const SETTING_DEFAULTS = {};

export const SYNCED_TABLES = Object.keys(SCHEMA).filter((t) => SCHEMA[t].synced);
/** 使用者的資料（不含設定）：危險區、匯入確認、提醒條都看這個 */
export const DATA_TABLES = SYNCED_TABLES.filter((t) => t !== 'settings');
export const dataCount = () => DATA_TABLES.reduce((n, t) => n + count(t), 0);

let tables = {};
let pending = {}; // table -> { up: Set(key), del: Set(key) }
const listeners = new Set();

function storage() {
  try { return window.localStorage; } catch { return null; }
}

export function rowKey(table, row) {
  const k = SCHEMA[table].key || 'id';
  return typeof k === 'function' ? k(row) : String(row[k]);
}

export function nowSQL() {
  // 'YYYY-MM-DD HH:MM:SS', UTC
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Local calendar date 'YYYY-MM-DD' (today by default). */
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Coerce a value to a column type, applying the table default for missing values. */
export function coerce(type, v, def) {
  // 文字欄位的 '' 是真的空白（例如其他收費沒有單位），不套預設值；其他型別的 '' 才當「沒填」
  if (v === undefined || v === null || (v === '' && type !== 'text')) {
    if (def !== undefined) return def;
    if (type === 'nint') return null;
    if (type === 'text') return '';
    return 0;
  }
  switch (type) {
    case 'nint': { // 選填的關聯 id：不是正整數就是「沒有」
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    case 'int': {
      if (typeof v === 'boolean') return v ? 1 : 0;
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) ? n : 0;
    }
    case 'real': {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    default:
      return String(v);
  }
}

export function normalizeRow(table, row) {
  const s = SCHEMA[table];
  const out = {};
  for (const [col, type] of Object.entries(s.columns)) {
    out[col] = coerce(type, row[col], s.defaults[col]);
  }
  return out;
}

function emptyTables() {
  const t = {};
  for (const name of Object.keys(SCHEMA)) t[name] = [];
  return t;
}

// ---------------------------------------------------------------- load / save

export function load() {
  tables = emptyTables();
  pending = {};
  const ls = storage();
  if (!ls) return;
  try {
    const data = JSON.parse(ls.getItem(STORAGE_KEY) || '{}');
    const cache = JSON.parse(ls.getItem(CACHE_KEY) || '{}');
    for (const name of Object.keys(SCHEMA)) {
      const src = SCHEMA[name].synced ? data[name] : cache[name];
      if (Array.isArray(src)) tables[name] = src;
    }
    const p = JSON.parse(ls.getItem(PENDING_KEY) || '{}');
    for (const [name, v] of Object.entries(p)) {
      if (!SCHEMA[name]) continue;
      pending[name] = { up: new Set(v.up || []), del: new Set(v.del || []) };
    }
  } catch (e) {
    console.error('db load failed', e);
  }
}

// Only the blobs that changed are rewritten.
const dirty = new Set(); // 'data' | 'cache' | 'pending'
let saveTimer = null;
function scheduleSave(...what) {
  for (const w of what) dirty.add(w);
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 50);
}

function tablesWhere(synced) {
  const out = {};
  for (const name of Object.keys(SCHEMA)) if (SCHEMA[name].synced === synced) out[name] = tables[name];
  return out;
}

export function saveNow() {
  const ls = storage();
  if (!ls) return;
  try {
    if (dirty.has('data')) ls.setItem(STORAGE_KEY, JSON.stringify(tablesWhere(true)));
    if (dirty.has('pending')) {
      const p = {};
      for (const [name, v] of Object.entries(pending)) {
        if (v.up.size || v.del.size) p[name] = { up: [...v.up], del: [...v.del] };
      }
      ls.setItem(PENDING_KEY, JSON.stringify(p));
    }
  } catch (e) {
    console.error('db save failed', e);
  }
  if (dirty.has('cache')) {
    try {
      ls.setItem(CACHE_KEY, JSON.stringify(tablesWhere(false)));
    } catch {
      // Caches are rebuildable; drop them rather than fail.
      try { ls.removeItem(CACHE_KEY); } catch { /* ignore */ }
    }
  }
  dirty.clear();
}

/** Approximate bytes this device's records take in localStorage (UTF-16). */
export function storedBytes() {
  try { return (storage()?.getItem(STORAGE_KEY)?.length ?? 0) * 2; } catch { return 0; }
}

// Listeners hear about each changed table once per task, not once per row.
const changedTables = new Set();
function notify(table) {
  if (!changedTables.size) {
    queueMicrotask(() => {
      const names = [...changedTables];
      changedTables.clear();
      for (const t of names) for (const fn of listeners) fn(t);
    });
  }
  changedTables.add(table);
}

function markChanged(table, key, deleted) {
  // Local caches are nobody's business but this device's.
  if (!SCHEMA[table].synced) { scheduleSave('cache'); return; }
  scheduleSave('data', 'pending');
  const p = (pending[table] ||= { up: new Set(), del: new Set() });
  if (deleted) { p.up.delete(key); p.del.add(key); } else { p.del.delete(key); p.up.add(key); }
  notify(table);
}

/** Subscribe to local changes (used by the sync scheduler). */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------- queries

/** All rows of a table (shallow copies, safe to mutate). */
export function all(table) {
  return tables[table].map((r) => ({ ...r }));
}

/** How many rows a table has (no copying). */
export function count(table) {
  return tables[table].length;
}

/** Rows matching a predicate (copies). */
export function where(table, pred) {
  return tables[table].filter(pred).map((r) => ({ ...r }));
}

export function get(table, id) {
  const n = Number(id);
  const r = tables[table].find((x) => x.id === n);
  return r ? { ...r } : null;
}

export function findBy(table, field, value) {
  const r = tables[table].find((x) => x[field] === value);
  return r ? { ...r } : null;
}

function nextId(table) {
  // Time-based so two devices adding rows offline do not collide; always above
  // the current max so imported small integer ids keep sorting first.
  let max = 0;
  for (const r of tables[table]) if (r.id > max) max = r.id;
  const t = Date.now() * 10 + Math.floor(Math.random() * 10);
  return Math.max(max + 1, t);
}

/** Insert a row; fills id/created_at/defaults. Returns the stored copy. */
export function insert(table, row) {
  const s = SCHEMA[table];
  const r = normalizeRow(table, row);
  if ('id' in s.columns && !row.id) r.id = nextId(table);
  if ('created_at' in s.columns && !row.created_at) r.created_at = nowSQL();
  tables[table].push(r);
  markChanged(table, rowKey(table, r), false);
  return { ...r };
}

/** Patch the row with this id. Returns the updated copy, or null if missing. */
export function update(table, id, patch) {
  const n = Number(id);
  const i = tables[table].findIndex((x) => x.id === n);
  if (i < 0) return null;
  return replaceAt(table, i, { ...tables[table][i], ...patch });
}

/** Patch every row matching pred. Returns the number of rows changed. */
export function updateWhere(table, pred, patch) {
  let n = 0;
  tables[table].forEach((r, i) => {
    if (!pred(r)) return;
    replaceAt(table, i, { ...r, ...patch });
    n++;
  });
  return n;
}

function replaceAt(table, i, row) {
  const before = tables[table][i];
  const r = normalizeRow(table, row);
  const oldKey = rowKey(table, before);
  const newKey = rowKey(table, r);
  tables[table][i] = r;
  if (JSON.stringify(before) !== JSON.stringify(r)) {
    if (oldKey !== newKey) markChanged(table, oldKey, true);
    markChanged(table, newKey, false);
  }
  return { ...r };
}

/** Insert or replace by the table's identity key (settings: key). */
export function upsert(table, row) {
  const key = rowKey(table, normalizeRow(table, row));
  const i = tables[table].findIndex((x) => rowKey(table, x) === key);
  if (i < 0) return insert(table, row);
  const existing = tables[table][i];
  return replaceAt(table, i, { ...existing, ...row, id: existing.id ?? row.id });
}

export function remove(table, id) {
  const n = Number(id);
  return removeWhere(table, (x) => x.id === n);
}

export function removeWhere(table, pred) {
  const keep = [];
  let n = 0;
  for (const r of tables[table]) {
    if (pred(r)) { n++; markChanged(table, rowKey(table, r), true); } else keep.push(r);
  }
  tables[table] = keep;
  return n;
}

// ---------------------------------------------------------------- transactions

/**
 * Run fn atomically: if it throws (or rejects), every table is restored.
 */
export async function transaction(fn) {
  // Rows are never mutated in place (every write stores a new object), so
  // copying the arrays is a complete snapshot.
  const snapT = {};
  for (const [k, v] of Object.entries(tables)) snapT[k] = v.slice();
  const snapP = {};
  for (const [k, v] of Object.entries(pending)) snapP[k] = { up: new Set(v.up), del: new Set(v.del) };
  try {
    return await fn();
  } catch (e) {
    tables = snapT;
    pending = snapP;
    scheduleSave('data', 'cache', 'pending');
    throw e;
  }
}

// ---------------------------------------------------------------- settings

/** A setting's stored value; when unset, its default (or ''). */
export function getSetting(key) {
  const r = tables.settings.find((x) => x.key === key);
  return r ? r.value : (SETTING_DEFAULTS[key] ?? '');
}

export function setSetting(key, value) {
  upsert('settings', { key, value: String(value) });
}

/** Every setting (defaults for the unset ones). */
export function allSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const r of tables.settings) out[r.key] = r.value;
  return out;
}

// ---------------------------------------------------------------- sync support

/** Take the set of changed keys (moves them out of pending). */
export function takePending() {
  const p = pending;
  pending = {};
  scheduleSave('pending');
  return p;
}

/** Put keys back after a failed sync. */
export function restorePending(p) {
  for (const [name, v] of Object.entries(p)) {
    const cur = (pending[name] ||= { up: new Set(), del: new Set() });
    for (const k of v.up) if (!cur.del.has(k)) cur.up.add(k);
    for (const k of v.del) if (!cur.up.has(k)) cur.del.add(k);
  }
  scheduleSave('pending');
}

export function hasPending() {
  return Object.values(pending).some((v) => v.up.size || v.del.size);
}

export function pendingCount() {
  return Object.values(pending).reduce((n, v) => n + v.up.size + v.del.size, 0);
}

/** Mark every synced row as changed (first push to a new sheet, after import). */
export function markAllPending() {
  for (const name of SYNCED_TABLES) {
    for (const r of tables[name]) markChanged(name, rowKey(name, r), false);
  }
}

/**
 * Merge sheet rows with local edits.
 *   remote: rows read from the sheet
 *   taken:  keys this sync is pushing (from takePending)
 *   live:   keys changed since the sync started (still in pending)
 * Replaces the local table with remote + taken edits + live edits. Returns
 * { toWrite: remote + taken edits, remoteDirty: toWrite differs from the sheet,
 *   localChanged: the local table's contents changed }.
 */
export function mergeTable(table, remote, taken) {
  const key = (r) => rowKey(table, r);
  const before = tables[table];
  const localByKey = new Map(before.map((r) => [key(r), r]));
  const remoteByKey = new Map(remote.map((r) => { const n = normalizeRow(table, r); return [key(n), n]; }));
  const merged = new Map(remoteByKey);
  const apply = (p) => {
    if (!p) return;
    for (const k of p.del) merged.delete(k);
    for (const k of p.up) {
      const r = localByKey.get(k);
      if (r) merged.set(k, r); else merged.delete(k);
    }
  };
  apply(taken);
  const toWrite = [...merged.values()];
  apply(pending[table]);
  tables[table] = [...merged.values()];
  const same = (a, b) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));
  const remoteDirty = toWrite.length !== remote.length || toWrite.some((r) => !same(r, remoteByKey.get(key(r))));
  const localChanged = tables[table].length !== before.length || tables[table].some((r) => !same(r, localByKey.get(key(r))));
  if (localChanged) scheduleSave('data');
  return { toWrite, remoteDirty, localChanged };
}

/** Wipe everything on this device (sign-out / switch account). */
export function clearLocal() {
  tables = emptyTables();
  pending = {};
  scheduleSave('data', 'cache', 'pending');
  saveNow();
}

/** For tests: replace state directly. */
export function _reset(data = {}) {
  tables = emptyTables();
  pending = {};
  for (const [k, v] of Object.entries(data)) tables[k] = v.map((r) => normalizeRow(k, r));
}

// ---------------------------------------------------------------- backup

/** Every synced table, for a JSON backup. */
export function exportAll() {
  return { format: `${APP_ID}-backup`, version: 1, exported_at: nowSQL(), tables: tablesWhere(true) };
}

/** Replace every synced table with a backup's contents (everything becomes pending). */
export function replaceAll(backup) {
  const src = backup?.tables;
  if (backup?.format !== `${APP_ID}-backup` || !src) throw new Error('不是這個系統的備份檔');
  for (const name of SYNCED_TABLES) {
    for (const r of tables[name]) markChanged(name, rowKey(name, r), true);
    tables[name] = Array.isArray(src[name]) ? src[name].map((r) => normalizeRow(name, r)) : [];
    for (const r of tables[name]) markChanged(name, rowKey(name, r), false);
  }
}
