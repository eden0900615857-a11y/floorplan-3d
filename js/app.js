// 介面串接：上傳圖片 → 偵測牆像素 → 向量化 → 平面圖 JSON → 2D 預覽、2D 校正與 3D 場景。
(function () {
  const $ = id => document.getElementById(id);
  const MAX_SIDE = 900;                          // 辨識用的工作解析度（長邊像素）
  const STORAGE_KEY = 'floorplan-3d:last-plan';
  const EDITED_KEY = 'floorplan-3d:edited';

  let src = null;      // 目前的原圖：{w, h, gray, canvas, dataURL}
  let plan = null;     // 目前的平面圖 JSON
  let edited = false;  // 使用者是否手動改過牆（改過就不會因為調整辨識設定而被覆蓋）
  let lastStats = {};  // 最近一次辨識的覆蓋率與時間
  let measured = 0;    // 比例尺工具量到的距離（公尺）

  const view3d = FPScene.create($('view'));
  const editor = FPEditor.create($('editCanvas'), {
    getWallHeight: () => +$('wallH').value,
    onCommit: () => { setEdited(true); syncPlanWidth(); refresh(); save(); },
    onSelect: sel => {
      const wall = sel && sel.kind === 'wall' ? sel.item : null;
      const op = sel && sel.kind === 'opening' ? sel.item : null;
      $('del').disabled = !sel;
      $('thickCtl').hidden = !!op;
      $('thick').disabled = !wall;
      $('thick').value = wall ? wall.thickness : '';
      $('openWCtl').hidden = !op;
      $('openW').value = op ? op.width : '';
      $('flip').hidden = !(op && op.type === 'door');
    },
    onMiss: () => { $('toolHint').textContent = '門窗要加在牆上，請點在藍色的牆上。'; },
    onHistory: h => { $('undo').disabled = !h.canUndo; $('redo').disabled = !h.canRedo; },
    onTool: t => {
      document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
      $('toolHint').textContent = TOOL_HINTS[t];
      if (t !== 'scale') $('scaleForm').hidden = true;
    },
    onScaleMeasured: d => {
      measured = d || 0;
      $('scaleForm').hidden = !d;
      if (!d) return;
      $('scaleMeasured').textContent = d.toFixed(2) + ' m';
      $('scaleLen').value = d.toFixed(2);
      $('scaleLen').focus();
      $('scaleLen').select();
    }
  });

  const TOOL_HINTS = {
    select: '點選牆後可以拖曳移動，拖曳兩端的方塊可以調整長度；門窗可以沿著牆拖曳。Delete 刪除，Ctrl+Z 復原。拖曳空白處平移，滾輪縮放。',
    wall: '在圖上拖曳畫出新牆。接近水平或垂直時會自動拉直（按住 Alt 可畫斜牆），靠近其他牆的端點會自動接上。',
    door: '點在牆上加一扇門（寬 0.9 公尺）。加好後可以拖曳沿牆移動、修改寬度，或按「換開門方向」。',
    window: '點在牆上加一扇窗（寬 1.2 公尺，窗台高 0.9 公尺）。加好後可以拖曳沿牆移動、修改寬度。',
    scale: '在圖上點兩個點，例如尺寸標註的兩端，再輸入這段的實際長度，整張圖會照比例縮放。'
  };

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

  function setEdited(v) {
    edited = v;
    if (!v) $('redetectBox').hidden = true;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
      localStorage.setItem(EDITED_KEY, edited ? '1' : '');
    } catch (e) { /* 空間不足或瀏覽器不允許時略過 */ }
  }

  function planWidth(p) {
    const bb = FPPlan.bounds(p);
    return bb.maxX - bb.minX;
  }

  function syncPlanWidth() {
    if (plan) $('planW').value = +planWidth(plan).toFixed(2);
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
    const ppm = src.w / planW;
    // 門窗：只看牆以外的細線（門弧、窗線），缺口寬度限制在 0.5–2.5 公尺
    const ink = new Uint8Array(mask.raw.length);
    for (let i = 0; i < ink.length; i++) ink[i] = mask.raw[i] & (1 - mask.walls[i]);
    const ops = FPOpenings.detect(vec.segments, ink, src.w, src.h, { minGap: 0.5 * ppm, maxGap: 2.5 * ppm });
    const p = FPPlan.fromSegments(ops.segments, {
      widthPx: src.w, heightPx: src.h,
      pxPerMeter: ppm,
      wallHeight: +$('wallH').value,
      image: src.dataURL
    }, ops.openings);
    setEdited(false);
    setPlan(p, { coverage: vec.coverage, ms: performance.now() - t0 });
    save();
  }

  // 換成一份新的平面圖（辨識結果或開啟的檔案）：2D 編輯器重新開始、復原紀錄清空
  function setPlan(p, stats) {
    plan = p;
    lastStats = stats || {};
    editor.setPlan(p, src ? src.canvas : null);
    refresh();
  }

  // 平面圖內容改變後，更新預覽、3D 與數據
  function refresh() {
    const image = src ? src.canvas : null;
    drawPreview(plan, image);
    view3d.setPlan(plan, image);
    const bb = FPPlan.bounds(plan);
    const total = plan.walls.reduce((sum, w) => sum + FPPlan.wallLength(w), 0);
    $('sSize').textContent = (bb.maxX - bb.minX).toFixed(1) + ' × ' + (bb.maxY - bb.minY).toFixed(1) + ' m';
    $('sWalls').textContent = plan.walls.length + ' 段';
    $('sLength').textContent = total.toFixed(1) + ' m';
    const ops = plan.openings || [];
    $('sOpen').textContent = ops.filter(o => o.type === 'door').length + ' / ' + ops.filter(o => o.type === 'window').length;
    // 手動修改後，覆蓋率就不再代表目前的牆
    $('sCover').textContent = !edited && lastStats.coverage != null ? Math.round(lastStats.coverage * 100) + '%' : '–';
    $('sTime').textContent = lastStats.ms != null ? lastStats.ms.toFixed(0) + ' ms' : '–';
  }

  // 側欄的小預覽：原圖淡化當底，上面畫出牆（藍色）與門窗符號
  function drawPreview(p, image) {
    const cv = $('preview'), g = cv.getContext('2d');
    const bb = FPPlan.bounds(p);
    const ppm = p.source && p.source.pxPerMeter ? p.source.pxPerMeter : MAX_SIDE / Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    cv.width = image ? image.width : Math.max(1, Math.round((bb.maxX - bb.minX) * ppm));
    cv.height = image ? image.height : Math.max(1, Math.round((bb.maxY - bb.minY) * ppm));
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    if (image) { g.globalAlpha = 0.3; g.drawImage(image, 0, 0); g.globalAlpha = 1; }
    g.save();
    g.scale(ppm, ppm);
    g.translate(-bb.minX, -bb.minY);
    const px = 1 / ppm;
    for (const w of p.walls) {
      const L = FPPlan.wallLength(w);
      if (!L) continue;
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      const at = d => [w.a[0] + ux * d, w.a[1] + uy * d];
      const spans = FPPlan.openingSpans(w, FPPlan.openingsOf(p, w.id));
      const solid = [];
      let cur = 0;
      for (const sp of spans) { if (sp.s0 > cur) solid.push([cur, sp.s0]); cur = Math.max(cur, sp.s1); }
      if (cur < L) solid.push([cur, L]);
      g.strokeStyle = 'rgba(30,90,168,.85)';
      g.lineWidth = w.thickness;
      g.lineCap = 'butt';
      for (const [s0, s1] of solid) { const a = at(s0), b = at(s1); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      g.strokeStyle = '#0B2A52';
      g.lineWidth = 1.5 * px;
      for (const sp of spans) {
        const o = sp.o;
        if (o.type === 'window') {
          const off = w.thickness / 4, a = at(sp.s0), b = at(sp.s1);
          g.beginPath();
          g.moveTo(a[0] - uy * off, a[1] + ux * off); g.lineTo(b[0] - uy * off, b[1] + ux * off);
          g.moveTo(a[0] + uy * off, a[1] - ux * off); g.lineTo(b[0] + uy * off, b[1] - ux * off);
          g.stroke();
        } else {
          const h = at(o.hinge === 'b' ? sp.s1 : sp.s0), j = at(o.hinge === 'b' ? sp.s0 : sp.s1);
          const side = o.swing === 'right' ? -1 : 1, nx = uy * side, ny = -ux * side, r = sp.s1 - sp.s0;
          const a0 = Math.atan2(j[1] - h[1], j[0] - h[0]), a1 = Math.atan2(ny, nx);
          let d = a1 - a0;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d <= -Math.PI) d += 2 * Math.PI;
          g.beginPath(); g.arc(h[0], h[1], r, a0, a1, d < 0); g.lineTo(h[0], h[1]); g.stroke();
        }
      }
    }
    g.restore();
  }

  // 開啟平面圖 JSON（檔案或上次自動保存的結果）
  function openPlan(p, message, wasEdited) {
    const errors = FPPlan.validate(p);
    if (errors.length) { note('無法開啟：' + errors.slice(0, 3).join('；'), true); return false; }
    const finish = () => {
      if (p.walls.length) { $('wallH').value = p.walls[0].height; syncOutputs(); }
      setEdited(wasEdited);
      setPlan(p, null);
      syncPlanWidth();
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
    let p = null, wasEdited = false;
    try {
      p = JSON.parse(localStorage.getItem(STORAGE_KEY));
      wasEdited = localStorage.getItem(EDITED_KEY) === '1';
    } catch (e) { return false; }
    return !!p && openPlan(p, '已載入上次的結果。', wasEdited);
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
      // 檔案裡的牆可能已經手動修改過，當作已修改，避免被重新辨識蓋掉
      openPlan(p, '已開啟 ' + file.name + '。', true);
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

  // 辨識設定：還沒手動修改就直接重新辨識；改過的話先詢問
  let timer = 0;
  ['thr', 'minT', 'autoThr', 'invert'].forEach(id => $(id).addEventListener('input', () => {
    syncOutputs();
    if (edited) { $('redetectBox').hidden = false; return; }
    clearTimeout(timer);
    timer = setTimeout(detect, 60);
  }));
  $('redetect').addEventListener('click', () => { if (src) detect(); else note('這份平面圖沒有原圖，無法重新辨識。', true); });

  // 圖面寬度：等比例縮放目前的平面圖（可以復原），不重新辨識
  $('planW').addEventListener('change', () => {
    const w = +$('planW').value;
    if (!plan || !(w > 0)) return;
    editor.rescale(w / planWidth(plan));
  });

  // 牆高：套用到所有牆
  $('wallH').addEventListener('input', () => {
    syncOutputs();
    if (!plan) return;
    const H = +$('wallH').value;
    plan.walls.forEach(w => { w.height = H; });
    refresh();
    save();
  });

  // 3D / 2D 分頁
  function showTab(which) {
    const is2d = which === '2d';
    $('tab3d').setAttribute('aria-selected', String(!is2d));
    $('tab2d').setAttribute('aria-selected', String(is2d));
    $('view').hidden = is2d;
    $('editor').hidden = !is2d;
    if (is2d) requestAnimationFrame(() => editor.redraw());
  }
  $('tab3d').addEventListener('click', () => showTab('3d'));
  $('tab2d').addEventListener('click', () => showTab('2d'));

  // 2D 校正工具列
  document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => editor.setTool(b.dataset.tool)));
  $('undo').addEventListener('click', () => editor.undo());
  $('redo').addEventListener('click', () => editor.redo());
  $('del').addEventListener('click', () => editor.deleteSelected());
  $('fit').addEventListener('click', () => editor.fit());
  $('thick').addEventListener('change', () => editor.setThickness(+$('thick').value));
  $('openW').addEventListener('change', () => editor.setOpeningWidth(+$('openW').value));
  $('flip').addEventListener('click', () => editor.flipDoor());
  $('scaleForm').addEventListener('submit', e => {
    e.preventDefault();
    const k = FPEdit.scaleFactor(measured, +$('scaleLen').value);
    if (!k) return;
    editor.rescale(k);
    $('scaleForm').hidden = true;
    editor.setTool('select');
    $('toolHint').textContent = '已套用比例：圖面寬度現在是 ' + planWidth(plan).toFixed(2) + ' 公尺。';
  });
  $('scaleCancel').addEventListener('click', () => editor.cancel());

  $('file').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
  $('openJson').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
  $('download').addEventListener('click', downloadPlan);
  $('sample').addEventListener('click', loadSample);
  $('resetCam').addEventListener('click', () => view3d.resetCamera());

  const stage = $('stage');
  let dragDepth = 0;
  stage.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  stage.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; openFile(e.dataTransfer.files[0]); });

  syncOutputs();
  $('toolHint').textContent = TOOL_HINTS.select;
  const start = () => { if (!restore()) loadSample(); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
})();
