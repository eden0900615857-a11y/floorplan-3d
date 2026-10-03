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
    const L = wallLength(wall), H = wall.height, pieces = [];
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

  return { VERSION, OPENING_DEFAULTS, fromSegments, makeOpening, validate, bounds, wallLength, openingsOf, openingSpans, wallPieces };
});
