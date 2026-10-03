// 家具庫：尺寸用常見的實際尺寸（公尺）。有 mesh 的家具在 3D 用 KayKit 的模型（js/models.js，CC0），
// 沒有模型的（廚具、衛浴等）或模型載入不到時，用 parts 的幾個方塊組成簡單造型。
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
    linen: '#E9E4DA', pillow: '#F7F5F0', black: '#2B2E33', steel: '#C9CDD1', ceramic: '#FAFAF8', green: '#6F8F5E'
  };
  // parts：[x0, x1, y0, y1, z0, z1, 顏色]，x、y 是寬、深的比例（y 0 是背面、1 是正面），z 是高度的比例
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
      [0, 1, 0, 1, 0, 0.36, 'white'], [0.47, 0.53, 0.3, 0.5, 0.36, 0.4, 'black'],
      [0.2, 0.8, 0.35, 0.45, 0.4, 1, 'black']] },
    { id: 'bed-double', mesh: 'bed_double_A', name: '雙人床', cat: '臥室', w: 1.52, d: 2.0, h: 1.0, parts: [
      [0, 1, 0.05, 1, 0, 0.3, 'wood'], [0.02, 0.98, 0.06, 0.99, 0.3, 0.52, 'linen'],
      [0, 1, 0, 0.05, 0, 1, 'wood'], [0.08, 0.46, 0.08, 0.2, 0.52, 0.62, 'pillow'],
      [0.54, 0.92, 0.08, 0.2, 0.52, 0.62, 'pillow']] },
    { id: 'bed-single', mesh: 'bed_single_A', name: '單人床', cat: '臥室', w: 0.95, d: 2.0, h: 1.0, parts: [
      [0, 1, 0.05, 1, 0, 0.3, 'wood'], [0.02, 0.98, 0.06, 0.99, 0.3, 0.52, 'linen'],
      [0, 1, 0, 0.05, 0, 1, 'wood'], [0.15, 0.85, 0.08, 0.2, 0.52, 0.62, 'pillow']] },
    { id: 'wardrobe', name: '衣櫃', cat: '臥室', w: 1.2, d: 0.6, h: 2.1, parts: [
      [0, 1, 0, 1, 0, 1, 'white'], [0.495, 0.505, 0.98, 1.01, 0.05, 0.97, 'steel'],
      [0.44, 0.46, 1, 1.05, 0.45, 0.55, 'steel'], [0.54, 0.56, 1, 1.05, 0.45, 0.55, 'steel']] },
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
      [0, 1, 0, 0.95, 0, 0.94, 'white'], [0, 1, 0, 1, 0.94, 1, 'steel'],
      [0.55, 0.75, 0.2, 0.8, 0.9, 0.97, 'black']] },
    { id: 'fridge', name: '冰箱', cat: '餐廚', w: 0.7, d: 0.7, h: 1.8, parts: [
      [0, 1, 0, 1, 0, 1, 'steel'], [0, 1, 0.99, 1.01, 0.62, 0.625, 'black'],
      [0.85, 0.9, 1, 1.05, 0.4, 0.58, 'black'], [0.85, 0.9, 1, 1.05, 0.66, 0.85, 'black']] },
    { id: 'toilet', name: '馬桶', cat: '衛浴', w: 0.4, d: 0.7, h: 0.8, parts: [
      [0.05, 0.95, 0, 0.25, 0, 1, 'ceramic'], [0.1, 0.9, 0.25, 1, 0, 0.5, 'ceramic']] },
    { id: 'basin', name: '洗手台', cat: '衛浴', w: 0.6, d: 0.45, h: 0.85, parts: [
      [0, 1, 0, 1, 0, 0.9, 'wood'], [0, 1, 0, 1, 0.9, 1, 'ceramic']] },
    { id: 'bathtub', name: '浴缸', cat: '衛浴', w: 1.5, d: 0.75, h: 0.55, parts: [
      [0, 1, 0, 0.1, 0, 1, 'ceramic'], [0, 1, 0.9, 1, 0, 1, 'ceramic'],
      [0, 0.07, 0.1, 0.9, 0, 1, 'ceramic'], [0.93, 1, 0.1, 0.9, 0, 1, 'ceramic'],
      [0.07, 0.93, 0.1, 0.9, 0, 0.25, 'ceramic']] },
    { id: 'shower', name: '淋浴間', cat: '衛浴', w: 0.9, d: 0.9, h: 2.0, parts: [
      [0, 1, 0, 1, 0, 0.04, 'ceramic'], [0.45, 0.55, 0, 0.06, 0.9, 0.95, 'steel']] },
    { id: 'rug', mesh: 'rug_rectangle_A', name: '地毯', cat: '客廳', w: 2.0, d: 1.4, h: 0.02, parts: [
      [0, 1, 0, 1, 0, 1, 'linen']] },
    { id: 'lamp-floor', mesh: 'lamp_standing', name: '落地燈', cat: '其他', w: 0.4, d: 0.4, h: 1.6, parts: [
      [0.3, 0.7, 0.3, 0.7, 0, 0.03, 'black'], [0.47, 0.53, 0.47, 0.53, 0.03, 0.8, 'black'], [0.1, 0.9, 0.1, 0.9, 0.8, 1, 'linen']] },
    { id: 'plant', mesh: 'cactus_medium_A', name: '盆栽', cat: '其他', w: 0.4, d: 0.4, h: 1.2, parts: [
      [0.2, 0.8, 0.2, 0.8, 0, 0.3, 'darkwood'], [0, 1, 0, 1, 0.3, 1, 'green']] }
  ];
  const CATS = ['客廳', '臥室', '餐廚', '衛浴', '其他'];

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

  // 點到的家具：後擺的在上面，優先選到
  function hit(plan, p, pad) {
    const list = plan.furniture || [];
    for (let i = list.length - 1; i >= 0; i--) if (contains(list[i], p, pad)) return list[i];
    return null;
  }

  // 3D 用的方塊：中心 (x, y) 在平面圖座標、寬 w 深 d、底 z0 頂 z1（公尺），rotation 同家具
  function parts(f) {
    const def = item(f.model);
    if (!def) return [];
    const h = f.h || def.h, { ux, fy } = axes(f);
    return def.parts.map(([x0, x1, y0, y1, z0, z1, c]) => {
      const sx = ((x0 + x1) / 2 - 0.5) * f.w, sy = ((y0 + y1) / 2 - 0.5) * f.d;
      return {
        x: f.pos[0] + ux[0] * sx + fy[0] * sy, y: f.pos[1] + ux[1] * sx + fy[1] * sy,
        w: (x1 - x0) * f.w, d: (y1 - y0) * f.d, z0: z0 * h, z1: z1 * h,
        rotation: f.rotation || 0, color: C[c] || c
      };
    });
  }

  // 漫遊時擋路的範圍（格式同 FPWalk.solids）：比腳踝高的家具才擋
  function solid(f) {
    const def = item(f.model);
    if (!def || (f.h || def.h) < 0.1 || def.id === 'shower') return null;
    const { ux } = axes(f);
    return { ax: f.pos[0] - ux[0] * f.w / 2, ay: f.pos[1] - ux[1] * f.w / 2, ux: ux[0], uy: ux[1], s0: 0, s1: f.w, h: f.d / 2 };
  }

  return { CATALOG, CATS, COLORS: C, item, footprint, contains, hit, parts, solid };
});
