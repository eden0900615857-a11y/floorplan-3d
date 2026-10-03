// AI 辨識：用 CubiCasa5K 預先訓練好的模型（ONNX 格式），在瀏覽器裡逐像素判斷牆、門、窗與房間種類。
// 模型只負責「哪些像素是牆、門、窗」，之後一樣交給 vectorize 整理成直線、openings 找門窗缺口、rooms 找房間。
// 模型約 30 MB，第一次使用時下載，之後存在瀏覽器的快取裡；推論用 ONNX Runtime Web（WebAssembly），不需要伺服器。
// 純計算的部分（前處理、解讀輸出、門窗提示、房間命名）不依賴瀏覽器，可以在 Node 測試。
(function (root, factory) {
  const req = typeof require === 'function' ? require : () => null;
  const api = factory(root, root.FPDetect || req('./detect.js'), root.FPVectorize || req('./vectorize.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPML = api;
})(typeof self !== 'undefined' ? self : this, function (root, FPDetect, FPVectorize) {
  const SIDE = 512;                  // 長邊縮到這個大小再送進模型（模型在這個尺度附近訓練，速度也比較快）
  const PAD = 64;                    // 模型會連續縮小 6 次，邊長要補到 64 的倍數
  const HEATMAPS = 21, ROOM_N = 12, ICON_N = 11;
  const WALL = 2;                    // 房間類別裡的「牆」
  const WINDOW = 1, DOOR = 2;        // 圖示類別裡的窗、門
  // 房間類別 → 中文房名（背景、牆、欄杆、未定義不命名）
  const ROOM_NAMES = { 1: '陽台', 3: '廚房', 4: '客廳', 5: '臥室', 6: '浴室', 7: '玄關', 9: '儲藏室', 10: '車庫' };
  const NAME_SHARE = 0.4;            // 房間裡至少這麼多比例的取樣點是同一類，才幫它命名

  const ORT_VERSION = '1.30.0';
  const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';
  const MODEL_URL = 'model/cubicasa-int8.onnx';
  const MODEL_BYTES = 30433981;      // 下載進度條用（伺服器沒給檔案大小時）
  const CACHE = 'floorplan-3d-model-v1';

  // 送進模型的大小：內容邊長取 4 的倍數，補白後是 64 的倍數
  function inputSize(w, h, side) {
    const s = (side || SIDE) / Math.max(w, h);
    const iw = Math.max(4, Math.round(w * s / 4) * 4), ih = Math.max(4, Math.round(h * s / 4) * 4);
    return { w: iw, h: ih, pw: Math.ceil(iw / PAD) * PAD, ph: Math.ceil(ih / PAD) * PAD };
  }

  // RGBA（w×h）→ 模型輸入 [1, 3, ph, pw]，數值 −1 到 1，補白的地方是白色（1）
  function toTensor(rgba, w, h, pw, ph) {
    const plane = pw * ph, out = new Float32Array(3 * plane).fill(1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4, q = y * pw + x;
        out[q] = rgba[p] / 127.5 - 1;
        out[plane + q] = rgba[p + 1] / 127.5 - 1;
        out[2 * plane + q] = rgba[p + 2] / 127.5 - 1;
      }
    }
    return out;
  }

  // 模型輸出 [1, 44, ph, pw]：前 21 張是牆角熱度圖（不用），接著 12 個房間類別、11 個圖示類別。
  // 每個像素取分數最高的類別，裁掉補白的部分。
  function decode(out, pw, ph, w, h) {
    const plane = pw * ph, rooms = new Uint8Array(w * h), icons = new Uint8Array(w * h);
    const argmax = (q, from, n) => {
      let best = 0, bv = -Infinity;
      for (let k = 0; k < n; k++) {
        const v = out[(from + k) * plane + q];
        if (v > bv) { bv = v; best = k; }
      }
      return best;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const q = y * pw + x, i = y * w + x;
        rooms[i] = argmax(q, HEATMAPS, ROOM_N);
        icons[i] = argmax(q, HEATMAPS + ROOM_N, ICON_N);
      }
    }
    return { w, h, rooms, icons };
  }

  // 模型解析度的類別圖 → 辨識用解析度（W×H）的牆遮罩（最近鄰放大）。
  // 模型常把門窗也標成牆，門窗的像素要挖掉，牆上才會留下缺口給門窗辨識
  function wallMask(ml, W, H) {
    const out = new Uint8Array(W * H), sx = ml.w / W, sy = ml.h / H;
    for (let y = 0; y < H; y++) {
      const my = Math.min(ml.h - 1, Math.floor((y + 0.5) * sy));
      for (let x = 0; x < W; x++) {
        const mx = Math.min(ml.w - 1, Math.floor((x + 0.5) * sx));
        const i = my * ml.w + mx;
        out[y * W + x] = ml.rooms[i] === WALL && ml.icons[i] !== DOOR && ml.icons[i] !== WINDOW ? 1 : 0;
      }
    }
    return out;
  }

  // 每個牆像素所在的水平、垂直連續長度
  function runLengths(mask, W, H) {
    const hr = new Uint16Array(W * H), vr = new Uint16Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W;) {
        if (!mask[y * W + x]) { x++; continue; }
        let e = x;
        while (e < W && mask[y * W + e]) e++;
        for (let k = x; k < e; k++) hr[y * W + k] = e - x;
        x = e;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H;) {
        if (!mask[y * W + x]) { y++; continue; }
        let e = y;
        while (e < H && mask[e * W + x]) e++;
        for (let k = y; k < e; k++) vr[k * W + x] = e - y;
        y = e;
      }
    }
    return { hr, vr };
  }

  // 模型的牆 → 直線段（像素）。模型的牆邊緣有鋸齒、偶爾斷一小截，牆角和管道間會連成一大塊，所以：
  // 1. 閉運算補平鋸齒；
  // 2. 拆成「水平牆」和「垂直牆」兩張遮罩：水平牆的像素，垂直方向的厚度不能超過 MAX_T 公尺，垂直牆反過來。
  //    這樣牆角、管道間那種兩個方向都很厚的色塊不會把相鄰的牆撐成一面厚牆；
  // 3. 各自找成帶狀的直線段，最小牆厚 3 像素（細的隔間牆也留下來）；
  // 4. 同一條線上相隔不到 MERGE_GAP 公尺的牆接起來（比最窄的門 0.5 公尺還短，不會吃掉門洞）；
  // 5. 柱子（BLOCK_MAX 公尺以內的厚色塊）另外補上，圖片邊緣補外牆，牆角接起來。
  const MIN_T = 3, MAX_T = 0.4, MERGE_GAP = 0.4, BLOCK_MAX = 1.6;
  function walls(ml, W, H, ppm) {
    let mask = wallMask(ml, W, H);
    mask = FPDetect.morph(FPDetect.morph(mask, W, H, 1, false), W, H, 1, true);
    const { hr, vr } = runLengths(mask, W, H);
    const maxT = Math.max(2 * MIN_T, MAX_T * ppm), minLen = 2 * MIN_T + 2;
    const hm = new Uint8Array(W * H), vm = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      if (hr[i] >= minLen && vr[i] <= maxT) hm[i] = 1;
      if (vr[i] >= minLen && hr[i] <= maxT) vm[i] = 1;
    }
    const bands = FPVectorize.extractBands(hm, W, H, true, minLen).concat(FPVectorize.extractBands(vm, W, H, false, minLen));
    let segs = FPVectorize.mergeCollinear(
      bands.filter(b => b.t >= MIN_T && b.p1 - b.p0 >= Math.max(minLen, 2 * b.t)),
      Math.max(3, MERGE_GAP * ppm));
    // 柱子、管道間：兩個方向都很厚的色塊，各自當成一面短而厚的牆
    segs = segs.concat(blocks(mask, hr, vr, W, H, maxT, minLen, BLOCK_MAX * ppm));
    // 圖片裁到外牆時沿邊緣補牆，再把牆角接起來
    segs = FPVectorize.closeBorder(segs, W, H).segments;
    snapEnds(segs, SNAP * ppm);
    return { mask, segments: segs, coverage: FPVectorize.coverage(mask, W, H, segs) };
  }

  // 兩個方向都比 maxT 厚的像素連成的區塊 → 外框當成一段牆（沿長邊方向）。
  // 長邊超過 maxSize（BLOCK_MAX 公尺）的不是柱子，多半是模型把一整塊角落塗成牆，不採用
  function blocks(mask, hr, vr, W, H, maxT, minSize, maxSize) {
    const seen = new Uint8Array(W * H), out = [];
    const thick = i => mask[i] && hr[i] > maxT && vr[i] > maxT;
    for (let i = 0; i < mask.length; i++) {
      if (seen[i] || !thick(i)) continue;
      let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop(), x = j % W, y = (j - x) / W;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const k of [j - 1, j + 1, j - W, j + W]) {
          if (k < 0 || k >= mask.length || seen[k] || Math.abs((k % W) - x) > 1 || !thick(k)) continue;
          seen[k] = 1;
          stack.push(k);
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // 太小的是雜點；填不滿外框一半的是 L 形牆角，交給上面的水平、垂直牆處理
      if (Math.min(bw, bh) < minSize || Math.max(bw, bh) > maxSize || n < 0.5 * bw * bh) continue;
      out.push(bw >= bh
        ? { dir: 'h', c: (y0 + y1 + 1) / 2, t: bh, p0: x0, p1: x1 + 1 }
        : { dir: 'v', c: (x0 + x1 + 1) / 2, t: bw, p0: y0, p1: y1 + 1 });
    }
    return out;
  }

  // 牆角接起來：模型的牆在轉角常常差一點點沒碰到，房間就封不起來。
  // 牆的一端離垂直的牆中心線不到 tol，而且兩面牆延長後真的會交會（交點離兩面牆都不到 tol），
  // 就把兩面牆都延伸到交點。tol 比最窄的門（0.5 公尺）短，門洞不會被接起來。
  const SNAP = 0.45;
  function snapEnds(segs, tol) {
    for (const s of segs) {
      for (const end of ['p0', 'p1']) {
        let best = null, bestD = tol;
        for (const p of segs) {
          if (p.dir === s.dir) continue;
          const d = Math.abs(p.c - s[end]);
          if (d > bestD) continue;
          // 交點要在 p 上或離 p 的端點不到 tol
          if (s.c < p.p0 - tol || s.c > p.p1 + tol) continue;
          // 不能整面牆跨過去：交點在這面牆的另一端外面就不算
          if (end === 'p0' ? p.c > s.p1 : p.c < s.p0) continue;
          best = p; bestD = d;
        }
        if (!best) continue;
        s[end] = best.c;
        if (s.c < best.p0) best.p0 = s.c;
        if (s.c > best.p1) best.p1 = s.c;
      }
    }
    return segs;
  }

  // 門窗提示：規則在缺口裡找不到開門弧或窗線時，問模型這個缺口是不是門窗。
  // 模型把門窗標在牆線上的缺口位置（不是門片掃過的範圍），所以沿著缺口逐格檢查牆線附近有沒有門、窗像素，
  // 有標到的長度超過缺口的 ICON_SHARE 就算。座標是辨識用解析度（W×H）的像素。
  // 模型看不出門往哪邊開，先用預設方向，使用者可以在 2D 校正換。
  const ICON_SHARE = 0.4, ICON_REACH = 4;   // 牆線兩側各看 4 個模型像素（模型解析度低，位置會偏一點）
  function openingHint(ml, W, H) {
    const s = ml.w / W;
    return function (dir, c, t, g0, g1) {
      const along = dir === 'h' ? ml.w : ml.h, across = dir === 'h' ? ml.h : ml.w;
      const p0 = Math.max(0, Math.floor(g0 * s)), p1 = Math.min(along, Math.ceil(g1 * s));
      const q0 = Math.max(0, Math.floor((c - t / 2) * s) - ICON_REACH), q1 = Math.min(across, Math.ceil((c + t / 2) * s) + ICON_REACH);
      let door = 0, win = 0;
      for (let p = p0; p < p1; p++) {
        let d = false, w = false;
        for (let q = q0; q < q1; q++) {
          const k = ml.icons[dir === 'h' ? q * ml.w + p : p * ml.w + q];
          if (k === DOOR) d = true; else if (k === WINDOW) w = true;
        }
        if (d) door++;
        if (w) win++;
      }
      const n = Math.max(1, p1 - p0);
      if (Math.max(door, win) < ICON_SHARE * n) return null;
      return door >= win ? { type: 'door', hinge: 'p0', side: 1 } : { type: 'window' };
    };
  }

  // 用模型的房間類別幫還沒命名的房間取名字（例如「臥室」「臥室 2」）。
  // rooms：FPRooms.assign 的結果（公尺）；ppm：每公尺幾個像素；W：辨識用解析度的寬度。
  // 只改名字是預設「房間 N」的房間，使用者取過的名字不動。
  function nameRooms(rooms, ml, ppm, W) {
    const s = ml.w / W;
    const used = new Set(rooms.map(r => r.name));
    for (const r of rooms) {
      if (!/^房間 \d+$/.test(r.name)) continue;
      const xs = r.polygon.map(p => p[0]), ys = r.polygon.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const step = Math.max((x1 - x0) / 24, (y1 - y0) / 24, 1e-6);
      const count = {};
      let n = 0;
      for (let y = y0 + step / 2; y < y1; y += step) {
        for (let x = x0 + step / 2; x < x1; x += step) {
          if (!pointIn([x, y], r.polygon)) continue;
          const mx = Math.floor(x * ppm * s), my = Math.floor(y * ppm * s);
          if (mx < 0 || my < 0 || mx >= ml.w || my >= ml.h) continue;
          const k = ml.rooms[my * ml.w + mx];
          n++;
          if (ROOM_NAMES[k]) count[k] = (count[k] || 0) + 1;
        }
      }
      const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
      if (!best || count[best] < NAME_SHARE * n) continue;
      const base = ROOM_NAMES[best];
      let name = base, k = 1;
      while (used.has(name)) name = base + ' ' + (++k);
      used.delete(r.name);
      r.name = name;
      used.add(name);
    }
    return rooms;
  }

  function pointIn(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ---- 以下只在瀏覽器使用 ----

  let ortPromise = null, sessionPromise = null;

  // 只有使用 AI 辨識時才載入 ONNX Runtime（約 0.5 MB 的程式加 10 MB 的 WebAssembly）
  function loadOrt() {
    if (root.ort) return Promise.resolve(root.ort);
    if (!ortPromise) {
      ortPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = ORT_URL + 'ort.wasm.min.js';
        s.onload = () => {
          root.ort.env.wasm.wasmPaths = ORT_URL;
          root.ort.env.wasm.numThreads = 1;   // 多執行緒需要特殊的伺服器設定，GitHub Pages 沒有
          resolve(root.ort);
        };
        s.onerror = () => { ortPromise = null; reject(new Error('無法載入 AI 辨識程式，請檢查網路連線。')); };
        document.head.appendChild(s);
      });
    }
    return ortPromise;
  }

  // 下載模型：先看瀏覽器快取，沒有才下載，onProgress(0–1) 回報進度
  async function fetchModel(onProgress) {
    const url = new URL(MODEL_URL, root.location.href).href;
    let cache = null;
    try { cache = await root.caches.open(CACHE); } catch (e) { /* 不支援或不允許快取 */ }
    if (cache) {
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('下載 AI 模型失敗（' + res.status + '）。');
    const total = +res.headers.get('content-length') || MODEL_BYTES;
    const reader = res.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (onProgress) onProgress(Math.min(1, got / total));
    }
    const bytes = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
    if (cache) {
      try { await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* 空間不足時略過 */ }
    }
    return bytes;
  }

  function loadModel(onProgress) {
    if (!sessionPromise) {
      sessionPromise = Promise.all([loadOrt(), fetchModel(onProgress)])
        .then(([ort, bytes]) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }))
        .catch(err => { sessionPromise = null; throw err; });
    }
    return sessionPromise;
  }

  // 網頁是直接用檔案打開的（file://）時，瀏覽器不允許下載模型
  function available() {
    return !!root.location && /^https?:$/.test(root.location.protocol);
  }

  // 圖片（canvas）→ {w, h, rooms, icons}（模型解析度）
  async function run(canvas, onProgress) {
    const session = await loadModel(onProgress);
    const ort = root.ort, size = inputSize(canvas.width, canvas.height);
    const c = document.createElement('canvas');
    c.width = size.w; c.height = size.h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, size.w, size.h);
    const rgba = g.getImageData(0, 0, size.w, size.h).data;
    const input = new ort.Tensor('float32', toTensor(rgba, size.w, size.h, size.pw, size.ph), [1, 3, size.ph, size.pw]);
    const result = await session.run({ [session.inputNames[0]]: input });
    const out = result[session.outputNames[0]];
    return decode(out.data, size.pw, size.ph, size.w, size.h);
  }

  return {
    SIDE, WALL, WINDOW, DOOR, ROOM_NAMES, MODEL_URL,
    inputSize, toTensor, decode, wallMask, walls, snapEnds, openingHint, nameRooms,
    available, loadModel, run
  };
});
