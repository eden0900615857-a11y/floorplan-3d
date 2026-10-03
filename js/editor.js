// 2D 校正編輯器：在原圖上直接修正牆。
// 工具：選取（移動牆、拖曳端點、沿牆移動門窗、移動家具）、畫牆、加門、加窗、擺家具、比例尺。支援縮放、平移、復原與重做。
// 所有修改都寫回同一份平面圖 JSON，每完成一個動作呼叫 opts.onCommit()。
(function (root) {
  const SNAP_PX = 10;         // 吸附距離（螢幕像素）
  const MIN_WALL = 0.1;       // 新畫的牆最短 10 公分

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function createEditor(el, opts) {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '2D 平面圖編輯區');
    el.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const history = new FPEdit.History();

    let plan = null, image = null, tool = 'select';
    let selected = null;      // 選取中的牆 id
    let selOpening = null;    // 選取中的門窗 id
    let selRoom = null;       // 選取中的房間 id
    let selFurn = null;       // 選取中的家具 id（牆、門窗、房間、家具同時只會選一個）
    let placeModel = 'sofa3'; // 擺家具工具要放的家具種類
    let hover = null;         // 擺家具工具：游標位置，用來預覽
    let view = { s: 50, ox: 0, oy: 0 };   // 螢幕座標 = 公尺 × s + o
    let drag = null, draft = null, scalePts = [], cw = 0, ch = 0, spaceDown = false;
    let userMoved = false;   // 使用者自己縮放或平移過，就不再自動調整視野

    const tol = () => SNAP_PX / view.s;
    const toScreen = p => [p[0] * view.s + view.ox, p[1] * view.s + view.oy];
    function toWorld(e) {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left - view.ox) / view.s, (e.clientY - r.top - view.oy) / view.s];
    }

    function imageRect() {
      if (!image || !plan.source || !plan.source.pxPerMeter) return null;
      return { w: plan.source.widthPx / plan.source.pxPerMeter, h: plan.source.heightPx / plan.source.pxPerMeter };
    }

    function fit() {
      if (!plan || !cw || !ch) return;
      const bb = FPPlan.bounds(plan);
      const bw = Math.max(0.5, bb.maxX - bb.minX), bh = Math.max(0.5, bb.maxY - bb.minY);
      view.s = Math.min(cw / bw, ch / bh) * 0.92;
      view.ox = (cw - bw * view.s) / 2 - bb.minX * view.s;
      view.oy = (ch - bh * view.s) / 2 - bb.minY * view.s;
      userMoved = false;
    }

    function resize() {
      if (!el.clientWidth || !el.clientHeight) return;
      cw = el.clientWidth; ch = el.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!userMoved) fit();
      draw();
    }
    new ResizeObserver(resize).observe(el);

    // 牆上 s0–s1 這一段（沿牆距離，公尺）的矩形路徑
    function spanPath(w, s0, s1, thickness) {
      const L = FPPlan.wallLength(w);
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      const a = toScreen([w.a[0] + ux * s0, w.a[1] + uy * s0]), b = toScreen([w.a[0] + ux * s1, w.a[1] + uy * s1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      ctx.save();
      ctx.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.beginPath();
      ctx.rect(-len / 2, -thickness * view.s / 2, len, Math.max(1, thickness * view.s));
      ctx.restore();
    }

    // 門：開門弧與門片；窗：淡色底加兩條細線
    function drawOpening(w, sp, color) {
      const o = sp.o, L = FPPlan.wallLength(w);
      const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
      const at = d => toScreen([w.a[0] + ux * d, w.a[1] + uy * d]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (o.type === 'window') {
        spanPath(w, sp.s0, sp.s1, w.thickness);
        ctx.globalAlpha = 0.2; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
        const off = w.thickness * view.s / 4, nx = -uy * off, ny = ux * off;
        const p0 = at(sp.s0), p1 = at(sp.s1);
        ctx.beginPath();
        ctx.moveTo(p0[0] + nx, p0[1] + ny); ctx.lineTo(p1[0] + nx, p1[1] + ny);
        ctx.moveTo(p0[0] - nx, p0[1] - ny); ctx.lineTo(p1[0] - nx, p1[1] - ny);
        ctx.stroke();
        return;
      }
      const hinge = at(o.hinge === 'b' ? sp.s1 : sp.s0), jamb = at(o.hinge === 'b' ? sp.s0 : sp.s1);
      const r = (sp.s1 - sp.s0) * view.s;
      // a→b 的左側（y 向下的螢幕座標）是 (uy, -ux)
      const side = o.swing === 'right' ? -1 : 1;
      const nx = uy * side, ny = -ux * side;
      const leaf = [hinge[0] + nx * r, hinge[1] + ny * r];
      const a0 = Math.atan2(jamb[1] - hinge[1], jamb[0] - hinge[0]), a1 = Math.atan2(ny, nx);
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d <= -Math.PI) d += 2 * Math.PI;
      ctx.beginPath(); ctx.arc(hinge[0], hinge[1], r, a0, a1, d < 0); ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(hinge[0], hinge[1]); ctx.lineTo(leaf[0], leaf[1]); ctx.stroke();
    }

    // 家具：外框加淡色底，正面那一邊畫粗線，放得下的話寫上名稱
    function drawFurniture(f, color, alpha) {
      const pts = FPFurniture.footprint(f).map(toScreen);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      pts.forEach((q, n) => n ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
      ctx.closePath();
      ctx.fillStyle = css('--panel');
      ctx.fill();
      if (f.color) { ctx.globalAlpha = alpha * 0.45; ctx.fillStyle = f.color; ctx.fill(); ctx.globalAlpha = alpha; }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); ctx.stroke();
      const def = FPFurniture.item(f.model);
      if (def && Math.min(f.w, f.d) * view.s > 18 && Math.max(f.w, f.d) * view.s > 44) {
        const c = toScreen(f.pos);
        ctx.fillStyle = color;
        ctx.font = '11px "Noto Sans TC", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(def.name, c[0], c[1]);
      }
      ctx.globalAlpha = 1;
    }

    function label(text, x, y) {
      ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = css('--panel');
      ctx.fillRect(x - tw / 2 - 5, y - 10, tw + 10, 20);
      ctx.strokeStyle = css('--line');
      ctx.lineWidth = 1;
      ctx.strokeRect(x - tw / 2 - 5, y - 10, tw + 10, 20);
      ctx.fillStyle = css('--ink');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
    }

    function draw() {
      if (!cw) return;
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = css('--scene');
      ctx.fillRect(0, 0, cw, ch);
      if (!plan) return;
      const ir = imageRect();
      if (ir) {
        const o = toScreen([0, 0]);
        ctx.fillStyle = '#fff';
        ctx.fillRect(o[0], o[1], ir.w * view.s, ir.h * view.s);
        ctx.globalAlpha = 0.45;
        ctx.drawImage(image, o[0], o[1], ir.w * view.s, ir.h * view.s);
        ctx.globalAlpha = 1;
      }
      const accent = css('--accent'), sel = css('--select'), ink = css('--ink');
      // 房間：淡色底，房名與面積寫在離牆最遠的位置
      for (const r of plan.rooms || []) {
        ctx.beginPath();
        r.polygon.forEach((pt, n) => { const q = toScreen(pt); n ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
        ctx.closePath();
        ctx.fillStyle = r.id === selRoom ? sel : accent;
        ctx.globalAlpha = r.id === selRoom ? 0.22 : 0.08;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // 牆只畫實心的部分，門窗的位置留空，另外畫門窗符號
      for (const w of plan.walls) {
        if (!FPPlan.wallLength(w)) continue;
        const ops = FPPlan.openingsOf(plan, w.id);
        const spans = FPPlan.openingSpans(w, ops);
        let cur = 0;
        const solid = [];
        for (const sp of spans) { if (sp.s0 > cur) solid.push([cur, sp.s0]); cur = Math.max(cur, sp.s1); }
        if (cur < FPPlan.wallLength(w)) solid.push([cur, FPPlan.wallLength(w)]);
        ctx.fillStyle = w.id === selected ? sel : accent;
        ctx.globalAlpha = w.id === selected ? 0.9 : 0.75;
        // 矮牆、玻璃欄杆畫淡一點，中間加一條線
        if (w.kind) ctx.globalAlpha *= 0.45;
        for (const [s0, s1] of solid) { spanPath(w, s0, s1, w.thickness); ctx.fill(); }
        ctx.globalAlpha = 1;
        if (w.kind) {
          const p0 = toScreen(w.a), p1 = toScreen(w.b);
          ctx.strokeStyle = w.id === selected ? sel : accent;
          ctx.lineWidth = 1.5;
          ctx.setLineDash(w.kind === 'glass' ? [6, 4] : []);
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
          ctx.setLineDash([]);
        }
        for (const sp of spans) drawOpening(w, sp, sp.o.id === selOpening ? sel : ink);
      }
      for (const f of FPFurniture.layered(plan)) drawFurniture(f, f.id === selFurn ? sel : ink, 1);
      if (tool === 'furniture' && hover && !drag) {
        const def = FPFurniture.item(placeModel);
        if (def) drawFurniture({ model: placeModel, pos: hover, rotation: 0, w: def.w, d: def.d }, sel, 0.6);
      }
      for (const r of plan.rooms || []) {
        const q = toScreen(r.label);
        const sub = r.area.toFixed(1) + ' m² · ' + FPRooms.toPing(r.area).toFixed(1) + ' 坪';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
        const tw = ctx.measureText(sub).width;
        ctx.font = '600 14px "Noto Sans TC", system-ui, sans-serif';
        const bw = Math.max(tw, ctx.measureText(r.name).width) + 14;
        // 底下墊一塊半透明的底，避免和原圖上的文字疊在一起看不清楚
        ctx.fillStyle = css('--panel');
        ctx.globalAlpha = 0.85;
        ctx.fillRect(q[0] - bw / 2, q[1] - 21, bw, 42);
        ctx.globalAlpha = 1;
        ctx.fillStyle = r.id === selRoom ? sel : ink;
        ctx.fillText(r.name, q[0], q[1] - 9);
        ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(sub, q[0], q[1] + 9);
      }
      const so = selOpening && FPEdit.findOpening(plan, selOpening);
      const sf = selFurn && FPEdit.findFurniture(plan, selFurn);
      if (sf) {
        // 選取中的家具：四個角畫小方塊
        for (const q of FPFurniture.footprint(sf).map(toScreen)) {
          ctx.fillStyle = '#fff'; ctx.fillRect(q[0] - 4, q[1] - 4, 8, 8);
          ctx.strokeStyle = sel; ctx.lineWidth = 2; ctx.strokeRect(q[0] - 4, q[1] - 4, 8, 8);
        }
      }
      if (so && drag && drag.type === 'opening') {
        const w = FPEdit.findWall(plan, so.wall), L = FPPlan.wallLength(w);
        const c = toScreen([w.a[0] + (w.b[0] - w.a[0]) * so.offset / L, w.a[1] + (w.b[1] - w.a[1]) * so.offset / L]);
        label('寬 ' + so.width.toFixed(2) + ' m', c[0], c[1] - 22);
      }
      // 端點：所有牆畫小點，選取中的牆畫可拖曳的方塊
      ctx.fillStyle = ink;
      for (const w of plan.walls) {
        for (const p of [w.a, w.b]) {
          const s = toScreen(p);
          ctx.beginPath(); ctx.arc(s[0], s[1], 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      const sw = selected && FPEdit.findWall(plan, selected);
      if (sw) {
        for (const p of [sw.a, sw.b]) {
          const s = toScreen(p);
          ctx.fillStyle = '#fff';
          ctx.fillRect(s[0] - 5, s[1] - 5, 10, 10);
          ctx.strokeStyle = sel;
          ctx.lineWidth = 2;
          ctx.strokeRect(s[0] - 5, s[1] - 5, 10, 10);
        }
        if (drag && (drag.type === 'end' || drag.type === 'move')) {
          const m = toScreen([(sw.a[0] + sw.b[0]) / 2, (sw.a[1] + sw.b[1]) / 2]);
          label(FPPlan.wallLength(sw).toFixed(2) + ' m', m[0], m[1] - 18);
        }
      }
      if (draft) {
        const a = toScreen(draft.a), b = toScreen(draft.b);
        ctx.strokeStyle = sel;
        ctx.lineWidth = Math.max(2, defaultThickness() * view.s);
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.globalAlpha = 1;
        label(Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]).toFixed(2) + ' m', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 18);
      }
      if (scalePts.length) {
        ctx.strokeStyle = css('--danger');
        ctx.fillStyle = css('--danger');
        ctx.lineWidth = 2;
        const pts = scalePts.map(toScreen);
        if (pts.length === 2) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke(); }
        for (const s of pts) {
          ctx.beginPath(); ctx.moveTo(s[0] - 7, s[1]); ctx.lineTo(s[0] + 7, s[1]); ctx.moveTo(s[0], s[1] - 7); ctx.lineTo(s[0], s[1] + 7); ctx.stroke();
        }
      }
    }

    function defaultThickness() {
      const sw = selected && FPEdit.findWall(plan, selected);
      if (sw) return sw.thickness;
      if (!plan || !plan.walls.length) return 0.15;
      const t = plan.walls.map(w => w.thickness).sort((x, y) => x - y);
      return t[t.length >> 1];
    }

    function select(kind, id) {
      selected = kind === 'wall' ? id : null;
      selOpening = kind === 'opening' ? id : null;
      selRoom = kind === 'room' ? id : null;
      selFurn = kind === 'furniture' ? id : null;
    }
    const findRoom = id => (plan.rooms || []).find(r => r.id === id) || null;

    function emit() {
      if (opts.onSelect) {
        const w = selected && FPEdit.findWall(plan, selected);
        const o = selOpening && FPEdit.findOpening(plan, selOpening);
        const r = selRoom && findRoom(selRoom);
        const f = selFurn && FPEdit.findFurniture(plan, selFurn);
        opts.onSelect(w ? { kind: 'wall', item: w } : o ? { kind: 'opening', item: o } : r ? { kind: 'room', item: r } : f ? { kind: 'furniture', item: f } : null);
      }
      if (opts.onHistory) opts.onHistory({ canUndo: history.canUndo, canRedo: history.canRedo });
    }

    function commit() {
      if (opts.onCommit) opts.onCommit();
      emit();
      draw();
    }

    // 拖曳端點或畫牆時的吸附：先找其他牆的端點，找不到就嘗試拉直（按住 Alt 不拉直）
    function snapped(p, anchor, excludeId, free) {
      const hit = FPEdit.snapToEndpoint(plan, p, tol(), excludeId);
      if (hit) return hit;
      return anchor && !free ? FPEdit.snapOrtho(anchor, p, 8) : p;
    }

    canvas.addEventListener('pointerdown', e => {
      if (!plan) return;
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      const p = toWorld(e);
      if (e.button === 1 || spaceDown) {
        drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
        return;
      }
      if (e.button !== 0) return;
      if (tool === 'wall') {
        const a = snapped(p, null, null, true);
        draft = { a, b: a };
        drag = { type: 'draw' };
      } else if (tool === 'scale') {
        if (scalePts.length === 2) scalePts = [];
        scalePts.push(snapped(p, scalePts[0], null, e.altKey));
        if (scalePts.length === 2 && opts.onScaleMeasured) {
          opts.onScaleMeasured(Math.hypot(scalePts[1][0] - scalePts[0][0], scalePts[1][1] - scalePts[0][1]));
        }
        draw();
      } else if (tool === 'furniture') {
        // 點一下放一件家具，放好就切回選取，按住不放可以直接拖到想要的位置
        history.record(plan);
        const f = FPEdit.addFurniture(plan, placeModel, p, 0);
        if (!f) return;
        select('furniture', f.id);
        hover = null;
        setTool('select');
        drag = { type: 'furn', id: f.id, grab: [0, 0], start: p, recorded: true, placed: true };
        commit();
      } else if (tool === 'door' || tool === 'window') {
        // 點在牆上，就在那個位置加一扇門或一扇窗
        const hit = FPEdit.hitTest(plan, p, tol(), null);
        if (!hit) { if (opts.onMiss) opts.onMiss(); return; }
        const w = FPEdit.findWall(plan, hit.id);
        history.record(plan);
        const o = FPEdit.addOpening(plan, w.id, tool, FPEdit.projectOnWall(w, p), FPPlan.OPENING_DEFAULTS[tool].width);
        select('opening', o.id);
        commit();
      } else {
        const hit = FPEdit.hitTest(plan, p, tol(), selected);
        const ho = !(hit && hit.part !== 'body') && FPEdit.hitOpening(plan, p, tol());
        const hf = !(hit && hit.part !== 'body') && !ho && FPFurniture.hit(plan, p, 0);
        if (hit && hit.part !== 'body') {
          drag = { type: 'end', id: hit.id, part: hit.part, recorded: false };
        } else if (ho) {
          select('opening', ho.id);
          const w = FPEdit.findWall(plan, ho.wall);
          drag = { type: 'opening', id: ho.id, grab: FPEdit.projectOnWall(w, p) - ho.offset, start: p, recorded: false };
          emit();
        } else if (hf) {
          select('furniture', hf.id);
          drag = { type: 'furn', id: hf.id, grab: [p[0] - hf.pos[0], p[1] - hf.pos[1]], start: p, recorded: false };
          emit();
        } else if (hit) {
          select('wall', hit.id);
          const w = FPEdit.findWall(plan, hit.id);
          drag = { type: 'move', id: hit.id, start: p, orig: { a: w.a.slice(), b: w.b.slice() }, recorded: false };
          emit();
        } else {
          // 點在房間裡：選取房間（可以改名），同時也能拖曳平移
          const room = FPRooms.hitRoom(plan, p);
          if ((room ? room.id : null) !== selRoom || selected || selOpening || selFurn) { select(room ? 'room' : null, room && room.id); emit(); }
          drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
        }
        draw();
      }
    });

    canvas.addEventListener('pointermove', e => {
      if (!plan) return;
      const p = toWorld(e);
      if (!drag) {
        if (tool === 'select') {
          const hit = FPEdit.hitTest(plan, p, tol(), selected);
          canvas.style.cursor = !hit ? (FPFurniture.hit(plan, p, 0) ? 'move' : 'grab') : hit.part === 'body' ? 'move' : 'crosshair';
        } else if (tool === 'furniture') {
          hover = p;
          canvas.style.cursor = 'copy';
          draw();
        } else if (tool === 'door' || tool === 'window') {
          canvas.style.cursor = FPEdit.hitTest(plan, p, tol(), null) ? 'copy' : 'not-allowed';
        } else {
          canvas.style.cursor = 'crosshair';
        }
        return;
      }
      if (drag.type === 'pan') {
        view.ox = drag.ox + e.clientX - drag.sx;
        view.oy = drag.oy + e.clientY - drag.sy;
        userMoved = true;
      } else if (drag.type === 'end') {
        if (!drag.recorded) { history.record(plan); drag.recorded = true; }
        const w = FPEdit.findWall(plan, drag.id);
        const other = drag.part === 'a' ? w.b : w.a;
        FPEdit.moveEndpoint(plan, drag.id, drag.part, snapped(p, other, drag.id, e.altKey));
      } else if (drag.type === 'move') {
        const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
        if (!drag.recorded) {
          if (Math.hypot(dx, dy) < tol() / 2) return;   // 只是點選，不算移動
          history.record(plan);
          drag.recorded = true;
        }
        FPEdit.moveWall(plan, drag.id, drag.orig, dx, dy);
      } else if (drag.type === 'opening') {
        if (!drag.recorded) {
          if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) < tol() / 2) return;
          history.record(plan);
          drag.recorded = true;
        }
        const o = FPEdit.findOpening(plan, drag.id);
        FPEdit.moveOpening(plan, drag.id, FPEdit.projectOnWall(FPEdit.findWall(plan, o.wall), p) - drag.grab);
      } else if (drag.type === 'furn') {
        if (!drag.recorded) {
          if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) < tol() / 2) return;
          history.record(plan);
          drag.recorded = true;
        }
        FPEdit.moveFurniture(plan, drag.id, [p[0] - drag.grab[0], p[1] - drag.grab[1]]);
      } else if (drag.type === 'draw') {
        draft.b = snapped(p, draft.a, null, e.altKey);
      }
      draw();
    });

    function endDrag() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if ((d.type === 'end' || d.type === 'move' || d.type === 'opening' || d.type === 'furn') && d.recorded) {
        commit();
      } else if (d.type === 'draw') {
        const len = Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]);
        if (len >= MIN_WALL) {
          history.record(plan);
          const w = FPEdit.addWall(plan, draft.a, draft.b, defaultThickness(), opts.getWallHeight());
          select('wall', w.id);
          draft = null;
          commit();
          return;
        }
        draft = null;
      }
      draw();
    }
    canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; draw(); } });
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('wheel', e => {
      if (!plan) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.exp(-e.deltaY * 0.0015);
      const s = Math.min(2000, Math.max(5, view.s * k));
      view.ox = mx - (mx - view.ox) * s / view.s;
      view.oy = my - (my - view.oy) * s / view.s;
      view.s = s;
      userMoved = true;
      draw();
    }, { passive: false });

    canvas.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (e.key === 'Escape') { cancel(); }
      else if (e.key === ' ') { e.preventDefault(); spaceDown = true; }
      else if (!mod && e.key.toLowerCase() === 'v') setTool('select');
      else if (!mod && e.key.toLowerCase() === 'w') setTool('wall');
      else if (!mod && e.key.toLowerCase() === 'd') setTool('door');
      else if (!mod && e.key.toLowerCase() === 'n') setTool('window');
      else if (!mod && e.key.toLowerCase() === 'f') setTool('furniture');
      else if (!mod && e.key.toLowerCase() === 'r' && selFurn) rotateFurniture(e.shiftKey ? -90 : 90);
    });
    canvas.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });

    function cancel() {
      draft = null;
      scalePts = [];
      if (opts.onScaleMeasured) opts.onScaleMeasured(null);
      if (selected || selOpening || selRoom || selFurn) { select(null); emit(); }
      draw();
    }

    function setTool(t) {
      tool = t;
      draft = null;
      if (t !== 'furniture') hover = null;
      if (t !== 'scale' && scalePts.length) { scalePts = []; if (opts.onScaleMeasured) opts.onScaleMeasured(null); }
      if (opts.onTool) opts.onTool(t);
      draw();
    }

    function deleteSelected() {
      if (!selected && !selOpening && !selFurn) return;
      history.record(plan);
      if (selected) FPEdit.deleteWall(plan, selected);
      else if (selOpening) FPEdit.deleteOpening(plan, selOpening);
      else FPEdit.deleteFurniture(plan, selFurn);
      select(null);
      commit();
    }

    function dropStaleSelection() {
      if (selected && !FPEdit.findWall(plan, selected)) selected = null;
      if (selOpening && !FPEdit.findOpening(plan, selOpening)) selOpening = null;
      if (selRoom && !findRoom(selRoom)) selRoom = null;
      if (selFurn && !FPEdit.findFurniture(plan, selFurn)) selFurn = null;
    }

    function undo() {
      if (!history.undo(plan)) return;
      dropStaleSelection();
      commit();
    }

    function redo() {
      if (!history.redo(plan)) return;
      dropStaleSelection();
      commit();
    }

    function setThickness(t) {
      const w = selected && FPEdit.findWall(plan, selected);
      if (!w || !(t > 0) || w.thickness === t) return;
      history.record(plan);
      w.thickness = Math.round(t * 1000) / 1000;
      commit();
    }

    function setOpeningWidth(v) {
      const o = selOpening && FPEdit.findOpening(plan, selOpening);
      if (!o || !(v > 0) || o.width === v) return;
      history.record(plan);
      FPEdit.setOpeningWidth(plan, o.id, v);
      commit();
    }

    function setWindowSize(sill, height) {
      const o = selOpening && FPEdit.findOpening(plan, selOpening);
      if (!o || o.type !== 'window' || (o.sill === sill && o.height === height)) return;
      history.record(plan);
      FPEdit.setWindowSize(plan, o.id, sill, height);
      commit();
    }

    function setWallKind(kind) {
      const w = selected && FPEdit.findWall(plan, selected);
      if (!w || (w.kind || '') === (kind || '')) return;
      history.record(plan);
      FPEdit.setWallKind(plan, w.id, kind);
      commit();
    }

    function renameRoom(name) {
      const r = selRoom && findRoom(selRoom);
      name = (name || '').trim();
      if (!r || !name || r.name === name) return;
      history.record(plan);
      r.name = name;
      commit();
    }

    // 地板材質：roomId 省略時改選取中的房間
    function setRoomFloor(floor, roomId) {
      const r = findRoom(roomId || selRoom);
      if (!r || (r.floor || FPMaterials.DEFAULT_FLOOR) === floor) return;
      history.record(plan);
      r.floor = floor;
      commit();
    }

    // 房間的牆色：paint 空字串表示跟全屋的牆面顏色一樣
    function setRoomPaint(paint, roomId) {
      const r = findRoom(roomId || selRoom);
      if (!r || (r.paint || '') === (paint || '')) return;
      history.record(plan);
      if (paint) r.paint = paint;
      else delete r.paint;
      commit();
    }

    function rotateFurniture(deg) {
      if (!selFurn || !FPEdit.findFurniture(plan, selFurn)) return;
      history.record(plan);
      FPEdit.rotateFurniture(plan, selFurn, deg);
      commit();
    }

    function setFurnitureSize(w, d) {
      const f = selFurn && FPEdit.findFurniture(plan, selFurn);
      if (!f || !(w > 0) || !(d > 0) || (f.w === w && f.d === d)) return;
      history.record(plan);
      FPEdit.setFurnitureSize(plan, f.id, w, d);
      commit();
    }

    function setFurnitureColor(color) {
      const f = selFurn && FPEdit.findFurniture(plan, selFurn);
      if (!f || (f.color || '') === (color || '')) return;
      history.record(plan);
      FPEdit.setFurnitureColor(plan, f.id, color);
      commit();
    }

    // 裝修方案的新增、切換、改名、刪除（fn 直接修改平面圖，回傳 false 表示沒有改變）
    function schemeOp(fn) {
      if (!plan) return;
      history.record(plan);
      if (fn(plan) === false) { history.past.pop(); return; }
      dropStaleSelection();
      commit();
    }

    // 牆面顏色（整間房子一起換）
    function setWallPaint(id) {
      if (!plan) return;
      const cur = (plan.materials && plan.materials.wall) || FPMaterials.DEFAULT_WALL;
      if (cur === id) return;
      history.record(plan);
      plan.materials = { ...(plan.materials || {}), wall: id };
      commit();
    }

    function flipDoor() {
      const o = selOpening && FPEdit.findOpening(plan, selOpening);
      if (!o || o.type !== 'door') return;
      history.record(plan);
      FPEdit.flipDoor(plan, o.id);
      commit();
    }

    // 整張圖放大 k 倍（比例尺或修改圖面寬度時使用），可以復原
    function rescale(k) {
      if (!plan || !(k > 0) || k === 1) return;
      history.record(plan);
      FPEdit.rescale(plan, k);
      scalePts = [];
      fit();
      commit();
    }

    function setPlan(p, img, options) {
      plan = p;
      image = img;
      if (!options || options.resetHistory !== false) history.clear();
      dropStaleSelection();
      draft = null;
      scalePts = [];
      if (!options || !options.keepView) fit();
      emit();
      draw();
    }

    return {
      setPlan, setTool, deleteSelected, rotateFurniture, setFurnitureSize, setFurnitureColor, setWallPaint, schemeOp,
      setPlaceModel: m => { placeModel = m; draw(); }, undo, redo, setThickness, setOpeningWidth, setWindowSize, setWallKind, flipDoor, renameRoom, setRoomFloor, setRoomPaint, rescale, cancel,
      fit: () => { fit(); draw(); },
      redraw: draw,
      get tool() { return tool; }
    };
  }

  root.FPEditor = { create: createEditor };
})(self);
