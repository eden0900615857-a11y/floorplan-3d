// 材料用量估算：依目前方案算出各種地板的面積、牆面油漆面積與家具清單。
// 只是粗估，給屋主和師傅討論用：地板面積是房間淨面積，油漆面積是房間四周的牆面扣掉門窗。
(function (root, factory) {
  const api = factory(
    root.FPPlan || (typeof require === 'function' ? require('./plan.js') : null),
    root.FPRooms || (typeof require === 'function' ? require('./rooms.js') : null),
    root.FPMaterials || (typeof require === 'function' ? require('./materials.js') : null),
    root.FPFurniture || (typeof require === 'function' ? require('./furniture.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPQuantities = api;
})(typeof self !== 'undefined' ? self : this, function (FPPlan, FPRooms, FPMaterials, FPFurniture) {
  const WASTE = 0.1;           // 地板叫料多抓 10% 損耗
  const PAINT_M2_PER_L = 10;   // 一公升油漆約刷 10 m²（一道）
  const COATS = 2;
  const r2 = v => Math.round(v * 100) / 100;

  function perimeter(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      s += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return s;
  }

  // 門窗兩側各有幾個房間：室內門兩面都要扣，外牆的窗只扣室內那一面
  function roomSides(plan, o) {
    const w = plan.walls.find(x => x.id === o.wall);
    const L = w && FPPlan.wallLength(w);
    if (!L) return 0;
    const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
    const c = [w.a[0] + ux * o.offset, w.a[1] + uy * o.offset], d = w.thickness / 2 + 0.15;
    let n = 0;
    for (const s of [1, -1]) if (FPRooms.hitRoom(plan, [c[0] - uy * d * s, c[1] + ux * d * s])) n++;
    return n;
  }

  function estimate(plan) {
    const byFloor = new Map();
    for (const r of plan.rooms || []) {
      const f = FPMaterials.floor(r.floor);
      const e = byFloor.get(f.id) || { id: f.id, name: f.name, area: 0, rooms: [] };
      e.area += r.area;
      e.rooms.push(r.name);
      byFloor.set(f.id, e);
    }
    const floors = [...byFloor.values()]
      .map(e => ({ ...e, area: r2(e.area), order: r2(e.area * (1 + WASTE)) }))
      .sort((a, b) => b.area - a.area);

    const H = plan.walls.length ? plan.walls.reduce((s, w) => s + w.height, 0) / plan.walls.length : 0;
    let wall = (plan.rooms || []).reduce((s, r) => s + perimeter(r.polygon) * H, 0);
    for (const o of plan.openings || []) {
      const w = plan.walls.find(x => x.id === o.wall);
      const h = Math.min(o.height, w ? w.height : o.height);
      wall -= o.width * h * roomSides(plan, o);
    }
    wall = r2(Math.max(0, wall));
    const paint = FPMaterials.wall(plan.materials && plan.materials.wall);

    const counts = new Map();
    for (const f of plan.furniture || []) {
      const def = FPFurniture.item(f.model);
      const name = def ? def.name : f.model;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const furniture = [...counts].map(([name, count]) => ({ name, count }));

    return {
      floors,
      floorTotal: r2(floors.reduce((s, f) => s + f.area, 0)),
      wall: { name: paint.name, area: wall, liters: Math.ceil(wall * COATS / PAINT_M2_PER_L) },
      furniture
    };
  }

  return { WASTE, COATS, PAINT_M2_PER_L, perimeter, roomSides, estimate };
});
