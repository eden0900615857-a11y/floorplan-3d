const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rooms.js');

const wall = (id, a, b, t = 0.2) => ({ id, a, b, thickness: t, height: 2.8 });
// 6 × 4 公尺的外框（牆中心線），中間 x=3 一道隔間牆，分成兩個房間
function twoRooms(withPartition = true) {
  const walls = [
    wall('w1', [0, 0], [6, 0]), wall('w2', [6, 0], [6, 4]),
    wall('w3', [6, 4], [0, 4]), wall('w4', [0, 4], [0, 0])
  ];
  if (withPartition) walls.push(wall('w5', [3, 0], [3, 4]));
  return { version: 1, unit: 'm', walls, openings: [], rooms: [] };
}

test('1 坪約 3.3058 平方公尺', () => {
  assert.equal(R.toPing(R.PING).toFixed(4), '1.0000');
  assert.equal(R.toPing(33.058).toFixed(2), '10.00');
});

test('外框加一道隔間牆：找到兩個房間，面積接近牆內淨面積', () => {
  const rooms = R.detect(twoRooms(), { cell: 0.05 });
  assert.equal(rooms.length, 2);
  // 每間淨尺寸約 2.8 × 3.8 = 10.64；牆邊多畫了半格，容許一點誤差
  for (const r of rooms) assert.ok(Math.abs(r.area - 10.64) < 0.8, 'area ' + r.area);
  // 外框是四個角的長方形
  for (const r of rooms) assert.equal(r.polygon.length, 4);
  const xs = rooms.map(r => r.label[0]).sort((a, b) => a - b);
  assert.ok(xs[0] > 0 && xs[0] < 3 && xs[1] > 3 && xs[1] < 6);
});

test('沒有隔間牆就是一個房間；沒有封閉就沒有房間', () => {
  assert.equal(R.detect(twoRooms(false), { cell: 0.05 }).length, 1);
  const open = twoRooms(false);
  open.walls.pop();  // 拿掉左邊的牆
  assert.equal(R.detect(open, { cell: 0.05 }).length, 0);
});

test('門窗不影響房間分隔（門關起來也是隔開的）', () => {
  const p = twoRooms();
  p.openings = [{ id: 'o1', type: 'door', wall: 'w5', offset: 2, width: 0.9, height: 2.1, hinge: 'a', swing: 'left' }];
  assert.equal(R.detect(p, { cell: 0.05 }).length, 2);
});

test('太小的空間不算房間', () => {
  const p = { walls: [
    wall('w1', [0, 0], [0.8, 0]), wall('w2', [0.8, 0], [0.8, 0.8]),
    wall('w3', [0.8, 0.8], [0, 0.8]), wall('w4', [0, 0.8], [0, 0])
  ] };
  assert.equal(R.detect(p, { cell: 0.05, minArea: 1 }).length, 0);
});

test('重新辨識後保留房名；新房間自動編號', () => {
  const first = R.assign(R.detect(twoRooms(), { cell: 0.05 }), []);
  assert.deepEqual(first.map(r => r.name).sort(), ['房間 1', '房間 2']);
  const left = first.find(r => r.label[0] < 3);
  left.name = '主臥室';
  // 拿掉隔間牆：合併成一間，沿用面積較大那間的名稱
  first.find(r => r.label[0] > 3).area += 1;
  const merged = R.assign(R.detect(twoRooms(false), { cell: 0.05 }), first);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, '房間 2');
  // 再加回隔間牆：兩邊各自拿回原本的名稱
  const again = R.assign(R.detect(twoRooms(), { cell: 0.05 }), first);
  assert.equal(again.find(r => r.label[0] < 3).name, '主臥室');
  assert.equal(again.find(r => r.label[0] > 3).name, '房間 2');
});

test('點選房間', () => {
  const p = twoRooms();
  p.rooms = R.assign(R.detect(p, { cell: 0.05 }), []);
  assert.equal(R.hitRoom(p, [1.5, 2]).label[0] < 3, true);
  assert.equal(R.hitRoom(p, [4.5, 2]).label[0] > 3, true);
  assert.equal(R.hitRoom(p, [10, 10]), null);
});

test('outdoorRooms、offset：有欄杆的房間是戶外空間；多邊形往外擴', () => {
  const R = require('../js/rooms.js');
  const w = (id, a, b, kind) => Object.assign({ id, a, b, thickness: 0.2, height: 2.8 }, kind ? { kind } : {});
  const plan = {
    walls: [w('w1', [0, 0], [4, 0]), w('w2', [4, 0], [4, 5]), w('w3', [4, 5], [0, 5], 'glass'), w('w4', [0, 5], [0, 0]), w('w5', [0, 3], [4, 3])],
    rooms: [
      { id: 'r1', name: '臥室', polygon: [[0.1, 0.1], [3.9, 0.1], [3.9, 2.9], [0.1, 2.9]], label: [2, 1.5] },
      { id: 'r2', name: '陽台', polygon: [[0.1, 3.1], [3.9, 3.1], [3.9, 4.9], [0.1, 4.9]], label: [2, 4] }
    ]
  };
  assert.deepEqual([...R.outdoorRooms(plan)], ['r2']);
  assert.deepEqual(R.offset([[0, 0], [4, 0], [4, 3], [0, 3]], 0.1), [[-0.1, -0.1], [4.1, -0.1], [4.1, 3.1], [-0.1, 3.1]]);
  assert.deepEqual(R.offset([[0, 0], [0, 3], [4, 3], [4, 0]], 0.1), [[-0.1, -0.1], [-0.1, 3.1], [4.1, 3.1], [4.1, -0.1]]);
});
