/* ============================================================
 * terrain.js —— 真實地形（台北 七星山—陽明山—盆地 橫斷面）
 * 來源：Mapzen/AWS elevation-tiles-prod（terrarium 格式，公開發布）
 * 世界座標 → 圖素 → 雙線性插值；沙盤邊緣漸平融入霧
 * ============================================================ */
window.Terrain = (function () {
  "use strict";

  var map = null, W = 0, H = 0;
  var ok = false;

  var VSCALE = 120;      /* 1 world unit = 120m → 七星山頂 1100m ≈ 9 units */
  var WORLD = 95;        /* 沙盤半徑 */
  var FADE_R = 85;       /* 邊緣漸平：僅外緣 85-135（28.8km² 地形幾乎全覆蓋） */
  var FADE_MAX = 135;

  function boxBlur(src, w, h) {
    var out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx, yy = y + dy;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h) { s += src[yy * w + xx]; n++; }
          }
        }
        out[y * w + x] = s / n;
      }
    }
    return out;
  }

  function load(cb) {
    var img = new Image();
    img.onload = function () {
      try {
        W = img.width; H = img.height;
        var c = document.createElement("canvas");
        c.width = W; c.height = H;
        var g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        var d = g.getImageData(0, 0, W, H).data;
        var raw = new Float32Array(W * H);
        for (var i = 0; i < W * H; i++) {
          var e = (d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256) - 32768;
          raw[i] = e > 0 ? e : 0;
        }
        map = boxBlur(boxBlur(raw, W, H), W, H);
        ok = true;
      } catch (err) {
        ok = false;
      }
      cb(ok);
    };
    img.onerror = function () { ok = false; cb(false); };
    img.src = "assets/terrain.png";
  }

  /* 世界座標 → 海拔（world units，含邊緣漸平） */
  function height(wx, wz) {
    if (!map) return 0;
    var fx = (wx + WORLD) / (WORLD * 2) * (W - 1);
    var fy = (wz + WORLD) / (WORLD * 2) * (H - 1);
    if (fx < 0 || fx > W - 1 || fy < 0 || fy > H - 1) return 0;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    var tx = fx - x0, ty = fy - y0;
    var h = (map[y0 * W + x0] * (1 - tx) + map[y0 * W + x1] * tx) * (1 - ty) +
            (map[y1 * W + x0] * (1 - tx) + map[y1 * W + x1] * tx) * ty;
    h = h / VSCALE;
    var r = Math.hypot(wx, wz);
    if (r > FADE_R) {
      var k = Math.min(1, (r - FADE_R) / (FADE_MAX - FADE_R));
      h *= Math.cos(k * Math.PI / 2);
    }
    return h;
  }

  return { load: load, height: height, ready: function () { return ok; } };
})();
