// 牆像素偵測：灰階圖 → 黑白 → 濾掉比牆細的線條。
// 同時支援瀏覽器（全域 FPDetect）與 Node（module.exports，供測試使用）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPDetect = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Otsu 法：找出讓前景、背景兩群灰階差異最大的門檻
  function otsu(gray) {
    const hist = new Float64Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  // Otsu 的門檻屬於深色那一群，所以深色是「小於等於」門檻
  function binarize(gray, thr, invert) {
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = invert ? (gray[i] > thr ? 1 : 0) : (gray[i] <= thr ? 1 : 0);
    return out;
  }

  function integral(mask, w, h) {
    const W = w + 1, I = new Int32Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += mask[y * w + x];
        I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row;
      }
    }
    return I;
  }

  // 方形核的侵蝕 / 膨脹（用積分影像，速度與核大小無關）
  function morph(mask, w, h, r, erode) {
    const I = integral(mask, w, h), W = w + 1, out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
        out[y * w + x] = erode ? (s === (x1 - x0) * (y1 - y0) ? 1 : 0) : (s > 0 ? 1 : 0);
      }
    }
    return out;
  }

  // opts.threshold：數字或 'auto'；opts.minThickness：比這個細的線條會被濾掉（像素）
  function wallMask(gray, w, h, opts) {
    const threshold = opts.threshold === 'auto' ? otsu(gray) : opts.threshold;
    const raw = binarize(gray, threshold, !!opts.invert);
    const r = (opts.minThickness - 1) >> 1;
    const walls = r > 0 ? morph(morph(raw, w, h, r, true), w, h, r, false) : raw.slice();
    // 開運算在邊角可能多出一點點，與原始深色像素取交集
    for (let i = 0; i < walls.length; i++) walls[i] &= raw[i];
    return { threshold, raw, walls };
  }

  return { otsu, binarize, morph, wallMask };
});
