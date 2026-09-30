const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/edit.js');

function samplePlan() {
  return {
    version: 1, unit: 'm',
    source: { widthPx: 200, heightPx: 100, pxPerMeter: 20, image: null },
    walls: [
      { id: 'w1', a: [0, 0], b: [4, 0], thickness: 0.2, height: 2.8 },
      { id: 'w2', a: [4, 0], b: [4, 3], thickness: 0.2, height: 2.8 },
      { id: 'w7', a: [0, 3], b: [4, 3], thickness: 0.1, height: 2.8 }
    ],
    openings: [], rooms: [], furniture: [], materials: {}
  };
}

test('新增牆使用下一個編號', () => {
  const p = samplePlan();
  const w = E.addWall(p, [1, 1], [1.23456, 2], 0.15, 2.8);
  assert.equal(w.id, 'w8');
  assert.deepEqual(w.b, [1.235, 2]);
  assert.equal(p.walls.length, 4);
});

test('刪除牆', () => {
  const p = samplePlan();
  assert.equal(E.deleteWall(p, 'w2'), true);
  assert.equal(E.deleteWall(p, 'nope'), false);
  assert.deepEqual(p.walls.map(w => w.id), ['w1', 'w7']);
});

test('點選判定：選取中的端點優先，其次是最近的牆身', () => {
  const p = samplePlan();
  assert.deepEqual(E.hitTest(p, [2, 0.05], 0.1, null), { id: 'w1', part: 'body' });
  assert.deepEqual(E.hitTest(p, [4.02, 0.02], 0.1, 'w2'), { id: 'w2', part: 'a' });
  assert.deepEqual(E.hitTest(p, [3.98, 3.03], 0.1, 'w2'), { id: 'w2', part: 'b' });
  assert.equal(E.hitTest(p, [2, 1.5], 0.1, null), null);
});

test('端點吸附會排除正在拖曳的牆', () => {
  const p = samplePlan();
  assert.deepEqual(E.snapToEndpoint(p, [3.95, 0.04], 0.1, null), [4, 0]);
  assert.deepEqual(E.snapToEndpoint(p, [3.95, 3.04], 0.1, 'w2'), [4, 3]);
  assert.equal(E.snapToEndpoint(p, [2, 2], 0.1, null), null);
});

test('接近水平或垂直時拉直，斜的就保持原樣', () => {
  assert.deepEqual(E.snapOrtho([0, 0], [5, 0.3], 8), [5, 0]);
  assert.deepEqual(E.snapOrtho([0, 0], [-5, 0.3], 8), [-5, 0]);
  assert.deepEqual(E.snapOrtho([0, 0], [0.2, -4], 8), [0, -4]);
  assert.deepEqual(E.snapOrtho([0, 0], [3, 3], 8), [3, 3]);
});

test('移動整面牆與移動端點', () => {
  const p = samplePlan();
  const w1 = p.walls[0];
  E.moveWall(p, 'w1', { a: w1.a.slice(), b: w1.b.slice() }, 0.5, 1);
  assert.deepEqual([w1.a, w1.b], [[0.5, 1], [4.5, 1]]);
  E.moveEndpoint(p, 'w1', 'b', [6, 1]);
  assert.deepEqual(w1.b, [6, 1]);
});

test('比例尺：量到 4 公尺、實際 5 公尺，整張圖放大 1.25 倍', () => {
  const p = samplePlan();
  const k = E.scaleFactor(4, 5);
  assert.equal(k, 1.25);
  E.rescale(p, k);
  assert.deepEqual(p.walls[0].b, [5, 0]);
  assert.equal(p.walls[0].thickness, 0.25);
  assert.equal(p.walls[0].height, 2.8);
  assert.equal(p.source.pxPerMeter, 16);
  assert.equal(E.scaleFactor(0, 5), null);
  assert.equal(E.scaleFactor(4, -1), null);
});

test('復原與重做', () => {
  const p = samplePlan();
  const h = new E.History();
  assert.equal(h.canUndo, false);
  h.record(p);
  E.deleteWall(p, 'w1');
  h.record(p);
  E.rescale(p, 2);
  assert.equal(p.walls.length, 2);
  assert.equal(p.source.pxPerMeter, 10);

  assert.equal(h.undo(p), true);
  assert.equal(p.source.pxPerMeter, 20);
  assert.equal(h.undo(p), true);
  assert.equal(p.walls.length, 3);
  assert.equal(h.undo(p), false);

  assert.equal(h.redo(p), true);
  assert.equal(p.walls.length, 2);
  // 新的修改會清掉可以重做的步驟
  h.record(p);
  E.deleteWall(p, 'w2');
  assert.equal(h.canRedo, false);
});

test('復原的狀態不會被之後的修改改到', () => {
  const p = samplePlan();
  const h = new E.History();
  h.record(p);
  E.moveEndpoint(p, 'w1', 'b', [9, 9]);
  h.undo(p);
  assert.deepEqual(p.walls[0].b, [4, 0]);
});
