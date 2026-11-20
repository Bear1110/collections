// Keeps the local tables (js/db.js) and the user's Google Sheet in step.
//
// Local first: every change lands in localStorage immediately and is recorded
// as pending. A sync reads every tab, overlays this device's pending edits
// (last writer wins per row), writes back the tabs that differ, and adopts the
// merged result locally.
//
// Which spreadsheet (config.js SHEET_MODE):
//   'own'  the one this app created (found again by its APP_PROPERTY mark); created on first sync.
//   'pick' the one this device used last. Otherwise, if the account has exactly one, that one;
//          if it has none or several, or lost access to the last one, the status becomes 'choose'
//          and the user picks (or creates) one. Ported from color-picker.

import * as auth from './auth.js';
import { openSpreadsheet, openSpreadsheetById, newSpreadsheet, listSpreadsheets, fetchEmail, ApiError, NotOurSheetError } from './sheets.js';
import { pickSpreadsheet, pickerAvailable } from './picker.js';
import * as db from '../db.js';
import { APP_ID, SHEET_MODE } from '../config.js';

const SHEET_ID_KEY = `${APP_ID}.sheetId`;
const LOST_KEY = `${APP_ID}.sheetLost`; // lost access to the last sheet: never pick one silently
const AUTO_SYNC_DELAY_MS = 2000;
const PERIODIC_SYNC_MS = 5 * 60 * 1000;

let sheet = null;
let running = null;
let again = false;
let switching = false;
let timer = null;
let expiryTimer = null;
const listeners = new Set();
/** chooseReason（status 'choose'）：'none' 還沒有表、'many' 有好幾份、'lost' 打不開之前那份 */
export const state = { status: 'idle', error: null, lastSync: null, chooseReason: null };

export const canChoose = SHEET_MODE === 'pick';
export { pickerAvailable };

/** 沒有權杖時的狀態：沒設定 CLIENT_ID 是本機；登入過是過期；沒登入過是未登入 */
const noTokenStatus = () => (auth.isConfigured() ? (auth.getEmail() ? 'expired' : 'signed-out') : 'local');

function setStatus(status, error = null) {
  state.status = status;
  state.error = error;
  for (const fn of listeners) fn(state);
  // 網頁一直開著時，權杖到期那一刻沒有事件：到期時再檢查一次，狀態才會切成「需要重新連線」
  clearTimeout(expiryTimer);
  if (auth.hasValidToken()) expiryTimer = setTimeout(() => scheduleSync(0), auth.msUntilExpiry() + 1000);
}

export function onStatus(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export const sheetURL = () => sheet?.url ?? null;
/** 目前用的試算表：{ id, url, name, owner, mine }（name 等只有 SHEET_MODE 'pick' 才有），沒有回傳 null */
export const currentSheet = () => (sheet ? { ...(sheet.info ?? {}), id: sheet.id, url: sheet.url } : null);

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};

class NeedsChoice extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function useOpened(s) {
  sheet = s;
  store.set(SHEET_ID_KEY, s.id);
  store.set(LOST_KEY, null);
  return s;
}

/** lost: lost access to it, so never pick another one silently */
function forgetSheet({ lost = false } = {}) {
  sheet = null;
  store.set(SHEET_ID_KEY, null);
  store.set(LOST_KEY, lost ? '1' : null);
}

const noAccess = (e) => e instanceof NotOurSheetError || (e instanceof ApiError && [403, 404].includes(e.status));

async function ensureSheet(token) {
  if (sheet) return sheet;
  if (!canChoose) {
    const { sheet: s, created } = await openSpreadsheet(token, { cachedId: store.get(SHEET_ID_KEY) });
    useOpened(s);
    if (created) db.markAllPending(); // a brand-new sheet gets everything on this device
    return s;
  }
  const id = store.get(SHEET_ID_KEY);
  if (id) {
    try {
      return useOpened(await openSpreadsheetById(token, id));
    } catch (e) {
      if (!noAccess(e)) throw e;
      forgetSheet({ lost: true });
    }
  }
  if (store.get(LOST_KEY)) throw new NeedsChoice('lost');
  const list = await listSpreadsheets(token);
  if (list.length === 1) return useOpened(await openSpreadsheetById(token, list[0].id, list[0]));
  throw new NeedsChoice(list.length ? 'many' : 'none');
}

function requireToken() {
  const token = auth.getToken();
  if (!token) throw new Error('Google 登入過期了，請重新登入');
  return token;
}

/** 可以選的試算表（見 sheets.listSpreadsheets） */
export const listSheets = () => listSpreadsheets(requireToken());

/** 打開 Google 檔案選擇器選別份。回傳 id，取消回傳 null */
export const pickSheet = () => pickSpreadsheet(requireToken());

/**
 * 換一份試算表。先打開（檢查）新的表，才動這台電腦的資料。clearLocal：先清掉這台的資料
 * （它屬於上一份表）；不清的話，還沒上傳的修改會併進新的表。
 */
async function switchTo(open, { clearLocal = false, uploadAll = false } = {}) {
  const token = requireToken();
  switching = true;
  try {
    clearTimeout(timer);
    await running;
    const s = await open(token);
    if (clearLocal) db.clearLocal();
    useOpened(s);
    if (uploadAll) db.markAllPending();
  } finally {
    switching = false;
  }
  return syncNow();
}

/** info：listSheets() 的那一筆（從清單選的話） */
export const useSheet = (id, opts, info) => switchTo((token) => openSpreadsheetById(token, id, info), opts);

/** 建立新的空表。沒有 clearLocal 的話，這台電腦的資料全部上傳過去 */
export const createSheet = ({ clearLocal = false } = {}) => switchTo(newSpreadsheet, { clearLocal, uploadAll: !clearLocal });

/** Run a sync now (coalesces with one already running). Resolves true if data changed. */
export function syncNow() {
  if (switching) return Promise.resolve(false);
  if (running) { again = true; return running; }
  running = (async () => {
    let changed = false;
    try {
      do {
        again = false;
        changed = (await syncOnce()) || changed;
      } while (again);
    } finally {
      running = null;
    }
    if (changed) window.appRefresh?.();
    return changed;
  })();
  return running;
}

async function syncOnce() {
  const token = auth.getToken();
  if (!token) {
    setStatus(noTokenStatus());
    return false;
  }
  setStatus('syncing');
  const taken = db.takePending();
  try {
    const s = await ensureSheet(token);
    const remote = await s.readAll(token);
    const writes = {};
    let localChanged = false;
    for (const table of db.SYNCED_TABLES) {
      const m = db.mergeTable(table, remote[table] || [], taken[table]);
      if (m.remoteDirty) writes[table] = m.toWrite;
      localChanged ||= m.localChanged;
    }
    await s.writeTables(token, writes);
    state.lastSync = new Date();
    state.chooseReason = null;
    setStatus(db.hasPending() ? 'pending' : 'synced');
    return localChanged;
  } catch (e) {
    db.restorePending(taken);
    if (e instanceof NeedsChoice) {
      state.chooseReason = e.reason;
      setStatus('choose');
    } else if (e instanceof ApiError && e.status === 401) {
      auth.invalidateToken();
      setStatus('expired');
    } else {
      console.error('sync failed', e);
      if (noAccess(e)) sheet = null; // 下次重新打開：打不開的話（'pick'）就請使用者重選
      setStatus('error', e.message);
    }
    return false;
  }
}

function scheduleSync(delay = AUTO_SYNC_DELAY_MS) {
  if (state.status === 'choose') return; // 等使用者選表
  if (!auth.hasValidToken()) {
    // 登入過就一律顯示過期（就算沒有待上傳的修改，也收不到別台裝置的修改）
    setStatus(db.hasPending() || auth.getEmail() ? noTokenStatus() : state.status);
    return;
  }
  if (state.status === 'synced' && db.hasPending()) setStatus('pending'); // 等待自動同步的這 2 秒也顯示待同步
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
}

/** Must be called synchronously from a click handler (opens the Google popup). */
export function signIn() {
  const firstTime = !auth.getEmail();
  return auth.requestToken({ firstTime }).then(async (token) => {
    const email = await fetchEmail(token);
    const prev = auth.getEmail();
    if (prev && prev !== email) {
      // Different account: this device's copy belongs to the previous one.
      db.clearLocal();
      forgetSheet();
    }
    auth.setEmail(email);
    await syncNow();
    return email;
  });
}

export function signOut({ clearData = false } = {}) {
  auth.signOut();
  forgetSheet();
  if (clearData) db.clearLocal();
  setStatus('signed-out');
}

export async function initSync() {
  await auth.initAuth().catch((e) => console.warn('auth init failed', e));
  db.onChange(() => scheduleSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  });
  setInterval(() => scheduleSync(0), PERIODIC_SYNC_MS);
  if (auth.hasValidToken()) syncNow();
  else setStatus(noTokenStatus());
}

export { auth };
