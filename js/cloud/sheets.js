// Google Sheets / Drive REST calls. One spreadsheet, one tab per synced table.
//
// Tabs are found by fixed sheetId, so a renamed tab keeps working. Columns are
// matched by header name, so reordering columns in the sheet is safe; columns
// the sheet lacks are appended on the right.

import { APP_PROPERTY, APP_NAME, SPREADSHEET_TITLE } from '../config.js';
import { SCHEMA, SYNCED_TABLES, RETIRED_SHEET_IDS } from '../db.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

// 分頁編號寫在 SCHEMA[table].sheetId（只能新增、不能改號）
export const SHEET_IDS = Object.fromEntries(SYNCED_TABLES.map((t) => [t, SCHEMA[t].sheetId]));
{
  const used = Object.values(SHEET_IDS);
  if (used.some((id) => !(id > 0))) throw new Error('每張 synced 的表都要有 sheetId');
  if (new Set(used).size !== used.length) throw new Error('sheetId 重複了');
  for (const id of used) if (RETIRED_SHEET_IDS.includes(id)) throw new Error(`sheetId ${id} 已經停用，請換一個新的`);
}

// A cell holds at most 50,000 characters.
const MAX_CELL = 49000;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(token, url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? null : res.json();
}

const quoteTitle = (title) => `'${title.replace(/'/g, "''")}'`;

const columnsOf = (table) => Object.keys(SCHEMA[table].columns);

export async function fetchEmail(token) {
  const info = await api(token, 'https://www.googleapis.com/oauth2/v3/userinfo');
  return info.email;
}

const FILE_FIELDS = 'id,name,modifiedTime,ownedByMe,owners(displayName,emailAddress),appProperties';

const fileInfo = (f) => ({
  id: f.id,
  name: f.name,
  modifiedTime: f.modifiedTime,
  mine: !!f.ownedByMe,
  owner: f.owners?.[0]?.displayName || f.owners?.[0]?.emailAddress || '',
  marked: f.appProperties?.[APP_PROPERTY.key] === APP_PROPERTY.value, // 有沒有這個網站的標記
});

async function getFileInfo(token, id) {
  return fileInfo(await api(token, `${DRIVE}/${id}?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`));
}

/**
 * SHEET_MODE 'pick'：這個網站看得到的試算表，新的在前。網站建立的（有 APP_PROPERTY 標記），
 * 加上用檔案選擇器選過一次的（選的時候會補上標記）。
 */
export async function listSpreadsheets(token) {
  const q = `appProperties has { key='${APP_PROPERTY.key}' and value='${APP_PROPERTY.value}' } and trashed = false`;
  const url = `${DRIVE}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`files(${FILE_FIELDS})`)}&orderBy=modifiedTime desc&includeItemsFromAllDrives=true&supportsAllDrives=true`;
  const { files } = await api(token, url);
  return files.map(fileInfo);
}

/** SHEET_MODE 'own'：網站建立的那一份（有好幾份就用最新的） */
async function findSpreadsheet(token) {
  return (await listSpreadsheets(token))[0]?.id ?? null;
}

const headerRow = (values) => ({
  values: values.map((v) => ({ userEnteredValue: { stringValue: v }, userEnteredFormat: { textFormat: { bold: true } } })),
});

function tabSpec(table) {
  return {
    properties: { sheetId: SHEET_IDS[table], title: table, gridProperties: { frozenRowCount: 1 } },
    data: [{ startRow: 0, startColumn: 0, rowData: [headerRow(columnsOf(table))] }],
  };
}

async function createSpreadsheet(token) {
  const sheet = await api(token, SHEETS, {
    method: 'POST',
    body: {
      properties: { title: SPREADSHEET_TITLE, locale: 'zh_TW', timeZone: 'Asia/Taipei' },
      sheets: SYNCED_TABLES.map(tabSpec),
    },
  });
  await api(token, `${DRIVE}/${sheet.spreadsheetId}`, {
    method: 'PATCH',
    body: { appProperties: { [APP_PROPERTY.key]: APP_PROPERTY.value } },
  });
  return sheet.spreadsheetId;
}

/** Spreadsheet serial date (days since 1899-12-30) → YYYY-MM-DD. */
function serialToDate(n) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

function cellToValue(type, col, v) {
  if (v === undefined || v === null) return undefined;
  if (v === '') return type === 'text' ? '' : undefined;
  // Someone typed a date into the sheet: Sheets turned it into a serial number.
  if (type === 'text' && typeof v === 'number' && /(^|_)date$/.test(col)) return serialToDate(v);
  if (type === 'text') return String(v);
  return v;
}

function valueToCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && v.length > MAX_CELL) return v.slice(0, MAX_CELL) + '…(truncated)';
  return v;
}

export class Spreadsheet {
  constructor(id, titles, info = null) {
    this.id = id;
    this.info = info; // { name, owner, mine, modifiedTime }（SHEET_MODE 'pick' 才有）
    this.titles = titles; // sheetId -> title
    this.headers = {}; // table -> [header names] as last read
    this.rows = {}; // table -> rows holding data (header included), as last read
  }

  get url() {
    return `https://docs.google.com/spreadsheets/d/${this.id}/edit`;
  }

  range(table, a1 = '') {
    return quoteTitle(this.titles[SHEET_IDS[table]]) + (a1 ? `!${a1}` : '');
  }

  /** Add tabs that are missing (older sheet, or a tab the user deleted). Returns true if any. */
  async ensureTabs(token) {
    const missing = SYNCED_TABLES.filter((t) => !this.titles[SHEET_IDS[t]]);
    if (!missing.length) return false;
    const taken = new Set(Object.values(this.titles));
    const requests = missing.map((t) => ({
      addSheet: { properties: { sheetId: SHEET_IDS[t], title: taken.has(t) ? `${t}_${SHEET_IDS[t]}` : t, gridProperties: { frozenRowCount: 1 } } },
    }));
    await api(token, `${SHEETS}/${this.id}:batchUpdate`, { method: 'POST', body: { requests } });
    this.titles = await getSheetTitles(token, this.id);
    return true;
  }

  /** Read every synced tab: { table: [row objects] }. */
  async readAll(token) {
    const ranges = SYNCED_TABLES.map((t) => `ranges=${encodeURIComponent(this.range(t))}`).join('&');
    const data = await api(token, `${SHEETS}/${this.id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
    const out = {};
    SYNCED_TABLES.forEach((table, i) => {
      const rows = data.valueRanges?.[i]?.values ?? [];
      const headers = (rows[0] ?? []).map((h) => String(h).trim());
      this.headers[table] = headers;
      this.rows[table] = rows.length; // the API drops empty trailing rows: this is the last used row
      const cols = SCHEMA[table].columns;
      out[table] = [];
      for (const row of rows.slice(1)) {
        if (!row.some((c) => c !== '' && c != null)) continue;
        const obj = {};
        headers.forEach((h, j) => {
          if (h in cols) {
            const v = cellToValue(cols[h], h, row[j]);
            if (v !== undefined) obj[h] = v;
          }
        });
        out[table].push(obj);
      }
    });
    return out;
  }

  /**
   * Rewrite whole tabs: { table: rows }. Rows are written over the old ones first
   * and only then is the leftover tail cleared, so a failure midway never leaves
   * a tab empty. Only rows that held data are cleared: a range past the grid is rejected.
   */
  async writeTables(token, byTable) {
    const data = [];
    const clears = [];
    for (const [table, rows] of Object.entries(byTable)) {
      const have = this.headers[table] ?? [];
      const headers = [...have, ...columnsOf(table).filter((c) => !have.includes(c))];
      this.headers[table] = headers;
      const values = [headers, ...rows.map((r) => headers.map((h) => valueToCell(r[h])))];
      data.push({ range: this.range(table, 'A1'), values });
      const old = this.rows[table] ?? 0;
      if (old > values.length) clears.push(this.range(table, `${values.length + 1}:${old}`)); // whole rows
    }
    if (!data.length) return;
    await api(token, `${SHEETS}/${this.id}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: 'RAW', data },
    });
    if (clears.length) await api(token, `${SHEETS}/${this.id}/values:batchClear`, { method: 'POST', body: { ranges: clears } });
  }
}

async function getSheetTitles(token, spreadsheetId) {
  const meta = await api(token, `${SHEETS}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`);
  const titles = {};
  for (const s of meta.sheets) titles[s.properties.sheetId] = s.properties.title;
  return titles;
}

/**
 * Find (or create) the user's spreadsheet. cachedId comes from localStorage and
 * is re-searched when stale. Returns { sheet, created }.
 */
export async function openSpreadsheet(token, { cachedId }) {
  if (cachedId) {
    try {
      const sheet = new Spreadsheet(cachedId, await getSheetTitles(token, cachedId));
      await sheet.ensureTabs(token);
      return { sheet, created: false };
    } catch (e) {
      if (!(e instanceof ApiError) || ![403, 404].includes(e.status)) throw e;
    }
  }
  let id = await findSpreadsheet(token);
  let created = false;
  if (!id) { id = await createSpreadsheet(token); created = true; }
  const sheet = new Spreadsheet(id, await getSheetTitles(token, id));
  await sheet.ensureTabs(token);
  return { sheet, created };
}

// ---------------------------------------------------------------- SHEET_MODE 'pick'

export class NotOurSheetError extends Error {
  constructor() { super(`這份試算表不是「${APP_NAME}」的資料表，請選別份`); }
}

/** 至少有一個同步分頁（靠 sheetId 認）才算是這個網站的表；空的新表也可以（會補上分頁） */
function looksLikeOurs(titles) {
  const ids = Object.keys(titles).map(Number);
  if (Object.values(SHEET_IDS).some((id) => ids.includes(id))) return true;
  return ids.length === 1 && /^(Sheet|工作表)\s*1$/i.test(Object.values(titles)[0]); // 剛建立、什麼都沒有的表
}

/**
 * 打開使用者選的那一份（檢查過是這個網站的表），補上缺的分頁和 APP_PROPERTY 標記（之後 listSpreadsheets 才找得到）。
 * info：listSpreadsheets 的那一筆，有的話少問一次。
 */
export async function openSpreadsheetById(token, id, info = null) {
  const [titles, file] = await Promise.all([getSheetTitles(token, id), info ?? getFileInfo(token, id)]);
  if (!looksLikeOurs(titles)) throw new NotOurSheetError();
  const sheet = new Spreadsheet(id, titles, file);
  await sheet.ensureTabs(token);
  if (!file.marked) { // 用檔案選擇器選的別份：補上標記，之後清單才找得到（別人的表可能沒權限改，沒關係）
    await api(token, `${DRIVE}/${id}?supportsAllDrives=true`, { method: 'PATCH', body: { appProperties: { [APP_PROPERTY.key]: APP_PROPERTY.value } } }).catch(() => {});
  }
  return sheet;
}

/** 建立一份新的空表 */
export async function newSpreadsheet(token) {
  return openSpreadsheetById(token, await createSpreadsheet(token));
}
