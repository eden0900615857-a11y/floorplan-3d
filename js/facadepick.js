// 外觀圖：顯示上傳的外觀照片或效果圖，拖曳四個角對到那一面牆的四個角，再拉正成立面圖（FPFacade.warp）。
(function (root) {
  const LABELS = ['左上', '右上', '右下', '左下'];

  // 在 el 裡顯示圖片和四個可以拖曳的角。角的座標是圖片像素
  function createPicker(el, opts) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '拖曳四個角，對到牆面的四個角');
    el.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let img = null, quad = null, drag = -1;
    const view = { s: 1, ox: 0, oy: 0 };

    function layout() {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (img) {
        view.s = Math.min(cw / img.width, ch / img.height) * 0.92;
        view.ox = (cw - img.width * view.s) / 2;
        view.oy = (ch - img.height * view.s) / 2;
      }
      draw();
    }
    new ResizeObserver(layout).observe(el);

    const toScreen = p => [view.ox + p[0] * view.s, view.oy + p[1] * view.s];

    function draw() {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
      if (!img) return;
      ctx.drawImage(img, view.ox, view.oy, img.width * view.s, img.height * view.s);
      const pts = quad.map(toScreen);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1E5AA8';
      // 範圍外調暗
      ctx.fillStyle = 'rgba(15,21,27,.35)';
      ctx.beginPath();
      ctx.rect(view.ox, view.oy, img.width * view.s, img.height * view.s);
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fill('evenodd');
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
      ctx.font = '12px sans-serif';
      ctx.textBaseline = 'middle';
      pts.forEach((p, i) => {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
        // 標籤放在框外側
        const lx = p[0] + (i === 0 || i === 3 ? -14 : 14), ly = p[1] + (i < 2 ? -14 : 14);
        ctx.textAlign = i === 0 || i === 3 ? 'right' : 'left';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.strokeText(LABELS[i], lx, ly);
        ctx.fillStyle = '#0f151b';
        ctx.fillText(LABELS[i], lx, ly);
      });
    }

    function toImage(e) {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left - view.ox) / view.s, y = (e.clientY - r.top - view.oy) / view.s;
      return [Math.max(0, Math.min(img.width, x)), Math.max(0, Math.min(img.height, y))];
    }

    canvas.addEventListener('pointerdown', e => {
      if (!img || e.button !== 0) return;
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = -1, bd = 24;
      quad.forEach((p, i) => {
        const s = toScreen(p), d = Math.hypot(s[0] - mx, s[1] - my);
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) return;
      drag = best;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!img) return;
      if (drag < 0) {
        const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        canvas.style.cursor = quad.some(p => { const s = toScreen(p); return Math.hypot(s[0] - mx, s[1] - my) < 24; }) ? 'grab' : 'default';
        return;
      }
      quad[drag] = toImage(e);
      draw();
    });
    const end = () => { if (drag >= 0) { drag = -1; if (opts && opts.onChange) opts.onChange(quad); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // 顯示新圖片，四個角先放在往內縮 15% 的位置
    function show(image) {
      img = image;
      const w = img.width, h = img.height;
      quad = [[w * 0.15, h * 0.15], [w * 0.85, h * 0.15], [w * 0.85, h * 0.85], [w * 0.15, h * 0.85]];
      layout();
    }

    return { show, layout, getQuad: () => quad && quad.map(p => p.slice()), get image() { return img; } };
  }

  // 把圖片裡的四邊形拉正成 W × H，回傳 JPEG data URL。來源先縮到長邊 maxSide 以內，比較快
  function rectify(image, quad, W, H, maxSide) {
    const k = Math.min(1, (maxSide || 2400) / Math.max(image.width, image.height));
    const sw = Math.max(1, Math.round(image.width * k)), sh = Math.max(1, Math.round(image.height * k));
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const g = c.getContext('2d');
    g.drawImage(image, 0, 0, sw, sh);
    const src = g.getImageData(0, 0, sw, sh);
    const data = FPFacade.warp(src, quad.map(p => [p[0] * k, p[1] * k]), W, H);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
    return out.toDataURL('image/jpeg', 0.85);
  }

  root.FPFacadePick = { createPicker, rectify };
})(typeof self !== 'undefined' ? self : this);
