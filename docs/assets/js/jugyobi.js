/* 結び屋の道具「授業日スタンプ」
 * スタンプを選ぶ → カレンダーを押す → 配る形（画像・日付の一覧・カレンダー取り込み）で出す。
 * 入れた内容は、このブラウザの中（localStorage）にだけ残す。どこにも送らない。
 */
(function () {
  "use strict";
  var root = document.getElementById("stamp-tool");
  if (!root) return;

  // 祝日（内閣府の「国民の祝日」の表から。振替休日と国民の休日を含む）。表示と「曜日でまとめて入れる」に使う
  // 次の年の分は、内閣府が前の年の2月に春分と秋分の日を公表してから足す
  var HOL_UNTIL = 2027;
  var HOL = new Set([
    "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
    "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
    "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05",
    "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23"
  ]);
  var WD = ["日", "月", "火", "水", "木", "金", "土"];
  var KEY = "musubiya-jugyobi-stamp-v1";
  var now = new Date();
  var S = {
    stamps: [
      { id: "a", name: "授業", color: "#2A73A8", start: "", end: "" },
      { id: "b", name: "テスト対策", color: "#2F8F6B", start: "", end: "" },
      { id: "c", name: "休講", color: "#8A93A0", start: "", end: "" }
    ],
    marks: {}, y: now.getFullYear(), m: now.getMonth(), cnt: 2, title: "", sel: "a", preset: "class", img: "each"
  };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.stamps && saved.marks) for (var k in saved) S[k] = saved[k];
  } catch (e) { /* 使えない時は覚えないだけ */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 同上 */ } }

  function $(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function key(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function stampOf(id) { return S.stamps.filter(function (s) { return s.id === id; })[0]; }
  function short(n) { return Array.from(n || "").slice(0, 2).join(""); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // 使い方の例：選ぶとスタンプの名前だけが入れ替わる（押した日はそのまま）
  var PRESETS = [
    { k: "class", label: "授業のある日", names: ["授業", "テスト対策", "休講"] },
    { k: "place", label: "どこにいるか（掛け持ち）", names: ["○○校", "△△校", "お休み"] },
    { k: "work", label: "出勤とお休み", names: ["出勤", "午後から", "お休み"] }
  ];
  function drawPresets() {
    $("presets").innerHTML = PRESETS.map(function (p) {
      return '<button type="button" class="preset" data-k="' + p.k + '" aria-pressed="' + ((S.preset || "class") === p.k) + '">' + p.label + "</button>";
    }).join("");
    $("presets").querySelectorAll(".preset").forEach(function (b) {
      b.onclick = function () {
        var p = PRESETS.filter(function (x) { return x.k === b.dataset.k; })[0];
        S.preset = p.k;
        S.stamps.forEach(function (s, i) { s.name = p.names[i]; });
        save(); drawPresets(); drawStamps(); drawEdit(); drawCal(); drawOut();
      };
    });
  }
  function drawStamps() {
    $("stamps").innerHTML = S.stamps.map(function (s) {
      return '<button type="button" class="stamp" data-id="' + s.id + '" aria-pressed="' + (S.sel === s.id) + '"><span class="dot" style="background:' + s.color + '">' + esc(short(s.name)) + "</span>" + esc(s.name) + "</button>";
    }).join("") + '<button type="button" class="stamp erase" data-id="" aria-pressed="' + (S.sel === "") + '"><span class="dot">消</span>消しゴム</button>';
    $("stamps").querySelectorAll(".stamp").forEach(function (b) {
      b.onclick = function () { S.sel = b.dataset.id; save(); drawStamps(); };
    });
  }
  function drawEdit() {
    $("edit").innerHTML = S.stamps.map(function (s, i) {
      return '<div class="row"><span class="sw" style="background:' + s.color + '"></span>' +
        '<input type="text" maxlength="12" value="' + esc(s.name) + '" data-i="' + i + '" data-k="name" aria-label="スタンプ' + (i + 1) + 'の名前">' +
        '<input class="t1" type="time" value="' + esc(s.start) + '" data-i="' + i + '" data-k="start" aria-label="スタンプ' + (i + 1) + 'の始まる時間">' +
        '<input class="t2" type="time" value="' + esc(s.end) + '" data-i="' + i + '" data-k="end" aria-label="スタンプ' + (i + 1) + 'の終わる時間"></div>';
    }).join("");
    $("edit").querySelectorAll("input").forEach(function (el) {
      el.oninput = function () { S.stamps[+el.dataset.i][el.dataset.k] = el.value; save(); drawStamps(); drawCal(); drawOut(); };
    });
  }
  function monthsList() {
    var out = [];
    for (var i = 0; i < S.cnt; i++) { var d = new Date(S.y, S.m + i, 1); out.push([d.getFullYear(), d.getMonth()]); }
    return out;
  }
  // 表示している月の中で、スタンプが入っている日（日付順）
  function shown() {
    var set = new Set(monthsList().map(function (a) { return a[0] + "-" + pad(a[1] + 1); }));
    return Object.keys(S.marks).filter(function (k) { return set.has(k.slice(0, 7)) && stampOf(S.marks[k]); }).sort();
  }
  function drawCal(popKey) {
    $("from").textContent = S.y + "年" + (S.m + 1) + "月から";
    $("cnt").value = String(S.cnt);
    $("months").innerHTML = monthsList().map(function (a) {
      var y = a[0], m = a[1], first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
      var h = '<div class="month"><h3>' + y + "年" + (m + 1) + '月</h3><div class="cal">';
      h += WD.map(function (w, i) {
        return '<button type="button" class="wd ' + (i === 0 ? "sun" : i === 6 ? "sat" : "") + '" data-y="' + y + '" data-m="' + m + '" data-w="' + i + '" aria-label="' + (m + 1) + "月の" + w + '曜日にまとめて入れる">' + w + "</button>";
      }).join("");
      for (var i = 0; i < first; i++) h += '<span class="day empty"></span>';
      for (var d = 1; d <= last; d++) {
        var k = key(y, m, d), w = (first + d - 1) % 7, st = stampOf(S.marks[k]);
        var cls = ["day", w === 0 ? "sun" : w === 6 ? "sat" : "", HOL.has(k) ? "hol" : "", st ? "on" : "", k === popKey ? "pop" : ""].join(" ");
        h += '<button type="button" class="' + cls + '" data-k="' + k + '" aria-label="' + (m + 1) + "月" + d + "日 " + WD[w] + "曜" + (HOL.has(k) ? " 祝日" : "") + (st ? " " + esc(st.name) : "") + '"><span class="n">' + d + "</span>" +
          (st ? '<span class="m" style="background:' + st.color + '">' + esc(short(st.name)) + "</span>" : "") + "</button>";
      }
      return h + "</div></div>";
    }).join("");
    $("months").querySelectorAll(".day[data-k]").forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.k;
        if (S.sel === "" || S.marks[k] === S.sel) delete S.marks[k]; else S.marks[k] = S.sel;
        save(); drawCal(k); drawOut();
      };
    });
    $("months").querySelectorAll(".wd").forEach(function (b) {
      b.onclick = function () {
        var y = +b.dataset.y, m = +b.dataset.m, w = +b.dataset.w, last = new Date(y, m + 1, 0).getDate(), ks = [];
        for (var d = 1; d <= last; d++) { var k = key(y, m, d); if (new Date(y, m, d).getDay() === w && !HOL.has(k)) ks.push(k); }
        if (S.sel === "") ks.forEach(function (k) { delete S.marks[k]; });
        else if (ks.every(function (k) { return S.marks[k] === S.sel; })) ks.forEach(function (k) { delete S.marks[k]; });
        else ks.forEach(function (k) { S.marks[k] = S.sel; });
        save(); drawCal(); drawOut();
      };
    });
    var inView = shown();
    $("count").textContent = inView.length
      ? "いま入っている数：" + S.stamps.map(function (s) { return s.name + " " + inView.filter(function (k) { return S.marks[k] === s.id; }).length + "日"; }).join("　")
      : "まだ何も入っていません。上でスタンプを選んで、日付を押してみてください！";
    var lastShown = monthsList()[S.cnt - 1][0];
    $("holnote").textContent = lastShown > HOL_UNTIL ? "祝日は" + HOL_UNTIL + "年の分まで入っています。それより先の祝日は、色が付かず、まとめて入れる時にも外れません。" : "";
  }
  function timeOf(s) { return s.start ? (s.end ? s.start + "〜" + s.end : s.start + "〜") : ""; }
  function listText() {
    var ks = shown();
    if (!ks.length) return "";
    var out = [];
    if (S.title) out.push(S.title + " 予定");
    S.stamps.forEach(function (s) {
      var mine = ks.filter(function (k) { return S.marks[k] === s.id; });
      if (!mine.length) return;
      out.push(""); out.push("【" + s.name + "】" + timeOf(s));
      var by = {}, order = [];
      mine.forEach(function (k) {
        var p = k.split("-").map(Number), mm = p[0] + "年" + p[1] + "月";
        if (!by[mm]) { by[mm] = []; order.push(mm); }
        by[mm].push(p[2] + "日(" + WD[new Date(p[0], p[1] - 1, p[2]).getDay()] + ")");
      });
      order.forEach(function (mm) { out.push(mm + "：" + by[mm].join("、")); });
    });
    return out.join("\n").trim();
  }
  function icsEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  function icsText() {
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//musubiya//jugyobi-stamp//JA", "CALSCALE:GREGORIAN"];
    var st0 = new Date(), stamp = st0.getUTCFullYear() + pad(st0.getUTCMonth() + 1) + pad(st0.getUTCDate()) + "T" + pad(st0.getUTCHours()) + pad(st0.getUTCMinutes()) + pad(st0.getUTCSeconds()) + "Z";
    shown().forEach(function (k) {
      var s = stampOf(S.marks[k]), ymd = k.replace(/-/g, "");
      L.push("BEGIN:VEVENT", "UID:" + ymd + "-" + s.id + "@musubiya-miko.com", "DTSTAMP:" + stamp);
      if (s.start) {
        L.push("DTSTART;TZID=Asia/Tokyo:" + ymd + "T" + s.start.replace(":", "") + "00");
        L.push("DTEND;TZID=Asia/Tokyo:" + ymd + "T" + (s.end || s.start).replace(":", "") + "00");
      } else {
        var d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + 1);
        L.push("DTSTART;VALUE=DATE:" + ymd, "DTEND;VALUE=DATE:" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()));
      }
      L.push("SUMMARY:" + icsEsc((S.title ? S.title + " " : "") + s.name), "END:VEVENT");
    });
    L.push("END:VCALENDAR");
    return L.join("\r\n");
  }
  // 配る用の画像（明るい紙の上に描く。どの端末で見ても同じ見た目）
  function drawImage(ms, cols) {
    var rows = Math.ceil(ms.length / cols), fs = cols === 1 ? 1.25 : 1;   // 1か月ずつの時は、スマホで読めるよう字を大きく
    var inMs = new Set(ms.map(function (a) { return a[0] + "-" + pad(a[1] + 1); }));
    var mine = shown().filter(function (k) { return inMs.has(k.slice(0, 7)); });
    var cell = 68, gap = 4, mw = cell * 7 + gap * 6, mh = 44 + 30 + (cell + gap) * 6, pad0 = 40, gx = 48, gy = 28;
    var used = S.stamps.filter(function (s) { return mine.some(function (k) { return S.marks[k] === s.id; }); });
    var W = pad0 * 2 + mw * cols + gx * (cols - 1), top = S.title ? 110 : 40, legendH = used.length ? 44 * Math.ceil(used.length / cols) + 16 : 0;
    var H = top + rows * mh + (rows - 1) * gy + legendH + 60;
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    var g = c.getContext("2d");
    function F(px, b) { return (b ? "700 " : "") + Math.round(px * fs) + 'px "Hiragino Sans","Yu Gothic","Meiryo",sans-serif'; }
    function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H); g.textBaseline = "middle";
    if (S.title) { g.fillStyle = "#1B2E45"; g.font = F(36, true); g.textAlign = "center"; g.fillText(S.title + " 予定表", W / 2, 60); }
    ms.forEach(function (a, i) {
      var y = a[0], m = a[1], ox = pad0 + (i % cols) * (mw + gx), oy = top + Math.floor(i / cols) * (mh + gy);
      g.fillStyle = "#1B2E45"; g.font = F(26, true); g.textAlign = "left"; g.fillText(y + "年" + (m + 1) + "月", ox, oy + 18);
      WD.forEach(function (w, j) { g.fillStyle = j === 0 ? "#C8102E" : j === 6 ? "#2A73A8" : "#4A586C"; g.font = F(18); g.textAlign = "center"; g.fillText(w, ox + j * (cell + gap) + cell / 2, oy + 58); });
      var first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
      for (var d = 1; d <= last; d++) {
        var idx = first + d - 1, w = idx % 7, x = ox + w * (cell + gap), yy = oy + 76 + Math.floor(idx / 7) * (cell + gap), k = key(y, m, d), st = stampOf(S.marks[k]);
        rr(x, yy, cell, cell, 8);
        if (st) { g.fillStyle = st.color; g.fill(); } else { g.strokeStyle = "#D3DBE4"; g.lineWidth = 1; g.stroke(); }
        g.fillStyle = st ? "#FFFFFF" : (w === 0 || HOL.has(k)) ? "#C8102E" : w === 6 ? "#2A73A8" : "#1B2E45";
        g.font = F(st ? 18 : 22, !!st); g.textAlign = "center"; g.fillText(String(d), x + cell / 2, yy + (st ? 20 : cell / 2));
        if (st) { g.font = F(18, true); g.fillText(short(st.name), x + cell / 2, yy + 46); }
      }
    });
    var ly = top + rows * mh + (rows - 1) * gy + 24;
    used.forEach(function (s, i) {
      var x = pad0 + (i % cols) * (mw + gx), y2 = ly + Math.floor(i / cols) * 44;
      rr(x, y2 - 14, 28, 28, 6); g.fillStyle = s.color; g.fill();
      g.fillStyle = "#1B2E45"; g.font = F(20); g.textAlign = "left"; g.fillText(s.name + (timeOf(s) ? "　" + timeOf(s) : ""), x + 40, y2);
    });
    return c.toDataURL("image/png");
  }
  // 保存の名前は英数字にする（日本語の名前は、ブラウザによって「download」という拡張子の無い名前になってしまうため）
  function download(href, name) { var a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function drawOut() {
    var ms = monthsList(), each = S.img !== "all";
    var pics = each
      ? ms.map(function (a) { return { src: drawImage([a], 1), name: "yoteihyo-" + a[0] + "-" + pad(a[1] + 1) + ".png", alt: a[0] + "年" + (a[1] + 1) + "月の予定表" }; })
      : [{ src: drawImage(ms, ms.length === 1 ? 1 : 2), name: "yoteihyo.png", alt: "予定表" }];
    $("imgs").className = each ? "" : "all";
    $("imgs").innerHTML = pics.map(function (p, i) {
      return '<figure><img src="' + p.src + '" alt="' + esc(p.alt) + '"><div class="act"><button type="button" data-i="' + i + '">この画像を保存する</button></div></figure>';
    }).join("");
    $("imgs").querySelectorAll("button").forEach(function (b) { b.onclick = function () { var p = pics[+b.dataset.i]; download(p.src, p.name); }; });
    root.querySelectorAll(".mode").forEach(function (b) { b.setAttribute("aria-pressed", String((b.dataset.v === "all") === !each)); });
    $("outtxt").value = listText() || "まだ何も入っていません。";
  }

  root.querySelectorAll(".mode").forEach(function (b) { b.onclick = function () { S.img = b.dataset.v; save(); drawOut(); }; });
  $("copytxt").onclick = function () {
    var t = $("outtxt");
    function done(ok) { $("copymsg").textContent = ok ? "コピーしました！" : "コピーできませんでした。上の文を選んでコピーしてください。"; }
    function fallback() { t.focus(); t.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; } done(ok); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(function () { done(true); }, fallback);
    else fallback();
  };
  $("saveics").onclick = function () {
    if (!shown().length) { $("icsmsg").textContent = "まだ何も入っていません。"; return; }
    var url = URL.createObjectURL(new Blob([icsText()], { type: "text/calendar" }));
    download(url, "yotei.ics");
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    $("icsmsg").textContent = "保存したファイルを、カレンダーのアプリで開くと取り込めます！";
  };
  root.querySelectorAll(".tab").forEach(function (t) {
    t.onclick = function () {
      root.querySelectorAll(".tab").forEach(function (x) { x.setAttribute("aria-selected", String(x === t)); });
      root.querySelectorAll(".pane").forEach(function (p) { p.classList.toggle("show", p.id === "p-" + t.dataset.p); });
    };
  });
  $("prev").onclick = function () { var d = new Date(S.y, S.m - 1, 1); S.y = d.getFullYear(); S.m = d.getMonth(); save(); drawCal(); drawOut(); };
  $("next").onclick = function () { var d = new Date(S.y, S.m + 1, 1); S.y = d.getFullYear(); S.m = d.getMonth(); save(); drawCal(); drawOut(); };
  $("cnt").onchange = function (e) { S.cnt = +e.target.value; save(); drawCal(); drawOut(); };
  $("title").value = S.title;
  $("title").oninput = function (e) { S.title = e.target.value; save(); drawOut(); };
  drawPresets(); drawStamps(); drawEdit(); drawCal(); drawOut();
})();
