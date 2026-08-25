/* ============================================================
 * 專案資料檔 —— 未來的專案都在這裡登錄
 * ============================================================
 * 新增專案：複製一個物件，改欄位即可。地標會自動在沙盤上長出來。
 *
 * 欄位說明：
 *   id      檔案編號（顯示用，也做 deep link：#PRJ-XXX）
 *   slug    顯示名稱（mono 小字）
 *   title   主標題（大字）
 *   zh      繁體中文一句話
 *   desc    英文描述（資訊索引，沿用 repo description）
 *   tags    技術棧
 *   year    年份
 *   status  LIVE / ACTIVE / IDLE（會決定狀態點的顏色）
 *   links   github / demo / 其他外連（沒有的欄位留空字串）
 *   landmark 地標設定：
 *     type   collection-library（收藏圖書館）| signal-tower（訊號塔）| fleet-carrier（艦隊航母）
 *     pos    座標 [x, z]（以沙盤中心為原點，地面為 y=0）
 *     scale  縮放（預設 1）
 *     rotation Y 軸旋轉（弧度，預設 0）
 *     clearance 周圍填充物的淨空半徑（預設 10）
 * ============================================================ */

window.PROJECTS = [
  {
    id: "PRJ-001",
    slug: "r1999-roster",
    title: "R1999 Roster",
    zh: "重返未來：1999 的角色收集追蹤器——點擊標記擁有狀態、追蹤共鳴等級、多語言搜尋，並可匯出你的收藏清單。",
    desc: "A fan-made character collection tracker for Reverse: 1999. Tap to mark owned, track Portray levels, search across languages, and export your roster.",
    tags: ["React", "TypeScript", "Vite", "GitHub Pages"],
    year: "2026",
    status: "LIVE",
    links: {
      github: "https://github.com/UnderLotus/r1999-roster",
      demo: "https://underlotus.github.io/r1999-roster/"
    },
    landmark: {
      type: "collection-library",
      pos: [-17, 35],
      scale: 1
    }
  },
  {
    id: "PRJ-002",
    slug: "reverse1999-code-bot",
    title: "R1999 Code Bot",
    zh: "重返未來：1999 兌換碼監控 bot——自動掃描公開來源、抽取有效兌換碼，並發布到 Bluesky 讓玩家領取。",
    desc: "Reverse: 1999 redemption code bot — monitors public sources, extracts codes, publishes to Bluesky.",
    tags: ["Python", "Docker", "Bluesky API"],
    year: "2026",
    status: "ACTIVE",
    links: {
      github: "https://github.com/UnderLotus/reverse1999-code-bot",
      demo: "https://bsky.app/profile/r1999-code-kanban.bsky.social"
    },
    landmark: {
      type: "signal-tower",
      pos: [4, 50],
      scale: 1
    }
  },
  {
    id: "PRJ-003",
    slug: "r1999-timekeeper-fleet",
    title: "R1999 Timekeeper Fleet",
    zh: "《重返未來：1999》角色、心相與隊伍配置管理工具——記錄養成狀態、組建隊伍，並透過連結或圖片分享配置。",
    desc: "A small tool for organizing Reverse: 1999 characters, psychubes, and team configurations.",
    tags: ["React", "TypeScript", "Zustand", "Vite", "GitHub Pages"],
    year: "2026",
    status: "LIVE",
    links: {
      github: "https://github.com/UnderLotus/r1999-timekeeper-fleet",
      demo: "https://underlotus.github.io/r1999-timekeeper-fleet/"
    },
    landmark: {
      type: "fleet-carrier",
      pos: [31, 38],
      scale: 0.7,
      rotation: -0.18,
      clearance: 12
    }
  }
];

/* 未登錄區：留白是誠實的。未來若要把翻譯／影片等另一身分的作品
 * 登錄進來，把 UNMAPPED.hidden 設為 false，並加入上面的 PROJECTS。 */
window.UNMAPPED = {
  hidden: false,
  pos: [-38, 20],
  label: "UNMAPPED",
  note: "未登錄 · 留白待續"
};

window.SITE = {
  name: "underlotus",
  role: "AGENTIC CODER · TAIWAN",
  coordinate: "N25.165 · E121.553",
  timezone: "Asia/Taipei",
  github: "https://github.com/UnderLotus",
  year: "2026"
};
