const test = require('node:test');
const assert = require('node:assert/strict');
const { detect } = require('../js/openings.js');
const plan = require('../js/plan.js');

const W = 400, H = 300;
const blank = () => new Uint8Array(W * H);
function dot(m, x, y) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1; }
function hline(m, x0, x1, y) { for (let x = x0; x <= x1; x++) dot(m, x, y); }
function vline(m, x, y0, y1) { for (let y = y0; y <= y1; y++) dot(m, x, y); }
// 以 (cx, cy) 為圓心、半徑 r 的弧，角度 a0–a1（度，y 向下）
function arc(m, cx, cy, r, a0, a1) {
  for (let a = a0; a <= a1; a += 0.5) dot(m, cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180));
}
const seg = (dir, c, t, p0, p1) => ({ dir, c, t, p0, p1 });
const opts = { minGap: 30, maxGap: 200 };

test('兩段牆中間有開門弧：合併成一面牆，加上一扇門', () => {
  const ink = blank();
  // 牆在 y=100（厚 10），缺口 150–230，門軸在 150，往下（+y）開
  arc(ink, 150, 105, 80, 0, 90);
  vline(ink, 150, 105, 185);
  const segs = [seg('h', 100, 10, 20, 150), seg('h', 100, 10, 230, 380)];
  const r = detect(segs, ink, W, H, opts);
  assert.equal(r.segments.length, 1);
  assert.deepEqual([r.segments[0].p0, r.segments[0].p1], [20, 380]);
  assert.equal(r.openings.length, 1);
  const o = r.openings[0];
  assert.equal(o.type, 'door');
  assert.deepEqual([o.g0, o.g1, o.hinge, o.side], [150, 230, 'p0', 1]);
});

test('缺口內有平行細線：判定為窗', () => {
  const ink = blank();
  hline(ink, 150, 230, 97);
  hline(ink, 150, 230, 103);
  const segs = [seg('h', 100, 10, 20, 150), seg('h', 100, 10, 230, 380)];
  const r = detect(segs, ink, W, H, opts);
  assert.equal(r.segments.length, 1);
  assert.equal(r.openings.length, 1);
  assert.equal(r.openings[0].type, 'window');
});

test('沒有門窗符號的缺口保持原樣（開放通道）', () => {
  const segs = [seg('h', 100, 10, 20, 150), seg('h', 100, 10, 230, 380)];
  const r = detect(segs, blank(), W, H, opts);
  assert.equal(r.segments.length, 2);
  assert.equal(r.openings.length, 0);
});

test('太寬的缺口不當作門窗', () => {
  const ink = blank();
  hline(ink, 60, 340, 97);
  const segs = [seg('h', 100, 10, 0, 50), seg('h', 100, 10, 350, 400)];
  const r = detect(segs, ink, W, H, { minGap: 30, maxGap: 200 });
  assert.equal(r.openings.length, 0);
});

test('牆端和垂直牆之間的門：牆延伸到垂直牆，門軸在另一端、往上開', () => {
  const ink = blank();
  // 水平牆 y=100 從 20 到 150；垂直牆 x=240（厚 10，面在 235），缺口 150–235
  // 門軸在 235 那端（p1），往 -y 開
  arc(ink, 235, 95, 85, 180, 270);
  const segs = [seg('h', 100, 10, 20, 150), seg('v', 240, 10, 0, 300)];
  const r = detect(segs, ink, W, H, opts);
  const h = r.segments.find(s => s.dir === 'h');
  assert.equal(h.p1, 240);
  assert.equal(r.openings.length, 1);
  assert.deepEqual([r.openings[0].type, r.openings[0].g0, r.openings[0].g1, r.openings[0].hinge, r.openings[0].side], ['door', 150, 235, 'p1', -1]);
});

test('換算成平面圖：門掛在合併後的牆上，位置與方向正確', () => {
  const ink = blank();
  arc(ink, 150, 105, 80, 0, 90);
  const r = detect([seg('h', 100, 10, 20, 150), seg('h', 100, 10, 230, 380)], ink, W, H, opts);
  const p = plan.fromSegments(r.segments, { widthPx: W, heightPx: H, pxPerMeter: 20, wallHeight: 2.8 }, r.openings);
  assert.equal(p.walls.length, 1);
  assert.deepEqual(p.openings, [{ id: 'o1', type: 'door', wall: 'w1', offset: 8.5, width: 4, height: 2.1, hinge: 'a', swing: 'right' }]);
  assert.deepEqual(plan.validate(p), []);
});

test('弧線落在密集線條裡（家具、磁磚）不算門', () => {
  const ink = blank();
  // 缺口 150–230 下方整片都是格線，弧線自然也碰得到
  for (let y = 106; y < 200; y += 4) hline(ink, 140, 240, y);
  const segs = [seg('h', 100, 10, 20, 150), seg('h', 100, 10, 230, 380)];
  assert.equal(detect(segs, ink, W, H, opts).openings.length, 0);
});

test('只有半段弧（例如碰到椅子的圓弧）要看到門片才算門', () => {
  const half = () => { const m = blank(); arc(m, 150, 105, 80, 0, 55); return m; };
  const segs = () => [seg('h', 100, 10, 20, 150), seg('h', 100, 10, 230, 380)];
  assert.equal(detect(segs(), half(), W, H, opts).openings.length, 0);
  const ink = half();
  vline(ink, 150, 105, 185);   // 門片
  const r = detect(segs(), ink, W, H, opts);
  assert.equal(r.openings.length, 1);
  assert.equal(r.openings[0].type, 'door');
});

test('scaleFromDoors：門洞寬度的中位數當作 0.9 公尺', () => {
  const { scaleFromDoors } = require('../js/openings.js');
  const door = (g0, g1) => ({ type: 'door', g0, g1 });
  assert.strictEqual(scaleFromDoors([door(0, 45), door(10, 55), { type: 'window', g0: 0, g1: 200 }, door(0, 90)]), 50);
  assert.strictEqual(scaleFromDoors([door(0, 40), door(0, 50)]), 50);
  assert.strictEqual(scaleFromDoors([door(0, 45), { type: 'window', g0: 0, g1: 60 }]), null, '門少於 2 扇無法推算');
});
