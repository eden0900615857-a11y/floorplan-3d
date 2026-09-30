const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../js/walk.js');
const P = require('../js/plan.js');
const M = require('../js/materials.js');
const R = require('../js/rooms.js');

// 4 × 3 公尺的房間，牆厚 0.2；下方的牆有一扇門（1.5–2.4 公尺），上方的牆有一扇窗
function room() {
  const wall = (id, a, b) => ({ id, a, b, thickness: 0.2, height: 2.8 });
  return {
    walls: [wall('w1', [0, 0], [4, 0]), wall('w2', [4, 0], [4, 3]), wall('w3', [4, 3], [0, 3]), wall('w4', [0, 3], [0, 0])],
    openings: [P.makeOpening('o1', 'door', 'w3', 2.05, 0.9), P.makeOpening('o2', 'window', 'w1', 2, 1.2)],
    rooms: [{ id: 'r1', name: '客廳', polygon: [[0.1, 0.1], [3.9, 0.1], [3.9, 2.9], [0.1, 2.9]], area: 10.6, label: [2, 1.5] }]
  };
}
const near = (a, b, d = 1e-6) => Math.abs(a - b) <= d;

test('門洞上方的牆不擋路，窗台下的牆會擋', () => {
  const s = W.solids(room());
  // w3 被門切成兩段（門上方那段不算）；w1 窗台下、窗兩側共 3 段都擋
  assert.equal(s.length, 4 + 1 + 2);
});

test('碰到牆會被推開，保持半徑距離', () => {
  const s = W.solids(room());
  const p = W.collide([3.95, 1.5], s);
  assert.ok(near(p[0], 4 - 0.1 - W.RADIUS, 1e-6), 'x ' + p[0]);
  assert.ok(near(p[1], 1.5));
  // 站在房間中間不動
  assert.deepEqual(W.collide([2, 1.5], s), [2, 1.5]);
});

test('往前走：撞牆會停在牆前；從門口可以走出去', () => {
  const plan = room(), s = W.solids(plan);
  // 往右（yaw 0）一直走，停在右牆前
  const st = { x: 2, y: 1.5, yaw: 0, pitch: 0 };
  for (let i = 0; i < 100; i++) W.step(st, { forward: true }, 0.05, s);
  assert.ok(near(st.x, 3.9 - W.RADIUS, 1e-3), 'x ' + st.x);
  // 往下（yaw 90°）從門口 x = 2 出去
  const out = { x: 2, y: 1.5, yaw: Math.PI / 2, pitch: 0 };
  for (let i = 0; i < 60; i++) W.step(out, { forward: true }, 0.05, s);
  assert.ok(out.y > 3.5, 'y ' + out.y);
  // 往上撞窗台下的牆，走不出去
  const up = { x: 2, y: 1.5, yaw: -Math.PI / 2, pitch: 0 };
  for (let i = 0; i < 60; i++) W.step(up, { forward: true }, 0.05, s);
  assert.ok(near(up.y, 0.1 + W.RADIUS, 1e-3), 'y ' + up.y);
});

test('側移與轉向', () => {
  const st = { x: 2, y: 1.5, yaw: 0, pitch: 0 };
  W.step(st, { right: true }, 0.5, []);
  assert.ok(near(st.x, 2) && near(st.y, 1.5 + W.SPEED * 0.5), '右手邊是 +y');
  W.step(st, { turnLeft: true }, 0.5, []);
  assert.ok(st.yaw < 0);
});

test('起點在最大房間的房名位置，面向房間裡最深的方向（不看向門外）', () => {
  const st = W.start(room());
  assert.deepEqual([st.x, st.y, st.pitch], [2, 1.5, 0]);
  // 3.8 × 2.8 的房間從中心看，斜 22.5° 最深；往下雖然有門，但不選門口
  assert.ok(near(st.yaw, Math.PI / 8), 'yaw ' + st.yaw);
  assert.ok(near(W.clearance([2, 1.5], 0, W.solids(room()), 15), 1.7, 0.11));
  assert.ok(W.clearance([2, 1.5], Math.PI / 2, W.solids(room()), 15) > 10);
});

test('地板材質：找不到的 id 用預設值；重新找房間時保留材質', () => {
  assert.equal(M.floor('nope').id, M.DEFAULT_FLOOR);
  assert.equal(M.floor('marble').name, '白色大理石');
  assert.equal(new Set(M.FLOORS.map(f => f.id)).size, M.FLOORS.length);
  const plan = room();
  plan.rooms[0].floor = 'tile-grey';
  const again = R.assign(R.detect(plan), plan.rooms);
  assert.equal(again[0].floor, 'tile-grey');
});
