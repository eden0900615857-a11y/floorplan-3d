// 第一人稱漫遊：移動與碰撞（純計算，不碰 3D 畫面）。
// 座標沿用平面圖：公尺，x 向右、y 向下。人是半徑 RADIUS 的圓，碰到牆就沿著牆滑開。
// 門洞上方的牆不擋路；窗台下面的牆會擋。
(function (root, factory) {
  const api = factory(root.FPPlan || (typeof require === 'function' ? require('./plan.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPWalk = api;
})(typeof self !== 'undefined' ? self : this, function (FPPlan) {
  const RADIUS = 0.2;
  const EYE = 1.6;
  const SPEED = 1.4;       // 公尺／秒，按住 Shift 加倍
  const TURN = 1.8;        // 弧度／秒（方向鍵左右轉）

  // 會擋路的牆段：從地面開始的牆段（門洞上方的不算）
  function solids(plan) {
    const out = [];
    for (const w of plan.walls) {
      const L = FPPlan.wallLength(w);
      if (!L) continue;
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      for (const pc of FPPlan.wallPieces(w, FPPlan.openingsOf(plan, w.id))) {
        if (pc.y0 > 0.5) continue;
        out.push({ ax: w.a[0], ay: w.a[1], ux, uy, s0: pc.s0, s1: pc.s1, h: w.thickness / 2 });
      }
    }
    return out;
  }

  // 把位置推到所有牆段外面（圓和長方形的碰撞），回傳新位置
  function collide(p, list, r) {
    r = r || RADIUS;
    let x = p[0], y = p[1];
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const b of list) {
        const dx = x - b.ax, dy = y - b.ay;
        const s = dx * b.ux + dy * b.uy, v = -dx * b.uy + dy * b.ux;
        const cs = Math.max(b.s0, Math.min(b.s1, s)), cv = Math.max(-b.h, Math.min(b.h, v));
        let es = s - cs, ev = v - cv;
        let d = Math.hypot(es, ev);
        if (d >= r) continue;
        if (d < 1e-9) {
          // 圓心在牆裡面：往最近的牆面推出去
          const opts = [[b.h - v, 0, 1], [v + b.h, 0, -1], [b.s1 - s, 1, 0], [s - b.s0, -1, 0]];
          const best = opts.sort((m, n) => m[0] - n[0])[0];
          es = best[1]; ev = best[2]; d = 0;
          const push = best[0] + r;
          x += (es * b.ux - ev * b.uy) * push;
          y += (es * b.uy + ev * b.ux) * push;
        } else {
          const push = (r - d) / d;
          x += (es * b.ux - ev * b.uy) * push;
          y += (es * b.uy + ev * b.ux) * push;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return [x, y];
  }

  // state：{x, y, yaw, pitch}；yaw 是面向的角度（0 = +x，往 +y 為正）
  // input：{forward, back, left, right, turnLeft, turnRight, fast}（布林）
  function step(state, input, dt, list) {
    const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);
    state.yaw += turn * TURN * dt;
    const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const s = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (f || s) {
      const len = Math.hypot(f, s), sp = SPEED * (input.fast ? 2 : 1) * dt / len;
      const cx = Math.cos(state.yaw), cy = Math.sin(state.yaw);
      // 右手邊是 yaw + 90°（y 向下的座標）
      const nx = state.x + (cx * f - cy * s) * sp, ny = state.y + (cy * f + cx * s) * sp;
      [state.x, state.y] = collide([nx, ny], list);
    }
    return state;
  }

  // 從 p 往 yaw 方向走，多遠會撞到牆（最多 max 公尺）
  function clearance(p, yaw, list, max) {
    const dx = Math.cos(yaw), dy = Math.sin(yaw);
    for (let d = 0.1; d <= max; d += 0.1) {
      const q = [p[0] + dx * d, p[1] + dy * d], c = collide(q, list);
      if (Math.abs(c[0] - q[0]) + Math.abs(c[1] - q[1]) > 1e-6) return d;
    }
    return max;
  }

  // 從 p 往 yaw 方向，多遠會碰到房間的邊界（多邊形）
  function toEdge(p, yaw, poly) {
    const dx = Math.cos(yaw), dy = Math.sin(yaw);
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a[0] - p[0], wy = a[1] - p[1];
      const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      if (t > 1e-9 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    return best;
  }

  // 起點：面積最大的房間的房名位置（沒有房間就用平面圖中心），
  // 面向房間裡最深的方向（不算門口，免得一開始就看向門外）
  function start(plan, list) {
    const rooms = (plan.rooms || []).slice().sort((a, b) => b.area - a.area);
    const bb = FPPlan.bounds(plan);
    const p = rooms.length ? rooms[0].label.slice() : [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
    list = list || solids(plan);
    let yaw = 0, best = -1;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const d = rooms.length ? Math.min(toEdge(p, a, rooms[0].polygon), 15) : clearance(p, a, list, 15);
      if (d > best + 1e-9) { best = d; yaw = a; }
    }
    return { x: p[0], y: p[1], yaw, pitch: 0 };
  }

  return { RADIUS, EYE, SPEED, solids, collide, step, start, clearance };
});
