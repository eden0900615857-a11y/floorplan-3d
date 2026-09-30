// 牆向量化：把牆的像素轉成水平 / 垂直的直線段（中心線 + 厚度）。
// 目前只處理水平與垂直的牆，斜牆會被忽略（覆蓋率會下降）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPVectorize = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  // 沿著每一列（水平）或每一欄（垂直）找出連續的牆像素，
  // 相鄰列上位置相近、長度相近的線段歸成同一條「帶狀」牆。
  // 回傳的座標單位為像素，c 是中心線位置，p0–p1 是沿牆方向的範圍，t 是厚度。
  function extractBands(mask, w, h, horizontal, minLen) {
    const lines = horizontal ? h : w, len = horizontal ? w : h;
    const at = horizontal ? (l, p) => mask[l * w + p] : (l, p) => mask[p * w + l];
    let open = [];
    const done = [];
    for (let l = 0; l < lines; l++) {
      const runs = [];
      let p = 0;
      while (p < len) {
        if (!at(l, p)) { p++; continue; }
        const p0 = p;
        while (p < len && at(l, p)) p++;
        if (p - p0 >= minLen) runs.push([p0, p]);
      }
      const next = [], used = new Set();
      for (const run of runs) {
        let best = null, bestOv = 0;
        for (const band of open) {
          if (used.has(band)) continue;
          const last = band.last;
          const ov = Math.min(run[1], last[1]) - Math.max(run[0], last[0]);
          // 重疊要超過較長那段的 60%，避免垂直牆的短線段吃掉橫跨的水平牆
          if (ov >= 0.6 * Math.max(run[1] - run[0], last[1] - last[0]) && ov > bestOv) { best = band; bestOv = ov; }
        }
        if (best) {
          best.p0s.push(run[0]); best.p1s.push(run[1]); best.last = run; best.l1 = l;
          used.add(best); next.push(best);
        } else {
          const band = { l0: l, l1: l, p0s: [run[0]], p1s: [run[1]], last: run };
          used.add(band); next.push(band);
        }
      }
      for (const band of open) if (!used.has(band)) done.push(band);
      open = next;
    }
    done.push(...open);
    return done.map(b => ({
      dir: horizontal ? 'h' : 'v',
      c: (b.l0 + b.l1 + 1) / 2,
      t: b.l1 - b.l0 + 1,
      p0: median(b.p0s),
      p1: median(b.p1s)
    }));
  }

  // 同一條中心線上、中間只隔一小段的牆合併成一段（門洞的缺口比 gapTol 大，會保留）
  function mergeCollinear(segs, gapTol) {
    const sorted = segs.slice().sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : a.c - b.c || a.p0 - b.p0));
    const out = [];
    for (const s of sorted) {
      const m = out.find(o => o.dir === s.dir &&
        Math.abs(o.c - s.c) <= Math.max(o.t, s.t) / 2 &&
        s.p0 - o.p1 <= gapTol && o.p0 - s.p1 <= gapTol);
      if (!m) { out.push({ ...s }); continue; }
      const lm = m.p1 - m.p0, ls = s.p1 - s.p0;
      m.c = (m.c * lm + s.c * ls) / (lm + ls);
      m.p0 = Math.min(m.p0, s.p0);
      m.p1 = Math.max(m.p1, s.p1);
      m.t = Math.max(m.t, s.t);
    }
    return out;
  }

  // 被線段覆蓋到的牆像素比例，用來判斷向量化有沒有漏掉東西（例如斜牆）
  function coverage(mask, w, h, segs) {
    const hit = new Uint8Array(w * h);
    for (const s of segs) {
      const c0 = Math.max(0, Math.round(s.c - s.t / 2)), c1 = Math.min(s.dir === 'h' ? h : w, c0 + s.t);
      for (let l = c0; l < c1; l++) {
        for (let p = Math.max(0, s.p0); p < Math.min(s.dir === 'h' ? w : h, s.p1); p++) {
          hit[s.dir === 'h' ? l * w + p : p * w + l] = 1;
        }
      }
    }
    let total = 0, covered = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) { total++; covered += hit[i]; }
    return total ? covered / total : 1;
  }

  // opts.minThickness：與偵測時相同的最小牆厚（像素）
  function extractWalls(mask, w, h, opts) {
    const minT = Math.max(1, opts.minThickness || 1);
    const minLen = Math.max(2 * minT + 1, 8);
    const raw = extractBands(mask, w, h, true, minLen).concat(extractBands(mask, w, h, false, minLen));
    // 長度至少要是厚度的 2 倍，才算是沿這個方向的牆（排除垂直牆被橫向切出來的片段、粗體字殘留）；
    // 厚度也不能比最小牆厚還薄（排除門弧貼著牆邊留下的細碎片段）
    const walls = raw.filter(s => s.t >= minT && s.p1 - s.p0 >= Math.max(minLen, 2 * s.t));
    const gapTol = Math.max(3, minT);
    const merged = mergeCollinear(walls, gapTol);
    return { segments: merged, coverage: coverage(mask, w, h, merged) };
  }

  return { extractBands, mergeCollinear, coverage, extractWalls };
});
