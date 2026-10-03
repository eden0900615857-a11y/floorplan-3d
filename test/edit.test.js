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

test('在牆上加門窗：位置限制在牆內，寬度不超過牆長', () => {
  const p = samplePlan();
  const d = E.addOpening(p, 'w1', 'door', 0.1, 0.9);
  assert.deepEqual([d.id, d.type, d.wall, d.offset, d.width, d.height, d.hinge, d.swing], ['o1', 'door', 'w1', 0.45, 0.9, 2.1, 'a', 'left']);
  const win = E.addOpening(p, 'w1', 'window', 3.9, 1.2);
  assert.deepEqual([win.id, win.offset, win.sill], ['o2', 3.4, 0.9]);
  const big = E.addOpening(p, 'w2', 'window', 1.5, 9);
  assert.deepEqual([big.width, big.offset], [2.9, 1.5]);
  assert.equal(E.addOpening(p, 'nope', 'door', 1, 1), null);
});

test('移動門窗、改寬度、切換開門方向', () => {
  const p = samplePlan();
  const d = E.addOpening(p, 'w1', 'door', 2, 0.9);
  E.moveOpening(p, d.id, 10);
  assert.equal(d.offset, 3.55);
  E.setOpeningWidth(p, d.id, 1.5);
  assert.deepEqual([d.width, d.offset], [1.5, 3.25]);
  const states = [];
  for (let i = 0; i < 4; i++) { E.flipDoor(p, d.id); states.push(d.hinge + d.swing); }
  assert.deepEqual(states, ['aright', 'bleft', 'bright', 'aleft']);
});

test('刪除牆會一起刪除牆上的門窗，復原會一起回來', () => {
  const p = samplePlan();
  const h = new E.History();
  E.addOpening(p, 'w1', 'door', 2, 0.9);
  E.addOpening(p, 'w2', 'window', 1.5, 1);
  h.record(p);
  E.deleteWall(p, 'w1');
  assert.deepEqual(p.openings.map(o => o.wall), ['w2']);
  h.undo(p);
  assert.deepEqual(p.openings.map(o => o.wall), ['w1', 'w2']);
});

test('點選門窗與點在牆上的位置', () => {
  const p = samplePlan();
  const d = E.addOpening(p, 'w1', 'door', 2, 0.9);
  assert.equal(E.hitOpening(p, [2.3, 0.05], 0.1), d);
  assert.equal(E.hitOpening(p, [3, 0.05], 0.1), null);
  assert.equal(E.projectOnWall(p.walls[1], [4.1, 1.2]), 1.2);
});

test('比例尺縮放也會縮放門窗', () => {
  const p = samplePlan();
  const d = E.addOpening(p, 'w1', 'door', 2, 0.8);
  E.rescale(p, 1.5);
  assert.deepEqual([d.offset, d.width, d.height], [3, 1.2, 2.1]);
});

test('setWindowSize、setWallKind：窗台與窗高不超過牆高；牆可以改成欄杆再改回來', () => {
  const E2 = require('../js/edit.js'), P2 = require('../js/plan.js');
  const plan = { version: 1, unit: 'm', walls: [{ id: 'w1', a: [0, 0], b: [4, 0], thickness: 0.15, height: 2.8 }], openings: [P2.makeOpening('o1', 'window', 'w1', 2, 1.2)], rooms: [] };
  E2.setWindowSize(plan, 'o1', 0, 2.1);
  assert.deepStrictEqual([plan.openings[0].sill, plan.openings[0].height], [0, 2.1]);
  E2.setWindowSize(plan, 'o1', 2, 2);
  assert.deepStrictEqual([plan.openings[0].sill, plan.openings[0].height], [2, 0.8]);
  E2.setWindowSize(plan, 'o1', 5, 1);
  assert.equal(plan.openings[0].sill, 2.7);
  E2.setWallKind(plan, 'w1', 'glass');
  assert.equal(plan.walls[0].kind, 'glass');
  E2.setWallKind(plan, 'w1', '');
  assert.equal('kind' in plan.walls[0], false);
});

test('外牆材質：個別牆面指定與清除', () => {
  const plan = { walls: [{ id: 'w1', a: [0, 0], b: [4, 0], thickness: 0.2, height: 2.8 }], openings: [] };
  assert.equal(E.setWallExt(plan, 'w1', 'ext-stone').ext, 'ext-stone');
  assert.equal(E.setWallExt(plan, 'w1', '').ext, undefined);
  assert.equal(E.setWallExt(plan, 'nope', 'ext-stone'), null);
});
