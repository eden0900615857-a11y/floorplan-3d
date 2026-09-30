// 平面圖 JSON：整個系統共用的資料格式（見 docs/設計脈絡.md 第 7 節）。
// 單位一律公尺，原點在平面圖左上角，x 向右、y 向下。
// 每面牆是從 a 到 b 的直線段，牆體沿這條線從 a 延伸到 b，厚度平均分在線的兩側。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPPlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const VERSION = 1;
  const mm = v => Math.round(v * 1000) / 1000;

  // segs：vectorize 產生的像素線段；opts：{widthPx, heightPx, pxPerMeter, wallHeight, image}
  function fromSegments(segs, opts) {
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
      openings: [],
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
    return errors;
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

  return { VERSION, fromSegments, validate, bounds, wallLength };
});
