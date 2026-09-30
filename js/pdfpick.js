// PDF 施工圖：載入 PDF、顯示整張圖紙讓使用者框選要辨識的那一層，再把框選範圍畫成圖片、取出向量線條。
// pdf.js 只在第一次開 PDF 時才下載。
(function (root) {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
  let loading = null;

  function loadLib() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PDFJS + 'pdf.min.js';
        s.onload = () => {
          root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
          resolve(root.pdfjsLib);
        };
        s.onerror = () => { loading = null; reject(new Error('無法載入 PDF 元件，請確認網路連線。')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  function open(file) {
    return loadLib().then(lib => file.arrayBuffer().then(buf => lib.getDocument({ data: new Uint8Array(buf) }).promise));
  }

  // 在 el 裡顯示整頁，拖曳框選範圍。rect 是頁面座標（pdf.js 縮放 1 時的單位，y 向下）
  function createPicker(el, opts) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '框選要辨識的平面圖範圍');
    el.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let pageImg = null, pageW = 0, pageH = 0, rect = null, drag = null;
    let view = { s: 1, ox: 0, oy: 0 };
    let renderId = 0;

    function layout() {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (pageW) {
        view.s = Math.min(cw / pageW, ch / pageH) * 0.96;
        view.ox = (cw - pageW * view.s) / 2;
        view.oy = (ch - pageH * view.s) / 2;
      }
      draw();
    }
    new ResizeObserver(layout).observe(el);

    function draw() {
      const cw = canvas.width, ch = canvas.height;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); ctx.restore();
      if (!pageImg) return;
      ctx.drawImage(pageImg, view.ox, view.oy, pageW * view.s, pageH * view.s);
      if (!rect) return;
      const x = view.ox + rect[0] * view.s, y = view.oy + rect[1] * view.s;
      const w = (rect[2] - rect[0]) * view.s, h = (rect[3] - rect[1]) * view.s;
      // 框外調暗，框線用強調色
      ctx.fillStyle = 'rgba(15,21,27,.35)';
      ctx.beginPath();
      ctx.rect(view.ox, view.oy, pageW * view.s, pageH * view.s);
      ctx.rect(x, y, w, h);
      ctx.fill('evenodd');
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1E5AA8';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }

    function toPage(e) {
      const r = canvas.getBoundingClientRect();
      const px = (e.clientX - r.left - view.ox) / view.s, py = (e.clientY - r.top - view.oy) / view.s;
      return [Math.max(0, Math.min(pageW, px)), Math.max(0, Math.min(pageH, py))];
    }

    canvas.addEventListener('pointerdown', e => {
      if (!pageImg || e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      drag = toPage(e);
      rect = null;
      draw();
      opts.onChange(null);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = toPage(e);
      rect = [Math.min(drag[0], p[0]), Math.min(drag[1], p[1]), Math.max(drag[0], p[0]), Math.max(drag[1], p[1])];
      draw();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      // 太小的框當作沒選（例如只是點一下）
      if (rect && (rect[2] - rect[0]) * view.s < 12 && (rect[3] - rect[1]) * view.s < 12) rect = null;
      draw();
      opts.onChange(rect);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // 顯示一頁：先畫成點陣圖，之後拖曳框選時只重畫框線
    function show(page) {
      const id = ++renderId;
      const vp1 = page.getViewport({ scale: 1 });
      pageW = vp1.width; pageH = vp1.height;
      rect = null;
      opts.onChange(null);
      const scale = Math.min(3, 2400 / Math.max(pageW, pageH));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: g, viewport: vp }).promise.then(() => {
        if (id !== renderId) return;
        pageImg = c;
        layout();
      });
    }

    return { show, layout, getRect: () => rect };
  }

  // 把頁面上的 rect 範圍畫成長邊 maxSide 像素的圖片，並取出範圍內的線段（換成這張圖片的像素座標）
  // 回傳 {canvas, lines, pxPerPt}
  function extract(page, rect, maxSide) {
    const lib = root.pdfjsLib;
    const w = rect[2] - rect[0], h = rect[3] - rect[1];
    const s = maxSide / Math.max(w, h);
    const vp = page.getViewport({ scale: s, offsetX: -rect[0] * s, offsetY: -rect[1] * s });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * s)); canvas.height = Math.max(1, Math.round(h * s));
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    return Promise.all([
      page.render({ canvasContext: g, viewport: vp }).promise,
      page.getOperatorList()
    ]).then(([, ol]) => {
      const lines = FPPdfLines.fromOperatorList(ol.fnArray, ol.argsArray, lib.OPS, vp.transform, [0, 0, canvas.width, canvas.height]);
      return { canvas, lines, pxPerPt: s };
    });
  }

  root.FPPdfPick = { open, createPicker, extract };
})(typeof self !== 'undefined' ? self : this);
