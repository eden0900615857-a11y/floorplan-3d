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

test('openingParts：門有門框三根、門片和門把，門片往開門那一側轉開', () => {
  const wall = { id: 'w1', a: [0, 0], b: [4, 0], thickness: 0.15, height: 2.8 };
  const door = { id: 'o1', wall: 'w1', type: 'door', offset: 1, width: 0.9, height: 2.1, hinge: 'a', swing: 'left' };
  const sp = plan.openingSpans(wall, [door])[0];
  const parts = plan.openingParts(wall, sp);
  assert.deepStrictEqual(parts.map(p => p.kind), ['frame', 'frame', 'frame', 'leaf', 'handle']);
  const leaf = parts[3];
  assert.ok(leaf.q > 0, '往左側（q 為正）開');
  assert.ok(leaf.angle > 0 && leaf.angle < Math.PI / 2);
  assert.ok(leaf.s > sp.s0 && leaf.s < sp.s1, '門軸在 a 端，門片中心在門洞範圍內');
  // 門軸在 b 端、往右開：門片在右側，從 b 端往回轉
  const p2 = plan.openingParts(wall, plan.openingSpans(wall, [{ ...door, hinge: 'b', swing: 'right' }])[0]);
  const leaf2 = p2.find(p => p.kind === 'leaf');
  assert.ok(leaf2.q < 0);
  assert.ok(Math.cos(leaf2.angle) < 0, '從 b 端往 a 的方向');
  assert.ok(Math.abs((leaf.s - sp.s0) - (sp.s1 - leaf2.s)) < 1e-9, '左右對稱');
});

test('openingParts：窗有四邊窗框、寬窗加中間直框、有窗台板；落地窗沒有窗台', () => {
  const wall = { id: 'w1', a: [0, 0], b: [4, 0], thickness: 0.15, height: 2.8 };
  const win = { id: 'o1', wall: 'w1', type: 'window', offset: 1, width: 1.2, height: 1.2, sill: 0.9 };
  const parts = plan.openingParts(wall, plan.openingSpans(wall, [win])[0]);
  assert.strictEqual(parts.length, 6);
  assert.ok(parts.every(p => p.kind === 'frame'));
  assert.strictEqual(Math.max(...parts.map(p => p.y1)), 2.1);
  const narrow = plan.openingParts(wall, plan.openingSpans(wall, [{ ...win, width: 0.6, sill: 0 }])[0]);
  assert.strictEqual(narrow.length, 4);
});

test('faceRooms：外牆跨兩個房間時切成兩段，左右牆面各自對到房間', () => {
  const wall = { id: 'w1', a: [0, 0], b: [7, 0], thickness: 0.2, height: 2.8 };
  const A = { id: 'A' }, B = { id: 'B' };
  // a→b 往右（x 增加），左側法向量是 (0, −1)：牆的上方是屋外，下方是房間；x = 3.4–3.6 是隔間牆
  const roomAt = p => p[1] <= 0 ? null : p[0] < 3.4 ? A : p[0] > 3.6 ? B : null;
  const runs = plan.faceRooms(wall, 0, 7, roomAt);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map(r => [r.left, r.right]), [[null, A], [null, B]]);
  assert.equal(runs[0].s0, 0);
  assert.equal(runs[1].s1, 7);
  assert.ok(runs[0].s1 >= 3.4 && runs[0].s1 <= 3.7, '分段點在隔間牆裡：' + runs[0].s1);
  // 只有一個房間：一段
  assert.equal(plan.faceRooms(wall, 1, 3, roomAt).length, 1);
});

test('牆的種類：矮牆、玻璃欄杆高 1.1 公尺，玻璃欄杆有牆座、玻璃、扶手與立柱', () => {
  const wall = { id: 'w1', a: [0, 0], b: [3, 0], thickness: 0.12, height: 2.8 };
  assert.equal(plan.wallHeight(wall), 2.8);
  assert.equal(plan.wallHeight({ ...wall, kind: 'low' }), plan.RAIL_H);
  const pieces = plan.wallPieces({ ...wall, kind: 'glass' }, []);
  assert.deepEqual(pieces.map(p => [p.y0, p.y1]), [[0, 1.1]]);
  const parts = plan.railingParts({ ...wall, kind: 'glass' }, 0, 3);
  assert.deepEqual(parts.slice(0, 3).map(p => p.kind), ['curb', 'glass', 'metal']);
  assert.equal(parts.length - 3, 4, '3 公尺分 3 格，4 根立柱');
  assert.ok(Math.abs(Math.max(...parts.map(p => p.y1)) - 1.1) < 1e-9);
});

test('落地窗：窗台 0 時窗下沒有牆，也沒有窗台板', () => {
  const wall = { id: 'w1', a: [0, 0], b: [4, 0], thickness: 0.15, height: 2.8 };
  const win = { id: 'o1', wall: 'w1', type: 'window', offset: 2, width: 2, height: 2.1, sill: 0 };
  const pieces = plan.wallPieces(wall, [win]);
  assert.ok(!pieces.some(p => p.s0 >= 1 && p.s1 <= 3 && p.y0 === 0), '窗下面沒有牆');
  const parts = plan.openingParts(wall, plan.openingSpans(wall, [win])[0]);
  assert.ok(parts.every(p => p.y0 >= 0), '沒有低於地面的窗台板');
  assert.equal(parts.length, 5, '四邊窗框加中間直框');
});
