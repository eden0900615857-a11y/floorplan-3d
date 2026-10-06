// 圖片辨識流程：把 detect（牆像素）、vectorize（直線段）、openings（門窗）、ml（AI 辨識）串起來，
// 灰階圖進來，牆的線段和門窗出去（都還是像素座標，交給 FPPlan.fromSegments 換成公尺）。
// 不碰畫面，可以在 Node 測試：調整任何一步的門檻之後，用 test/pipeline.test.js 確認範例圖的結果沒有變。
(function (root, factory) {
  const req = typeof require === 'function' ? require : () => null;
  const api = factory(root.FPDetect || req('./detect.js'), root.FPVectorize || req('./vectorize.js'),
    root.FPOpenings || req('./openings.js'), root.FPML || req('./ml.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPPipeline = api;
})(typeof self !== 'undefined' ? self : this, function (FPDetect, FPVectorize, FPOpenings, FPML) {
  // src：{w, h, gray, cgray, blue}（FPDetect.colorGray、blueInk 的結果；不開彩色模式時只需要 gray）
  // opts：
  //   ppm           每公尺幾個像素（門窗缺口的寬度範圍、接牆距離都依比例換算）
  //   threshold     黑白門檻，數字或 'auto'
  //   minThickness  最小牆厚（像素）
  //   invert        深色底、淺色線
  //   color         彩色格局圖：用 cgray 找牆，淺藍色（blue）當作窗線
  //   ml            AI 模型的輸出（FPML.run 的結果）；有的話牆像素改由模型判斷
  //   autoScale     用門洞寬度推算比例，和 ppm 差超過 3% 就用新的比例重新辨識一次
  // 回傳 {segments, openings, coverage, threshold, ppm, scaled}；scaled 表示有照門寬推算出比例（ppm 是推算後的）
  function raster(src, opts) {
    const { w, h } = src, color = !!opts.color, ml = opts.ml || null, minThickness = opts.minThickness;
    const mask = FPDetect.wallMask(color ? src.cgray : src.gray, w, h, {
      threshold: opts.threshold, invert: !!opts.invert, minThickness
    });
    const build = ppm => {
      // 牆：AI 辨識用模型找到的牆像素，否則用黑白門檻找到的粗線
      const vec = ml ? FPML.walls(ml, w, h, ppm) : FPVectorize.extractWalls(mask.walls, w, h, { minThickness });
      const walls = ml ? vec.mask : mask.walls;
      // 圖片裁到外牆時，沿著圖片邊緣補牆（AI 辨識在 FPML.walls 裡已經補過）
      const closed = ml ? vec : FPVectorize.closeBorder(vec.segments, w, h);
      // 門窗：只看牆以外的細線（門弧、窗線），缺口寬度限制在 0.5–2.5 公尺
      const ink = new Uint8Array(mask.raw.length);
      for (let i = 0; i < ink.length; i++) ink[i] = (mask.raw[i] | (color ? src.blue[i] : 0)) & (1 - (mask.walls[i] | walls[i]));
      // AI 辨識時，規則找不到開門弧或窗線的缺口，再問模型是不是門窗
      const ops = FPOpenings.detect(closed.segments, ink, w, h, {
        minGap: 0.5 * ppm, maxGap: 2.5 * ppm, hint: ml ? FPML.openingHint(ml, w, h) : null
      });
      // 外牆沒畫完整（圖片裁掉、陽台只有細欄杆線）的地方，把牆沿著外緣延伸接起來，讓房間封閉
      FPVectorize.closeOuter(ops.segments, w, h, { tol: 0.25 * ppm, reach: 0.5 * ppm, maxLen: 6 * ppm });
      return { vec, ops };
    };
    let ppm = opts.ppm, scaled = false;
    let { vec, ops } = build(ppm);
    if (opts.autoScale) {
      const est = FPOpenings.scaleFromDoors(ops.openings);
      if (est) {
        scaled = true;
        if (Math.abs(est / ppm - 1) > 0.03) { ppm = est; ({ vec, ops } = build(ppm)); }
      }
    }
    return { segments: ops.segments, openings: ops.openings, coverage: vec.coverage, threshold: mask.threshold, ppm, scaled };
  }

  return { raster };
});
