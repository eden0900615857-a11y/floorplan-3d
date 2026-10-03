// 平面圖 JSON：整個系統共用的資料格式（見 docs/設計脈絡.md 第 7 節）。
// 單位一律公尺，原點在平面圖左上角，x 向右、y 向下。
// 每面牆是從 a 到 b 的直線段，牆體沿這條線從 a 延伸到 b，厚度平均分在線的兩側。
// 門窗（openings）掛在某面牆上：offset 是開口中心到牆 a 端的距離，width 是開口寬度。
// 門另有 hinge（門軸靠近牆的 'a' 或 'b' 端）與 swing（往 a→b 方向的 'left' 或 'right' 側開，
// 以螢幕上看到的方向為準，y 向下）。窗有 sill（窗台高度）。
// 房間（rooms）由牆自動算出：polygon 是牆內的外框，area 是淨面積（平方公尺），label 是放房名的位置。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPPlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const VERSION = 1;
  const mm = v => Math.round(v * 1000) / 1000;

  const OPENING_DEFAULTS = {
    door: { width: 0.9, height: 2.1, sill: 0 },
    window: { width: 1.2, height: 1.2, sill: 0.9 }
  };
  // 窗的種類：窗台高與窗高（公尺）
  const WINDOW_KINDS = [
    { id: 'normal', name: '一般窗', sill: 0.9, height: 1.2 },
    { id: 'high', name: '高窗', sill: 1.6, height: 0.6 },
    { id: 'full', name: '落地窗', sill: 0, height: 2.1 }
  ];
  // 牆的種類（wall.kind）：省略是一般牆；low 是矮牆、glass 是玻璃欄杆，兩種都是陽台的欄杆，高 RAIL_H
  const WALL_KINDS = [
    { id: '', name: '牆' },
    { id: 'low', name: '矮牆' },
    { id: 'glass', name: '玻璃欄杆' }
  ];
  const RAIL_H = 1.1;
  function wallHeight(wall) {
    return wall.kind === 'low' || wall.kind === 'glass' ? Math.min(wall.height, RAIL_H) : wall.height;
  }

  // 像素座標裡「垂直於牆的正方向」在 a→b 的左側還是右側（y 向下）
  function swingOf(dir, side) {
    if (dir === 'h') return side > 0 ? 'right' : 'left';
    return side > 0 ? 'left' : 'right';
  }

  function makeOpening(id, type, wallId, offset, width, extra) {
    const d = OPENING_DEFAULTS[type];
    const o = { id, type, wall: wallId, offset: mm(offset), width: mm(width), height: d.height };
    if (type === 'window') o.sill = d.sill;
    if (type === 'door') { o.hinge = (extra && extra.hinge) || 'a'; o.swing = (extra && extra.swing) || 'left'; }
    return o;
  }

  // segs：vectorize 產生的像素線段；opts：{widthPx, heightPx, pxPerMeter, wallHeight, image}
  // openings：openings.js 找到的門窗（可省略）
  function fromSegments(segs, opts, openings) {
    const s = 1 / opts.pxPerMeter;
    const walls = segs.map((g, i) => {
      const a = g.dir === 'h' ? [g.p0, g.c] : [g.c, g.p0];
      const b = g.dir === 'h' ? [g.p1, g.c] : [g.c, g.p1];
      return {
        id: 'w' + (i + 1),
        a: [mm(a[0] * s), mm(a[1] * s)],
        b: [mm(b[0] * s), mm(b[1] * s)],
        thickness: mm(g.t * s),
        height: opts.wallHeight
      };
    });
    return {
      version: VERSION,
      unit: 'm',
      source: {
        widthPx: opts.widthPx,
        heightPx: opts.heightPx,
        pxPerMeter: Math.round(opts.pxPerMeter * 10000) / 10000,
        image: opts.image || null
      },
      walls,
      openings: (openings || []).map((o, i) => {
        const k = segs.indexOf(o.seg);
        const g = segs[k];
        return makeOpening('o' + (i + 1), o.type, walls[k].id, ((o.g0 + o.g1) / 2 - g.p0) * s, (o.g1 - o.g0) * s,
          o.type === 'door' ? { hinge: o.hinge === 'p0' ? 'a' : 'b', swing: swingOf(g.dir, o.side) } : null);
      }),
      rooms: [],
      furniture: [],
      materials: { wall: 'paint-white', ceiling: 'paint-white' }
    };
  }

  const isPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

  // 回傳錯誤訊息陣列；空陣列代表格式正確
  function validate(plan) {
    const errors = [];
    if (!plan || typeof plan !== 'object') return ['不是有效的 JSON 物件'];
    if (plan.version !== VERSION) errors.push('不支援的版本：' + plan.version);
    if (plan.unit !== 'm') errors.push('單位必須是公尺（m）');
    if (!Array.isArray(plan.walls)) return errors.concat('缺少 walls 陣列');
    plan.walls.forEach((w, i) => {
      const name = w && w.id ? w.id : '第 ' + (i + 1) + ' 面牆';
      if (!w || !isPoint(w.a) || !isPoint(w.b)) errors.push(name + '：a、b 必須是 [x, y] 座標');
      else if (w.a[0] === w.b[0] && w.a[1] === w.b[1]) errors.push(name + '：長度為 0');
      if (!(w && w.thickness > 0)) errors.push(name + '：厚度必須大於 0');
      if (!(w && w.height > 0)) errors.push(name + '：高度必須大於 0');
    });
    if (plan.openings != null && !Array.isArray(plan.openings)) return errors.concat('openings 必須是陣列');
    if (plan.rooms != null && !Array.isArray(plan.rooms)) return errors.concat('rooms 必須是陣列');
    (plan.rooms || []).forEach((r, i) => {
      const name = r && r.id ? r.id : '第 ' + (i + 1) + ' 個房間';
      if (!r || !Array.isArray(r.polygon) || r.polygon.length < 3 || !r.polygon.every(isPoint)) errors.push(name + '：polygon 至少要有 3 個 [x, y] 座標');
      if (!r || typeof r.name !== 'string') errors.push(name + '：缺少房名');
      if (!r || !isPoint(r.label)) errors.push(name + '：label 必須是 [x, y] 座標');
    });
    if (plan.furniture != null && !Array.isArray(plan.furniture)) return errors.concat('furniture 必須是陣列');
    (plan.furniture || []).forEach((f, i) => {
      const name = f && f.id ? f.id : '第 ' + (i + 1) + ' 件家具';
      if (!f || typeof f.model !== 'string') errors.push(name + '：缺少家具種類 model');
      if (!f || !isPoint(f.pos)) errors.push(name + '：pos 必須是 [x, y] 座標');
      if (!(f && f.w > 0 && f.d > 0)) errors.push(name + '：寬、深必須大於 0');
      if (f && f.color != null && !/^#[0-9a-f]{6}$/i.test(f.color)) errors.push(name + '：color 必須是 #rrggbb');
    });
    (plan.openings || []).forEach((o, i) => {
      const name = o && o.id ? o.id : '第 ' + (i + 1) + ' 個門窗';
      if (!o || !OPENING_DEFAULTS[o.type]) { errors.push(name + '：type 必須是 door 或 window'); return; }
      const w = plan.walls.find(x => x && x.id === o.wall);
      if (!w) errors.push(name + '：找不到所在的牆 ' + o.wall);
      if (!(o.width > 0)) errors.push(name + '：寬度必須大於 0');
      if (!(o.height > 0)) errors.push(name + '：高度必須大於 0');
      if (!Number.isFinite(o.offset)) errors.push(name + '：offset 必須是數字');
    });
    return errors;
  }

  function openingsOf(plan, wallId) {
    return (plan.openings || []).filter(o => o.wall === wallId);
  }

  // 門窗在牆上佔的範圍（沿牆距離，已限制在牆的長度內），由 a 端往 b 端排序
  function openingSpans(wall, openings) {
    const L = wallLength(wall);
    return openings
      .map(o => ({ o, s0: Math.max(0, o.offset - o.width / 2), s1: Math.min(L, o.offset + o.width / 2) }))
      .filter(x => x.s1 - x.s0 > 0.01)
      .sort((x, y) => x.s0 - y.s0);
  }

  // 3D 用：把一面牆切成實心的方塊。門窗處只留上方（和窗台下方）的牆。
  // 回傳 [{s0, s1, y0, y1}]：沿牆距離 s0–s1、高度 y0–y1（公尺）
  function wallPieces(wall, openings) {
    const L = wallLength(wall), H = wallHeight(wall), pieces = [];
    let cur = 0;
    for (const sp of openingSpans(wall, openings)) {
      if (sp.s0 > cur) pieces.push({ s0: cur, s1: sp.s0, y0: 0, y1: H });
      const s0 = Math.max(cur, sp.s0);
      if (sp.s1 > s0) {
        const sill = sp.o.type === 'window' ? Math.min(sp.o.sill || 0, H) : 0;
        const top = Math.min(H, sill + sp.o.height);
        if (sill > 0) pieces.push({ s0, s1: sp.s1, y0: 0, y1: sill });
        if (top < H) pieces.push({ s0, s1: sp.s1, y0: top, y1: H });
      }
      cur = Math.max(cur, sp.s1);
    }
    if (cur < L) pieces.push({ s0: cur, s1: L, y0: 0, y1: H });
    return pieces;
  }

  // 平面圖的範圍（公尺）：有原圖時用原圖大小，否則用牆的外框
  function bounds(plan) {
    const src = plan.source;
    if (src && src.widthPx && src.pxPerMeter) {
      return { minX: 0, minY: 0, maxX: src.widthPx / src.pxPerMeter, maxY: src.heightPx / src.pxPerMeter };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of plan.walls) {
      for (const p of [w.a, w.b]) {
        minX = Math.min(minX, p[0] - w.thickness / 2); maxX = Math.max(maxX, p[0] + w.thickness / 2);
        minY = Math.min(minY, p[1] - w.thickness / 2); maxY = Math.max(maxY, p[1] + w.thickness / 2);
      }
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    return { minX, minY, maxX, maxY };
  }

  function wallLength(w) {
    return Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  }

  // 3D 用：門窗的門框、門片、門把、窗框。每個零件是一個方塊：
  // s 沿牆距離、q 離中心線的距離（正的是 a→b 的左側，和門的 swing 'left' 同一邊）、y0–y1 高度，
  // len × t 是方塊的長和厚，angle 是方塊長邊和牆方向的夾角（弧度，往左側轉為正）；kind 是 frame、leaf、handle。
  const FRAME = 0.05, LEAF_T = 0.04, DOOR_OPEN = 70 * Math.PI / 180;
  function openingParts(wall, sp) {
    const o = sp.o, t = wall.thickness, H = wallHeight(wall), parts = [];
    const add = (kind, s, q, y0, y1, len, th, angle) => parts.push({ kind, s, q, y0, y1, len, t: th, angle: angle || 0 });
    const w = sp.s1 - sp.s0, mid = (sp.s0 + sp.s1) / 2;
    if (o.type === 'door') {
      const top = Math.min(H, o.height);
      // 門框：兩側和上方，比牆厚一點點
      add('frame', sp.s0 + FRAME / 2, 0, 0, top, FRAME, t + 0.02);
      add('frame', sp.s1 - FRAME / 2, 0, 0, top, FRAME, t + 0.02);
      add('frame', mid, 0, top - FRAME, top, w, t + 0.02);
      // 門片：門軸在牆面上（開門那一側），從關著的位置往開門方向轉 70 度
      const side = o.swing === 'right' ? -1 : 1, fromA = o.hinge !== 'b';
      const lw = Math.max(0.1, w - 2 * FRAME), hs = fromA ? sp.s0 + FRAME : sp.s1 - FRAME, hq = side * (t / 2);
      const closed = fromA ? 0 : Math.PI, angle = closed - (fromA ? -1 : 1) * side * DOOR_OPEN;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const leafAt = k => [hs + dx * lw * k, hq + dy * lw * k];
      const c = leafAt(0.5);
      add('leaf', c[0], c[1] + side * LEAF_T / 2, 0.01, top - FRAME - 0.005, lw, LEAF_T, angle);
      const hd = leafAt(0.88);
      add('handle', hd[0], hd[1] + side * LEAF_T / 2, 0.95, 1.0, 0.03, LEAF_T + 0.12, angle);
      return parts;
    }
    // 窗：窗框（四邊）、中間的直框（寬窗才有）、室內的窗台板
    const y0 = Math.min(o.sill || 0, H), y1 = Math.min(H, y0 + o.height), depth = Math.min(t, 0.08);
    if (y1 - y0 < 0.05) return parts;
    add('frame', sp.s0 + FRAME / 2, 0, y0, y1, FRAME, depth);
    add('frame', sp.s1 - FRAME / 2, 0, y0, y1, FRAME, depth);
    add('frame', mid, 0, y1 - FRAME, y1, w, depth);
    add('frame', mid, 0, y0, y0 + FRAME, w, depth);
    if (w > 0.8) add('frame', mid, 0, y0, y1, FRAME * 0.8, depth);
    if (y0 > 0.05) add('frame', mid, 0, y0 - 0.03, y0, w + 0.1, t + 0.08);
    return parts;
  }

  // 玻璃欄杆（wall.kind = 'glass'）的一段：底下 10 公分的牆座、玻璃、頂上的扶手和每 1.2 公尺以內一根的立柱。
  // 回傳 [{kind: 'curb' | 'glass' | 'metal', s0, s1, y0, y1, t}]
  function railingParts(wall, s0, s1) {
    const H = wallHeight(wall), CURB = 0.1, RAIL = 0.04, out = [];
    if (s1 - s0 < 0.01) return out;
    out.push({ kind: 'curb', s0, s1, y0: 0, y1: CURB, t: wall.thickness });
    out.push({ kind: 'glass', s0, s1, y0: CURB, y1: H - RAIL, t: 0.015 });
    out.push({ kind: 'metal', s0, s1, y0: H - RAIL, y1: H, t: 0.05 });
    const n = Math.max(1, Math.ceil((s1 - s0) / 1.2));
    for (let i = 0; i <= n; i++) {
      const s = Math.min(s1 - 0.02, Math.max(s0 + 0.02, s0 + (s1 - s0) * i / n));
      out.push({ kind: 'metal', s0: s - 0.02, s1: s + 0.02, y0: CURB, y1: H - RAIL, t: 0.04 });
    }
    return out;
  }

  // 3D 牆色用：一段牆（沿牆 s0–s1）的左右兩個牆面各屬於哪個房間。
  // roomAt([x, y]) 回傳該點所在的房間或 null；每 step 公尺在牆面外 0.15 公尺取樣，
  // 落在隔間牆裡（沒有房間）的取樣跟著前一個，回傳 [{s0, s1, left, right}]，左右房間相同的連成一段。
  function faceRooms(wall, s0, s1, roomAt, step) {
    const L = wallLength(wall);
    if (!L || s1 <= s0) return [];
    step = step || 0.1;
    const ux = (wall.b[0] - wall.a[0]) / L, uy = (wall.b[1] - wall.a[1]) / L, d = wall.thickness / 2 + 0.15;
    const n = Math.max(1, Math.round((s1 - s0) / step)), ds = (s1 - s0) / n;
    const at = (s, k) => roomAt([wall.a[0] + ux * s + uy * d * k, wall.a[1] + uy * s - ux * d * k]);
    const samples = [];
    for (let i = 0; i < n; i++) {
      const s = s0 + (i + 0.5) * ds;
      samples.push([at(s, 1), at(s, -1)]);
    }
    // 沒有房間的取樣：先往前補，開頭的再往後補
    for (const k of [0, 1]) {
      let last = null;
      for (const sm of samples) { if (sm[k]) last = sm[k]; else sm[k] = last; }
      last = null;
      for (let i = samples.length - 1; i >= 0; i--) { if (samples[i][k]) last = samples[i][k]; else samples[i][k] = last; }
    }
    const runs = [];
    samples.forEach((sm, i) => {
      const prev = runs[runs.length - 1];
      if (prev && prev.left === sm[0] && prev.right === sm[1]) prev.s1 = s0 + (i + 1) * ds;
      else runs.push({ s0: s0 + i * ds, s1: s0 + (i + 1) * ds, left: sm[0], right: sm[1] });
    });
    return runs;
  }

  return { VERSION, OPENING_DEFAULTS, WINDOW_KINDS, WALL_KINDS, RAIL_H, wallHeight, fromSegments, makeOpening, validate, bounds, wallLength, openingsOf, openingSpans, wallPieces, openingParts, railingParts, faceRooms };
});
