const test = require('node:test');
const assert = require('node:assert/strict');
const FPPipeline = require('../js/pipeline.js');
const FPSample = require('../js/sample.js');
const FPPlan = require('../js/plan.js');
const FPRooms = require('../js/rooms.js');

// 照 js/sample.js 的座標畫出黑白範例圖（灰階，0 是黑、255 是白），大小和網頁辨識時一樣（長邊縮到 900 像素）。
// 沒有畫文字和尺寸線，細線也沒有反鋸齒，所以面積和網頁上的數字會差一點點，門窗和房間的數量要一樣。
const K = 0.9, W = FPSample.SIZE[0] * K, H = FPSample.SIZE[1] * K;
function drawSample() {
  const gray = new Uint8ClampedArray(W * H).fill(255);
  const dot = (x, y) => {
    // 細線畫成 2 × 2 像素，接近網頁上 1.5–2 像素寬的線
    for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = Math.floor(x * K) + i, py = Math.floor(y * K) + j;
      if (px >= 0 && py >= 0 && px < W && py < H) gray[py * W + px] = 0;
    }
  };
  const line = (x0, y0, x1, y1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= n; i++) dot(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
  };
  for (const [x, y, w, h] of FPSample.WALLS) {
    for (let j = Math.round(y * K); j < Math.round((y + h) * K); j++) for (let i = Math.round(x * K); i < Math.round((x + w) * K); i++) gray[j * W + i] = 0;
  }
  for (const [a, b] of FPSample.WINDOWS) { line(a, 64, b, 64); line(a, 70, b, 70); }
  for (const [hx, hy, r, a0, a1, lx, ly] of FPSample.DOORS) {
    for (let a = a0; a <= a1; a += 0.5 / r) dot(hx + r * Math.cos(a), hy + r * Math.sin(a));
    line(hx, hy, lx, ly);
  }
  for (const [x, y, w, h] of FPSample.FURNITURE) {
    line(x, y, x + w, y); line(x + w, y, x + w, y + h); line(x + w, y + h, x, y + h); line(x, y + h, x, y);
  }
  return { w: W, h: H, gray };
}

// 網頁載入範例時的設定：自動門檻、最小牆厚 5 像素、圖面寬 13.6 公尺
const OPTS = { ppm: W / 13.6, threshold: 'auto', minThickness: 5 };
function toPlan(src, res) {
  const p = FPPlan.fromSegments(res.segments, { widthPx: src.w, heightPx: src.h, pxPerMeter: res.ppm, wallHeight: 2.8 }, res.openings);
  p.rooms = FPRooms.assign(FPRooms.detect(p), []);
  return p;
}

test('黑白範例：10 段牆、4 扇門、2 扇窗、4 個房間', () => {
  const src = drawSample(), res = FPPipeline.raster(src, OPTS);
  assert.equal(res.scaled, false);
  assert.equal(res.ppm, OPTS.ppm);
  assert.ok(res.coverage > 0.95, '牆都是水平、垂直的，覆蓋率 ' + res.coverage);
  const p = toPlan(src, res);
  assert.deepEqual(FPPlan.validate(p), []);
  assert.equal(p.walls.length, 10);
  assert.equal(p.openings.filter(o => o.type === 'door').length, 4);
  assert.equal(p.openings.filter(o => o.type === 'window').length, 2);
  // 客廳和廚房之間是開放通道，算成同一間；面積由大到小（網頁上是 38.4、18.6、17.2、6.6 m²）
  const areas = p.rooms.map(r => r.area).sort((a, b) => b - a);
  assert.equal(areas.length, 4);
  [38.4, 18.6, 17.2, 6.6].forEach((a, i) => assert.ok(Math.abs(areas[i] - a) < 0.6, '第 ' + (i + 1) + ' 大的房間 ' + areas[i] + ' m²，應該接近 ' + a));
});

test('黑白範例：門的寬度和開門方向', () => {
  const src = drawSample(), p = toPlan(src, FPPipeline.raster(src, OPTS));
  const doors = p.openings.filter(o => o.type === 'door');
  // 範例的門洞是 70–80 像素（1000 像素寬的圖），圖面寬 13.6 公尺 → 0.95–1.09 公尺
  for (const d of doors) assert.ok(d.width > 0.85 && d.width < 1.2, d.id + ' 寬 ' + d.width);
  // 四扇門都有門軸和開門方向
  for (const d of doors) assert.ok(/^[ab]$/.test(d.hinge) && /^(left|right)$/.test(d.swing), d.id + ' ' + d.hinge + ' ' + d.swing);
  for (const o of p.openings) assert.ok(p.walls.some(w => w.id === o.wall), o.id + ' 掛在存在的牆上');
});

test('自動推算比例：用門寬推算出的圖面寬度接近實際（13.6 公尺，誤差 10% 以內）', () => {
  const src = drawSample();
  // 故意給一個差很多的比例（圖面寬 20 公尺）
  const res = FPPipeline.raster(src, { ...OPTS, ppm: W / 20, autoScale: true });
  assert.equal(res.scaled, true);
  const width = W / res.ppm;
  assert.ok(Math.abs(width / 13.6 - 1) < 0.1, '推算的圖面寬 ' + width.toFixed(2) + ' 公尺');
  const p = toPlan(src, res);
  assert.equal(p.openings.filter(o => o.type === 'door').length, 4);
  assert.equal(p.rooms.length, 4);
});

test('最小牆厚調太大：內牆（厚 9 像素）被濾掉，房間變少', () => {
  const src = drawSample();
  const p = toPlan(src, FPPipeline.raster(src, { ...OPTS, minThickness: 11 }));
  assert.ok(p.rooms.length < 4, '房間 ' + p.rooms.length + ' 個');
  assert.ok(p.walls.length < 10);
});
