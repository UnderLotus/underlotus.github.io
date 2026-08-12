/* ============================================================
 * site.js —— DOM／互動層（不依賴 WebGL）
 * 負責：TOC 目錄、ARCHIVE 卡、時鐘、預覽卡開關、事件匯流排
 * ============================================================ */
(function () {
  "use strict";

  var PROJECTS = window.PROJECTS || [];
  var UNMAPPED = window.UNMAPPED || { hidden: true };
  var SITE = window.SITE || {};

  var currentId = null;
  var returnFocus = null;

  /* ---------- 事件匯流排 ---------- */
  function bus(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  /* ---------- 狀態點顏色 ---------- */
  function statusClass(status) {
    return (status === "LIVE" || status === "ACTIVE") ? "on" : "off";
  }

  /* ---------- TOC 目錄 ---------- */
  function buildToc() {
    var toc = document.getElementById("toc");
    if (!toc) return;
    var html = "";
    PROJECTS.forEach(function (p, i) {
      html +=
        '<button class="toc-item" data-id="' + p.id + '">' +
          '<i class="dot ' + statusClass(p.status) + '"></i>' +
          '<span class="idx">' + p.id + '</span>' +
          '<span class="toc-name">' + p.slug.toUpperCase() + '</span>' +
        '</button>';
    });
    if (!UNMAPPED.hidden) {
      html +=
        '<button class="toc-item" data-id="UNMAPPED" disabled>' +
          '<i class="dot off"></i>' +
          '<span class="idx">--</span>' +
          '<span class="toc-name">UNMAPPED</span>' +
        '</button>';
    }
    toc.innerHTML = html;
    toc.querySelectorAll(".toc-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openById(btn.getAttribute("data-id"));
      });
    });
  }

  /* ---------- ARCHIVE 卡 ---------- */
  function buildArchive() {
    var grid = document.getElementById("archive-grid");
    if (!grid) return;
    var html = "";
    PROJECTS.forEach(function (p) {
      var links = "";
      if (p.links.github) links += '<a href="' + p.links.github + '" target="_blank" rel="noopener">GITHUB ↗</a>';
      if (p.links.demo) links += '<a href="' + p.links.demo + '" target="_blank" rel="noopener">DEMO ↗</a>';
      html +=
        '<article class="arc-card">' +
          '<div class="arc-head mono"><span>' + p.id + ' · PROJECT ENTRY</span><span>' + p.status + '</span></div>' +
          '<h3 class="arc-title">' + p.title + '</h3>' +
          '<p class="arc-slug mono">' + p.slug + '</p>' +
          '<p class="arc-zh">' + p.zh + '</p>' +
          '<ul class="arc-tags">' + p.tags.map(function (t) { return "<li>" + t + "</li>"; }).join("") + '</ul>' +
          '<div class="arc-links mono">' + links + '</div>' +
        '</article>';
    });
    grid.innerHTML = html;
  }

  /* ---------- 時鐘 ---------- */
  function tick() {
    var el = document.getElementById("clock");
    if (!el || !SITE.timezone) return;
    var now = new Date();
    var time = now.toLocaleTimeString("en-GB", {
      timeZone: SITE.timezone, hour12: false,
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    var narrow = window.innerWidth <= 640;
    var date = now.toLocaleDateString("en-CA", { timeZone: SITE.timezone });
    el.textContent = narrow ? "T " + time : "T " + date + " " + time + " +08";
  }
  setInterval(tick, 1000);

  /* ---------- 預覽卡 ---------- */
  function renderCard(p) {
    var inner = document.getElementById("card-inner");
    var links = "";
    if (p.links.github) links += '<a href="' + p.links.github + '" target="_blank" rel="noopener">GITHUB ↗</a>';
    if (p.links.demo) links += '<a href="' + p.links.demo + '" target="_blank" rel="noopener">DEMO ↗</a>';
    inner.innerHTML =
      '<div class="card-head mono"><span>' + p.id + ' · PROJECT ENTRY</span></div>' +
      '<h2 class="card-title" id="card-title">' + p.title + '</h2>' +
      '<p class="card-slug mono">' + p.slug + '</p>' +
      '<p class="card-zh">' + p.zh + '</p>' +
      '<p class="card-desc">' + p.desc + '</p>' +
      '<ul class="card-tags">' + p.tags.map(function (t) { return "<li>" + t + "</li>"; }).join("") + '</ul>' +
      '<dl class="card-meta mono">' +
        '<div class="row"><dt>STATUS</dt><dd>' + p.status + '</dd></div>' +
        '<div class="row"><dt>YEAR</dt><dd>' + p.year + '</dd></div>' +
        '<div class="row"><dt>ID</dt><dd>' + p.id + '</dd></div>' +
      '</dl>' +
      '<div class="card-links mono">' + links + '</div>';
    inner.scrollTop = 0;
  }

  function setTocActive(id) {
    document.querySelectorAll(".toc-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-id") === id);
    });
  }

  function openCard(id) {
    var p = PROJECTS.find(function (x) { return x.id === id; });
    if (!p) return;
    if (!currentId) returnFocus = document.activeElement;
    currentId = id;
    renderCard(p);
    var card = document.getElementById("card");
    var modal = window.innerWidth <= 640;
    card.inert = false;
    card.classList.add("open");
    card.setAttribute("aria-hidden", "false");
    card.setAttribute("aria-modal", modal ? "true" : "false");
    document.body.classList.add("card-open");
    var page = document.querySelector(".page");
    if (page && modal) page.inert = true;
    setTocActive(id);
    requestAnimationFrame(function () {
      var close = card.querySelector(".card-close");
      if (close) close.focus({ preventScroll: true });
    });
    if (history.replaceState) {
      history.replaceState(null, "", "#" + id);
    }
  }

  function closeCard() {
    var card = document.getElementById("card");
    if (!card.classList.contains("open")) return;
    card.classList.remove("open");
    card.setAttribute("aria-hidden", "true");
    card.setAttribute("aria-modal", "false");
    card.inert = true;
    document.body.classList.remove("card-open");
    var page = document.querySelector(".page");
    if (page) page.inert = false;
    currentId = null;
    setTocActive(null);
    bus("site:close");
    if (history.replaceState && location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (returnFocus && typeof returnFocus.focus === "function") {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  /* 開啟一個地標（TOC／deep link 共用）：開卡 + 通知沙盤 */
  function openById(id) {
    if (id === "UNMAPPED") return;
    openCard(id);
    bus("site:open", { id: id });
  }

  /* ---------- 事件接線 ---------- */
  /* 沙盤點擊地標 → 開卡；點空白 → 關卡 */
  document.addEventListener("sandbox:select", function (e) {
    openCard(e.detail.id);
  });
  document.addEventListener("sandbox:close", closeCard);
  var backdrop = document.getElementById("card-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeCard);
  var closeButton = document.querySelector("#card > .card-close");
  if (closeButton) closeButton.addEventListener("click", closeCard);
  /* 鍵盤 ESC 關卡 */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeCard();
  });

  /* deep link：#PRJ-XXX */
  function readHash() {
    var h = location.hash.replace("#", "");
    if (h && PROJECTS.some(function (p) { return p.id === h; })) {
      openById(h);
    }
  }
  window.addEventListener("hashchange", readHash);

  /* ---------- 啟動 ---------- */
  buildToc();
  buildArchive();
  tick();
  readHash();
  var coordEl = document.getElementById("coord");
  if (coordEl && SITE.coordinate) coordEl.textContent = SITE.coordinate;
})();
