// 從向量線條找牆：施工圖的牆通常畫成兩條平行細線（中間空心），
// 兩條線的距離就是牆厚。這裡把水平、垂直的直線找出來，兩兩配對成牆，
// 再補上柱子（小矩形）、把牆端接到相交的牆或柱子上，並從牆內部的細線找出窗。
// 輸入、輸出都是像素座標（y 向下），輸出的線段格式和 vectorize.js 相同：{dir, c, p0, p1, t}。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPLineWalls = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULTS = {
    minT: 0.08,       // 最薄的牆（公尺）
    maxT: 0.3,        // 最厚的牆
    minFace: 0.2,     // 牆面線至少要這麼長，比較短的（虛線的一小段、文字筆畫）不拿來配對
    minLen: 0.3,      // 配對後的牆至少要這麼長
    colMin: 0.2,      // 柱子邊長範圍
    colMax: 1.0,
    minWindow: 0.4,   // 窗至少要這麼寬
    gap: 0.4          // 同一條線上比這個窄的斷口直接接起來
  };

  // 水平、垂直的直線，同一條線上相接的片段合併。回傳 {h, v, rawH, rawV}，每條是 {c, a, b, src:[原始線段]}；
  // rawH/rawV 是合併前的（找柱子用，柱子的邊常常和牆面線接在同一條線上）
  function axisLines(lines, tol) {
    const h = [], v = [];
    for (const s of lines) {
      if (s.curve) continue;
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L = Math.hypot(dx, dy);
      if (L < tol) continue;
      if (Math.abs(dy) <= 0.01 * L) h.push({ c: (s.y0 + s.y1) / 2, a: Math.min(s.x0, s.x1), b: Math.max(s.x0, s.x1), src: [s] });
      else if (Math.abs(dx) <= 0.01 * L) v.push({ c: (s.x0 + s.x1) / 2, a: Math.min(s.y0, s.y1), b: Math.max(s.y0, s.y1), src: [s] });
    }
    return { h: joinCollinear(h.map(x => ({ ...x, src: x.src.slice() })), tol), v: joinCollinear(v.map(x => ({ ...x, src: x.src.slice() })), tol), rawH: h, rawV: v };
  }

  function joinCollinear(list, tol) {
    list.sort((p, q) => p.c - q.c);
    const out = [];
    let i = 0;
    while (i < list.length) {
      // 同一條線（c 差不到 tol）的線段一組，依起點排序後合併相接的
      let j = i + 1;
      while (j < list.length && list[j].c - list[i].c <= tol) j++;
      const group = list.slice(i, j).sort((p, q) => p.a - q.a);
      let cur = null;
      for (const s of group) {
        if (cur && s.a <= cur.b + tol) { cur.b = Math.max(cur.b, s.b); cur.src.push(...s.src); }
        else { cur = { c: s.c, a: s.a, b: s.b, src: s.src.slice() }; out.push(cur); }
      }
      i = j;
    }
    return out;
  }

  // 從區間清單扣掉 [a, b]
  function subtract(ints, a, b) {
    const out = [];
    for (const [x, y] of ints) {
      if (b <= x || a >= y) { out.push([x, y]); continue; }
      if (a > x) out.push([x, a]);
      if (b < y) out.push([b, y]);
    }
    return out;
  }

  // 每條線和「另一側最近的平行線」配對；一條線的不同段可以和不同的線配對
  function pairLines(list, dir, o) {
    const walls = [];
    const long = list.filter(s => s.b - s.a >= o.minFace);
    for (const s of long) {
      let free = [[s.a, s.b]];
      const cand = long
        .filter(t => t.c - s.c >= o.minT && t.c - s.c <= o.maxT && Math.min(s.b, t.b) > Math.max(s.a, t.a))
        .sort((p, q) => p.c - q.c);
      for (const t of cand) {
        const a = Math.max(s.a, t.a), b = Math.min(s.b, t.b);
        for (const [x, y] of free) {
          const lo = Math.max(x, a), hi = Math.min(y, b);
          if (hi - lo >= o.minLen) walls.push({ dir, c: (s.c + t.c) / 2, p0: lo, p1: hi, t: t.c - s.c, lo: s, hi: t });
        }
        free = subtract(free, a, b);
        if (!free.length) break;
      }
    }
    // 樓梯踏階：一串等距的平行線，每條線同時是前一階的上緣和下一階的下緣。
    // 兩面都和別的配對共用的是中間的踏階；再往外找共用一條線、厚度相近的，就是頭尾兩階
    // 相鄰的踏階長度差不多、間距也差不多
    const alike = (p, q) => Math.min(p.p1, q.p1) - Math.max(p.p0, q.p0) >= 0.8 * Math.min(p.p1 - p.p0, q.p1 - q.p0) &&
      Math.abs(p.t - q.t) <= 0.2 * Math.max(p.t, q.t);
    const byLine = new Map();
    for (const w of walls) for (const l of [w.lo, w.hi]) { if (!byLine.has(l)) byLine.set(l, []); byLine.get(l).push(w); }
    const across = (w, l) => byLine.get(l).filter(q => q !== w && alike(w, q) && (l === w.lo ? q.hi === l : q.lo === l));
    const stair = new Set(walls.filter(w => across(w, w.lo).length && across(w, w.hi).length));
    for (const w of walls) {
      if (stair.has(w)) continue;
      if (across(w, w.lo).concat(across(w, w.hi)).some(q => stair.has(q))) stair.add(w);
    }
    return walls.filter(w => !stair.has(w));
  }

  // 同一條中心線上重疊或相接的牆合併
  function mergeCollinear(segs, gapTol) {
    const sorted = segs.slice().sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : a.c - b.c || a.p0 - b.p0));
    const out = [];
    for (const s of sorted) {
      const m = out.find(q => q.dir === s.dir && !q.column && !s.column &&
        Math.abs(q.c - s.c) <= Math.max(q.t, s.t) / 2 &&
        s.p0 - q.p1 <= gapTol && q.p0 - s.p1 <= gapTol);
      if (!m) { out.push({ dir: s.dir, c: s.c, p0: s.p0, p1: s.p1, t: s.t, column: !!s.column }); continue; }
      const lm = m.p1 - m.p0, ls = s.p1 - s.p0;
      m.c = (m.c * lm + s.c * ls) / (lm + ls);
      m.p0 = Math.min(m.p0, s.p0);
      m.p1 = Math.max(m.p1, s.p1);
      m.t = Math.max(m.t, s.t);
    }
    return out;
  }

  // 柱子：四邊都畫出來的小矩形（邊長 colMin–colMax）
  function findColumns(h, v, o, tol) {
    const cols = [];
    const sized = s => s.b - s.a >= o.colMin - tol && s.b - s.a <= o.colMax + tol;
    const hs = h.filter(sized), vs = v.filter(sized);
    for (let i = 0; i < hs.length; i++) {
      for (let j = i + 1; j < hs.length; j++) {
        const top = hs[i], bot = hs[j];
        const d = bot.c - top.c;
        if (d < o.colMin - tol) continue;
        if (d > o.colMax + tol) break;
        if (Math.abs(top.a - bot.a) > tol || Math.abs(top.b - bot.b) > tol) continue;
        const x0 = (top.a + bot.a) / 2, x1 = (top.b + bot.b) / 2;
        const side = x => vs.some(s => Math.abs(s.c - x) <= tol && s.a <= top.c + tol && s.b >= bot.c - tol);
        if (!side(x0) || !side(x1)) continue;
        const w = x1 - x0;
        cols.push(w >= d
          ? { dir: 'h', c: (top.c + bot.c) / 2, p0: x0, p1: x1, t: d, column: true }
          : { dir: 'v', c: (x0 + x1) / 2, p0: top.c, p1: bot.c, t: w, column: true });
      }
    }
    return cols;
  }

  // 牆端落在另一面牆或柱子裡面（或很接近）時，延伸到它的中心線，讓牆和牆確實接起來
  function joinEnds(segs, tolFor) {
    for (const s of segs) {
      if (s.column) continue;
      for (const end of ['p0', 'p1']) {
        let best = null;
        const tol = tolFor(s);
        const dir = end === 'p1' ? 1 : -1;
        for (const q of segs) {
          if (q === s) continue;
          if (q.dir !== s.dir) {
            // 垂直相交：牆端在 q 的厚度範圍附近，而且 s 的中心線落在 q 的長度範圍內
            if (s.c < q.p0 - tol || s.c > q.p1 + tol) continue;
            const face = q.c - dir * q.t / 2;
            const gap = (face - s[end]) * dir;
            if (gap > tol || s[end] * dir > (q.c + q.t / 2 * dir) * dir + tol) continue;
            if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, to: q.c };
          } else if (q.column && Math.abs(q.c - s.c) <= q.t / 2) {
            // 同方向的柱子：牆端碰到柱子就延伸到柱子中間
            const near = dir > 0 ? q.p0 : q.p1;
            const gap = (near - s[end]) * dir;
            if (gap > tol || gap < -(q.p1 - q.p0)) continue;
            if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, to: (q.p0 + q.p1) / 2 };
          }
        }
        if (best && (best.to - s[end]) * dir > 0) s[end] = best.to;
      }
    }
    return segs;
  }

  // 把首尾相接的曲線小段串成一條條弧線
  function chainCurves(lines, tol) {
    const segs = lines.filter(l => l.curve);
    const key = (x, y) => Math.round(x / tol) + ',' + Math.round(y / tol);
    const byStart = new Map();
    for (const s of segs) {
      const k = key(s.x0, s.y0);
      if (!byStart.has(k)) byStart.set(k, []);
      byStart.get(k).push(s);
    }
    const hasPrev = new Set();
    for (const s of segs) for (const n of byStart.get(key(s.x1, s.y1)) || []) if (n !== s) hasPrev.add(n);
    const used = new Set(), chains = [];
    const walk = first => {
      const pts = [[first.x0, first.y0]];
      let cur = first;
      while (cur && !used.has(cur)) {
        used.add(cur);
        pts.push([cur.x1, cur.y1]);
        cur = (byStart.get(key(cur.x1, cur.y1)) || []).find(n => !used.has(n));
      }
      return pts;
    };
    for (const s of segs) if (!hasPrev.has(s) && !used.has(s)) chains.push(walk(s));
    for (const s of segs) if (!used.has(s)) chains.push(walk(s));
    return chains;
  }

  // 通過三點的圓心
  function circle(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
    return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
      (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
  }

  // 門：四分之一圓的開門弧。圓心是門軸，弧的一端落在牆上（門關起來的位置），另一端是門開到底的位置。
  // 找到後確保有一面牆蓋住整個門洞（門洞兩側的牆接起來，或延長靠近的那一面），回傳 openings.js 格式的門。
  // 會直接修改 segs（合併、延長牆），回傳 {segments, doors}
  function findDoors(segs, lines, opts) {
    const ppm = opts.ppm;
    const rMin = (opts.doorMin || 0.5) * ppm, rMax = (opts.doorMax || 1.3) * ppm;
    const reach = 0.6 * ppm, tol = Math.max(1, 0.05 * ppm);
    let walls = segs.slice();
    const doors = [];
    for (const pts of chainCurves(lines, Math.max(0.3, 0.005 * ppm))) {
      if (pts.length < 4) continue;
      const p0 = pts[0], p1 = pts[pts.length - 1], pm = pts[pts.length >> 1];
      const cen = circle(p0, pm, p1);
      if (!cen) continue;
      const r = Math.hypot(p0[0] - cen[0], p0[1] - cen[1]);
      if (r < rMin || r > rMax || Math.abs(Math.hypot(p1[0] - cen[0], p1[1] - cen[1]) - r) > 0.05 * r) continue;
      const cos = ((p0[0] - cen[0]) * (p1[0] - cen[0]) + (p0[1] - cen[1]) * (p1[1] - cen[1])) / (r * r);
      if (Math.abs(cos) > 0.3) continue;   // 大約 90 度
      // 兩個端點裡，和圓心連線是水平或垂直、而且貼著一面牆的，就是門關起來的位置
      let best = null;
      for (const [e, other] of [[p0, p1], [p1, p0]]) {
        const dx = e[0] - cen[0], dy = e[1] - cen[1];
        const dir = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        if (Math.min(Math.abs(dx), Math.abs(dy)) > 0.15 * r) continue;
        const along = p => (dir === 'h' ? p[0] : p[1]), across = p => (dir === 'h' ? p[1] : p[0]);
        const g0 = Math.min(along(cen), along(e)), g1 = Math.max(along(cen), along(e));
        const line = (across(cen) + across(e)) / 2;
        const hits = walls.filter(w => !w.column && w.dir === dir && Math.abs(w.c - line) <= w.t / 2 + tol &&
          w.p1 >= g0 - reach && w.p0 <= g1 + reach);
        if (!hits.length) continue;
        const dist = Math.min(...hits.map(w => Math.abs(w.c - line)));
        if (!best || dist < best.dist) best = { dir, g0, g1, hits, dist, hingeLow: along(cen) < along(e), open: across(other) };
      }
      if (!best) continue;
      // 門洞兩側的牆合成一面，並延伸到蓋住門洞
      const hits = best.hits;
      let w = hits[0];
      if (hits.length > 1) {
        const len = q => q.p1 - q.p0, total = hits.reduce((n, q) => n + len(q), 0);
        w = { dir: best.dir, c: hits.reduce((n, q) => n + q.c * len(q), 0) / total,
          p0: Math.min(...hits.map(q => q.p0)), p1: Math.max(...hits.map(q => q.p1)), t: Math.max(...hits.map(q => q.t)) };
        walls = walls.filter(q => !hits.includes(q)).concat(w);
        for (const d of doors) if (hits.includes(d.seg)) d.seg = w;
      }
      w.p0 = Math.min(w.p0, best.g0);
      w.p1 = Math.max(w.p1, best.g1);
      doors.push({ seg: w, g0: best.g0, g1: best.g1, type: 'door', hinge: best.hingeLow ? 'p0' : 'p1', side: best.open > w.c ? 1 : -1 });
    }
    return { segments: walls, doors };
  }

  // 相連的牆（外框放寬 tol 後有重疊）分成一群一群；和主結構不相連、總長又短的零星片段
  // 多半是圖框、尺寸線附近的雜線，拿掉
  function keepConnected(segs, tol, ratio) {
    const box = k => k.dir === 'h' ? [k.p0, k.c - k.t / 2, k.p1, k.c + k.t / 2] : [k.c - k.t / 2, k.p0, k.c + k.t / 2, k.p1];
    const boxes = segs.map(box), group = segs.map((_, i) => i);
    const find = i => (group[i] === i ? i : (group[i] = find(group[i])));
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a[0] - tol <= b[2] && b[0] - tol <= a[2] && a[1] - tol <= b[3] && b[1] - tol <= a[3]) group[find(i)] = find(j);
      }
    }
    const total = new Map();
    segs.forEach((s, i) => total.set(find(i), (total.get(find(i)) || 0) + s.p1 - s.p0));
    const biggest = Math.max(0, ...total.values());
    return segs.filter((s, i) => total.get(find(i)) >= ratio * biggest);
  }

  // lines：FPPdfLines 的線段（像素座標）；opts.ppm：每公尺像素數，其他參數見 DEFAULTS（公尺）
  // 回傳 {segments, faces}；faces 是被當成牆面的原始線段，畫門窗遮罩時要略過
  function extract(lines, opts) {
    const ppm = opts.ppm;
    const o = {};
    for (const k in DEFAULTS) o[k] = (opts[k] != null ? opts[k] : DEFAULTS[k]) * ppm;
    const tol = Math.max(0.5, 0.01 * ppm);
    const { h, v, rawH, rawV } = axisLines(lines, tol);
    const paired = pairLines(h, 'h', o).concat(pairLines(v, 'v', o));
    const faces = new Set();
    for (const w of paired) { w.lo.src.forEach(s => faces.add(s)); w.hi.src.forEach(s => faces.add(s)); }
    // 同一條線上相隔不到 gap 的牆接起來（畫圖時留下的小斷口，比門窗還窄）
    let walls = mergeCollinear(paired, o.gap);
    // 柱子只留下有牆接到的（不然浴室、廚房裡的方形設備也會被當成柱子）
    const near = (c, s) => {
      const r = Math.max(c.t, 0.1 * ppm);
      return walls.some(w => {
        if (w.dir === c.dir) return Math.abs(w.c - c.c) <= c.t / 2 + r && w.p0 <= c.p1 + r && w.p1 >= c.p0 - r;
        return w.c >= c.p0 - r && w.c <= c.p1 + r && w.p0 <= c.c + c.t / 2 + r && w.p1 >= c.c - c.t / 2 - r;
      });
    };
    const columns = findColumns(rawH.slice().sort((p, q) => p.c - q.c), rawV, o, tol * 2).filter(c => near(c));
    // 同一根柱子可能畫了兩次（外框加內框），只留最大的
    columns.sort((p, q) => (q.p1 - q.p0) * q.t - (p.p1 - p.p0) * p.t);
    const cols = [];
    for (const c of columns) {
      const box = k => k.dir === 'h' ? [k.p0, k.c - k.t / 2, k.p1, k.c + k.t / 2] : [k.c - k.t / 2, k.p0, k.c + k.t / 2, k.p1];
      const b = box(c);
      if (!cols.some(k => { const q = box(k); return b[0] < q[2] && q[0] < b[2] && b[1] < q[3] && q[1] < b[3]; })) cols.push(c);
    }
    walls = joinEnds(walls.concat(cols), s => Math.max(1.5 * s.t, 0.2 * ppm));
    walls = mergeCollinear(walls, tol * 2).filter(s => s.column || s.p1 - s.p0 >= Math.max(o.minLen, 2 * s.t));
    walls = keepConnected(walls, 0.05 * ppm, 0.2);
    return { segments: walls, faces, axis: { h, v } };
  }

  // 牆內部的平行細線（在兩個牆面之間、長度夠、至少兩條）視為窗。segs 是最後的牆；axis 是 extract 回傳的 axis
  // 回傳 openings.js 格式的窗：{seg, g0, g1, type: 'window'}
  function findWindows(segs, axis, opts) {
    const ppm = opts.ppm;
    const minWin = (opts.minWindow || DEFAULTS.minWindow) * ppm, minFace = DEFAULTS.minFace * ppm;
    const out = [];
    for (const s of segs) {
      if (s.column) continue;
      const list = s.dir === 'h' ? axis.h : axis.v;
      const half = s.t / 2;
      // 窗通常畫成兩到三條平行線（玻璃、窗框），所以要有兩條以上不同位置的內線重疊的地方才算
      const inner = list.filter(l => l.b - l.a >= minFace && Math.abs(l.c - s.c) <= half * 0.8 &&
        Math.min(l.b, s.p1) - Math.max(l.a, s.p0) >= minWin);
      const spans = [];
      for (let i = 0; i < inner.length; i++) {
        for (let j = i + 1; j < inner.length; j++) {
          if (Math.abs(inner[i].c - inner[j].c) < 0.01 * ppm) continue;
          const a = Math.max(inner[i].a, inner[j].a, s.p0), b = Math.min(inner[i].b, inner[j].b, s.p1);
          if (b - a >= minWin) spans.push([a, b]);
        }
      }
      spans.sort((p, q) => p[0] - q[0]);
      const merged = [];
      for (const sp of spans) {
        const last = merged[merged.length - 1];
        if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
        else merged.push(sp.slice());
      }
      // 整面牆都有內線多半是牆的中心線或粉刷線，不是窗
      for (const [a, b] of merged) {
        if (b - a > 0.9 * (s.p1 - s.p0) || b - a > 4 * ppm) continue;
        out.push({ seg: s, g0: a, g1: b, type: 'window' });
      }
    }
    return out;
  }

  function inside(p, poly) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }

  // 窗只會開在外牆上：窗兩側都在房間裡的（通常是隔間牆裡的線被誤認成窗）拿掉。plan 要先算好 rooms
  function dropIndoorWindows(plan) {
    const rooms = plan.rooms || [];
    plan.openings = (plan.openings || []).filter(o => {
      if (o.type !== 'window') return true;
      const w = plan.walls.find(x => x.id === o.wall);
      if (!w) return false;
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      const m = [w.a[0] + ux * o.offset, w.a[1] + uy * o.offset], d = w.thickness / 2 + 0.3;
      const sides = [[m[0] - uy * d, m[1] + ux * d], [m[0] + uy * d, m[1] - ux * d]];
      return !sides.every(p => rooms.some(r => inside(p, r.polygon)));
    });
    return plan;
  }

  return { DEFAULTS, axisLines, pairLines, mergeCollinear, findColumns, joinEnds, extract, findWindows, findDoors, chainCurves, dropIndoorWindows, keepConnected };
});
