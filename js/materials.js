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

  // 外牆材質（平面圖 JSON 的 materials.exterior，個別牆可以用 wall.ext 另外指定）：
  // 只套在牆朝屋外、朝陽台露台的那一面。沒選時外牆跟室內一樣用全屋牆面顏色。
  // kind：paint 塗料（素色加細微斑點）、strip 橫紋長條磚、stone 大塊石材、wood 直向木格柵、brick 紅磚、concrete 清水模
  const EXTERIORS = [
    { id: 'ext-white', name: '白色塗料', kind: 'paint', size: 2, base: '#F1F0EB', line: '#D9D7D0' },
    { id: 'ext-grey', name: '淺灰塗料', kind: 'paint', size: 2, base: '#C8C9C8', line: '#AFB0AF' },
    { id: 'ext-charcoal', name: '深灰塗料', kind: 'paint', size: 2, base: '#5D6165', line: '#4C5054' },
    { id: 'ext-strip', name: '灰色橫紋磚', kind: 'strip', size: 1.2, base: '#9C9E9D', line: '#7B7D7C' },
    { id: 'ext-stone', name: '灰色石材', kind: 'stone', size: 2.4, base: '#ABA9A3', line: '#8E8C86' },
    { id: 'ext-wood', name: '木格柵', kind: 'wood', size: 1.08, base: '#5A4030', line: '#A87A50' },
    { id: 'ext-brick', name: '紅磚', kind: 'brick', size: 1.68, base: '#9F523A', line: '#D8CFC2' },
    { id: 'ext-concrete', name: '清水模', kind: 'concrete', size: 3.6, base: '#B4B2AC', line: '#96948E' }
  ];

  function exterior(id) {
    return EXTERIORS.find(e => e.id === id) || null;
  }

  // 外牆貼圖（px × px，代表 e.size 公尺見方，可以無縫重複）
  function drawExterior(ctx, e, px) {
    const rand = rng(e.id.length * 104729 + e.id.charCodeAt(4));
    const k = px / e.size;
    ctx.fillStyle = e.base;
    ctx.fillRect(0, 0, px, px);
    const speckle = (n, rmax, alpha) => {
      for (let i = 0; i < n; i++) {
        ctx.globalAlpha = alpha * (0.5 + rand());
        ctx.fillStyle = rand() < 0.5 ? e.line : '#fff';
        ctx.beginPath(); ctx.arc(rand() * px, rand() * px, 0.5 + rand() * rmax, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const shade = (x, y, w, h, amt) => {
      ctx.globalAlpha = amt * rand();
      ctx.fillStyle = rand() < 0.5 ? '#000' : '#fff';
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    };
    if (e.kind === 'paint') {
      speckle(1400, 1.5, 0.05);
    } else if (e.kind === 'strip') {
      // 長條磚 60 × 7.5 公分，錯縫，細灰縫
      const bh = 0.075 * k, bw = 0.6 * k;
      for (let row = 0; row * bh < px; row++) {
        const shift = (row % 2) * bw / 2;
        for (let x = -shift; x < px; x += bw) shade(x, row * bh, bw, bh, 0.16);
        ctx.fillStyle = e.line;
        ctx.fillRect(0, row * bh, px, 2);
        for (let x = -shift; x < px; x += bw) ctx.fillRect(x, row * bh, 2, bh);
      }
      speckle(600, 1, 0.06);
    } else if (e.kind === 'stone') {
      // 石材 120 × 60 公分大板，每片深淺不同，帶細紋
      const bw = 1.2 * k, bh = 0.6 * k;
      for (let row = 0; row * bh < px; row++) {
        const shift = (row % 2) * bw / 2;
        for (let x = -shift; x < px; x += bw) shade(x, row * bh, bw, bh, 0.14);
        ctx.fillStyle = e.line;
        ctx.fillRect(0, row * bh, px, 3);
        for (let x = -shift; x < px; x += bw) ctx.fillRect(x, row * bh, 3, bh);
      }
      speckle(2200, 1.8, 0.07);
    } else if (e.kind === 'wood') {
      // 直向木格柵：寬 6 公分、間距 3 公分，後面是深色底
      const sw = 0.06 * k, gap = 0.03 * k;
      for (let x = 0; x < px; x += sw + gap) {
        ctx.fillStyle = e.line;
        ctx.fillRect(x, 0, sw, px);
        shade(x, 0, sw, px, 0.18);
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#5a3a22';
        for (let g = 0; g < 4; g++) ctx.fillRect(x + rand() * sw, 0, 1, px);
        ctx.globalAlpha = 1;
      }
    } else if (e.kind === 'brick') {
      // 紅磚 23 × 6 公分加 1 公分灰縫，順砌
      const bh = 0.07 * k, bw = 0.24 * k, m = 0.01 * k;
      ctx.fillStyle = e.line;
      ctx.fillRect(0, 0, px, px);
      for (let row = 0; row * bh < px; row++) {
        const shift = (row % 2) * bw / 2;
        for (let x = -shift; x < px; x += bw) {
          ctx.fillStyle = e.base;
          ctx.fillRect(x + m / 2, row * bh + m / 2, bw - m, bh - m);
          shade(x + m / 2, row * bh + m / 2, bw - m, bh - m, 0.22);
        }
      }
    } else if (e.kind === 'concrete') {
      // 清水模：180 × 90 公分模板分割線，每片四個繫結孔
      speckle(3000, 2.5, 0.05);
      const bw = 1.8 * k, bh = 0.9 * k;
      ctx.fillStyle = e.line;
      for (let y = 0; y < px; y += bh) ctx.fillRect(0, y, px, 1.5);
      for (let x = 0; x < px; x += bw) ctx.fillRect(x, 0, 1.5, px);
      ctx.fillStyle = '#7d7b76';
      for (let y = 0; y < px; y += bh) {
        for (let x = 0; x < px; x += bw) {
          for (const [fx, fy] of [[0.17, 0.25], [0.83, 0.25], [0.17, 0.75], [0.83, 0.75]]) {
            ctx.beginPath(); ctx.arc(x + bw * fx, y + bh * fy, Math.max(2, 0.012 * k), 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
  }

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

  return { FLOORS, DEFAULT_FLOOR, WALLS, DEFAULT_WALL, EXTERIORS, floor, wall, exterior, draw, drawExterior };
});
