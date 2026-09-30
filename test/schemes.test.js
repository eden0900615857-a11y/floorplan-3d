const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/schemes.js');
const E = require('../js/edit.js');
const P = require('../js/plan.js');
const Q = require('../js/quantities.js');

// 兩間房：左邊 4 × 3、右邊 3 × 3，中間隔間牆上有一扇門，左邊外牆有一扇窗
function house() {
  const wall = (id, a, b) => ({ id, a, b, thickness: 0.2, height: 2.8 });
  return {
    version: 1, unit: 'm',
    walls: [
      wall('w1', [0, 0], [7, 0]), wall('w2', [7, 0], [7, 3]), wall('w3', [7, 3], [0, 3]), wall('w4', [0, 3], [0, 0]),
      wall('w5', [4, 0], [4, 3])
    ],
    openings: [P.makeOpening('o1', 'door', 'w5', 1.5, 0.9), P.makeOpening('o2', 'window', 'w4', 1.5, 1.2)],
    rooms: [
      { id: 'r1', name: '客廳', polygon: [[0.1, 0.1], [3.9, 0.1], [3.9, 2.9], [0.1, 2.9]], area: 10.64, label: [2, 1.5] },
      { id: 'r2', name: '臥室', polygon: [[4.1, 0.1], [6.9, 0.1], [6.9, 2.9], [4.1, 2.9]], area: 7.84, label: [5.5, 1.5], floor: 'oak-dark' }
    ],
    furniture: [], materials: { wall: 'paint-white' }
  };
}

test('舊的平面圖沒有方案：目前內容變成「方案 1」', () => {
  const plan = house();
  E.addFurniture(plan, 'sofa3', [2, 2], 180);
  S.ensure(plan);
  assert.equal(plan.schemes.length, 1);
  assert.equal(plan.activeScheme, 's1');
  assert.equal(plan.schemes[0].name, '方案 1');
  assert.equal(plan.schemes[0].furniture.length, 1);
  assert.deepEqual(plan.schemes[0].floors, { r2: 'oak-dark' });
});

test('複製方案、各自修改、切換時換回各自的家具、地板與牆色', () => {
  const plan = S.ensure(house());
  E.addFurniture(plan, 'sofa3', [2, 2], 180);
  const s2 = S.add(plan, false);
  assert.deepEqual([s2.id, s2.name, plan.activeScheme], ['s2', '方案 2', 's2']);
  assert.equal(plan.furniture.length, 1, '複製的方案帶著原本的家具');
  // 方案 2：換地板、牆色、多一張茶几
  plan.rooms[0].floor = 'marble';
  plan.materials.wall = 'paint-sage';
  E.addFurniture(plan, 'coffee', [2, 1.2], 0);
  S.switchTo(plan, 's1');
  assert.equal(plan.furniture.length, 1);
  assert.equal(plan.rooms[0].floor, undefined);
  assert.equal(plan.rooms[1].floor, 'oak-dark');
  assert.equal(plan.materials.wall, 'paint-white');
  S.switchTo(plan, 's2');
  assert.equal(plan.furniture.length, 2);
  assert.equal(plan.rooms[0].floor, 'marble');
  assert.equal(plan.materials.wall, 'paint-sage');
  // 家具是各自的副本，改一個不會影響另一個
  plan.furniture[0].pos = [9, 9];
  assert.deepEqual(S.find(plan, 's1').furniture[0].pos, [2, 2]);
});

test('空白方案、改名、刪除（至少留一個）', () => {
  const plan = S.ensure(house());
  E.addFurniture(plan, 'bed-double', [5.5, 1.5], 0);
  const blank = S.add(plan, true);
  assert.equal(plan.furniture.length, 0);
  assert.equal(plan.rooms[1].floor, undefined);
  assert.equal(S.rename(plan, blank.id, '  北歐風  ').name, '北歐風');
  assert.equal(S.rename(plan, blank.id, '   '), null);
  assert.ok(S.remove(plan, blank.id));
  assert.equal(plan.activeScheme, 's1');
  assert.equal(plan.furniture.length, 1, '刪掉目前方案後切回剩下的方案');
  assert.equal(S.remove(plan, 's1'), false);
  assert.equal(S.remove(plan, 'nope'), false);
  // 新方案編號不會和既有的重複
  S.add(plan, true); S.add(plan, true);
  assert.deepEqual(plan.schemes.map(s => s.id), ['s1', 's2', 's3']);
});

test('復原會還原方案的切換', () => {
  const plan = S.ensure(house());
  const h = new E.History();
  h.record(plan);
  S.add(plan, true);
  assert.equal(plan.schemes.length, 2);
  h.undo(plan);
  assert.equal(plan.schemes.length, 1);
  assert.equal(plan.activeScheme, 's1');
  h.redo(plan);
  assert.equal(plan.activeScheme, 's2');
});

test('材料用量：地板依材質加總、油漆扣門窗、家具清單', () => {
  const plan = house();
  E.addFurniture(plan, 'chair', [1, 1], 0);
  E.addFurniture(plan, 'chair', [1.6, 1], 0);
  E.addFurniture(plan, 'dining', [1.3, 1.8], 0);
  const q = Q.estimate(plan);
  assert.deepEqual(q.floors.map(f => [f.id, f.area, f.order]), [['oak-light', 10.64, 11.7], ['oak-dark', 7.84, 8.62]]);
  assert.equal(q.floorTotal, 18.48);
  // 周長 (3.8+2.8)×2 + (2.8+2.8)×2 = 24.4，× 2.8 = 68.32
  // 室內門兩面都扣 0.9×2.1×2 = 3.78，外牆窗只扣一面 1.2×1.2 = 1.44
  assert.equal(Q.roomSides(plan, plan.openings[0]), 2);
  assert.equal(Q.roomSides(plan, plan.openings[1]), 1);
  assert.ok(Math.abs(q.wall.area - (68.32 - 3.78 - 1.44)) < 0.01, 'wall ' + q.wall.area);
  assert.equal(q.wall.liters, Math.ceil(q.wall.area * 2 / 10));
  assert.deepEqual(q.furniture, [{ name: '椅子', count: 2 }, { name: '餐桌', count: 1 }]);
});
