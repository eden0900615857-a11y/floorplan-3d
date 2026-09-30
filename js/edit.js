// 平面圖編輯操作：選取判定、端點吸附、拉直、新增 / 刪除牆、比例尺換算、復原與重做。
// 只操作平面圖 JSON，不碰畫面，方便測試。座標單位一律公尺。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPEdit = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const mm = v => Math.round(v * 1000) / 1000;
  const roundPt = p => [mm(p[0]), mm(p[1])];

  function findWall(plan, id) {
    return plan.walls.find(w => w.id === id) || null;
  }

  function nextId(plan) {
    let max = 0;
    for (const w of plan.walls) {
      const m = /^w(\d+)$/.exec(w.id);
      if (m) max = Math.max(max, +m[1]);
    }
    return 'w' + (max + 1);
  }

  function addWall(plan, a, b, thickness, height) {
    const wall = { id: nextId(plan), a: roundPt(a), b: roundPt(b), thickness: mm(thickness), height };
    plan.walls.push(wall);
    return wall;
  }

  function deleteWall(plan, id) {
    const i = plan.walls.findIndex(w => w.id === id);
    if (i < 0) return false;
    plan.walls.splice(i, 1);
    return true;
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

  // 整張平面圖放大 k 倍（比例尺校正用）：牆的位置、長度、厚度一起縮放，牆高不變
  function rescale(plan, k) {
    for (const w of plan.walls) {
      w.a = roundPt([w.a[0] * k, w.a[1] * k]);
      w.b = roundPt([w.b[0] * k, w.b[1] * k]);
      w.thickness = mm(w.thickness * k);
    }
    if (plan.source && plan.source.pxPerMeter) plan.source.pxPerMeter = Math.round(plan.source.pxPerMeter / k * 10000) / 10000;
    return plan;
  }

  // 兩點距離 measured（公尺）實際應該是 real（公尺）時的縮放倍數
  function scaleFactor(measured, real) {
    if (!(measured > 0) || !(real > 0)) return null;
    return real / measured;
  }

  // 復原 / 重做：只存牆與比例，不存原圖（原圖很大且不會被編輯）
  function snapshot(plan) {
    return {
      walls: plan.walls.map(w => ({ ...w, a: w.a.slice(), b: w.b.slice() })),
      pxPerMeter: plan.source ? plan.source.pxPerMeter : null
    };
  }
  function restore(plan, snap) {
    plan.walls = snap.walls.map(w => ({ ...w, a: w.a.slice(), b: w.b.slice() }));
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
    snapToEndpoint, snapOrtho, moveEndpoint, moveWall, rescale, scaleFactor, History
  };
});
