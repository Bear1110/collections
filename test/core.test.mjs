// 骨架的測試：資料層、備份、同步合併、AI 匯入解析。開新專案後保留，再加你自己的規則測試。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import { SHEET_IDS } from '../js/cloud/sheets.js';
import { extractJSON, buildPrompt, num, date, bool, FORMAT } from '../js/aiimport.js';

test('型別整理：文字的空白保留、選填 id 不是正整數就是 null、缺值套預設', () => {
  assert.equal(db.coerce('text', '', 'kg'), ''); // 空白是真的空白
  assert.equal(db.coerce('text', undefined, 'kg'), 'kg'); // 欄位不存在才套預設
  assert.equal(db.coerce('nint', '', undefined), null);
  assert.equal(db.coerce('nint', 0, undefined), null);
  assert.equal(db.coerce('nint', '12', undefined), 12);
  assert.equal(db.coerce('real', '3.5', undefined), 3.5);
  assert.equal(db.coerce('int', true, undefined), 1);
});

test('新增、修改、刪除都記進待同步；id 用時間產生不會撞號', () => {
  db._reset({});
  const a = db.insert('items', { name: 'A' });
  const b = db.insert('items', { name: 'B' });
  assert.ok(b.id > a.id);
  assert.equal(a.data, '{}'); // 預設值
  db.update('items', a.id, { note: '改' });
  db.remove('items', b.id);
  assert.equal(db.count('items'), 1);
  assert.equal(db.pendingCount(), 2); // a 改過、b 刪了
});

test('同步合併：試算表的內容＋這台裝置的修改（以列為單位，最後寫入者勝）', () => {
  db._reset({ items: [{ id: 1, name: '本機改過' }, { id: 3, name: '本機新增' }] });
  const taken = { items: { up: new Set(['1', '3']), del: new Set(['4']) } };
  const remote = [{ id: 1, name: '舊的' }, { id: 2, name: '別台新增' }, { id: 4, name: '本機刪掉的' }];
  const m = db.mergeTable('items', remote, taken.items);
  const names = db.all('items').map((r) => r.name).sort();
  assert.deepEqual(names, ['別台新增', '本機改過', '本機新增']);
  assert.ok(m.remoteDirty); // 要寫回試算表
  assert.ok(m.localChanged); // 本機多了「別台新增」
});

test('備份：匯出再匯入整個取代，格式不對拒絕', () => {
  db._reset({ items: [{ id: 1, name: 'A' }] });
  const backup = JSON.parse(JSON.stringify(db.exportAll()));
  db._reset({ items: [{ id: 9, name: 'X' }, { id: 10, name: 'Y' }] });
  db.replaceAll(backup);
  assert.deepEqual(db.all('items').map((r) => r.name), ['A']);
  assert.throws(() => db.replaceAll({ format: 'other', tables: {} }), /備份/);
});

test('分頁編號：每張 synced 的表都有，而且不重複', () => {
  const ids = Object.values(SHEET_IDS);
  assert.ok(ids.length >= 1);
  assert.equal(new Set(ids).size, ids.length);
});

test('AI 匯入：容許外框與前後說明文字、寬鬆轉換數字日期', () => {
  assert.deepEqual(extractJSON('好的！\n```json\n{"items":[1]}\n```\n以上'), { items: [1] });
  assert.deepEqual(extractJSON('前言 [1,2] 後記'), [1, 2]);
  assert.throws(() => extractJSON('沒有 JSON'), /找不到/);
  assert.throws(() => extractJSON('{"a": 1'), /不完整/);
  assert.equal(num('1,250'), 1250);
  assert.equal(num('$3.5'), 3.5);
  assert.equal(num(''), null);
  assert.equal(date('2026/3/5'), '2026-03-05');
  assert.equal(date('2026年3月5日'), '2026-03-05');
  assert.equal(date('不知道', '2026-01-01'), '2026-01-01');
  assert.equal(bool('是'), true);
  const p = buildPrompt({ intro: '整理資料', kinds: { items: '一筆一個' } });
  assert.match(p, new RegExp(FORMAT));
  assert.match(p, /「items」：一筆一個/);
});
