// 房間辨識：用牆（門窗視為關閉）把平面切開，被牆圍起來的每一塊空間就是一個房間。
// 做法是把平面切成小格子：先畫上牆，從外圍把「屋外」填滿，剩下沒被填到的連通區域就是房間。
// 房間的面積是牆內的淨面積；沒有門窗符號的開放通道會讓兩個空間算成同一個房間。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPRooms = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const PING = 400 / 121;   // 1 坪 = 3.3058 平方公尺
  const mm = v => Math.round(v * 1000) / 1000;

  function toPing(m2) {
    return m2 / PING;
  }

  // opts.cell：格子大小（公尺），opts.minArea：小於這個面積的空間不算房間（例如牆與牆之間的縫）
  function detect(plan, opts) {
    const cell = (opts && opts.cell) || 0.05;
    const minArea = (opts && opts.minArea) || 1;
    const walls = plan.walls.filter(w => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 0);
    if (!walls.length) return [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of walls) {
      for (const p of [w.a, w.b]) {
        minX = Math.min(minX, p[0] - w.thickness); maxX = Math.max(maxX, p[0] + w.thickness);
        minY = Math.min(minY, p[1] - w.thickness); maxY = Math.max(maxY, p[1] + w.thickness);
      }
    }
    minX -= 2 * cell; minY -= 2 * cell;
    const W = Math.ceil((maxX - minX) / cell) + 3, H = Math.ceil((maxY - minY) / cell) + 3;
    const grid = new Uint8Array(W * H);   // 0 空地、1 牆、2 屋外、3 以上是房間編號 + 3
    const cx = i => minX + (i + 0.5) * cell, cy = j => minY + (j + 0.5) * cell;

    // 畫牆：稍微加粗半格，讓幾乎相接的牆確實接起來
    const pad = cell * 0.75;
    for (const w of walls) {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      const half = w.thickness / 2 + pad;
      const i0 = Math.max(0, Math.floor((Math.min(w.a[0], w.b[0]) - half - minX) / cell));
      const i1 = Math.min(W - 1, Math.ceil((Math.max(w.a[0], w.b[0]) + half - minX) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(w.a[1], w.b[1]) - half - minY) / cell));
      const j1 = Math.min(H - 1, Math.ceil((Math.max(w.a[1], w.b[1]) + half - minY) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = cx(i) - w.a[0], dy = cy(j) - w.a[1];
          const along = dx * ux + dy * uy, across = Math.abs(-dx * uy + dy * ux);
          if (along >= -pad && along <= L + pad && across <= half) grid[j * W + i] = 1;
        }
      }
    }

    // 從外框把屋外填滿（四方向相連）
    const stack = [];
    const push = k => { if (grid[k] === 0) { grid[k] = 2; stack.push(k); } };
    for (let i = 0; i < W; i++) { push(i); push((H - 1) * W + i); }
    for (let j = 0; j < H; j++) { push(j * W); push(j * W + W - 1); }
    const spread = mark => {
      while (stack.length) {
        const k = stack.pop(), i = k % W, j = (k - i) / W;
        const nb = [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1];
        for (const n of nb) if (n >= 0 && grid[n] === 0) { grid[n] = mark; stack.push(n); }
      }
    };
    spread(2);

    // 剩下的空地：每個連通區域是一個候選房間
    const rooms = [];
    let label = 3;
    for (let k = 0; k < grid.length; k++) {
      if (grid[k] !== 0) continue;
      grid[k] = label;
      stack.push(k);
      const cells = [];
      while (stack.length) {
        const q = stack.pop(), i = q % W, j = (q - i) / W;
        cells.push(q);
        const nb = [i > 0 ? q - 1 : -1, i < W - 1 ? q + 1 : -1, j > 0 ? q - W : -1, j < H - 1 ? q + W : -1];
        for (const n of nb) if (n >= 0 && grid[n] === 0) { grid[n] = label; stack.push(n); }
      }
      const area = cells.length * cell * cell;
      if (area >= minArea) {
        rooms.push({
          polygon: outline(grid, W, label, cells).map(([i, j]) => [mm(minX + i * cell), mm(minY + j * cell)]),
          area: Math.round(area * 100) / 100,
          label: labelPoint(grid, W, H, label, cells).map((v, n) => mm((n ? minY : minX) + (v + 0.5) * cell))
        });
      }
      label++;
    }
    return rooms;
  }

  // 區域的外框：收集區域邊界上的格線，串成一圈，再去掉共線的點。回傳格點座標
  function outline(grid, W, label, cells) {
    const inside = k => grid[k] === label;
    const next = new Map();   // 起點 → 終點（區域在前進方向的右側，y 向下）
    const key = (i, j) => i + ',' + j;
    for (const k of cells) {
      const i = k % W, j = (k - i) / W;
      if (j === 0 || !inside(k - W)) next.set(key(i, j), [i + 1, j]);             // 上緣，往右
      if (!inside(k + 1)) next.set(key(i + 1, j), [i + 1, j + 1]);                // 右緣，往下
      if (!inside(k + W)) next.set(key(i + 1, j + 1), [i, j + 1]);                // 下緣，往左
      if (i === 0 || !inside(k - 1)) next.set(key(i, j + 1), [i, j]);             // 左緣，往上
    }
    // 最上面一列最左邊那格的左上角一定在外框上
    let start = null;
    for (const k of cells) {
      const i = k % W, j = (k - i) / W;
      if (!start || j < start[1] || (j === start[1] && i < start[0])) start = [i, j];
    }
    const pts = [start];
    let cur = next.get(key(start[0], start[1]));
    for (let guard = 0; cur && guard < next.size + 1; guard++) {
      if (cur[0] === start[0] && cur[1] === start[1]) break;
      pts.push(cur);
      cur = next.get(key(cur[0], cur[1]));
    }
    // 去掉共線的中間點
    const out = [];
    for (let n = 0; n < pts.length; n++) {
      const a = pts[(n - 1 + pts.length) % pts.length], b = pts[n], c = pts[(n + 1) % pts.length];
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
    }
    return out;
  }

  // 放房名的位置：離牆最遠的格子（兩次掃描的距離轉換）
  function labelPoint(grid, W, H, label, cells) {
    const INF = 1e9, d = new Map();
    const get = (i, j) => (i < 0 || j < 0 || i >= W || j >= H || grid[j * W + i] !== label) ? 0 : (d.has(j * W + i) ? d.get(j * W + i) : INF);
    const sorted = cells.slice().sort((a, b) => a - b);
    for (const k of sorted) {
      const i = k % W, j = (k - i) / W;
      d.set(k, Math.min(INF, get(i - 1, j) + 3, get(i, j - 1) + 3, get(i - 1, j - 1) + 4, get(i + 1, j - 1) + 4));
    }
    let best = sorted[0], bestD = -1;
    for (let n = sorted.length - 1; n >= 0; n--) {
      const k = sorted[n], i = k % W, j = (k - i) / W;
      const v = Math.min(d.get(k), get(i + 1, j) + 3, get(i, j + 1) + 3, get(i + 1, j + 1) + 4, get(i - 1, j + 1) + 4);
      d.set(k, v);
      if (v > bestD) { bestD = v; best = k; }
    }
    const i = best % W;
    return [i, (best - i) / W];
  }

  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  // 重新辨識後保留房名：舊房間的房名位置落在哪個新房間裡，新房間就沿用它的 id、名稱與地板材質。
  // 好幾個舊房間合併成一間時，沿用其中面積最大的那一間
  function assign(found, previous) {
    const prev = (previous || []).filter(r => r && Array.isArray(r.label));
    const used = new Set();
    const rooms = found.map(r => {
      const old = prev
        .filter(o => !used.has(o.id) && pointInPolygon(o.label, r.polygon))
        .sort((a, b) => (b.area || 0) - (a.area || 0))[0];
      if (old) used.add(old.id);
      const room = { id: old ? old.id : null, name: old ? old.name : null, polygon: r.polygon, area: r.area, label: r.label };
      if (old && old.floor) room.floor = old.floor;
      return room;
    });
    const ids = new Set(rooms.filter(r => r.id).map(r => r.id));
    const names = new Set(rooms.filter(r => r.name).map(r => r.name));
    let idN = 0, nameN = 0;
    for (const r of rooms) {
      if (!r.id) { do { idN++; } while (ids.has('r' + idN)); r.id = 'r' + idN; ids.add(r.id); }
      if (!r.name) { do { nameN++; } while (names.has('房間 ' + nameN)); r.name = '房間 ' + nameN; names.add(r.name); }
    }
    return rooms;
  }

  function hitRoom(plan, p) {
    return (plan.rooms || []).find(r => pointInPolygon(p, r.polygon)) || null;
  }

  return { PING, toPing, detect, assign, pointInPolygon, hitRoom };
});
