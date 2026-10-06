// 外觀圖：把外觀照片或效果圖裡的一面牆（點四個角）拉正成平面的立面圖，貼到 3D 那一面的外牆上。
// 平面圖 JSON 的 facades：[{id, side, image}]，side 是牆面朝向（平面圖座標，y 向下），image 是拉正後的 JPEG data URL。
// 立面圖的左右對應這一層所有牆的外框（從屋外面對那一面看），上下對應地面到最高的牆頂。
// 只做計算，不碰畫面。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPFacade = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // n 是牆面朝外的方向（平面圖座標）
  const SIDES = [
    { id: 'front', name: '正面（平面圖下方那一面）', n: [0, 1] },
    { id: 'back', name: '背面（平面圖上方那一面）', n: [0, -1] },
    { id: 'left', name: '左側（平面圖左邊那一面）', n: [-1, 0] },
    { id: 'right', name: '右側（平面圖右邊那一面）', n: [1, 0] }
  ];

  function side(id) {
    return SIDES.find(s => s.id === id) || null;
  }

  // 牆面朝外的方向 (nx, ny) 屬於哪一面；斜的（偏超過約 40 度）回傳 null
  function sideOf(nx, ny) {
    if (ny > 0.75) return 'front';
    if (ny < -0.75) return 'back';
    if (nx < -0.75) return 'left';
    if (nx > 0.75) return 'right';
    return null;
  }

  // 這一面立面圖涵蓋的範圍：沿著牆面的 u0–u1（平面圖座標，front、back 是 x，left、right 是 y），高度 h；
  // flip 為 true 表示從屋外看過去，圖的左邊是座標大的那一端
  function extent(plan, id) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, h = 0;
    for (const w of plan.walls || []) {
      const t = (w.thickness || 0) / 2;
      for (const p of [w.a, w.b]) {
        minX = Math.min(minX, p[0] - t); maxX = Math.max(maxX, p[0] + t);
        minY = Math.min(minY, p[1] - t); maxY = Math.max(maxY, p[1] + t);
      }
      h = Math.max(h, w.height || 0);
    }
    if (minX === Infinity) return null;
    const alongX = id === 'front' || id === 'back';
    return {
      axis: alongX ? 'x' : 'y',
      u0: alongX ? minX : minY, u1: alongX ? maxX : maxY,
      h: h || 2.8,
      flip: id === 'back' || id === 'right'
    };
  }

  // 投影變換：把 from 的四個點對到 to 的四個點，回傳 3×3 矩陣（列優先，9 個數字）
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = from[i], [u, v] = to[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h ? h.concat(1) : null;
  }

  // 高斯消去法解 n 元一次方程組；奇異（四點共線等）回傳 null
  function solve(A, b) {
    const n = b.length, M = A.map((row, i) => row.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-10) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  function apply(H, p) {
    const w = H[6] * p[0] + H[7] * p[1] + H[8];
    return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
  }

  // 把來源圖片（{data, width, height}，RGBA）裡的四邊形 quad（左上、右上、右下、左下）拉正成 W × Hh 的長方形
  function warp(src, quad, W, Hh) {
    const H = homography([[0, 0], [W, 0], [W, Hh], [0, Hh]], quad);
    const out = new Uint8ClampedArray(W * Hh * 4);
    if (!H) return out;
    const sw = src.width, sh = src.height, d = src.data;
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        const [sx, sy] = apply(H, [x + 0.5, y + 0.5]);
        const fx = Math.max(0, Math.min(sw - 1.001, sx - 0.5)), fy = Math.max(0, Math.min(sh - 1.001, sy - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4, o = (y * W + x) * 4;
        for (let k = 0; k < 4; k++) {
          out[o + k] = (d[i00 + k] * (1 - ax) + d[i10 + k] * ax) * (1 - ay) + (d[i01 + k] * (1 - ax) + d[i11 + k] * ax) * ay;
        }
      }
    }
    return out;
  }

  return { SIDES, side, sideOf, extent, homography, apply, warp };
});
