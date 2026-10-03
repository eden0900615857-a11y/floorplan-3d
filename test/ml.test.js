const test = require('node:test');
const assert = require('node:assert');
const ML = require('../js/ml.js');
const FPOpenings = require('../js/openings.js');
const FPPlan = require('../js/plan.js');
const FPRooms = require('../js/rooms.js');

// 模型輸出的類別圖（模型解析度）：rooms 預設 4（客廳），icons 預設 0
function blankMap(w, h, room = 4) {
  return { w, h, rooms: new Uint8Array(w * h).fill(room), icons: new Uint8Array(w * h) };
}
function paint(arr, w, x, y, rw, rh, v) {
  for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) arr[j * w + i] = v;
}

test('inputSize：長邊縮到 512，內容是 4 的倍數，補白到 64 的倍數', () => {
  const s = ML.inputSize(900, 630);
  assert.strictEqual(s.w, 512);
  assert.strictEqual(s.h % 4, 0);
  assert.ok(Math.abs(s.h - 358) <= 4);
  assert.strictEqual(s.pw, 512);
  assert.strictEqual(s.ph, 384);
});

test('toTensor：RGB 換成 −1 到 1，補白的地方是 1', () => {
  const rgba = new Uint8ClampedArray([0, 255, 127.5, 255, 255, 0, 0, 255]);   // 2×1
  const t = ML.toTensor(rgba, 2, 1, 4, 2);
  assert.strictEqual(t.length, 3 * 8);
  assert.strictEqual(t[0], -1);           // R(0,0)
  assert.strictEqual(t[8], 1);            // G(0,0)
  assert.strictEqual(t[1], 1);            // R(1,0)
  assert.strictEqual(t[8 + 1], -1);       // G(1,0)
  assert.strictEqual(t[3], 1);            // 補白
  assert.strictEqual(t[2 * 8 + 4 + 3], 1);
});

test('decode：每個像素取分數最高的房間類別與圖示類別，並裁掉補白', () => {
  const pw = 4, ph = 2, plane = pw * ph, out = new Float32Array(44 * plane);
  out[(21 + 2) * plane + 0] = 5;          // (0,0) 牆
  out[(21 + 5) * plane + 1] = 5;          // (1,0) 臥室
  out[(33 + 2) * plane + 1] = 3;          // (1,0) 門
  out[(33 + 1) * plane + pw] = 3;         // (0,1) 窗
  const m = ML.decode(out, pw, ph, 2, 2);
  assert.deepStrictEqual([m.w, m.h], [2, 2]);
  assert.deepStrictEqual(Array.from(m.rooms), [2, 5, 0, 0]);
  assert.deepStrictEqual(Array.from(m.icons), [0, 2, 1, 0]);
});

test('wallMask：放大到辨識解析度，門窗的位置挖掉', () => {
  const m = blankMap(4, 1);
  m.rooms.fill(ML.WALL);
  m.icons[2] = ML.DOOR;
  const mask = ML.wallMask(m, 8, 2);
  assert.deepStrictEqual(Array.from(mask.slice(0, 8)), [1, 1, 1, 1, 0, 0, 1, 1]);
});

// 一間 8×6 公尺的房間（每公尺 10 像素），牆厚 4 像素；下牆有一扇門、右牆有一扇窗（只有模型標出來）
function roomMap() {
  const m = blankMap(120, 90, 5);
  const R = m.rooms;
  paint(R, 120, 0, 0, 120, 90, 0);
  paint(R, 120, 20, 15, 80, 60, 5);                  // 室內：臥室
  paint(R, 120, 20, 15, 80, 4, ML.WALL);             // 上
  paint(R, 120, 20, 71, 80, 4, ML.WALL);             // 下
  paint(R, 120, 20, 15, 4, 60, ML.WALL);             // 左
  paint(R, 120, 96, 15, 4, 60, ML.WALL);             // 右
  paint(m.icons, 120, 50, 71, 9, 4, ML.DOOR);        // 下牆 0.9 公尺的門
  paint(m.icons, 120, 96, 35, 4, 12, ML.WINDOW);     // 右牆 1.2 公尺的窗
  return m;
}

test('walls：模型的牆變成直線段，門窗留下缺口', () => {
  const m = roomMap();
  const res = ML.walls(m, 120, 90, 10);
  const h = res.segments.filter(s => s.dir === 'h'), v = res.segments.filter(s => s.dir === 'v');
  assert.strictEqual(h.length, 3, '上牆一段，下牆被門分成兩段');
  assert.strictEqual(v.length, 3, '左牆一段，右牆被窗分成兩段');
  assert.ok(res.coverage > 0.9);
});

test('openingHint + openings：規則找不到符號時，用模型判斷門窗', () => {
  const m = roomMap();
  const res = ML.walls(m, 120, 90, 10);
  // 只有門片（從門軸往室內的一條直線），沒有開門弧：規則找不到
  const ink = new Uint8Array(120 * 90);
  for (let y = 62; y < 71; y++) ink[y * 120 + 50] = 1;
  const none = FPOpenings.detect(res.segments, ink, 120, 90, { minGap: 5, maxGap: 25 });
  assert.strictEqual(none.openings.length, 0);
  const ops = FPOpenings.detect(res.segments, ink, 120, 90, { minGap: 5, maxGap: 25, hint: ML.openingHint(m, 120, 90) });
  assert.deepStrictEqual(ops.openings.map(o => o.type).sort(), ['door', 'window']);
  const door = ops.openings.find(o => o.type === 'door');
  assert.deepStrictEqual([door.hinge, door.side], ['p0', -1], '門軸在門片那一端，往室內開');
  assert.strictEqual(ops.segments.length, 4, '門窗兩側的牆合併成一面');
  // 牆封起來，找得到房間，房名來自模型的類別
  const plan = FPPlan.fromSegments(ops.segments, { widthPx: 120, heightPx: 90, pxPerMeter: 10, wallHeight: 2.8 }, ops.openings);
  const rooms = ML.nameRooms(FPRooms.assign(FPRooms.detect(plan), []), m, 10, 120);
  assert.strictEqual(rooms.length, 1);
  assert.strictEqual(rooms[0].name, '臥室');
});

test('模型說是門、但缺口附近完全沒有門弧或門片：當作通道，不算門', () => {
  const m = roomMap();
  const res = ML.walls(m, 120, 90, 10);
  const ops = FPOpenings.detect(res.segments, new Uint8Array(120 * 90), 120, 90, { minGap: 5, maxGap: 25, hint: ML.openingHint(m, 120, 90) });
  assert.deepStrictEqual(ops.openings.map(o => o.type), ['window']);
});

test('openingHint：缺口裡沒有門窗像素就不算', () => {
  const m = blankMap(60, 20, 0);
  const hint = ML.openingHint(m, 60, 20);
  assert.strictEqual(hint('h', 10, 4, 20, 30), null);
  paint(m.icons, 60, 20, 8, 10, 4, ML.WINDOW);
  assert.deepStrictEqual(hint('h', 10, 4, 20, 30), { type: 'window' });
});

test('snapEnds：差一點沒碰到的牆角接起來，門洞那麼寬的缺口不接', () => {
  const segs = [
    { dir: 'h', c: 10, t: 4, p0: 14, p1: 100 },      // 左端離垂直牆 4 像素
    { dir: 'v', c: 10, t: 4, p0: 16, p1: 80 },       // 上端離水平牆 6 像素
    { dir: 'h', c: 80, t: 4, p0: 40, p1: 100 }       // 左端離垂直牆 30 像素（門洞）
  ];
  ML.snapEnds(segs, 8);
  assert.strictEqual(segs[0].p0, 10);
  assert.strictEqual(segs[1].p0, 10);
  assert.strictEqual(segs[2].p0, 40);
});

test('nameRooms：同類房間編號，使用者取過的名字不動', () => {
  const m = blankMap(100, 50, 5);
  const sq = (x0, x1) => ({ polygon: [[x0, 0], [x1, 0], [x1, 5], [x0, 5]] });
  const rooms = [
    { name: '房間 1', ...sq(0, 3) },
    { name: '房間 2', ...sq(3, 6) },
    { name: '主臥', ...sq(6, 9) }
  ];
  ML.nameRooms(rooms, m, 10, 100);
  assert.deepStrictEqual(rooms.map(r => r.name), ['臥室', '臥室 2', '主臥']);
  // 模型看不出是什麼房間（未定義）就維持原名
  const r2 = [{ name: '房間 1', ...sq(0, 3) }];
  ML.nameRooms(r2, blankMap(100, 50, 11), 10, 100);
  assert.strictEqual(r2[0].name, '房間 1');
});
