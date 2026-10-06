// 介面串接：上傳圖片 → 偵測牆像素 → 向量化 → 平面圖 JSON → 2D 預覽、2D 校正與 3D 場景。
// PDF 施工圖則是框選範圍 → 讀取向量線條 → 成對平行線找牆 → 平面圖 JSON。
(function () {
  const $ = id => document.getElementById(id);
  const MAX_SIDE = 900;                          // 辨識用的工作解析度（長邊像素）
  const STORAGE_KEY = 'floorplan-3d:last-plan';   // 舊版只存一份平面圖：第一次開啟時搬進專案
  const EDITED_KEY = 'floorplan-3d:edited';
  const AI_KEY = 'floorplan-3d:ai';               // 使用者有沒有打開 AI 辨識
  const LIGHT_KEY = 'floorplan-3d:light';         // 3D 的光線：白天、傍晚、夜晚

  let src = null;      // 目前的原圖：{w, h, gray, canvas, dataURL}；PDF 另有 vector: {lines, ppm}，fromPdf 表示原圖來自 PDF
  let pdf = null;      // 目前開啟的 PDF：{doc, page}
  let plan = null;     // 目前的平面圖 JSON（目前樓層）
  let building = null; // 整棟房子：{floors: [{id, name, offset, plan}], active}，plan 就是 floors[active].plan
  let pendingFloor = false; // 按了「新增樓層」：下一份辨識結果變成新的一層，不建立新專案
  let edited = false;  // 使用者是否手動改過牆（改過就不會因為調整辨識設定而被覆蓋）
  let lastStats = {};  // 最近一次辨識的覆蓋率與時間
  let measured = 0;    // 比例尺工具量到的距離（公尺）
  let viewing = false; // 正在看別人分享的連結：只能瀏覽，不寫入這台電腦的自動保存
  const SITE_URL = 'https://eden0900615857-a11y.github.io/floorplan-3d/';  // 從電腦直接開檔案時，分享連結改指向網站

  const view3d = FPScene.create($('view'));
  if (matchMedia('(pointer: coarse)').matches) $('viewTag').textContent = '單指拖曳旋轉 · 雙指縮放、平移';
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
        syncFurnColor(furn.color || '');
      }
      $('roomCtl').hidden = !room;
      if (room) { $('roomName').value = room.name; $('roomFloor').value = FPMaterials.floor(room.floor).id; $('roomPaint').value = room.paint || ''; }
      $('thick').disabled = !wall;
      $('thick').value = wall ? wall.thickness : '';
      $('wallKindCtl').hidden = !wall;
      if (wall) $('wallKind').value = wall.kind || '';
      $('wallExtCtl').hidden = !wall;
      if (wall) $('wallExt').value = wall.ext || '';
      const win = op && op.type === 'window' ? op : null;
      $('winCtl').hidden = !win;
      if (win) {
        $('winSill').value = win.sill; $('winH').value = win.height;
        const k = FPPlan.WINDOW_KINDS.find(k => Math.abs(k.sill - win.sill) < 0.005 && Math.abs(k.height - win.height) < 0.005);
        $('winKind').value = k ? k.id : '';
      }
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
    select: '點選牆後可以拖曳移動，拖曳兩端的方塊可以調整長度；門窗可以沿著牆拖曳；家具可以拖曳，按 R 旋轉，也可以換顏色；點選牆可以改成陽台的矮牆或玻璃欄杆；點選窗可以選一般窗、高窗、落地窗或自訂窗台高度；點選房間可以改名。Delete 刪除，Ctrl+Z 復原。拖曳空白處平移，滾輪縮放。',
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
    // gray 是一般灰階；cgray 是彩色格局圖用的灰階（有顏色的地方當作白色）；blue 是淺藍色的窗
    const cg = FPDetect.colorGray(d, w, h);
    src = { w, h, gray: cg.plain, cgray: cg.gray, colorful: cg.colorful, blue: FPDetect.blueInk(d, w, h), canvas: c, dataURL: c.toDataURL('image/jpeg', 0.85) };
  }

  function note(msg, isError) {
    const el = $(viewing ? 'viewerNote' : 'fileNote');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function setEdited(v) {
    edited = v;
    if (!v) $('redetectBox').hidden = true;
  }

  // 專案：每張上傳的平面圖一個專案。上傳新檔案時先記下名字，下一次存檔時建立新專案
  let projects = null, pendingProject = null;
  function newProject(name, id) { if (!pendingFloor) pendingProject = { name, id }; }
  function save() {
    if (plan) FPSchemes.sync(plan);
    if (building && building.floors[building.active]) building.floors[building.active].edited = edited;
    if (viewing || !projects || !plan || !building) return;
    const data = FPBuilding.toJSON(building);
    let done;
    if (pendingProject || !projects.current) {
      const pp = pendingProject || { name: '我的房子' };
      pendingProject = null;
      done = projects.create(pp.name, data, edited, pp.id).done;
      syncProjects();
    } else {
      done = projects.save(data, edited);
    }
    done.catch(() => note('存檔失敗：瀏覽器的儲存空間可能不夠了，請刪除不用的專案，或先用「下載 JSON」備份。', true));
  }

  function syncProjects() {
    if (!projects) return;
    const sel = $('project'), list = projects.list();
    sel.textContent = '';
    for (const e of list) {
      const o = document.createElement('option');
      o.value = e.id; o.textContent = e.name;
      sel.appendChild(o);
    }
    sel.value = projects.current || '';
    const cur = projects.get(projects.current);
    if (document.activeElement !== $('projectName')) $('projectName').value = cur ? cur.name : '';
    $('projectDel').disabled = !cur;
  }

  async function openProject(id) {
    const p = await projects.open(id);
    if (!p) { note('找不到這個專案。', true); syncProjects(); return false; }
    syncProjects();
    return openBuilding(p.plan, '已開啟「' + p.name + '」。', p.edited);
  }

  // 開啟平面圖或整棟房子的 JSON：整棟房子先記下來，再開啟目前樓層
  function openBuilding(v, message, wasEdited) {
    const errors = FPBuilding.validate(v);
    if (errors.length) { note('無法開啟：' + errors.slice(0, 3).join('；'), true); return false; }
    pendingFloor = false;
    building = FPBuilding.wrap(v);
    const f = building.floors[building.active];
    return openPlan(f.plan, message, f.edited != null ? f.edited : wasEdited);
  }

  // 樓層選單（側欄與 3D 畫面上各一個）
  function syncFloors() {
    const floors = building ? building.floors : [];
    for (const id of ['floor', 'floorQuick']) {
      const sel = $(id);
      sel.textContent = '';
      floors.forEach((f, i) => {
        const o = document.createElement('option');
        o.value = i; o.textContent = f.name;
        sel.appendChild(o);
      });
      sel.value = building ? building.active : '';
    }
    $('floorQuick').hidden = floors.length < 2;
    const f = building && building.floors[building.active];
    if (document.activeElement !== $('floorName')) $('floorName').value = f ? f.name : '';
    $('floorDel').disabled = floors.length < 2;
    $('floorAlign').hidden = !building || building.active === 0;
    if (f) { $('floorDX').value = f.offset[0]; $('floorDY').value = f.offset[1]; }
    $('floorAdd').textContent = pendingFloor ? '取消新增樓層' : '新增樓層';
  }

  // 3D 要畫的其他樓層：平常只畫下面的樓層，按「看整棟」連上面的樓層也畫
  let wholeHouse = false;
  function syncContext() {
    const many = !!building && building.floors.length > 1;
    $('wholeHouse').hidden = !many;
    $('wholeHouse').setAttribute('aria-pressed', many && wholeHouse ? 'true' : 'false');
    view3d.setContext(building ? FPBuilding.context(building, building.active, many && wholeHouse) : []);
  }

  // 漫遊走樓梯上下樓：換到上面或下面那一層，人的位置換成那一層的座標，繼續漫遊
  let walkShift = null;
  view3d.onFloor = d => {
    const i = building ? building.active + d : -1;
    if (!building || !building.floors[i]) { note(d > 0 ? '上面沒有樓層了，可以先「新增樓層」。' : ''); return false; }
    const a = building.floors[building.active].offset, b = building.floors[i].offset;
    walkShift = [a[0] - b[0], a[1] - b[1]];
    switchFloor(i);
    return true;
  };

  function switchFloor(i) {
    if (!building || !building.floors[i] || i === building.active) return;
    save();
    building.active = i;
    const f = building.floors[i];
    openPlan(f.plan, '目前在「' + f.name + '」。', f.edited != null ? f.edited : true);
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
    // AI 辨識：模型還沒跑完時先顯示規則辨識的結果，跑完會再辨識一次
    const ai = $('aiMode').checked && FPML.available();
    if (ai && !src.ml) runAI(src);
    const ml = ai ? src.ml : null;
    const minThickness = +$('minT').value;
    const color = $('colorMode').checked;
    const mask = FPDetect.wallMask(color ? src.cgray : src.gray, src.w, src.h, {
      threshold: $('autoThr').checked ? 'auto' : +$('thr').value,
      invert: $('invert').checked,
      minThickness
    });
    $('thr').value = mask.threshold;
    $('thrOut').textContent = mask.threshold;
    // 牆、門窗、外牆：每公尺 ppm 像素（門窗缺口的寬度範圍、接牆距離都依比例換算）
    const build = ppm => {
      // 牆：AI 辨識用模型找到的牆像素，否則用黑白門檻找到的粗線
      const vec = ml ? FPML.walls(ml, src.w, src.h, ppm) : FPVectorize.extractWalls(mask.walls, src.w, src.h, { minThickness });
      const walls = ml ? vec.mask : mask.walls;
      // 圖片裁到外牆時，沿著圖片邊緣補牆（AI 辨識在 FPML.walls 裡已經補過）
      const closed = ml ? vec : FPVectorize.closeBorder(vec.segments, src.w, src.h);
      // 門窗：只看牆以外的細線（門弧、窗線），缺口寬度限制在 0.5–2.5 公尺
      const ink = new Uint8Array(mask.raw.length);
      for (let i = 0; i < ink.length; i++) ink[i] = (mask.raw[i] | (color ? src.blue[i] : 0)) & (1 - (mask.walls[i] | walls[i]));
      // AI 辨識時，規則找不到開門弧或窗線的缺口，再問模型是不是門窗
      const ops = FPOpenings.detect(closed.segments, ink, src.w, src.h, {
        minGap: 0.5 * ppm, maxGap: 2.5 * ppm, hint: ml ? FPML.openingHint(ml, src.w, src.h) : null
      });
      // 外牆沒畫完整（圖片裁掉、陽台只有細欄杆線）的地方，把牆沿著外緣延伸接起來，讓房間封閉
      FPVectorize.closeOuter(ops.segments, src.w, src.h, { tol: 0.25 * ppm, reach: 0.5 * ppm, maxLen: 6 * ppm });
      return { vec, ops };
    };
    let ppm = src.w / Math.max(1, +$('planW').value || 12);
    let { vec, ops } = build(ppm);
    // 新上傳的圖片：用門寬推算比例（AI 辨識要等模型跑完，用模型的結果推算）
    if (src.autoScale && (!ai || ml)) {
      src.autoScale = false;
      const est = FPOpenings.scaleFromDoors(ops.openings);
      if (est) {
        if (Math.abs(est / ppm - 1) > 0.03) { ppm = est; ({ vec, ops } = build(ppm)); }
        $('planW').value = +(src.w / ppm).toFixed(1);
        src.scaleMsg = '已依門寬（約 ' + FPOpenings.DOOR_WIDTH * 100 + ' 公分）推算比例，圖面寬約 ' + (src.w / ppm).toFixed(1) +
          ' 公尺。有已知尺寸的話，請到「2D 校正」用比例尺確認。';
        if (!ai) note(src.scaleMsg);
      }
    }
    const p = FPPlan.fromSegments(ops.segments, {
      widthPx: src.w, heightPx: src.h,
      pxPerMeter: ppm,
      wallHeight: +$('wallH').value,
      image: src.dataURL
    }, ops.openings);
    // AI 辨識也看得出房間種類，幫房間取名字（臥室、浴室…）
    if (ml) p.rooms = FPML.nameRooms(FPRooms.assign(FPRooms.detect(p), []), ml, ppm, src.w);
    setEdited(false);
    setPlan(p, { coverage: vec.coverage, ms: performance.now() - t0 });
    save();
  }

  // 在背景跑 AI 模型；跑完時圖片沒換、牆也沒手動改過，就用模型的結果重新辨識
  function runAI(s) {
    if (s.mlPending) return;
    s.mlPending = true;
    note('AI 辨識中…');
    FPML.run(s.canvas, f => { if (src === s) note('正在下載 AI 模型（第一次使用才需要）… ' + Math.round(f * 100) + '%'); })
      .then(ml => {
        s.ml = ml;
        if (src !== s || !$('aiMode').checked) return;
        if (edited) {
          $('redetectBox').hidden = false;
          note('AI 辨識完成。你已經改過牆，要套用請按「重新辨識」。');
          return;
        }
        detect();
        const doors = plan.openings.filter(o => o.type === 'door').length;
        note('AI 辨識出 ' + plan.walls.length + ' 段牆、' + doors + ' 扇門、' + (plan.openings.length - doors) + ' 扇窗、' + plan.rooms.length + ' 個房間。' +
          (s.scaleMsg || '到「2D 校正」可以修正。'));
      })
      .catch(err => { if (src === s) note('AI 辨識失敗：' + (err && err.message ? err.message : err) + ' 目前顯示的是一般辨識的結果。', true); })
      .then(() => { s.mlPending = false; });
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
    // 整棟房子：已經是其中一層就切過去；按了「新增樓層」就加在最上面；新專案重新開始；否則取代目前樓層
    const idx = building ? building.floors.findIndex(f => f.plan === p) : -1;
    if (idx >= 0) building.active = idx;
    else if (pendingFloor && building) {
      pendingFloor = false;
      const f = FPBuilding.addFloor(building, p);
      note('已新增「' + f.name + '」，位置對齊下面那一層的外牆，可以在左側「樓層」微調。');
    } else if (pendingProject || !building) building = FPBuilding.wrap(p);
    else building.floors[building.active].plan = p;
    plan = p;
    updateRooms();
    FPSchemes.ensure(plan);
    lastStats = stats || {};
    editor.setPlan(p, src ? src.canvas : null);
    refresh();
  }

  // 平面圖內容改變後，更新預覽、3D 與數據
  function refresh() {
    const image = src ? src.canvas : null;
    drawPreview(plan, image);
    view3d.setHoles(building ? FPBuilding.stairsBelow(building) : []);
    // 2D：下面那一層的牆和樓梯洞當參考
    const low = building ? FPBuilding.below(building)[0] : null;
    editor.setUnderlay(low ? {
      walls: low.plan.walls.map(w => ({ a: [w.a[0] + low.dx, w.a[1] + low.dy], b: [w.b[0] + low.dx, w.b[1] + low.dy], thickness: w.thickness })),
      holes: FPBuilding.stairHoles(building)
    } : null);
    view3d.setPlan(plan, image);
    if (walkShift) { view3d.shiftWalk(walkShift[0], walkShift[1]); walkShift = null; }
    syncContext();
    syncFloors();
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
      floor.disabled = viewing;
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
    syncSchemes();
    showQuantities();
    $('wallPaint').value = FPMaterials.wall(plan.materials && plan.materials.wall).id;
    $('extMat').value = (plan.materials && FPMaterials.exterior(plan.materials.exterior) && plan.materials.exterior) || '';
    syncFacades();
    // 手動修改後，覆蓋率就不再代表目前的牆
    $('sCover').textContent = !edited && lastStats.coverage != null ? Math.round(lastStats.coverage * 100) + '%' : '–';
    $('sTime').textContent = lastStats.ms != null ? lastStats.ms.toFixed(0) + ' ms' : '–';
  }

  // 裝修方案選單（側欄與 3D 畫面上各一個）
  function syncSchemes() {
    FPSchemes.ensure(plan);
    for (const id of ['scheme', 'schemeQuick']) {
      const sel = $(id);
      sel.textContent = '';
      for (const s of plan.schemes) {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        sel.appendChild(o);
      }
      sel.value = plan.activeScheme;
    }
    $('schemeQuick').hidden = plan.schemes.length < 2;
    if (document.activeElement !== $('schemeName')) $('schemeName').value = FPSchemes.active(plan).name;
    $('schemeDel').disabled = plan.schemes.length < 2;
  }

  function showQuantities() {
    const q = FPQuantities.estimate(plan), dl = $('qty');
    dl.textContent = '';
    const row = (k, v) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k; dd.textContent = v;
      dl.append(dt, dd);
    };
    for (const f of q.floors) row(f.name, f.area.toFixed(1) + ' m²（叫料 ' + f.order.toFixed(1) + '）');
    for (const p of q.paints) row('牆面油漆（' + p.name + '）', p.area.toFixed(1) + ' m² · 約 ' + p.liters + ' 公升');
    row('家具', q.furniture.length ? q.furniture.map(f => f.name + (f.count > 1 ? ' ×' + f.count : '')).join('、') : '還沒有擺家具');
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
      if (wholeHouse && building && building.floors.length > 1) view3d.viewWhole(); else view3d.resetCamera();
      save();
      note(message);
    };
    if (p.source && p.source.image) {
      const img = new Image();
      img.onload = () => { loadSource(img); src.autoScale = true; autoColorMode(); src.fromPdf = p.source.from === 'pdf'; syncSourceKind(); finish(); };
      img.onerror = () => { src = null; finish(); };
      img.src = p.source.image;
    } else {
      src = null;
      finish();
    }
    return true;
  }

  // 開啟上次的專案；舊版存在 localStorage 的平面圖搬成第一個專案
  async function initProjects() {
    if (!projects) {
      let backend;
      try { backend = await FPProjects.idbBackend('floorplan-3d'); } catch (e) { backend = FPProjects.memoryBackend(); }
      projects = FPProjects.createStore(backend);
      try { await projects.init(); } catch (e) { projects = FPProjects.createStore(FPProjects.memoryBackend()); await projects.init(); }
      let old = null, oldEdited = false;
      try { old = JSON.parse(localStorage.getItem(STORAGE_KEY)); oldEdited = localStorage.getItem(EDITED_KEY) === '1'; } catch (e) { /* 略過 */ }
      if (old && !projects.list().length && !FPPlan.validate(old).length) {
        // 確定寫進專案之後才刪掉舊的那份
        const ok = await projects.create('我的房子', old, oldEdited).done.then(() => true, () => false);
        if (ok && projects.persistent) {
          try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(EDITED_KEY); } catch (e) { /* 略過 */ }
        }
      }
      syncProjects();
    }
  }
  async function restore() {
    await initProjects();
    const id = projects.current || (projects.list()[0] || {}).id;
    return !!id && openProject(id);
  }

  function downloadPlan() {
    if (!plan) return;
    FPSchemes.sync(plan);
    const blob = new Blob([JSON.stringify(building ? FPBuilding.toJSON(building) : plan, null, 2)], { type: 'application/json' });
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
      pendingFloor = false;   // JSON 一律開成新專案（裡面可能已經有好幾層）
      newProject(file.name.replace(/\.json$/i, ''));
      if (!openBuilding(p, '已開啟 ' + file.name + '。', true)) pendingProject = null;
    });
  }

  function openImageFile(file) {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { loadSource(img); src.autoScale = true; autoColorMode(); syncSourceKind(); URL.revokeObjectURL(url); note(''); newProject(file.name.replace(/\.[^.]+$/, '')); detect(); view3d.resetCamera(); };
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
      pdf = { doc, page: null, name: file.name.replace(/\.pdf$/i, '') };
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
      newProject(pdf.name);
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

  // 新的圖片：明顯帶顏色的像素超過 1% 就當作彩色格局圖（黑白圖打開也沒有影響）
  function autoColorMode() {
    $('colorMode').checked = !!src && src.colorful > 0.01;
  }

  function loadSample(color) {
    pendingFloor = false;
    $('planW').value = 13.6; $('minT').value = 5; $('invert').checked = false; $('autoThr').checked = true;
    syncOutputs();
    loadSource(color === true ? FPSample.drawColor() : FPSample.draw());
    autoColorMode();
    syncSourceKind();
    note('');
    // 範例固定放在同一個「範例」專案，重新載入是覆蓋
    newProject('範例', 'sample');
    detect();
    view3d.resetCamera();
  }

  function syncOutputs() {
    $('minTOut').textContent = $('minT').value + ' px';
    $('wallHOut').textContent = (+$('wallH').value).toFixed(1) + ' m';
    $('thr').disabled = $('autoThr').checked;
    $('thrOut').textContent = $('thr').value;
  }

  // 辨識設定：還沒手動修改就直接重新辨識；改過的話先詢問
  let timer = 0;
  // AI 辨識：記住使用者的選擇；直接用檔案打開網頁時不能下載模型
  try { $('aiMode').checked = localStorage.getItem(AI_KEY) === '1'; } catch (e) { /* 不允許時略過 */ }
  $('aiMode').addEventListener('input', () => {
    try { localStorage.setItem(AI_KEY, $('aiMode').checked ? '1' : ''); } catch (e) { /* 不允許時略過 */ }
    if ($('aiMode').checked && !FPML.available()) note('AI 辨識要從網站開啟（' + SITE_URL + '），直接打開檔案時無法下載模型。', true);
    else if (!$('aiMode').checked) note('');
  });
  ['thr', 'minT', 'autoThr', 'invert', 'colorMode', 'aiMode'].forEach(id => $(id).addEventListener('input', () => {
    syncOutputs();
    if (edited) { $('redetectBox').hidden = false; return; }
    clearTimeout(timer);
    timer = setTimeout(detect, 60);
  }));
  $('redetect').addEventListener('click', () => { if (src) detect(); else note('這份平面圖沒有原圖，無法重新辨識。', true); });

  // 圖面寬度：等比例縮放目前的平面圖（可以復原），不重新辨識
  $('planW').addEventListener('change', () => {
    const w = +$('planW').value;
    if (src) src.autoScale = false;   // 使用者自己填了寬度，不再自動推算
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
    const panels = { '3d': ['tab3d', 'view'], '2d': ['tab2d', 'editor'], pick: ['tabPick', 'pick'], facade: ['tabFacade', 'facade'] };
    for (const k in panels) {
      $(panels[k][0]).setAttribute('aria-selected', String(k === which));
      $(panels[k][1]).hidden = k !== which;
    }
    if (which === '2d') requestAnimationFrame(() => editor.redraw());
    if (which === 'pick') requestAnimationFrame(() => picker.layout());
    if (which === 'facade') requestAnimationFrame(() => facadePicker.layout());
  }
  $('tab3d').addEventListener('click', () => showTab('3d'));
  $('tab2d').addEventListener('click', () => showTab('2d'));
  $('tabPick').addEventListener('click', () => showTab('pick'));
  $('tabFacade').addEventListener('click', () => showTab('facade'));

  // 外觀圖：拉正後存在這一層平面圖的 facades（所有方案共用，不進復原紀錄）
  const facadePicker = FPFacadePick.createPicker($('facadeCanvas'));
  for (const sd of FPFacade.SIDES) {
    const o = document.createElement('option');
    o.value = sd.id; o.textContent = sd.name;
    $('facadeSide').appendChild(o);
  }
  function syncFacades() {
    const list = $('facadeList');
    list.textContent = '';
    for (const f of (plan && plan.facades) || []) {
      const item = document.createElement('span');
      item.setAttribute('role', 'listitem');
      const sd = FPFacade.side(f.side);
      item.textContent = sd ? sd.name.split('（')[0] : f.side;
      const del = document.createElement('button');
      del.type = 'button'; del.textContent = '移除';
      del.setAttribute('aria-label', '移除' + item.textContent + '的外觀圖');
      del.addEventListener('click', () => {
        plan.facades = plan.facades.filter(x => x !== f);
        if (!plan.facades.length) delete plan.facades;
        refresh();
        save();
      });
      item.appendChild(del);
      list.appendChild(item);
    }
  }
  $('facadeOpen').addEventListener('click', () => $('facadeFile').click());
  $('facadeFile').addEventListener('change', () => {
    const file = $('facadeFile').files[0];
    $('facadeFile').value = '';
    if (!file) return;
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      facadePicker.show(img);
      $('facadeApply').disabled = false;
    };
    img.onerror = () => { URL.revokeObjectURL(url); note('無法讀取這張圖片，請改用 JPG 或 PNG。', true); };
    img.src = url;
  });
  $('facadeApply').addEventListener('click', () => {
    const side = $('facadeSide').value, ext = plan && FPFacade.extent(plan, side);
    if (!ext || !facadePicker.image) return;
    // 立面圖的長寬比照這一面的實際尺寸，寬 1024 像素
    const W = 1024, H = Math.max(64, Math.min(2048, Math.round(W * ext.h / Math.max(0.5, ext.u1 - ext.u0))));
    const image = FPFacadePick.rectify(facadePicker.image, facadePicker.getQuad(), W, H);
    plan.facades = ((plan.facades || []).filter(f => f.side !== side)).concat({ id: 'fa' + Date.now().toString(36), side, image });
    refresh();
    save();
    note('已把外觀圖貼到' + FPFacade.side(side).name.split('（')[0] + '。切到「3D 檢視」從外面看看；對不準就調整四個角再按一次。');
  });
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
  // 牆的種類（陽台的矮牆、玻璃欄杆）與窗的種類、窗台高、窗高
  for (const k of FPPlan.WALL_KINDS) {
    const o = document.createElement('option');
    o.value = k.id; o.textContent = k.name;
    $('wallKind').appendChild(o);
  }
  $('wallKind').addEventListener('change', () => editor.setWallKind($('wallKind').value));
  for (const k of [...FPPlan.WINDOW_KINDS, { id: '', name: '自訂' }]) {
    const o = document.createElement('option');
    o.value = k.id; o.textContent = k.name;
    $('winKind').appendChild(o);
  }
  $('winKind').addEventListener('change', () => {
    const k = FPPlan.WINDOW_KINDS.find(k => k.id === $('winKind').value);
    if (k) editor.setWindowSize(k.sill, k.height);
  });
  const winSize = () => editor.setWindowSize(+$('winSill').value, +$('winH').value);
  $('winSill').addEventListener('change', winSize);
  $('winH').addEventListener('change', winSize);
  $('roomName').addEventListener('change', () => editor.renameRoom($('roomName').value));
  for (const f of FPMaterials.FLOORS) {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = f.name;
    $('roomFloor').appendChild(o);
  }
  $('roomFloor').addEventListener('change', () => editor.setRoomFloor($('roomFloor').value));
  // 房間牆色：第一項是跟全屋一樣
  for (const w of [{ id: '', name: '跟全屋一樣' }, ...FPMaterials.WALLS]) {
    const o = document.createElement('option');
    o.value = w.id; o.textContent = w.name;
    $('roomPaint').appendChild(o);
  }
  $('roomPaint').addEventListener('change', () => editor.setRoomPaint($('roomPaint').value));

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
  // 家具顏色：第一個是原本的顏色，其他是 FPFurniture.TINTS
  for (const t of [{ id: '', name: '原本的顏色' }].concat(FPFurniture.TINTS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (t.id ? '' : ' original');
    b.dataset.color = t.id;
    b.title = t.name;
    b.setAttribute('aria-label', t.name);
    if (t.id) b.style.background = t.id;
    b.addEventListener('click', () => { editor.setFurnitureColor(t.id); syncFurnColor(t.id); });
    $('furnColors').appendChild(b);
  }
  function syncFurnColor(c) {
    $('furnColors').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === c)));
  }
  const setFurnSize = () => editor.setFurnitureSize(+$('furnW').value, +$('furnD').value);
  $('furnW').addEventListener('change', setFurnSize);
  $('furnD').addEventListener('change', setFurnSize);

  // 裝修方案
  const switchScheme = id => editor.schemeOp(p => (p.activeScheme === id ? false : !!FPSchemes.switchTo(p, id)));
  $('scheme').addEventListener('change', () => switchScheme($('scheme').value));
  $('schemeQuick').addEventListener('change', () => switchScheme($('schemeQuick').value));

  // 光線：只影響 3D 的顯示，記在瀏覽器裡
  try { $('lightMode').value = localStorage.getItem(LIGHT_KEY) || 'day'; } catch (e) { /* 不允許時略過 */ }
  if (!$('lightMode').value) $('lightMode').value = 'day';
  view3d.setLight($('lightMode').value);
  $('lightMode').addEventListener('change', () => {
    view3d.setLight($('lightMode').value);
    try { localStorage.setItem(LIGHT_KEY, $('lightMode').value); } catch (e) { /* 不允許時略過 */ }
  });
  $('schemeCopy').addEventListener('click', () => editor.schemeOp(p => { FPSchemes.add(p, false); }));
  $('schemeBlank').addEventListener('click', () => editor.schemeOp(p => { FPSchemes.add(p, true); }));
  $('schemeName').addEventListener('change', () => editor.schemeOp(p => {
    const s = FPSchemes.active(p), name = $('schemeName').value.trim();
    if (!name || name === s.name) return false;
    FPSchemes.rename(p, s.id, name);
  }));
  $('schemeDel').addEventListener('click', () => {
    const s = plan && FPSchemes.active(plan);
    if (!s || plan.schemes.length < 2) return;
    if (!confirm('要刪除「' + s.name + '」嗎？（可以用 2D 校正的「復原」救回來）')) return;
    editor.schemeOp(p => FPSchemes.remove(p, s.id));
  });

  // 匯出目前 3D 畫面
  $('shot').addEventListener('click', () => {
    if (!plan) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--scene').trim() || '#EDF0F3';
    const name = 'floorplan-' + FPSchemes.active(plan).name.replace(/[\\/:*?"<>|\s]+/g, '') + '.png';
    view3d.snapshot(bg).toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      note('已匯出 ' + name + '。');
    }, 'image/png');
  });

  // 牆面顏色
  for (const w of FPMaterials.WALLS) {
    const o = document.createElement('option');
    o.value = w.id; o.textContent = w.name;
    $('wallPaint').appendChild(o);
  }
  $('wallPaint').addEventListener('change', () => editor.setWallPaint($('wallPaint').value));
  // 外牆材質：全屋一個，個別牆面可以另外指定
  for (const [sel, first] of [['extMat', '跟室內牆色一樣'], ['wallExt', '跟全屋一樣']]) {
    for (const e of [{ id: '', name: first }].concat(FPMaterials.EXTERIORS)) {
      const o = document.createElement('option');
      o.value = e.id; o.textContent = e.name;
      $(sel).appendChild(o);
    }
  }
  $('extMat').addEventListener('change', () => editor.setExterior($('extMat').value));
  $('wallExt').addEventListener('change', () => editor.setWallExt($('wallExt').value));

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
  $('sample').addEventListener('click', () => loadSample(false));
  $('sampleColor').addEventListener('click', () => loadSample(true));
  $('resetCam').addEventListener('click', () => { if (view3d.walking) setWalk(false); else view3d.resetCamera(); });

  const stage = $('stage');
  let dragDepth = 0;
  stage.addEventListener('dragenter', e => { e.preventDefault(); if (viewing) return; dragDepth++; $('drop').hidden = false; });
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  stage.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; if (!viewing) openFile(e.dataTransfer.files[0]); });

  // 分享連結：平面圖和所有方案壓縮進網址，對方打開就能看 3D、漫遊、切換方案
  function shareBase() {
    return /^https?:$/.test(location.protocol) ? location.href : SITE_URL;
  }
  $('share').addEventListener('click', async () => {
    if (!plan) return;
    FPSchemes.sync(plan);
    let url;
    // 有好幾層時整棟一起分享
    try { url = FPShare.link(shareBase(), await FPShare.encode(building ? FPBuilding.toJSON(building) : plan)); } catch (e) { note('無法產生分享連結：' + e.message, true); return; }
    $('shareUrl').value = url;
    $('shareBox').hidden = false;
    $('shareUrl').select();
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (e) { /* 不允許時讓使用者自己複製 */ }
    $('shareMsg').textContent = (copied ? '連結已複製，' : '請複製上面的連結，') +
      '傳給家人或師傅（LINE、Email 都可以）。對方打開可以看 3D、走進房子、切換方案，但改不到你的檔案。' +
      (shareBase() === SITE_URL && location.protocol !== 'https:' ? '連結會開啟網站版，請先確認網站已經發布。' : '') +
      '之後再修改，要重新產生連結。';
  });
  $('shareCopy').addEventListener('click', async () => {
    $('shareUrl').select();
    try { await navigator.clipboard.writeText($('shareUrl').value); $('shareMsg').textContent = '連結已複製。'; }
    catch (e) { document.execCommand && document.execCommand('copy'); }
  });

  function setViewing(on) {
    viewing = on;
    document.body.classList.toggle('viewer', on);
    $('viewerBar').hidden = !on;
    if (on) { showTab('3d'); if (view3d.walking) setWalk(false); }
  }

  async function openShared(data) {
    let p;
    try { p = await FPShare.decode(data); }
    catch (e) { setViewing(false); if (!plan && !(await restore())) loadSample(); note(e.message, true); return; }
    setViewing(true);
    // 分享的房子自成一棟，不會蓋到這台電腦目前專案的樓層（看的時候不存檔）
    if (!openBuilding(p, '', true)) return;
    const floors = building.floors, cur = floors[building.active].plan;
    const rooms = (cur.rooms || []).length, schemes = (cur.schemes || []).length;
    note((floors.length > 1 ? '共 ' + floors.length + ' 層樓，可以在右上角切換或按「看整棟」；這一層' : '共 ') + rooms + ' 個空間' +
      (schemes > 1 ? '、' + schemes + ' 個裝修方案，可以在右上角切換' : '') + '。');
  }

  // 把分享的平面圖存到這台電腦，改成可以編輯
  $('viewerEdit').addEventListener('click', async () => {
    await initProjects();
    setViewing(false);
    history.replaceState(null, '', location.pathname + location.search);
    newProject('分享的平面圖');
    save();
    refresh();
    note('已存成新專案「' + (projects.get(projects.current) || {}).name + '」，現在可以編輯了。');
  });

  // 樓層：切換、新增（上傳圖或框選 PDF 的另一層）、改名、刪除、對齊
  $('floor').addEventListener('change', () => switchFloor(+$('floor').value));
  $('floorQuick').addEventListener('change', () => switchFloor(+$('floorQuick').value));
  $('wholeHouse').addEventListener('click', () => {
    wholeHouse = !wholeHouse;
    syncContext();
    if (wholeHouse) view3d.viewWhole(); else view3d.resetCamera();
    note(wholeHouse ? '顯示整棟房子；要看室內請再按一次「看整棟」，只顯示這一層和下面的樓層。' : '');
  });
  $('floorAdd').addEventListener('click', () => {
    pendingFloor = !pendingFloor && !!building;
    if (pendingFloor) save();   // 先存好目前這一層（含「已修改」）
    syncFloors();
    if (!pendingFloor) { note('已取消新增樓層。'); return; }
    if (pdf && pdf.page) {
      showTab('pick');
      note('請在 PDF 上框選這一層，按「辨識這一層」就會加成新的樓層。');
    } else {
      note('請上傳這一層的平面圖（圖片或 PDF），辨識結果會加成新的樓層。');
      $('file').click();
    }
  });
  $('floorName').addEventListener('change', () => {
    if (!building || !FPBuilding.rename(building, building.active, $('floorName').value)) return;
    save();
    syncFloors();
  });
  $('floorDel').addEventListener('click', () => {
    const f = building && building.floors[building.active];
    if (!f || building.floors.length < 2 || !confirm('要刪除「' + f.name + '」嗎？這一層的牆、家具都會刪除，無法復原。')) return;
    FPBuilding.removeFloor(building, building.active);
    const cur = building.floors[building.active];
    openPlan(cur.plan, '已刪除「' + f.name + '」。', cur.edited != null ? cur.edited : true);
  });
  // 對齊：這一層相對於整棟房子的位移（公尺），用來和下面的樓層上下對齊
  const setOffset = () => {
    const f = building && building.floors[building.active];
    const x = +$('floorDX').value, y = +$('floorDY').value;
    if (!f || !isFinite(x) || !isFinite(y)) return;
    f.offset = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
    syncContext();
    save();
  };
  $('floorDX').addEventListener('change', setOffset);
  $('floorDY').addEventListener('change', setOffset);

  // 專案選單：切換、改名、刪除
  $('project').addEventListener('change', () => { save(); openProject($('project').value); });
  $('projectName').addEventListener('change', () => {
    if (!projects || !projects.current) return;
    projects.rename(projects.current, $('projectName').value);
    syncProjects();
  });
  $('projectDel').addEventListener('click', () => {
    const cur = projects && projects.get(projects.current);
    if (!cur || !confirm('要刪除專案「' + cur.name + '」嗎？刪除後無法復原。')) return;
    const next = projects.remove(cur.id);
    syncProjects();
    if (next) openProject(next);
    else loadSample();
  });
  window.addEventListener('hashchange', () => { const d = FPShare.fromHash(location.hash); if (d) openShared(d); });

  syncOutputs();
  $('toolHint').textContent = TOOL_HINTS.select;
  const start = async () => {
    const shared = FPShare.fromHash(location.hash);
    if (shared) openShared(shared);
    else if (!(await restore())) loadSample();
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
})();
