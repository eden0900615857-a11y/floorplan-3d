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

  return { has, decode, names: data ? Object.keys(data.models) : [], texture: data ? data.texture : null, source: data ? data.source : '' };
});
