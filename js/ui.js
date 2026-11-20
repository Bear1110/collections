// 畫面共用的小工具（沿用 finance-watcher 的元件，見 docs/ui-guidelines.md）：
// 圖示、訊息、彈出視窗、少數選項變按鈕、點一下看說明、表單視窗、打字確認、列印、下載。
// CSP 不允許 inline script：按鈕一律用 data-action，由 app.js 的事件委派處理。

export const $ = (sel, root = document) => root.querySelector(sel);
export const modal = document.getElementById('modal');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmt(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('zh-TW', { maximumFractionDigits: digits });
}

/** 搜尋：任一欄位包含關鍵字（不分大小寫）；空字串都符合 */
export const matches = (q, ...fields) => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q.toLowerCase()));

// ---------------------------------------------------------------- 圖示

/** 線條圖示（24×24、stroke）。用法：<span data-icon="名稱"></span> 或 svgIcon('名稱')。要新的就照這個格式加 */
export const ICONS = {
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  // 同步狀態：同一朵雲，加不同記號
  'cloud-check': '<path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z"/><path d="M9.5 13.5l2 2 3.5-3.5"/>',
  'cloud-up': '<path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z"/><path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5"/>',
  'cloud-sync': '<path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z"/><path d="M9 14h.01M12 14h.01M15 14h.01"/>',
  'cloud-off': '<path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z"/><path d="M3 3l18 18"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  // 收藏整理：分頁、列表用的圖示
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
};

/** 用參照畫圖示：路徑只放一份在 applyIcons 加的 sprite 裡（#i-名稱） */
export const svgIcon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
/** 文字前面的小圖示 */
export const icon = (name) => `<span class="i">${svgIcon(name)}</span>`;

export function applyIcons(root = document) {
  if (!document.getElementById('icon-sprite')) {
    const symbols = Object.entries(ICONS).map(([name, paths]) =>
      `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</symbol>`).join('');
    document.body.insertAdjacentHTML('afterbegin', `<svg id="icon-sprite" width="0" height="0" style="position:absolute" aria-hidden="true">${symbols}</svg>`);
  }
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (ICONS[el.dataset.icon]) el.innerHTML = svgIcon(el.dataset.icon);
  });
}

/** 列上的圖示按鈕：[圖示, 樣式, 文字]；文字是 tooltip 也是螢幕閱讀器念的名字 */
const ROW_ACTIONS = {
  edit: ['pencil', 'btn-outline', '編輯'],
  delete: ['trash', 'btn-danger', '刪除'],
  view: ['list', 'btn-outline', '明細'],
  print: ['printer', 'btn-outline', '列印'],
};
/** rowBtn('edit', 'edit-item', { id: 3 }) → 有 data-action="edit-item" data-id="3" 的圖示按鈕 */
export const rowBtn = (kind, action, data = {}, label = ROW_ACTIONS[kind][2]) => {
  const [name, cls] = ROW_ACTIONS[kind];
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button type="button" class="btn ${cls} btn-sm btn-icon" title="${label}" aria-label="${label}" data-action="${action}"${attrs}>${svgIcon(name)}</button>`;
};

// ---------------------------------------------------------------- 說明

/** 標題旁的 ⓘ：說明放在 title，滑鼠移上去或手機點一下會顯示（initTapTips）。只能是純文字 */
export const info = (text) => `<span class="info" title="${esc(text)}">ⓘ</span>`;
/** 比較長的教學：收起來，點開才看 */
export const guide = (summary, html) => `<details class="guide"><summary>${esc(summary)}</summary><div>${html}</div></details>`;

// ---------------------------------------------------------------- 訊息、視窗

/** 開著的視窗在瀏覽器最上層（top layer），z-index 蓋不過；popover 重開一次就會在它上面 */
export function raise(el) {
  if (!el.showPopover) return;
  if (el.matches(':popover-open')) el.hidePopover();
  el.showPopover();
}

/**
 * 短訊息。type：success | error | info。
 * action: { label, run } 加一個按鈕（按了才消失，或 timeout 毫秒後消失）；id 相同的訊息不重複出現。
 */
export function toast(message, type = 'success', { action, id, timeout } = {}) {
  if (id && document.getElementById(id)) return;
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  if (id) t.id = id;
  const text = document.createElement('span');
  text.textContent = message;
  t.appendChild(text);
  container.appendChild(t);
  raise(container);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-sm';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { t.remove(); action.run(); });
    t.appendChild(btn);
    if (timeout) setTimeout(() => t.remove(), timeout);
    else t.classList.add('toast-sticky');
    return;
  }
  setTimeout(() => t.remove(), 3000);
}

/** 打開共用的 #modal：放入內容、套圖示與按鈕組、把訊息拉到視窗上面 */
export function openModal(html) {
  modal.innerHTML = html;
  applyIcons(modal);
  initSegmented(modal);
  if (!modal.open) modal.showModal();
  raise(document.getElementById('toast-container'));
}
export const closeModal = () => modal.close();

/** 視窗標題列：手機上是 ✕｜標題｜儲存（saveLabel 有給才有儲存鈕） */
export const modalHeader = (title, saveLabel = '') => `<div class="modal-header"><h3>${esc(title)}</h3>
  ${saveLabel ? `<button type="submit" class="btn btn-primary btn-sm modal-header-save">${esc(saveLabel)}</button>` : ''}
  <button type="button" class="modal-close" data-action="close-modal" aria-label="關閉">×</button></div>`;

// ---------------------------------------------------------------- 少數固定選項顯示成一排按鈕

const SELECT_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

/**
 * <select data-segmented> 顯示成一排按鈕：選項都看得到、點一下就選。select 本身留著（隱藏）當資料來源，
 * 所以表單、change 事件、程式設定 .value、form.reset() 都照常運作。重建選項後再呼叫一次。
 * 按鈕文字用 option 的 data-short（完整文字變 tooltip）。會變多的清單用 data-segmented="6"：前 6 個是按鈕，其他收進「更多 ▾」。
 */
export function segmentSelect(sel) {
  let box = sel._seg;
  if (!box) {
    box = sel._seg = document.createElement('div');
    box.className = 'chart-type-toggle seg-select';
    box.setAttribute('role', 'radiogroup');
    if (sel.getAttribute('aria-label')) box.setAttribute('aria-label', sel.getAttribute('aria-label'));
    sel.after(box);
    sel.hidden = true;
    const pick = (v) => {
      if (v === sel.value) return;
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b.dataset.v); });
    box.addEventListener('change', (e) => { e.stopPropagation(); pick(e.target.value); });
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get() { return SELECT_VALUE.get.call(this); },
      set(v) { SELECT_VALUE.set.call(this, v); syncSegments(this); },
    });
  }
  const options = [...sel.options];
  const limit = Number(sel.dataset.segmented) || options.length;
  const folded = options.length > limit + 1 ? options.slice(limit) : [];
  const more = sel.dataset.more || '更多';
  box.innerHTML = options.slice(0, options.length - folded.length).map((o) => {
    const short = o.dataset.short;
    return `<button type="button" role="radio" class="chart-type-btn" data-v="${esc(o.value)}"${short ? ` title="${esc(o.textContent)}"` : ''}>${esc(short || o.textContent)}</button>`;
  }).join('') + (folded.length ? `<label class="chart-type-btn seg-more"><span></span>
    <select aria-label="${esc(more)}" data-keep-select><option value="" disabled>${esc(more)}</option>${
      folded.map((o) => `<option value="${esc(o.value)}">${esc(o.textContent)}</option>`).join('')}</select></label>` : '');
  box.hidden = options.length < 2;
  syncSegments(sel);
}

export function syncSegments(sel) {
  const box = sel._seg;
  if (!box) return;
  box.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.v === sel.value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  const moreEl = box.querySelector('.seg-more');
  if (!moreEl) return;
  const list = moreEl.querySelector('select');
  const picked = [...list.options].some((o) => o.value && o.value === sel.value);
  moreEl.classList.toggle('active', picked);
  moreEl.firstElementChild.textContent = `${picked ? sel.selectedOptions[0].textContent : sel.dataset.more || '更多'} ▾`;
  list.value = picked ? sel.value : '';
}

export function initSegmented(root = document) {
  root.querySelectorAll('select[data-segmented]').forEach(segmentSelect);
}
document.addEventListener('reset', (e) => setTimeout(() => e.target.querySelectorAll('select[data-segmented]').forEach(syncSegments)));

// ---------------------------------------------------------------- 點一下看說明（手機沒有滑鼠移上去）

const TIP_CONTROLS = 'button, a, input, select, textarea, label'; // 跟 style.css 的 [title] cursor 規則一致

/** 把 fixed 的 box 放在 r 下方置中（下面放不下就放上面），離邊緣至少 margin */
export function placeNear(box, r, gap, margin) {
  const b = box.getBoundingClientRect();
  box.style.left = `${Math.min(Math.max(margin, r.left + r.width / 2 - b.width / 2), innerWidth - b.width - margin)}px`;
  box.style.top = `${r.bottom + gap + b.height <= innerHeight - margin ? r.bottom + gap : Math.max(margin, r.top - b.height - gap)}px`;
}

export function initTapTips() {
  const bubble = document.createElement('div');
  bubble.id = 'tip-bubble';
  bubble.setAttribute('role', 'tooltip');
  bubble.setAttribute('popover', 'manual');
  bubble.hidden = true;
  document.body.appendChild(bubble);
  let anchor = null;
  const hide = () => {
    if (bubble.hidden) return;
    bubble.hidden = true;
    if (bubble.matches?.(':popover-open')) bubble.hidePopover();
    anchor = null;
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[title]');
    if (!el || el.closest(TIP_CONTROLS) || !el.title.trim()) {
      if (!bubble.contains(e.target)) hide();
      return;
    }
    if (anchor === el) return hide();
    anchor = el;
    bubble.textContent = el.title;
    bubble.hidden = false;
    raise(bubble);
    placeNear(bubble, el.getBoundingClientRect(), 8, 8);
  });
  addEventListener('scroll', hide, { passive: true, capture: true });
  addEventListener('resize', hide);
}

// ---------------------------------------------------------------- 表單視窗

/**
 * 表單視窗。fields：[{ name, label, type: text|number|date|select|checkbox|textarea, options: [[value, label]],
 *   required, step, placeholder, wide, hint }]。select 顯示成按鈕（data-segmented="5"）。
 * onSave(values) 丟錯誤時顯示在視窗裡、不關閉；成功後關閉並呼叫 afterSave（通常是重畫畫面）。
 * onDelete 有給就顯示「刪除」：回傳 false 表示取消。
 */
export function formModal({ title, fields, values = {}, onSave, onDelete, afterSave = () => {}, extra = '', submitLabel = '儲存', wide = false }) {
  const field = (f) => {
    const v = values[f.name] ?? '';
    const req = f.required ? 'required' : '';
    const id = `f-${f.name}`;
    if (f.type === 'checkbox') {
      return `<label class="inline-check form-group-wide"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    }
    let input;
    if (f.type === 'select') {
      // 5 個以內全部是按鈕；更多的話前 5 個是按鈕、其他收進「更多 ▾」
      input = `<select id="${id}" name="${f.name}" data-segmented="5" ${req}>${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" name="${f.name}" rows="3" placeholder="${esc(f.placeholder ?? '')}">${esc(v)}</textarea>`;
    } else {
      input = `<input id="${id}" type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} placeholder="${esc(f.placeholder ?? '')}" ${req}>`;
    }
    return `<div class="form-group ${f.wide ? 'form-group-wide' : ''}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<p class="form-hint">${esc(f.hint)}</p>` : ''}</div>`;
  };
  openModal(`<div class="modal ${wide ? 'modal-wide' : ''}"><form novalidate>
    ${modalHeader(title, submitLabel)}
    <div class="form-grid">${fields.map(field).join('')}</div>
    ${extra}
    <p class="form-error"></p>
    <div class="form-actions">
      ${onDelete ? '<button type="button" class="btn btn-danger" data-role="delete">刪除</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
      <button type="submit" class="btn btn-primary modal-footer-save">${esc(submitLabel)}</button>
    </div></form></div>`);
  const form = $('form', modal);
  const read = () => {
    const out = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (f.type === 'checkbox') out[f.name] = el.checked ? 1 : 0;
      else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
      else out[f.name] = el.value.trim();
    }
    return out;
  };
  const showError = (msg) => { $('.form-error', form).textContent = msg; };
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = read();
    const missing = fields.find((f) => f.required && (v[f.name] === '' || v[f.name] == null));
    if (missing) return showError(`請填「${missing.label}」`);
    try {
      onSave(v, form);
      closeModal();
      afterSave();
    } catch (err) {
      showError(err.message);
    }
  };
  if (onDelete) {
    $('[data-role=delete]', form).onclick = () => {
      try {
        if (onDelete() === false) return;
        closeModal();
        afterSave();
      } catch (err) {
        showError(err.message);
      }
    };
  }
  return form;
}

/**
 * 危險動作的確認：說清楚會刪什麼、能不能救回，要打字（例如「刪除」）才按得下去。
 * onConfirm 可以是 async；丟錯誤時顯示在視窗裡（資料沒有被刪）。見 docs/danger-zone.md。
 */
export function confirmTyped({ title, body, restore = '', word = '刪除', confirmLabel = '確定刪除', onConfirm }) {
  openModal(`<div class="modal"><form novalidate>
    ${modalHeader(title)}
    <p>${body}</p>
    ${restore ? `<p class="form-hint">${restore}</p>` : ''}
    <div class="form-group confirm-word"><label for="confirm-word">請輸入「${esc(word)}」確認</label><input id="confirm-word" name="word" autocomplete="off" spellcheck="false"></div>
    <p class="form-error"></p>
    <div class="form-actions"><span class="spacer"></span>
      <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
      <button type="submit" class="btn btn-danger-solid" disabled>${esc(confirmLabel)}</button>
    </div></form></div>`);
  const form = $('form', modal);
  const ok = $('button[type=submit]', form);
  form.elements.word.oninput = () => { ok.disabled = form.elements.word.value.trim() !== word; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (ok.disabled) return;
    ok.disabled = true;
    try {
      await onConfirm();
      closeModal();
    } catch (err) {
      $('.form-error', form).textContent = err.message;
      ok.disabled = false;
    }
  };
  form.elements.word.focus();
}

// ---------------------------------------------------------------- 列印、下載

/**
 * 列印／另存 PDF：單據 HTML 放進 #print-root，叫出瀏覽器列印。列印時只顯示 #print-root（css 的 @media print）。
 * 用瀏覽器列印而不是 JS 產 PDF：中文字型不用另外嵌入、檔案小、排版就是 CSS。title 是存 PDF 時的預設檔名。
 */
export function printDoc(html, title) {
  const root = $('#print-root');
  root.innerHTML = html;
  const oldTitle = document.title;
  document.title = title;
  const done = () => { root.innerHTML = ''; document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

export function downloadFile(filename, content, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
