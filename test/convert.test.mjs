// 舊 CSV 轉換（tools/convert-csv.mjs）。只用假資料。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, splitBrand, colorFamily, clothingRow, clothingTable, bookTable, buildBackup, parseProxyPrice, proxyTable, cleanTitle, buildPack } from '../tools/convert-csv.mjs';

test('CSV：引號、引號裡的逗號、BOM、CRLF', () => {
  assert.deepEqual(parseCSV('﻿a,"b,c","d""e"\r\n1,2,3'), [['a', 'b,c', 'd"e'], ['1', '2', '3']]);
});

test('品牌：名稱開頭的簡稱拆出來', () => {
  assert.deepEqual(splitBrand('UQ寬版假褲'), { brand: 'UNIQLO', name: '寬版假褲' });
  assert.deepEqual(splitBrand('GU 假上衣'), { brand: 'GU', name: '假上衣' });
  assert.deepEqual(splitBrand('ADDIDA 假長褲'), { brand: 'adidas', name: '假長褲' });
  assert.deepEqual(splitBrand('沒有品牌'), { brand: '', name: '沒有品牌' });
});

test('色系：官方色號和中文都認得', () => {
  assert.equal(colorFamily('09 BLACK'), '黑');
  assert.equal(colorFamily('白 01 OFF WHITE'), '白');
  assert.equal(colorFamily('57 OLIVE'), '綠');
  assert.equal(colorFamily('牛仔色'), '牛仔');
  assert.equal(colorFamily('黑白相間'), '多色');
  assert.equal(colorFamily('奶茶色'), '棕');
  assert.equal(colorFamily('看不出來'), '');
});

test('衣服一列：價格取整數台幣、日期統一、商品編號分開、備註從日期欄搬出來', () => {
  const r = clothingRow('長褲', { name: 'UQ 假褲', kind: '牛仔褲', price: '543.6363636', size: '28', color: '69 NAVY', url: '123456', bought: '2023/3/5' });
  assert.equal(r.name, '假褲');
  assert.deepEqual(r.data, { f1: '長褲', f2: '牛仔褲', f3: 'UNIQLO', f4: '28', f5: '69 NAVY', f6: '藍', f7: { a: 544, c: 'TWD', r: 1 }, f8: '2023-03-05', f9: '在穿', f11: '123456' });
  const n = clothingRow('外套', { name: '假外套', bought: '想丟掉? 還沒洗' });
  assert.equal(n.note, '想丟掉? 還沒洗');
  assert.equal(n.data.f9, '想丟');
  assert.equal(n.data.f8, undefined);
  const u = clothingRow('外套', { name: '假', url: '某店 | 假外套' });
  assert.equal(u.data.f10, '某店 | 假外套');
});

test('衣服一列：價格欄放了尺寸 → 整列往右移一格', () => {
  const r = clothingRow('長袖', { name: '假襯衫', price: 'S', size: '奶茶色' });
  assert.equal(r.data.f4, 'S');
  assert.equal(r.data.f5, '奶茶色');
  assert.equal(r.data.f7, undefined);
});

test('衣服的表：有沒有「類別」欄都行；右邊的統計欄不管；沒名稱的列跳過', () => {
  const withKind = clothingTable('短袖', [['第 1 欄', '類別', '價格', '尺寸', '顏色', '網址', '購入時間', '', '', '9'], ['假T', 'T恤', '100', 'M', '黑', '', '2020', '', 'T恤', '9'], ['', '', '', '', '', '', '', '', '', '']]);
  assert.equal(withKind.length, 1);
  assert.equal(withKind[0].data.f2, 'T恤');
  assert.equal(withKind[0].data.f8, '2020');
  const noKind = clothingTable('短褲', [['', '價格', '尺寸', '顏色', '網址', '購入時間'], ['假短褲', '', 'S', '灰色', '', '']]);
  assert.equal(noKind[0].data.f2, undefined);
  assert.equal(noKind[0].data.f4, 'S');
});

test('書：拿掉店家標題尾巴、標出購買管道與電子書', () => {
  const { items, skipped } = bookTable([['品名', '語言', '作者'], ['假書甲 通販 - メロンブックス', '日文', '假社團 (假作者)'], ['假書乙 電子書籍 - メロンブックス', '日文', '某人'], ['  假書丙 ', '中文', '']]);
  assert.equal(skipped, 0);
  assert.deepEqual(items.map((i) => i.name), ['假書甲', '假書乙', '假書丙']);
  assert.deepEqual(items[0].data, { f4: 'メロンブックス', f1: '假社團 (假作者)', f2: '日文' });
  assert.equal(items[1].data.f3, '電子');
});

test('代購價格欄：特價、附台幣、預算、純數字、其他文字', () => {
  assert.deepEqual(parseProxyPrice('3990 -> 2990'), { notes: ['原價 ¥3990'], price: 2990 });
  assert.deepEqual(parseProxyPrice('1,990円 (台幣590)'), { notes: [], price: 1990, tw: 590 });
  assert.deepEqual(parseProxyPrice('2000 內可以買'), { notes: ['預算 ¥2000 內'] });
  assert.deepEqual(parseProxyPrice('4,990'), { notes: [], price: 4990 });
  assert.deepEqual(parseProxyPrice('看情況'), { notes: ['看情況'] });
  assert.deepEqual(parseProxyPrice(''), { notes: [] });
});

test('代購表：買了沒、規格合併、商品頁標題整理、備註裡的台幣當台灣價格', () => {
  const rows = [
    ['誰', '買了', '品名', '尺寸', '顏色', '型號', '價格', '數量', '備註'],
    ['甲', '✅', 'ユニクロ公式 | 假褲子(メンズ)', 'S', 'カラー: 09 BLACK', '123456', '3990 -> 2990', '2', ''],
    ['乙', '', '假的零食', '', '', '', '', '', '台幣120'],
    ['乙', '', '', '', '', '', '', '', ''],
  ];
  const list = proxyTable(rows, '第一批');
  assert.equal(list.length, 2);
  assert.equal(list[0].name, '假褲子(メンズ)');
  assert.deepEqual(list[0].data, { f1: '甲', f2: '已買', f3: '未收', f5: 'S／09 BLACK', f6: '123456', f7: 2, f8: { a: 2990, c: 'JPY', r: null }, f10: 'ユニクロ公式 | 假褲子(メンズ)' });
  assert.equal(list[0].note, '原價 ¥3990 #第一批');
  assert.equal(list[1].note, '#第一批');
  assert.equal(list[1].data.f2, '待買');
  assert.deepEqual(list[1].data.f9, { a: 120, c: 'TWD', r: 1 });
  assert.equal(cleanTitle('假襪子 | [公式]某店（某店）通販'), '假襪子');
  const pack = buildPack('proxy', list);
  assert.equal(pack.format, 'collection-pack');
  assert.equal(pack.kind, 'proxy');
  assert.equal(pack.items.length, 2);
});

test('備份檔：物品帶 kind；格式是本網站的備份', () => {
  const b = buildBackup([{ kind: 'clothes', list: [clothingRow('短袖', { name: 'GU 假T', kind: '新款式' })] }, { kind: 'books', list: [] }]);
  assert.equal(b.format, 'collection-backup');
  assert.equal(b.tables.items.length, 1);
  assert.equal(b.tables.items[0].kind, 'clothes');
  assert.equal(b.tables.collections, undefined);
});
