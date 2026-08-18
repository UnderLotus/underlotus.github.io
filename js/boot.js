/* ============================================================
 * boot.js —— 沙盤啟動遮罩
 * 本地腳本先於外部 WebGL 依賴載入，讓慢速網路也有即時狀態回饋。
 * ============================================================ */
(function () {
  "use strict";

  var boot = document.getElementById("boot");
  var bar = document.getElementById("boot-bar");
  var valueEl = document.getElementById("boot-value");
  var statusEl = document.getElementById("boot-status");
  if (!boot || !bar || !valueEl || !statusEl) return;

  document.documentElement.classList.add("booting");

  var startedAt = performance.now();
  var value = 6;
  var target = 14;
  var complete = false;
  var frame = 0;
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function paint() {
    var rounded = Math.max(0, Math.min(100, Math.round(value)));
    bar.style.transform = "scaleX(" + (rounded / 100) + ")";
    valueEl.value = String(rounded).padStart(3, "0") + "%";
    valueEl.textContent = valueEl.value;
  }

  function tick(now) {
    if (complete) return;
    target = Math.max(target, Math.min(78, 14 + (now - startedAt) * 0.026));
    value += (target - value) * 0.055;
    paint();
    frame = requestAnimationFrame(tick);
  }

  function finish(isFallback) {
    if (complete) return;
    complete = true;
    cancelAnimationFrame(frame);
    var wait = Math.max(0, 480 - (performance.now() - startedAt));

    setTimeout(function () {
      statusEl.textContent = isFallback ? "FALLBACK / ARCHIVE READY" : "SANDBOX ONLINE";
      function fill() {
        value += (100 - value) * 0.24;
        if (100 - value > 0.35) {
          paint();
          requestAnimationFrame(fill);
          return;
        }
        value = 100;
        paint();
        boot.classList.add("ready");
        function removeBoot() {
          if (boot.hidden) return;
          boot.hidden = true;
          boot.setAttribute("aria-hidden", "true");
          document.documentElement.classList.remove("booting");
        }
        /* reduced-motion：不做 translateY 整頁拉開，改短淡出（opacity transition） */
        if (reducedMotion) {
          boot.addEventListener("transitionend", function (event) {
            if (event.target === boot && event.propertyName === "opacity") removeBoot();
          }, { once: true });
          boot.classList.add("departing");
          setTimeout(removeBoot, 320);   /* 保險：即使 transition 未觸發也不卡住 */
        } else {
          boot.addEventListener("transitionend", function (event) {
            if (event.target === boot && event.propertyName === "transform") removeBoot();
          }, { once: true });
          setTimeout(function () { boot.classList.add("departing"); }, 180);
          setTimeout(removeBoot, 1100);
        }
      }
      requestAnimationFrame(fill);
    }, wait);
  }

  document.addEventListener("sandbox:progress", function (event) {
    var detail = event.detail || {};
    if (typeof detail.value === "number") {
      target = Math.max(target, Math.min(96, detail.value));
      value = Math.max(value, target * 0.9);
      paint();
    }
    if (detail.label) statusEl.textContent = detail.label;
  });
  document.addEventListener("sandbox:ready", function () { finish(false); });
  document.addEventListener("sandbox:error", function () { finish(true); });
  window.addEventListener("load", function () { target = Math.max(target, 46); }, { once: true });

  paint();
  frame = requestAnimationFrame(tick);
})();
