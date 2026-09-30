// 介面串接：上傳圖片 → 偵測牆像素 → 向量化 → 平面圖 JSON → 2D 預覽、2D 校正與 3D 場景。
// PDF 施工圖則是框選範圍 → 讀取向量線條 → 成對平行線找牆 → 平面圖 JSON。
(function () {
  const $ = id => document.getElementById(id);
  const MAX_SIDE = 900;                          // 辨識用的工作解析度（長邊像素）
  const STORAGE_KEY = 'floorplan-3d:last-plan';
  const EDITED_KEY = 'floorplan-3d:edited';

  let src = null;      // 目前的原圖：{w, h, gray, canvas, dataURL}；PDF 另有 vector: {lines, ppm}，fromPdf 表示原圖來自 PDF
  let pdf = null;      // 目前開啟的 PDF：{doc, page}
  let plan = null;     // 目前的平面圖 JSON
  let edited = false;  // 使用者是否手動改過牆（改過就不會因為調整辨識設定而被覆蓋）
  let lastStats = {};  // 最近一次辨識的覆蓋率與時間
  let measured = 0;    // 比例尺工具量到的距離（公尺）

  const view3d = FPScene.create($('view'));
  const editor = FPEditor.create($('editCanvas'), {
    getWallHeight: () => +$('wallH').value,
    onCommit: () => { setEdited(true); syncPlanWidth(); updateRooms(); refresh(); save(); },
    onSelect: sel => {
      const wall = sel && sel.kind === 'wall' ? sel.item : null;
      const op = sel && sel.kind === 'opening' ? sel.item : null;
      const room = sel && sel.kind === 'room' ? sel.item : null;
      const furn = sel && sel.kind === 'furniture' ? sel.item : null;
      $('del').disabled = !(wall || op || furn);
      $('thickCtl').hidden = !!(op || room || furn);
      $('furnCtl').hidden = !furn;
      if (furn) {
        $('furnName').textContent = FPFurniture.item(furn.model) ? FPFurniture.item(furn.model).name : furn.model;
        $('furnW').value = furn.w; $('furnD').value = furn.d;
      }
      $('roomCtl').hidden = !room;
      if (room) { $('roomName').value = room.name; $('roomFloor').value = FPMaterials.floor(room.floor).id; }
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
      $('furnPick').hidden = t !== 'furniture';
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
    select: '點選牆後可以拖曳移動，拖曳兩端的方塊可以調整長度；門窗可以沿著牆拖曳；家具可以拖曳，按 R 旋轉；點選房間可以改名。Delete 刪除，Ctrl+Z 復原。拖曳空白處平移，滾輪縮放。',
    wall: '在圖上拖曳畫出新牆。接近水平或垂直時會自動拉直（按住 Alt 可畫斜牆），靠近其他牆的端點會自動接上。',
    door: '點在牆上加一扇門（寬 0.9 公尺）。加好後可以拖曳沿牆移動、修改寬度，或按「換開門方向」。',
    window: '點在牆上加一扇窗（寬 1.2 公尺，窗台高 0.9 公尺）。加好後可以拖曳沿牆移動、修改寬度。',
    furniture: '選好家具種類，在圖上點一下放下，按住不放可以直接拖到想要的位置。粗線那一邊是家具的正面。選取家具後按 R 旋轉 90 度。',
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
    if (src.vector) return detectVector();
    if (src.fromPdf) { note('這份平面圖來自 PDF，要重新辨識請重新上傳 PDF。', true); return; }
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

  // PDF：兩條平行細線是牆、開門弧是門、牆裡的細線是窗
  function detectVector() {
    const t0 = performance.now();
    const { lines, ppm } = src.vector;
    const ex = FPLineWalls.extract(lines, { ppm });
    const d = FPLineWalls.findDoors(ex.segments, lines, { ppm });
    const wins = FPLineWalls.findWindows(d.segments, ex.axis, { ppm });
    const p = FPPlan.fromSegments(d.segments, {
      widthPx: src.w, heightPx: src.h,
      pxPerMeter: ppm,
      wallHeight: +$('wallH').value,
      image: src.dataURL
    }, d.doors.concat(wins));
    p.source.from = 'pdf';
    p.rooms = FPRooms.assign(FPRooms.detect(p), []);
    FPLineWalls.dropIndoorWindows(p);
    setEdited(false);
    setPlan(p, { coverage: null, ms: performance.now() - t0 });
    syncPlanWidth();
    save();
  }

  // 辨識設定：圖片才有門檻等設定，PDF 直接讀線條
  function syncSourceKind() {
    const isPdf = !!(src && (src.vector || src.fromPdf));
    $('rasterCtl').hidden = isPdf;
    $('pdfNote').hidden = !isPdf;
  }

  // 依目前的牆重新找出房間，保留原本的房名
  function updateRooms() {
    plan.rooms = FPRooms.assign(FPRooms.detect(plan), plan.rooms);
  }

  // 換成一份新的平面圖（辨識結果或開啟的檔案）：2D 編輯器重新開始、復原紀錄清空
  function setPlan(p, stats) {
    plan = p;
    updateRooms();
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
    const rooms = (plan.rooms || []).slice().sort((a, b) => b.area - a.area);
    const totalArea = rooms.reduce((sum, r) => sum + r.area, 0);
    $('sArea').textContent = totalArea.toFixed(1) + ' m² · ' + FPRooms.toPing(totalArea).toFixed(1) + ' 坪';
    const list = $('roomList');
    list.textContent = '';
    for (const r of rooms) {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.textContent = r.name;
      const m2 = document.createElement('span'); m2.className = 'num'; m2.textContent = r.area.toFixed(1) + ' m²';
      const ping = document.createElement('span'); ping.className = 'ping'; ping.textContent = FPRooms.toPing(r.area).toFixed(1) + ' 坪';
      const floor = floorSelect(FPMaterials.floor(r.floor).id);
      floor.setAttribute('aria-label', r.name + '的地板');
      floor.addEventListener('change', () => editor.setRoomFloor(floor.value, r.id));
      li.append(name, m2, ping, floor);
      list.appendChild(li);
    }
    if (!rooms.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '還沒有封閉的房間。檢查外牆是否都有接起來。';
      list.appendChild(li);
    }
    $('furnCount').textContent = (plan.furniture || []).length;
    $('wallPaint').value = FPMaterials.wall(plan.materials && plan.materials.wall).id;
    // 手動修改後，覆蓋率就不再代表目前的牆
    $('sCover').textContent = !edited && lastStats.coverage != null ? Math.round(lastStats.coverage * 100) + '%' : '–';
    $('sTime').textContent = lastStats.ms != null ? lastStats.ms.toFixed(0) + ' ms' : '–';
  }

  function floorSelect(value) {
    const sel = document.createElement('select');
    for (const f of FPMaterials.FLOORS) {
      const o = document.createElement('option');
      o.value = f.id; o.textContent = f.name;
      sel.appendChild(o);
    }
    sel.value = value;
    return sel;
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
      img.onload = () => { loadSource(img); src.fromPdf = p.source.from === 'pdf'; syncSourceKind(); finish(); };
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
    img.onload = () => { loadSource(img); syncSourceKind(); URL.revokeObjectURL(url); detect(); view3d.resetCamera(); note(''); };
    img.onerror = () => { URL.revokeObjectURL(url); note('無法讀取這張圖片，請改用 JPG 或 PNG。', true); };
    img.src = url;
  }

  function openFile(file) {
    if (!file) return;
    if (file.type === 'application/json' || /\.json$/i.test(file.name)) openJsonFile(file);
    else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) openPdfFile(file);
    else if (file.type.startsWith('image/')) openImageFile(file);
    else note('不支援這種檔案，請上傳 JPG、PNG、PDF 或 JSON。', true);
  }

  // PDF：先顯示整張圖紙，讓使用者框選要辨識的那一層
  const picker = FPPdfPick.createPicker($('pickCanvas'), {
    onChange: r => { $('pickGo').disabled = !r; }
  });

  function openPdfFile(file) {
    note('正在讀取 PDF…');
    FPPdfPick.open(file).then(doc => {
      pdf = { doc, page: null };
      const sel = $('pdfPage');
      sel.textContent = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const o = document.createElement('option');
        o.value = i; o.textContent = i + ' / ' + doc.numPages;
        sel.appendChild(o);
      }
      $('pageCtl').hidden = doc.numPages < 2;
      $('tabPick').hidden = false;
      showTab('pick');
      note('');
      return showPdfPage(1);
    }).catch(err => note('無法讀取這個 PDF：' + (err && err.message ? err.message : err), true));
  }

  function showPdfPage(n) {
    return pdf.doc.getPage(n).then(page => { pdf.page = page; return picker.show(page); });
  }

  function pickDetect() {
    const rect = picker.getRect(), scale = +$('pdfScale').value;
    if (!pdf || !pdf.page || !rect || !(scale > 0)) return;
    $('pickGo').disabled = true;
    $('pickHint').textContent = '正在辨識…';
    FPPdfPick.extract(pdf.page, rect, MAX_SIDE).then(res => {
      loadSource(res.canvas);
      // 圖紙上 1 公尺 = 1000 / 比例 公釐 = 1000 / 比例 / 25.4 × 72 點
      src.vector = { lines: res.lines, ppm: res.pxPerPt * 72000 / (25.4 * scale) };
      src.fromPdf = true;
      syncSourceKind();
      detect();
      view3d.resetCamera();
      showTab('3d');
      const doors = plan.openings.filter(o => o.type === 'door').length;
      note('辨識出 ' + plan.walls.length + ' 段牆、' + doors + ' 扇門、' + (plan.openings.length - doors) + ' 扇窗、' + plan.rooms.length + ' 個房間。到「2D 校正」可以修正。');
    }).catch(err => note('辨識失敗：' + (err && err.message ? err.message : err), true))
      .then(() => {
        $('pickGo').disabled = !picker.getRect();
        $('pickHint').textContent = PICK_HINT;
      });
  }
  const PICK_HINT = $('pickHint').textContent;

  function loadSample() {
    $('planW').value = 13.6; $('minT').value = 5; $('invert').checked = false; $('autoThr').checked = true;
    syncOutputs();
    loadSource(FPSample.draw());
    syncSourceKind();
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
    const panels = { '3d': ['tab3d', 'view'], '2d': ['tab2d', 'editor'], pick: ['tabPick', 'pick'] };
    for (const k in panels) {
      $(panels[k][0]).setAttribute('aria-selected', String(k === which));
      $(panels[k][1]).hidden = k !== which;
    }
    if (which === '2d') requestAnimationFrame(() => editor.redraw());
    if (which === 'pick') requestAnimationFrame(() => picker.layout());
  }
  $('tab3d').addEventListener('click', () => showTab('3d'));
  $('tab2d').addEventListener('click', () => showTab('2d'));
  $('tabPick').addEventListener('click', () => showTab('pick'));
  $('pdfPage').addEventListener('change', () => showPdfPage(+$('pdfPage').value));
  $('pickGo').addEventListener('click', pickDetect);

  // 2D 校正工具列
  document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => editor.setTool(b.dataset.tool)));
  $('undo').addEventListener('click', () => editor.undo());
  $('redo').addEventListener('click', () => editor.redo());
  $('del').addEventListener('click', () => editor.deleteSelected());
  $('fit').addEventListener('click', () => editor.fit());
  $('thick').addEventListener('change', () => editor.setThickness(+$('thick').value));
  $('openW').addEventListener('change', () => editor.setOpeningWidth(+$('openW').value));
  $('flip').addEventListener('click', () => editor.flipDoor());
  $('roomName').addEventListener('change', () => editor.renameRoom($('roomName').value));
  for (const f of FPMaterials.FLOORS) {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = f.name;
    $('roomFloor').appendChild(o);
  }
  $('roomFloor').addEventListener('change', () => editor.setRoomFloor($('roomFloor').value));

  // 家具：依分類列出家具庫
  for (const cat of FPFurniture.CATS) {
    const g = document.createElement('optgroup');
    g.label = cat;
    for (const it of FPFurniture.CATALOG.filter(c => c.cat === cat)) {
      const o = document.createElement('option');
      o.value = it.id; o.textContent = it.name + '（' + Math.round(it.w * 100) + '×' + Math.round(it.d * 100) + '）';
      g.appendChild(o);
    }
    $('furnModel').appendChild(g);
  }
  $('furnModel').addEventListener('change', () => editor.setPlaceModel($('furnModel').value));
  editor.setPlaceModel($('furnModel').value);
  $('furnRot').addEventListener('click', () => editor.rotateFurniture(90));
  const setFurnSize = () => editor.setFurnitureSize(+$('furnW').value, +$('furnD').value);
  $('furnW').addEventListener('change', setFurnSize);
  $('furnD').addEventListener('change', setFurnSize);

  // 牆面顏色
  for (const w of FPMaterials.WALLS) {
    const o = document.createElement('option');
    o.value = w.id; o.textContent = w.name;
    $('wallPaint').appendChild(o);
  }
  $('wallPaint').addEventListener('change', () => editor.setWallPaint($('wallPaint').value));

  // 第一人稱漫遊：鍵盤 WASD／方向鍵，或畫面上的按鈕（手機）
  const VIEW_TAG = $('viewTag').textContent;
  function setWalk(on) {
    if (on && !plan) return;
    view3d.setWalk(on);
    $('walk').setAttribute('aria-pressed', String(on));
    $('walk').textContent = on ? '離開漫遊' : '走進房子';
    $('walkPad').hidden = !on;
    $('view').classList.toggle('walking', on);
    $('viewTag').textContent = on ? '拖曳轉頭 · W A S D 或方向鍵移動 · Shift 加速 · Esc 離開' : VIEW_TAG;
  }
  $('walk').addEventListener('click', () => setWalk(!view3d.walking));
  const KEYS = {
    KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', KeyD: 'right', ArrowLeft: 'turnLeft', ArrowRight: 'turnRight',
    ShiftLeft: 'fast', ShiftRight: 'fast'
  };
  const typing = e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  window.addEventListener('keydown', e => {
    if (!view3d.walking || $('view').hidden || typing(e)) return;
    if (e.code === 'Escape') { setWalk(false); return; }
    const k = KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    view3d.setInput(k, true);
  });
  window.addEventListener('keyup', e => { const k = KEYS[e.code]; if (k) view3d.setInput(k, false); });
  window.addEventListener('blur', () => Object.values(KEYS).forEach(k => view3d.setInput(k, false)));
  $('walkPad').querySelectorAll('button').forEach(b => {
    const k = b.dataset.key;
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); view3d.setInput(k, true); });
    const up = () => view3d.setInput(k, false);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  });
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
  $('resetCam').addEventListener('click', () => { if (view3d.walking) setWalk(false); else view3d.resetCamera(); });

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
