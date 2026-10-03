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

test('圖片裁到外牆：兩面以上的牆碰到上緣，就沿著上緣補一面牆', () => {
  const { closeBorder } = require('../js/vectorize.js');
  const segs = [
    { dir: 'v', c: 10, t: 6, p0: 0, p1: 80 },
    { dir: 'v', c: 90, t: 6, p0: 0, p1: 80 },
    { dir: 'v', c: 50, t: 4, p0: 1, p1: 40 },
    { dir: 'h', c: 80, t: 6, p0: 7, p1: 93 }
  ];
  const r = closeBorder(segs, 100, 100);
  assert.equal(r.added.length, 1);
  assert.deepEqual(r.added[0], { dir: 'h', c: 3, t: 6, p0: 7, p1: 93, border: true });
  // 上緣已經有牆就不補；只有一面牆碰到邊緣也不補
  assert.equal(closeBorder(r.segments, 100, 100).added.length, 0);
  assert.equal(closeBorder([segs[0], segs[3]], 100, 100).added.length, 0);
});

test('closeOuter：外緣的牆差一段沒接上時延伸過去，室內的開放通道不接', () => {
  const V = require('../js/vectorize.js');
  // 一間 100×60 的房子，右牆只畫了下半段（上半段是圖片外的空白）
  const segs = [
    { dir: 'h', c: 10, t: 4, p0: 10, p1: 110 },     // 上牆
    { dir: 'h', c: 70, t: 4, p0: 10, p1: 110 },     // 下牆
    { dir: 'v', c: 10, t: 4, p0: 10, p1: 70 },      // 左牆
    { dir: 'v', c: 110, t: 4, p0: 45, p1: 70 },     // 右牆只有下半段
    { dir: 'v', c: 60, t: 4, p0: 10, p1: 30 }       // 室內隔間牆，下面是開放通道
  ];
  const n = V.closeOuter(segs, 200, 100, { tol: 3, maxLen: 80 });
  assert.strictEqual(n, 1);
  assert.strictEqual(segs[3].p0, 10, '右牆往上接到上牆');
  assert.strictEqual(segs[4].p1, 30, '隔間牆兩側都有房間，不延伸');
});

test('closeOuter：差不到 reach 就碰到的牆，延伸後兩面牆都接上', () => {
  const V = require('../js/vectorize.js');
  const segs = [
    { dir: 'h', c: 10, t: 4, p0: 10, p1: 100 },     // 上牆短了 8 像素
    { dir: 'v', c: 108, t: 4, p0: 40, p1: 70 },     // 右牆下半段
    { dir: 'h', c: 70, t: 4, p0: 10, p1: 108 },
    { dir: 'v', c: 10, t: 4, p0: 10, p1: 70 }
  ];
  assert.strictEqual(V.closeOuter(segs, 200, 100, { tol: 3, maxLen: 80 }), 0, 'reach 預設等於 tol，碰不到');
  assert.strictEqual(V.closeOuter(segs, 200, 100, { tol: 3, reach: 10, maxLen: 80 }), 1);
  assert.strictEqual(segs[1].p0, 10);
  assert.strictEqual(segs[0].p1, 108);
});
