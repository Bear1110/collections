// UI 規則（docs/ui-guidelines.md），檢查 index.html 和 js/ 裡組出來的 HTML。新增畫面檔案就加進 FILES。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['index.html', 'js/app.js', 'js/ui.js'];
const root = new URL('../', import.meta.url);
const sources = FILES.map((f) => [f, readFileSync(new URL(f, root), 'utf8')]);
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

test('UI：卡片標題列只放標題（含 card-meta）和控制項，不放說明文字', () => {
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/class="card-header">([\s\S]*?)<\/div>\s*\n/g)) {
      const rest = m[1].replace(/<h3[\s\S]*?<\/h3>/, '');
      const own = rest.replace(/<(button|select|label|a)\b[\s\S]*?<\/\1>/g, '');
      const text = own.match(/<small\b|<p\b/) || own.replace(/<[^>]+>/g, '').replace(/\$\{[^}]*\}/g, '').trim();
      assert.ok(!text, `${file}:${lineOf(src, m.index)} 標題列有標題以外的文字：${String(text).slice(0, 40)}`);
    }
  }
});

test('UI：少數固定選項的下拉改成一排按鈕（data-segmented）', () => {
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      const options = (m[2].match(/<option\b/g) || []).length;
      if (!options || options > 5 || /data-(segmented|keep-select)\b/.test(m[1])) continue;
      assert.fail(`${file}:${lineOf(src, m.index)} <select> 只有 ${options} 個選項：加 data-segmented（真的要下拉就加 data-keep-select）`);
    }
  }
});

test('UI：彈出視窗用原生 <dialog>（Esc 關閉、焦點留在裡面、背景不能操作）', () => {
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/<(\w+)\b[^>]*class="[^"]*\bmodal-overlay\b/g)) {
      assert.equal(m[1], 'dialog', `${file}:${lineOf(src, m.index)} modal-overlay 用在 <${m[1]}>：改用 <dialog class="modal-overlay">`);
    }
  }
});

test('UI：說明行用 form-hint（＋card-hint／chart-note），不用 inline style 或自創 *-hint', () => {
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/class="([^"]*\bform-hint\b[^"]*)"\s+style=/g)) {
      assert.fail(`${file}:${lineOf(src, m.index)} form-hint 加了 inline style：用 card-hint 或 chart-note`);
    }
    for (const m of src.matchAll(/class="[^"]*\b([\w-]+-hint)\b/g)) {
      assert.ok(['form-hint', 'card-hint'].includes(m[1]), `${file}:${lineOf(src, m.index)} 自創的說明 class：${m[1]}`);
    }
  }
});

test('UI：CSP 不允許 inline script，不能用 onclick= 這類屬性', () => {
  for (const [file, src] of sources) {
    const m = src.match(/<[^>]+\son(click|change|input|submit|load)=/);
    assert.ok(!m, `${file}:${m && lineOf(src, m.index)} 用了 on${m?.[1]}=：改用 data-action（app.js 的 ACTIONS）`);
  }
});

test('UI：按鈕都寫 type（表單裡沒寫 type 的按鈕會送出表單）', () => {
  for (const [file, src] of sources) {
    for (const m of src.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)) {
      assert.fail(`${file}:${lineOf(src, m.index)} <button> 沒寫 type`);
    }
  }
});
