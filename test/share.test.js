const test = require('node:test');
const assert = require('node:assert/strict');
const Sh = require('../js/share.js');
const S = require('../js/schemes.js');
const E = require('../js/edit.js');
const P = require('../js/plan.js');

function house() {
  const wall = (id, a, b) => ({ id, a, b, thickness: 0.2, height: 2.8 });
  return {
    version: 1, unit: 'm',
    source: { widthPx: 700, heightPx: 490, pxPerMeter: 50.123456, image: 'data:image/png;base64,' + 'A'.repeat(5000) },
    walls: [wall('w1', [0, 0], [7, 0]), wall('w2', [7, 0], [7, 3]), wall('w3', [7, 3], [0, 3]), wall('w4', [0, 3], [0, 0])],
    openings: [P.makeOpening('o1', 'door', 'w1', 1.5, 0.9)],
    rooms: [{ id: 'r1', name: '客廳', polygon: [[0.1, 0.1], [6.9, 0.1], [6.9, 2.9], [0.1, 2.9]], area: 19.04, label: [3.5, 1.5] }],
    furniture: [], materials: { wall: 'paint-sage' }
  };
}

test('分享連結來回：牆、門窗、房間、所有方案都在，原圖不在', async () => {
  const plan = S.ensure(house());
  E.addFurniture(plan, 'sofa3', [2.123456, 2], 180);
  S.add(plan, true);
  plan.rooms[0].floor = 'marble';
  S.sync(plan);
  const data = await Sh.encode(plan);
  assert.match(data, /^z[A-Za-z0-9_-]+$/);
  const back = await Sh.decode(data);
  assert.equal(back.source.image, undefined);
  assert.equal(back.source.widthPx, 700);
  assert.equal(back.source.pxPerMeter, 50.123);
  assert.deepEqual(back.walls, plan.walls);
  assert.deepEqual(back.openings, plan.openings);
  assert.equal(back.schemes.length, 2);
  assert.equal(back.activeScheme, 's2');
  assert.deepEqual(S.find(back, 's1').furniture[0].pos, [2.123, 2]);
  assert.equal(back.rooms[0].floor, 'marble');
  assert.ok(data.length < 1000, '長度 ' + data.length);
});

test('網址解析與壞掉的連結', async () => {
  assert.equal(Sh.fromHash('#v=zAbC_-9'), 'zAbC_-9');
  assert.equal(Sh.fromHash('#other'), null);
  assert.equal(Sh.fromHash(''), null);
  assert.equal(Sh.link('https://x.io/a/index.html#v=old', 'zQQ'), 'https://x.io/a/index.html#v=zQQ');
  const data = await Sh.encode(house());
  await assert.rejects(Sh.decode(data.slice(0, data.length / 2)), /不完整/);
  await assert.rejects(Sh.decode('xABC'), /不完整/);
  const bad = house(); bad.walls[0].thickness = 0;
  const raw = 'j' + Buffer.from(JSON.stringify(bad)).toString('base64url');
  await assert.rejects(Sh.decode(raw), /有問題/);
});
