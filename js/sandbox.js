/* ============================================================
 * sandbox.js —— 數位沙盤
 * 一盤白沙：地面是細小白方塊（InstancedMesh）鋪成、帶沙面起伏
 * 地標 = 沙丘基座（階梯金字塔）＋同一種白方塊在丘頂堆高的結構
 * 無邊界：沙床延伸到霧中，隱入紙面；拉動範圍由 controls 限制
 * ============================================================ */
(function () {
  "use strict";

  var PROJECTS = window.PROJECTS || [];
  var UNMAPPED = window.UNMAPPED || { hidden: true };

  var container = document.getElementById("scene");
  if (!container) return;

  function reportBoot(value, label) {
    document.dispatchEvent(new CustomEvent("sandbox:progress", { detail: { value: value, label: label } }));
  }

  reportBoot(24, "CHECKING WEBGL");
  if (!window.THREE || !webglAvailable()) {
    showFallback();
    document.dispatchEvent(new CustomEvent("sandbox:error"));
    return;
  }

  var THREE = window.THREE;
  var DEBUG = new URLSearchParams(location.search).has("debug");
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var clock = new THREE.Clock();
  var lastInteraction = 0;
  var lastRenderTime = 0;
  var renderCount = 0;

  /* 方塊世界：一粒沙 = BLOCK 立方，地標 = 同一單位的堆積 */
  var BLOCK = 0.6, GAP = 0.02;
  var SAND_R = 95;   /* 沙床半徑（world）：大於最大拉遠可視範圍，無邊界 */

  /* ================= 渲染器 ================= */
  var mobileRender = window.innerWidth <= 640;
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: DEBUG });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileRender ? 1.25 : 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   /* filmic：高光 rolloff，照片感 */
  renderer.toneMappingExposure = 1.15;
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);
  reportBoot(38, "RENDERER ONLINE");



  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xF2F4F1, 150, 480);

  var camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 800);

  /* 直式（手機）：更高的俯瞰平面視角，地標與山脈都在畫面內 */
  var isNarrow = function () { return window.innerWidth <= 640; };
  var narrowState = isNarrow();
  var baseTargetY = isNarrow() ? 3 : 2;
  function applyCameraFraming() {
    if (isNarrow()) {
      camera.position.set(0, 150, 95);
      controls.target.set(0, 3, 24);
      baseTargetY = 3;
    } else {
      camera.position.set(0, 66, 128);
      controls.target.set(0, 2, 38);
      baseTargetY = 2;
    }
  }

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  applyCameraFraming();
  controls.enablePan = false;            /* 只能旋轉，拉不出範圍 */
  controls.enableZoom = false;           /* 滾輪縮放關閉 → 滾輪改捲動頁面 */
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 30;
  controls.maxDistance = 150;
  controls.minPolarAngle = 0.30;
  controls.maxPolarAngle = 1.05;   /* 避免水平掠射 → 全白 */
  controls.autoRotate = !RM && !DEBUG;   /* debug 下固定鏡頭方便驗證 */
  controls.autoRotateSpeed = 0.25;

  var labelRenderer = new THREE.CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.left = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(labelRenderer.domElement);

  /* ================= 燈光（太陽在 -x-z，影子落向鏡頭） ================= */
  scene.add(new THREE.HemisphereLight(0xFFFFFF, 0x9AA3A0, 0.16));

  var sun = new THREE.DirectionalLight(0xFFFFFF, 1.1);
  sun.position.set(-30, 22, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobileRender ? 1024 : 2048, mobileRender ? 1024 : 2048);
  sun.shadow.radius = 4;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 170;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  var fill = new THREE.DirectionalLight(0xDCE4E8, 0.10);
  fill.position.set(24, 18, 30);
  scene.add(fill);

  /* ================= 工具 ================= */
  function cellHash(x, y, z) {
    var h = Math.round(x * 13) * 374761393 + Math.round(y * 7) * 668265263 + Math.round(z * 11) * 1274126177;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h & 0x7fffffff) / 0x7fffffff;
  }
  function mkMat(hex, extra) {
    var m = new THREE.MeshStandardMaterial(Object.assign(
      { color: hex, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.35 }, extra || {}
    ));
    m.userData.baseColor = m.color.clone();
    m.userData.baseEmissive = m.emissive.clone();
    return m;
  }
  /* voxel 材質：vertexColors 帶每面微色差；baseColor = 白（色調在頂點色） */
  function vxMat(hex) {
    var m = new THREE.MeshStandardMaterial({
      color: 0xFFFFFF, vertexColors: true,
      roughness: 0.92, metalness: 0.02, envMapIntensity: 0.35
    });
    m.userData.baseHex = hex;
    m.userData.baseColor = new THREE.Color(0xFFFFFF);
    m.userData.baseEmissive = new THREE.Color(0x000000);
    return m;
  }

  /* ================= Voxel 建構器 =================
   * boxes: [x, y, z, w, h, d, matIdx]（BLOCK 單位）
   * 只發射外露面；座標 × BLOCK 對到世界
   */
  function voxelModel(boxes, matList) {
    var grid = {};
    boxes.forEach(function (b) {
      var x0 = Math.floor(b[0]), x1 = Math.floor(b[0] + b[3]);
      var y0 = Math.floor(b[1]), y1 = Math.floor(b[1] + b[4]);
      var z0 = Math.floor(b[2]), z1 = Math.floor(b[2] + b[5]);
      for (var x = x0; x < x1; x++)
        for (var y = y0; y < y1; y++)
          for (var z = z0; z < z1; z++)
            grid[x + "," + y + "," + z] = b[6];
    });

    var dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    var face = [];

    function pushFace(mi, cx, cy, cz, n, ax, ay, az, bx, by, bz, tint, shades) {
      var f = face[mi] || (face[mi] = { pos: [], nrm: [], col: [] });
      var s = (BLOCK - GAP) / 2;
      var v = [
        cx - ax*s - bx*s, cy - ay*s - by*s, cz - az*s - bz*s,
        cx + ax*s - bx*s, cy + ay*s - by*s, cz + az*s - bz*s,
        cx + ax*s + bx*s, cy + ay*s + by*s, cz + az*s + bz*s,
        cx - ax*s + bx*s, cy - ay*s + by*s, cz - az*s + bz*s
      ];
      for (var i = 0; i < 4; i++) {
        var cc = tint * (shades ? shades[i] : 1);
        f.pos.push(v[i*3], v[i*3+1], v[i*3+2]);
        f.nrm.push(n[0], n[1], n[2]);
        f.col.push(cc, cc, cc);
      }
    }

    /* 遮蔽測試：地面（y<0）永遠算遮蔽 → 接觸陰影 */
    function occ(px, py, pz) {
      if (py < 0) return true;
      return grid[px + "," + py + "," + pz] !== undefined;
    }
    for (var key in grid) {
      var mi = grid[key];
      var c = key.split(",").map(Number);
      var tint = 0.955 + cellHash(c[0] + 3, c[1] + 1, c[2] + 7) * 0.09;
      for (var d = 0; d < 6; d++) {
        var n = dirs[d];
        var nx = c[0] + n[0], ny = c[1] + n[1], nz = c[2] + n[2];
        if (grid[nx + "," + ny + "," + nz] !== undefined) continue;
        if (d === 3 && c[1] === 0) continue;
        var cx = (c[0] + 0.5 + n[0] * 0.5) * BLOCK;
        var cy = (c[1] + 0.5 + n[1] * 0.5) * BLOCK;
        var cz = (c[2] + 0.5 + n[2] * 0.5) * BLOCK;
        var axes = [[1,0,0],[0,1,0],[0,0,1]].filter(function (a) { return a[0] !== n[0] || a[1] !== n[1] || a[2] !== n[2]; });
        var A = axes[0], B = axes[1];
        /* 四角 AO：side1 / side2 / corner 遮蔽 → 縫隙與接觸處自然變暗 */
        var shades = [[-1,-1],[1,-1],[1,1],[-1,1]].map(function (sg) {
          var sa = sg[0], sb = sg[1];
          var s1 = occ(c[0] + A[0]*sa, c[1] + A[1]*sa, c[2] + A[2]*sa);
          var s2 = occ(c[0] + B[0]*sb, c[1] + B[1]*sb, c[2] + B[2]*sb);
          var co = occ(c[0] + A[0]*sa + B[0]*sb, c[1] + A[1]*sa + B[1]*sb, c[2] + A[2]*sa + B[2]*sb);
          var ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + co);
          return 0.66 + 0.34 * (ao / 3);
        });
        pushFace(mi, cx, cy, cz, n, A[0], A[1], A[2], B[0], B[1], B[2], tint, shades);
      }
    }

    var group = new THREE.Group();
    face.forEach(function (f, mi) {
      if (!f) return;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(f.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(f.nrm, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(f.col, 3));
      var mesh = new THREE.Mesh(geo, matList[mi]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    return group;
  }

  function toB(v) { return v / BLOCK; }

  /* ================= 沙丘基座：由大到小逐層堆疊（沙的隆起） ================= */
  function sandMound(b, cx, cz, maxR, layers, matIdx) {
    for (var i = 0; i < layers; i++) {
      var r = maxR - i;
      b.push([cx - r, i, cz - r, r * 2, 1, r * 2, matIdx]);
    }
  }

  /* ================= 沙面高度場 =================
   * 真實地形（Terrain.height）+ 顆粒 jitter
   * 載入失敗時退回合成波（保險）
   */
  function syntheticHeight(wx, wz) {
    var h = Math.sin(wx * 0.16) * Math.cos(wz * 0.21) * 0.65 +
            Math.sin(wx * 0.43 + 1.7) * Math.sin(wz * 0.37 + 0.4) * 0.3;
    h += (cellHash(wx * 3 + 1, 5, wz * 3 + 2) - 0.5) * 0.12;
    return 0.32 + h;
  }
  function sandHeight(wx, wz) {
    var h = Terrain.ready() ? Terrain.height(wx, wz) : syntheticHeight(wx, wz);
    h += (cellHash(wx * 3 + 1, 5, wz * 3 + 2) - 0.5) * 0.12;
    return h;
  }

  /* ================= 白沙床：細小白方塊鋪滿、無邊界
   * 注意：必須在 Terrain.load 之後才建（沙面高度依賴真實地形） ================= */
  /* 沙粒互動狀態（IIFE 層級：buildSand 與動畫迴圈共用） */
  var sandMesh = null;
  var sandN = Math.ceil((SAND_R * 2) / BLOCK);
  var sandCount = 0;
  var sandBase = null, sandQuat = null, sandScale = null, sandDisp = null;
  var sandAnimating = false;
  var cursorOn = false;
  var lastCursorMove = 0;
  var cursorGround = new THREE.Vector3(9999, 0, 9999);
  var cursorSmooth = new THREE.Vector3(9999, 0, 9999);
  var cursorVel = new THREE.Vector3();
  var lastCursor = new THREE.Vector3();
  var ripples = [];

  function buildSand() {
  var sandGeo = new THREE.BoxGeometry(BLOCK - GAP, BLOCK - GAP, BLOCK - GAP);
  var sandMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.95, metalness: 0.0, envMap: null });

  /* 圓形沙盤：先數半徑內的顆數 */
  sandCount = 0;
  for (var cgx = -SAND_R + BLOCK / 2; cgx <= SAND_R - BLOCK / 2; cgx += BLOCK)
    for (var cgz = -SAND_R + BLOCK / 2; cgz <= SAND_R - BLOCK / 2; cgz += BLOCK)
      if (Math.hypot(cgx, cgz) <= SAND_R) sandCount++;
  sandBase = new Float32Array(sandCount * 3);
  sandQuat = new Float32Array(sandCount * 4);
  sandScale = new Float32Array(sandCount);
  sandDisp = new Float32Array(sandCount * 3);

  sandMesh = new THREE.InstancedMesh(sandGeo, sandMat, sandCount);
  var _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _c = new THREE.Color();
  var _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  var _i = 0;
  var terrainHeight = Terrain.ready() ? Terrain.height : syntheticHeight;
  for (var gx = -SAND_R + BLOCK / 2; gx <= SAND_R - BLOCK / 2; gx += BLOCK) {
    for (var gz = -SAND_R + BLOCK / 2; gz <= SAND_R - BLOCK / 2; gz += BLOCK) {
      var gr = Math.hypot(gx, gz);
      if (gr > SAND_R) continue;               /* 圓形沙盤 */
      var thx = terrainHeight(gx, gz);
      var hy = thx + (cellHash(gx * 3 + 1, 5, gz * 3 + 2) - 0.5) * 0.12;
      var r1 = cellHash(gx, 1, gz), r2 = cellHash(gz, 3, gx);
      var r3 = cellHash(gz, 7, gx);
      _e.set((r1 - 0.5) * 0.10, 0, (r2 - 0.5) * 0.10);
      _q.setFromEuler(_e);
      _v.set(gx + (r3 - 0.5) * 0.5, hy, gz + (r1 - 0.5) * 0.5);
      var sc = 0.85 + r2 * 0.3;                 /* 每顆沙大小略有不同 */
      /* 邊緣溶解：62→92 漸隱帶，顆粒縮小+下沉，如被風吹散 */
      var dissolve = Math.min(1, Math.max(0, (gr - 62) / 30));
      if (dissolve > 0) {
        sc *= (1 - dissolve * 0.97);
        _v.y -= dissolve * dissolve * 0.45;
      }
      _s.set(sc, sc, sc);
      _m.compose(_v, _q, _s);
      sandMesh.setMatrixAt(_i, _m);
      sandBase[_i * 3] = _v.x; sandBase[_i * 3 + 1] = _v.y; sandBase[_i * 3 + 2] = _v.z;
      sandQuat[_i * 4] = _q.x; sandQuat[_i * 4 + 1] = _q.y; sandQuat[_i * 4 + 2] = _q.z; sandQuat[_i * 4 + 3] = _q.w;
      sandScale[_i] = sc;
      /* 地形法線著色：太陽（-30,22,-18 → 單位方向 -0.726,0.533,-0.436） */
      var hxp = terrainHeight(gx + BLOCK, gz), hxm = terrainHeight(gx - BLOCK, gz);
      var hzp = terrainHeight(gx, gz + BLOCK), hzm = terrainHeight(gx, gz - BLOCK);
      var dpx = (hxp - thx) / BLOCK;
      var dpz = (hzp - thx) / BLOCK;
      var ln = Math.hypot(-dpx, 1, -dpz);
      var ndl = ((-dpx / ln) * -0.726 + (1 / ln) * 0.533 + (-dpz / ln) * -0.436);
      var shade = 0.88 + 0.22 * Math.max(0, Math.min(1, ndl));
      /* 遮蔽 AO：被更高的鄰居包圍（谷底/縫隙）→ 變暗 */
      var nmax = Math.max(hxp, hxm, hzp, hzm);
      var shelter = Math.max(0, nmax - thx);
      var aoF = 1 - Math.min(0.28, shelter * 0.32);
      /* Hypsometric：低地暖灰 → 高地冷白，山脊才跳得出來 */
      var k = Math.max(0, Math.min(1, (thx - 0.2) / 5));
      var cr = (0.80 + 0.16 * k) * (0.98 + r2 * 0.03) * aoF * shade;
      var cg = (0.79 + 0.16 * k) * (0.98 + r2 * 0.03) * aoF * shade;
      var cb = (0.74 + 0.225 * k) * (0.98 + r2 * 0.03) * aoF * shade;
      /* 顏色漸隱入紙色（與溶解疊加） */
      var rim = dissolve;
      if (rim > 0) {
        cr += (1 - cr) * rim;
        cg += (1 - cg) * rim;
        cb += (1 - cb) * rim;
        _s.set(sc, sc, sc);
      }
      _c.setRGB(cr, cg, cb);
      sandMesh.setColorAt(_i, _c);
      _i++;
    }
  }
  sandMesh.instanceMatrix.needsUpdate = true;
  if (sandMesh.instanceColor) sandMesh.instanceColor.needsUpdate = true;
  sandMesh.castShadow = false;
  sandMesh.receiveShadow = true;
  scene.add(sandMesh);
  }   /* buildSand 結束 */

  /* ================= 地標 ================= */
  var landmarks = [];
  var interactiveMeshes = [];
  var beaconMat = null;
  var glowMat = null;

  function makeGlowTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, "rgba(212,178,62,0.85)");
    grad.addColorStop(0.4, "rgba(212,178,62,0.32)");
    grad.addColorStop(1, "rgba(212,178,62,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function registerLandmark(p, group, opts) {
    opts = opts || {};
    var mats = [];
    group.traverse(function (o) {
      if (o.isMesh) {
        o.userData.landmarkId = p.id;
        interactiveMeshes.push(o);
        if (o.material !== beaconMat && mats.indexOf(o.material) < 0) mats.push(o.material);
      }
    });
    var L = {
      id: p.id,
      group: group,
      baseY: opts.baseY || 0,
      mats: mats,
      label: opts.label || null,
      state: { hover: false, sel: false }
    };
    scene.add(group);
    landmarks.push(L);
    return L;
  }

  function makeLabel(p, y, extraClass) {
    var el = document.createElement("div");
    el.className = "tag" + (extraClass ? " " + extraClass : "");
    el.innerHTML = '<span class="tag-id">' + p.id + "</span>" +
      '<span class="tag-name">' + p.slug.toUpperCase() + "</span>";
    var lab = new THREE.CSS2DObject(el);
    lab.position.set(0, y, 0);
    return lab;
  }

  /* 標記點：地標山腳的小方塊堆 */
  function markerPylon(group, mx, mz, my) {
    var base = vxMat(0xCFD5D1), top = vxMat(0xEDF0ED);
    var y = my || 0;
    var p = voxelModel([
      [mx - 0.5, y, mz - 0.5, 1, 2, 1, 0],
      [mx - 0.5, y + 2, mz - 0.5, 1, 1, 1, 1]
    ], [base, top]);
    group.add(p);
  }

  /* ---- PRJ-001 檔案塔：沙丘基座 + 丘頂方碑群 ---- */
  function buildArchiveTower(p) {
    var g = new THREE.Group();
    var bh = Terrain.ready() ? Terrain.height(p.landmark.pos[0], p.landmark.pos[1]) : 0;
    g.position.set(p.landmark.pos[0], bh, p.landmark.pos[1]);
    g.scale.setScalar(p.landmark.scale || 1);

    var mats = [
      vxMat(0xD8DDD9),   /* 0 沙丘（比平沙深一階，讀得出地形） */
      vxMat(0xC3CAC6),   /* 1 基座 */
      vxMat(0xD0D6D2),   /* 2 深 */
      vxMat(0xE2E6E2),   /* 3 中 */
      vxMat(0xEEF1EE)    /* 4 亮 */
    ];
    var b = [];
    sandMound(b, 0, 0, 10, 11, 0);               /* 沙丘：11 層階梯金字塔 */
    b.push([-4, 11, -4, 8, 1, 8, 1]);            /* 基座平台 */
    b.push([-3, 12, -3, 6, 1, 6, 2]);            /* 階梯 */
    b.push([-1.5, 13, -1.5, 3, 14, 3, 4]);       /* 高塔 y13..27 */
    b.push([-3, 16, -3, 6, 1, 6, 2]);            /* 樓層帶 1 */
    b.push([-3, 22, -3, 6, 1, 6, 2]);            /* 樓層帶 2 */
    b.push([-1, 27, -1, 2, 1, 2, 4]);            /* 平頂 */
    b.push([-0.5, 28, -0.5, 1, 4, 1, 4]);        /* 細尖頂 */
    b.push([2.5, 13, -1, 2, 9, 2, 3]);           /* 側碑（乾淨方碑） */
    b.push([2.5, 22, -1, 3, 1, 2, 2]);           /* 側碑層帶 */
    g.add(voxelModel(b, mats));
    markerPylon(g, 11.5, 11.5);

    var L = registerLandmark(p, g, { baseY: bh });
    L.label = makeLabel(p, 19.6);
    g.add(L.label);
    return L;
  }

  /* ---- PRJ-002 訊號塔：沙丘 + 機房 + 高桅 + 雷達平台 + Beacon ---- */
  function buildSignalTower(p) {
    var g = new THREE.Group();
    var bh = Terrain.ready() ? Terrain.height(p.landmark.pos[0], p.landmark.pos[1]) : 0;
    g.position.set(p.landmark.pos[0], bh, p.landmark.pos[1]);
    g.scale.setScalar(p.landmark.scale || 1);

    var mats = [
      vxMat(0xD8DDD9),   /* 0 沙丘 */
      vxMat(0xC3CAC6),   /* 1 基座 */
      vxMat(0xCFD5D1),   /* 2 深 */
      vxMat(0xE1E5E1),   /* 3 中 */
      vxMat(0xEDF0ED)    /* 4 亮 */
    ];
    var b = [];
    sandMound(b, 0, 0, 8, 8, 0);                 /* 沙丘：8 層 */
    b.push([-3, 7, -3, 6, 1, 6, 1]);             /* 基座板 */
    b.push([-2, 8, -2, 4, 2, 4, 3]);             /* 機房 */
    b.push([-1.5, 10, -1.5, 1, 1, 1, 2]);        /* 煙囪 */
    b.push([0, 10, 0, 1, 20, 1, 4]);             /* 主桅 y10..30 */
    b.push([-1.5, 16, 0, 4, 1, 1, 2]);           /* 斜撐 y16 */
    b.push([-1.5, 23, 0, 4, 1, 1, 2]);           /* 斜撐 y23 */
    b.push([-2, 30, -2, 4, 1, 4, 3]);            /* 雷達平台 */
    b.push([-1, 31, -1, 2, 1, 2, 3]);
    g.add(voxelModel(b, mats));

    /* Beacon：唯一的常駐金色——深色燈罩 + 高強度發光 + 加法光暈 */
    beaconMat = vxMat(0xD4B23E);
    beaconMat.vertexColors = false;
    beaconMat.color = new THREE.Color(0x6E6A63);
    beaconMat.emissive = new THREE.Color(0xD4B23E);
    beaconMat.emissiveIntensity = 1.5;
    beaconMat.userData.baseColor = beaconMat.color.clone();
    beaconMat.userData.baseEmissive = beaconMat.emissive.clone();
    var beacon = new THREE.Mesh(new THREE.BoxGeometry(BLOCK * 1.25, BLOCK * 1.25, BLOCK * 1.25), beaconMat);
    beacon.position.set(0.5 * BLOCK, 32.7 * BLOCK, 0.5 * BLOCK);
    beacon.castShadow = true;
    beaconMat.__mesh = beacon;
    g.add(beacon);
    glowMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var glow = new THREE.Sprite(glowMat);
    glow.position.copy(beacon.position);
    glow.scale.set(3.6, 3.6, 1);
    g.add(glow);
    markerPylon(g, 9.5, 9.5);

    var L = registerLandmark(p, g, { baseY: bh });
    L.label = makeLabel(p, 22.4);
    g.add(L.label);
    return L;
  }

  /* ---- 未登錄區：平整沙面（無沙丘）+ 圍籬 + 告示 + 建材堆 ---- */
  function buildUnmapped() {
    if (UNMAPPED.hidden) return;
    var g = new THREE.Group();
    var uh = Terrain.ready() ? Terrain.height(UNMAPPED.pos ? UNMAPPED.pos[0] : -30, UNMAPPED.pos ? UNMAPPED.pos[1] : 70) : 0;
    g.position.set(UNMAPPED.pos ? UNMAPPED.pos[0] : -30, uh, UNMAPPED.pos ? UNMAPPED.pos[1] : 70);

    var mats = [
      vxMat(0xCDD3CF), vxMat(0xB9C1BC), vxMat(0xE6EAE6), vxMat(0xD8DDD9)
    ];
    var b = [];
    b.push([-3.5, 0, -3, 7, 1, 6, 0]);                       /* 地基板 */
    [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3], [0, -3], [0, 3], [-3.5, 0], [3.5, 0]]
      .forEach(function (p2) { b.push([p2[0], 1, p2[1], 1, 2, 1, 1]); });
    b.push([-3.5, 3, -3, 7, 1, 1, 1]);                       /* 橫欄 */
    b.push([-3.5, 3, 3, 7, 1, 1, 1]);
    b.push([-3.5, 3, -3, 1, 1, 7, 1]);
    b.push([3.5, 3, -3, 1, 1, 7, 1]);
    b.push([0, 1, 1.5, 1, 2, 1, 1]);                         /* 告示柱 */
    b.push([-2, 3, 1.5, 5, 1, 1, 2]);                        /* 告示板 */
    b.push([2, 1, -1, 1, 1, 1, 3]);                          /* 建材 */
    b.push([2, 2, -1, 1, 1, 1, 3]);
    b.push([3, 1, -1, 1, 1, 1, 3]);
    b.push([-2.5, 1, 2, 1, 1, 1, 3]);
    b.push([-2.5, 2, 2, 1, 1, 1, 3]);
    b.push([-2.5, 1, -2, 2, 1, 1, 3]);                       /* 半牆 */
    g.add(voxelModel(b, mats));

    var el = document.createElement("div");
    el.className = "tag unmapped";
    el.innerHTML = '<span class="tag-id">UNMAPPED</span><span class="tag-name">未登錄</span>';
    var lab = new THREE.CSS2DObject(el);
    lab.position.set(0, 3.4, 0);
    g.add(lab);
    scene.add(g);
  }

  /* ================= 填充：沙丘樹、岩堆、小屋 ================= */
  /* seeded RNG：每次載入畫面一致 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function buildFiller() {
    var leafM1 = vxMat(0xE6EAE6), leafM2 = vxMat(0xDDE2DE);
    var trunkM = vxMat(0xC2C9C4);
    var rockM = vxMat(0xBEC5C1);
    var wallM1 = vxMat(0xE3E7E3), wallM2 = vxMat(0xDAE0DB);
    var roofM = vxMat(0xCFD5D1), doorM = vxMat(0xBEC5C1);

    function tree(tx, tz, s, ry) {
      var mats = [vxMat(0xE3E8E4), trunkM, leafM1, leafM2];
      var g = new THREE.Group();
      g.position.set(tx, Terrain.ready() ? Terrain.height(tx, tz) : 0, tz);
      g.scale.setScalar(s);
      g.rotation.y = ry;
      var b = [];
      sandMound(b, 0, 0, 2, 2, 0);                 /* 小沙錐 */
      b.push([-0.5, 2, -0.5, 1, 2, 1, 1]);         /* 樹幹 */
      b.push([-1.5, 4, -1.5, 3, 1, 3, 2]);         /* 樹冠：矮而圓 */
      b.push([-1, 5, -1, 2, 1, 2, 3]);
      b.push([-0.5, 6, -0.5, 1, 1, 1, 2]);
      g.add(voxelModel(b, mats));
      scene.add(g);
    }

    /* 樹木：分簇散佈（樹叢）+ 地形篩選（海拔帶 / 坡度 / 避開地標） */
    var rng = mulberry32(20260810);
    var umPos = (UNMAPPED && !UNMAPPED.hidden && UNMAPPED.pos) ? UNMAPPED.pos : null;
    var planted = 0;
    var guard = 0;
    window.__treeCount = 0;
    while (planted < 52 && guard < 4000) {
      guard++;
      var cx = (rng() * 2 - 1) * 82;
      var cz = (rng() * 2 - 1) * 82;
      var px = cx + (rng() * 2 - 1) * 13;          /* 簇內偏移：樹聚成叢 */
      var pz = cz + (rng() * 2 - 1) * 13;
      if (Math.hypot(px, pz) > 56) continue;       /* 遠離溶解帶 */
      var th = Terrain.ready() ? Terrain.height(px, pz) : 0;
      if (th < 0.4 || th > 4.6) continue;          /* 海拔帶：避開市區與山頂裸岩 */
      if (Math.abs(Terrain.ready() ? Terrain.height(px + 1.4, pz) - th : 0) > 0.4) continue;  /* 太陡不長 */
      var far = true;
      for (var i = 0; i < PROJECTS.length; i++) {
        var lp = PROJECTS[i].landmark;
        if (lp && Math.hypot(px - lp.pos[0], pz - lp.pos[1]) < 10) { far = false; break; }
      }
      if (!far) continue;
      if (umPos && Math.hypot(px - umPos[0], pz - umPos[1]) < 7) continue;
      tree(px, pz, 0.7 + rng() * 0.8, rng() * Math.PI);
      planted++; window.__treeCount++;
    }

    /* 散落的測量標記：小山丘上的小方塊堆 */
    var markRng = mulberry32(777);
    var marks = 0;
    guard = 0;
    while (marks < 9 && guard < 2000) {
      guard++;
      var mx = (markRng() * 2 - 1) * 70;
      var mz = (markRng() * 2 - 1) * 70;
      if (Math.hypot(mx, mz) > 54) continue;
      var mh = Terrain.ready() ? Terrain.height(mx, mz) : 0;
      if (mh < 0.5 || mh > 5) continue;
      var mg = new THREE.Group();
      mg.position.set(mx, mh, mz);
      mg.rotation.y = markRng() * Math.PI;
      var mm = [vxMat(0xCFD5D1), vxMat(0xEDF0ED)];
      mg.add(voxelModel([
        [-0.5, 0, -0.5, 1, 1, 1, 0],
        [-0.5, 1, -0.5, 1, 1, 1, 1]
      ], mm));
      scene.add(mg);
      marks++;
    }

    var rockRng = mulberry32(99);
    var rcount = 0;
    guard = 0;
    while (rcount < 20 && guard < 3000) {
      guard++;
      var rx = (rockRng() * 2 - 1) * 75;
      var rz = (rockRng() * 2 - 1) * 75;
      if (Math.hypot(rx, rz) > 56) continue;
      var rh = Terrain.ready() ? Terrain.height(rx, rz) : 0;
      if (rh < 0.6 || rh > 7) continue;
      if (Math.abs(Terrain.ready() ? Terrain.height(rx + 1.4, rz) - rh : 0) > 0.5) continue;
      var rg = new THREE.Group();
      rg.position.set(rx, rh, rz);
      rg.rotation.y = rockRng() * Math.PI;
      var b = [
        [toB(0) - 0.5, 0, toB(0) - 0.5, 1, 1, 1, 0],
        [toB(0) - 0.5, 1, toB(0) - 0.5, 1, 1, 1, 0]
      ];
      if (rockRng() < 0.5) b.push([toB(0.9), 0, toB(0.9), 1, 1, 1, 0]);
      rg.add(voxelModel(b, [rockM]));
      scene.add(rg);
      rcount++;
    }

    function house(hx, hz, w, d, wallMat) {
      var mats = [vxMat(0xE3E8E4), wallMat, roofM, doorM];
      var hg = new THREE.Group();
      hg.position.set(hx, Terrain.ready() ? Terrain.height(hx, hz) : 0, hz);
      var bx = toB(0), bz = toB(0);
      var b = [];
      sandMound(b, bx, bz, 3, 2, 0);               /* 小沙基 */
      b.push([bx - w / 2, 2, bz - d / 2, w, 2, d, 1]);
      b.push([bx - w / 2 - 0.5, 4, bz - d / 2 - 0.5, w + 1, 1, d + 1, 2]);
      b.push([bx - 0.5, 5, bz - 0.5, 1, 1, 1, 1]);
      b.push([bx - 0.5, 2, bz + d / 2 - 0.5, 1, 2, 1, 3]);
      hg.add(voxelModel(b, mats));
      scene.add(hg);
    }
    house(6, 58, 4, 3, wallM1);
    house(11, 66, 3, 3, wallM2);
    house(-18, 48, 2.5, 2.5, wallM2);
    house(-28, 60, 3.5, 3, wallM1);
    house(22, 62, 3, 2.5, wallM2);
  }

  /* ================= 互動：hover / 選取 ================= */
  var ray = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var hoveredId = null;
  var current = null;
  var camTween = null;

  function hitTest(e) {
    var rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(interactiveMeshes, false);
    return hits.length ? hits[0].object.userData.landmarkId : null;
  }

  /* 滑鼠 → 地形投影（兩段式精修） */
  var _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var _hitV = new THREE.Vector3();
  function updateCursorGround(e) {
    var rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    _plane.constant = 0;
    if (!ray.ray.intersectPlane(_plane, _hitV)) return;
    var h1 = Terrain.ready() ? Terrain.height(_hitV.x, _hitV.z) : 0;
    _plane.constant = -h1;
    if (ray.ray.intersectPlane(_plane, _hitV)) {
      cursorGround.set(_hitV.x, h1, _hitV.z);
    }
  }

  /* 標記脈衝：金圈漣漪，向外擴散推沙 */
  function spawnRipple(x, z) {
    var h = Terrain.ready() ? Terrain.height(x, z) : 0;
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.08, 64),
      new THREE.MeshBasicMaterial({
        color: 0xD4B23E, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, h + 0.07, z);
    scene.add(ring);
    ripples.push({ x: x, z: z, r: 1.4, maxR: 26, speed: 32, age: 0, dur: 1.5, ring: ring });
  }

  /* 沙粒位移：游標推沙 + 漣漪環帶（每幀更新被影響的沙粒矩陣） */
  var _tmpM = new THREE.Matrix4();
  var _tmpQ = new THREE.Quaternion();
  var _tmpV = new THREE.Vector3();
  var _tmpS = new THREE.Vector3();
  function updateSand(dt) {
    var n = sandCount;
    if (cursorOn && performance.now() - lastCursorMove > 1500) cursorOn = false;   /* 靜止就停推 */
    if (!sandAnimating && !cursorOn && ripples.length === 0) return;
    sandAnimating = true;
    cursorSmooth.lerp(cursorGround, 0.16);
    cursorVel.multiplyScalar(0.88);            /* 速度衰減：停下來就不推 */
    var R = 4.0, R2 = R * R;
    var dirty = false;
    var maxD = 0;
    var cx = cursorSmooth.x, cz = cursorSmooth.z;
    var vx = cursorVel.x, vz = cursorVel.z;
    for (var i = 0; i < n; i++) {
      var bx = sandBase[i * 3], by = sandBase[i * 3 + 1], bz = sandBase[i * 3 + 2];
      var tx = 0, ty = 0, tz = 0;
      if (cursorOn) {
        var dx = bx - cx, dz = bz - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 < R2) {
          var d = Math.sqrt(d2) + 0.001;
          var fall = 1 - d / R;
          var push = fall * fall;
          tx += (dx / d) * push * 0.55;     /* 推開（柔和） */
          tz += (dz / d) * push * 0.55;
          ty += push * 0.7;                  /* 隆起（柔和） */
          tx += vx * fall * 0.06;            /* 順著游標移動方向流動（輕微） */
          tz += vz * fall * 0.06;
        }
      }
      for (var r = 0; r < ripples.length; r++) {
        var rp = ripples[r];
        var rx = bx - rp.x, rz = bz - rp.z;
        var rd = Math.sqrt(rx * rx + rz * rz) + 0.001;
        var bw = 1.8;
        var dd = Math.abs(rd - rp.r);
        if (dd < bw) {
          var k = (1 - dd / bw) * 1.0;
          tx += (rx / rd) * k;
          tz += (rz / rd) * k;
          ty += k * k * 2.4;
        }
      }
      /* 不對稱響應：有推力時快速隆起，放手後極慢平復（漣漪/手指留痕幾秒） */
      var px = sandDisp[i * 3], py = sandDisp[i * 3 + 1], pz = sandDisp[i * 3 + 2];
      var s = (tx * tx + ty * ty + tz * tz > 0.0001) ? 0.18 : 0.03;
      var nx = px + (tx - px) * s;
      var ny = py + (ty - py) * s;
      var nz = pz + (tz - pz) * s;
      var md = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
      if (md > maxD) maxD = md;
      if (Math.abs(nx - px) > 0.0005 || Math.abs(ny - py) > 0.0005 || Math.abs(nz - pz) > 0.0005) {
        sandDisp[i * 3] = nx; sandDisp[i * 3 + 1] = ny; sandDisp[i * 3 + 2] = nz;
        _tmpQ.set(sandQuat[i * 4], sandQuat[i * 4 + 1], sandQuat[i * 4 + 2], sandQuat[i * 4 + 3]);
        _tmpV.set(bx + nx, by + ny, bz + nz);
        _tmpS.setScalar(sandScale[i]);
        _tmpM.compose(_tmpV, _tmpQ, _tmpS);
        sandMesh.setMatrixAt(i, _tmpM);
        dirty = true;
      }
    }
    if (dirty) sandMesh.instanceMatrix.needsUpdate = true;
    if (!cursorOn && ripples.length === 0 && maxD < 0.004) sandAnimating = false;
  }

  function setHover(id) {
    if (id === hoveredId) return;
    hoveredId = id;
    landmarks.forEach(function (L) {
      L.state.hover = (L.id === id);
      if (L.label) L.label.element.classList.toggle("hot", L.id === id);
    });
    renderer.domElement.style.cursor = id ? "pointer" : "";
  }

  function tweenAzimuthTo(theta) {
    var dx = camera.position.x - controls.target.x;
    var dz = camera.position.z - controls.target.z;
    var r = Math.hypot(dx, dz);
    var cur = Math.atan2(dx, dz);
    var d = theta - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    camTween = { r: r, cur: cur, d: d, t: 0, dur: RM ? 0.001 : 1.15 };
  }

  function select(id) {
    current = id;
    landmarks.forEach(function (L) {
      L.state.sel = (L.id === id);
      L.state.hover = false;
      if (L.label) {
        L.label.element.classList.toggle("hot", L.id === id);
        L.label.element.classList.toggle("dim", L.id !== id);
      }
    });
    var p = PROJECTS.find(function (x) { return x.id === id; });
    if (p && p.landmark) {
      tweenAzimuthTo(Math.atan2(p.landmark.pos[0], p.landmark.pos[1]));
      spawnRipple(p.landmark.pos[0], p.landmark.pos[1]);   /* 標記脈衝：白沙漣漪 */
    }
  }

  function deselect() {
    current = null;
    landmarks.forEach(function (L) {
      L.state.sel = false;
      if (L.label) L.label.element.classList.remove("hot", "dim");
    });
  }

  /* ---- 事件 ---- */
  var downPos = null;
  renderer.domElement.addEventListener("pointerdown", function (e) {
    downPos = { x: e.clientX, y: e.clientY };
    lastInteraction = performance.now();
  });
  renderer.domElement.addEventListener("pointermove", function (e) {
    /* 手機拖曳交給鏡頭／頁面手勢；避免每幀掃描整座沙床。點擊漣漪仍由 pointerup 處理。 */
    if (e.pointerType === "touch") {
      lastInteraction = performance.now();
      return;
    }
    setHover(hitTest(e));
    updateCursorGround(e);
    cursorOn = true;
    lastCursorMove = performance.now();
    lastInteraction = performance.now();
    var jump = Math.hypot(cursorGround.x - lastCursor.x, cursorGround.z - lastCursor.z);
    if (jump > 25) {
      /* 首次移動 / 大跳躍：不產生速度 */
      lastCursor.copy(cursorGround);
      cursorVel.set(0, 0, 0);
    } else {
      cursorVel.set((cursorGround.x - lastCursor.x) * 60, 0, (cursorGround.z - lastCursor.z) * 60);
      var vl = Math.hypot(cursorVel.x, cursorVel.z);
      if (vl > 14) cursorVel.multiplyScalar(14 / vl);   /* 速度限幅 */
      lastCursor.copy(cursorGround);
    }
  });
  renderer.domElement.addEventListener("pointerleave", function () {
    cursorOn = false;
  });
  renderer.domElement.addEventListener("pointerup", function (e) {
    if (!downPos) return;
    var moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 6) return;
    updateCursorGround(e);   /* tap 不一定觸發 pointermove：以實際放開位置重新投影 */
    var id = hitTest(e);
    if (id) {
      select(id);
      document.dispatchEvent(new CustomEvent("sandbox:select", { detail: { id: id } }));
    } else {
      spawnRipple(cursorGround.x, cursorGround.z);
      if (current) document.dispatchEvent(new CustomEvent("sandbox:close"));
    }
  });
  renderer.domElement.addEventListener("pointerleave", function () { setHover(null); });

  document.addEventListener("site:open", function (e) { select(e.detail.id); });
  document.addEventListener("site:close", deselect);

  /* ================= 動畫迴圈 ================= */
  var sigSel = new THREE.Color(0xD4B23E).multiplyScalar(0.5);
  var sigHov = new THREE.Color(0xD4B23E).multiplyScalar(0.26);
  var black = new THREE.Color(0x000000);
  var lastSandUpdate = 0;
  var sceneVisible = true;
  var pageScrolling = false;
  var scrollTimer = 0;
  var hero = container.closest(".sandbox") || container;

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      sceneVisible = !!entries[0].isIntersecting;
      if (sceneVisible) lastInteraction = performance.now();
    }, { rootMargin: "0px" }).observe(hero);
  }
  window.addEventListener("scroll", function () {
    pageScrolling = true;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () { pageScrolling = false; }, 140);
  }, { passive: true });

  function animate() {
    requestAnimationFrame(animate);
    var nowMs = performance.now();
    if (!sceneVisible || document.hidden) {
      clock.getDelta();
      return;
    }
    if (mobileRender && pageScrolling && nowMs - lastRenderTime < 1000 / 20) return;
    if (nowMs - lastInteraction > 2000 && !sandAnimating && !camTween) {
      var idleFps = mobileRender ? 24 : 30;
      if (nowMs - lastRenderTime < 1000 / idleFps) return;
    }
    lastRenderTime = nowMs;
    renderCount++;
    var dt = clock.getDelta();
    var t = clock.elapsedTime;

    if (camTween) {
      camTween.t += dt;
      var k = Math.min(1, camTween.t / camTween.dur);
      var ease = 1 - Math.pow(1 - k, 3);
      var a = camTween.cur + camTween.d * ease;
      camera.position.x = controls.target.x + Math.sin(a) * camTween.r;
      camera.position.z = controls.target.z + Math.cos(a) * camTween.r;
      if (k >= 1) camTween = null;
    }

    landmarks.forEach(function (L) {
      var sel = L.state.sel, hov = L.state.hover;
      var targetY = L.baseY + (sel ? 0.55 : hov ? 0.35 : 0);
      L.group.position.y += (targetY - L.group.position.y) * 0.13;
      var dim = sel ? false : (current !== null && !hov && L.id !== current);
      L.mats.forEach(function (m) {
        var base = m.userData.baseColor;
        if (!base) return;
        var targetColor = base.clone().multiplyScalar(dim ? 0.7 : 1);
        var targetE = sel ? sigSel : hov ? sigHov : black;
        m.color.lerp(targetColor, 0.13);
        m.emissive.lerp(targetE, 0.13);
      });
    });

    if (beaconMat) {
      var pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
      beaconMat.emissiveIntensity = 1.8 + 0.8 * pulse;
      if (glowMat) glowMat.opacity = 0.45 + 0.4 * pulse;
    }

    /* 漣漪：金圈外擴 + 消失 */
    for (var ri = ripples.length - 1; ri >= 0; ri--) {
      var rp = ripples[ri];
      rp.r += dt * rp.speed;
      rp.age += dt;
      var kk = Math.min(1, rp.r / rp.maxR);
      rp.ring.scale.set(kk, kk, 1);
      rp.ring.material.opacity = 0.5 * (1 - kk) * Math.max(0, 1 - rp.age / rp.dur);
      if (rp.age > rp.dur) {
        scene.remove(rp.ring);
        rp.ring.geometry.dispose();
        rp.ring.material.dispose();
        ripples.splice(ri, 1);
      }
    }
    if (!mobileRender || nowMs - lastSandUpdate >= 1000 / 30) {
      updateSand(dt);
      lastSandUpdate = nowMs;
    }

    controls.target.y = baseTargetY + Math.sin(t * 0.25) * 0.35;   /* 鏡頭呼吸 */
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  function onResize() {
    var w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (narrowState !== isNarrow()) {
      narrowState = isNarrow();
      applyCameraFraming();
    }
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener("resize", onResize);

  /* ================= 啟動（等地形載入） ================= */
  reportBoot(50, "LOADING TERRAIN");
  Terrain.load(function (ok) {
    reportBoot(64, ok ? "ASSEMBLING TERRAIN" : "GENERATING TERRAIN");
    requestAnimationFrame(function () {
      setTimeout(function () {
        try {
          buildSand();
          reportBoot(82, "ASSEMBLING LANDMARKS");
          buildUnmapped();
          PROJECTS.forEach(function (p) {
            if (!p.landmark) return;
            if (p.landmark.type === "archive-tower") buildArchiveTower(p);
            else if (p.landmark.type === "signal-tower") buildSignalTower(p);
          });
          buildFiller();
          reportBoot(96, "CALIBRATING VIEW");
          animate();
          document.dispatchEvent(new CustomEvent("sandbox:ready"));
        } catch (error) {
          showFallback();
          document.dispatchEvent(new CustomEvent("sandbox:error"));
          if (DEBUG) console.error(error);
        }
      }, 0);
    });
  });

  /* ================= 工具 ================= */
  function webglAvailable() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) { return false; }
  }
  function showFallback() {
    var d = document.createElement("div");
    d.className = "fallback";
    d.innerHTML = '<div class="fb-inner mono">沙盤需要 WebGL — 請換個瀏覽器，或往下捲動檢視 ARCHIVE 專案清單。</div>';
    container.appendChild(d);
  }

  /* ================= Debug：WebGL readback（?debug=1） ================= */
  if (DEBUG) {
    window.__sceneStats = function () {
      var gl = renderer.getContext();
      var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      var buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      var n = 0, sum = 0, min = 255, max = 0, dark = 0, mid = 0, hist = {};
      for (var i = 0; i < buf.length; i += 4) {
        if (buf[i + 3] < 128) continue;
        var v = Math.round((buf[i] + buf[i + 1] + buf[i + 2]) / 3);
        sum += v; n++;
        if (v < min) min = v;
        if (v > max) max = v;
        if (v < 140) dark++;
        if (v > 215) mid++;
        var k = Math.floor(v / 32) * 32;
        hist[k] = (hist[k] || 0) + 1;
      }
      var hh = [];
      for (var k in hist) hh.push([+k, hist[k]]);
      hh.sort(function (a, b) { return a[0] - b[0]; });
      return { n: n, mean: +(sum / n).toFixed(1), min: min, max: max, darkPct: +(dark / n * 100).toFixed(1), brightPct: +(mid / n * 100).toFixed(1), hist: hh };
    };
    window.__landmarkScreen = function (id) {
      var L = landmarks.find(function (l) { return l.id === id; });
      if (!L) return null;
      var v = new THREE.Vector3();
      L.group.getWorldPosition(v);
      v.project(camera);
      return {
        x: Math.round((v.x + 1) / 2 * window.innerWidth),
        y: Math.round((-v.y + 1) / 2 * window.innerHeight),
        z: +v.z.toFixed(2)
      };
    };
    window.__projPoint = function (wx, wy, wz) {
      var v = new THREE.Vector3(wx, wy, wz).project(camera);
      return {
        x: Math.round((v.x + 1) / 2 * window.innerWidth),
        y: Math.round((-v.y + 1) / 2 * window.innerHeight),
        z: +v.z.toFixed(2)
      };
    };
    window.__beaconInfo = function () {
      if (!beaconMat || !beaconMat.__mesh) return "no beacon mesh ref";
      var m = beaconMat.__mesh;
      var v = new THREE.Vector3();
      m.getWorldPosition(v);
      return {
        world: v.toArray().map(function (n) { return +n.toFixed(2); }),
        emissiveHex: "#" + beaconMat.emissive.getHexString(),
        emissiveIntensity: +beaconMat.emissiveIntensity.toFixed(2),
        visible: m.visible
      };
    };
    window.__renderRate = function () { return renderCount; };
    window.__performanceProfile = function () {
      return {
        mobile: mobileRender,
        pixelRatio: renderer.getPixelRatio(),
        shadowMap: sun.shadow.mapSize.x,
        sceneVisible: sceneVisible,
        pageScrolling: pageScrolling
      };
    };
    window.__sandDebug = function () {
      var maxD = 0, cnt = 0;
      for (var i = 0; i < sandCount; i++) {
        var d = Math.abs(sandDisp[i * 3]) + Math.abs(sandDisp[i * 3 + 1]) + Math.abs(sandDisp[i * 3 + 2]);
        if (d > 0.004) cnt++;
        if (d > maxD) maxD = d;
      }
      return { animating: sandAnimating, cursorOn: cursorOn, ripples: ripples.length, movedGrains: cnt, maxDisp: +maxD.toFixed(3) };
    };
    window.__interactionDebug = function () {
      return {
        cursorGround: [cursorGround.x, cursorGround.y, cursorGround.z].map(function (n) { return +n.toFixed(3); }),
        ripples: ripples.map(function (r) { return { x: +r.x.toFixed(3), z: +r.z.toFixed(3) }; })
      };
    };
    window.__readPixel = function (sx, sy) {
      var gl = renderer.getContext();
      var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      var buf = new Uint8Array(4);
      gl.readPixels(Math.floor(sx), h - 1 - Math.floor(sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return Array.prototype.slice.call(buf);
    };
    window.__sceneMap = function (cols) {
      var gl = renderer.getContext();
      var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      var buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      var rows = Math.round(cols * h / w);
      var ramp = " .:-=+*#%@";
      var out = [];
      for (var r = rows - 1; r >= 0; r--) {
        var line = "";
        for (var c = 0; c < cols; c++) {
          var x = Math.floor((c + 0.5) / cols * w);
          var y = Math.floor((r + 0.5) / rows * h);
          var i = (y * w + x) * 4;
          if (buf[i + 3] < 128) { line += " "; continue; }
          var v = Math.round((buf[i] + buf[i + 1] + buf[i + 2]) / 3);
          line += ramp[Math.min(9, Math.floor(v / 26))];
        }
        out.push(line);
      }
      return out.join("\n");
    };
  }
})();
