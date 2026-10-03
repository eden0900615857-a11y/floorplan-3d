const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/furniture.js');
const E = require('../js/edit.js');
const P = require('../js/plan.js');
const W = require('../js/walk.js');
const M = require('../js/materials.js');

const near = (a, b, d = 1e-6) => Math.abs(a - b) <= d;
const nearPt = (p, q, d = 1e-6) => near(p[0], q[0], d) && near(p[1], q[1], d);

// 4 × 3 公尺的房間，牆厚 0.2
function room() {
  const wall = (id, a, b) => ({ id, a, b, thickness: 0.2, height: 2.8 });
  return {
    version: 1, unit: 'm',
    walls: [wall('w1', [0, 0], [4, 0]), wall('w2', [4, 0], [4, 3]), wall('w3', [4, 3], [0, 3]), wall('w4', [0, 3], [0, 0])],
    openings: [], rooms: [], furniture: [], materials: { wall: 'paint-white' }
  };
}

test('家具庫：每件都有名稱、分類、尺寸，方塊比例在 0–1 附近', () => {
  const ids = new Set();
  for (const it of F.CATALOG) {
    assert.ok(!ids.has(it.id), '重複的 id ' + it.id);
    ids.add(it.id);
    assert.ok(it.name && F.CATS.includes(it.cat), it.id);
    assert.ok(it.w > 0 && it.d > 0 && it.h > 0, it.id);
    for (const p of it.parts) {
      assert.equal(p.length, 7, it.id);
      assert.ok(p[0] < p[1] && p[2] < p[3] && p[4] < p[5], it.id + ' 方塊範圍');
      assert.ok(p.slice(0, 6).every(v => v >= -0.01 && v <= 1.06), it.id);
      assert.ok(F.COLORS[p[6]], it.id + ' 顏色 ' + p[6]);
    }
  }
});

test('新增家具：預設尺寸、編號遞增；旋轉後的四個角', () => {
  const plan = room();
  const a = E.addFurniture(plan, 'sofa3', [2, 1.5], 0);
  const b = E.addFurniture(plan, 'coffee', [2, 2], 0);
  assert.deepEqual([a.id, b.id], ['f1', 'f2']);
  assert.deepEqual([a.w, a.d], [2.1, 0.9]);
  assert.equal(E.addFurniture(plan, 'nope', [0, 0]), null);
  // 0 度：寬沿 x，正面朝 +y
  const fp = F.footprint(a);
  assert.ok(nearPt(fp[0], [0.95, 1.05]) && nearPt(fp[2], [3.05, 1.95]));
  // 轉 90 度（順時針）：寬沿 y，正面朝 -x
  E.rotateFurniture(plan, 'f1', 90);
  const r = F.footprint(a);
  assert.ok(nearPt(r[0], [2.45, 0.45]), JSON.stringify(r[0]));
  assert.ok(nearPt(r[3], [1.55, 0.45]), JSON.stringify(r[3]));
  E.rotateFurniture(plan, 'f1', -180);
  assert.equal(a.rotation, 270);
});

test('點選家具：點在範圍內才算，後放的在上面', () => {
  const plan = room();
  E.addFurniture(plan, 'dining', [2, 1.5], 0);
  E.addFurniture(plan, 'chair', [2, 1.5], 0);
  assert.equal(F.hit(plan, [2, 1.5]).id, 'f2');
  assert.equal(F.hit(plan, [2.6, 1.5]).id, 'f1');
  assert.equal(F.hit(plan, [3.5, 1.5]), null);
  E.rotateFurniture(plan, 'f1', 90);
  assert.equal(F.hit(plan, [2.6, 1.5]), null);
  assert.equal(F.hit(plan, [2, 2.1]).id, 'f1');
});

test('3D 方塊：位置跟著旋轉，高度照比例', () => {
  const f = { id: 'f1', model: 'wardrobe', pos: [1, 1], rotation: 90, w: 1.2, d: 0.6 };
  const [body] = F.parts(f);
  assert.ok(near(body.x, 1) && near(body.y, 1) && near(body.w, 1.2) && near(body.d, 0.6));
  assert.ok(near(body.z0, 0) && near(body.z1, 2.1));
  // 衣櫃門把在正面（0 度時 +y；轉 90 度後朝 -x）
  const handle = F.parts(f)[2];
  assert.ok(handle.x < 1 - 0.29, 'handle x ' + handle.x);
  assert.deepEqual(F.parts({ model: 'nope', pos: [0, 0], w: 1, d: 1 }), []);
});

test('移動、改尺寸、刪除、比例尺縮放只動位置；復原會還原家具與牆面顏色', () => {
  const plan = room();
  const h = new E.History();
  h.record(plan);
  E.addFurniture(plan, 'bed-double', [2, 1.5], 0);
  h.record(plan);
  E.moveFurniture(plan, 'f1', [2.5, 1.2]);
  E.setFurnitureSize(plan, 'f1', 1.82, 2.1);
  plan.materials.wall = 'paint-sage';
  assert.deepEqual(E.findFurniture(plan, 'f1').pos, [2.5, 1.2]);
  E.rescale(plan, 2);
  const f = E.findFurniture(plan, 'f1');
  assert.deepEqual([f.pos, f.w, f.d], [[5, 2.4], 1.82, 2.1]);
  h.undo(plan);
  assert.deepEqual(plan.furniture[0].pos, [2, 1.5]);
  assert.equal(plan.materials.wall, 'paint-white');
  h.undo(plan);
  assert.equal(plan.furniture.length, 0);
  h.redo(plan); h.redo(plan);
  assert.equal(plan.materials.wall, 'paint-sage');
  assert.ok(E.deleteFurniture(plan, 'f1'));
  assert.equal(plan.furniture.length, 0);
});

test('格式檢查：家具要有種類、位置與尺寸', () => {
  const plan = room();
  E.addFurniture(plan, 'sofa3', [2, 1.5], 0);
  assert.deepEqual(P.validate(plan), []);
  plan.furniture.push({ id: 'f9', pos: [1], w: 0, d: 1 });
  const errs = P.validate(plan);
  assert.equal(errs.length, 3, errs.join('；'));
});

test('漫遊時家具會擋路，淋浴間不擋', () => {
  const plan = room();
  E.addFurniture(plan, 'bed-single', [2, 1.5], 0);   // 0.95 × 2.0，擋住 x 1.525–2.475
  E.addFurniture(plan, 'shower', [0.6, 0.6], 0);
  assert.equal(W.solids(plan).length, 5);
  const st = { x: 0.8, y: 1.5, yaw: 0, pitch: 0 };
  for (let i = 0; i < 60; i++) W.step(st, { forward: true }, 0.05, W.solids(plan));
  assert.ok(near(st.x, 1.525 - W.RADIUS, 0.01), 'x ' + st.x);
});

test('牆面顏色：找不到的 id 用白色', () => {
  assert.equal(M.wall('paint-blue').name, '霧藍');
  assert.equal(M.wall('nope').id, M.DEFAULT_WALL);
  assert.equal(M.wall(undefined).id, 'paint-white');
});

test('家具模型：家具庫用到的模型都在，幾何正規化成 1 × 1 × 1、正面朝 +z', () => {
  const Mo = require('../js/models.js');
  assert.match(Mo.source, /CC0/);
  assert.match(Mo.texture, /^data:image\/png;base64,/);
  for (const it of F.CATALOG.filter(c => c.mesh)) {
    assert.ok(Mo.has(it.mesh), it.id + ' 缺模型 ' + it.mesh);
    const g = Mo.decode(it.mesh);
    assert.equal(g.position.length, g.normal.length, it.id);
    assert.equal(g.position.length / 3, g.uv.length / 2, it.id);
    assert.ok(g.index.every(i => i < g.position.length / 3), it.id + ' 索引超出範圍');
    const lo = [1, 1, 1], hi = [-1, -1, -1];
    g.position.forEach((v, i) => { lo[i % 3] = Math.min(lo[i % 3], v); hi[i % 3] = Math.max(hi[i % 3], v); });
    assert.ok(near(lo[0], -0.5, 1e-3) && near(hi[0], 0.5, 1e-3) && near(lo[1], 0, 1e-3) && near(hi[1], 1, 1e-3), it.id);
  }
  assert.equal(Mo.decode('nope'), null);
  // 沙發、床的椅背、床頭在背面（-z）
  for (const name of ['couch_pillows', 'bed_double_A', 'chair_A_wood']) {
    const p = Mo.decode(name).position;
    let s = 0, c = 0;
    for (let i = 0; i < p.length; i += 3) if (p[i + 1] > 0.8) { s += p[i + 2]; c++; }
    assert.ok(s / c < -0.15, name + ' 高處的平均 z ' + (s / c));
  }
});

test('地毯不擋路、落地燈會擋', () => {
  const plan = room();
  E.addFurniture(plan, 'rug', [2, 1.5], 0);
  E.addFurniture(plan, 'lamp-floor', [1, 1], 0);
  assert.equal(W.solids(plan).length, 5);
});
