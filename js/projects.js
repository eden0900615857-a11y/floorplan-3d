// 多個專案：每間房子（每張上傳的平面圖）一個專案，各自保存平面圖 JSON。
// 資料存在瀏覽器的 IndexedDB（平面圖帶著原圖，比 localStorage 的 5 MB 上限大得多），
// 不能用時退回只存在記憶體裡。清單和目前專案的狀態是同步更新的，寫入依序排隊在背景進行。
// 圖片（原圖、外觀圖）和平面圖分開存：每次修改都會存檔，但圖片幾乎不會變，分開之後每次只寫很小的平面圖，
// 圖片換了才寫圖片。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPProjects = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const INDEX = 'index', CURRENT = 'current', planKey = id => 'plan:' + id;

  // 平面圖（或整棟房子的每一層）裡的圖片：source.image 和 facades[].image。
  // 回傳一份圖片欄位換成 fn(圖片) 的淺層副本，其他內容和原本共用，不會改到傳進來的資料
  function mapImages(data, fn) {
    const one = p => {
      if (!p || typeof p !== 'object') return p;
      let out = p;
      if (p.source && p.source.image != null) out = { ...out, source: { ...p.source, image: fn(p.source.image) } };
      if (Array.isArray(p.facades)) out = { ...out, facades: p.facades.map(f => (f && f.image != null ? { ...f, image: fn(f.image) } : f)) };
      return out;
    };
    if (data && data.type === 'building' && Array.isArray(data.floors)) {
      return { ...data, floors: data.floors.map(f => (f && f.plan ? { ...f, plan: one(f.plan) } : f)) };
    }
    return one(data);
  }
  // 存進去的格式：{split: 1, data: 圖片換成 {$img: key} 的平面圖, images: [key…]}，圖片各自存在 key 底下。
  // 舊版是直接存整份平面圖（圖片在裡面），讀得到，下次存檔時換成新格式
  const isSplit = rec => !!rec && rec.split === 1 && Array.isArray(rec.images) && 'data' in rec;

  // 測試或 IndexedDB 不能用時：只存在記憶體裡
  function memoryBackend() {
    const m = new Map();
    return {
      persistent: false,
      get: k => Promise.resolve(m.has(k) ? JSON.parse(m.get(k)) : null),
      set: (k, v) => { m.set(k, JSON.stringify(v)); return Promise.resolve(); },
      del: k => { m.delete(k); return Promise.resolve(); }
    };
  }

  // IndexedDB：一個資料庫、一個 key-value 的 store
  function idbBackend(name) {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const run = (mode, fn) => new Promise((ok, fail) => {
          const tx = db.transaction('kv', mode), r = fn(tx.objectStore('kv'));
          tx.oncomplete = () => ok(r.result === undefined ? null : r.result);
          tx.onerror = tx.onabort = () => fail(tx.error || r.error);
        });
        resolve({
          persistent: true,
          get: k => run('readonly', s => s.get(k)),
          set: (k, v) => run('readwrite', s => s.put(v, k)),
          del: k => run('readwrite', s => s.delete(k))
        });
      };
    });
  }

  function createStore(backend) {
    let index = [], current = null, queue = Promise.resolve(), last = 0;
    // 依序寫入；失敗不影響之後的寫入，錯誤交給呼叫的人處理
    const write = fn => {
      const p = queue.then(fn);
      queue = p.catch(() => {});
      return p;
    };
    const saveIndex = () => write(() => Promise.all([backend.set(INDEX, index), backend.set(CURRENT, current)]));
    const find = id => index.find(e => e.id === id) || null;
    const now = () => (last = Math.max(Date.now(), last + 1));

    // 每個專案目前的圖片 → 存放的 key（這次開啟網頁期間）。圖片沒換就沿用同一個 key，不必重寫
    const imageKeys = new Map();
    // 每個專案已經寫進去的圖片 key；知道的話存檔前不必先讀舊的紀錄，平面圖馬上送出（修改完立刻關掉網頁也存得到）
    const storedKeys = new Map();
    let imgSeq = 0;
    const waiting = new Map();   // 專案 id → 還沒開始寫的那一筆 {rec, strings, done}
    // 把平面圖存到專案 id。連續呼叫時，還沒開始寫的那一筆直接換成最新的（拖滑桿時不會排一長串）
    function putPlan(id, data) {
      const prev = imageKeys.get(id) || new Map(), keys = new Map(), strings = new Map();
      const lean = mapImages(data, img => {
        if (typeof img !== 'string') return img;
        if (!keys.has(img)) keys.set(img, prev.get(img) || 'img:' + id + ':' + now().toString(36) + (imgSeq++).toString(36));
        strings.set(keys.get(img), img);
        return { $img: keys.get(img) };
      });
      imageKeys.set(id, keys);
      const rec = { split: 1, data: lean, images: [...strings.keys()] };
      const w = waiting.get(id);
      if (w) { w.rec = rec; w.strings = strings; return w.done; }
      const item = { rec, strings };
      waiting.set(id, item);
      item.done = write(async () => {
        if (waiting.get(id) === item) waiting.delete(id);
        let had = storedKeys.get(id);
        if (!had) {
          const old = await backend.get(planKey(id));
          had = new Set(isSplit(old) ? old.images : []);
        }
        storedKeys.delete(id);   // 中途失敗的話，下次重新讀
        // 先寫新的圖片，再寫平面圖，最後才刪掉不用的圖片：中途失敗也不會留下缺圖的平面圖
        for (const [k, s] of item.strings) if (!had.has(k)) await backend.set(k, s);
        await backend.set(planKey(id), item.rec);
        for (const k of had) if (!item.strings.has(k)) await backend.del(k);
        storedKeys.set(id, new Set(item.strings.keys()));
      });
      return item.done;
    }
    async function getPlan(id) {
      const rec = await backend.get(planKey(id));
      if (!isSplit(rec)) return rec;
      const imgs = new Map(), keys = new Map();
      for (const k of rec.images) {
        const s = await backend.get(k);
        if (typeof s === 'string') { imgs.set(k, s); keys.set(s, k); }
      }
      imageKeys.set(id, keys);
      storedKeys.set(id, new Set(rec.images));
      return mapImages(rec.data, v => (v && v.$img ? imgs.get(v.$img) : v));
    }
    function delPlan(id) {
      imageKeys.delete(id);
      waiting.delete(id);   // 之後同一個 id 再存檔（重新載入範例）要排在刪除後面，不能併進刪除前的那一筆
      return write(async () => {
        storedKeys.delete(id);
        const old = await backend.get(planKey(id));
        for (const k of isSplit(old) ? old.images : []) await backend.del(k);
        await backend.del(planKey(id));
      });
    }

    function uniqueName(name, except) {
      name = (name || '').trim().slice(0, 30) || '我的房子';
      const names = new Set(index.filter(e => e.id !== except).map(e => e.name));
      if (!names.has(name)) return name;
      let n = 2;
      while (names.has(name + ' (' + n + ')')) n++;
      return name + ' (' + n + ')';
    }

    function nextId() {
      let n = 0;
      for (const e of index) { const m = /^p(\d+)$/.exec(e.id); if (m) n = Math.max(n, +m[1]); }
      return 'p' + (n + 1);
    }

    return {
      get persistent() { return !!backend.persistent; },
      async init() {
        index = (await backend.get(INDEX)) || [];
        current = await backend.get(CURRENT);
        if (!find(current)) current = null;
        return this.list();
      },
      // 最近修改的在前面
      list() {
        return index.slice().sort((a, b) => b.updated - a.updated).map(e => ({ ...e }));
      },
      get current() { return current; },
      get(id) { const e = find(id); return e ? { ...e } : null; },
      // 新增專案並設為目前專案。指定 id 而且已經存在時（例如範例）改成覆蓋那個專案
      create(name, plan, edited, id) {
        let e = id && find(id);
        if (!e) {
          e = { id: id || nextId(), name: uniqueName(name) };
          index.push(e);
        }
        e.updated = now();
        e.edited = !!edited;
        current = e.id;
        const p = putPlan(e.id, plan);
        saveIndex();
        return { id: e.id, done: p };
      },
      // 把平面圖存回目前專案
      save(plan, edited) {
        const e = find(current);
        if (!e) return Promise.resolve();
        e.updated = now();
        e.edited = !!edited;
        const p = putPlan(e.id, plan);
        saveIndex();
        return p;
      },
      async open(id) {
        const e = find(id);
        if (!e) return null;
        await queue;
        const plan = await getPlan(id);
        if (!plan) return null;
        current = id;
        saveIndex();
        return { plan, edited: !!e.edited, name: e.name };
      },
      rename(id, name) {
        const e = find(id);
        name = (name || '').trim();
        if (!e || !name) return null;
        e.name = uniqueName(name, id);
        saveIndex();
        return e.name;
      },
      // 刪除後回傳下一個要開的專案 id（最近修改的），沒有了就是 null
      remove(id) {
        index = index.filter(e => e.id !== id);
        delPlan(id);
        const next = this.list()[0];
        if (current === id) current = next ? next.id : null;
        saveIndex();
        return next ? next.id : null;
      },
      flush() { return queue; }
    };
  }

  return { createStore, memoryBackend, idbBackend };
});
