// 分享連結：把平面圖（牆、門窗、房間與所有裝修方案）壓縮後放進網址的 # 後面。
// 不需要伺服器或帳號：收到連結的人打開網頁，資料直接從網址讀出來，不會上傳到任何地方。
// 原圖不放進連結（太大，也可能有著作權），數字只留到公分的十分之一（公釐）。
(function (root, factory) {
  const api = factory(root.FPPlan || (typeof require === 'function' ? require('./plan.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPShare = api;
})(typeof self !== 'undefined' ? self : this, function (FPPlan) {
  const KEY = 'v';            // 網址 #v=… 代表分享連結
  const DEFLATE = 'z';        // 壓縮過的資料開頭
  const RAW = 'j';            // 瀏覽器不支援壓縮時，直接放 JSON
  const hasStream = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  const round = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

  // 分享用的精簡平面圖：不含原圖，數字四捨五入
  function strip(plan) {
    const p = JSON.parse(JSON.stringify(plan, (k, v) => round(v)));
    // 外觀圖是圖片，放進網址太長
    delete p.facades;
    if (p.source) {
      const s = { widthPx: p.source.widthPx, heightPx: p.source.heightPx, pxPerMeter: p.source.pxPerMeter };
      if (s.widthPx && s.pxPerMeter) p.source = s; else delete p.source;
    }
    return p;
  }

  function toB64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64url(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function pipe(bytes, stream) {
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(buf);
  }

  // 整棟房子（多樓層）：每一層各自精簡
  const isBuilding = v => !!v && v.type === 'building' && Array.isArray(v.floors);
  function stripAny(v) {
    if (!isBuilding(v)) return strip(v);
    return { version: 1, type: 'building', active: v.active | 0,
      floors: v.floors.map(f => ({ id: f.id, name: f.name, offset: (f.offset || [0, 0]).map(round), plan: strip(f.plan) })) };
  }

  // 平面圖或整棟房子 → 網址用的字串
  async function encode(plan) {
    const bytes = new TextEncoder().encode(JSON.stringify(stripAny(plan)));
    if (!hasStream) return RAW + toB64url(bytes);
    return DEFLATE + toB64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  }

  // 網址的字串 → 平面圖；格式不對時丟出錯誤，訊息可以直接給使用者看
  async function decode(str) {
    const kind = str && str[0], broken = () => new Error('分享連結不完整，可能複製時少了一段。');
    if (kind !== DEFLATE && kind !== RAW) throw broken();
    if (kind === DEFLATE && !hasStream) throw new Error('這個瀏覽器太舊，無法開啟分享連結。');
    let plan;
    try {
      let bytes = fromB64url(str.slice(1));
      if (kind === DEFLATE) bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
      plan = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw broken();
    }
    const errors = !isBuilding(plan) ? FPPlan.validate(plan)
      : plan.floors.length ? [].concat(...plan.floors.map(f => FPPlan.validate(f && f.plan))) : ['沒有任何樓層'];
    if (errors.length) throw new Error('分享連結裡的平面圖有問題：' + errors.slice(0, 2).join('；'));
    return plan;
  }

  // 從網址的 hash 取出分享資料（沒有就回傳 null）
  function fromHash(hash) {
    const m = new RegExp('^#' + KEY + '=([A-Za-z0-9_-]+)$').exec(hash || '');
    return m ? m[1] : null;
  }

  function link(base, data) {
    return base.replace(/#.*$/, '') + '#' + KEY + '=' + data;
  }

  return { strip, stripAny, encode, decode, fromHash, link };
});
