const test = require('node:test');
const assert = require('node:assert/strict');
const { otsu, wallMask } = require('../js/detect.js');
const D = require('../js/detect.js');

function grayImage(w, h, draw) {
  const g = new Uint8ClampedArray(w * h).fill(255);
  draw((x, y, rw, rh, v) => {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) g[j * w + i] = v;
  });
  return g;
}

test('Otsu 門檻落在黑白之間', () => {
  const g = grayImage(50, 50, rect => rect(0, 0, 25, 50, 20));
  const t = otsu(g);
  assert.ok(t >= 20 && t < 255, 'threshold ' + t);
});

test('比最小牆厚細的線條被濾掉，粗的牆保留', () => {
  const w = 100, h = 100;
  const g = grayImage(w, h, rect => {
    rect(10, 10, 80, 10, 0);   // 牆，厚 10
    rect(10, 50, 80, 2, 0);    // 尺寸線，厚 2
  });
  const { walls } = wallMask(g, w, h, { threshold: 'auto', minThickness: 5 });
  assert.equal(walls[15 * w + 50], 1);
  assert.equal(walls[51 * w + 50], 0);
});

test('反相模式把淺色線當成牆', () => {
  const w = 60, h = 60;
  const g = new Uint8ClampedArray(w * h).fill(30);
  for (let j = 20; j < 30; j++) for (let i = 5; i < 55; i++) g[j * w + i] = 240;
  const { walls } = wallMask(g, w, h, { threshold: 'auto', invert: true, minThickness: 5 });
  assert.equal(walls[25 * w + 30], 1);
  assert.equal(walls[5 * w + 30], 0);
});

// 彩色格局圖：RGBA 影像，淺色底上有木紋色地板、彩色家具、深灰色的牆、灰色細線與淺藍色的窗
function colorImage(w, h) {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  const rect = (x, y, rw, rh, [r, g, b]) => {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) {
      const p = (j * w + i) * 4; px[p] = r; px[p + 1] = g; px[p + 2] = b;
    }
  };
  rect(0, 0, w, h, [251, 248, 243]);
  rect(10, 10, 80, 80, [201, 154, 102]);     // 木紋地板
  rect(20, 20, 30, 20, [224, 137, 79]);      // 橘色沙發
  rect(55, 50, 25, 25, [143, 179, 217]);     // 藍色床單
  rect(30, 60, 20, 15, [94, 158, 79]);       // 綠色盆栽
  rect(10, 5, 80, 6, [63, 63, 63]);          // 上牆
  rect(5, 5, 6, 90, [63, 63, 63]);           // 左牆
  rect(10, 45, 60, 1, [107, 107, 107]);      // 灰色細線（門弧、文字）
  rect(90, 20, 6, 30, [156, 201, 232]);      // 淺藍色的窗
  return px;
}

test('彩色格局圖：有顏色的地板與家具變成白色，只留下深灰色的牆', () => {
  const w = 100, h = 100, img = colorImage(w, h);
  const cg = D.colorGray(img, w, h);
  assert.ok(cg.colorful > 0.5, 'colorful ' + cg.colorful);
  const on = D.wallMask(cg.gray, w, h, { threshold: 'auto', minThickness: 5 });
  const off = D.wallMask(cg.plain, w, h, { threshold: 'auto', minThickness: 5 });
  const at = (m, x, y) => m.walls[y * w + x];
  assert.equal(at(on, 50, 7), 1, '上牆');
  assert.equal(at(on, 7, 50), 1, '左牆');
  for (const [x, y] of [[30, 30], [60, 60], [40, 65], [50, 85]]) assert.equal(at(on, x, y), 0, '彩色區域 ' + x + ',' + y);
  assert.equal(on.raw[45 * w + 30], 1, '灰色細線留在 raw 給門窗辨識');
  assert.equal(at(on, 30, 45), 0, '細線不是牆');
  // 不開彩色模式時，深色的家具和地板會被當成牆
  const wrong = [[30, 30], [40, 65], [60, 60]].filter(([x, y]) => at(off, x, y)).length;
  assert.ok(wrong >= 2, '一般灰階會誤判 ' + wrong);
});

test('淺藍色的窗：偏藍、不太暗的像素', () => {
  const w = 100, h = 100, blue = D.blueInk(colorImage(w, h), w, h);
  assert.equal(blue[30 * w + 92], 1);
  assert.equal(blue[60 * w + 60], 1, '藍色床單也算（只有在牆的缺口裡才會用到）');
  assert.equal(blue[30 * w + 30], 0);
  assert.equal(blue[7 * w + 50], 0);
  assert.equal(blue[95 * w + 50], 0);
});
