const test = require('node:test');
const assert = require('node:assert/strict');
const { otsu, wallMask } = require('../js/detect.js');

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
