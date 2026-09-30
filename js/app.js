// 介面串接：上傳圖片 → 偵測牆像素 → 向量化 → 平面圖 JSON → 2D 預覽與 3D 場景。
(function () {
  const $ = id => document.getElementById(id);
  const MAX_SIDE = 900;                          // 辨識用的工作解析度（長邊像素）
  const STORAGE_KEY = 'floorplan-3d:last-plan';

  let src = null;    // 目前的原圖：{w, h, gray, canvas, dataURL}
  let plan = null;   // 目前的平面圖 JSON
  const view3d = FPScene.create($('view'));

  function loadSource(imgOrCanvas) {
    const iw = imgOrCanvas.naturalWidth || imgOrCanvas.width;
    const ih = imgOrCanvas.naturalHeight || imgOrCanvas.height;
    const s = Math.min(1, MAX_SIDE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.drawImage(imgOrCanvas, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
    src = { w, h, gray, canvas: c, dataURL: c.toDataURL('image/jpeg', 0.85) };
  }

  function note(msg, isError) {
    const el = $('fileNote');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plan)); } catch (e) { /* 空間不足或瀏覽器不允許時略過 */ }
  }

  function detect() {
    if (!src) return;
    const t0 = performance.now();
    const minThickness = +$('minT').value;
    const mask = FPDetect.wallMask(src.gray, src.w, src.h, {
      threshold: $('autoThr').checked ? 'auto' : +$('thr').value,
      invert: $('invert').checked,
      minThickness
    });
    $('thr').value = mask.threshold;
    $('thrOut').textContent = mask.threshold;
    const vec = FPVectorize.extractWalls(mask.walls, src.w, src.h, { minThickness });
    const planW = Math.max(1, +$('planW').value || 12);
    const p = FPPlan.fromSegments(vec.segments, {
      widthPx: src.w, heightPx: src.h,
      pxPerMeter: src.w / planW,
      wallHeight: +$('wallH').value,
      image: src.dataURL
    });
    show(p, { coverage: vec.coverage, ms: performance.now() - t0 });
    save();
  }

  function show(p, extra) {
    plan = p;
    const image = src ? src.canvas : null;
    drawPreview(p, image);
    view3d.setPlan(p, image);
    const bb = FPPlan.bounds(p);
    const total = p.walls.reduce((sum, w) => sum + FPPlan.wallLength(w), 0);
    $('sSize').textContent = (bb.maxX - bb.minX).toFixed(1) + ' × ' + (bb.maxY - bb.minY).toFixed(1) + ' m';
    $('sWalls').textContent = p.walls.length + ' 段';
    $('sLength').textContent = total.toFixed(1) + ' m';
    $('sCover').textContent = extra && extra.coverage != null ? Math.round(extra.coverage * 100) + '%' : '–';
    $('sTime').textContent = extra && extra.ms != null ? extra.ms.toFixed(0) + ' ms' : '–';
  }

  // 2D 預覽：原圖淡化當底，上面畫出向量化後的牆（藍色）與中心線、端點
  function drawPreview(p, image) {
    const cv = $('preview'), g = cv.getContext('2d');
    const bb = FPPlan.bounds(p);
    const ppm = p.source && p.source.pxPerMeter ? p.source.pxPerMeter : MAX_SIDE / Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    cv.width = image ? image.width : Math.round((bb.maxX - bb.minX) * ppm);
    cv.height = image ? image.height : Math.round((bb.maxY - bb.minY) * ppm);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    if (image) { g.globalAlpha = 0.3; g.drawImage(image, 0, 0); g.globalAlpha = 1; }
    g.save();
    g.scale(ppm, ppm);
    g.translate(-bb.minX, -bb.minY);
    for (const w of p.walls) {
      const len = FPPlan.wallLength(w);
      g.save();
      g.translate((w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2);
      g.rotate(Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]));
      g.fillStyle = 'rgba(30,90,168,.85)';
      g.fillRect(-len / 2, -w.thickness / 2, len, w.thickness);
      g.restore();
    }
    g.strokeStyle = '#0B2A52';
    g.fillStyle = '#0B2A52';
    g.lineWidth = 1 / ppm;
    for (const w of p.walls) {
      g.beginPath(); g.moveTo(w.a[0], w.a[1]); g.lineTo(w.b[0], w.b[1]); g.stroke();
      for (const pt of [w.a, w.b]) { g.beginPath(); g.arc(pt[0], pt[1], 2.5 / ppm, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }

  // 開啟平面圖 JSON（檔案或上次自動保存的結果）
  function openPlan(p, message) {
    const errors = FPPlan.validate(p);
    if (errors.length) { note('無法開啟：' + errors.slice(0, 3).join('；'), true); return false; }
    const finish = () => {
      if (p.source && p.source.widthPx && p.source.pxPerMeter) $('planW').value = +(p.source.widthPx / p.source.pxPerMeter).toFixed(2);
      if (p.walls.length) { $('wallH').value = p.walls[0].height; syncOutputs(); }
      show(p, null);
      view3d.resetCamera();
      save();
      note(message);
    };
    if (p.source && p.source.image) {
      const img = new Image();
      img.onload = () => { loadSource(img); finish(); };
      img.onerror = () => { src = null; finish(); };
      img.src = p.source.image;
    } else {
      src = null;
      finish();
    }
    return true;
  }

  function restore() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return false; }
    return !!p && openPlan(p, '已載入上次的結果。');
  }

  function downloadPlan() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'floorplan.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    note('已下載 floorplan.json。');
  }

  function openJsonFile(file) {
    file.text().then(text => {
      let p;
      try { p = JSON.parse(text); } catch (e) { note('無法開啟：檔案不是有效的 JSON。', true); return; }
      openPlan(p, '已開啟 ' + file.name + '。');
    });
  }

  function openImageFile(file) {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { loadSource(img); URL.revokeObjectURL(url); detect(); view3d.resetCamera(); note(''); };
    img.onerror = () => { URL.revokeObjectURL(url); note('無法讀取這張圖片，請改用 JPG 或 PNG。', true); };
    img.src = url;
  }

  function openFile(file) {
    if (!file) return;
    if (file.type === 'application/json' || /\.json$/i.test(file.name)) openJsonFile(file);
    else if (file.type.startsWith('image/')) openImageFile(file);
    else note('不支援這種檔案，請上傳 JPG、PNG 或 JSON。', true);
  }

  function loadSample() {
    $('planW').value = 13.6; $('minT').value = 5; $('invert').checked = false; $('autoThr').checked = true;
    syncOutputs();
    loadSource(FPSample.draw());
    detect();
    view3d.resetCamera();
    note('');
  }

  function syncOutputs() {
    $('minTOut').textContent = $('minT').value + ' px';
    $('wallHOut').textContent = (+$('wallH').value).toFixed(1) + ' m';
    $('thr').disabled = $('autoThr').checked;
    $('thrOut').textContent = $('thr').value;
  }

  let timer = 0;
  const detectSoon = () => { clearTimeout(timer); timer = setTimeout(detect, 60); };
  ['thr', 'minT', 'planW', 'autoThr', 'invert'].forEach(id => $(id).addEventListener('input', () => { syncOutputs(); detectSoon(); }));
  // 牆高只改 JSON，不需要重新辨識
  $('wallH').addEventListener('input', () => {
    syncOutputs();
    if (!plan) return;
    const H = +$('wallH').value;
    plan.walls.forEach(w => { w.height = H; });
    show(plan, null);
    save();
  });

  $('file').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
  $('openJson').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
  $('download').addEventListener('click', downloadPlan);
  $('sample').addEventListener('click', loadSample);
  $('resetCam').addEventListener('click', () => view3d.resetCamera());

  const view = $('view');
  let dragDepth = 0;
  view.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  view.addEventListener('dragover', e => e.preventDefault());
  view.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  view.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; openFile(e.dataTransfer.files[0]); });

  syncOutputs();
  const start = () => { if (!restore()) loadSample(); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
})();
