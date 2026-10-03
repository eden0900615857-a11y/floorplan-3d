// 門窗辨識：在牆與牆之間的缺口裡找門窗的圖例符號。
// - 窗：缺口內有沿著牆方向的細線（施工圖常見的兩到三條平行線）。
// - 門：缺口旁邊有以缺口一端為圓心、缺口寬為半徑的四分之一圓弧（開門弧）。
// - 都沒有：當作開放的通道，保持缺口不處理。
// 找到門窗時，缺口兩側的牆會合併成一面牆，門窗掛在這面牆上。座標單位為像素。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPOpenings = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const WINDOW_LINE_COVER = 0.8;   // 一條窗線要蓋住缺口長度的比例
  const DOOR_ARC_COVER = 0.55;     // 開門弧上要有細線的取樣點比例
  const DOOR_ARC_STRONG = 0.8;     // 弧線這麼完整就不必再看門片
  const DOOR_LEAF_COVER = 0.6;     // 門片直線上要有線的比例
  const ARC_SIDE = 0.18;           // 檢查弧內外兩側是否空白：半徑的 ±18%
  const ARC_CONTRAST = 0.35;       // 弧上比兩側至少多這麼多比例的取樣點有線

  // ink：細線遮罩（原始深色像素扣掉牆），1 代表有線
  function makeInk(ink, w, h) {
    const at = (x, y) => {
      x = Math.round(x); y = Math.round(y);
      return x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] === 1;
    };
    // 半徑 2 像素內有線就算有（抗鋸齒、縮圖後細線會斷斷續續）
    const near = (x, y) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (at(x + dx, y + dy)) return true;
      return false;
    };
    return { at, near };
  }

  // 把「沿牆方向 p、垂直方向 q」換成影像座標
  const toXY = (dir, p, q) => (dir === 'h' ? [p, q] : [q, p]);

  // 缺口內沿牆方向的細線：逐條掃描牆厚範圍內的每一列（或欄）
  function hasWindowLines(inkAt, dir, c, t, g0, g1) {
    const p0 = Math.ceil(g0 + 2), p1 = Math.floor(g1 - 2);
    if (p1 - p0 < 4) return false;
    const q0 = Math.floor(c - t / 2), q1 = Math.ceil(c + t / 2);
    for (let q = q0; q <= q1; q++) {
      let hit = 0;
      for (let p = p0; p < p1; p++) if (inkAt(...toXY(dir, p, q))) hit++;
      if (hit / (p1 - p0) >= WINDOW_LINE_COVER) return true;
    }
    return false;
  }

  // 門片：從門軸 (hp, cq) 往 side 那一側、垂直牆面的直線上有線的比例
  function leaf(inkNear, dir, hp, cq, side, len) {
    let hit = 0, n = 0;
    for (let k = 0.15; k <= 0.951; k += 0.05) {
      n++;
      if (inkNear(...toXY(dir, hp, cq + side * len * k))) hit++;
    }
    return hit / n;
  }

  // 開門弧：試四種可能（門軸在缺口的哪一端 × 門往哪一側開），回傳最符合的一種。
  // 施工圖的門軸通常畫在牆面上，也有畫在牆中心線上的，兩種都試。
  function findDoorArc(inkNear, dir, c, t, g0, g1) {
    const gap = g1 - g0;
    let best = null;
    for (const hinge of ['p0', 'p1']) {
      for (const side of [1, -1]) {
        for (const [r, cq] of [[gap, c + side * t / 2], [gap * 0.9, c + side * t / 2], [gap, c]]) {
          // 弧線本身，以及弧的內側、外側各一圈：真的開門弧是一條細線，兩側是空的；
          // 家具、磁磚、浴缸這些密集的線條會讓三圈都有墨水
          const ring = k => {
            let hit = 0, n = 0;
            for (let deg = 12; deg <= 90; deg += 4) {
              const th = deg * Math.PI / 180, rr = r * k;
              const along = hinge === 'p0' ? g0 + rr * Math.cos(th) : g1 - rr * Math.cos(th);
              const across = cq + side * rr * Math.sin(th);
              n++;
              if (inkNear(...toXY(dir, along, across))) hit++;
            }
            return hit / n;
          };
          const score = ring(1);
          if (score < DOOR_ARC_COVER || (best && score <= best.score)) continue;
          const clutter = Math.max(ring(1 - ARC_SIDE), ring(1 + ARC_SIDE));
          if (score - clutter < ARC_CONTRAST) continue;
          // 只有一段弧（被家具擋住或剛好碰到椅子的圓弧）時，還要看得到門片：從門軸垂直牆面畫出去的直線
          if (score < DOOR_ARC_STRONG && leaf(inkNear, dir, hinge === 'p0' ? g0 : g1, cq, side, gap) < DOOR_LEAF_COVER) continue;
          best = { hinge, side, score, clutter };
        }
      }
    }
    return best;
  }

  // hint：AI 辨識時由模型判斷缺口是不是門窗（規則找不到符號時才問），沒有就是 null
  function classify(ink, seg, g0, g1, hint) {
    const t = seg.t;
    // 先找開門弧：門口常畫一條門檻線，會被誤認成窗線；窗外不會剛好有四分之一圓
    const arc = findDoorArc(ink.near, seg.dir, seg.c, t, g0, g1);
    if (arc) return { type: 'door', hinge: arc.hinge, side: arc.side };
    if (hasWindowLines(ink.at, seg.dir, seg.c, t, g0, g1)) return { type: 'window' };
    if (!hint) return null;
    const h = hint(seg.dir, seg.c, t, g0, g1);
    if (!h || h.type !== 'door') return h;
    // 模型說是門、但規則沒找到夠完整的開門弧：看哪個方向最像門（弧線＋門片），決定門軸和開門方向。
    // 缺口附近幾乎沒有任何弧線或門片的，多半是模型把通道誤認成門，不採用
    const best = doorGuess(ink.near, seg.dir, seg.c, t, g0, g1);
    return best.score >= HINT_DOOR_MIN ? { type: 'door', hinge: best.hinge, side: best.side } : null;
  }

  // 四種門軸 × 開門方向各自的分數，取兩種證據中比較強的一種：
  // - 開門弧：弧上有線、弧的內外兩側沒有線（半徑試 70%–100% 的缺口寬，門片常比門洞窄）；
  // - 門片：從門軸垂直牆面畫出去的直線，有 80% 以上的長度看得到線。
  // 只靠模型的門要有其中一種證據（分數 HINT_DOOR_MIN 以上），才不會把通道、磁磚線當成門。
  const HINT_DOOR_MIN = 0.3, HINT_LEAF = 0.8;
  function doorGuess(inkNear, dir, c, t, g0, g1) {
    const gap = g1 - g0;
    let best = null;
    for (const hinge of ['p0', 'p1']) {
      for (const side of [1, -1]) {
        const cq = c + side * t / 2;
        const ring = r => {
          let hit = 0, n = 0;
          for (let deg = 12; deg <= 90; deg += 4) {
            const th = deg * Math.PI / 180;
            const along = hinge === 'p0' ? g0 + r * Math.cos(th) : g1 - r * Math.cos(th);
            n++;
            if (inkNear(...toXY(dir, along, cq + side * r * Math.sin(th)))) hit++;
          }
          return hit / n;
        };
        let arc = 0;
        for (const k of [0.7, 0.8, 0.9, 1]) {
          const r = gap * k;
          arc = Math.max(arc, ring(r) - Math.max(ring(r * (1 - ARC_SIDE)), ring(r * (1 + ARC_SIDE))));
        }
        const lf = leaf(inkNear, dir, hinge === 'p0' ? g0 : g1, cq, side, gap);
        const score = Math.max(arc, lf >= HINT_LEAF ? lf : 0), total = arc + lf;
        if (!best || score > best.score || (score === best.score && total > best.total)) best = { hinge, side, score, total };
      }
    }
    return best;
  }

  // segs：vectorize 的線段；ink：細線遮罩；opts：{minGap, maxGap}（像素），可選 opts.hint（見 classify）
  // 回傳 {segments, openings}；openings 的 seg 指向 segments 裡的線段，g0–g1 是缺口範圍
  function detect(segs, inkMask, w, h, opts) {
    const ink = makeInk(inkMask, w, h);
    const inRange = g => g >= opts.minGap && g <= opts.maxGap;
    const openings = [];
    const removed = new Set();
    const work = segs.map(s => ({ ...s }));

    // 1. 同一條線上的兩段牆，中間的缺口
    for (const dir of ['h', 'v']) {
      const line = work.filter(s => s.dir === dir).sort((a, b) => a.c - b.c || a.p0 - b.p0);
      for (let i = 0; i < line.length; i++) {
        const cur = line[i];
        if (removed.has(cur)) continue;
        for (;;) {
          // 找緊接在後面、同一條線上的牆
          let next = null;
          for (const s of line) {
            if (s === cur || removed.has(s) || s.p0 < cur.p1) continue;
            if (Math.abs(s.c - cur.c) > Math.max(s.t, cur.t) / 2) continue;
            if (!next || s.p0 < next.p0) next = s;
          }
          if (!next || !inRange(next.p0 - cur.p1)) break;
          const kind = classify(ink, { dir, c: (cur.c + next.c) / 2, t: Math.max(cur.t, next.t) }, cur.p1, next.p0, opts.hint);
          if (!kind) break;
          openings.push({ seg: cur, g0: cur.p1, g1: next.p0, ...kind });
          const l1 = cur.p1 - cur.p0, l2 = next.p1 - next.p0;
          cur.c = (cur.c * l1 + next.c * l2) / (l1 + l2);
          cur.t = Math.max(cur.t, next.t);
          cur.p1 = next.p1;
          // 接過來的那段牆上已經找到的門窗，改掛到合併後的牆
          for (const o of openings) if (o.seg === next) o.seg = cur;
          removed.add(next);
        }
      }
    }
    let result = work.filter(s => !removed.has(s));

    // 2. 牆的一端和垂直的牆之間的缺口（例如門開在牆角旁邊）
    for (const s of result) {
      const perp = result.filter(p => p.dir !== s.dir && p.p0 - p.t / 2 <= s.c && s.c <= p.p1 + p.t / 2);
      for (const end of ['p1', 'p0']) {
        let best = null;
        for (const p of perp) {
          const face = end === 'p1' ? p.c - p.t / 2 : p.c + p.t / 2;
          const gap = end === 'p1' ? face - s.p1 : s.p0 - face;
          if (inRange(gap) && (!best || gap < best.gap)) best = { p, face, gap };
        }
        if (!best) continue;
        const g0 = end === 'p1' ? s.p1 : best.face, g1 = end === 'p1' ? best.face : s.p0;
        // 平行、緊貼的另一段牆上已經在這個位置找到門窗，不要重複
        if (openings.some(o => o.seg.dir === s.dir && Math.abs(o.seg.c - s.c) <= Math.max(o.seg.t, s.t) &&
          Math.min(o.g1, g1) > Math.max(o.g0, g0))) continue;
        const kind = classify(ink, s, g0, g1, opts.hint);
        if (!kind) continue;
        openings.push({ seg: s, g0, g1, ...kind });
        // 牆延伸到垂直牆的中心線，兩面牆接在一起
        if (end === 'p1') s.p1 = best.p.c; else s.p0 = best.p.c;
      }
    }
    return { segments: result, openings };
  }

  // 用門寬推算比例：格局圖通常沒有標尺寸，但門洞大多是 90 公分左右。
  // 取找到的門洞寬度（像素）的中位數當作 DOOR_WIDTH 公尺，回傳每公尺幾個像素；門少於 2 扇時無法推算，回傳 null
  const DOOR_WIDTH = 0.9;
  function scaleFromDoors(openings) {
    const widths = openings.filter(o => o.type === 'door').map(o => o.g1 - o.g0).sort((a, b) => a - b);
    if (widths.length < 2) return null;
    const n = widths.length, mid = n % 2 ? widths[n >> 1] : (widths[n / 2 - 1] + widths[n / 2]) / 2;
    return mid / DOOR_WIDTH;
  }

  return { detect, hasWindowLines, findDoorArc, leaf, doorGuess, scaleFromDoors, DOOR_WIDTH };
});
