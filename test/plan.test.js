const test = require('node:test');
const assert = require('node:assert/strict');
const plan = require('../js/plan.js');

const segs = [
  { dir: 'h', c: 25, t: 10, p0: 20, p1: 180 },
  { dir: 'v', c: 25, t: 10, p0: 20, p1: 130 }
];
const opts = { widthPx: 200, heightPx: 150, pxPerMeter: 20, wallHeight: 2.8 };

test('像素線段換算成公尺', () => {
  const p = plan.fromSegments(segs, opts);
  assert.equal(p.version, 1);
  assert.deepEqual(p.walls[0], { id: 'w1', a: [1, 1.25], b: [9, 1.25], thickness: 0.5, height: 2.8 });
  assert.deepEqual(p.walls[1].a, [1.25, 1]);
  assert.deepEqual(p.walls[1].b, [1.25, 6.5]);
  assert.deepEqual(plan.validate(p), []);
});

test('平面範圍依原圖大小計算', () => {
  const p = plan.fromSegments(segs, opts);
  assert.deepEqual(plan.bounds(p), { minX: 0, minY: 0, maxX: 10, maxY: 7.5 });
});

test('格式錯誤會列出原因', () => {
  const bad = { version: 1, unit: 'm', walls: [{ id: 'w1', a: [0, 0], b: [0, 0], thickness: 0, height: 2.8 }] };
  const errors = plan.validate(bad);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /長度為 0/);
  assert.match(errors[1], /厚度/);
  assert.deepEqual(plan.validate(null), ['不是有效的 JSON 物件']);
});
