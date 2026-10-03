// 多樓層：一棟房子由好幾層平面圖疊起來。每一層是一份完整的平面圖 JSON（牆、門窗、房間、家具、方案），
// 另外記錄樓層名稱與 offset（這一層的平面圖座標加上 offset，就是整棟房子共用的座標，用來上下對齊）。
// 只有一層時存檔、下載都還是原本的平面圖 JSON，舊檔案不受影響。
(function (root, factory) {
  const api = factory(root.FPPlan || (typeof require === 'function' ? require('./plan.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPBuilding = api;
})(typeof self !== 'undefined' ? self : this, function (FPPlan) {
  const SLAB = 0.15;          // 樓板厚度（公尺）

  function isBuilding(v) {
    return !!v && v.type === 'building' && Array.isArray(v.floors);
  }

  // 平面圖或整棟房子的 JSON → 整棟房子（一層的平面圖包成一棟只有一層的房子）
  function wrap(v) {
    if (isBuilding(v)) {
      const b = { version: 1, type: 'building', floors: v.floors.filter(f => f && f.plan), active: v.active | 0 };
      b.floors.forEach((f, i) => {
        f.id = f.id || 'f' + (i + 1);
        f.name = f.name || (i + 1) + ' 樓';
        f.offset = Array.isArray(f.offset) ? f.offset : [0, 0];
      });
      b.active = Math.max(0, Math.min(b.floors.length - 1, b.active));
      return b;
    }
    return { version: 1, type: 'building', floors: [{ id: 'f1', name: '1 樓', offset: [0, 0], plan: v }], active: 0 };
  }

  // 存檔與下載：只有一層時存原本的平面圖 JSON
  function toJSON(b) {
    if (b.floors.length === 1) return b.floors[0].plan;
    return { version: 1, type: 'building', floors: b.floors, active: b.active };
  }

  function validate(v) {
    if (!isBuilding(v)) return FPPlan.validate(v);
    if (!v.floors.length) return ['沒有任何樓層'];
    const errors = [];
    v.floors.forEach((f, i) => {
      for (const e of FPPlan.validate(f && f.plan)) errors.push(((f && f.name) || (i + 1) + ' 樓') + '：' + e);
    });
    return errors;
  }

  // 一層樓的高度：最高的牆加上樓板
  function floorHeight(plan) {
    const h = (plan.walls || []).reduce((m, w) => Math.max(m, w.height || 0), 0);
    return (h || 2.8) + SLAB;
  }

  // 牆的外框（只看牆，不看原圖大小）；indoor 為 true 時不算陽台的矮牆、欄杆。沒有牆時回傳 null
  function wallBox(plan, indoor) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of plan.walls || []) {
      if (indoor && w.kind) continue;
      for (const p of [w.a, w.b]) {
        minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
      }
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }

  function nextId(b) {
    let n = 0;
    for (const f of b.floors) { const m = /^f(\d+)$/.exec(f.id); if (m) n = Math.max(n, +m[1]); }
    return 'f' + (n + 1);
  }

  function nextName(b) {
    const names = new Set(b.floors.map(f => f.name));
    let n = b.floors.length + 1;
    while (names.has(n + ' 樓')) n++;
    return n + ' 樓';
  }

  // 在最上面加一層，牆的外框左上角對齊下面那一層，設為目前樓層
  function addFloor(b, plan, name) {
    const below = b.floors[b.floors.length - 1];
    const f = { id: nextId(b), name: name || nextName(b), offset: [0, 0], plan };
    const a = below && wallBox(below.plan), c = wallBox(plan);
    if (a && c) f.offset = [round(below.offset[0] + a.minX - c.minX), round(below.offset[1] + a.minY - c.minY)];
    b.floors.push(f);
    b.active = b.floors.length - 1;
    return f;
  }

  function removeFloor(b, index) {
    if (b.floors.length < 2 || !b.floors[index]) return false;
    b.floors.splice(index, 1);
    if (b.active > index) b.active--;
    b.active = Math.min(b.active, b.floors.length - 1);
    return true;
  }

  function rename(b, index, name) {
    const f = b.floors[index];
    name = (name || '').trim();
    if (!f || !name) return null;
    f.name = name.slice(0, 20);
    return f.name;
  }

  // 3D 用：目前樓層以外要畫的樓層。預設只有下面的樓層；whole 為 true（看整棟）時連上面的樓層也畫，
  // 另外加一筆 slabOnly 的目前樓層，只畫它頂上的樓板
  function context(b, index, whole) {
    if (index == null) index = b.active;
    const out = below(b, index), cur = b.floors[index];
    if (!whole || !cur) return out;
    out.push({ id: cur.id, name: cur.name, plan: cur.plan, dx: 0, dy: 0, y: 0, slabOnly: true });
    let y = 0;
    for (let i = index + 1; i < b.floors.length; i++) {
      const f = b.floors[i];
      y += floorHeight(b.floors[i - 1].plan);
      out.push({ id: f.id, name: f.name, plan: f.plan, dx: round(f.offset[0] - cur.offset[0]), dy: round(f.offset[1] - cur.offset[1]), y: round(y) });
    }
    return out;
  }

  // 3D 用：目前樓層下面的每一層，相對於目前樓層的位置（dx、dy 是平面圖座標的位移，y 是高度，往下為負）
  function below(b, index) {
    if (index == null) index = b.active;
    const cur = b.floors[index], out = [];
    if (!cur) return out;
    let y = 0;
    for (let i = index - 1; i >= 0; i--) {
      const f = b.floors[i];
      y -= floorHeight(f.plan);
      out.push({ id: f.id, name: f.name, plan: f.plan, dx: round(f.offset[0] - cur.offset[0]), dy: round(f.offset[1] - cur.offset[1]), y: round(y) });
    }
    return out;
  }

  const round = v => Math.round(v * 1000) / 1000;

  return { SLAB, isBuilding, wrap, toJSON, validate, floorHeight, wallBox, addFloor, removeFloor, rename, below, context };
});
