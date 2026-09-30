// 3D 場景：只根據平面圖 JSON 產生牆與地板（需要全域 THREE 與 THREE.OrbitControls）。
// 兩種看法：從上方環繞檢視（OrbitControls），或第一人稱走進房子（FPWalk 負責移動與碰撞）。
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

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8b98a6, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    // 走進室內時牆面大多背光，補一點均勻的環境光
    const ambient = new THREE.AmbientLight(0xffffff, 0);
    const sky = new THREE.Color(0xdde7ef);
    scene.add(ambient);

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9cc7e8, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
    let walls = null, glass = null, floor = null, span = 0;
    let roomFloors = null;                 // 每個房間的地板（有材質）
    let ceilings = null;                   // 天花板，只在漫遊時顯示
    let furniture = null;                  // 家具
    const colorMats = new Map();           // 家具顏色 → 材質，重複使用
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.95, side: THREE.DoubleSide });
    const floorMats = new Map();           // 材質 id → MeshStandardMaterial，重複使用
    let center = [0, 0];                   // 平面圖座標的中心，對應 3D 的原點
    let walk = null;                       // 漫遊中：{state, solids, input}
    let plan = null;

    // 地板材質：貼圖一張代表 size 公尺，房間地板的 UV 單位是公尺
    function floorMaterial(id) {
      const f = FPMaterials.floor(id);
      if (floorMats.has(f.id)) return floorMats.get(f.id);
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      FPMaterials.draw(c.getContext('2d'), f, 512);
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1 / f.size, 1 / f.size);
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: f.id === 'marble' || f.id === 'tile-white' ? 0.45 : 0.8 });
      floorMats.set(f.id, mat);
      return mat;
    }

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
      if (roomFloors) {
        scene.remove(roomFloors);
        roomFloors.children.forEach(m => m.geometry.dispose());
        roomFloors = null;
      }
      if (ceilings) {
        scene.remove(ceilings);
        ceilings.children.forEach(m => m.geometry.dispose());
        ceilings = null;
      }
      if (furniture) { scene.remove(furniture); furniture = null; }
    }

    // plan：平面圖 JSON；image：原圖（Canvas 或 Image），有的話貼在地板上
    function setPlan(next, image) {
      plan = next;
      clear();
      const bb = FPPlan.bounds(plan);
      const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
      center = [cx, cy];
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

      // 房間地板：平面圖的 (x, y) 對應 3D 的 (x, 0, y)，稍微高於原圖，避免互相閃爍
      roomFloors = new THREE.Group();
      for (const r of plan.rooms || []) {
        const shape = new THREE.Shape(r.polygon.map(q => new THREE.Vector2(q[0] - cx, -(q[1] - cy))));
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial(r.floor));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.002;
        mesh.receiveShadow = true;
        roomFloors.add(mesh);
      }
      scene.add(roomFloors);
      ceilings = new THREE.Group();
      const top = Math.max(0, ...plan.walls.map(w => w.height));
      // 整棟房子蓋一片天花板，門洞上方（不屬於任何房間）也蓋得到
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(bb.maxX - bb.minX, bb.maxY - bb.minY), ceilingMat);
      ceil.rotation.x = -Math.PI / 2;
      ceil.position.y = top;
      ceilings.add(ceil);
      ceilings.visible = !!walk;
      scene.add(ceilings);

      // 家具：每件由幾個方塊組成，共用同一個方塊幾何
      furniture = new THREE.Group();
      for (const f of plan.furniture || []) {
        for (const b of FPFurniture.parts(f)) {
          if (!colorMats.has(b.color)) colorMats.set(b.color, new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.75 }));
          const mesh = new THREE.Mesh(box, colorMats.get(b.color));
          mesh.position.set(b.x - cx, b.z0, b.y - cy);
          mesh.rotation.y = -b.rotation * Math.PI / 180;
          mesh.scale.set(Math.max(0.005, b.w), Math.max(0.005, b.z1 - b.z0), Math.max(0.005, b.d));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          furniture.add(mesh);
        }
      }
      scene.add(furniture);
      wallMat.color.set(FPMaterials.wall(plan.materials && plan.materials.wall).color);
      if (walk) walk.solids = FPWalk.solids(plan);

      const newSpan = Math.max(fw, fh);
      const sh = sun.shadow.camera;
      sh.left = -newSpan; sh.right = newSpan; sh.top = newSpan; sh.bottom = -newSpan;
      sh.near = 0.1; sh.far = newSpan * 4;
      sh.updateProjectionMatrix();
      sun.position.set(newSpan * 0.6, newSpan * 1.2, newSpan * 0.8);
      if (Math.abs(newSpan - span) > 0.01) { span = newSpan; resetCamera(); }
    }

    // 第一人稱：滑鼠或手指拖曳轉頭，input 由鍵盤或畫面上的按鈕設定
    function setWalk(on) {
      if (on && plan) {
        const solids = FPWalk.solids(plan);
        walk = { state: FPWalk.start(plan, solids), solids, input: {} };
        [walk.state.x, walk.state.y] = FPWalk.collide([walk.state.x, walk.state.y], walk.solids);
        controls.enabled = false;
        camera.fov = 70;
        // 室內近看時陽光直射的牆面會過曝，把光線調柔和一點
        ambient.intensity = 0.15; hemi.intensity = 0.55; sun.intensity = 0.4;
        // 從門窗看出去是天空色，不是網頁背景
        scene.background = sky;
        if (ceilings) ceilings.visible = true;
      } else {
        walk = null;
        controls.enabled = true;
        camera.fov = 45;
        ambient.intensity = 0; hemi.intensity = 0.75; sun.intensity = 0.75;
        scene.background = null;
        if (ceilings) ceilings.visible = false;
        resetCamera();
      }
      camera.updateProjectionMatrix();
    }

    let look = null;
    renderer.domElement.addEventListener('pointerdown', e => {
      if (!walk) return;
      look = { x: e.clientX, y: e.clientY };
      renderer.domElement.setPointerCapture(e.pointerId);
    });
    renderer.domElement.addEventListener('pointermove', e => {
      if (!walk || !look) return;
      walk.state.yaw += (e.clientX - look.x) * 0.005;
      walk.state.pitch = Math.max(-1.2, Math.min(1.2, walk.state.pitch - (e.clientY - look.y) * 0.005));
      look = { x: e.clientX, y: e.clientY };
    });
    const endLook = () => { look = null; };
    renderer.domElement.addEventListener('pointerup', endLook);
    renderer.domElement.addEventListener('pointercancel', endLook);

    function placeWalkCamera() {
      const st = walk.state;
      camera.position.set(st.x - center[0], FPWalk.EYE, st.y - center[1]);
      // yaw 是平面圖上的方向（y 向下），3D 的 z 軸就是平面圖的 y
      const dx = Math.cos(st.yaw) * Math.cos(st.pitch), dz = Math.sin(st.yaw) * Math.cos(st.pitch), dy = Math.sin(st.pitch);
      camera.lookAt(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz);
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
    let last = performance.now();
    (function loop(now) {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, ((now || performance.now()) - last) / 1000);
      last = now || performance.now();
      if (walk) {
        FPWalk.step(walk.state, walk.input, dt, walk.solids);
        placeWalkCamera();
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
    })();

    // 目前畫面畫到一張新的 canvas（透明的背景填上底色）
    function snapshot(bg) {
      renderer.render(scene, camera);
      const src = renderer.domElement, c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const g = c.getContext('2d');
      g.fillStyle = bg || '#EDF0F3';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0);
      return c;
    }

    return {
      setPlan, resetCamera, setWalk, snapshot,
      get walking() { return !!walk; },
      // 漫遊時的移動輸入：{forward, back, left, right, turnLeft, turnRight, fast}
      setInput(key, value) { if (walk) walk.input[key] = value; }
    };
  }

  root.FPScene = { create: createScene };
})(self);
