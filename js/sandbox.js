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
      /* 三個地標橫跨沙盤：略往東取景並放寬 FOV，讓航母與圖書館都完整入鏡。 */
      camera.fov = 58;
      camera.position.set(8, 145, 95);
      controls.target.set(8, 3, 24);
      baseTargetY = 3;
    } else {
      camera.fov = 42;
      camera.position.set(0, 66, 128);
      controls.target.set(0, 2, 38);
      baseTargetY = 2;
    }
    camera.updateProjectionMatrix();
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
  /* 自行用 elapsed time 驅動待機環繞，避免 OrbitControls 的逐幀步進在
     Firefox／降幀時慢到近乎靜止。debug 與減少動態模式維持固定鏡頭。 */
  controls.autoRotate = false;

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
    /* 每組 A × B 都指向該面的外側法線，確保六個方向的 winding 一致。 */
    var tangents = [
      [[0,1,0],[0,0,1]], [[0,0,1],[0,1,0]],
      [[0,0,1],[1,0,0]], [[1,0,0],[0,0,1]],
      [[1,0,0],[0,1,0]], [[0,1,0],[1,0,0]]
    ];
    var face = [];

    function pushFace(mi, cx, cy, cz, n, ax, ay, az, bx, by, bz, tint, shades) {
      var f = face[mi] || (face[mi] = { pos: [], nrm: [], col: [], idx: [] });
      var s = (BLOCK - GAP) / 2;
      var base = f.pos.length / 3;
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
      f.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
        var A = tangents[d][0], B = tangents[d][1];
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
      geo.setIndex(f.idx);
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
  var cursorGround = new THREE.Vector3(9999, 0, 9999);
  var cursorSmooth = new THREE.Vector3(9999, 0, 9999);
  var cursorVel = new THREE.Vector3();
  var lastCursor = new THREE.Vector3();
  var ripples = [];
  var turbineRotors = [];
  var SAND_BUCKET_SIZE = 4.8;
  var sandBuckets = Object.create(null);
  var sandActive = new Set();
  var sandNextActive = new Set();
  var sandCandidates = new Set();

  function sandBucketKey(x, z) {
    return Math.floor(x / SAND_BUCKET_SIZE) + "," + Math.floor(z / SAND_BUCKET_SIZE);
  }

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
      var bucketKey = sandBucketKey(_v.x, _v.z);
      if (!sandBuckets[bucketKey]) sandBuckets[bucketKey] = [];
      sandBuckets[bucketKey].push(_i);
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
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", "開啟 " + p.title + " 專案詳情");
    el.innerHTML = '<span class="tag-id">' + p.id + "</span>" +
      '<span class="tag-name">' + p.slug.toUpperCase() + "</span>";
    function activate() {
      select(p.id);
      document.dispatchEvent(new CustomEvent("sandbox:select", { detail: { id: p.id } }));
    }
    el.addEventListener("click", function (event) {
      event.stopPropagation();
      activate();
    });
    el.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
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

  /* ---- PRJ-001 收藏圖書館：寬版館舍 + 閱讀廊柱 + 屋頂展開的收藏冊 ---- */
  function buildCollectionLibrary(p) {
    var g = new THREE.Group();
    var bh = Terrain.ready() ? Terrain.height(p.landmark.pos[0], p.landmark.pos[1]) : 0;
    g.position.set(p.landmark.pos[0], bh, p.landmark.pos[1]);
    g.scale.setScalar(p.landmark.scale || 1);

    var mats = [
      vxMat(0xD8DDD9),   /* 0 沙丘 */
      vxMat(0xBEC6C1),   /* 1 基座／書脊 */
      vxMat(0xCCD3CF),   /* 2 館舍深部 */
      vxMat(0xE0E5E1),   /* 3 立面 */
      vxMat(0xEFF2EF)    /* 4 紙頁／屋頂 */
    ];
    var b = [];
    sandMound(b, 0, 0, 10, 3, 0);                /* 三層寬緩地坪，不形成金字塔底座 */
    b.push([-9, 3, -6, 18, 1, 12, 1]);           /* 館前平台 */
    b.push([-8, 4, -5, 16, 1, 10, 2]);           /* 第一階 */
    b.push([-7, 5, -4, 5, 6, 8, 3]);             /* 左館翼 */
    b.push([2, 5, -4, 5, 6, 8, 3]);              /* 右館翼 */
    b.push([-2, 5, -4, 4, 6, 4, 2]);             /* 中央書庫，入口保持凹入 */
    b.push([-8, 11, -5, 16, 1, 10, 1]);          /* 深色屋簷線 */

    /* 正面閱讀廊：規律柱列是遠景下最直覺的「公共館舍」輪廓。 */
    [-6, -3, 2, 5].forEach(function (x) {
      b.push([x, 5, 4, 1, 5, 1, 4]);
    });
    b.push([-7, 10, 3, 14, 1, 2, 4]);             /* 門廊上蓋 */
    b.push([-3, 5, 3, 2, 3, 1, 1]);              /* 左側卡片目錄櫃 */
    b.push([1, 5, 3, 2, 3, 1, 1]);               /* 右側卡片目錄櫃 */

    /* 屋頂俯視是一冊攤開的收藏簿；仍完全由同尺寸砂粒方塊堆出。 */
    b.push([-7, 12, -3, 6, 1, 7, 4]);
    b.push([1, 12, -3, 6, 1, 7, 4]);
    b.push([-1, 12, -4, 2, 2, 9, 1]);
    b.push([-6, 13, -2, 4, 1, 1, 3]);
    b.push([2, 13, -2, 4, 1, 1, 3]);
    b.push([-6, 13, 1, 3, 1, 1, 3]);
    b.push([3, 13, 1, 3, 1, 1, 3]);

    /* 稀疏書架背牆：用真正的空格分開橫板與書脊，避免糊成實心量體。 */
    b.push([-7, 12, -5, 1, 9, 1, 1]);
    b.push([6, 12, -5, 1, 9, 1, 1]);
    b.push([-7, 12, -5, 14, 1, 1, 1]);
    b.push([-7, 16, -5, 14, 1, 1, 1]);
    b.push([-7, 20, -5, 14, 1, 1, 1]);
    b.push([-5, 13, -5, 1, 3, 1, 3]);
    b.push([-3, 13, -5, 2, 3, 1, 4]);
    b.push([1, 13, -5, 1, 2, 1, 3]);
    b.push([3, 13, -5, 2, 3, 1, 4]);
    b.push([-5, 17, -5, 2, 3, 1, 4]);
    b.push([-2, 17, -5, 1, 2, 1, 3]);
    b.push([1, 17, -5, 2, 3, 1, 4]);
    b.push([4, 17, -5, 1, 2, 1, 3]);

    g.add(voxelModel(b, mats));
    markerPylon(g, 11.5, 10.5);

    var L = registerLandmark(p, g, { baseY: bh });
    L.label = makeLabel(p, 15.6);
    g.add(L.label);
    return L;
  }

  /* ---- PRJ-002 訊號塔：設備站 + 分節桅塔 + 八角衛星碟 + Beacon ---- */
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
    b.push([-4, 7, -4, 8, 1, 8, 1]);             /* 站體基座 */
    b.push([-3, 8, -3, 5, 4, 5, 3]);             /* 設備機房 */
    b.push([2, 8, -2, 2, 2, 3, 2]);              /* 外接電力櫃 */
    b.push([-2, 12, -2, 1, 6, 1, 2]);            /* 下層四腳 */
    b.push([1, 12, -2, 1, 6, 1, 2]);
    b.push([-2, 12, 1, 1, 6, 1, 2]);
    b.push([1, 12, 1, 1, 6, 1, 2]);
    b.push([-3, 17, -3, 6, 1, 6, 1]);            /* 維修平台 1 */
    b.push([-1, 18, -1, 1, 7, 1, 4]);            /* 中層雙桅 */
    b.push([0, 18, 0, 1, 7, 1, 4]);
    b.push([-2, 24, -2, 4, 1, 4, 1]);            /* 維修平台 2 */
    b.push([-0.5, 25, -0.5, 1, 12, 1, 4]);       /* 上層主桅 */
    b.push([-4, 27, 0, 8, 1, 1, 2]);             /* 天線陣列 */
    b.push([-3, 31, 0, 6, 1, 1, 2]);
    b.push([-2, 34, 0, 4, 1, 1, 2]);

    /* 偏置式像素訊號碟：與主桅留一格空隙，只由側向支臂銜接。 */
    b.push([-7, 27, 1, 3, 1, 1, 4]);
    b.push([-8, 28, 1, 5, 1, 1, 4]);
    b.push([-9, 29, 1, 6, 3, 1, 4]);
    b.push([-8, 32, 1, 5, 1, 1, 4]);
    b.push([-7, 33, 1, 3, 1, 1, 4]);
    b.push([-4, 30, 0, 4, 1, 1, 2]);             /* 支臂：碟緣 → 主桅 */
    b.push([-6, 30, 2, 1, 1, 2, 2]);             /* 短饋源，不穿過碟面 */

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
    beacon.position.set(0, 38 * BLOCK, 0);
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
    L.label = makeLabel(p, 25.2);
    g.add(L.label);
    return L;
  }

  /* ---- PRJ-003 艦隊航母：沙海船身 + 四組編隊甲板 + 偏置艦島 ---- */
  function buildFleetCarrier(p) {
    var g = new THREE.Group();
    var bh = Terrain.ready() ? Terrain.height(p.landmark.pos[0], p.landmark.pos[1]) : 0;
    g.position.set(p.landmark.pos[0], bh, p.landmark.pos[1]);
    g.rotation.y = p.landmark.rotation || 0;
    g.scale.setScalar(p.landmark.scale || 1);

    var mats = [
      vxMat(0xE3E7E3),   /* 0 沙浪／航跡 */
      vxMat(0xB4BDB8),   /* 1 下層船身 */
      vxMat(0xC6CECA),   /* 2 上層船身／艦島 */
      vxMat(0xDDE2DE),   /* 3 飛行甲板 */
      vxMat(0xEDF0ED),   /* 4 甲板線／桅杆 */
      vxMat(0xAEB7B2)    /* 5 編隊區／艦橋窗帶 */
    ];
    var b = [];

    /* 船尾與兩舷的斷續沙浪：讓長船像在沙海前進，不另蓋方形地台。 */
    b.push([-25, 0, -6, 8, 1, 2, 0]);
    b.push([-24, 0, 4, 7, 1, 2, 0]);
    b.push([-22, 0, -2, 5, 1, 4, 0]);
    b.push([-14, 0, -7, 8, 1, 1, 0]);
    b.push([-3, 0, -7, 7, 1, 1, 0]);
    b.push([-13, 0, 6, 10, 1, 1, 0]);
    b.push([1, 0, 6, 6, 1, 1, 0]);

    /* 下層與上層船身逐段收尖，俯視時有清楚船首，而不是長方形建築。 */
    b.push([-18, 0, -4, 31, 2, 8, 1]);
    b.push([13, 0, -3, 4, 2, 6, 1]);
    b.push([17, 0, -2, 2, 2, 4, 1]);
    b.push([19, 0, -1, 1, 2, 2, 1]);
    b.push([-18, 2, -5, 31, 2, 10, 2]);
    b.push([13, 2, -4, 4, 2, 8, 2]);
    b.push([17, 2, -2, 2, 2, 4, 2]);
    b.push([19, 2, -1, 1, 2, 2, 2]);

    /* 寬甲板與逐階收窄的船首。 */
    b.push([-19, 4, -6, 32, 1, 12, 3]);
    b.push([13, 4, -4, 4, 1, 8, 3]);
    b.push([17, 4, -2, 2, 1, 4, 3]);
    b.push([19, 4, -1, 1, 1, 2, 3]);

    /* 四個平嵌式編隊區對應工具中的四組 Team，不堆成小飛機。 */
    [-15, -9, -3, 3].forEach(function (x) {
      b.push([x, 4, -4, 4, 1, 3, 5]);
    });
    b.push([-16, 4, 0, 27, 1, 1, 4]);              /* 甲板中線 */
    b.push([11, 4, -1, 2, 1, 3, 4]);               /* 船首導引線 */

    /* 偏置艦島：低橋樓、深色窗帶、短桅與橫向雷達。 */
    b.push([-6, 5, 2, 8, 2, 3, 2]);
    b.push([-5, 7, 2, 6, 3, 3, 4]);
    b.push([-4, 8, 4, 4, 1, 1, 5]);
    b.push([-3, 10, 3, 1, 5, 1, 4]);
    b.push([-5, 12, 3, 5, 1, 1, 5]);
    b.push([-4, 15, 3, 3, 1, 1, 4]);

    g.add(voxelModel(b, mats));
    markerPylon(g, -21, 8);

    var L = registerLandmark(p, g, { baseY: bh });
    L.label = makeLabel(p, 12.1);
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
    var leafM1 = mkMat(0xE6EAE6, { side: THREE.DoubleSide });
    var leafM2 = mkMat(0xDDE2DE, { side: THREE.DoubleSide });
    var trunkM = mkMat(0xC2C9C4);
    var rockM = vxMat(0xBEC5C1);
    var turbineM = mkMat(0xD4DAD6);
    var turbineBladeM = mkMat(0xE8ECE8, { side: THREE.DoubleSide });
    var turbineTowerGeo = new THREE.CylinderGeometry(0.18, 0.34, 5.2, 6);
    var turbineHubGeo = new THREE.SphereGeometry(0.34, 8, 6);
    var turbineNacelleGeo = new THREE.BoxGeometry(0.55, 0.42, 0.9);
    var turbineBladeGeo = new THREE.BufferGeometry();
    turbineBladeGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      -0.10, 0.28, 0,
       0.12, 0.28, 0,
       0.28, 2.05, 0,
      -0.14, 1.68, 0
    ], 3));
    turbineBladeGeo.setIndex([0, 1, 2, 0, 2, 3]);
    turbineBladeGeo.computeVertexNormals();

    /* 有意留縫的三角碎片樹冠；兩份 geometry 交錯材質，但共用於所有樹。 */
    function treeShardGeometry(parity) {
      var pos = [];
      function band(count, baseY, tipY, radius, tipRadius, phase) {
        for (var i = 0; i < count; i++) {
          if (i % 2 !== parity) continue;
          var center = phase + i / count * Math.PI * 2;
          var half = Math.PI / count * 0.58;
          var tipAngle = center + (i % 2 ? -0.16 : 0.16);
          var leftY = baseY + (i % 3) * 0.08;
          var rightY = baseY + ((i + 1) % 3) * 0.08;
          pos.push(
            Math.cos(center - half) * radius, leftY, Math.sin(center - half) * radius,
            Math.cos(center + half) * radius, rightY, Math.sin(center + half) * radius,
            Math.cos(tipAngle) * tipRadius, tipY, Math.sin(tipAngle) * tipRadius
          );
        }
      }
      band(6, 1.05, 3.20, 1.48, 0.16, 0.00);
      band(5, 2.00, 4.05, 1.12, 0.12, 0.34);
      band(4, 2.95, 4.62, 0.76, 0.08, 0.10);
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      return geo;
    }
    var treeShardGeo1 = treeShardGeometry(0);
    var treeShardGeo2 = treeShardGeometry(1);

    function tree(tx, tz, s, ry) {
      var g = new THREE.Group();
      g.position.set(tx, Terrain.ready() ? Terrain.height(tx, tz) : 0, tz);
      g.scale.setScalar(s);
      g.rotation.y = ry;

      /* 明確建立的破碎三角面樹冠，不再依賴錯誤的 voxel 面。 */
      var trunk = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.35, 0.48), trunkM);
      trunk.position.y = 0.675;
      var shards1 = new THREE.Mesh(treeShardGeo1, leafM1);
      var shards2 = new THREE.Mesh(treeShardGeo2, leafM2);
      [trunk, shards1, shards2].forEach(function (mesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
      });
      scene.add(g);
    }

    /* 各地標可自訂淨空半徑；長形航母需要比一般建築更大的景觀留白。 */
    function clearOfLandmarks(x, z, padding) {
      for (var i = 0; i < PROJECTS.length; i++) {
        var lp = PROJECTS[i].landmark;
        if (!lp) continue;
        var clearance = (lp.clearance || 10) + (padding || 0);
        if (Math.hypot(x - lp.pos[0], z - lp.pos[1]) < clearance) return false;
      }
      return true;
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
      if (!clearOfLandmarks(px, pz, 0)) continue;
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
      if (!clearOfLandmarks(mx, mz, 1.5)) continue;
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
      if (!clearOfLandmarks(rx, rz, 1)) continue;
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

    /* 山脊上的小型風力發電機：以清楚的三葉輪廓取代封閉小屋。 */
    function windTurbine(hx, hz, scale, facing, bladeAngle, speed) {
      var tg = new THREE.Group();
      tg.position.set(hx, Terrain.ready() ? Terrain.height(hx, hz) : 0, hz);
      tg.scale.setScalar(scale);
      tg.rotation.y = facing;

      var tower = new THREE.Mesh(turbineTowerGeo, turbineM);
      tower.position.y = 2.6;
      var nacelle = new THREE.Mesh(turbineNacelleGeo, turbineM);
      nacelle.position.set(0, 5.12, 0.12);
      var rotor = new THREE.Group();
      rotor.position.set(0, 5.18, 0.62);
      rotor.rotation.z = bladeAngle;
      for (var i = 0; i < 3; i++) {
        var blade = new THREE.Mesh(turbineBladeGeo, turbineBladeM);
        blade.rotation.z = i * Math.PI * 2 / 3;
        rotor.add(blade);
      }
      var hub = new THREE.Mesh(turbineHubGeo, turbineM);
      rotor.add(hub);
      turbineRotors.push({ rotor: rotor, speed: speed });
      [tower, nacelle, hub].forEach(function (mesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      rotor.children.forEach(function (mesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      tg.add(tower, nacelle, rotor);
      scene.add(tg);
    }
    /* 航母佔用東側前景後，風機整組退到後方山脊，保留景深但不穿過船身。 */
    windTurbine(18, 10, 0.76, 0.10, 0.18, 0.34);
    windTurbine(30, 7, 0.82, 0.04, 0.88, 0.31);
    windTurbine(42, 10, 0.86, -0.08, 1.42, 0.36);
    windTurbine(53, 17, 0.78, 0.06, 0.54, 0.32);
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
        color: 0xFFFFFF, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, h + 0.07, z);
    scene.add(ring);
    ripples.push({
      x: x, z: z, r: 1.4, maxR: 34, speed: 18,
      age: 0, dur: 2.5, fade: 1, baseY: h + 0.07, ring: ring
    });
  }

  /* 沙粒位移：游標推沙 + 漣漪環帶（每幀更新被影響的沙粒矩陣） */
  var _tmpM = new THREE.Matrix4();
  var _tmpQ = new THREE.Quaternion();
  var _tmpTiltQ = new THREE.Quaternion();
  var _tmpAxis = new THREE.Vector3();
  var _tmpV = new THREE.Vector3();
  var _tmpS = new THREE.Vector3();

  function collectSandCandidates(x, z, outer, inner) {
    var minX = Math.floor((x - outer) / SAND_BUCKET_SIZE);
    var maxX = Math.floor((x + outer) / SAND_BUCKET_SIZE);
    var minZ = Math.floor((z - outer) / SAND_BUCKET_SIZE);
    var maxZ = Math.floor((z + outer) / SAND_BUCKET_SIZE);
    var halfDiagonal = SAND_BUCKET_SIZE * Math.SQRT2 / 2;
    for (var cellX = minX; cellX <= maxX; cellX++) {
      for (var cellZ = minZ; cellZ <= maxZ; cellZ++) {
        var centerX = (cellX + 0.5) * SAND_BUCKET_SIZE;
        var centerZ = (cellZ + 0.5) * SAND_BUCKET_SIZE;
        var centerDistance = Math.hypot(centerX - x, centerZ - z);
        if (centerDistance - halfDiagonal > outer) continue;
        if (inner > 0 && centerDistance + halfDiagonal < inner) continue;
        var bucket = sandBuckets[cellX + "," + cellZ];
        if (!bucket) continue;
        for (var bi = 0; bi < bucket.length; bi++) sandCandidates.add(bucket[bi]);
      }
    }
  }

  function updateSand(dt) {
    if (!sandAnimating && ripples.length === 0) return;
    sandAnimating = true;
    var follow = 1 - Math.exp(-18 * dt);
    cursorSmooth.lerp(cursorGround, follow);
    cursorVel.multiplyScalar(Math.exp(-7.5 * dt));   /* 時間制衰減：不同 FPS 手感一致 */
    var R = 9.0, CORE = 1.65, R2 = R * R;
    var dirty = false;
    var cx = cursorSmooth.x, cz = cursorSmooth.z;
    var vx = cursorVel.x, vz = cursorVel.z;
    var cursorSpeed = Math.hypot(vx, vz);

    sandCandidates.clear();
    sandActive.forEach(function (i) { sandCandidates.add(i); });
    if (cursorOn) collectSandCandidates(cx, cz, R, 0);
    for (var qr = 0; qr < ripples.length; qr++) {
      var queryRipple = ripples[qr];
      collectSandCandidates(
        queryRipple.x, queryRipple.z,
        queryRipple.r + 1.8,
        Math.max(0, queryRipple.r - 1.8)
      );
    }
    sandNextActive.clear();

    sandCandidates.forEach(function (i) {
      var bx = sandBase[i * 3], by = sandBase[i * 3 + 1], bz = sandBase[i * 3 + 2];
      var tx = 0, ty = 0, tz = 0;
      var driven = false;
      var effectStrength = 0;
      if (cursorOn) {
        var dx = bx - cx, dz = bz - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 < R2) {
          driven = true;
          var d = Math.sqrt(d2) + 0.001;
          var density = Math.exp(-Math.pow(d / 4.55, 1.7));
          var chance = cellHash(bx * 1.7, 19, bz * 1.7);
          var coreWeight = Math.max(0, 1 - d / CORE);
          var participation = Math.max(coreWeight, Math.max(0, Math.min(1, (density - chance * 0.78) * 2.4)));
          if (participation > 0.002) {
            var field = density * participation;
            effectStrength = field;
            var clear = Math.max(0, CORE - d) * (0.68 + cellHash(bx, 23, bz) * 0.18);
            var repel = clear + field * 0.42;
            var nx2 = dx / d, nz2 = dz / d;
            var tangent = (cellHash(bx, 29, bz) - 0.5) * field * 0.62;
            tx += nx2 * repel - nz2 * tangent;
            tz += nz2 * repel + nx2 * tangent;
            ty += (cellHash(bx, 31, bz) - 0.48) * field * 0.86;
            var lead = Math.min(1, cursorSpeed / 10) * field * 0.006;
            tx += vx * lead;
            tz += vz * lead;
          } else {
            driven = false;
          }
        }
      }
      for (var r = 0; r < ripples.length; r++) {
        var rp = ripples[r];
        var rx = bx - rp.x, rz = bz - rp.z;
        var rd = Math.sqrt(rx * rx + rz * rz) + 0.001;
        var bw = 1.8;
        var dd = Math.abs(rd - rp.r);
        if (dd < bw) {
          driven = true;
          var k = (1 - dd / bw) * rp.fade;
          effectStrength = Math.max(effectStrength, k);
          tx += (rx / rd) * k * 0.58;
          tz += (rz / rd) * k * 0.58;
          ty += k * 1.15;
        }
      }
      /* 排斥場快速讓位；游標離開後平滑回到原始沙床。 */
      var px = sandDisp[i * 3], py = sandDisp[i * 3 + 1], pz = sandDisp[i * 3 + 2];
      var rate = driven ? 15 : 4.2;
      var s = 1 - Math.exp(-rate * dt);
      var nx = px + (tx - px) * s;
      var ny = py + (ty - py) * s;
      var nz = pz + (tz - pz) * s;
      var md = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
      if (!driven && md < 0.018) {
        nx = 0; ny = 0; nz = 0; md = 0;           /* 微小殘差歸零，避免永久掃描 */
      }
      if (driven || md > 0) sandNextActive.add(i);
      if (Math.abs(nx - px) > 0.0005 || Math.abs(ny - py) > 0.0005 || Math.abs(nz - pz) > 0.0005) {
        sandDisp[i * 3] = nx; sandDisp[i * 3 + 1] = ny; sandDisp[i * 3 + 2] = nz;
        _tmpQ.set(sandQuat[i * 4], sandQuat[i * 4 + 1], sandQuat[i * 4 + 2], sandQuat[i * 4 + 3]);
        var visual = Math.max(Math.min(1, md / 0.52), Math.min(1, effectStrength) * 0.82);
        var tiltAngle = cellHash(bx, 37, bz) * Math.PI * 2;
        _tmpAxis.set(Math.cos(tiltAngle), 0, Math.sin(tiltAngle));
        _tmpTiltQ.setFromAxisAngle(_tmpAxis, visual * (0.10 + cellHash(bx, 41, bz) * 0.14));
        _tmpQ.multiply(_tmpTiltQ);
        _tmpV.set(bx + nx, by + ny, bz + nz);
        var scaleBoost = 1 + visual * (0.10 + cellHash(bx, 43, bz) * 0.08);
        _tmpS.setScalar(sandScale[i] * scaleBoost);
        _tmpM.compose(_tmpV, _tmpQ, _tmpS);
        sandMesh.setMatrixAt(i, _tmpM);
        dirty = true;
      }
    });

    var activeSwap = sandActive;
    sandActive = sandNextActive;
    sandNextActive = activeSwap;
    if (dirty) sandMesh.instanceMatrix.needsUpdate = true;
    if (ripples.length === 0 && !dirty) sandAnimating = false;
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
    sandAnimating = true;
    lastInteraction = performance.now();
    var jump = Math.hypot(cursorGround.x - lastCursor.x, cursorGround.z - lastCursor.z);
    if (jump > 25) {
      /* 首次移動 / 大跳躍：不產生速度 */
      lastCursor.copy(cursorGround);
      cursorSmooth.copy(cursorGround);
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
    sandAnimating = true;
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
    } else if (!RM && !DEBUG && nowMs - lastInteraction > 1200) {
      /* 真正按秒計算的低速環繞；不受 24/30/60fps 或 Firefox rAF 節流影響。 */
      var idleAngle = dt * 0.022;
      var idleX = camera.position.x - controls.target.x;
      var idleZ = camera.position.z - controls.target.z;
      camera.position.x = controls.target.x + idleX * Math.cos(idleAngle) + idleZ * Math.sin(idleAngle);
      camera.position.z = controls.target.z - idleX * Math.sin(idleAngle) + idleZ * Math.cos(idleAngle);
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

    if (!RM) {
      turbineRotors.forEach(function (turbine) {
        turbine.rotor.rotation.z += dt * turbine.speed;
      });
    }

    /* 漣漪：金圈外擴 + 消失 */
    for (var ri = ripples.length - 1; ri >= 0; ri--) {
      var rp = ripples[ri];
      rp.r += dt * rp.speed;
      rp.age += dt;
      var radiusProgress = Math.min(1, rp.r / rp.maxR);
      var life = Math.max(0, 1 - rp.age / rp.dur);
      var edge = 1 - Math.max(0, Math.min(1, (radiusProgress - 0.76) / 0.24));
      rp.fade = Math.pow(life, 1.35) * edge;
      rp.ring.scale.set(rp.r, rp.r, 1);
      rp.ring.material.opacity = 0.44 * rp.fade;
      rp.ring.position.y = rp.baseY - (1 - rp.fade) * 0.13;
      if (rp.fade < 0.005 || rp.age >= rp.dur) {
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
            if (p.landmark.type === "collection-library") buildCollectionLibrary(p);
            else if (p.landmark.type === "signal-tower") buildSignalTower(p);
            else if (p.landmark.type === "fleet-carrier") buildFleetCarrier(p);
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
      return {
        animating: sandAnimating,
        cursorOn: cursorOn,
        ripples: ripples.length,
        activeGrains: sandActive.size,
        candidateGrains: sandCandidates.size,
        movedGrains: cnt,
        maxDisp: +maxD.toFixed(3)
      };
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
