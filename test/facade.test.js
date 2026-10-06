const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/facade.js');

test('投影變換：四個角對得上，中間的點跟著透視', () => {
  const from = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const to = [[10, 20], [90, 10], [95, 70], [5, 60]];
  const H = F.homography(from, to);
  from.forEach((p, i) => {
    const q = F.apply(H, p);
    assert.ok(Math.abs(q[0] - to[i][0]) < 1e-6 && Math.abs(q[1] - to[i][1]) < 1e-6);
  });
  assert.equal(F.homography(from, [[0, 0], [1, 1], [2, 2], [3, 3]]), null);
});

test('拉正：來源的四邊形變成長方形', () => {
  // 4×4 的來源：左半黑、右半白
  const w = 4, h = 4, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < 2 ? 0 : 255; data.set([v, v, v, 255], (y * w + x) * 4); }
  const out = F.warp({ data, width: w, height: h }, [[0, 0], [4, 0], [4, 4], [0, 4]], 8, 2);
  assert.equal(out.length, 8 * 2 * 4);
  assert.ok(out[0] < 30 && out[(8 - 1) * 4] > 225);
});

test('牆面朝向與立面範圍', () => {
  assert.equal(F.sideOf(0, 1), 'front');
  assert.equal(F.sideOf(-1, 0), 'left');
  assert.equal(F.sideOf(0.7071, 0.7071), null);
  const plan = { walls: [{ id: 'w', a: [1, 2], b: [9, 2], thickness: 0.2, height: 3 }, { id: 'v', a: [9, 2], b: [9, 7], thickness: 0.2, height: 2.8 }] };
  const f = F.extent(plan, 'front');
  assert.equal(f.axis, 'x'); assert.equal(f.h, 3); assert.equal(f.flip, false);
  assert.ok(Math.abs(f.u0 - 0.9) < 1e-9 && Math.abs(f.u1 - 9.1) < 1e-9);
  const r = F.extent(plan, 'right');
  assert.equal(r.axis, 'y'); assert.equal(r.flip, true);
  assert.ok(Math.abs(r.u0 - 1.9) < 1e-9 && Math.abs(r.u1 - 7.1) < 1e-9);
  assert.equal(F.extent({ walls: [] }, 'front'), null);
});

test('share links drop facade images', () => {
  const S = require('../js/share.js');
  const p = S.strip({ walls: [], facades: [{ id: 'a', side: 'front', image: 'data:image/jpeg;base64,xx' }] });
  assert.equal(p.facades, undefined);
});
