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

test('牆被門窗切成 3D 方塊：門上方留過樑，窗上下都有牆', () => {
  const wall = { id: 'w1', a: [0, 0], b: [6, 0], thickness: 0.2, height: 2.8 };
  const door = { id: 'o1', type: 'door', wall: 'w1', offset: 1, width: 0.8, height: 2.1 };
  const win = { id: 'o2', type: 'window', wall: 'w1', offset: 4, width: 1.2, height: 1.2, sill: 0.9 };
  const pieces = plan.wallPieces(wall, [win, door]).map(p => [p.s0, p.s1, p.y0, +p.y1.toFixed(3)]);
  assert.deepEqual(pieces, [
    [0, 0.6, 0, 2.8],
    [0.6, 1.4, 2.1, 2.8],
    [1.4, 3.4, 0, 2.8],
    [3.4, 4.6, 0, 0.9],
    [3.4, 4.6, 2.1, 2.8],
    [4.6, 6, 0, 2.8]
  ]);
});

test('超出牆的門窗會被限制在牆內；沒有門窗就是一整塊', () => {
  const wall = { id: 'w1', a: [0, 0], b: [2, 0], thickness: 0.2, height: 2.8 };
  const door = { id: 'o1', type: 'door', wall: 'w1', offset: 1.9, width: 0.8, height: 2.1 };
  assert.deepEqual(plan.wallPieces(wall, [door]).map(p => [+p.s0.toFixed(2), +p.s1.toFixed(2)]), [[0, 1.5], [1.5, 2]]);
  assert.equal(plan.wallPieces(wall, []).length, 1);
});

test('門窗格式錯誤會列出原因', () => {
  const p = plan.fromSegments(segs, opts);
  p.openings = [{ id: 'o1', type: 'gate', wall: 'w1', offset: 1, width: 1, height: 2 },
    { id: 'o2', type: 'door', wall: 'w99', offset: 1, width: 0, height: 2 }];
  const errors = plan.validate(p);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /door 或 window/);
  assert.match(errors[1], /w99/);
  assert.match(errors[2], /寬度/);
});
