const test = require('node:test');
const assert = require('node:assert/strict');
const LW = require('../js/linewalls.js');
const P = require('../js/plan.js');
const R = require('../js/rooms.js');

// 1 像素 = 1 公分
const ppm = 100;
const L = (x0, y0, x1, y1) => ({ x0, y0, x1, y1, curve: false });
const rect = (x0, y0, x1, y1) => [L(x0, y0, x1, y0), L(x1, y0, x1, y1), L(x1, y1, x0, y1), L(x0, y1, x0, y0)];
// 以 (cx, cy) 為圓心、半徑 r 的弧（度，y 向下），拆成曲線小段
function arc(cx, cy, r, a0, a1) {
  const out = [], n = 12;
  for (let i = 0; i < n; i++) {
    const p = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0 + (a1 - a0) * i / n), [x1, y1] = p(a0 + (a1 - a0) * (i + 1) / n);
    out.push({ x0, y0, x1, y1, curve: true });
  }
  return out;
}
// 4 × 3 公尺的房間，牆厚 15 公分，畫成外框和內框兩個矩形
const room = () => rect(0, 0, 430, 330).concat(rect(15, 15, 415, 315));

function run(lines) {
  const ex = LW.extract(lines, { ppm });
  const d = LW.findDoors(ex.segments, lines, { ppm });
  const wins = LW.findWindows(d.segments, ex.axis, { ppm });
  const plan = P.fromSegments(d.segments, { widthPx: 500, heightPx: 400, pxPerMeter: ppm, wallHeight: 2.8 }, d.doors.concat(wins));
  plan.rooms = R.assign(R.detect(plan), []);
  return { ex, plan };
}

test('兩條平行線配對成牆，牆角接起來，圍出房間', () => {
  const { ex, plan } = run(room());
  assert.equal(ex.segments.length, 4);
  for (const s of ex.segments) assert.equal(s.t, 15);
  assert.equal(plan.rooms.length, 1);
  // 房間的格子會把牆稍微加粗，面積比 4 × 3 = 12 略小
  assert.ok(Math.abs(plan.rooms[0].area - 12) < 0.5, '面積 ' + plan.rooms[0].area);
});

test('牆中間的虛線中心線不影響配對', () => {
  const dashes = [];
  for (let x = 20; x < 410; x += 16) dashes.push(L(x, 7.5, x + 10, 7.5));
  const { ex } = run(room().concat(dashes));
  assert.equal(ex.segments.length, 4);
  assert.ok(ex.segments.every(s => s.t === 15));
});

test('牆內兩條平行細線是窗', () => {
  const { plan } = run(room().concat([L(100, 6, 220, 6), L(100, 9, 220, 9)]));
  const wins = plan.openings.filter(o => o.type === 'window');
  assert.equal(wins.length, 1);
  assert.ok(Math.abs(wins[0].width - 1.2) < 0.01);
  // 只有一條內線（例如粉刷線）不算
  assert.equal(run(room().concat([L(100, 6, 220, 6)])).plan.openings.length, 0);
});

test('開門弧：門洞兩側的牆合成一面，門掛在上面', () => {
  // 下方的牆在 x 150–240 斷開，門軸在 (150, 315)，門往房間裡（y 變小）開
  const lines = rect(0, 0, 430, 330).filter((_, i) => i !== 2).concat(rect(15, 15, 415, 315).filter((_, i) => i !== 2))
    .concat([L(430, 330, 240, 330), L(150, 330, 0, 330), L(415, 315, 240, 315), L(150, 315, 15, 315)])
    .concat([L(150, 315, 150, 225)], arc(150, 315, 90, -90, 0));
  const { ex, plan } = run(lines);
  assert.equal(ex.segments.length, 5);   // 門洞還沒接起來
  assert.equal(plan.walls.length, 4);
  const doors = plan.openings.filter(o => o.type === 'door');
  assert.equal(doors.length, 1);
  const wall = plan.walls.find(w => w.id === doors[0].wall);
  assert.ok(Math.abs(wall.a[1] - 3.225) < 0.01);
  assert.ok(Math.abs(doors[0].width - 0.9) < 0.01);
  assert.equal(doors[0].hinge, 'a');
  assert.equal(plan.rooms.length, 1);
});

test('樓梯踏階（一串等距平行線）不算牆', () => {
  const steps = [];
  for (let i = 0; i < 6; i++) steps.push(L(100, 100 + 25 * i, 220, 100 + 25 * i));
  const { ex } = run(room().concat(steps));
  assert.equal(ex.segments.length, 4);
});

test('柱子接在牆端，兩側的牆延伸到柱子裡接成一面；遠處零星的線段拿掉', () => {
  // 兩段牆中間夾一根 50 × 39 公分的柱子
  const lines = [L(0, 0, 200, 0), L(0, 15, 200, 15)].concat(rect(200, -12, 250, 27))
    .concat([L(250, 0, 450, 0), L(250, 15, 450, 15)], [L(2000, 2000, 2060, 2000), L(2000, 2015, 2060, 2015)]);
  const ex = LW.extract(lines, { ppm });
  const col = ex.segments.find(s => s.column);
  assert.deepEqual([col.p0, col.p1, col.t], [200, 250, 39]);
  const walls = ex.segments.filter(s => !s.column);
  assert.equal(walls.length, 1);
  assert.deepEqual([walls[0].p0, walls[0].p1, walls[0].t], [0, 450, 15]);
});

test('窗兩側都在房間裡（隔間牆）就拿掉，外牆的窗保留', () => {
  const plan = {
    walls: [{ id: 'w1', a: [0, 0], b: [4, 0], thickness: 0.15 }, { id: 'w2', a: [2, 0], b: [2, 3], thickness: 0.15 }],
    openings: [{ id: 'o1', type: 'window', wall: 'w1', offset: 1, width: 1 }, { id: 'o2', type: 'window', wall: 'w2', offset: 1.5, width: 1 }],
    rooms: [{ polygon: [[0, 0], [2, 0], [2, 3], [0, 3]] }, { polygon: [[2, 0], [4, 0], [4, 3], [2, 3]] }]
  };
  LW.dropIndoorWindows(plan);
  assert.deepEqual(plan.openings.map(o => o.id), ['o1']);
});
