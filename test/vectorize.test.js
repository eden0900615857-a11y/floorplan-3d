const test = require('node:test');
const assert = require('node:assert/strict');
const { extractWalls } = require('../js/vectorize.js');
const { blankMask, fillRect } = require('./helpers.js');

const byDir = (segs, dir) => segs.filter(s => s.dir === dir).sort((a, b) => a.c - b.c || a.p0 - b.p0);

test('封閉房間的四面牆變成四條線段', () => {
  const m = blankMask(200, 150);
  fillRect(m, 20, 20, 160, 10);   // 上
  fillRect(m, 20, 120, 160, 10);  // 下
  fillRect(m, 20, 20, 10, 110);   // 左
  fillRect(m, 170, 20, 10, 110);  // 右
  const { segments, coverage } = extractWalls(m.mask, m.w, m.h, { minThickness: 5 });
  const h = byDir(segments, 'h'), v = byDir(segments, 'v');
  assert.equal(h.length, 2);
  assert.equal(v.length, 2);
  assert.deepEqual([h[0].p0, h[0].p1, h[0].c, h[0].t], [20, 180, 25, 10]);
  assert.deepEqual([h[1].p0, h[1].p1, h[1].c, h[1].t], [20, 180, 125, 10]);
  assert.deepEqual([v[0].c, v[0].t], [25, 10]);
  assert.deepEqual([v[1].c, v[1].t], [175, 10]);
  assert.equal(coverage, 1);
});

test('門洞的缺口保留成兩段牆', () => {
  const m = blankMask(300, 60);
  fillRect(m, 10, 20, 120, 12);
  fillRect(m, 200, 20, 90, 12);
  const { segments } = extractWalls(m.mask, m.w, m.h, { minThickness: 5 });
  const h = byDir(segments, 'h');
  assert.equal(h.length, 2);
  assert.deepEqual([h[0].p0, h[0].p1], [10, 130]);
  assert.deepEqual([h[1].p0, h[1].p1], [200, 290]);
});

test('T 字交會：水平牆不會被垂直牆吃掉', () => {
  const m = blankMask(420, 320);
  fillRect(m, 100, 0, 20, 300);   // 垂直牆（厚 20）
  fillRect(m, 0, 150, 400, 14);   // 橫跨的水平牆（厚 14）
  const { segments } = extractWalls(m.mask, m.w, m.h, { minThickness: 5 });
  const h = byDir(segments, 'h'), v = byDir(segments, 'v');
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].p0, h[0].p1, h[0].t], [0, 400, 14]);
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].p0, v[0].p1, v[0].t], [0, 300, 20]);
});

test('同一條線上的小缺口會合併', () => {
  const m = blankMask(300, 60);
  fillRect(m, 10, 20, 120, 10);
  fillRect(m, 133, 20, 100, 10);  // 只隔 3 像素（例如掃描雜訊）
  const { segments } = extractWalls(m.mask, m.w, m.h, { minThickness: 5 });
  const h = byDir(segments, 'h');
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].p0, h[0].p1], [10, 233]);
});

test('短小的方塊（例如柱子或文字殘留）不會變成牆', () => {
  const m = blankMask(100, 100);
  fillRect(m, 40, 40, 12, 12);
  const { segments } = extractWalls(m.mask, m.w, m.h, { minThickness: 5 });
  assert.equal(segments.length, 0);
});

test('比最小牆厚還薄的碎片、粗體字大小的色塊不會變成牆', () => {
  const m = blankMask(200, 100);
  fillRect(m, 20, 20, 1, 14);    // 貼著牆邊、只有 1 像素寬的碎片
  fillRect(m, 100, 50, 19, 10);  // 粗體字殘留：長度不到厚度的兩倍
  const { segments } = extractWalls(m.mask, m.w, m.h, { minThickness: 5 });
  assert.equal(segments.length, 0);
});
