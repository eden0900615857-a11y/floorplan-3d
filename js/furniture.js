// 家具庫：尺寸用常見的實際尺寸（公尺）。有 mesh 的家具在 3D 用 KayKit 的模型（js/models.js，CC0），
// 沒有模型的（廚具、衛浴、衣櫃、電視櫃）用 parts 的方塊和橢圓柱組成造型（門縫、把手、水龍頭、爐口、玻璃都有），
// 模型載入不到時其他家具也用 parts 的簡單造型。
// 擺在平面圖上的家具存成 {id, model, pos: [x, y], rotation, w, d}：pos 是中心點，
// rotation 是順時針角度（度，y 向下的平面圖座標），0 度時家具正面朝下（+y）。
// 只做計算，不碰畫面；3D 造型由 scene.js 依 parts() 產生。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPFurniture = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    fabric: '#8C96A3', cushion: '#A7B0BA', wood: '#B0845A', darkwood: '#6E4E36', white: '#F1F0EC',
    linen: '#E9E4DA', pillow: '#F7F5F0', black: '#2B2E33', steel: '#C9CDD1', ceramic: '#FAFAF8', green: '#6F8F5E',
    stone: '#D9D4CB', gap: '#9A9C9E', screen: '#1F2A35', chrome: '#AEB4BA', glass: '#CFE6F2', mirror: '#D5DEE3',
    stair: '#B48A60', riser: '#EDEBE6'
  };
  // parts：[x0, x1, y0, y1, z0, z1, 顏色, 形狀]，x、y 是寬、深的比例（y 0 是背面、1 是正面），z 是高度的比例（可以超過 1，例如洗手台上方的鏡子）。
  // 形狀省略是方塊；'cyl' 是貼著這個範圍的橢圓柱（馬桶、水龍頭、爐口）。顏色 glass 是半透明玻璃。
  const CATALOG = [
    { id: 'sofa3', mesh: 'couch_pillows', name: '三人沙發', cat: '客廳', w: 2.1, d: 0.9, h: 0.85, parts: [
      [0, 1, 0, 1, 0, 0.5, 'fabric'], [0, 1, 0, 0.25, 0.5, 1, 'fabric'],
      [0, 0.08, 0.25, 1, 0.5, 0.75, 'fabric'], [0.92, 1, 0.25, 1, 0.5, 0.75, 'fabric'],
      [0.08, 0.92, 0.25, 0.97, 0.5, 0.6, 'cushion']] },
    { id: 'armchair', mesh: 'armchair_pillows', name: '單人沙發', cat: '客廳', w: 0.9, d: 0.85, h: 0.85, parts: [
      [0, 1, 0, 1, 0, 0.5, 'fabric'], [0, 1, 0, 0.25, 0.5, 1, 'fabric'],
      [0, 0.15, 0.25, 1, 0.5, 0.75, 'fabric'], [0.85, 1, 0.25, 1, 0.5, 0.75, 'fabric'],
      [0.15, 0.85, 0.25, 0.97, 0.5, 0.6, 'cushion']] },
    { id: 'coffee', mesh: 'table_low', name: '茶几', cat: '客廳', w: 1.2, d: 0.6, h: 0.42, parts: [
      [0, 1, 0, 1, 0.85, 1, 'wood'], [0.03, 0.97, 0.05, 0.95, 0.15, 0.22, 'wood'],
      [0.03, 0.08, 0.05, 0.95, 0, 0.85, 'wood'], [0.92, 0.97, 0.05, 0.95, 0, 0.85, 'wood']] },
    { id: 'tvstand', name: '電視櫃與電視', cat: '客廳', w: 1.8, d: 0.45, h: 1.25, parts: [
      [0, 1, 0, 1, 0.05, 0.36, 'white'], [0.03, 0.06, 0.05, 0.95, 0, 0.05, 'darkwood'], [0.94, 0.97, 0.05, 0.95, 0, 0.05, 'darkwood'],
      [0.333, 0.336, 1, 1.01, 0.07, 0.34, 'gap'], [0.664, 0.667, 1, 1.01, 0.07, 0.34, 'gap'],
      [0.13, 0.2, 1, 1.04, 0.3, 0.32, 'steel'], [0.465, 0.535, 1, 1.04, 0.3, 0.32, 'steel'], [0.8, 0.87, 1, 1.04, 0.3, 0.32, 'steel'],
      [0.4, 0.6, 0.3, 0.55, 0.36, 0.375, 'black'], [0.48, 0.52, 0.42, 0.5, 0.375, 0.45, 'black'],
      [0.17, 0.83, 0.42, 0.5, 0.42, 0.98, 'black'], [0.18, 0.82, 0.5, 0.51, 0.43, 0.97, 'screen']] },
    { id: 'bed-double', mesh: 'bed_double_A', name: '雙人床', cat: '臥室', w: 1.52, d: 2.0, h: 1.0, parts: [
      [0, 1, 0.05, 1, 0, 0.3, 'wood'], [0.02, 0.98, 0.06, 0.99, 0.3, 0.52, 'linen'],
      [0, 1, 0, 0.05, 0, 1, 'wood'], [0.08, 0.46, 0.08, 0.2, 0.52, 0.62, 'pillow'],
      [0.54, 0.92, 0.08, 0.2, 0.52, 0.62, 'pillow']] },
    { id: 'bed-single', mesh: 'bed_single_A', name: '單人床', cat: '臥室', w: 0.95, d: 2.0, h: 1.0, parts: [
      [0, 1, 0.05, 1, 0, 0.3, 'wood'], [0.02, 0.98, 0.06, 0.99, 0.3, 0.52, 'linen'],
      [0, 1, 0, 0.05, 0, 1, 'wood'], [0.15, 0.85, 0.08, 0.2, 0.52, 0.62, 'pillow']] },
    { id: 'wardrobe', name: '衣櫃', cat: '臥室', w: 1.2, d: 0.6, h: 2.1, parts: [
      [0, 1, 0, 1, 0.03, 1, 'white'], [0.495, 0.505, 1, 1.01, 0.05, 0.98, 'gap'],
      [0.46, 0.475, 1, 1.05, 0.42, 0.58, 'steel'], [0.525, 0.54, 1, 1.05, 0.42, 0.58, 'steel'],
      [0.01, 0.99, 0, 0.96, 0, 0.03, 'black'], [0, 1, 1, 1.01, 0.86, 0.865, 'gap']] },
    { id: 'nightstand', mesh: 'cabinet_small', name: '床頭櫃', cat: '臥室', w: 0.45, d: 0.4, h: 0.5, parts: [
      [0, 1, 0, 1, 0, 1, 'wood'], [0.4, 0.6, 1, 1.05, 0.6, 0.7, 'steel']] },
    { id: 'desk', mesh: 'table_medium', name: '書桌', cat: '臥室', w: 1.2, d: 0.6, h: 0.75, parts: [
      [0, 1, 0, 1, 0.95, 1, 'wood'], [0, 0.04, 0.05, 0.95, 0, 0.95, 'wood'],
      [0.96, 1, 0.05, 0.95, 0, 0.95, 'wood'], [0.04, 0.96, 0.05, 0.1, 0.5, 0.95, 'wood']] },
    { id: 'chair', mesh: 'chair_A_wood', name: '椅子', cat: '餐廚', w: 0.45, d: 0.5, h: 0.9, parts: [
      [0, 1, 0, 1, 0.47, 0.52, 'wood'], [0, 1, 0, 0.1, 0.52, 1, 'wood'],
      [0, 0.1, 0, 0.1, 0, 0.47, 'darkwood'], [0.9, 1, 0, 0.1, 0, 0.47, 'darkwood'],
      [0, 0.1, 0.9, 1, 0, 0.47, 'darkwood'], [0.9, 1, 0.9, 1, 0, 0.47, 'darkwood']] },
    { id: 'dining', mesh: 'table_medium_long', name: '餐桌', cat: '餐廚', w: 1.4, d: 0.8, h: 0.75, parts: [
      [0, 1, 0, 1, 0.94, 1, 'wood'],
      [0.03, 0.08, 0.05, 0.14, 0, 0.94, 'darkwood'], [0.92, 0.97, 0.05, 0.14, 0, 0.94, 'darkwood'],
      [0.03, 0.08, 0.86, 0.95, 0, 0.94, 'darkwood'], [0.92, 0.97, 0.86, 0.95, 0, 0.94, 'darkwood']] },
    { id: 'kitchen', name: '廚具流理台', cat: '餐廚', w: 2.4, d: 0.6, h: 0.85, parts: [
      [0, 1, 0, 0.95, 0.12, 0.95, 'white'], [0, 1, 0, 1, 0.95, 1, 'stone'], [0, 1, 0, 0.9, 0, 0.12, 'black'],
      [0.25, 0.252, 0.95, 0.96, 0.13, 0.94, 'gap'], [0.5, 0.502, 0.95, 0.96, 0.13, 0.94, 'gap'], [0.75, 0.752, 0.95, 0.96, 0.13, 0.94, 'gap'],
      [0.08, 0.17, 0.95, 0.99, 0.84, 0.86, 'steel'], [0.33, 0.42, 0.95, 0.99, 0.84, 0.86, 'steel'],
      [0.58, 0.67, 0.95, 0.99, 0.84, 0.86, 'steel'], [0.83, 0.92, 0.95, 0.99, 0.84, 0.86, 'steel'],
      [0.1, 0.32, 0.22, 0.82, 0.97, 1.002, 'chrome'], [0.205, 0.215, 0.08, 0.13, 1, 1.35, 'chrome', 'cyl'],
      [0.205, 0.215, 0.1, 0.32, 1.32, 1.35, 'chrome'],
      [0.58, 0.86, 0.18, 0.86, 1, 1.012, 'black'], [0.6, 0.68, 0.25, 0.5, 1.012, 1.016, 'gap', 'cyl'],
      [0.76, 0.84, 0.25, 0.5, 1.012, 1.016, 'gap', 'cyl'], [0.66, 0.78, 0.55, 0.82, 1.012, 1.016, 'gap', 'cyl']] },
    { id: 'fridge', name: '冰箱', cat: '餐廚', w: 0.7, d: 0.7, h: 1.8, parts: [
      [0, 1, 0, 0.96, 0, 1, 'steel'], [0.01, 0.99, 0.96, 1, 0.68, 0.995, 'steel'], [0.01, 0.99, 0.96, 1, 0.02, 0.675, 'steel'],
      [0.06, 0.1, 1, 1.06, 0.72, 0.9, 'chrome'], [0.06, 0.1, 1, 1.06, 0.45, 0.64, 'chrome'], [0.02, 0.98, 0, 0.94, 0, 0.02, 'black']] },
    { id: 'toilet', name: '馬桶', cat: '衛浴', w: 0.4, d: 0.7, h: 0.8, parts: [
      [0.08, 0.92, 0, 0.26, 0.48, 0.95, 'ceramic'], [0.06, 0.94, 0, 0.28, 0.95, 1, 'ceramic'],
      [0.45, 0.55, 0.1, 0.18, 1, 1.015, 'chrome', 'cyl'], [0.28, 0.72, 0.3, 0.8, 0, 0.45, 'ceramic', 'cyl'],
      [0.1, 0.9, 0.24, 1, 0.38, 0.5, 'ceramic', 'cyl'], [0.08, 0.92, 0.25, 1, 0.5, 0.53, 'white', 'cyl'],
      [0.3, 0.7, 0.2, 0.3, 0.38, 0.5, 'ceramic']] },
    { id: 'basin', name: '洗手台', cat: '衛浴', w: 0.6, d: 0.45, h: 0.85, parts: [
      [0, 1, 0, 0.95, 0.06, 0.88, 'wood'], [0, 1, 0, 1, 0.88, 0.92, 'ceramic'], [0.03, 0.97, 0, 0.9, 0, 0.06, 'black'],
      [0.495, 0.505, 0.95, 0.96, 0.08, 0.86, 'gap'], [0.42, 0.47, 0.95, 1.0, 0.7, 0.74, 'steel'], [0.53, 0.58, 0.95, 1.0, 0.7, 0.74, 'steel'],
      [0.2, 0.8, 0.25, 0.85, 0.92, 1.04, 'ceramic', 'cyl'], [0.26, 0.74, 0.31, 0.79, 1.04, 1.045, 'mirror', 'cyl'],
      [0.48, 0.52, 0.08, 0.16, 0.92, 1.2, 'chrome', 'cyl'], [0.48, 0.52, 0.1, 0.32, 1.17, 1.2, 'chrome'],
      [0.1, 0.9, 0, 0.03, 1.3, 2.05, 'mirror']] },
    { id: 'bathtub', name: '浴缸', cat: '衛浴', w: 1.5, d: 0.75, h: 0.55, parts: [
      [0, 1, 0.9, 1, 0, 1, 'ceramic'], [0, 1, 0, 0.1, 0, 1, 'ceramic'],
      [0, 0.06, 0.1, 0.9, 0, 1, 'ceramic'], [0.94, 1, 0.1, 0.9, 0, 1, 'ceramic'],
      [0.06, 0.94, 0.1, 0.9, 0, 0.3, 'ceramic'],
      [0.06, 0.94, 0.1, 0.9, 0.3, 0.75, 'glass'], [0.9, 0.93, 0.02, 0.08, 1, 1.4, 'chrome', 'cyl'], [0.9, 0.93, 0.02, 0.2, 1.36, 1.4, 'chrome']] },
    { id: 'shower', name: '淋浴間', cat: '衛浴', w: 0.9, d: 0.9, h: 2.0, parts: [
      [0, 1, 0, 1, 0, 0.03, 'ceramic'], [0.45, 0.55, 0.45, 0.55, 0.03, 0.032, 'chrome', 'cyl'],
      [0, 1, 0.985, 1, 0.03, 0.97, 'glass'], [0.985, 1, 0, 0.985, 0.03, 0.97, 'glass'],
      [0, 1, 0.98, 1, 0.97, 0.98, 'chrome'], [0.98, 1, 0, 0.98, 0.97, 0.98, 'chrome'],
      [0.48, 0.52, 0.02, 0.06, 0.03, 0.95, 'chrome', 'cyl'], [0.48, 0.52, 0.04, 0.2, 0.93, 0.95, 'chrome'],
      [0.41, 0.59, 0.12, 0.3, 0.915, 0.93, 'chrome', 'cyl']] },
    { id: 'rug', mesh: 'rug_rectangle_A', name: '地毯', cat: '客廳', w: 2.0, d: 1.4, h: 0.02, parts: [
      [0, 1, 0, 1, 0, 1, 'linen']] },
    { id: 'lamp-floor', mesh: 'lamp_standing', name: '落地燈', cat: '其他', w: 0.4, d: 0.4, h: 1.6, parts: [
      [0.3, 0.7, 0.3, 0.7, 0, 0.03, 'black'], [0.47, 0.53, 0.47, 0.53, 0.03, 0.8, 'black'], [0.1, 0.9, 0.1, 0.9, 0.8, 1, 'linen']] },
    { id: 'plant', mesh: 'cactus_medium_A', name: '盆栽', cat: '其他', w: 0.4, d: 0.4, h: 1.2, parts: [
      [0.2, 0.8, 0.2, 0.8, 0, 0.3, 'darkwood'], [0, 1, 0, 1, 0.3, 1, 'green']] },
    // 樓梯：踏階依高度產生（stairParts），高度預設是這一層的樓高（牆高加樓板），往後面（背面）爬上去
    { id: 'stairs', name: '直樓梯', cat: '樓梯', w: 0.9, d: 3.6, h: 2.95, stairs: true, parts: [[0, 1, 0, 1, 0, 1, 'stair']] }
  ];
  const CATS = ['客廳', '臥室', '餐廚', '衛浴', '樓梯', '其他'];
  const RISER = 0.18;   // 每階大約的高度（公尺）

  // 直樓梯的踏階和扶手（格式同 CATALOG 的 parts，z 已經是比例）：正面（y = 1）是第一階，往背面爬到頂。
  // 扶手是一根斜的長條（形狀 'rail'：z0 是正面那一端的高度、z1 是背面那一端），高到上一層地板為止
  function stairParts(h) {
    const n = Math.max(2, Math.round(h / RISER)), out = [], railZ = 0.9 / h, T = 0.05 / h;
    for (let i = 0; i < n; i++) {
      const y0 = 1 - (i + 1) / n, y1 = 1 - i / n, z = (i + 1) / n;
      out.push([0, 1, y0, y1, z - T, z, 'stair']);               // 踏板
      out.push([0, 1, y1 - 0.004, y1, 0, z - T, 'riser']);      // 踢板（看起來像實心的樓梯）
      out.push([0.97, 1, y0, y1, 0, z, 'riser']);               // 靠牆那一側的側板
    }
    // 扶手沿著踏階的斜線，比踏階高 railZ；到上一層地板（高度 1）就停
    const end = Math.max(0.2, 1 - railZ);
    out.push([0.02, 0.06, 1 - end, 1, railZ, end + railZ, 'darkwood', 'rail']);
    for (let i = 0; i < n; i += 2) {
      const a = (i + 0.5) / n;
      if (a > end) break;
      out.push([0.03, 0.05, 1 - a - 0.004, 1 - a + 0.004, a - 0.5 / n, a + railZ, 'black']);   // 欄杆立柱
    }
    return out;
  }
  // 家具換色：換掉家具的主色（模型面積最大的色塊；方塊家具是第一個方塊的顏色），id 就是存檔的 color
  const TINTS = [
    { id: '#f2f0eb', name: '白' }, { id: '#e6dcc8', name: '米白' }, { id: '#b9bcbe', name: '淺灰' },
    { id: '#6b6f73', name: '深灰' }, { id: '#2e3033', name: '黑' }, { id: '#c9a27a', name: '原木' },
    { id: '#8a5a3b', name: '胡桃木' }, { id: '#6f8da6', name: '灰藍' }, { id: '#2f4f45', name: '墨綠' },
    { id: '#d9a441', name: '芥末黃' }, { id: '#a8553f', name: '磚紅' }, { id: '#c99a9a', name: '乾燥玫瑰' }
  ];

  function item(model) {
    return CATALOG.find(c => c.id === model) || null;
  }

  // 家具的寬深方向：ux 是寬（家具的左右），fy 是正面方向
  function axes(f) {
    const a = (f.rotation || 0) * Math.PI / 180;
    return { ux: [Math.cos(a), Math.sin(a)], fy: [-Math.sin(a), Math.cos(a)] };
  }

  // 家具在平面圖上的四個角（順序：背左、背右、前右、前左）
  function footprint(f) {
    const { ux, fy } = axes(f), hw = f.w / 2, hd = f.d / 2;
    const at = (sx, sy) => [f.pos[0] + ux[0] * sx + fy[0] * sy, f.pos[1] + ux[1] * sx + fy[1] * sy];
    return [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)];
  }

  // 點 p 是否在家具範圍內（pad 是額外的容許距離）
  function contains(f, p, pad) {
    const { ux, fy } = axes(f);
    const dx = p[0] - f.pos[0], dy = p[1] - f.pos[1];
    const s = dx * ux[0] + dy * ux[1], t = dx * fy[0] + dy * fy[1];
    pad = pad || 0;
    return Math.abs(s) <= f.w / 2 + pad && Math.abs(t) <= f.d / 2 + pad;
  }

  // 貼地的家具（地毯）永遠在最下層
  const flat = f => { const def = item(f.model); return !!def && (f.h || def.h) < 0.1; };

  // 由下到上的順序：地毯先，其他照擺放順序
  function layered(plan) {
    const list = plan.furniture || [];
    return list.filter(flat).concat(list.filter(f => !flat(f)));
  }

  // 點到的家具：最上層的優先（後擺的在上面，地毯在最下面）
  function hit(plan, p, pad) {
    const list = layered(plan);
    for (let i = list.length - 1; i >= 0; i--) if (contains(list[i], p, pad)) return list[i];
    return null;
  }

  // 3D 用的方塊或橢圓柱：中心 (x, y) 在平面圖座標、寬 w 深 d、底 z0 頂 z1（公尺），rotation 同家具，shape 是 'box' 或 'cyl'
  // floorH：這一層的樓高，樓梯沒有另外設定高度時用它
  function parts(f, floorH) {
    const def = item(f.model);
    if (!def) return [];
    const h = f.h || (def.stairs && floorH) || def.h, { ux, fy } = axes(f);
    const mainKey = def.parts[0][6];
    return (def.stairs ? stairParts(h) : def.parts).map(([x0, x1, y0, y1, z0, z1, c, shape]) => {
      const sx = ((x0 + x1) / 2 - 0.5) * f.w, sy = ((y0 + y1) / 2 - 0.5) * f.d;
      if (shape === 'rail') {
        // 斜的長條：tilt 是往背面抬高的角度，d 是斜邊長度，z0–z1 是中心高度上下 2 公分
        const run = (y1 - y0) * f.d, rise = (z1 - z0) * h, zc = (z0 + z1) / 2 * h;
        return {
          x: f.pos[0] + ux[0] * sx + fy[0] * sy, y: f.pos[1] + ux[1] * sx + fy[1] * sy,
          w: (x1 - x0) * f.w, d: Math.hypot(run, rise), z0: zc - 0.02, z1: zc + 0.02, tilt: Math.atan2(rise, run),
          rotation: f.rotation || 0, color: C[c] || c, shape: 'box', glass: false
        };
      }
      return {
        x: f.pos[0] + ux[0] * sx + fy[0] * sy, y: f.pos[1] + ux[1] * sx + fy[1] * sy,
        w: (x1 - x0) * f.w, d: (y1 - y0) * f.d, z0: z0 * h, z1: z1 * h,
        rotation: f.rotation || 0, color: f.color && c === mainKey ? f.color : C[c] || c,
        shape: shape || 'box', glass: c === 'glass'
      };
    });
  }

  // 漫遊時擋路的範圍（格式同 FPWalk.solids）：比腳踝高的家具才擋
  function solid(f) {
    const def = item(f.model);
    // 樓梯可以走上去（FPWalk.ramps 只擋兩側），淋浴間可以走進去
    if (!def || (f.h || def.h) < 0.1 || def.id === 'shower' || def.stairs) return null;
    const { ux } = axes(f);
    return { ax: f.pos[0] - ux[0] * f.w / 2, ay: f.pos[1] - ux[1] * f.w / 2, ux: ux[0], uy: ux[1], s0: 0, s1: f.w, h: f.d / 2 };
  }

  // 平面圖上的樓梯（多樓層用：樓梯上面那一層的樓板要開洞）
  function stairsOf(plan) {
    return (plan.furniture || []).filter(f => { const def = item(f.model); return !!def && !!def.stairs; });
  }

  return { CATALOG, CATS, TINTS, COLORS: C, item, footprint, contains, layered, hit, parts, solid, stairsOf, stairParts };
});
