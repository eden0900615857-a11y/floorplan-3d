const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/building.js');

const wall = (id, a, b, h) => ({ id, a, b, thickness: 0.2, height: h || 2.8 });
const box = (x0, y0, x1, y1, h) => ({
  version: 1, unit: 'm', openings: [], rooms: [], furniture: [],
  walls: [wall('w1', [x0, y0], [x1, y0], h), wall('w2', [x1, y0], [x1, y1], h), wall('w3', [x1, y1], [x0, y1], h), wall('w4', [x0, y1], [x0, y0], h)]
});

test('wrap、toJSON：一層的平面圖包成一棟，只有一層時存回原本的平面圖', () => {
  const p = box(0, 0, 9, 9);
  const b = B.wrap(p);
  assert.equal(b.floors.length, 1);
  assert.equal(b.floors[0].name, '1 樓');
  assert.equal(B.toJSON(b), p);
  assert.deepEqual(B.validate(p), []);
});

test('addFloor：新的一層放在最上面，牆的外框左上角對齊下面那一層', () => {
  const b = B.wrap(box(2, 3, 11, 12));
  const f = B.addFloor(b, box(5, 1, 14, 9));
  assert.deepEqual([f.id, f.name, b.active], ['f2', '2 樓', 1]);
  assert.deepEqual(f.offset, [-3, 2]);
  const json = B.toJSON(b);
  assert.equal(json.type, 'building');
  assert.deepEqual(B.validate(json), []);
  assert.equal(B.wrap(JSON.parse(JSON.stringify(json))).floors.length, 2);
});

test('below：目前樓層下面的樓層，高度往下累加（牆高加樓板）', () => {
  const b = B.wrap(box(0, 0, 9, 9, 3));
  B.addFloor(b, box(0, 0, 9, 9, 2.8));
  B.addFloor(b, box(1, 1, 4, 4, 2.5));
  const list = B.below(b);
  assert.deepEqual(list.map(f => f.name), ['2 樓', '1 樓']);
  assert.deepEqual(list.map(f => f.y), [-2.95, -6.1]);
  assert.deepEqual([list[0].dx, list[0].dy], [1, 1], '2 樓的 (0,0) 對到 3 樓座標的 (1,1)');
  assert.deepEqual(B.below(b, 0), []);
});

test('removeFloor、rename：至少留一層；刪掉目前樓層下面的樓層時，目前樓層跟著移', () => {
  const b = B.wrap(box(0, 0, 9, 9));
  B.addFloor(b, box(0, 0, 9, 9));
  B.addFloor(b, box(0, 0, 9, 9));
  assert.equal(B.removeFloor(b, 0), true);
  assert.equal(b.active, 1);
  assert.equal(B.rename(b, 1, '頂樓'), '頂樓');
  B.removeFloor(b, 1);
  assert.equal(B.removeFloor(b, 0), false);
  assert.equal(b.floors.length, 1);
});

test('看整棟：上面的樓層往上疊，目前樓層只畫樓板', () => {
  const b = B.wrap(box(0, 0, 4, 4, 3));
  B.addFloor(b, box(0, 0, 4, 4, 2.8));
  B.addFloor(b, box(0, 0, 4, 4, 2.5));
  b.active = 1;
  assert.deepEqual(B.context(b).map(f => f.y), [-3.15]);
  const all = B.context(b, 1, true);
  assert.deepEqual(all.map(f => [f.name, f.y, !!f.slabOnly]), [['1 樓', -3.15, false], ['2 樓', 0, true], ['3 樓', 2.95, false]]);
});

test('樓梯洞：下面那一層的樓梯範圍換成這一層的座標', () => {
  const low = box(0, 0, 6, 6);
  low.furniture = [{ id: 'f1', model: 'stairs', pos: [2, 3], rotation: 0, w: 1, d: 3 }, { id: 'f2', model: 'sofa3', pos: [4, 4], rotation: 0, w: 2, d: 1 }];
  const b = B.wrap(low);
  B.addFloor(b, box(1, 1, 7, 7));
  assert.deepEqual(B.stairHoles(b, 0), []);
  assert.deepEqual(B.stairHoles(b), [[[2.5, 2.5], [3.5, 2.5], [3.5, 5.5], [2.5, 5.5]]]);
  assert.deepEqual(B.context(b, 1)[0].holes, []);
});
