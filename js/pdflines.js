// PDF 向量線條：把 pdf.js 的繪圖指令（operator list）換成頁面上的線段。
// CAD 輸出的 PDF 裡每條線都有精確座標，比從圖片找像素準確得多。
// 只收集線條與填色圖形的邊；文字與圖片略過。曲線（例如開門弧）拆成短線段並標記 curve，
// 找牆時只用直線，畫門窗遮罩時才會用到曲線。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPPdfLines = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CURVE_STEPS = 8;

  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    ];
  }

  // fnArray/argsArray：page.getOperatorList() 的結果；OPS：pdfjsLib.OPS；
  // base：頁面座標到輸出座標的轉換（通常是 viewport.transform，輸出 y 向下）
  // clip（可省略）：[x0, y0, x1, y1] 輸出座標的範圍，完全在範圍外的線段直接丟掉（整張圖紙的線段可能有幾十萬條）
  // 回傳 [{x0, y0, x1, y1, w, curve}]，w 是換算後的線寬
  function fromOperatorList(fnArray, argsArray, OPS, base, clip) {
    const out = [];
    let ctm = base.slice();
    let lineWidth = 1;
    const stack = [];
    let path = [];   // 目前路徑：[{x0,y0,x1,y1,curve}]，座標已經轉換過
    // 目前的點與子路徑起點：pdf.js 可能把同一條路徑拆成好幾個 constructPath，要跨指令保留
    let cur = null, start = null;
    const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

    function build(ops, args) {
      let k = 0;
      const line = (p, q, curve) => { if (p[0] !== q[0] || p[1] !== q[1]) path.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], curve: !!curve }); };
      const curveTo = (c1, c2, end) => {
        const p0 = cur, a = apply(ctm, ...c1), b = apply(ctm, ...c2), e = apply(ctm, ...end);
        let prev = p0;
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const p = bezier(p0, a, b, e, i / CURVE_STEPS);
          line(prev, p, true);
          prev = p;
        }
        cur = e;
      };
      for (const op of ops) {
        if (op === OPS.moveTo) { cur = start = apply(ctm, args[k], args[k + 1]); k += 2; }
        else if (op === OPS.lineTo) { const p = apply(ctm, args[k], args[k + 1]); k += 2; if (cur) line(cur, p); cur = p; if (!start) start = p; }
        else if (op === OPS.curveTo) { if (cur) curveTo([args[k], args[k + 1]], [args[k + 2], args[k + 3]], [args[k + 4], args[k + 5]]); k += 6; }
        else if (op === OPS.curveTo2) { // 第一個控制點等於目前的點
          if (cur) { const inv = invert(ctm); const c1 = apply(inv, ...cur); curveTo(c1, [args[k], args[k + 1]], [args[k + 2], args[k + 3]]); }
          k += 4;
        } else if (op === OPS.curveTo3) { // 第二個控制點等於終點
          if (cur) curveTo([args[k], args[k + 1]], [args[k + 2], args[k + 3]], [args[k + 2], args[k + 3]]);
          k += 4;
        } else if (op === OPS.closePath) { if (cur && start) line(cur, start); cur = start; }
        else if (op === OPS.rectangle) {
          const x = args[k], y = args[k + 1], w = args[k + 2], h = args[k + 3]; k += 4;
          const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(q => apply(ctm, ...q));
          for (let i = 0; i < 4; i++) line(p[i], p[(i + 1) % 4]);
          cur = start = p[0];
        }
      }
    }

    function flush(paint) {
      if (paint) {
        const w = lineWidth * scaleOf(ctm);
        for (const s of path) {
          if (clip && (Math.max(s.x0, s.x1) < clip[0] || Math.min(s.x0, s.x1) > clip[2] ||
            Math.max(s.y0, s.y1) < clip[1] || Math.min(s.y0, s.y1) > clip[3])) continue;
          s.w = w;
          out.push(s);
        }
      }
      path = [];
      cur = start = null;
    }

    const PAINT = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
      OPS.closeFillStroke, OPS.closeEOFillStroke]);
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i], a = argsArray[i];
      if (fn === OPS.save) stack.push([ctm, lineWidth]);
      else if (fn === OPS.restore) { const s = stack.pop(); if (s) [ctm, lineWidth] = s; }
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, lineWidth]); if (a && a[0]) ctm = mul(ctm, a[0]); }
      else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) [ctm, lineWidth] = s; }
      else if (fn === OPS.setLineWidth) lineWidth = a[0];
      else if (fn === OPS.constructPath) build(a[0], a[1]);
      else if (PAINT.has(fn)) flush(true);
      else if (fn === OPS.endPath) flush(false);
    }
    return out;
  }

  function invert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
      (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  }

  // 只留下和矩形範圍相交的線段，座標改成以範圍左上角為原點
  function crop(lines, x0, y0, x1, y1) {
    const out = [];
    for (const s of lines) {
      if (Math.max(s.x0, s.x1) < x0 || Math.min(s.x0, s.x1) > x1 || Math.max(s.y0, s.y1) < y0 || Math.min(s.y0, s.y1) > y1) continue;
      out.push({ ...s, x0: s.x0 - x0, y0: s.y0 - y0, x1: s.x1 - x0, y1: s.y1 - y0 });
    }
    return out;
  }

  // 把線段畫成遮罩（1 代表有線），給門窗辨識用
  function rasterize(lines, w, h, skip) {
    const mask = new Uint8Array(w * h);
    for (const s of lines) {
      if (skip && skip.has(s)) continue;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0))));
      for (let i = 0; i <= n; i++) {
        const x = Math.round(s.x0 + (s.x1 - s.x0) * i / n), y = Math.round(s.y0 + (s.y1 - s.y0) * i / n);
        if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
      }
    }
    return mask;
  }

  return { fromOperatorList, crop, rasterize };
});
