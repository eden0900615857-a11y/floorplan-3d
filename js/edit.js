// 平面圖編輯操作：選取判定、端點吸附、拉直、新增 / 刪除牆、門窗與家具、比例尺換算、復原與重做。
// 只操作平面圖 JSON，不碰畫面，方便測試。座標單位一律公尺。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPEdit = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const mm = v => Math.round(v * 1000) / 1000;
  const FPPlanRef = () => (typeof FPPlan !== 'undefined' ? FPPlan : require('./plan.js'));
  const FPFurnitureRef = () => (typeof FPFurniture !== 'undefined' ? FPFurniture : require('./furniture.js'));
  const roundPt = p => [mm(p[0]), mm(p[1])];

  function findWall(plan, id) {
    return plan.walls.find(w => w.id === id) || null;
  }

  function nextId(plan, prefix) {
    prefix = prefix || 'w';
    const list = prefix === 'w' ? plan.walls : prefix === 'f' ? (plan.furniture || []) : (plan.openings || []);
    const re = new RegExp('^' + prefix + '(\\d+)$');
    let max = 0;
    for (const x of list) {
      const m = re.exec(x.id);
      if (m) max = Math.max(max, +m[1]);
    }
    return prefix + (max + 1);
  }

  function addWall(plan, a, b, thickness, height) {
    const wall = { id: nextId(plan), a: roundPt(a), b: roundPt(b), thickness: mm(thickness), height };
    plan.walls.push(wall);
    return wall;
  }

  // 刪除牆時，牆上的門窗一起刪除
  function deleteWall(plan, id) {
    const i = plan.walls.findIndex(w => w.id === id);
    if (i < 0) return false;
    plan.walls.splice(i, 1);
    if (plan.openings) plan.openings = plan.openings.filter(o => o.wall !== id);
    return true;
  }

  function findOpening(plan, id) {
    return (plan.openings || []).find(o => o.id === id) || null;
  }

  // 門窗在牆上的位置限制：整個開口要在牆的範圍內
  function clampOffset(wall, width, offset) {
    const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    if (width >= L) return L / 2;
    return Math.max(width / 2, Math.min(L - width / 2, offset));
  }

  // 在牆上加門窗；寬度超過牆長時縮到牆長減 10 公分
  function addOpening(plan, wallId, type, offset, width) {
    const wall = findWall(plan, wallId);
    if (!wall) return null;
    const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const wd = Math.max(0.1, Math.min(width, L - 0.1));
    if (!plan.openings) plan.openings = [];
    const o = FPPlanRef().makeOpening(nextId(plan, 'o'), type, wallId, clampOffset(wall, wd, offset), wd);
    plan.openings.push(o);
    return o;
  }

  function deleteOpening(plan, id) {
    const i = (plan.openings || []).findIndex(o => o.id === id);
    if (i < 0) return false;
    plan.openings.splice(i, 1);
    return true;
  }

  function moveOpening(plan, id, offset) {
    const o = findOpening(plan, id), wall = o && findWall(plan, o.wall);
    if (!wall) return null;
    o.offset = mm(clampOffset(wall, o.width, offset));
    return o;
  }

  function setOpeningWidth(plan, id, width) {
    const o = findOpening(plan, id), wall = o && findWall(plan, o.wall);
    if (!wall || !(width > 0)) return null;
    const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    o.width = mm(Math.min(width, L));
    o.offset = mm(clampOffset(wall, o.width, o.offset));
    return o;
  }

  // 窗台高與窗高：窗台在 0 到牆高減 10 公分之間，窗頂不超過牆高
  function setWindowSize(plan, id, sill, height) {
    const o = findOpening(plan, id), wall = o && findWall(plan, o.wall);
    if (!wall || o.type !== 'window' || !(sill >= 0) || !(height > 0)) return null;
    o.sill = mm(Math.min(sill, Math.max(0, wall.height - 0.1)));
    o.height = mm(Math.max(0.1, Math.min(height, wall.height - o.sill)));
    return o;
  }

  // 牆的種類：'' 一般牆、'low' 矮牆、'glass' 玻璃欄杆
  function setWallKind(plan, id, kind) {
    const w = findWall(plan, id);
    if (!w) return null;
    if (kind === 'low' || kind === 'glass') w.kind = kind;
    else delete w.kind;
    return w;
  }

  // 門的開向依序切換：左開 → 右開 → 門軸換邊左開 → 門軸換邊右開
  function flipDoor(plan, id) {
    const o = findOpening(plan, id);
    if (!o || o.type !== 'door') return null;
    if (o.swing === 'left') o.swing = 'right';
    else { o.swing = 'left'; o.hinge = o.hinge === 'a' ? 'b' : 'a'; }
    return o;
  }

  // 家具：尺寸取家具庫的預設值，角度 0 度（正面朝下）
  function findFurniture(plan, id) {
    return (plan.furniture || []).find(f => f.id === id) || null;
  }

  function addFurniture(plan, model, pos, rotation) {
    const def = FPFurnitureRef().item(model);
    if (!def) return null;
    if (!plan.furniture) plan.furniture = [];
    const f = { id: nextId(plan, 'f'), model, pos: roundPt(pos), rotation: normDeg(rotation || 0), w: def.w, d: def.d };
    plan.furniture.push(f);
    return f;
  }

  function deleteFurniture(plan, id) {
    const i = (plan.furniture || []).findIndex(f => f.id === id);
    if (i < 0) return false;
    plan.furniture.splice(i, 1);
    return true;
  }

  function moveFurniture(plan, id, pos) {
    const f = findFurniture(plan, id);
    if (f) f.pos = roundPt(pos);
    return f;
  }

  const normDeg = a => ((Math.round(a) % 360) + 360) % 360;

  function rotateFurniture(plan, id, deg) {
    const f = findFurniture(plan, id);
    if (f) f.rotation = normDeg((f.rotation || 0) + deg);
    return f;
  }

  function setFurnitureSize(plan, id, w, d) {
    const f = findFurniture(plan, id);
    if (!f || !(w > 0) || !(d > 0)) return null;
    f.w = mm(w); f.d = mm(d);
    return f;
  }

  // 家具顏色：#rrggbb，null 或空字串表示用原本的顏色
  function setFurnitureColor(plan, id, color) {
    const f = findFurniture(plan, id);
    if (!f) return null;
    if (color && /^#[0-9a-f]{6}$/i.test(color)) f.color = color.toLowerCase();
    else delete f.color;
    return f;
  }

  // 點到牆上的哪個位置（沿牆距離，公尺）
  function projectOnWall(wall, p) {
    const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    return distToSegment(p, wall.a, wall.b).t * L;
  }

  // 點到的門窗：點在開口範圍內、離牆中心線不遠
  function hitOpening(plan, p, tol) {
    let best = null, bestD = Infinity;
    for (const o of plan.openings || []) {
      const w = findWall(plan, o.wall);
      if (!w) continue;
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (!L) continue;
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      const c = [w.a[0] + ux * o.offset, w.a[1] + uy * o.offset];
      const half = o.width / 2;
      const { d } = distToSegment(p, [c[0] - ux * half, c[1] - uy * half], [c[0] + ux * half, c[1] + uy * half]);
      if (d <= Math.max(w.thickness / 2, tol) && d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  // 點到線段的距離，t 是投影位置（0 在 a、1 在 b）
  function distToSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
  }

  // 找出點到的東西：已選取那面牆的端點優先，其次是最近的牆身。
  // 回傳 {id, part: 'a' | 'b' | 'body'} 或 null；tol 是容許誤差（公尺）
  function hitTest(plan, p, tol, selectedId) {
    const sel = selectedId && findWall(plan, selectedId);
    if (sel) {
      for (const part of ['a', 'b']) {
        if (Math.hypot(p[0] - sel[part][0], p[1] - sel[part][1]) <= tol) return { id: sel.id, part };
      }
    }
    let best = null, bestD = Infinity;
    for (const w of plan.walls) {
      const { d } = distToSegment(p, w.a, w.b);
      if (d <= Math.max(w.thickness / 2, tol) && d < bestD) { best = w; bestD = d; }
    }
    return best ? { id: best.id, part: 'body' } : null;
  }

  // 吸附到其他牆的端點；exclude 可排除正在拖曳的那一面牆
  function snapToEndpoint(plan, p, tol, excludeId) {
    let best = null, bestD = tol;
    for (const w of plan.walls) {
      if (w.id === excludeId) continue;
      for (const q of [w.a, w.b]) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d <= bestD) { best = q; bestD = d; }
      }
    }
    return best ? [best[0], best[1]] : null;
  }

  // 接近水平或垂直時拉直（以 anchor 為基準，degTol 是角度容許值）
  function snapOrtho(anchor, p, degTol) {
    const dx = p[0] - anchor[0], dy = p[1] - anchor[1];
    if (!dx && !dy) return [p[0], p[1]];
    const ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);  // 0–180
    const tol = degTol == null ? 8 : degTol;
    if (ang <= tol || ang >= 180 - tol) return [p[0], anchor[1]];
    if (Math.abs(ang - 90) <= tol) return [anchor[0], p[1]];
    return [p[0], p[1]];
  }

  function moveEndpoint(plan, id, part, p) {
    const w = findWall(plan, id);
    if (w) w[part] = roundPt(p);
    return w;
  }

  function moveWall(plan, id, orig, dx, dy) {
    const w = findWall(plan, id);
    if (!w) return null;
    w.a = roundPt([orig.a[0] + dx, orig.a[1] + dy]);
    w.b = roundPt([orig.b[0] + dx, orig.b[1] + dy]);
    return w;
  }

  // 整張平面圖放大 k 倍（比例尺校正用）：牆的位置、長度、厚度與門窗的位置、寬度一起縮放，高度不變
  function rescale(plan, k) {
    for (const w of plan.walls) {
      w.a = roundPt([w.a[0] * k, w.a[1] * k]);
      w.b = roundPt([w.b[0] * k, w.b[1] * k]);
      w.thickness = mm(w.thickness * k);
    }
    for (const o of plan.openings || []) {
      o.offset = mm(o.offset * k);
      o.width = mm(o.width * k);
    }
    for (const r of plan.rooms || []) {
      r.polygon = r.polygon.map(p => roundPt([p[0] * k, p[1] * k]));
      r.label = roundPt([r.label[0] * k, r.label[1] * k]);
      r.area = Math.round(r.area * k * k * 100) / 100;
    }
    // 家具只移動位置，尺寸是實際尺寸，不跟著縮放
    for (const f of plan.furniture || []) f.pos = roundPt([f.pos[0] * k, f.pos[1] * k]);
    if (plan.source && plan.source.pxPerMeter) plan.source.pxPerMeter = Math.round(plan.source.pxPerMeter / k * 10000) / 10000;
    return plan;
  }

  // 兩點距離 measured（公尺）實際應該是 real（公尺）時的縮放倍數
  function scaleFactor(measured, real) {
    if (!(measured > 0) || !(real > 0)) return null;
    return real / measured;
  }

  // 復原 / 重做：存牆、門窗、房間、家具、材質、裝修方案與比例，不存原圖（原圖很大且不會被編輯）
  function snapshot(plan) {
    return {
      furniture: (plan.furniture || []).map(f => ({ ...f, pos: f.pos.slice() })),
      materials: { ...(plan.materials || {}) },
      schemes: plan.schemes ? JSON.parse(JSON.stringify(plan.schemes)) : null,
      activeScheme: plan.activeScheme,
      walls: plan.walls.map(w => ({ ...w, a: w.a.slice(), b: w.b.slice() })),
      openings: (plan.openings || []).map(o => ({ ...o })),
      rooms: (plan.rooms || []).map(r => ({ ...r, polygon: r.polygon.map(p => p.slice()), label: r.label.slice() })),
      pxPerMeter: plan.source ? plan.source.pxPerMeter : null
    };
  }
  function restore(plan, snap) {
    plan.walls = snap.walls.map(w => ({ ...w, a: w.a.slice(), b: w.b.slice() }));
    plan.openings = snap.openings.map(o => ({ ...o }));
    plan.rooms = snap.rooms.map(r => ({ ...r, polygon: r.polygon.map(p => p.slice()), label: r.label.slice() }));
    plan.furniture = snap.furniture.map(f => ({ ...f, pos: f.pos.slice() }));
    plan.materials = { ...snap.materials };
    if (snap.schemes) { plan.schemes = JSON.parse(JSON.stringify(snap.schemes)); plan.activeScheme = snap.activeScheme; }
    if (plan.source && snap.pxPerMeter != null) plan.source.pxPerMeter = snap.pxPerMeter;
  }

  class History {
    constructor(limit) { this.limit = limit || 100; this.clear(); }
    clear() { this.past = []; this.future = []; }
    // 在修改之前呼叫，記下修改前的狀態
    record(plan) {
      this.past.push(snapshot(plan));
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    undo(plan) {
      if (!this.past.length) return false;
      this.future.push(snapshot(plan));
      restore(plan, this.past.pop());
      return true;
    }
    redo(plan) {
      if (!this.future.length) return false;
      this.past.push(snapshot(plan));
      restore(plan, this.future.pop());
      return true;
    }
    get canUndo() { return this.past.length > 0; }
    get canRedo() { return this.future.length > 0; }
  }

  return {
    findWall, nextId, addWall, deleteWall, distToSegment, hitTest,
    findFurniture, addFurniture, deleteFurniture, moveFurniture, rotateFurniture, setFurnitureSize, setFurnitureColor,
    findOpening, addOpening, deleteOpening, moveOpening, setOpeningWidth, setWindowSize, setWallKind, flipDoor, projectOnWall, hitOpening,
    snapToEndpoint, snapOrtho, moveEndpoint, moveWall, rescale, scaleFactor, History
  };
});
