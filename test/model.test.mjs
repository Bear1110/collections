// 收藏的資料規則（js/model.js）。只用假資料。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../js/model.js';

const item = (name, data = {}, note = '') => ({ id: Math.random(), kind: 'proxy', name, note, data: JSON.stringify(data) });

test('日期：可以只填年份或年月，格式統一成 YYYY-MM-DD', () => {
  assert.equal(m.normDate('2023/3/5'), '2023-03-05');
  assert.equal(m.normDate('2025/01/06'), '2025-01-06');
  assert.equal(m.normDate('2018'), '2018');
  assert.equal(m.normDate('2024/12'), '2024-12');
  assert.equal(m.normDate('2024年3月'), '2024-03');
  assert.equal(m.normDate(''), '');
  assert.equal(m.normDate('可以丟'), null);
  assert.equal(m.normDate('2024/13/01'), null);
});

test('金額：台幣匯率固定 1；外幣乘匯率換台幣；沒匯率算不出台幣', () => {
  assert.deepEqual(m.normMoney({ a: '790', c: 'TWD', r: 5 }), { a: 790, c: 'TWD', r: 1 });
  assert.equal(m.moneyTWD({ a: 7980, c: 'JPY', r: 0.22 }), 1756);
  assert.equal(m.moneyTWD({ a: 7980, c: 'JPY' }), null);
  assert.equal(m.normMoney({ a: '', c: 'JPY', r: 0.2 }), null);
  assert.equal(m.fmtMoney({ a: 7980, c: 'JPY', r: 0.22 }), '¥7,980（NT$1,756）');
  assert.equal(m.fmtMoney({ a: 300, c: 'TWD', r: 1 }), 'NT$300');
  assert.equal(m.fmtMoney(null), '');
});

test('網址欄：網址顯示網域；www 補 https；其他文字連到搜尋', () => {
  assert.deepEqual(m.linkOf('https://www.example.com/p/1?x=2'), { href: 'https://www.example.com/p/1?x=2', text: 'example.com', search: false });
  assert.equal(m.linkOf('www.example.com/a').href, 'https://www.example.com/a');
  const s = m.linkOf('某店 | 刷毛外套');
  assert.ok(s.search);
  assert.match(s.href, /google\.com\/search\?q=/);
  assert.equal(m.linkOf('  '), null);
});

test('標籤：逗號、頓號分隔，去重複和空白', () => {
  assert.deepEqual(m.normTags('甲, 乙、甲,,丙'), ['甲', '乙', '丙']);
  assert.deepEqual(m.normTags(['a', ' a ', '']), ['a']);
});

test('篩選、搜尋、分組、統計', () => {
  const fields = [
    { key: 'f1', label: '部位', type: 'choice', options: ['短袖', '長褲'] },
    { key: 'f2', label: '顏色', type: 'text' },
    { key: 'f3', label: '標籤', type: 'tags' },
  ];
  const items = [
    item('素T 甲', { f1: '短袖', f2: '黑', f3: ['常穿'] }),
    item('素T 乙', { f1: '短袖', f2: '白' }),
    item('工作褲', { f1: '長褲', f2: '黑' }, '有點舊'),
    item('不知道', {}),
  ];
  assert.equal(m.filterItems(items, fields, { filters: { f1: '短袖' } }).length, 2);
  assert.equal(m.filterItems(items, fields, { filters: { f1: m.EMPTY } }).length, 1);
  assert.equal(m.filterItems(items, fields, { filters: { f3: '常穿' } }).length, 1);
  assert.equal(m.filterItems(items, fields, { q: '黑 素t' }).length, 1); // 每個字都要有
  assert.equal(m.filterItems(items, fields, { q: '舊' }).length, 1); // 備註也搜
  assert.deepEqual(m.countBy(items, fields[0]), [{ value: '短袖', n: 2 }, { value: '長褲', n: 1 }, { value: m.EMPTY, n: 1 }]);
  const groups = m.groupItems(items, fields[0]);
  assert.deepEqual(groups.map((g) => [g.value, g.items.length]), [['短袖', 2], ['長褲', 1], [m.EMPTY, 1]]);
  assert.equal(m.groupItems(items, null)[0].items.length, 4);
});

test('台幣合計：沒匯率的外幣另外算筆數', () => {
  const f = { key: 'p', label: '價格', type: 'money' };
  const items = [item('a', { p: { a: 100, c: 'TWD', r: 1 } }), item('b', { p: { a: 1000, c: 'JPY', r: 0.2 } }), item('c', { p: { a: 5, c: 'USD' } }), item('d')];
  assert.deepEqual(m.sumTWD(items, f), { total: 300, missing: 1 });
});

test('代購：單價 × 數量、缺貨不算錢、整批改匯率', () => {
  const fields = [
    { key: 's', label: '狀態', type: 'choice', options: ['已買', '缺貨'], noSum: ['缺貨'] },
    { key: 'q', label: '數量', type: 'number' },
    { key: 'p', label: '單價', type: 'money', qty: 'q' },
  ];
  const p = fields[2];
  assert.equal(m.lineTWD(p, { p: { a: 1000, c: 'JPY', r: 0.2 }, q: 3 }), 600);
  assert.equal(m.lineTWD(p, { p: { a: 100, c: 'TWD', r: 1 } }), 100); // 沒填數量當 1
  assert.equal(m.lineTWD(p, { p: { a: 100, c: 'TWD', r: 1 }, q: -2 }), 100);
  const items = [
    item('a', { s: '已買', q: 2, p: { a: 1000, c: 'JPY', r: 0.2 } }),
    item('b', { s: '缺貨', q: 1, p: { a: 5000, c: 'JPY', r: 0.2 } }),
    item('c', { s: '已買', p: { a: 10, c: 'USD', r: 32 } }),
  ];
  assert.deepEqual(m.sumTWD(items, p, fields), { total: 720, missing: 0 });
  assert.deepEqual(m.sumTWD(items, p), { total: 1720, missing: 0 }); // 沒給欄位就全算
  assert.deepEqual(m.foreignCurrencies(items, fields), ['JPY', 'USD']);
  const ch = m.setRate(items, fields, 'JPY', 0.21);
  assert.equal(ch.length, 2);
  assert.deepEqual(JSON.parse(ch[0].data).p, { a: 1000, c: 'JPY', r: 0.21 });
  assert.throws(() => m.setRate(items, fields, 'JPY', 0), /大於 0/);
  assert.throws(() => m.setRate(items, fields, 'TWD', 1), /台幣/);
});

test('重複提醒：名稱互相包含（不分大小寫、忽略空白標點）', () => {
  const items = [item('假的書 第1集'), item('另一本')];
  assert.equal(m.similarItems(items, '假的書').length, 1);
  assert.equal(m.similarItems(items, '假的書第 1 集').length, 1);
  assert.equal(m.similarItems(items, '甲').length, 0); // 太短不比
});

test('存物品：依型別整理、空的不存、日期看不懂報錯', () => {
  const row = m.buildItem('proxy', { name: ' 假零食 ', f1: '甲', f7: '3', f8: { a: '1000', c: 'JPY', r: '0.2' }, f5: '' });
  assert.equal(row.name, '假零食');
  assert.deepEqual(JSON.parse(row.data), { f1: '甲', f7: 3, f8: { a: 1000, c: 'JPY', r: 0.2 } });
  assert.throws(() => m.buildItem('clothes', { name: 'x', f8: '去年' }), /購入/);
  assert.throws(() => m.buildItem('books', { name: '  ' }), /名稱/);
});

test('單選的選項：寫死的基本選項＋物品上出現過的值', () => {
  const field = { key: 'k', label: '款式', type: 'choice', options: ['素T', '沒人用'] };
  const items = [item('a', { k: '素T' }), item('b', { k: '新款式' }), item('c', {})];
  assert.deepEqual(m.optionValues(field, items), [{ value: '素T', n: 1 }, { value: '沒人用', n: 0 }, { value: '新款式', n: 1 }]);
});

test('匯出 CSV：欄位攤開、金額用台幣小計、逗號要加引號', () => {
  const csv = m.toCSV('proxy', [item('a,b', { f1: '甲', f7: 2, f8: { a: 1000, c: 'JPY', r: 0.2 } }, '備')]);
  const [head, row] = csv.replace(/^\ufeff/, '').split('\r\n');
  assert.ok(head.startsWith('名稱,幫誰買,狀態'));
  assert.ok(row.startsWith('"a,b",甲,'));
  assert.ok(row.includes(',400,')); // 1000 × 0.2 × 2
});

test('種類：欄位代號不重複、分組欄位存在、數量欄位存在', () => {
  for (const [id, k] of Object.entries(m.KINDS)) {
    const keys = k.fields.map((x) => x.key);
    assert.equal(new Set(keys).size, keys.length, id);
    assert.ok(keys.includes(k.group_by), id);
    for (const x of k.fields) if (x.qty) assert.equal(k.fields.find((y) => y.key === x.qty)?.type, 'number', `${id}.${x.key}`);
  }
});

test('舊資料轉換：collections 拿掉、物品依種類名稱加上 kind、其他種類不轉', () => {
  const old = {
    collections: [{ id: 1, name: '衣服' }, { id: 2, name: '代購' }, { id: 3, name: '周邊' }],
    items: [{ id: 10, collection_id: 1, name: 'a' }, { id: 11, collection_id: 2, name: 'b' }, { id: 12, collection_id: 3, name: 'c' }],
    settings: [{ key: 'x', value: '1' }],
  };
  const { tables, dropped } = m.migrateTables(old);
  assert.equal(dropped, 1);
  assert.deepEqual(tables.items, [{ id: 10, name: 'a', kind: 'clothes' }, { id: 11, name: 'b', kind: 'proxy' }]);
  assert.equal(tables.collections, undefined);
  assert.deepEqual(tables.settings, old.settings);
  assert.equal(m.migrateTables(tables).tables, tables); // 新版原樣回傳
});

test('#標籤：抓得到全形井號、到空白或標點為止；切換加上／拿掉', () => {
  assert.deepEqual(m.noteTags('幫忙買 #2026楓葉之旅、＃大阪 #a'), ['#2026楓葉之旅', '#大阪', '#a']);
  assert.equal(m.toggleTag('備註', '#東京'), '備註 #東京');
  assert.equal(m.toggleTag('備註 #東京 其他', '#東京'), '備註 其他');
  assert.equal(m.removeTag('#東京', '#東京'), '');
  assert.equal(m.batchToTag(' 第一 批 '), '#第一批');
});

test('批次：依標籤篩選、零星＝沒標籤、出現過的標籤新的在前', () => {
  const items = [{ id: 1, name: 'a', note: '#舊旅行' }, { id: 2, name: 'b', note: '' }, { id: 3, name: 'c', note: '記得 #新旅行' }, { id: 4, name: 'd', note: '#新旅行' }];
  assert.deepEqual(items.filter((i) => m.inBatch(i, '#新旅行')).map((i) => i.id), [3, 4]);
  assert.deepEqual(items.filter((i) => m.inBatch(i, m.NO_BATCH)).map((i) => i.id), [2]);
  assert.deepEqual(m.batchesOf(items), [{ tag: '#新旅行', n: 2 }, { tag: '#舊旅行', n: 1 }]);
});

test('最近用過的人：新的在前、不重複、按 ✕ 隱藏的不推薦', () => {
  const items = [item('a', { f1: '甲' }), item('b', { f1: '乙' }), item('c', { f1: '甲' }), item('d', { f1: '丙' })].map((x, i) => ({ ...x, id: i + 1 }));
  assert.deepEqual(m.recentValues(items, 'f1'), ['丙', '甲', '乙']);
  assert.deepEqual(m.recentValues(items, 'f1', { hidden: ['甲'], max: 1 }), ['丙']);
});

test('結清：有標籤看標籤有沒有結清；零星的處理完就收起來', () => {
  const closed = new Set(['#舊旅行']);
  const it = (note, f2, f3) => ({ id: 1, name: 'x', note, data: JSON.stringify({ f2, f3 }) });
  assert.equal(m.isArchived(it('#舊旅行', '待買', '未收'), closed), true);
  assert.equal(m.isArchived(it('#新旅行', '已交貨', '已收'), closed), false);
  assert.equal(m.isArchived(it('', '已交貨', '已收'), closed), true);
  assert.equal(m.isArchived(it('', '缺貨', '未收'), closed), true);
  assert.equal(m.isArchived(it('', '已買', '已收'), closed), false);
  const list = [
    item('a', { f1: '甲', f2: '待買', f3: '未收', f7: 2, f8: { a: 100, c: 'TWD', r: 1 } }),
    item('b', { f1: '甲', f2: '已買', f3: '已收', f8: { a: 50, c: 'TWD', r: 1 } }),
    item('c', { f1: '乙', f2: '缺貨', f3: '未收', f8: { a: 999, c: 'TWD', r: 1 } }),
  ];
  assert.deepEqual(m.unfinished(list), { toBuy: 1, notDelivered: 1, unpaid: 1, unpaidTWD: 200 });
  const sum = m.batchSummary(list);
  assert.equal(sum.total, 250);
  assert.deepEqual(sum.byPerson.map((p) => [p.who, p.total]), [['甲', 250], ['乙', 0]]);
});

test('舊的批次欄 → 備註標籤；台灣價格只能是台幣', () => {
  const r = m.migrateBatch({ note: '備', data: JSON.stringify({ f1: '甲', f4: '第一 批' }) });
  assert.deepEqual(r, { note: '備 #第一批', data: JSON.stringify({ f1: '甲' }) });
  assert.equal(m.migrateBatch({ note: '', data: '{}' }), null);
  const row = m.buildItem('proxy', { name: 'x', f9: { a: '500', c: 'JPY', r: '0.2' } });
  assert.deepEqual(JSON.parse(row.data).f9, { a: 500, c: 'TWD', r: 1 });
});
