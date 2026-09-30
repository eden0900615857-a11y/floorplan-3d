// 測試用的小工具：在空白遮罩上畫實心矩形
function blankMask(w, h) {
  return { w, h, mask: new Uint8Array(w * h) };
}
function fillRect(m, x, y, rw, rh, v = 1) {
  for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) m.mask[j * m.w + i] = v;
}
module.exports = { blankMask, fillRect };
