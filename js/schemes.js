// 裝修方案：同一份平面圖（牆、門窗、房間）搭配不同的家具、地板與牆面顏色。
// 平面圖上的 furniture、materials 與每個房間的 floor、paint（牆色）永遠是「目前方案」的內容；
// plan.schemes 另外保存每個方案的一份副本，切換方案時把副本套回平面圖。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPSchemes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const clone = v => JSON.parse(JSON.stringify(v));

  // 平面圖目前的裝修內容。地板用房間 id 對應，重新找房間時 id 會保留
  function capture(plan) {
    const floors = {}, paints = {};
    for (const r of plan.rooms || []) {
      if (r.floor) floors[r.id] = r.floor;
      if (r.paint) paints[r.id] = r.paint;
    }
    return { furniture: clone(plan.furniture || []), materials: clone(plan.materials || {}), floors, paints };
  }

  function apply(plan, s) {
    plan.furniture = clone(s.furniture || []);
    plan.materials = clone(s.materials || {});
    for (const r of plan.rooms || []) {
      if (s.floors && s.floors[r.id]) r.floor = s.floors[r.id];
      else delete r.floor;
      if (s.paints && s.paints[r.id]) r.paint = s.paints[r.id];
      else delete r.paint;
    }
  }

  // 舊的平面圖沒有方案：把目前的內容當作「方案 1」
  function ensure(plan) {
    if (!Array.isArray(plan.schemes) || !plan.schemes.length) {
      plan.schemes = [{ id: 's1', name: '方案 1', ...capture(plan) }];
      plan.activeScheme = 's1';
    }
    if (!find(plan, plan.activeScheme)) plan.activeScheme = plan.schemes[0].id;
    return plan;
  }

  function find(plan, id) {
    return (plan.schemes || []).find(s => s.id === id) || null;
  }

  function active(plan) {
    return find(ensure(plan), plan.activeScheme);
  }

  // 把平面圖目前的內容寫回目前方案的副本（存檔前、切換前呼叫）
  function sync(plan) {
    Object.assign(active(plan), capture(plan));
    return plan;
  }

  function nextId(plan) {
    let n = 0;
    for (const s of plan.schemes) { const m = /^s(\d+)$/.exec(s.id); if (m) n = Math.max(n, +m[1]); }
    return 's' + (n + 1);
  }

  function nextName(plan) {
    const names = new Set(plan.schemes.map(s => s.name));
    let n = plan.schemes.length + 1;
    while (names.has('方案 ' + n)) n++;
    return '方案 ' + n;
  }

  function switchTo(plan, id) {
    sync(plan);
    const s = find(plan, id);
    if (!s) return null;
    plan.activeScheme = id;
    apply(plan, s);
    return s;
  }

  // 新增方案：blank 為 true 時是空的（沒有家具、預設材質），否則複製目前方案
  function add(plan, blank) {
    sync(plan);
    const base = blank ? { furniture: [], materials: {}, floors: {}, paints: {} } : capture(plan);
    const s = { id: nextId(plan), name: nextName(plan), ...clone(base) };
    plan.schemes.push(s);
    plan.activeScheme = s.id;
    apply(plan, s);
    return s;
  }

  function rename(plan, id, name) {
    const s = find(ensure(plan), id);
    name = (name || '').trim();
    if (!s || !name) return null;
    s.name = name.slice(0, 20);
    return s;
  }

  // 刪除方案：至少留一個；刪掉目前方案時切到相鄰的方案
  function remove(plan, id) {
    ensure(plan);
    if (plan.schemes.length < 2) return false;
    const i = plan.schemes.findIndex(s => s.id === id);
    if (i < 0) return false;
    const wasActive = plan.activeScheme === id;
    if (!wasActive) sync(plan);
    plan.schemes.splice(i, 1);
    if (wasActive) {
      const next = plan.schemes[Math.min(i, plan.schemes.length - 1)];
      plan.activeScheme = next.id;
      apply(plan, next);
    }
    return true;
  }

  return { capture, apply, ensure, find, active, sync, switchTo, add, rename, remove };
});
