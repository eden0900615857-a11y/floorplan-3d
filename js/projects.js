// 多個專案：每間房子（每張上傳的平面圖）一個專案，各自保存平面圖 JSON。
// 資料存在瀏覽器的 IndexedDB（平面圖帶著原圖，比 localStorage 的 5 MB 上限大得多），
// 不能用時退回只存在記憶體裡。清單和目前專案的狀態是同步更新的，寫入依序排隊在背景進行。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPProjects = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const INDEX = 'index', CURRENT = 'current', planKey = id => 'plan:' + id;

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
        const p = write(() => backend.set(planKey(e.id), plan));
        saveIndex();
        return { id: e.id, done: p };
      },
      // 把平面圖存回目前專案
      save(plan, edited) {
        const e = find(current);
        if (!e) return Promise.resolve();
        e.updated = now();
        e.edited = !!edited;
        const p = write(() => backend.set(planKey(e.id), plan));
        saveIndex();
        return p;
      },
      async open(id) {
        const e = find(id);
        if (!e) return null;
        await queue;
        const plan = await backend.get(planKey(id));
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
        write(() => backend.del(planKey(id)));
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
