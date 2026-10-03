// 家具 3D 模型：解開 js/models-data.js 裡壓縮的 KayKit 模型（CC0）。
// decode(name) 回傳正規化過的幾何：x、z 置中在 -0.5 到 0.5，y 從 0 到 1，
// 在 3D 裡再依家具的寬、高、深縮放，所以模型永遠剛好填滿家具的範圍。
// 模型的正面朝 +z，對應平面圖的 +y（家具 rotation 為 0 時的正面）。
(function (root, factory) {
  const data = root.FP_MODEL_DATA || (typeof require === 'function' ? require('./models-data.js') : null);
  const api = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPModels = api;
})(typeof self !== 'undefined' ? self : this, function (data) {
  const cache = new Map();

  function bytes(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out.buffer;
  }

  function has(name) {
    return !!(data && name && data.models[name]);
  }

  function decode(name) {
    if (!has(name)) return null;
    if (cache.has(name)) return cache.get(name);
    const m = data.models[name];
    const q = new Uint16Array(bytes(m.pos)), t = new Uint16Array(bytes(m.uv)), n = new Int8Array(bytes(m.nor));
    const position = new Float32Array(q.length), uv = new Float32Array(t.length), normal = new Float32Array(n.length);
    for (let i = 0; i < q.length; i++) {
      const k = i % 3, v = m.min[k] + q[i] / 65535 * (m.max[k] - m.min[k]);
      const span = m.max[k] - m.min[k] || 1;
      position[i] = k === 1 ? (v - m.min[1]) / span : (v - (m.min[k] + m.max[k]) / 2) / span;
    }
    for (let i = 0; i < t.length; i++) { const k = i % 2; uv[i] = m.uvMin[k] + t[i] / 65535 * (m.uvMax[k] - m.uvMin[k]); }
    for (let i = 0; i < n.length; i += 3) {
      const x = n[i] / 127, y = n[i + 1] / 127, z = n[i + 2] / 127, l = Math.hypot(x, y, z) || 1;
      normal[i] = x / l; normal[i + 1] = y / l; normal[i + 2] = z / l;
    }
    const g = { position, normal, uv, index: new Uint16Array(bytes(m.idx)), size: [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]] };
    cache.set(name, g);
    return g;
  }

  // 貼圖是 8 × 4 格的色塊（1024 × 1024），相鄰同色的格子算同一個色塊
  const SWATCHES = [
    ['wood-dark', 'wood-dark', 'wood-dark', 'wood', 'wood', 'wood-light', 'metal', 'white'],
    ['yellow', 'yellow', 'blue', 'blue', 'sheet', 'sheet', 'sheet', 'orange'],
    ['grey', 'beige', 'black', 'white2', 'wood-light2', 'wood2', 'teal', 'green'],
    ['grey', 'grad1', 'grad2', 'grad2', 'grad3', 'grad3', 'grad4', 'grad4']
  ];
  function swatch(u, v) {
    const c = Math.min(7, Math.max(0, Math.floor(u * 8))), r = Math.min(3, Math.max(0, Math.floor(v * 4)));
    return SWATCHES[r][c];
  }

  // 換色用：模型面積最大的色塊（沙發的布、床的被子、桌子的木頭）是「主色」，
  // 回傳每個頂點是否屬於主色，以及主色名稱
  const masks = new Map();
  function mainMask(name) {
    const g = decode(name);
    if (!g) return null;
    if (masks.has(name)) return masks.get(name);
    const P = g.position, U = g.uv, I = g.index, area = new Map(), n = U.length / 2;
    const sw = new Array(n);
    for (let i = 0; i < n; i++) sw[i] = swatch(U[i * 2], U[i * 2 + 1]);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ab = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], ac = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const ar = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2;
      const k = sw[I[t]];
      area.set(k, (area.get(k) || 0) + ar);
    }
    const main = [...area].sort((x, y) => y[1] - x[1])[0][0];
    const mask = Uint8Array.from(sw, k => (k === main ? 1 : 0));
    const out = { main, mask };
    masks.set(name, out);
    return out;
  }

  // 換成指定顏色的 UV：主色的頂點改用貼圖上白到淺灰的漸層色塊（保留明暗），再乘上顏色
  const NEUTRAL_U = 0.69;
  function tintUV(name) {
    const g = decode(name), m = mainMask(name);
    if (!g) return null;
    const uv = Float32Array.from(g.uv);
    for (let i = 0; i < m.mask.length; i++) {
      if (!m.mask[i]) continue;
      const v = uv[i * 2 + 1] * 4;
      uv[i * 2] = NEUTRAL_U;
      uv[i * 2 + 1] = 0.25 + Math.min(0.999, v - Math.floor(v)) * 0.25;
    }
    return uv;
  }

  return { has, decode, swatch, mainMask, tintUV, names: data ? Object.keys(data.models) : [], texture: data ? data.texture : null, source: data ? data.source : '' };
});
