/* 結び屋の道具「年間行事予定表メーカー」
 * 年度を選ぶ → 行事を入れる（日にち／何日も続く／月だけ）→ 配る形（年間の表・カレンダー・一覧の文・カレンダー取り込み）で出す。
 * 入れた内容は、このブラウザの中（localStorage）にだけ残す。どこにも送らない。
 */
(function () {
  "use strict";
  var root = document.getElementById("nenkan-tool");
  if (!root) return;

  // 祝日は shukujitsu.js から読む（授業日スタンプと共有）。カレンダーの日付を赤くするだけに使う
  var H = window.MUSUBIYA_HOL || { until: 0, days: [] };
  var HOL = new Set(H.days);
  var WD = ["日", "月", "火", "水", "木", "金", "土"];
  var KEY = "musubiya-nenkan-gyoji-v1";
  var C = { ink: "#1B2E45", body: "#4A586C", line: "#D3DBE4", ai: "#2A73A8", aiBg: "#E3EEF7", red: "#C8102E", off: "#7A8494", offBg: "#ECEFF3" };

  function $(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(k) { var p = k.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2] || 1); }
  function ymOf(k) { return k.slice(0, 7); }
  function wd(k) { return WD[parse(k).getDay()]; }
  function dayText(k) { return parse(k).getDate() + "日(" + wd(k) + ")"; }
  function mdText(k) { var d = parse(k); return (d.getMonth() + 1) + "月" + d.getDate() + "日(" + wd(k) + ")"; }

  // 最初に出す年度：4月始まりは5か月先、1月始まりは3か月先が入る年（次の年度を作り始める頃に合わせる）
  function defaultYear(start) {
    var now = new Date(), d = new Date(now.getFullYear(), now.getMonth() + (start === 4 ? 5 : 3), 1);
    return start === 4 ? (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1) : d.getFullYear();
  }
  var S = { start: 4, year: defaultYear(4), title: "", items: [], seq: 1, table: "two", cal: "each", tab: "table", type: "day", kind: "event" };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.items) for (var k in saved) S[k] = saved[k];
  } catch (e) { /* 使えない時は覚えないだけ */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 同上 */ } }

  // 表示している年度の12か月（[年, 月(0〜11)]）と、最初と最後の日
  function months() {
    var out = [];
    for (var i = 0; i < 12; i++) { var d = new Date(S.year, S.start - 1 + i, 1); out.push([d.getFullYear(), d.getMonth()]); }
    return out;
  }
  function firstDay() { return ymd(new Date(S.year, S.start - 1, 1)); }
  function lastDay() { return ymd(new Date(S.year, S.start - 1 + 12, 0)); }
  function yearLabel() { return S.start === 4 ? S.year + "年度" : S.year + "年"; }
  function inYear(it) {
    var a = firstDay(), b = lastDay();
    if (it.type === "month") return it.ym >= a.slice(0, 7) && it.ym <= b.slice(0, 7);
    return it.d1 >= a && it.d1 <= b;
  }
  function sortKey(it) { return it.type === "month" ? it.ym + "-99" : it.d1; }
  function shown() { return S.items.filter(inYear).sort(function (a, b) { return sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : a.id - b.id; }); }

  // その月に出る予定（何日も続く予定は、かかる月すべてに出す）
  function itemsIn(y, m) {
    var ym = y + "-" + pad(m + 1), first = ym + "-01", last = ymd(new Date(y, m + 1, 0));
    return shown().filter(function (it) {
      if (it.type === "month") return it.ym === ym;
      if (it.type === "day") return ymOf(it.d1) === ym;
      return it.d1 <= last && it.d2 >= first;
    });
  }
  // その月の中での日にちの書き方
  function whenIn(it, y, m) {
    var ym = y + "-" + pad(m + 1);
    if (it.type === "month") return "日にち未定";
    if (it.type === "day") return dayText(it.d1);
    var s = ymOf(it.d1) === ym ? it.d1 : ym + "-01";
    var e = it.d2;
    if (ymOf(e) === ym) return dayText(s) + "〜" + dayText(e);
    if (ymOf(it.d1) === ym) return dayText(s) + "〜" + mdText(e);
    return dayText(s) + "〜" + dayText(ymd(new Date(y, m + 1, 0)));
  }
  function nameOf(it) { return it.name + (it.kind === "off" && it.name.indexOf("休") < 0 ? "（お休み）" : ""); }

  /* ---------- 1 年度 ---------- */
  function drawYear() {
    root.querySelectorAll("#starts .mode").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.v === S.start)); });
    var e = parse(lastDay());
    $("year").textContent = yearLabel();
    $("range").textContent = S.year + "年" + S.start + "月〜" + e.getFullYear() + "年" + (e.getMonth() + 1) + "月";
    var other = S.items.length - shown().length;
    $("other").textContent = other ? "ほかの年度に入れた予定が" + other + "件あります（年度を切り替えると出ます）。" : "";
    $("holnote").textContent = e.getFullYear() > H.until ? "祝日は" + H.until + "年の分まで入っています。それより先の祝日は、カレンダーで赤くなりません。" : "";
  }

  /* ---------- 2 予定を入れる ---------- */
  function drawForm() {
    root.querySelectorAll("#ev-type .mode").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === S.type)); });
    root.querySelectorAll("#ev-kind .mode").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === S.kind)); });
    $("lab-d1").hidden = S.type === "month";
    $("lab-d2").hidden = S.type !== "range";
    $("lab-ym").hidden = S.type !== "month";
    $("lab-d1-t").textContent = S.type === "range" ? "始まりの日" : "日にち";
    ["ev-d1", "ev-d2"].forEach(function (id) { $(id).min = firstDay(); $(id).max = lastDay(); });
    var cur = $("ev-ym").value;
    $("ev-ym").innerHTML = months().map(function (a) {
      var v = a[0] + "-" + pad(a[1] + 1);
      return '<option value="' + v + '">' + a[0] + "年" + (a[1] + 1) + "月</option>";
    }).join("");
    if (cur && $("ev-ym").querySelector('option[value="' + cur + '"]')) $("ev-ym").value = cur;
  }
  function msg(t) { $("ev-msg").textContent = t; }
  function addItem() {
    var name = $("ev-name").value.trim(), it = { id: S.seq, type: S.type, kind: S.kind, name: name, d1: "", d2: "", ym: "" };
    if (!name) { msg("行事の名前を入れてください。"); $("ev-name").focus(); return; }
    if (S.type === "month") it.ym = $("ev-ym").value;
    else {
      it.d1 = $("ev-d1").value;
      if (!it.d1) { msg(S.type === "range" ? "始まりの日を選んでください。" : "日にちを選んでください。"); $("ev-d1").focus(); return; }
      if (S.type === "range") {
        it.d2 = $("ev-d2").value;
        if (!it.d2) { msg("終わりの日を選んでください。"); $("ev-d2").focus(); return; }
        if (it.d2 < it.d1) { msg("終わりの日が、始まりの日より前になっています。"); $("ev-d2").focus(); return; }
        if (it.d2 === it.d1) { it.type = "day"; it.d2 = ""; }
      }
      if (it.d1 < firstDay() || it.d1 > lastDay() || (it.d2 && it.d2 > lastDay())) { msg(yearLabel() + "（" + $("range").textContent + "）の中の日にちを選んでください。"); return; }
    }
    S.seq += 1; S.items.push(it);
    $("ev-name").value = ""; $("ev-d2").value = "";
    msg("「" + name + "」を入れました！");
    save(); drawAll(); $("ev-name").focus();
  }
  function drawList() {
    var any = shown().length;
    $("ev-list").innerHTML = any ? months().map(function (a) {
      var its = itemsIn(a[0], a[1]);
      if (!its.length) return "";
      return '<div class="ev-month"><h3>' + (a[1] + 1) + "月</h3><ul>" + its.map(function (it) {
        var first = it.type !== "range" || ymOf(it.d1) === a[0] + "-" + pad(a[1] + 1);
        return '<li class="' + (it.kind === "off" ? "off" : "") + '"><span class="w">' + esc(whenIn(it, a[0], a[1])) + '</span><span class="nm">' + esc(nameOf(it)) + "</span>" +
          (first ? '<span class="op"><button type="button" data-fix="' + it.id + '">直す</button><button type="button" data-del="' + it.id + '">消す</button></span>' : '<span class="op cont">（つづき）</span>') + "</li>";
      }).join("") + "</ul></div>";
    }).join("") : '<p class="dg-hint">まだ何も入っていません。上で日にちと名前を入れて「この予定を入れる」を押してください。<button type="button" class="ev-sample" id="sample">例を入れてみる（あとで消せます）</button></p>';
    $("count").textContent = any ? yearLabel() + "の予定：" + any + "件" : "";
    if ($("sample")) $("sample").onclick = addSample;
    $("ev-list").querySelectorAll("[data-del]").forEach(function (b) {
      b.onclick = function () {
        var it = S.items.filter(function (x) { return x.id === +b.dataset.del; })[0];
        S.items = S.items.filter(function (x) { return x !== it; });
        msg("「" + it.name + "」を消しました。");
        save(); drawAll();
      };
    });
    $("ev-list").querySelectorAll("[data-fix]").forEach(function (b) {
      b.onclick = function () {
        var it = S.items.filter(function (x) { return x.id === +b.dataset.fix; })[0];
        S.items = S.items.filter(function (x) { return x !== it; });
        S.type = it.type; S.kind = it.kind;
        drawForm();
        $("ev-name").value = it.name; $("ev-d1").value = it.d1; $("ev-d2").value = it.d2;
        if (it.ym) $("ev-ym").value = it.ym;
        msg("「" + it.name + "」を上に戻しました。直して「この予定を入れる」を押してください。");
        save(); drawAll(); $("ev-form").scrollIntoView({ block: "nearest" }); $("ev-name").focus();
      };
    });
  }
  // 例：はじめて使う人が形をつかめるように、よくある行事を入れる
  function addSample() {
    function sat(y, m, n) { var d = new Date(y, m, 1); d.setDate(1 + (6 - d.getDay() + 7) % 7 + 7 * (n - 1)); return ymd(d); }
    var y4 = S.start === 4 ? S.year : S.year, yE = S.start === 4 ? S.year + 1 : S.year;
    var list = [
      { type: "day", kind: "event", name: "体験会", d1: sat(y4, 3, 2) },
      { type: "range", kind: "off", name: "夏休み", d1: y4 + "-08-11", d2: y4 + "-08-16" },
      { type: "month", kind: "event", name: "発表会", ym: y4 + "-11" },
      { type: "range", kind: "off", name: "年末年始のお休み", d1: y4 + "-12-29", d2: S.start === 4 ? yE + "-01-03" : y4 + "-12-31" },
      { type: "day", kind: "event", name: "修了の会", d1: sat(yE, 2, 3) }
    ];
    list.forEach(function (it) {
      it.d1 = it.d1 || ""; it.d2 = it.d2 || ""; it.ym = it.ym || ""; it.id = S.seq++;
      if (inYear(it)) S.items.push(it);
    });
    msg("例を入れました。「直す」「消す」で自分の教室の予定に変えてください。");
    save(); drawAll();
  }

  /* ---------- 3 配る形 ---------- */
  function heading() { return (S.title ? S.title + "　" : "") + yearLabel() + " 年間行事予定"; }
  function F(px, b) { return (b ? "700 " : "") + Math.round(px) + 'px "Hiragino Sans","Yu Gothic","Meiryo",sans-serif'; }
  function canvas(W, Hh) { var c = document.createElement("canvas"); c.width = W; c.height = Hh; var g = c.getContext("2d"); g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, Hh); g.textBaseline = "middle"; return [c, g]; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // 幅に収まるように、1文字ずつ折り返す（閉じかっこや「、」「。」は行の頭に置かない）
  var NOHEAD = "）」』、。・ー〜";
  function wrap(g, text, w) {
    var lines = [], cur = "";
    Array.from(text).forEach(function (ch) { if (g.measureText(cur + ch).width > w && cur && NOHEAD.indexOf(ch) < 0) { lines.push(cur); cur = ch; } else cur += ch; });
    if (cur) lines.push(cur);
    return lines;
  }

  // 年間の表：月ごとに行事を並べる（2列＝印刷向き、1列＝スマホ向き）
  function drawTable(cols) {
    var ms = months(), pad0 = 40, gap = 24, bw = cols === 2 ? 540 : 680, fs = cols === 2 ? 21 : 24, lh = Math.round(fs * 1.6), head = 46;
    var W = pad0 * 2 + bw * cols + gap * (cols - 1), top = 112;
    var meas = canvas(10, 10)[1]; meas.font = F(fs);
    // 月ごとの行（折り返し済み）
    var boxes = ms.map(function (a) {
      var rows = [];
      itemsIn(a[0], a[1]).forEach(function (it) {
        wrap(meas, whenIn(it, a[0], a[1]) + "　" + nameOf(it), bw - 56).forEach(function (t, i) { rows.push({ t: t, off: it.kind === "off", first: i === 0 }); });
      });
      return rows;
    });
    var heights = [];
    for (var r = 0; r < 12 / cols; r++) {
      var mx = 1;
      for (var c2 = 0; c2 < cols; c2++) mx = Math.max(mx, boxes[r * cols + c2].length);
      heights.push(head + 16 + mx * lh + 12);
    }
    var Hh = top + heights.reduce(function (s, h) { return s + h; }, 0) + gap * (heights.length - 1) + 96;
    var cg = canvas(W, Hh), cv = cg[0], g = cg[1];
    g.fillStyle = C.ink; g.font = F(cols === 2 ? 34 : 32, true); g.textAlign = "center"; g.fillText(heading(), W / 2, 56);
    var y = top;
    heights.forEach(function (h, r) {
      for (var c2 = 0; c2 < cols; c2++) {
        var i = r * cols + c2, a = ms[i], x = pad0 + c2 * (bw + gap);
        rr(g, x, y, bw, h, 10); g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
        g.save(); rr(g, x, y, bw, head, 10); g.clip(); g.fillStyle = C.aiBg; g.fillRect(x, y, bw, head); g.restore();
        g.textAlign = "left"; g.fillStyle = C.ink; g.font = F(fs + 3, true); g.fillText((a[1] + 1) + "月", x + 18, y + head / 2);
        var mw = g.measureText((a[1] + 1) + "月").width;
        g.fillStyle = C.body; g.font = F(fs - 5); g.fillText(a[0] + "年", x + 26 + mw, y + head / 2 + 2);
        var rows = boxes[i];
        if (!rows.length) { g.fillStyle = C.line; g.font = F(fs); g.fillText("―", x + 22, y + head + 16 + lh / 2); }
        rows.forEach(function (row, j) {
          var yy = y + head + 16 + j * lh + lh / 2;
          if (row.first) { g.fillStyle = row.off ? C.off : C.ai; g.beginPath(); g.arc(x + 26, yy, 6, 0, Math.PI * 2); g.fill(); }
          g.fillStyle = row.off ? C.body : C.ink; g.font = F(fs); g.fillText(row.t, x + 42, yy);
        });
      }
      y += h + gap;
    });
    // 見方
    y += 12; g.font = F(fs - 2); g.textAlign = "left";
    g.fillStyle = C.ai; g.beginPath(); g.arc(pad0 + 8, y, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.ink; g.fillText("行事", pad0 + 22, y);
    var lx = pad0 + 22 + g.measureText("行事").width + 28;
    g.fillStyle = C.off; g.beginPath(); g.arc(lx, y, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.ink; g.fillText("お休み", lx + 14, y);
    return cv.toDataURL("image/png");
  }

  // カレンダー：日にちの決まった予定を、月ごとのカレンダーに書き込む
  function drawCals(ms, cols) {
    var cell = 104, cg0 = 3, mw = cell * 7 + cg0 * 6, pad0 = 40, gx = 44, gy = 36, top = 112, fs = 15;
    var meas = canvas(10, 10)[1]; meas.font = F(fs, true);
    var notes = ms.map(function (a) {
      var mo = itemsIn(a[0], a[1]).filter(function (it) { return it.type === "month"; });
      return mo.length ? wrap(meas, "日にち未定：" + mo.map(nameOf).join("、"), mw) : [];
    });
    var rows = Math.ceil(ms.length / cols), rowH = [];
    for (var r = 0; r < rows; r++) {
      var nmax = 0;
      for (var c2 = 0; c2 < cols; c2++) if (notes[r * cols + c2]) nmax = Math.max(nmax, notes[r * cols + c2].length);
      rowH.push(44 + 34 + (cell + cg0) * 6 + (nmax ? 12 + nmax * 24 : 0));
    }
    var W = pad0 * 2 + mw * cols + gx * (cols - 1);
    var Hh = top + rowH.reduce(function (s, h) { return s + h; }, 0) + gy * (rows - 1) + 40;
    var cg = canvas(W, Hh), cv = cg[0], g = cg[1];
    g.fillStyle = C.ink; g.font = F(32, true); g.textAlign = "center"; g.fillText(heading(), W / 2, 56);
    var oy = top;
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c3 = 0; c3 < cols; c3++) {
        var i = r2 * cols + c3; if (i >= ms.length) break;
        var y0 = ms[i][0], m0 = ms[i][1], ox = pad0 + c3 * (mw + gx);
        g.fillStyle = C.ink; g.font = F(26, true); g.textAlign = "left"; g.fillText(y0 + "年" + (m0 + 1) + "月", ox, oy + 18);
        WD.forEach(function (w, j) { g.fillStyle = j === 0 ? C.red : j === 6 ? C.ai : C.body; g.font = F(17); g.textAlign = "center"; g.fillText(w, ox + j * (cell + cg0) + cell / 2, oy + 58); });
        var first = new Date(y0, m0, 1).getDay(), last = new Date(y0, m0 + 1, 0).getDate(), its = itemsIn(y0, m0).filter(function (it) { return it.type !== "month"; });
        for (var d = 1; d <= last; d++) {
          var idx = first + d - 1, w = idx % 7, x = ox + w * (cell + cg0), yy = oy + 76 + Math.floor(idx / 7) * (cell + cg0), k = y0 + "-" + pad(m0 + 1) + "-" + pad(d);
          var here = its.filter(function (it) { return it.type === "day" ? it.d1 === k : it.d1 <= k && it.d2 >= k; });
          var offRange = here.some(function (it) { return it.type === "range" && it.kind === "off"; });
          var evRange = here.some(function (it) { return it.type === "range" && it.kind !== "off"; });
          rr(g, x, yy, cell, cell, 6);
          if (offRange || evRange) { g.fillStyle = offRange ? C.offBg : C.aiBg; g.fill(); }
          g.strokeStyle = C.line; g.lineWidth = 1; g.stroke();
          g.fillStyle = (w === 0 || HOL.has(k)) ? C.red : w === 6 ? C.ai : C.ink; g.font = F(18); g.textAlign = "left"; g.fillText(String(d), x + 8, yy + 16);
          // 名前を書くのは、1日だけの予定と、続く予定の最初の日・週の頭・月の頭
          var lines = [];
          here.forEach(function (it) {
            if (it.type === "range" && !(it.d1 === k || w === 0 || d === 1)) return;
            g.font = F(fs, true);
            wrap(g, it.name, cell - 10).forEach(function (t) { lines.push({ t: t, off: it.kind === "off" }); });
          });
          if (lines.length > 4) { lines = lines.slice(0, 4); lines[3].t = Array.from(lines[3].t).slice(0, -1).join("") + "…"; }
          lines.forEach(function (ln, j) { g.fillStyle = ln.off ? C.body : C.ai; g.font = F(fs, true); g.fillText(ln.t, x + 6, yy + 38 + j * 18); });
        }
        if (notes[i] && notes[i].length) {
          g.fillStyle = C.ink; g.font = F(fs, true); g.textAlign = "left";
          notes[i].forEach(function (t, j) { g.fillText(t, ox, oy + 76 + (cell + cg0) * 6 + 18 + j * 24); });
        }
      }
      oy += rowH[r2] + gy;
    }
    return cv.toDataURL("image/png");
  }

  function listText() {
    var its = shown();
    if (!its.length) return "";
    var out = [heading()];
    months().forEach(function (a) {
      var mine = itemsIn(a[0], a[1]);
      if (!mine.length) return;
      out.push("", a[0] + "年" + (a[1] + 1) + "月");
      mine.forEach(function (it) { out.push("・" + whenIn(it, a[0], a[1]) + "　" + nameOf(it)); });
    });
    return out.join("\n");
  }
  function icsEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  function icsText() {
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//musubiya//nenkan-gyoji//JA", "CALSCALE:GREGORIAN"];
    var t = new Date(), stamp = t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) + "T" + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + pad(t.getUTCSeconds()) + "Z";
    shown().filter(function (it) { return it.type !== "month"; }).forEach(function (it) {
      var end = parse(it.d2 || it.d1); end.setDate(end.getDate() + 1);
      L.push("BEGIN:VEVENT", "UID:nenkan-" + it.d1.replace(/-/g, "") + "-" + it.id + "@musubiya-miko.com", "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + it.d1.replace(/-/g, ""), "DTEND;VALUE=DATE:" + ymd(end).replace(/-/g, ""),
        "SUMMARY:" + icsEsc((S.title ? S.title + " " : "") + nameOf(it)), "END:VEVENT");
    });
    L.push("END:VCALENDAR");
    return L.join("\r\n");
  }
  // 保存の名前は英数字にする（日本語の名前は、ブラウザによって「download」という拡張子の無い名前になってしまうため）
  function download(href, name) { var a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function figures(box, pics) {
    box.innerHTML = pics.map(function (p, i) {
      return '<figure><img src="' + p.src + '" alt="' + esc(p.alt) + '"><div class="act"><button type="button" data-i="' + i + '">この画像を保存する</button></div></figure>';
    }).join("");
    box.querySelectorAll("button").forEach(function (b) { b.onclick = function () { var p = pics[+b.dataset.i]; download(p.src, p.name); }; });
  }
  // 画像は、開いているタブの分だけ描く（12か月分を毎回描くと重いため）
  function drawOut() {
    root.querySelectorAll(".tab").forEach(function (x) { x.setAttribute("aria-selected", String(x.dataset.p === S.tab)); });
    root.querySelectorAll(".pane").forEach(function (p) { p.classList.toggle("show", p.id === "p-" + S.tab); });
    root.querySelectorAll("#table-modes .mode").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === S.table)); });
    root.querySelectorAll("#cal-modes .mode").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === S.cal)); });
    var tag = S.start === 4 ? "nendo-" + S.year : String(S.year);
    if (S.tab === "table") {
      $("table-img").className = "all";
      figures($("table-img"), [{ src: drawTable(S.table === "two" ? 2 : 1), name: "nenkan-gyoji-" + tag + ".png", alt: heading() + "の年間の表" }]);
    }
    if (S.tab === "cal") {
      var ms = months(), each = S.cal === "each";
      $("cal-imgs").className = each ? "" : "all";
      figures($("cal-imgs"), each
        ? ms.map(function (a) { return { src: drawCals([a], 1), name: "gyoji-" + a[0] + "-" + pad(a[1] + 1) + ".png", alt: a[0] + "年" + (a[1] + 1) + "月の行事予定" }; })
        : [{ src: drawCals(ms, 3), name: "gyoji-calendar-" + tag + ".png", alt: heading() + "のカレンダー（12か月）" }]);
    }
    if (S.tab === "txt") $("outtxt").value = listText() || "まだ何も入っていません。";
    var noDate = shown().filter(function (it) { return it.type === "month"; }).length;
    $("icsnote").textContent = noDate ? "日にち未定の予定（" + noDate + "件）は、カレンダー取り込みには入りません。" : "";
  }
  function drawAll() { drawYear(); drawForm(); drawList(); drawOut(); }

  /* ---------- 操作 ---------- */
  root.querySelectorAll("#starts .mode").forEach(function (b) {
    b.onclick = function () { var v = +b.dataset.v; if (v === S.start) return; S.start = v; S.year = defaultYear(v); save(); drawAll(); };
  });
  $("prev").onclick = function () { S.year -= 1; save(); drawAll(); };
  $("next").onclick = function () { S.year += 1; save(); drawAll(); };
  root.querySelectorAll("#ev-type .mode").forEach(function (b) { b.onclick = function () { S.type = b.dataset.v; save(); drawForm(); }; });
  root.querySelectorAll("#ev-kind .mode").forEach(function (b) { b.onclick = function () { S.kind = b.dataset.v; save(); drawForm(); }; });
  $("ev-d1").onchange = function () { if (S.type === "range" && !$("ev-d2").value) $("ev-d2").value = $("ev-d1").value; };
  $("ev-add").onclick = addItem;
  $("ev-name").onkeydown = function (e) { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addItem(); } };
  root.querySelectorAll(".tab").forEach(function (t) { t.onclick = function () { S.tab = t.dataset.p; save(); drawOut(); }; });
  root.querySelectorAll("#table-modes .mode").forEach(function (b) { b.onclick = function () { S.table = b.dataset.v; save(); drawOut(); }; });
  root.querySelectorAll("#cal-modes .mode").forEach(function (b) { b.onclick = function () { S.cal = b.dataset.v; save(); drawOut(); }; });
  var tm;
  $("title").value = S.title;
  $("title").oninput = function (e) { S.title = e.target.value; save(); clearTimeout(tm); tm = setTimeout(drawOut, 300); };
  $("copytxt").onclick = function () {
    var t = $("outtxt");
    function done(ok) { $("copymsg").textContent = ok ? "コピーしました！" : "コピーできませんでした。上の文を選んでコピーしてください。"; }
    function fallback() { t.focus(); t.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; } done(ok); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(function () { done(true); }, fallback);
    else fallback();
  };
  $("saveics").onclick = function () {
    if (!shown().some(function (it) { return it.type !== "month"; })) { $("icsmsg").textContent = "日にちの決まった予定がまだありません。"; return; }
    var url = URL.createObjectURL(new Blob([icsText()], { type: "text/calendar" }));
    download(url, "nenkan-gyoji.ics");
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    $("icsmsg").textContent = "保存したファイルを、カレンダーのアプリで開くと取り込めます！";
  };
  drawAll();
})();
