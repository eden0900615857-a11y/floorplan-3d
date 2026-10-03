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
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
    cyl.translate(0, 0.5, 0);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.85 });
    // 門窗零件：門框、窗框（白色）、門片（木色）、門把（金屬）
    const partMats = {
      frame: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0xb08358, roughness: 0.7 }),
      handle: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.8 })
    };
    // 房間各自的牆色（材質依油漆 id 共用）
    const paintMats = new Map();
    function paintMat(id) {
      if (!paintMats.has(id)) paintMats.set(id, new THREE.MeshStandardMaterial({ color: FPMaterials.wall(id).color, roughness: 0.85 }));
      return paintMats.get(id);
    }
    // 吸頂燈的燈罩：開燈時發光
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffe2b8, emissiveIntensity: 0 });
    const MAX_LAMPS = 12;
    // 光線：白天、傍晚、夜晚。數字依序是環境光、天空光、陽光、室內燈；walk 是走進室內時（避免牆面過曝）
    const LIGHTS = {
      day: { sun: 0xffffff, sky: 0xdde7ef, view: [0, 0.75, 0.75, 0], walk: [0.15, 0.55, 0.4, 0] },
      evening: { sun: 0xffa860, sky: 0xe8b98f, view: [0, 0.4, 0.55, 0.7], walk: [0.06, 0.25, 0.3, 0.75] },
      night: { sun: 0x8090b0, sky: 0x1c2333, view: [0.04, 0.1, 0, 0.9], walk: [0.04, 0.06, 0, 0.9] }
    };
    let lightMode = 'day';
    function applyLight() {
      const L = LIGHTS[lightMode] || LIGHTS.day, v = walk ? L.walk : L.view;
      [ambient.intensity, hemi.intensity, sun.intensity] = v;
      sun.color.set(L.sun);
      sky.set(L.sky);
      if (lamps) {
        for (const m of lamps.children) {
          if (m.isLight) m.intensity = v[3];
          else m.visible = !!walk;
        }
      }
      lampMat.emissiveIntensity = v[3] ? 1 : 0;
    }
    function setLight(mode) {
      lightMode = LIGHTS[mode] ? mode : 'day';
      applyLight();
    }
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9cc7e8, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
    let walls = [], glass = null, frames = [], lamps = null, floor = null, span = 0;
    let roomFloors = null;                 // 每個房間的地板（有材質）
    let ceilings = null;                   // 天花板，只在漫遊時顯示
    let furniture = null;                  // 家具
    const colorMats = new Map();           // 家具顏色 → 材質，重複使用
    const modelGeoms = new Map();          // 家具模型名稱 → BufferGeometry，重複使用
    let modelMat = null;                   // 家具模型共用的貼圖材質
    let tintMat = null;                    // 換過顏色的家具模型：貼圖乘上頂點顏色
    const tintGeoms = new Map();           // 「模型|顏色」→ 換色後的 BufferGeometry

    // 家具模型（KayKit，CC0）：幾何已正規化成 1 × 1 × 1，擺放時依家具尺寸縮放
    function modelGeometry(name) {
      if (typeof FPModels === 'undefined' || !FPModels.has(name)) return null;
      if (modelGeoms.has(name)) return modelGeoms.get(name);
      const d = FPModels.decode(name), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
      g.setIndex(new THREE.BufferAttribute(d.index, 1));
      modelGeoms.set(name, g);
      return g;
    }

    // 換色：主色的頂點改用貼圖上的淺色漸層，再乘上頂點顏色；其他部分頂點顏色是白色（不變）
    function tintedGeometry(name, hex) {
      const key = name + '|' + hex;
      if (tintGeoms.has(key)) return tintGeoms.get(key);
      const base = modelGeometry(name);
      if (!base) return null;
      const g = base.clone(), mask = FPModels.mainMask(name).mask, c = new THREE.Color(hex);
      g.setAttribute('uv', new THREE.BufferAttribute(FPModels.tintUV(name), 2));
      const col = new Float32Array(mask.length * 3).fill(1);
      for (let i = 0; i < mask.length; i++) if (mask[i]) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      tintGeoms.set(key, g);
      return g;
    }

    function tintMaterial() {
      if (!tintMat) { tintMat = modelMaterial().clone(); tintMat.vertexColors = true; }
      return tintMat;
    }

    function modelMaterial() {
      if (modelMat) return modelMat;
      const tex = new THREE.TextureLoader().load(FPModels.texture);
      tex.flipY = false;                   // glTF 的 UV 原點在左上
      tex.encoding = THREE.sRGBEncoding;
      modelMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
      return modelMat;
    }
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
      walls.forEach(m => { scene.remove(m); m.dispose(); });
      walls = [];
      if (lamps) {
        scene.remove(lamps);
        lamps.children.forEach(m => m.geometry && m.geometry.dispose());
        lamps = null;
      }
      if (glass) { scene.remove(glass); glass.dispose(); glass = null; }
      frames.forEach(f => { scene.remove(f); f.dispose(); });
      frames = [];
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
      const boxes = [], panes = [], parts = { frame: [], leaf: [], handle: [] };
      const houseWall = plan.materials && plan.materials.wall;
      const roomAt = p => FPRooms.hitRoom(plan, p);
      // 沒有房間的那一面（屋外）和沒選牆色的房間都用全屋的牆面顏色
      const paintOf = r => (r && r.paint) || '';
      for (const w of plan.walls) {
        const L = FPPlan.wallLength(w);
        if (!L) continue;
        const ops = FPPlan.openingsOf(plan, w.id);
        // 牆面依兩側的房間切段，每段的左右牆面用各自房間的牆色
        for (const pc of FPPlan.wallPieces(w, ops)) {
          for (const run of FPPlan.faceRooms(w, pc.s0, pc.s1, roomAt)) {
            boxes.push({ w, L, s0: run.s0, s1: run.s1, y0: pc.y0, y1: pc.y1, t: w.thickness, key: paintOf(run.left) + '|' + paintOf(run.right) });
          }
        }
        for (const sp of FPPlan.openingSpans(w, ops)) {
          for (const pt of FPPlan.openingParts(w, sp)) parts[pt.kind].push({ w, L, ...pt });
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
      // 門窗零件：中心點在 (s, q)，長邊從牆的方向再轉 angle
      function instancedParts(list, mat) {
        const mesh = new THREE.InstancedMesh(box, mat, Math.max(1, list.length));
        mesh.count = list.length;
        list.forEach((b, i) => {
          const ux = (b.w.b[0] - b.w.a[0]) / b.L, uy = (b.w.b[1] - b.w.a[1]) / b.L;
          // 左側法向量（a→b 的左邊，y 向下的座標）是 (uy, −ux)
          p.set(b.w.a[0] + ux * b.s + uy * b.q - cx, b.y0, b.w.a[1] + uy * b.s - ux * b.q - cy);
          q.setFromAxisAngle(up, -Math.atan2(uy, ux) + b.angle);
          sc.set(b.len, b.y1 - b.y0, b.t);
          m.compose(p, q, sc);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
      }
      for (const k in parts) {
        if (!parts[k].length) continue;
        const mesh = instancedParts(parts[k], partMats[k]);
        frames.push(mesh);
        scene.add(mesh);
      }
      // 同樣左右牆色的牆段放在一起。方塊的 +z 面是 a→b 的右側、−z 面是左側
      const groups = new Map();
      for (const b of boxes) {
        if (!groups.has(b.key)) groups.set(b.key, []);
        groups.get(b.key).push(b);
      }
      for (const [key, list] of groups) {
        const [left, right] = key.split('|').map(id => id ? paintMat(id) : wallMat);
        const mesh = instanced(list, [wallMat, wallMat, wallMat, wallMat, right, left]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        walls.push(mesh);
      }
      glass = instanced(panes, glassMat);
      scene.add(glass);
      walls.forEach(m => scene.add(m));

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

      // 家具：有模型的用模型，否則由方塊和橢圓柱組成（共用同一個方塊、圓柱幾何）
      furniture = new THREE.Group();
      for (const f of plan.furniture || []) {
        const def = FPFurniture.item(f.model), geo = def && modelGeometry(def.mesh);
        if (geo) {
          const tinted = f.color && tintedGeometry(def.mesh, f.color);
          const mesh = tinted ? new THREE.Mesh(tinted, tintMaterial()) : new THREE.Mesh(geo, modelMaterial());
          mesh.position.set(f.pos[0] - cx, 0, f.pos[1] - cy);
          mesh.rotation.y = -(f.rotation || 0) * Math.PI / 180;
          mesh.scale.set(f.w, f.h || def.h, f.d);
          mesh.castShadow = def.h > 0.1;
          mesh.receiveShadow = true;
          furniture.add(mesh);
          continue;
        }
        for (const b of FPFurniture.parts(f)) {
          if (!colorMats.has(b.color)) colorMats.set(b.color, new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.75 }));
          const mesh = new THREE.Mesh(b.shape === 'cyl' ? cyl : box, b.glass ? glassMat : colorMats.get(b.color));
          mesh.position.set(b.x - cx, b.z0, b.y - cy);
          mesh.rotation.y = -b.rotation * Math.PI / 180;
          mesh.scale.set(Math.max(0.005, b.w), Math.max(0.005, b.z1 - b.z0), Math.max(0.005, b.d));
          mesh.castShadow = !b.glass;
          mesh.receiveShadow = true;
          furniture.add(mesh);
        }
      }
      scene.add(furniture);
      wallMat.color.set(FPMaterials.wall(houseWall).color);

      // 每個房間天花板中央一盞燈（傍晚、夜晚才開），燈罩只在漫遊時看得到
      lamps = new THREE.Group();
      const lit = (plan.rooms || []).slice().sort((a, b) => b.area - a.area).slice(0, MAX_LAMPS);
      for (const r of lit) {
        const xs = r.polygon.map(p => p[0]), ys = r.polygon.map(p => p[1]);
        const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        const at = r.label || [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
        const light = new THREE.PointLight(0xffd6a0, 0, Math.max(4, size * 1.3), 1.6);
        light.position.set(at[0] - cx, top - 0.35, at[1] - cy);
        light.userData.room = r.id;
        lamps.add(light);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 24), lampMat);
        shade.position.set(at[0] - cx, top - 0.03, at[1] - cy);
        shade.userData.shade = true;
        lamps.add(shade);
      }
      scene.add(lamps);
      applyLight();
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
        applyLight();
        // 從門窗看出去是天空色，不是網頁背景
        scene.background = sky;
        if (ceilings) ceilings.visible = true;
      } else {
        walk = null;
        controls.enabled = true;
        camera.fov = 45;
        applyLight();
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
      setPlan, resetCamera, setWalk, setLight, snapshot,
      get walking() { return !!walk; },
      // 漫遊時的移動輸入：{forward, back, left, right, turnLeft, turnRight, fast}
      setInput(key, value) { if (walk) walk.input[key] = value; }
    };
  }

  root.FPScene = { create: createScene };
})(self);
