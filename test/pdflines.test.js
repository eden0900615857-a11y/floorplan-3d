const test = require('node:test');
const assert = require('node:assert/strict');
const { fromOperatorList, crop, rasterize } = require('../js/pdflines.js');

// 和 pdf.js 的 OPS 一樣是「名稱 → 數字」，數字本身沒有意義
const OPS = {
  save: 1, restore: 2, transform: 3, constructPath: 4, moveTo: 5, lineTo: 6, curveTo: 7, curveTo2: 8, curveTo3: 9,
  closePath: 10, rectangle: 11, stroke: 12, fill: 13, endPath: 14, setLineWidth: 15, closeStroke: 16, eoFill: 17,
  fillStroke: 18, eoFillStroke: 19, closeFillStroke: 20, closeEOFillStroke: 21, paintFormXObjectBegin: 22, paintFormXObjectEnd: 23
};
const FLIP = [1, 0, 0, -1, 0, 100];   // 頁面高 100，換成 y 向下
const round = s => [s.x0, s.y0, s.x1, s.y1].map(v => Math.round(v * 100) / 100);

test('同一條路徑拆成兩個 constructPath 也要接起來（pdf.js 實際會這樣拆）', () => {
  const fn = [OPS.constructPath, OPS.constructPath, OPS.stroke];
  const args = [[[OPS.moveTo], [10, 90]], [[OPS.lineTo], [50, 90]], null];
  const out = fromOperatorList(fn, args, OPS, FLIP);
  assert.equal(out.length, 1);
  assert.deepEqual(round(out[0]), [10, 10, 50, 10]);
  assert.equal(out[0].curve, false);
});

test('座標轉換、線寬換算，save/restore 會還原', () => {
  const fn = [OPS.save, OPS.transform, OPS.setLineWidth, OPS.constructPath, OPS.stroke, OPS.restore, OPS.constructPath, OPS.stroke];
  const args = [null, [2, 0, 0, 2, 5, 0], [0.5], [[OPS.moveTo, OPS.lineTo], [0, 0, 10, 0]], null, null, [[OPS.moveTo, OPS.lineTo], [0, 0, 10, 0]], null];
  const out = fromOperatorList(fn, args, OPS, FLIP);
  assert.deepEqual(round(out[0]), [5, 100, 25, 100]);
  assert.equal(out[0].w, 1);
  assert.deepEqual(round(out[1]), [0, 100, 10, 100]);
  assert.equal(out[1].w, 1);
});

test('矩形拆成四條邊；裁切用的路徑（endPath）不算線；範圍外的線丟掉', () => {
  const fn = [OPS.constructPath, OPS.fill, OPS.constructPath, OPS.endPath, OPS.constructPath, OPS.stroke];
  const args = [[[OPS.rectangle], [10, 10, 20, 30]], null, [[OPS.rectangle], [0, 0, 100, 100]], null, [[OPS.moveTo, OPS.lineTo], [500, 50, 600, 50]], null];
  const out = fromOperatorList(fn, args, OPS, FLIP, [0, 0, 100, 100]);
  assert.equal(out.length, 4);
  assert.deepEqual(out.map(round), [[10, 90, 30, 90], [30, 90, 30, 60], [30, 60, 10, 60], [10, 60, 10, 90]]);
});

test('曲線拆成短線段並標記 curve，終點正確', () => {
  const fn = [OPS.constructPath, OPS.stroke];
  const args = [[[OPS.moveTo, OPS.curveTo], [0, 100, 0, 50, 50, 0, 100, 0]], null];
  const out = fromOperatorList(fn, args, OPS, [1, 0, 0, 1, 0, 0]);
  assert.equal(out.length, 8);
  assert.ok(out.every(s => s.curve));
  assert.deepEqual(round(out[7]).slice(2), [100, 0]);
});

test('裁切改成以範圍左上角為原點，畫成遮罩', () => {
  const lines = crop([{ x0: 10, y0: 20, x1: 14, y1: 20 }, { x0: 90, y0: 90, x1: 95, y1: 95 }], 10, 10, 50, 50);
  assert.equal(lines.length, 1);
  assert.deepEqual(round(lines[0]), [0, 10, 4, 10]);
  const m = rasterize(lines, 8, 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(x => m[10 * 8 + x]), [1, 1, 1, 1, 1, 0]);
});
