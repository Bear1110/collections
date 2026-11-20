// 收藏整理：衣服、書、代購三頁（欄位寫死在 js/model.js 的 KINDS）；設定頁（Google 同步、匯出／匯入、危險區）沿用 reze-helper。
// 資料規則在 js/model.js（有測試），這個檔案只負責畫面。UI 規則見 docs/ui-guidelines.md。

import * as db from './db.js';
import * as sync from './cloud/sync.js';
import * as M from './model.js';
import { APP_ID, APP_NAME, CLIENT_ID } from './config.js';
import { $, modal, esc, fmt, toast, info, icon, svgIcon, confirmTyped, openModal, closeModal, modalHeader,
  applyIcons, initSegmented, initTapTips, downloadFile } from './ui.js';
import { watchForUpdate } from './update.js';

const page = $('#page');
const state = { tab: 'clothes', search: {}, filters: {} }; // search、filters 依種類（clothes／books／proxy）分開記
let updateReady = false; // 網站有新版本

const CURRENCY_LABEL = { TWD: '台幣', JPY: '日圓', USD: '美金', EUR: '歐元' };

/** 設定裡存成 JSON 陣列的清單 */
function settingList(key) {
  const v = M.parseJSON(db.getSetting(key), []);
  return Array.isArray(v) ? v : [];
}
const setSettingList = (key, list) => db.setSetting(key, JSON.stringify(list));
const CLOSED_KEY = 'closed.proxy'; // 結清的批次（標籤，小寫）
const hiddenKey = (kind, key) => `hidden.${kind}.${key}`; // 不再推薦的快速按鈕（小寫）
const closedSet = () => new Set(settingList(CLOSED_KEY));
const PAID_KEY = 'paid.proxy'; // 收過錢的「批次|人」（小寫，見 M.payKey）
const paidSet = () => new Set(settingList(PAID_KEY));

const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true });
const itemsOf = (kind) => db.where('items', (i) => i.kind === kind);

/** 單選欄位的選項：寫死的基本選項＋物品上出現過的其他值（新的人、新的批次…） */
function withSeen(kind, fields) {
  const items = itemsOf(kind);
  return fields.map((f) => (f.type === 'choice' ? { ...f, options: M.optionValues(f, items).map((o) => o.value) } : f));
}

// ---------------------------------------------------------------- 分頁列（固定：衣服、書、代購、設定）

function renderNav() {
  const tab = (key, iconName, label) =>
    `<a class="tab-btn" href="#${key}" data-tab="${key}"><span class="tab-icon" data-icon="${iconName}"></span><span class="tab-label">${esc(label)}</span></a>`;
  const html = [...M.KIND_IDS.map((k) => tab(k, M.KINDS[k].icon, M.KINDS[k].name)), tab('settings', 'gear', '設定')].join('');
  const nav = $('#nav-tabs');
  if (nav.innerHTML !== html) { nav.innerHTML = html; applyIcons(nav); }
  for (const a of nav.querySelectorAll('.tab-btn')) a.classList.toggle('active', a.dataset.tab === state.tab);
}

// ---------------------------------------------------------------- 種類頁（物品清單）

function cellHTML(f, v, d = {}) {
  if (v == null || v === '') return '';
  if (f.type === 'choice' && f.tones) return badge(f, v);
  if (f.type === 'url') {
    const l = M.linkOf(v);
    return `<a class="link-cell" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer" title="${esc(String(v))}">${l.search ? icon('search') : icon('external')}${esc(l.text)}</a>`;
  }
  if (f.type === 'money') {
    const twd = M.moneyTWD(v);
    const m = M.normMoney(v);
    const unit = m?.c === 'TWD' ? `NT$${fmt(m.a, 0)}`
      : twd == null ? `<span class="tag tag-warn" title="沒有匯率，算不出台幣">${esc(M.fmtMoney(v))}</span>` : `<span title="${esc(M.fmtMoney(v))}">NT$${fmt(twd, 0)}</span>`;
    const q = M.qtyOf(f, d);
    if (q === 1) return unit;
    const line = M.lineTWD(f, d);
    return `${unit}<div class="row-note">×${fmt(q)}${line == null ? '' : ` = NT$${fmt(line, 0)}`}</div>`;
  }
  if (f.type === 'tags') return M.normTags(v).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ');
  return esc(M.textOf(f, v));
}

/** 有顏色的單選值（代購的待買／已買／缺貨、衣服的想丟／已丟） */
const badge = (f, v, extra = '') => `<span class="badge tone-${f.tones?.[v] ?? 'none'}">${esc(v || '未填')}${extra}</span>`;

function kindView(kind) {
  const k = M.KINDS[kind];
  const fields = M.fieldsOf(kind);
  const filters = (state.filters[kind] ||= {});
  const q = state.search[kind] ?? '';
  const pool = itemsOf(kind);
  const { items: visible, hidden } = M.hideByDefault(pool, fields, filters); // 衣服的「已丟」平常不顯示
  const shown = M.filterItems(visible, fields, { filters, q }).sort(byName);
  const group = fields.find((f) => f.key === k.group_by);
  const cols = fields.filter((f) => f.list && f !== group);
  const money = fields.find((f) => f.type === 'money');
  const foreign = M.foreignCurrencies(shown, fields); // 顯示中的物品用到的外幣（「匯率」按鈕、整批改匯率）
  return { foreign, kind, k, fields, filters, q, all: visible, shown, group, cols, money, hidden, pool };
}

/** 備註：常常是重要的補充（想丟的原因、要什麼顏色、預算），所以用看得到的顏色；#標籤（批次）另外標出來 */
function noteHTML(note, { dropTags = false } = {}) {
  if (dropTags) note = M.noteTags(note).reduce((n, t) => M.removeTag(n, t), note ?? '');
  if (!note) return '';
  let html = '';
  let last = 0;
  for (const m of note.matchAll(M.TAG_RE)) {
    html += esc(note.slice(last, m.index)) + `<span class="note-tag">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return `<div class="item-note">${html}${esc(note.slice(last))}</div>`;
}

/** 手機（< 600px）用卡片、電腦用表格：只畫用得到的那一種，螢幕寬度跨過去時重畫（見 init） */
const PHONE = matchMedia('(max-width: 599px)');

/** 表格和卡片共用：空白訊息、分組（篩了分組欄位就不分）、分組標題的件數和金額 */
function listHTML(v, item, groupHead, empty) {
  const { shown, group, all, filters, fields, money } = v;
  if (!shown.length) return empty(!all.length ? '還沒有東西。按「新增」開始。' : '沒有符合的。換個關鍵字或清除篩選。');
  if (!group || filters[group.key]) return shown.map(item).join('');
  return M.groupItems(shown, group).map((g) =>
    groupHead(`${esc(g.value)}<small>${g.items.length} 件${groupMoney(g.items, money, fields)}</small>`) + g.items.map(item).join('')).join('');
}

function itemRows(v) {
  const { cols } = v;
  const row = (i) => {
    const d = M.dataOf(i);
    return `<tr class="click-row" data-action="edit-item" data-id="${i.id}">
      <td><b>${esc(i.name)}</b>${noteHTML(i.note)}</td>
      ${cols.map((f) => `<td class="${f.type === 'money' || f.type === 'number' ? 'num' : ''}">${cellHTML(f, d[f.key], d)}</td>`).join('')}
    </tr>`;
  };
  return `<div class="table-wrap"><table>
    <thead><tr><th>名稱</th>${cols.map((f) => `<th class="${f.type === 'money' || f.type === 'number' ? 'num' : ''}">${esc(f.label)}</th>`).join('')}</tr></thead>
    <tbody>${listHTML(v, row, (h) => `<tr class="group-row"><td colspan="${cols.length + 1}">${h}</td></tr>`,
      (t) => `<tr><td colspan="${cols.length + 1}" class="empty-state">${t}</td></tr>`)}</tbody></table></div>`;
}

/**
 * 手機的卡片：第一行名稱＋金額，第二行其他欄位用「·」串起來，下面備註，最後一行是直接改的單選和網址。
 * 數量不另外寫（金額下面已經有 ×數量＝小計）；欄位的 quietValues（衣服的「在穿」）不寫。
 */
function itemCards(v) {
  const { cols, fields } = v;
  const qtyKeys = new Set(fields.filter((f) => f.type === 'money' && f.qty).map((f) => f.qty));
  const moneyCols = cols.filter((f) => f.type === 'money');
  const actionCols = cols.filter((f) => f.type === 'url');
  const metaCols = cols.filter((f) => f.type !== 'money' && !actionCols.includes(f) && !qtyKeys.has(f.key));
  const card = (i) => {
    const d = M.dataOf(i);
    const meta = metaCols.filter((f) => !(f.quietValues ?? []).includes(d[f.key]))
      .map((f) => { const c = cellHTML(f, d[f.key], d); return c && f.type === 'number' ? `${esc(f.label)} ${c}` : c; }).filter(Boolean);
    const actions = actionCols.map((f) => cellHTML(f, d[f.key], d)).join('');
    return `<div class="item-card" data-action="edit-item" data-id="${i.id}">
      <div class="ic-top"><b>${esc(i.name)}</b>${moneyCols.map((f) => `<span class="ic-money">${cellHTML(f, d[f.key], d)}</span>`).join('')}</div>
      ${meta.length ? `<div class="ic-meta">${meta.join('<span class="ic-dot">·</span>')}</div>` : ''}
      ${noteHTML(i.note)}
      ${actions ? `<div class="ic-actions">${actions}</div>` : ''}
    </div>`;
  };
  return listHTML(v, card, (h) => `<div class="ic-group">${h}</div>`, (t) => `<p class="empty-state">${t}</p>`);
}

const listBody = (v) => (PHONE.matches ? itemCards(v) : itemRows(v));

/** 分組標題的金額合計（不算錢的、沒匯率的不算） */
function groupMoney(items, money, fields) {
  if (!money) return '';
  const s = M.sumTWD(items, money, fields);
  return s.total ? ` · NT$${fmt(s.total, 0)}` : '';
}

function summaryText(v) {
  const { shown, all, money, fields } = v;
  const parts = [shown.length === all.length ? `共 ${all.length} 件` : `顯示 ${shown.length}／${all.length} 件`];
  if (money) {
    const s = M.sumTWD(shown, money, fields);
    if (s.total) parts.push(`合計 NT$${fmt(s.total, 0)}`);
    if (s.missing) parts.push(`${s.missing} 件外幣沒填匯率，沒算進去`);
  }
  for (const h of v.hidden) parts.push(`${h.field.hideValues.join('、')}的 ${h.n} 件沒顯示（篩選「${h.field.label}」可以看）`);
  return parts.join(' · ');
}

/** 篩選列：單選欄位，選項後面附件數 */
function filterSelect(f, all, current) {
  const counts = M.countBy(all, f);
  const opts = counts.map(({ value, n }) =>
    `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)} ${n}</option>`).join('');
  return `<div class="filter-row"><span class="filter-label">${esc(f.label)}</span>
    <select data-filter="${f.key}" data-segmented="6" aria-label="${esc(f.label)}"><option value="">全部</option>${opts}</select></div>`;
}

function renderKind(kind) {
  const v = kindView(kind);
  const filterFields = v.fields.filter((f) => f.filter && (f.type === 'choice' || f.type === 'tags'));
  const main = filterFields.find((f) => f === v.group) ?? null;
  const rest = filterFields.filter((f) => f !== main);
  const activeRest = rest.filter((f) => v.filters[f.key]).length;
  page.innerHTML = `
    <section class="card">
      <div class="card-header">
        <h3>${icon(v.k.icon)}${esc(v.k.name)}<small class="card-meta">${v.all.length} 件</small></h3>
        <div class="header-actions">
          ${v.foreign.length ? `<button type="button" class="btn btn-outline btn-sm" data-action="set-rate" data-kind="${kind}" title="整批改匯率" aria-label="整批改匯率">${icon('coins')}<span class="wide-only">匯率</span></button>` : ''}
          <button type="button" class="btn btn-outline btn-sm" data-action="export-csv" data-kind="${kind}" title="下載 CSV" aria-label="下載 CSV">${icon('download')}<span class="wide-only">CSV</span></button>
          <button type="button" class="btn btn-primary btn-sm" data-action="new-item" data-kind="${kind}">${icon('plus')}新增</button>
        </div>
      </div>
      <p class="form-hint card-hint" id="summary">${esc(summaryText(v))}</p>
      ${main ? filterSelect(main, main.hideValues ? v.pool : v.all, v.filters[main.key] ?? '') : ''}
      ${rest.length ? `<details class="filter-box" ${activeRest ? 'open' : ''}><summary>${icon('filter')}篩選${activeRest ? `（${activeRest}）` : ''}</summary>
        ${rest.map((f) => filterSelect(f, f.hideValues ? v.pool : v.all, v.filters[f.key] ?? '')).join('')}
        ${activeRest ? `<button type="button" class="btn btn-outline btn-sm" data-action="clear-filters" data-kind="${kind}">清除篩選</button>` : ''}</details>` : ''}
      <input class="search-input" id="search" type="search" placeholder="搜尋名稱、欄位、備註…" value="${esc(v.q)}">
      <div id="item-list">${listBody(v)}</div>
    </section>`;
  // 打字時只重畫表格內容，搜尋框不動（游標、輸入法都不受影響）
  $('#search').oninput = (e) => {
    state.search[kind] = e.target.value;
    const view = kindView(kind);
    $('#item-list').innerHTML = listBody(view);
    $('#summary').textContent = summaryText(view);
    applyIcons($('#item-list'));
  };
  for (const sel of page.querySelectorAll('[data-filter]')) {
    sel.onchange = () => {
      if (sel.value) v.filters[sel.dataset.filter] = sel.value; else delete v.filters[sel.dataset.filter];
      saveFilters();
      render();
    };
  }
}

// ================================================================ 代購
// 這一趟（標題、總覽、進度）→ 朋友的購物清單（篩選）→ 每個朋友一張卡片（目前應收、收款）→ 商品（狀態）。
// 收款是朋友層級：一趟一個人一次收（settings paid.proxy）；目前應收只算已經買到的。

// 朋友卡片手動展開／收合記在 state.filters.proxy.__open（{ 名字: true/false }，跟篩選一起存）；沒設過：已收款的收起來
const CUR_SIGN = M.CURRENCY_SIGN;
const P_STATUS = M.fieldsOf('proxy').find((x) => x.key === 'f2');
const P_PRICE = M.fieldsOf('proxy').find((x) => x.key === 'f8');
/** 金額：全部同一個幣別就用原幣（¥12,230），混了好幾種就用台幣 */
function moneyText(cur, twd, base = null) {
  const keys = Object.keys(cur);
  if (keys.length === 1) return `${CUR_SIGN[keys[0]]}${fmt(cur[keys[0]], 0)}`;
  if (!keys.length && base) return `${CUR_SIGN[base]}0`; // 還沒買到東西：用這一趟的幣別寫 0
  return `NT$${fmt(twd, 0)}`;
}
/** 這一趟主要的幣別（全部同一種才算） */
const baseCur = (groups) => { const c = new Set(groups.flatMap((g) => Object.keys(g.byCur))); return c.size === 1 ? [...c][0] : null; };
/** 原幣是外幣時，下面小字附上台幣 */
const moneyHint = (cur, twd) => (Object.keys(cur).length === 1 && !cur.TWD && twd ? `<small>約 NT$${fmt(twd, 0)}</small>` : '');

const STATUS_TEXT_P = { 待買: '待購買', 已買: '✓ 已購買', 已交貨: '✓ 已交貨', 缺貨: '缺貨' };
const DONE_LOOSE = '__done'; // 零星（已完成）

/** 這一趟：從 #標籤 來。回傳現在看的是哪一趟、裡面的物品、可以切換的趟 */
function proxyScope() {
  const filters = (state.filters.proxy ||= {});
  const all = itemsOf('proxy');
  const closed = closedSet();
  const paid = paidSet();
  const archived = new Set(all.filter((i) => M.isArchived(i, closed, paid)).map((i) => i.id));
  const open = all.filter((i) => !archived.has(i.id));
  const openTrips = M.batchesOf(open).map((b) => b.tag);
  const hasLoose = open.some((i) => !M.noteTags(i.note).length);
  const closedTrips = settingList(CLOSED_KEY).map((key) => M.noteTags(all.find((i) => M.inBatch(i, key))?.note).find((t) => t.toLowerCase() === key) ?? key);
  const doneLoose = all.some((i) => archived.has(i.id) && !M.noteTags(i.note).length);
  const valid = (t) => t === '' || (t === M.NO_BATCH && hasLoose) || (t === DONE_LOOSE && doneLoose)
    || [...openTrips, ...closedTrips].some((x) => M.sameTag(x, t));
  let trip = filters.__batch;
  if (trip == null || !valid(trip)) trip = openTrips[0] ?? (hasLoose ? M.NO_BATCH : '');
  const isClosed = trip === DONE_LOOSE || closedTrips.some((x) => M.sameTag(x, trip));
  const items = trip === '' ? open
    : trip === M.NO_BATCH ? open.filter((i) => !M.noteTags(i.note).length)
      : trip === DONE_LOOSE ? all.filter((i) => archived.has(i.id) && !M.noteTags(i.note).length)
        : (isClosed ? all : open).filter((i) => M.inBatch(i, trip));
  const title = trip === '' ? '所有進行中' : trip === M.NO_BATCH ? '零星代購' : trip === DONE_LOOSE ? '零星（已完成）' : trip.replace(/^[#＃]/, '');
  return { filters, trip, title, items, isClosed, openTrips, closedTrips, hasLoose, doneLoose, paid };
}

/** 換一趟：原生下拉（手機上就是系統選單） */
function tripSelect(sc) {
  const opt = (v, label) => `<option value="${esc(v)}" ${v === sc.trip ? 'selected' : ''}>${esc(label)}</option>`;
  const open = [...sc.openTrips.map((t) => opt(t, t.replace(/^[#＃]/, ''))), sc.hasLoose ? opt(M.NO_BATCH, '零星代購') : '', sc.openTrips.length + sc.hasLoose > 1 ? opt('', '所有進行中') : ''].join('');
  const done = [...sc.closedTrips.map((t) => opt(t, t.replace(/^[#＃]/, ''))), sc.doneLoose ? opt(DONE_LOOSE, '零星（已完成）') : ''].join('');
  if (!open && !done) return '';
  return `<label class="trip-switch">換一趟 ${svgIcon('chevron-right')}<select id="trip-select" data-keep-select aria-label="換一趟">
    ${open ? `<optgroup label="進行中">${open}</optgroup>` : ''}${done ? `<optgroup label="已結清">${done}</optgroup>` : ''}</select></label>`;
}

/** 狀態膠囊：點了跳原生選單 */
/** 狀態膠囊：看起來是有顏色的按鈕，點了跳原生選單（手機上就是系統選單）。labels：顯示用的文字 */
function choicePill(f, cur, id, labels = {}) {
  return `<label class="pill-select tone-${f.tones?.[cur] ?? 'none'}" title="改${esc(f.label)}"><span>${esc(labels[cur] ?? cur)}</span>
    <select data-quick="${f.key}" data-id="${id}" aria-label="${esc(f.label)}" data-keep-select>${f.options.map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(labels[o] ?? o)}</option>`).join('')}</select></label>`;
}
const statusPill = (cur, id) => choicePill(P_STATUS, cur, id, STATUS_TEXT_P);

/** 一件商品：名稱／規格（＋備註、連結）｜數量｜單價｜狀態。整列依狀態上底色 */
function proxyItemRow(i, dropTags) {
  const d = M.dataOf(i);
  const st = M.statusOf(i);
  const m = M.normMoney(d.f8);
  const link = d.f10 ? M.linkOf(d.f10) : null;
  const sub = [d.f5, d.f6].filter(Boolean);
  return `<div class="pt-row row-${P_STATUS.tones[st] ?? 'none'}" data-action="edit-item" data-id="${i.id}">
    <div class="pt-name"><b>${esc(i.name)}</b>${link ? ` <a class="pt-link" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer" title="${esc(String(d.f10))}" aria-label="開啟商品網址">${svgIcon(link.search ? 'search' : 'external')}</a>` : ''}
      ${sub.length ? `<div class="pt-sub">${sub.map(esc).join(' · ')}</div>` : ''}${noteHTML(i.note, { dropTags })}</div>
    <div class="pt-qty"><span class="narrow-label">×</span>${fmt(M.qtyOf(P_PRICE, d))}</div>
    <div class="pt-price">${m ? `${CUR_SIGN[m.c]}${fmt(m.a)}` : '<span class="text-muted">—</span>'}</div>
    <div class="pt-status">${statusPill(st, i.id)}</div>
  </div>`;
}

/** 一個朋友的卡片 */
function personCard(g, rows, opened, dropTags) {
  const key = g.who.toLowerCase();
  const pct = g.need ? Math.round((g.bought / g.need) * 100) : 0;
  const pending = g.toBuy && g.owed !== g.total ? `<small>全部買到約 ${moneyText(g.byCur, g.total)}</small>` : moneyHint(g.owedCur, g.owed);
  return `<section class="pc${g.paid ? ' is-paid' : ''}${opened ? '' : ' is-collapsed'}">
    <div class="pc-head" data-action="toggle-person" data-who="${esc(key)}" role="button" tabindex="0" aria-expanded="${opened}">
      <span class="avatar">${esc([...g.who][0] ?? '?')}</span>
      <div class="pc-name"><b>${esc(g.who)}</b><span>${g.n} 項商品 · 已買 ${g.bought} 項</span></div>
      <div class="pc-amount"><span>${g.paid ? '已收金額' : '目前應收'}</span><b>${moneyText(g.owedCur, g.owed, baseCur([g]))}</b>${pending}</div>
      <span class="pc-chev">${svgIcon('chevron-right')}</span>
    </div>
    <div class="pc-bar"><i style="width:${pct}%"></i></div>
    <div class="pc-foot">
      <span class="legend"><em class="t-ok">已買 ${g.bought}</em><em class="t-warn">待買 ${g.toBuy}</em><em class="t-bad">缺貨 ${g.oos}</em></span>
      ${g.paid || g.need ? `<button type="button" class="${g.paid ? 'pay-done' : 'btn-soft'}" data-action="toggle-paid" data-keys="${esc(g.keys.join('\n'))}" data-who="${esc(g.who)}"${g.paid ? ' title="按一下改回未收款"' : ''}>${g.paid ? '✓ 已收款' : '標記已收款'}</button>` : ''}
    </div>
    ${opened ? `<div class="pt"><div class="pt-head"><span>商品 / 規格</span><span>數量</span><span>單價</span><span>採購狀態</span></div>
      ${rows.map((i) => proxyItemRow(i, dropTags)).join('')}</div>` : ''}
  </section>`;
}

/** 朋友的購物清單（會跟著篩選、搜尋重畫） */
/** 狀態篩選：待購買／已購買（含已交貨）／缺貨；未收款篩的是人，不篩商品 */
const STATUS_FILTER = { 待買: (s) => s === '待買', 已買: (s) => M.BOUGHT.includes(s), 缺貨: (s) => s === '缺貨' };

function proxyList(sc, groups) {
  const f = sc.filters.__status ?? '';
  const q = state.search.proxy ?? '';
  const fields = M.fieldsOf('proxy');
  const byStatus = STATUS_FILTER[f] ?? (() => true);
  const rowOk = (i) => byStatus(M.statusOf(i)) && M.itemMatches(i, fields, q);
  const opens = sc.filters.__open ?? {};
  const dropTags = sc.trip !== '';
  const cards = groups
    .filter((g) => f !== 'unpaid' || (!g.paid && g.need))
    .map((g) => {
      const rows = g.items.filter(rowOk).sort(byName);
      if ((f || q) && !rows.length) return '';
      const key = g.who.toLowerCase();
      const opened = f || q ? true : opens[key] ?? !g.paid; // 篩選或搜尋時全部打開
      return personCard(g, rows, opened, dropTags);
    }).join('');
  return cards || `<p class="empty-state">${sc.items.length ? '沒有符合的。換個篩選或關鍵字。' : '這一趟還沒有東西。按「新增商品」開始。'}</p>`;
}

function renderProxy() {
  const sc = proxyScope();
  const groups = M.personGroups(sc.items, sc.paid);
  const s2 = M.proxyStats(groups);
  const base = baseCur(groups);
  const fields = M.fieldsOf('proxy');
  const foreign = M.foreignCurrencies(sc.items, fields);
  const f = sc.filters.__status ?? '';
  const pct = s2.need ? Math.round((s2.bought / s2.need) * 100) : 0;
  const w = (n) => (s2.n ? (n / s2.n) * 100 : 0);
  const pill = (v, label, n) => `<button type="button" class="pill${f === v ? ' active' : ''}" data-action="proxy-filter" data-v="${v}">${label}${n != null ? ` <span>${n}</span>` : ''}</button>`;
  const isTag = sc.trip && sc.trip !== M.NO_BATCH && sc.trip !== DONE_LOOSE;
  page.innerHTML = `<div class="kind-page">
    <header class="trip-head">
      <div>
        <div class="crumb">我的代購清單${sc.isClosed ? ' · <span class="badge tone-none">已結清</span>' : ''}</div>
        <h1>${esc(sc.title)}</h1>
        <p class="trip-sub">幫朋友帶點喜歡的東西回家。${tripSelect(sc)}</p>
      </div>
      <div class="trip-actions">
        <details class="more-menu"><summary class="btn btn-outline btn-sm btn-icon" aria-label="更多" title="更多">⋯</summary>
          <div class="more-list">
            ${foreign.length ? `<button type="button" data-action="set-rate" data-kind="proxy">${icon('coins')}整批改匯率</button>` : ''}
            <button type="button" data-action="export-csv" data-kind="proxy">${icon('download')}下載 CSV</button>
            ${isTag && !sc.isClosed ? `<button type="button" data-action="close-batch" data-tag="${esc(sc.trip)}">${icon('check')}結清這一趟</button>` : ''}
            ${isTag && sc.isClosed ? `<button type="button" data-action="reopen-batch" data-tag="${esc(sc.trip)}">${icon('refresh')}重新打開這一趟</button>` : ''}
          </div></details>
        ${sc.isClosed ? '' : `<button type="button" class="btn btn-primary" data-action="new-item" data-kind="proxy">${icon('plus')}新增商品</button>`}
      </div>
    </header>
    ${sc.items.length ? `
    <div class="kpis">
      <div class="kpi"><span>已採購金額 ${svgIcon('wallet')}</span><b>${moneyText(s2.boughtCur, s2.boughtTWD, base)}</b>${moneyHint(s2.boughtCur, s2.boughtTWD)}</div>
      <div class="kpi kpi-warn"><span>等待購買 ${svgIcon('bag')}</span><b>${s2.toBuy} 項</b></div>
      <div class="kpi kpi-ok"><span>已完成採購 ${svgIcon('check')}</span><b>${s2.bought} / ${s2.need} 項</b></div>
      <div class="kpi kpi-bad"><span>尚未收款 ${svgIcon('coins')}</span><b>${moneyText(s2.unpaidCur, s2.unpaidTWD, base)}</b><small>${s2.unpaid} 人還沒付</small></div>
    </div>
    <div class="progress-card">
      <div class="progress-top"><b>整體採購進度</b><span>${pct}%</span></div>
      <div class="stack"><i class="s-ok" style="width:${w(s2.bought)}%"></i><i class="s-warn" style="width:${w(s2.toBuy)}%"></i><i class="s-bad" style="width:${w(s2.oos)}%"></i></div>
      <div class="legend"><em class="t-ok">● 已買 ${s2.bought}</em><em class="t-warn">● 待買 ${s2.toBuy}</em>${s2.oos ? `<em class="t-bad">● 缺貨 ${s2.oos}</em>` : ''}</div>
      ${s2.missing ? `<p class="form-hint">${s2.missing} 件外幣沒填匯率，台幣金額沒算進去。按右上「⋯ → 整批改匯率」補上。</p>` : ''}
    </div>` : ''}
    <div class="list-head"><h2>朋友的購物清單</h2><span>${groups.length} 位朋友 · ${s2.n} 項商品</span></div>
    <div class="list-tools">
      <div class="pills">${pill('', '全部', s2.n)}${pill('待買', '待購買', s2.toBuy)}${pill('已買', '已購買', s2.bought)}${pill('缺貨', '缺貨', s2.oos)}${pill('unpaid', '未收款', s2.unpaid)}</div>
      <input class="search-input" id="search" type="search" placeholder="搜尋商品、規格、備註…" value="${esc(state.search.proxy ?? '')}">
    </div>
    <div id="proxy-list">${proxyList(sc, groups)}</div>
  </div>`;
  $('#search').oninput = (e) => {
    state.search.proxy = e.target.value;
    $('#proxy-list').innerHTML = proxyList(sc, groups); // 打字不會改資料：用這次畫面算好的
    applyIcons($('#proxy-list'));
  };
  const trip = $('#trip-select');
  if (trip) trip.onchange = () => { sc.filters.__batch = trip.value; saveFilters(); render(); };
  $('#proxy-list').onchange = (e) => {
    const sel = e.target.closest('select[data-quick]');
    if (sel) quickChange(Number(sel.dataset.id), sel.dataset.quick, sel.value);
  };
}

// ================================================================ 衣服
// 我的衣櫃（標題、總覽、色系分布）→ 依部位一張卡片 → 每件（顏色方塊｜名稱、品牌、款式｜尺寸｜價格｜狀態）。
// 「已丟」平常不顯示（在「已丟」篩選裡）；狀態膠囊點了直接改。

const C_FIELD = (k) => M.fieldsOf('clothes').find((x) => x.key === k);
const C_PART = C_FIELD('f1');
const C_STATUS = C_FIELD('f9');
const C_COLOR = C_FIELD('f6');
const C_PRICE = C_FIELD('f7');
/** 色系 → 方塊顏色 */
const SWATCH = {
  黑: '#2F2A28', 白: '#FBFAF6', 灰: '#A8A39D', 藍: '#5B7BA6', 綠: '#7E9A6E', 棕: '#8B6A4F', 米: '#D9C9AE',
  紅: '#B85450', 橘: '#D98E4A', 黃: '#E2C25C', 紫: '#8C7AA8', 粉: '#E3A9B2', 牛仔: '#4F6D8F',
  多色: 'linear-gradient(135deg, #D98E4A, #E2C25C 35%, #7E9A6E 65%, #5B7BA6)',
};
const swatchStyle = (fam) => (SWATCH[fam] ? `background:${SWATCH[fam]}` : '');
const clothesStatus = (i) => M.dataOf(i).f9 || C_STATUS.def;
const C_STATUS_FILTER = { '': (s) => s !== '已丟', 想丟: (s) => s === '想丟', 已丟: (s) => s === '已丟', all: () => true };

/** 一件衣服：顏色方塊｜名稱（品牌・款式、備註、連結）｜尺寸｜價格｜狀態 */
function clothesRow(i) {
  const d = M.dataOf(i);
  const st = clothesStatus(i);
  const m = M.normMoney(d.f7);
  const sub = [d.f3, d.f2, d.f5].filter(Boolean);
  const link = d.f10 ? M.linkOf(d.f10) : null;
  return `<div class="pt-row has-tile row-${C_STATUS.tones[st] ?? 'none'}" data-action="edit-item" data-id="${i.id}">
    <span class="tile${d.f6 === '白' ? ' tile-light' : ''}" style="${swatchStyle(d.f6)}" title="${esc(d.f6 || '沒填色系')}">${d.f6 ? '' : esc([...(d.f5 || i.name)][0] ?? '')}</span>
    <div class="pt-name"><b>${esc(i.name)}</b>${link ? ` <a class="pt-link" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer" title="${esc(String(d.f10))}" aria-label="開啟網址">${svgIcon(link.search ? 'search' : 'external')}</a>` : ''}
      ${sub.length ? `<div class="pt-sub">${sub.map(esc).join(' · ')}</div>` : ''}${noteHTML(i.note)}</div>
    <div class="pt-qty">${esc(d.f4 ?? '')}</div>
    <div class="pt-price">${m ? `${CUR_SIGN[m.c]}${fmt(m.a)}` : '<span class="text-muted">—</span>'}</div>
    <div class="pt-status">${choicePill(C_STATUS, st, i.id)}</div>
  </div>`;
}

/** 一個部位的卡片（短袖、長袖…）：件數、想丟幾件、花費；可以收合 */
function partCard(part, rows, all, opened) {
  const toss = all.filter((i) => clothesStatus(i) === '想丟').length;
  const spent = M.sumTWD(all, C_PRICE).total;
  return `<section class="pc${opened ? '' : ' is-collapsed'}">
    <div class="pc-head" data-action="toggle-part" data-part="${esc(part)}" role="button" tabindex="0" aria-expanded="${opened}">
      <span class="avatar">${esc([...part][0] ?? '?')}</span>
      <div class="pc-name"><b>${esc(part)}</b><span>${all.length} 件${toss ? ` · 想丟 ${toss} 件` : ''}</span></div>
      <div class="pc-amount"><span>花費</span><b>NT$${fmt(spent, 0)}</b></div>
      <span class="pc-chev">${svgIcon('chevron-right')}</span>
    </div>
    ${opened ? `<div class="pt"><div class="pt-head has-tile"><span></span><span>衣服</span><span>尺寸</span><span>價格</span><span>狀態</span></div>
      ${rows.map(clothesRow).join('')}</div>` : '<div class="pc-gap"></div>'}
  </section>`;
}

function clothesList(all, f) {
  const q = state.search.clothes ?? '';
  const fields = M.fieldsOf('clothes');
  const byStatus = C_STATUS_FILTER[f.__status ?? ''] ?? C_STATUS_FILTER[''];
  const ok = (i) => byStatus(clothesStatus(i)) && (!f.__color || M.dataOf(i).f6 === f.__color) && M.itemMatches(i, fields, q);
  const parts = f.__part ? [f.__part] : [...C_PART.options, M.EMPTY];
  const opens = f.__open ?? {};
  const filtering = !!(q || f.__color || f.__status);
  const cards = parts.map((part) => {
    const inPart = all.filter((i) => (M.dataOf(i).f1 || M.EMPTY) === part);
    const rows = inPart.filter(ok).sort((a, b) => (clothesStatus(a) === '想丟') - (clothesStatus(b) === '想丟') || byName(a, b));
    if (!rows.length) return '';
    return partCard(part, rows, inPart.filter((i) => clothesStatus(i) !== '已丟'), filtering || f.__part ? true : opens[part] ?? true);
  }).join('');
  return cards || `<p class="empty-state">${all.length ? '沒有符合的。換個篩選或關鍵字。' : '衣櫃還是空的。按「新增衣服」開始。'}</p>`;
}

function renderClothes() {
  const f = (state.filters.clothes ||= {});
  const all = itemsOf('clothes');
  const fields = M.fieldsOf('clothes');
  const keep = all.filter((i) => clothesStatus(i) !== '已丟');
  const toss = all.filter((i) => clothesStatus(i) === '想丟').length;
  const gone = all.length - keep.length;
  const spent = M.sumTWD(keep, C_PRICE);
  const foreign = M.foreignCurrencies(all, fields);
  // 色系分布（衣櫃裡的，不含已丟）
  const colors = M.countBy(keep, C_COLOR).filter((x) => x.value !== M.EMPTY);
  const noColor = keep.length - colors.reduce((n, x) => n + x.n, 0);
  const pill = (key, v, label, n) => `<button type="button" class="pill${(f[key] ?? '') === v ? ' active' : ''}" data-action="kind-filter" data-kind="clothes" data-key="${key}" data-v="${esc(v)}">${esc(label)}${n != null ? ` <span>${n}</span>` : ''}</button>`;
  const partN = (p) => keep.filter((i) => M.dataOf(i).f1 === p).length;
  page.innerHTML = `<div class="kind-page">
    <header class="trip-head">
      <div>
        <div class="crumb">我的衣櫃</div>
        <h1>衣服</h1>
        <p class="trip-sub">看看自己有什麼，少買重複的。</p>
      </div>
      <div class="trip-actions">
        <details class="more-menu"><summary class="btn btn-outline btn-sm btn-icon" aria-label="更多" title="更多">⋯</summary>
          <div class="more-list">
            ${foreign.length ? `<button type="button" data-action="set-rate" data-kind="clothes">${icon('coins')}整批改匯率</button>` : ''}
            <button type="button" data-action="export-csv" data-kind="clothes">${icon('download')}下載 CSV</button>
          </div></details>
        <button type="button" class="btn btn-primary" data-action="new-item" data-kind="clothes">${icon('plus')}新增衣服</button>
      </div>
    </header>
    ${all.length ? `
    <div class="kpis">
      <div class="kpi"><span>衣櫃裡 ${svgIcon('shirt')}</span><b>${keep.length} 件</b><small>不含已丟</small></div>
      <div class="kpi kpi-ok"><span>總共花了 ${svgIcon('wallet')}</span><b>NT$${fmt(spent.total, 0)}</b>${spent.missing ? `<small>${spent.missing} 件外幣沒匯率</small>` : '<small>衣櫃裡的</small>'}</div>
      <button type="button" class="kpi kpi-warn" data-action="kind-filter" data-kind="clothes" data-key="__status" data-v="想丟"><span>想丟 ${svgIcon('alert')}</span><b>${toss} 件</b><small>點一下只看想丟的</small></button>
      <button type="button" class="kpi kpi-bad" data-action="kind-filter" data-kind="clothes" data-key="__status" data-v="已丟"><span>已丟 ${svgIcon('trash')}</span><b>${gone} 件</b><small>點一下看已丟的</small></button>
    </div>
    ${colors.length ? `<div class="progress-card">
      <div class="progress-top"><b>色系</b><span class="text-muted">${keep.length} 件${noColor ? ` · ${noColor} 件沒填` : ''}</span></div>
      <div class="stack">${colors.map((x) => `<i style="width:${(x.n / keep.length) * 100}%;${swatchStyle(x.value)}" title="${esc(x.value)} ${x.n} 件"></i>`).join('')}</div>
      <div class="swatch-legend">${colors.map((x) => `<button type="button" class="swatch-btn${f.__color === x.value ? ' active' : ''}" data-action="kind-filter" data-kind="clothes" data-key="__color" data-v="${esc(f.__color === x.value ? '' : x.value)}"><i class="${x.value === '白' ? 'tile-light' : ''}" style="${swatchStyle(x.value)}"></i>${esc(x.value)} ${x.n}</button>`).join('')}</div>
    </div>` : ''}` : ''}
    <div class="list-head"><h2>我的衣櫃</h2><span>${f.__color ? `只看 ${esc(f.__color)} · <button type="button" class="link-btn" data-action="kind-filter" data-kind="clothes" data-key="__color" data-v="">清除</button>` : `${keep.length} 件`}</span></div>
    <div class="list-tools">
      <div class="pills">${pill('__part', '', '全部', keep.length)}${C_PART.options.map((p) => pill('__part', p, p, partN(p))).join('')}</div>
      <input class="search-input" id="search" type="search" placeholder="搜尋名稱、品牌、顏色、備註…" value="${esc(state.search.clothes ?? '')}">
    </div>
    <div class="pills pills-sub">${pill('__status', '', '在穿＋想丟')}${pill('__status', '想丟', '想丟', toss)}${pill('__status', '已丟', '已丟', gone)}${pill('__status', 'all', '全部', all.length)}</div>
    <div id="kind-list">${clothesList(all, f)}</div>
  </div>`;
  $('#search').oninput = (e) => {
    state.search.clothes = e.target.value;
    $('#kind-list').innerHTML = clothesList(all, f);
    applyIcons($('#kind-list'));
  };
  $('#kind-list').onchange = (e) => {
    const sel = e.target.closest('select[data-quick]');
    if (sel) quickChange(Number(sel.dataset.id), sel.dataset.quick, sel.value);
  };
}

/** 新增時先帶入：欄位的預設值（例如狀態＝待買），再用目前的篩選蓋過（篩了批次、幫誰買，新增的就是那一批、那個人） */
function newItemPreset(kind) {
  const preset = {};
  const batch = kind === 'proxy' ? proxyScope().trip : null;
  if (batch && batch !== M.NO_BATCH && batch !== DONE_LOOSE) preset.__note = batch; // 現在看的這一趟 → 新的那件備註先寫好 #批次
  for (const f of M.fieldsOf(kind)) {
    if (f.type !== 'choice') continue;
    const want = kind === 'proxy' ? null : kind === 'clothes' ? (f.key === 'f1' ? state.filters.clothes?.__part : null) : state.filters[kind]?.[f.key];
    if (want && want !== M.EMPTY) preset[f.key] = want;
    else if (f.def) preset[f.key] = f.def;
  }
  return preset;
}

function closeBatch(tag) {
  const items = itemsOf('proxy').filter((i) => M.inBatch(i, tag));
  const u = M.unfinished(items, paidSet());
  const warn = [u.toBuy && `${u.toBuy} 件還沒買`, u.notDelivered && `${u.notDelivered} 件買了還沒交`, u.unpaid && `${u.unpaid} 人還沒收錢（NT$${fmt(u.unpaidTWD, 0)}）`].filter(Boolean);
  const groups = M.personGroups(items, paidSet());
  const s = { n: items.length, total: groups.reduce((n, g) => n + g.total, 0), byPerson: groups };
  openModal(`<div class="modal"><form novalidate>
    ${modalHeader(`結清 ${tag}？`, '結清')}
    <p>${s.n} 件 · NT$${fmt(s.total, 0)}（${s.byPerson.map((p) => `${esc(p.who)} NT$${fmt(p.total, 0)}`).join('、')}）</p>
    ${warn.length ? `<p class="form-hint negative">還有：${warn.join('、')}。可以先回去處理，也可以直接結清。</p>` : '<p class="form-hint">都處理完了。</p>'}
    <p class="form-hint">結清後這批會收到「已結清」，資料不會改。之後可以重新打開。</p>
    <div class="form-actions"><span class="spacer"></span>
      <button type="button" class="btn btn-outline" data-action="close-modal">${warn.length ? '先回去處理' : '取消'}</button>
      <button type="submit" class="btn btn-primary modal-footer-save">結清</button>
    </div></form></div>`);
  $('form', modal).onsubmit = (e) => {
    e.preventDefault();
    setClosed(tag, true);
    closeModal();
    delete state.filters.proxy.__batch; // 回到下一趟進行中的
    saveFilters();
    render();
    toast(`已結清 ${tag}`, 'info', { timeout: 8000, action: { label: '復原', run: () => { setClosed(tag, false); render(); } } });
  };
}

/** 收款：這個人在目前看的這幾批（keys）一次標成已收／改回未收；給「復原」 */
function togglePaid(keys, who) {
  const before = settingList(PAID_KEY);
  const set = new Set(before);
  const on = !keys.every((k) => set.has(k));
  for (const k of keys) if (on) set.add(k); else set.delete(k);
  setSettingList(PAID_KEY, [...set]);
  render();
  toast(on ? `${who} 已收款` : `${who} 改回未收款`, 'info', {
    timeout: 6000,
    action: { label: '復原', run: () => { setSettingList(PAID_KEY, before); render(); } },
  });
}

function setClosed(tag, on) {
  const key = tag.toLowerCase();
  const list = settingList(CLOSED_KEY).filter((t) => t !== key);
  setSettingList(CLOSED_KEY, on ? [key, ...list] : list);
}

function quickChange(id, key, value) {
  const item = db.get('items', id);
  if (!item) return;
  const d = M.dataOf(item);
  if (value) d[key] = value; else delete d[key];
  db.update('items', id, { data: JSON.stringify(d) });
  render();
  toast(`「${item.name}」→ ${value || '未填'}`, 'info', {
    timeout: 5000,
    action: { label: '復原', run: () => { db.update('items', id, { data: item.data }); render(); } },
  });
}

// ---- 篩選條件記在這台電腦（重新整理後還在，逛街時不用每次重選批次）
const FILTER_KEY = `${APP_ID}.filters.v2`;
function loadFilters() {
  try { Object.assign(state.filters, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}')); } catch { /* 沒有就算了 */ }
}
function saveFilters() {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(state.filters)); } catch { /* 存不了就只在這次有效 */ }
}

function exportCSV(kind) {
  downloadFile(`${M.KINDS[kind].name}-${db.today()}.csv`, M.toCSV(kind, itemsOf(kind).sort(byName)), 'text/csv;charset=utf-8');
}

// ---- 整批改匯率：目前篩選出來的物品，某個外幣的匯率一次改掉（刷卡帳單出來後用）

function rateModal(kind) {
  const v = kindView(kind);
  let scope;
  if (kind === 'proxy') { // 代購：這一趟的全部物品
    const sc = proxyScope();
    v.shown = sc.items;
    v.foreign = M.foreignCurrencies(sc.items, v.fields);
    scope = `「${sc.title}」`;
  } else {
    const active = Object.entries(v.filters).filter(([key, x]) => x && !key.startsWith('__')).map(([key, x]) => `${v.fields.find((f) => f.key === key)?.label ?? key}＝${x}`);
    scope = active.length ? `目前篩選（${active.join('、')}）` : '全部';
  }
  const curs = v.foreign;
  if (!curs.length) { toast(`${scope}沒有外幣的金額`, 'info'); return; }
  openModal(`<div class="modal"><form novalidate>
    ${modalHeader('整批改匯率', '套用')}
    <p class="form-hint card-hint">把${esc(scope)}的 ${v.shown.length} 件裡，所選幣別的匯率一次改掉。刷卡帳單出來後，用實際的匯率更新。</p>
    <div class="form-group"><label for="rate-cur">幣別</label>
      <select id="rate-cur" name="cur" data-segmented>${curs.map((x) => `<option value="${x}">${CURRENCY_LABEL[x]}</option>`).join('')}</select></div>
    <div class="form-group"><label for="rate-r">匯率（1 外幣＝？台幣）*</label>
      <input id="rate-r" name="rate" type="number" step="any" inputmode="decimal" value="${esc(db.getSetting(rateKey(curs[0])))}" required></div>
    <p class="form-hint" id="rate-count"></p>
    <p class="form-error"></p>
    <div class="form-actions"><span class="spacer"></span>
      <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
      <button type="submit" class="btn btn-primary modal-footer-save">套用</button>
    </div></form></div>`);
  const form = $('form', modal);
  const count = () => {
    const n = v.shown.filter((i) => M.foreignCurrencies([i], v.fields).includes(form.elements.cur.value)).length;
    $('#rate-count').textContent = `會改 ${n} 件。`;
  };
  form.elements.cur.onchange = () => { form.elements.rate.value = db.getSetting(rateKey(form.elements.cur.value)); count(); };
  count();
  form.onsubmit = (e) => {
    e.preventDefault();
    try {
      const cur = form.elements.cur.value;
      const changes = M.setRate(v.shown, v.fields, cur, form.elements.rate.value);
      const old = new Map(v.shown.map((i) => [i.id, i.data]));
      for (const ch of changes) db.update('items', ch.id, { data: ch.data });
      db.setSetting(rateKey(cur), Number(form.elements.rate.value));
      closeModal();
      render();
      toast(`已更新 ${changes.length} 件的${CURRENCY_LABEL[cur]}匯率`, 'info', {
        timeout: 8000,
        action: { label: '復原', run: () => { for (const ch of changes) db.update('items', ch.id, { data: old.get(ch.id) }); render(); } },
      });
    } catch (err) { $('.form-error', form).textContent = err.message; }
  };
}

// ---------------------------------------------------------------- 新增／編輯物品

const rateKey = (cur) => `rate.${cur}`;

function fieldInput(f, v) {
  const id = `if-${f.key}`;
  const label = `<label for="${id}">${esc(f.label)}</label>`;
  switch (f.type) {
    case 'choice': {
      const opts = f.options ?? [];
      const cur = v ?? '';
      if (f.chips) {
        return `<div class="form-group form-group-wide">${label}
          <input id="${id}" name="${f.key}" value="${esc(cur)}" placeholder="輸入，或按下面最近的" autocomplete="off">
          <div class="chip-row" data-chips="${f.key}"></div></div>`;
      }
      return `<div class="form-group form-group-wide">${label}
        <select id="${id}" name="${f.key}" data-segmented="8"><option value="">未填</option>${opts.map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
        ${f.fixed ? '' : `<input class="input-sm choice-new" name="${f.key}.new" placeholder="${opts.length ? '或輸入新的…' : '輸入…'}" aria-label="${esc(f.label)}（新的選項）">`}</div>`;
    }
    case 'money': {
      const m = M.normMoney(v) ?? { a: '', c: 'TWD', r: '' };
      if (f.twdOnly) {
        return `<div class="form-group">${label}<input id="${id}" type="number" step="any" inputmode="decimal" name="${f.key}.a" value="${esc(m.a)}" placeholder="台幣">
          <input type="hidden" name="${f.key}.c" value="TWD"><input type="hidden" name="${f.key}.r" value="1"></div>`;
      }
      const rate = m.c === 'TWD' ? '' : (m.r ?? '');
      return `<div class="form-group form-group-wide">${label}
        <div class="money-input">
          <input id="${id}" type="number" step="any" inputmode="decimal" name="${f.key}.a" value="${esc(m.a)}" placeholder="金額">
          <select name="${f.key}.c" data-segmented aria-label="幣別">${M.CURRENCIES.map((c) => `<option value="${c}" ${c === m.c ? 'selected' : ''}>${CURRENCY_LABEL[c]}</option>`).join('')}</select>
          <label class="rate-input" ${m.c === 'TWD' ? 'hidden' : ''}>匯率<input type="number" step="any" inputmode="decimal" name="${f.key}.r" value="${esc(rate)}" placeholder="1 外幣＝？台幣"></label>
        </div>
        <p class="form-hint" data-money-hint="${f.key}"></p></div>`;
    }
    case 'date':
      return `<div class="form-group">${label}<input id="${id}" name="${f.key}" value="${esc(v ?? '')}" placeholder="2024-03-05、2024-03 或 2024" inputmode="numeric"></div>`;
    case 'number':
      return `<div class="form-group">${label}<input id="${id}" type="number" step="any" name="${f.key}" value="${esc(v ?? '')}"></div>`;
    case 'tags':
      return `<div class="form-group form-group-wide">${label}<input id="${id}" name="${f.key}" value="${esc(M.normTags(v).join('、'))}" placeholder="用逗號或頓號分隔"></div>`;
    case 'url': {
      const l = M.linkOf(v);
      return `<div class="form-group form-group-wide">${label}<input id="${id}" name="${f.key}" value="${esc(v ?? '')}" placeholder="網址，或商品名稱（會連到搜尋）" inputmode="url">
        <p class="form-hint" data-url-hint="${f.key}">${l ? urlHint(l) : ''}</p></div>`;
    }
    default:
      return `<div class="form-group">${label}<input id="${id}" name="${f.key}" value="${esc(v ?? '')}"></div>`;
  }
}

const urlHint = (l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${l.search ? `${icon('search')}搜尋「${esc(l.text)}」` : `${icon('external')}開啟 ${esc(l.text)}`}</a>`;

/** 表單 → { name, note, 欄位 key: 值 }（金額是 { a, c, r }，單選的新值優先） */
function readItemForm(form, fields) {
  const el = (n) => form.elements.namedItem(n);
  const out = { name: el('name').value, note: el('note').value };
  for (const f of fields) {
    if (f.type === 'money') out[f.key] = { a: el(`${f.key}.a`).value, c: el(`${f.key}.c`).value, r: el(`${f.key}.r`).value };
    else if (f.type === 'choice' && !f.fixed && !f.chips) out[f.key] = el(`${f.key}.new`).value.trim() || el(f.key).value;
    else out[f.key] = el(f.key).value;
  }
  return out;
}

function itemModal(kind, id = null, preset = {}) {
  const k = M.KINDS[kind];
  const fields = withSeen(kind, M.fieldsOf(kind));
  const item = id ? db.get('items', id) : null;
  const data = item ? M.dataOf(item) : preset;
  const note = item?.note ?? preset.__note ?? '';
  openModal(`<div class="modal modal-wide"><form novalidate>
    ${modalHeader(item ? `編輯${k.name}` : `新增${k.name}`, '儲存')}
    <div class="form-group"><label for="if-name">名稱 *</label><input id="if-name" name="name" value="${esc(item?.name ?? '')}" required autocomplete="off">
      <p class="form-hint" id="similar"></p></div>
    <div class="form-grid">${fields.map((f) => fieldInput(f, data[f.key])).join('')}
      <div class="form-group form-group-wide"><label for="if-note">備註</label><textarea id="if-note" name="note" rows="2">${esc(note)}</textarea>
        ${kind === 'proxy' ? '<p class="form-hint">寫 #批次名稱（例如 #2026楓葉之旅）就會分成一批；也可以按下面的批次。</p><div class="chip-row" data-tag-chips></div>' : ''}</div>
    </div>
    <p class="form-error"></p>
    <div class="form-actions">
      ${item ? '<button type="button" class="btn btn-danger" data-role="delete">刪除</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
      ${item ? '' : '<button type="button" class="btn btn-outline" data-role="save-next">儲存並新增下一件</button>'}
      <button type="submit" class="btn btn-primary modal-footer-save">儲存</button>
    </div></form></div>`);
  const form = $('form', modal);
  const el = (n) => form.elements.namedItem(n);
  const showError = (msg) => { $('.form-error', form).textContent = msg; };

  // 名稱：提醒已經有類似的
  const others = itemsOf(kind).filter((i) => i.id !== item?.id);
  const checkSimilar = () => {
    const hits = M.similarItems(others, el('name').value);
    $('#similar').innerHTML = hits.length ? `<span class="tag tag-warn">已經有</span> ${hits.map((h) => esc(h.name)).join('、')}` : '';
  };
  el('name').oninput = checkSimilar;
  checkSimilar();

  // 金額：選外幣才顯示匯率，預設帶上次用的匯率；即時顯示換算的台幣（只能填台幣的欄位沒有這些）
  for (const f of fields.filter((x) => x.type === 'money' && !x.twdOnly)) {
    const cur = el(`${f.key}.c`);
    const rate = el(`${f.key}.r`);
    const hint = form.querySelector(`[data-money-hint="${f.key}"]`);
    const update = () => {
      const v = { a: el(`${f.key}.a`).value, c: cur.value, r: rate.value };
      const m = M.normMoney(v);
      const twd = M.moneyTWD(v);
      hint.textContent = !m || m.c === 'TWD' ? '' : twd == null ? '填匯率才能換算台幣（之後補也可以）' : `約 NT$${fmt(twd, 0)}`;
    };
    cur.onchange = () => {
      rate.closest('.rate-input').hidden = cur.value === 'TWD';
      if (cur.value !== 'TWD' && !rate.value) rate.value = db.getSetting(rateKey(cur.value));
      update();
    };
    el(`${f.key}.a`).oninput = update;
    rate.oninput = update;
    update();
  }
  // 網址：即時顯示會連到哪裡
  for (const f of fields.filter((x) => x.type === 'url')) {
    el(f.key).oninput = () => {
      const l = M.linkOf(el(f.key).value);
      const hint = form.querySelector(`[data-url-hint="${f.key}"]`);
      hint.innerHTML = l ? urlHint(l) : '';
      applyIcons(hint);
    };
  }

  // 快速按鈕：最近用過的值（幫誰買），點了填進去、再點取消；✕ 不再推薦
  const kindItems = itemsOf(kind);
  for (const f of fields.filter((x) => x.chips)) {
    const input = el(f.key);
    const box = form.querySelector(`[data-chips="${f.key}"]`);
    const key = hiddenKey(kind, f.key);
    const mark = () => { for (const b of box.querySelectorAll('[data-chip]')) b.classList.toggle('active', b.dataset.chip === input.value.trim()); };
    const draw = () => {
      const recent = M.recentValues(kindItems, f.key, { hidden: settingList(key) });
      box.innerHTML = recent.map((x) => `<span class="tag-chip"><button type="button" class="chip-btn" data-chip="${esc(x)}">${esc(x)}</button><button type="button" class="chip-hide" data-chip-hide="${esc(x)}" title="不再推薦（之後再用到會自動恢復）" aria-label="不再推薦 ${esc(x)}">×</button></span>`).join('');
      box.hidden = !recent.length;
      mark();
    };
    box.onclick = (e) => {
      const pick = e.target.closest('[data-chip]');
      const hide = e.target.closest('[data-chip-hide]');
      if (pick) { input.value = input.value.trim() === pick.dataset.chip ? '' : pick.dataset.chip; mark(); }
      if (hide) { setSettingList(key, [...settingList(key), hide.dataset.chipHide.toLowerCase()]); draw(); }
    };
    input.addEventListener('input', mark);
    draw();
  }
  // 批次按鈕：進行中的 #標籤，點了加進備註、再點拿掉（結清的不推薦）
  const tagBox = form.querySelector('[data-tag-chips]');
  if (tagBox) {
    const closed = closedSet();
    const open = M.batchesOf(kindItems).filter((b) => !closed.has(b.tag.toLowerCase())).slice(0, 8);
    const draw = () => {
      const inNote = M.noteTags(el('note').value);
      tagBox.innerHTML = open.map((b) => `<button type="button" class="chip-btn ${inNote.some((t) => M.sameTag(t, b.tag)) ? 'active' : ''}" data-tag="${esc(b.tag)}">${esc(b.tag)}</button>`).join('');
      tagBox.hidden = !open.length;
    };
    tagBox.onclick = (e) => {
      const b = e.target.closest('[data-tag]');
      if (!b) return;
      el('note').value = M.toggleTag(el('note').value, b.dataset.tag);
      draw();
    };
    el('note').addEventListener('input', draw);
    draw();
  }

  const save = () => {
    const values = readItemForm(form, fields);
    const row = M.buildItem(kind, values);
    // 又用到被隱藏的快速按鈕 → 自動恢復推薦
    for (const f of fields.filter((x) => x.chips && values[x.key])) {
      const key = hiddenKey(kind, f.key);
      const v = String(values[f.key]).trim().toLowerCase();
      const hidden = settingList(key);
      if (hidden.includes(v)) setSettingList(key, hidden.filter((x) => x !== v));
    }
    // 記住外幣匯率，下次預設帶入
    for (const f of fields.filter((x) => x.type === 'money')) {
      const m = M.normMoney(values[f.key]);
      if (m && m.c !== 'TWD' && m.r) db.setSetting(rateKey(m.c), m.r);
    }
    if (item) db.update('items', item.id, row); else db.insert('items', { ...row, kind });
    return { row, values };
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    try {
      const { row } = save();
      closeModal();
      toast(item ? `已儲存「${row.name}」` : `已新增「${row.name}」`);
      render();
    } catch (err) { showError(err.message); }
  };
  if (!item) {
    // 連續輸入：單選欄位（部位、品牌、幫誰買…）和幣別沿用上一件
    $('[data-role=save-next]', form).onclick = () => {
      try {
        const { row, values } = save();
        const keep = {};
        const tags = M.noteTags(values.note);
        if (tags.length) keep.__note = tags.join(' ');
        for (const f of fields) {
          if (f.type === 'choice' && values[f.key]) keep[f.key] = values[f.key];
          if (f.type === 'money') keep[f.key] = { a: '', c: values[f.key].c, r: values[f.key].r };
        }
        render();
        itemModal(kind, null, keep);
        toast(`已新增「${row.name}」`);
      } catch (err) { showError(err.message); }
    };
  } else {
    $('[data-role=delete]', form).onclick = () => {
      closeModal();
      deleteItem(item.id);
    };
  }
  if (!item) el('name').focus();
}

function deleteItem(id) {
  const item = db.get('items', id);
  db.remove('items', id);
  render();
  // 單筆刪除不用打字確認，改給「復原」
  toast(`已刪除「${item.name}」`, 'info', { action: { label: '復原', run: () => { db.insert('items', item); render(); } }, timeout: 6000 });
}

// ---------------------------------------------------------------- 同步狀態（右上角）

const STATUS_TEXT = { local: '本機', idle: '本機', 'signed-out': '未登入', expired: '需要重新連線', syncing: '同步中…', synced: '已同步', pending: '待同步', error: '同步失敗', choose: '選擇資料表' };
const SYNC_ICON = { synced: 'cloud-check', pending: 'cloud-up', syncing: 'cloud-sync' }; // 其他：cloud-off

function renderSyncPill() {
  const { status } = sync.state;
  const pill = $('#sync-pill');
  const n = ['syncing', 'local', 'idle'].includes(status) ? 0 : db.pendingCount();
  const text = STATUS_TEXT[status] ?? '本機';
  pill.dataset.status = status;
  $('#sync-icon').setAttribute('href', `#i-${SYNC_ICON[status] || 'cloud-off'}`);
  $('#sync-count').textContent = n || '';
  $('#sync-pill-text').textContent = text + (n ? ` · ${n}` : '');
  pill.title = [
    `雲端同步：${text}`,
    n ? `${n} 筆修改還沒上傳` : '',
    status === 'error' && sync.state.error ? sync.state.error : '',
    ['expired', 'signed-out'].includes(status) ? '按一下登入 Google' : status === 'choose' ? '按一下選要同步的資料表' : '按一下看同步設定',
  ].filter(Boolean).join('\n');
}

/** 登入過期／未登入：直接登入（彈窗要在點擊裡同步打開）；要選表：選表；其他狀態：到設定頁 */
function onSyncPillClick() {
  if (['expired', 'signed-out'].includes(sync.state.status) && sync.auth.isAuthReady()) return signIn();
  if (sync.state.status === 'choose') return chooseSheet();
  location.hash = '#settings';
}

function signIn() {
  sync.signIn().then((email) => { toast(`已登入 ${email}`); render(); if (sync.state.status === 'choose') chooseSheet(); })
    .catch((e) => { if (!/popup_closed/.test(e.message)) toast(`登入失敗：${e.message}`, 'error'); });
}

// ---- 過期後點一下就重新連線（來源：color-picker）
// 權杖過期時，使用者下一次點畫面任何地方就順便重新連線（等同替他按「重新登入」）。
// 不能用程式呼叫 button.click()：沒有真的使用者手勢，Google 彈窗會被瀏覽器擋掉。
// 每次過期只自動試一次；被關掉或失敗就留給右上角的雲朵手動按，避免每點一下都跳彈窗。
let autoReconnectArmed = false;
let autoReconnectTried = false;

const needsReconnect = () => sync.state.status === 'expired' && sync.auth.isAuthReady();

function onAutoReconnectClick(e) {
  setAutoReconnect(false);
  if (!needsReconnect() || !navigator.onLine) return;
  // 這些按鈕自己會開登入彈窗：一次點擊只能開一個彈窗，這裡先開的話按鈕自己的會被擋
  if (e.target.closest?.('#sync-pill, [data-action="sign-in"]')) return;
  autoReconnectTried = true;
  sync.signIn().then(() => { render(); if (sync.state.status === 'choose') chooseSheet(); }).catch(() => {}); // 安靜地試；原本的點擊照常進行
}

function setAutoReconnect(on) {
  if (on === autoReconnectArmed) return;
  autoReconnectArmed = on;
  if (on) document.addEventListener('click', onAutoReconnectClick, true);
  else document.removeEventListener('click', onAutoReconnectClick, true);
}

function updateAutoReconnect() {
  if (sync.auth.hasValidToken()) autoReconnectTried = false; // 連上了：下次過期可以再自動試一次
  setAutoReconnect(needsReconnect() && !autoReconnectTried);
}

// ---- 選試算表（config.js SHEET_MODE 'pick'，來源：color-picker）

const CHOOSE_TEXT = {
  none: '還沒選要同步到哪一份試算表，修改目前只存在這台電腦。',
  many: '你的 Google 帳號裡有好幾份資料表，請選這台電腦要用哪一份。',
  lost: '打不開之前用的資料表（可能被刪掉或取消分享了），請重新選一份。',
};

const sheetOwner = (f) => (f.mine ? '我的' : `${f.owner} 分享的`);
/** 「名稱（某人分享的）」；自己的只有名稱 */
const sheetLabel = (s) => `${s?.name ?? ''}${s && s.mine === false ? `（${sheetOwner(s)}）` : ''}`;
const sheetSub = (f) => [sheetOwner(f), f.modifiedTime ? `${db.today(new Date(f.modifiedTime))} 更新` : ''].filter(Boolean).join(' · ');

/**
 * 選要同步的資料表：這個網站建立過的、用檔案選擇器選別份、或建立新的。
 * 主動換表時，這台電腦的資料換成新表的內容；第一次選（或打不開舊表時建立新的）則把這台的資料併進去。
 */
async function chooseSheet() {
  const switching = sync.state.status !== 'choose';
  const lost = sync.state.chooseReason === 'lost';
  let list;
  try {
    // 換表前先把修改送回原本的表
    [list] = await Promise.all([sync.listSheets(), switching && db.pendingCount() ? sync.syncNow() : null]);
  } catch (e) {
    toast(`讀不到資料表清單：${e.message}`, 'error');
    return;
  }
  const cur = sync.currentSheet();
  list = list.filter((f) => f.id !== cur?.id);
  const pending = db.pendingCount();
  const keepsLocal = !switching && !lost; // 選現有的表時，這台的修改要不要併進去
  const notes = [
    keepsLocal ? '' : `選現有的表：這台電腦上的資料會換成那份表的內容${pending ? `，還有 ${pending} 筆修改沒上傳，會不見` : ''}。`,
    lost ? '建立新的資料表：把這台電腦上的資料整份放進去（要保留這台的資料選這個）。' : '',
  ].filter(Boolean);
  openModal(`<div class="modal"><form novalidate>
    ${modalHeader(switching ? '換一份資料表' : '選擇資料表')}
    ${switching ? '' : `<p>${esc(CHOOSE_TEXT[sync.state.chooseReason] ?? CHOOSE_TEXT.none)}</p>`}
    ${notes.map((n) => `<p class="form-hint">${esc(n)}</p>`).join('')}
    <div class="sheet-list">${list.map((f) => `<button type="button" class="sheet-choice" data-sheet="${esc(f.id)}"><b>${esc(f.name)}</b><span class="text-muted">${esc(sheetSub(f))}</span></button>`).join('')
      || `<p class="form-hint">你的帳號裡沒有${cur ? '其他' : ''}這個網站的資料表。${sync.pickerAvailable() ? '用「選別份…」從雲端硬碟選一份，或' : ''}建立新的。</p>`}</div>
    <p class="form-error"></p>
    <div class="form-actions">
      ${sync.pickerAvailable() ? '<button type="button" class="btn btn-outline" data-sheet="__pick">選別份…</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
      <button type="button" class="btn btn-primary" data-sheet="__new">建立新的資料表</button>
    </div></form></div>`);
  const form = $('form', modal);
  form.onsubmit = (e) => e.preventDefault();
  form.onclick = async (e) => {
    const b = e.target.closest('[data-sheet]');
    if (!b) return;
    const choice = b.dataset.sheet;
    const busy = (on) => { for (const x of form.querySelectorAll('button')) x.disabled = on; };
    busy(true);
    try {
      if (choice === '__new') {
        await sync.createSheet({ clearLocal: switching });
      } else {
        const id = choice === '__pick' ? await sync.pickSheet() : choice;
        if (!id) { busy(false); return; }
        await sync.useSheet(id, { clearLocal: !keepsLocal }, list.find((f) => f.id === id));
      }
      closeModal();
      toast(`改用資料表：${sheetLabel(sync.currentSheet())}`);
      render();
    } catch (err) {
      $('.form-error', form).textContent = err.message;
      busy(false);
    }
  };
}

// ---------------------------------------------------------------- 設定

function renderSettings() {
  const st = sync.state;
  const email = sync.auth.getEmail();
  const total = db.dataCount();
  const pending = db.pendingCount();
  page.innerHTML = `<div class="settings-page">
    <section class="card">
      <div class="card-header"><h3>${icon('cloud')}Google 試算表同步${info('網站用 drive.file 權限：只能讀寫它自己建立的試算表，和你用「選別份」選過的試算表。')}<small class="card-meta">${esc(STATUS_TEXT[sync.state.status])}</small></h3></div>
      <p class="form-hint card-hint">登入後資料會同步到你自己雲端硬碟裡的一份試算表，可以選要用哪一份。網站看不到你雲端硬碟的其他檔案。</p>
      ${!CLIENT_ID ? `<div class="settings-row"><div><b>還沒設定</b><p class="form-hint">目前是本機版：資料只存在這台電腦的瀏覽器，請定期匯出備份。</p></div></div>`
      : email ? `
        <div class="settings-row">
          <div><b>${esc(email)}</b>${sync.canChoose && sync.currentSheet()?.name ? `<p class="form-hint">資料表：${esc(sheetLabel(sync.currentSheet()))}</p>` : ''}<p class="form-hint">${pending ? `${pending} 筆修改還沒上傳。` : '所有修改都已上傳。'}${st.lastSync ? `上次同步 ${st.lastSync.toLocaleTimeString('zh-TW')}` : ''}</p>
            ${st.status === 'error' && st.error ? `<p class="form-hint negative">${esc(st.error)}</p>` : ''}</div>
          <div class="header-actions">
            ${sync.canChoose && sync.auth.hasValidToken() ? '<button type="button" class="btn btn-outline btn-sm" data-action="choose-sheet">換一份</button>' : ''}
            ${sync.sheetURL() ? `<a class="btn btn-outline btn-sm" href="${esc(sync.sheetURL())}" target="_blank" rel="noopener">開啟試算表</a>` : ''}
            <button type="button" class="btn btn-outline btn-sm" data-action="sign-out">登出</button>
            <button type="button" class="btn btn-primary btn-sm" data-action="sync-now">${icon('refresh')}立即同步</button>
          </div>
        </div>`
      : `<div class="settings-row"><div><b>未登入</b><p class="form-hint">資料目前只存在這台電腦。</p></div>
          <button type="button" class="btn btn-primary btn-sm" data-action="sign-in">用 Google 登入</button></div>`}
    </section>
    <section class="card">
      <div class="card-header"><h3>${icon('database')}匯出／匯入<small class="card-meta">約 ${fmt(db.storedBytes() / 1024, 0)} KB</small></h3></div>
      <p class="form-hint card-hint">檔案含你的收藏清單，不要放進 GitHub。</p>
      <div class="settings-row">
        <div><b>匯出</b><p class="form-hint">把所有物品存成一個檔案，用來備份或搬到別台電腦。</p></div>
        <button type="button" class="btn btn-outline btn-sm" data-action="export">${icon('download')}匯出</button>
      </div>
      <div class="settings-row">
        <div><b>匯入</b><p class="form-hint">備份檔：<b>整個取代</b>這裡的資料。加入檔（舊表轉出來的）：加進去，不取代。匯入前都會先讓你確認。</p></div>
        <label class="btn btn-outline btn-sm">${icon('upload')}匯入…<input type="file" id="import-file" accept=".json,application/json" hidden></label>
      </div>
    </section>
    <section class="card danger-zone">
      <div class="card-header"><h3>${icon('alert')}危險區</h3></div>
      <div class="settings-row">
        <div><b>清除這台電腦的資料</b><p class="form-hint">${email ? '試算表裡的資料不受影響，之後會重新下載。還沒同步的修改會不見。' : '你沒有登入，這些資料沒有備份，清掉就救不回來。建議先匯出。'}</p></div>
        <button type="button" class="btn btn-outline btn-sm" data-action="clear-local">清除</button>
      </div>
      <div class="settings-row">
        <div><b>刪除所有資料</b><p class="form-hint">刪除這台電腦${email ? '和你 Google 試算表' : ''}裡的 ${total} 件（設定保留）。</p></div>
        <button type="button" class="btn btn-danger btn-sm" data-action="wipe-all" ${total ? '' : 'disabled'}>刪除</button>
      </div>
    </section></div>`;
  $('#import-file').onchange = (e) => importBackup(e.target.files[0]);
}

const TABLE_LABEL = { items: '物品' };

/** 加入檔（tools/convert-csv.mjs 產生）：把物品加進衣服／書／代購，原本的資料不動 */
function importPack(data) {
  // 舊版的加入檔沒有 kind，用種類名稱對應（代購 → proxy）
  const kind = data.kind ?? M.KIND_IDS.find((k) => M.KINDS[k].name === data.collection?.name);
  if (!M.KINDS[kind] || !Array.isArray(data.items)) throw new Error('加入檔的格式不對');
  const name = M.KINDS[kind].name;
  openModal(`<div class="modal"><form novalidate>
    ${modalHeader(`加入${name}？`, '加入')}
    <p>會把 <b>${data.items.length} 件</b>加進「${esc(name)}」（目前 ${itemsOf(kind).length} 件）。原本的資料不會被取代。</p>
    <div class="form-actions"><span class="spacer"></span>
      <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
      <button type="submit" class="btn btn-primary modal-footer-save">加入</button>
    </div></form></div>`);
  $('form', modal).onsubmit = (e) => {
    e.preventDefault();
    const added = data.items.map((i) => db.insert('items', { name: i.name, note: i.note, data: i.data, kind }).id);
    migrateBatches();
    closeModal();
    location.hash = `#${kind}`;
    render();
    toast(`已加入 ${added.length} 件`, 'info', {
      timeout: 8000,
      action: { label: '復原', run: () => { const set = new Set(added); db.removeWhere('items', (x) => set.has(x.id)); render(); } },
    });
  };
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data?.format === `${APP_ID}-pack`) return importPack(data);
    if (data?.format !== `${APP_ID}-backup` || !data.tables) throw new Error('不是這個網站匯出的檔案');
    data.tables = M.migrateTables(data.tables).tables; // 舊版（可以自己加種類）的備份
    const summary = Object.entries(data.tables).filter(([t]) => t !== 'settings').map(([t, rows]) => `${TABLE_LABEL[t] ?? t} ${rows.length} 筆`).join('、');
    confirmTyped({
      title: '用這個檔案取代目前的資料？',
      body: `檔案是 ${esc(data.exported_at ?? '')} 匯出的：${esc(summary)}。<br>目前的資料（${db.DATA_TABLES.map((t) => `${TABLE_LABEL[t] ?? t} ${db.count(t)} 筆`).join('、')}）會被整個取代${sync.auth.getEmail() ? '，試算表也會跟著換' : ''}。`,
      restore: '不確定的話，先按「匯出」留一份目前的資料。',
      word: '取代',
      confirmLabel: '取代',
      onConfirm() {
        db.replaceAll(data);
        migrateBatches();
        toast('已匯入');
        render();
      },
    });
  } catch (err) {
    toast(`匯入失敗：${err.message}`, 'error');
  }
}

// ---- 危險區（兩級，見 docs/danger-zone.md）

/** 清除這台電腦：有登入的話之後從試算表重新下載；沒登入就是真的沒了 */
function clearLocal() {
  const signedIn = !!sync.auth.getEmail();
  const pending = db.pendingCount();
  confirmTyped({
    title: '清除這台電腦的資料？',
    body: signedIn
      ? `試算表裡的資料不受影響，清除後會重新下載。${pending ? `<b>還有 ${pending} 筆修改沒同步，會不見。</b>` : ''}`
      : '你沒有登入 Google，這些資料只存在這台電腦。',
    restore: signedIn ? '' : '清除後無法復原。建議先「匯出」一份。',
    confirmLabel: '清除',
    word: '清除',
    async onConfirm() {
      db.clearLocal();
      if (signedIn) await sync.syncNow();
      toast('已清除這台電腦的資料');
      render();
    },
  });
}

/** 刪除所有資料：連試算表一起刪（試算表檔案保留，可以用「版本記錄」救回） */
function wipeAll() {
  const signedIn = !!sync.auth.getEmail();
  const total = db.dataCount();
  confirmTyped({
    title: '刪除所有資料？',
    body: `會刪除 ${total} 筆資料${signedIn ? '，包括這台電腦和你 Google 試算表裡的。試算表檔案本身會保留' : '。你沒有登入，這些資料沒有備份'}。`,
    restore: signedIn ? '本網站無法復原。要救回的話：打開試算表 →「檔案 → 版本記錄」還原到先前的版本。' : '刪除後無法復原。建議先「匯出」一份。',
    async onConfirm() {
      for (const t of db.DATA_TABLES) db.removeWhere(t, () => true);
      if (signedIn) {
        await sync.syncNow();
        if (sync.state.status === 'error') throw new Error(`這台電腦已刪除，但試算表還沒同步成功：${sync.state.error}。請檢查網路後按「立即同步」。`);
      }
      toast('已刪除所有資料');
      render();
    },
  });
}

function signOut() {
  const pending = db.pendingCount();
  confirmTyped({
    title: '登出 Google？',
    body: `登出後這台電腦的資料會清掉（試算表裡的不受影響，下次登入會重新下載）。${pending ? `<b>還有 ${pending} 筆修改沒同步，會不見。</b>` : ''}`,
    word: '登出',
    confirmLabel: '登出',
    onConfirm() {
      sync.signOut({ clearData: true });
      toast('已登出');
      render();
    },
  });
}

// ---------------------------------------------------------------- 提醒條

/**
 * 頁面最上面的提醒條，一次只放一則：有新版本 > Google 登入過期 > 還沒登入 Google（有資料卻只存在這台電腦）。
 * 「用 Google 登入」要在點擊事件裡同步開彈窗，所以按鈕走 data-action="sign-in"。
 */
function drawBanner() {
  const el = $('#banner');
  const st = sync.state.status;
  let html = '';
  if (updateReady) html = '<span>網站有新版本。</span><button type="button" class="btn btn-sm btn-primary" data-action="reload">重新整理</button>';
  else if (st === 'choose') html = `<span>${esc(CHOOSE_TEXT[sync.state.chooseReason] ?? CHOOSE_TEXT.none)}</span><button type="button" class="btn btn-sm btn-primary" data-action="choose-sheet">選擇資料表</button>`;
  else if (st === 'expired') html = '<span>Google 登入過期了，最近的修改還沒同步到試算表。</span><button type="button" class="btn btn-sm btn-primary" data-action="sign-in">重新登入</button>';
  else if (st === 'signed-out' && db.dataCount()) html = '<span>資料目前只存在這台電腦的瀏覽器，清除瀏覽器資料就會不見。</span><button type="button" class="btn btn-sm btn-primary" data-action="sign-in">用 Google 登入同步</button>';
  if (el.innerHTML === html) return;
  el.innerHTML = html;
  el.hidden = !html;
}

function onSyncStatus() {
  renderSyncPill();
  drawBanner();
  updateAutoReconnect();
  if (state.tab === 'settings' && !modal.open && !page.contains(document.activeElement)) renderSettings();
}

// ---------------------------------------------------------------- 路由與事件

/** #clothes、#books、#proxy、#settings；其他都到衣服 */
function render() {
  const t = location.hash.slice(1);
  state.tab = t === 'settings' || M.KINDS[t] ? t : 'clothes';
  renderNav();
  if (state.tab === 'settings') renderSettings(); else if (state.tab === 'proxy') renderProxy(); else if (state.tab === 'clothes') renderClothes(); else renderKind(state.tab);
  applyIcons(page);
  initSegmented(page);
}

const ACTIONS = {
  'new-item': (el) => itemModal(el.dataset.kind, null, newItemPreset(el.dataset.kind)),
  'edit-item': (el) => { const i = db.get('items', el.dataset.id); if (i) itemModal(i.kind, i.id); },
  'clear-filters': (el) => {
    const f = state.filters[el.dataset.kind] ?? {};
    state.filters[el.dataset.kind] = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith('__')));
    saveFilters();
    render();
  },
  'set-rate': (el) => rateModal(el.dataset.kind),
  'close-batch': (el) => closeBatch(el.dataset.tag),
  'toggle-person': (el) => {
    const f = (state.filters.proxy ||= {});
    f.__open = { ...f.__open, [el.dataset.who]: el.getAttribute('aria-expanded') !== 'true' };
    saveFilters();
    render();
  },
  'kind-filter': (el) => { (state.filters[el.dataset.kind] ||= {})[el.dataset.key] = el.dataset.v; saveFilters(); render(); },
  'toggle-part': (el) => {
    const f = (state.filters.clothes ||= {});
    f.__open = { ...f.__open, [el.dataset.part]: el.getAttribute('aria-expanded') !== 'true' };
    saveFilters();
    render();
  },
  'proxy-filter': (el) => { (state.filters.proxy ||= {}).__status = el.dataset.v; saveFilters(); render(); },
  'toggle-paid': (el) => togglePaid(el.dataset.keys.split('\n'), el.dataset.who),
  'reopen-batch': (el) => { setClosed(el.dataset.tag, false); toast(`已重新打開 ${el.dataset.tag}`); render(); },
  'export-csv': (el) => exportCSV(el.dataset.kind),
  export: () => downloadFile(`${APP_ID}-backup-${db.today()}.json`, JSON.stringify(db.exportAll(), null, 1)),
  'clear-local': () => clearLocal(),
  'wipe-all': () => wipeAll(),
  'close-modal': () => closeModal(),
  'sync-pill': () => onSyncPillClick(),
  reload: () => location.reload(),
  'sign-in': () => signIn(), // 必須在點擊事件中同步呼叫（會開 Google 彈窗）
  'choose-sheet': () => chooseSheet(),
  'sign-out': () => signOut(),
  'sync-now': () => sync.syncNow(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !ACTIONS[el.dataset.action]) return;
  // 可點的列裡面的連結、按鈕：讓它自己處理，不觸發整列
  const inner = e.target.closest('a, button, input, select, textarea, label');
  if (inner && inner !== el && el.contains(inner)) return;
  if (el.tagName === 'A') e.preventDefault();
  ACTIONS[el.dataset.action](el);
});
// 朋友標題是 role=button：Enter／空白鍵也能收合
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.pc-head')) { e.preventDefault(); e.target.click(); }
});
// 點視窗外面（暗色區域）關閉
document.addEventListener('click', (e) => { if (e.target.matches('dialog.modal-overlay[open]')) e.target.close(); });
window.addEventListener('hashchange', render);
PHONE.addEventListener('change', () => { if (!modal.open) render(); });
window.appRefresh = () => { if (!modal.open) render(); }; // 同步拉到別台裝置的修改後重畫

/** 代購舊版的「批次」欄 → 備註的 #標籤（開網站、匯入之後跑；只看代購） */
function migrateBatches() {
  for (const i of itemsOf('proxy')) { const r = M.migrateBatch(i); if (r) db.update('items', i.id, r); }
  const { paidKeys, changes } = M.migratePaid(itemsOf('proxy'));
  if (paidKeys.length) setSettingList(PAID_KEY, [...new Set([...settingList(PAID_KEY), ...paidKeys])]);
  for (const c of changes) db.update('items', c.id, { data: c.data });
}

/** 舊版（可以自己加種類）存在這台電腦的資料：轉成新版（items 加 kind，拿掉 collections） */
function migrateLocal() {
  const key = db.STORAGE_KEY;
  try {
    const text = localStorage.getItem(key);
    if (!text?.includes('"collections"')) return; // 新版沒有這張表，不用整份解析
    const raw = JSON.parse(text);
    if (!Array.isArray(raw.collections)) return;
    const { tables, dropped } = M.migrateTables(raw);
    localStorage.setItem(key, JSON.stringify(tables));
    if (dropped) console.warn(`舊資料有 ${dropped} 件不屬於衣服、書、代購，沒有轉`);
  } catch (e) { console.error('舊資料轉換失敗', e); }
}

document.title = APP_NAME;
$('#brand-name').textContent = APP_NAME;
applyIcons();
initTapTips();
migrateLocal();
db.load();
migrateBatches();
loadFilters();
render();
sync.onStatus(onSyncStatus);
sync.initSync();
watchForUpdate(() => { updateReady = true; drawBanner(); });
db.onChange(() => { drawBanner(); renderSyncPill(); });
