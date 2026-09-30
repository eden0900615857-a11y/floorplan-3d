// 3D 場景：只根據平面圖 JSON 產生牆與地板（需要全域 THREE 與 THREE.OrbitControls）。
(function (root) {
  function createScene(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b98a6, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9cc7e8, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
    let walls = null, glass = null, floor = null, span = 0;

    function clear() {
      if (walls) { scene.remove(walls); walls.dispose(); walls = null; }
      if (glass) { scene.remove(glass); glass.dispose(); glass = null; }
      if (floor) {
        scene.remove(floor);
        floor.geometry.dispose();
        if (floor.material.map) floor.material.map.dispose();
        floor.material.dispose();
        floor = null;
      }
    }

    // plan：平面圖 JSON；image：原圖（Canvas 或 Image），有的話貼在地板上
    function setPlan(plan, image) {
      clear();
      const bb = FPPlan.bounds(plan);
      const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
      // 每面牆依門窗切成數個方塊；窗戶另外放一片玻璃
      const boxes = [], panes = [];
      for (const w of plan.walls) {
        const L = FPPlan.wallLength(w);
        if (!L) continue;
        const ops = FPPlan.openingsOf(plan, w.id);
        for (const pc of FPPlan.wallPieces(w, ops)) boxes.push({ w, L, s0: pc.s0, s1: pc.s1, y0: pc.y0, y1: pc.y1, t: w.thickness });
        for (const sp of FPPlan.openingSpans(w, ops)) {
          if (sp.o.type !== 'window') continue;
          const y0 = Math.min(sp.o.sill || 0, w.height), y1 = Math.min(w.height, y0 + sp.o.height);
          if (y1 > y0) panes.push({ w, L, s0: sp.s0, s1: sp.s1, y0, y1, t: Math.min(0.02, w.thickness * 0.3) });
        }
      }
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      function instanced(list, mat) {
        const mesh = new THREE.InstancedMesh(box, mat, Math.max(1, list.length));
        mesh.count = list.length;
        list.forEach((b, i) => {
          const ux = (b.w.b[0] - b.w.a[0]) / b.L, uy = (b.w.b[1] - b.w.a[1]) / b.L, mid = (b.s0 + b.s1) / 2;
          p.set(b.w.a[0] + ux * mid - cx, b.y0, b.w.a[1] + uy * mid - cy);
          // 平面圖的 y 對應 3D 的 z；方塊的長邊（x 軸）轉到 a→b 的方向
          q.setFromAxisAngle(up, -Math.atan2(uy, ux));
          sc.set(b.s1 - b.s0, b.y1 - b.y0, b.t);
          m.compose(p, q, sc);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
        return mesh;
      }
      walls = instanced(boxes, wallMat);
      walls.castShadow = true;
      walls.receiveShadow = true;
      glass = instanced(panes, glassMat);
      scene.add(glass);
      scene.add(walls);

      const fw = bb.maxX - bb.minX, fh = bb.maxY - bb.minY;
      const floorMat = new THREE.MeshStandardMaterial({ color: image ? 0xffffff : 0xdfe4e9, roughness: 1 });
      if (image) {
        const tex = new THREE.CanvasTexture(image);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        floorMat.map = tex;
      }
      floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.001;
      floor.receiveShadow = true;
      scene.add(floor);

      const newSpan = Math.max(fw, fh);
      const sh = sun.shadow.camera;
      sh.left = -newSpan; sh.right = newSpan; sh.top = newSpan; sh.bottom = -newSpan;
      sh.near = 0.1; sh.far = newSpan * 4;
      sh.updateProjectionMatrix();
      sun.position.set(newSpan * 0.6, newSpan * 1.2, newSpan * 0.8);
      if (Math.abs(newSpan - span) > 0.01) { span = newSpan; resetCamera(); }
    }

    function resetCamera() {
      camera.position.set(span * 0.1, span * 1.0, span * 0.95);
      controls.target.set(0, 0, 0);
      controls.update();
    }

    function resize() {
      const r = container.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(container);
    resize();
    (function loop() {
      requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    })();

    return { setPlan, resetCamera };
  }

  root.FPScene = { create: createScene };
})(self);
