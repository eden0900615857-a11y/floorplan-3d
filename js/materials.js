// 材質清單：地板材質與牆面顏色的名稱與外觀。貼圖在瀏覽器裡用程式畫出來（不需要下載圖檔），
// size 是一張貼圖代表的實際尺寸（公尺），3D 會照這個尺寸重複鋪滿。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPMaterials = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const FLOORS = [
    { id: 'oak-light', name: '淺色木地板', size: 1.2, base: '#D9B98C', line: '#B89468' },
    { id: 'oak-dark', name: '深色木地板', size: 1.2, base: '#8A5F3C', line: '#6B452A' },
    { id: 'tile-white', name: '白色拋光石英磚', size: 1.2, base: '#EEEDE8', line: '#C9C6BD' },
    { id: 'tile-grey', name: '灰色磁磚', size: 1.2, base: '#A7A9AA', line: '#8B8D8E' },
    { id: 'cement', name: '水泥粉光', size: 2, base: '#B7B4AE', line: '#A29F99' },
    { id: 'marble', name: '白色大理石', size: 1.6, base: '#F2F0EC', line: '#BDB7AE' }
  ];
  const DEFAULT_FLOOR = 'oak-light';

  // 牆面油漆顏色（平面圖 JSON 的 materials.wall）
  const WALLS = [
    { id: 'paint-white', name: '白色', color: '#EEF1F4' },
    { id: 'paint-warm', name: '暖白', color: '#F1EADF' },
    { id: 'paint-greige', name: '奶茶灰', color: '#D8CFC4' },
    { id: 'paint-sage', name: '灰綠', color: '#C5CFBD' },
    { id: 'paint-blue', name: '霧藍', color: '#BFCBD6' },
    { id: 'paint-charcoal', name: '深灰', color: '#6F737A' }
  ];
  const DEFAULT_WALL = 'paint-white';

  function floor(id) {
    return FLOORS.find(f => f.id === id) || FLOORS.find(f => f.id === DEFAULT_FLOOR);
  }

  function wall(id) {
    return WALLS.find(w => w.id === id) || WALLS.find(w => w.id === DEFAULT_WALL);
  }

  // 固定亂數，讓同一種材質每次畫出來都一樣
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 在 2D canvas 上畫出一張可以無縫重複的貼圖（px × px）
  function draw(ctx, f, px) {
    const rand = rng(f.id.length * 7919 + f.id.charCodeAt(0));
    ctx.fillStyle = f.base;
    ctx.fillRect(0, 0, px, px);
    const k = px / f.size;   // 每公尺像素
    if (f.id.startsWith('oak')) {
      // 木地板：寬 20 公分的長條，錯縫排列，每片深淺略有不同
      const bw = 0.2 * k, len = f.size * k / 2;
      for (let row = 0; row * bw < px; row++) {
        const shift = (row % 2) * len / 2;
        for (let x = -shift; x < px; x += len) {
          ctx.globalAlpha = 0.04 + rand() * 0.08;
          ctx.fillStyle = rand() < 0.5 ? '#000' : '#fff';
          ctx.fillRect(x, row * bw, len, bw);
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = f.line;
          for (let g = 0; g < 5; g++) ctx.fillRect(x, row * bw + rand() * bw, len, 1);
          ctx.globalAlpha = 1;
          ctx.fillStyle = f.line;
          ctx.fillRect(x, row * bw, 1.5, bw);
        }
        ctx.fillStyle = f.line;
        ctx.fillRect(0, row * bw, px, 1.5);
      }
    } else if (f.id.startsWith('tile')) {
      // 磁磚：60 × 60 公分，細縫
      const t = 0.6 * k;
      for (let y = 0; y < px; y += t) {
        for (let x = 0; x < px; x += t) {
          ctx.globalAlpha = 0.04 + rand() * 0.05;
          ctx.fillStyle = rand() < 0.5 ? '#000' : '#fff';
          ctx.fillRect(x, y, t, t);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = f.line;
      for (let v = 0; v < px; v += t) { ctx.fillRect(v, 0, 2, px); ctx.fillRect(0, v, px, 2); }
    } else {
      // 水泥、大理石：不規則的斑點與紋路
      for (let i = 0; i < 900; i++) {
        ctx.globalAlpha = 0.05 + rand() * 0.08;
        ctx.fillStyle = rand() < 0.5 ? f.line : '#fff';
        const r = 1 + rand() * (f.id === 'cement' ? 6 : 3);
        ctx.beginPath(); ctx.arc(rand() * px, rand() * px, r, 0, Math.PI * 2); ctx.fill();
      }
      if (f.id === 'marble') {
        ctx.strokeStyle = f.line;
        for (let i = 0; i < 6; i++) {
          ctx.globalAlpha = 0.25 + rand() * 0.3;
          ctx.lineWidth = 0.8 + rand() * 1.5;
          ctx.beginPath();
          let x = rand() * px, y = 0;
          ctx.moveTo(x, y);
          while (y < px) { x += (rand() - 0.5) * px * 0.15; y += px * 0.06; ctx.lineTo(x, y); }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  return { FLOORS, DEFAULT_FLOOR, WALLS, DEFAULT_WALL, floor, wall, draw };
});
