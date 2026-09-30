// 2D 校正編輯器：在原圖上直接修正牆。
// 工具：選取（移動牆、拖曳端點）、畫牆、比例尺。支援縮放、平移、復原與重做。
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

    let plan = null, image = null, tool = 'select', selected = null;
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

    function wallPath(w) {
      const a = toScreen(w.a), b = toScreen(w.b);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      ctx.save();
      ctx.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
      ctx.beginPath();
      ctx.rect(-len / 2, -w.thickness * view.s / 2, len, Math.max(1, w.thickness * view.s));
      ctx.restore();
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
      for (const w of plan.walls) {
        wallPath(w);
        ctx.fillStyle = w.id === selected ? sel : accent;
        ctx.globalAlpha = w.id === selected ? 0.9 : 0.75;
        ctx.fill();
        ctx.globalAlpha = 1;
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

    function emit() {
      if (opts.onSelect) opts.onSelect(selected ? FPEdit.findWall(plan, selected) : null);
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
      } else {
        const hit = FPEdit.hitTest(plan, p, tol(), selected);
        if (hit && hit.part !== 'body') {
          drag = { type: 'end', id: hit.id, part: hit.part, recorded: false };
        } else if (hit) {
          selected = hit.id;
          const w = FPEdit.findWall(plan, hit.id);
          drag = { type: 'move', id: hit.id, start: p, orig: { a: w.a.slice(), b: w.b.slice() }, recorded: false };
          emit();
        } else {
          if (selected) { selected = null; emit(); }
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
          canvas.style.cursor = !hit ? 'grab' : hit.part === 'body' ? 'move' : 'crosshair';
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
      } else if (drag.type === 'draw') {
        draft.b = snapped(p, draft.a, null, e.altKey);
      }
      draw();
    });

    function endDrag() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if ((d.type === 'end' || d.type === 'move') && d.recorded) {
        commit();
      } else if (d.type === 'draw') {
        const len = Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]);
        if (len >= MIN_WALL) {
          history.record(plan);
          const w = FPEdit.addWall(plan, draft.a, draft.b, defaultThickness(), opts.getWallHeight());
          selected = w.id;
          draft = null;
          commit();
          return;
        }
        draft = null;
      }
      draw();
    }
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
    });
    canvas.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });

    function cancel() {
      draft = null;
      scalePts = [];
      if (opts.onScaleMeasured) opts.onScaleMeasured(null);
      if (selected) { selected = null; emit(); }
      draw();
    }

    function setTool(t) {
      tool = t;
      draft = null;
      if (t !== 'scale' && scalePts.length) { scalePts = []; if (opts.onScaleMeasured) opts.onScaleMeasured(null); }
      if (opts.onTool) opts.onTool(t);
      draw();
    }

    function deleteSelected() {
      if (!selected) return;
      history.record(plan);
      FPEdit.deleteWall(plan, selected);
      selected = null;
      commit();
    }

    function undo() {
      if (!history.undo(plan)) return;
      if (selected && !FPEdit.findWall(plan, selected)) selected = null;
      commit();
    }

    function redo() {
      if (!history.redo(plan)) return;
      if (selected && !FPEdit.findWall(plan, selected)) selected = null;
      commit();
    }

    function setThickness(t) {
      const w = selected && FPEdit.findWall(plan, selected);
      if (!w || !(t > 0) || w.thickness === t) return;
      history.record(plan);
      w.thickness = Math.round(t * 1000) / 1000;
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
      if (selected && !FPEdit.findWall(plan, selected)) selected = null;
      draft = null;
      scalePts = [];
      if (!options || !options.keepView) fit();
      emit();
      draw();
    }

    return {
      setPlan, setTool, deleteSelected, undo, redo, setThickness, rescale, cancel,
      fit: () => { fit(); draw(); },
      redraw: draw,
      get tool() { return tool; }
    };
  }

  root.FPEditor = { create: createEditor };
})(self);
