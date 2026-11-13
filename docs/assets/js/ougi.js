/* 結び屋 ホームの扇（表示のおまけ）
 * 中身は下の一覧（#all）の各区画から読む。JavaScript が動かなくても一覧で全部読める。
 * 描き方：むき出しの骨 → 根元の束 → 一枚の地紙（要の側は白い紙、ふち寄りに藍の帯）。外のふちは弧。
 * 選んだ羽根は根元につながったまま外へ伸びて一番手前に出る。見出しは羽根の先に、画面の点にそろえて置く。
 */
(function () {
  "use strict";
  var fan = document.getElementById("fan");
  var all = document.getElementById("all");
  if (!fan || !all) return;

  var items = Array.prototype.map.call(all.querySelectorAll("section[data-fan]"), function (sec) {
    var go = sec.querySelector(".go a");
    var sum = sec.querySelector(".sum");
    return {
      t: sec.querySelector("h2").textContent.trim(),
      s: sum ? sum.textContent.trim() : "",
      thumb: sec.getAttribute("data-thumb") || "",
      go: go ? { href: go.getAttribute("href"), text: go.getAttribute("data-fan-text") || go.textContent.replace(/→/g, "").trim(), blank: go.getAttribute("target") === "_blank" } : null
    };
  });
  var N = items.length, RANGE = 26, CLOSED = 8, GROW = 16;
  if (!N) return;
  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ribsG = document.getElementById("ribs"), paperG = document.getElementById("paper");
  var cover = document.getElementById("cover"), kaname = document.getElementById("kaname"), opener = document.getElementById("opener");
  var hint = document.getElementById("hint"), panel = document.getElementById("panel");
  var EMPTY_TEXT = "羽根を押すと、ここに中身が出ます。";
  var open = false, sel = -1, running = false;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function mk(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function target() {
    var a = [];
    for (var k = 0; k <= N; k++) a.push(open ? -RANGE + k * (2 * RANGE / N) : -CLOSED + k * (2 * CLOSED / N));
    return a;
  }
  var ang = target(), push = items.map(function () { return 0; });

  var ribs = [];
  for (var r = 0; r <= N; r++) { var rp = mk("path", { style: "fill:var(--rib);stroke:var(--rib-lo);stroke-width:.6" }); ribsG.appendChild(rp); ribs.push(rp); }
  var secs = items.map(function (it, i) {
    var g = mk("g", { "class": "sec" });
    var parts = {
      pHi: mk("path", { fill: "url(#gPHi)" }), pLo: mk("path", { fill: "url(#gPLo)" }),
      bHi: mk("path", { fill: "url(#gBHi)" }), bLo: mk("path", { fill: "url(#gBLo)" }),
      grain: mk("path", { fill: "url(#grain)", style: "opacity:var(--grain-op)" }), light: mk("path", { fill: "url(#gLight)" })
    };
    for (var k in parts) g.appendChild(parts[k]);
    g.addEventListener("click", function () { pick(i); });
    paperG.appendChild(g);
    parts.g = g;
    return parts;
  });
  var labs = items.map(function (it, i) {
    var b = el("button", "lab", it.t); b.type = "button";
    b.addEventListener("click", function () { pick(i); });
    fan.appendChild(b); return b;
  });

  function setEmpty() { panel.textContent = ""; panel.appendChild(el("span", "s", EMPTY_TEXT)); }
  function pick(i) {
    if (!open) return;
    sel = i; fan.classList.add("picked");
    secs.forEach(function (s, j) { s.g.classList.toggle("sel", j === i); });
    labs.forEach(function (l, j) { l.classList.toggle("sel", j === i); });
    paperG.appendChild(secs[i].g);   // 選んだ羽根を一番手前に
    var it = items[i], box = el("div", "rise");
    if (it.thumb) box.appendChild(el("div", "thumb", it.thumb));
    box.appendChild(el("span", "t", it.t));
    box.appendChild(el("span", "s", it.s));
    if (it.go) {
      box.appendChild(document.createElement("br"));
      var a = el("a", null, it.go.text + " →"); a.href = it.go.href;
      if (it.go.blank) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
      box.appendChild(a);
    }
    panel.textContent = ""; panel.appendChild(box);
    kick();
  }
  opener.addEventListener("click", function () { open = true; fan.classList.remove("closed"); hint.textContent = "扇の根元を押すと閉じます"; kick(); });
  kaname.addEventListener("click", function () {
    open = false; sel = -1; fan.classList.add("closed"); fan.classList.remove("picked"); hint.textContent = "";
    secs.forEach(function (s) { s.g.classList.remove("sel"); }); labs.forEach(function (l) { l.classList.remove("sel"); });
    setEmpty(); kick();
  });

  function rad(d) { return d * Math.PI / 180; }
  function sector(px, py, r1, r2, a, b) {
    function P(rr, t) { return (px + rr * Math.cos(rad(t))).toFixed(2) + " " + (py + rr * Math.sin(rad(t))).toFixed(2); }
    return "M" + P(r1, a) + " L" + P(r2, a) + " A" + r2 + " " + r2 + " 0 0 1 " + P(r2, b) + " L" + P(r1, b) + " A" + r1 + " " + r1 + " 0 0 0 " + P(r1, a) + " Z";
  }
  function frame() {
    var moving = false;
    var W = fan.clientWidth, Hh = fan.clientHeight, px = 14, py = Math.round(Hh / 2);
    var r2 = Math.min(W - 22 - GROW, 370), r1 = r2 * 0.40;
    var maxW = Math.max.apply(null, labs.map(function (l) { return l.offsetWidth; }).concat([cover.offsetWidth]));
    var rb = Math.max(r1 + 30, r2 - maxW - 30);
    var tg = target();
    ang = ang.map(function (a, k) { var g = tg[k], n = reduce ? g : a + (g - a) * 0.16; if (Math.abs(g - n) > 0.01) { moving = true; return n; } return g; });
    push = push.map(function (p, i) { var g = open && i === sel ? GROW : 0, n = reduce ? g : p + (g - p) * 0.18; if (Math.abs(g - n) > 0.05) { moving = true; return n; } return g; });
    // むき出しの骨（根元から地紙の少し内側まで）
    ribs.forEach(function (p, k) {
      var t = rad(ang[k]), nx = -Math.sin(t), ny = Math.cos(t), L = r1 + 8, w0 = 3, w1 = 2;
      var pts = [[px + nx * w0, py + ny * w0], [px + Math.cos(t) * L + nx * w1, py + Math.sin(t) * L + ny * w1], [px + Math.cos(t) * L - nx * w1, py + Math.sin(t) * L - ny * w1], [px - nx * w0, py - ny * w0]];
      p.setAttribute("d", "M" + pts.map(function (q) { return q[0].toFixed(2) + " " + q[1].toFixed(2); }).join(" L") + " Z");
    });
    // 一枚の地紙：区画ごとに、折り目の手前（山）を明るく、奥（谷）を暗く
    secs.forEach(function (s, i) {
      var a = ang[i], b = ang[i + 1], m = (a + b) / 2, t = rad(m), R2 = r2 + push[i];
      s.pHi.setAttribute("d", sector(px, py, r1, rb, a, m));
      s.pLo.setAttribute("d", sector(px, py, r1, rb, m, b));
      s.bHi.setAttribute("d", sector(px, py, rb, R2, a, m));
      s.bLo.setAttribute("d", sector(px, py, rb, R2, m, b));
      s.grain.setAttribute("d", sector(px, py, r1, rb, a, b));   // 和紙の粒は白い紙の所だけ
      s.light.setAttribute("d", sector(px, py, r1, R2, a, b));   // 左上からの光と右下の陰
      var l = labs[i], w = l.offsetWidth, h = l.offsetHeight, rl = R2 - 3 - w / 2;
      l.style.left = Math.round(px + Math.cos(t) * rl - w / 2) + "px";
      l.style.top = Math.round(py + Math.sin(t) * rl - h / 2) + "px";
    });
    ["gPHi", "gPLo", "gBHi", "gBLo"].forEach(function (id) { var g = document.getElementById(id); g.setAttribute("cx", px); g.setAttribute("cy", py); g.setAttribute("r", r2); });
    var gl = document.getElementById("gLight");
    gl.setAttribute("x1", px); gl.setAttribute("y1", py - r2 * 0.6); gl.setAttribute("x2", px + r2 * 0.8); gl.setAttribute("y2", py + r2 * 0.6);
    // 根元の束：骨が重なって厚くなった所。根元は丸く終わる（留め具なし）
    var rr = 22, a0 = ang[0] - 4, a1 = ang[N] + 4, cr = 4;
    function Q(d) { return (px + rr * Math.cos(rad(d))).toFixed(2) + " " + (py + rr * Math.sin(rad(d))).toFixed(2); }
    function C(d) { return (px + cr * Math.cos(rad(d))).toFixed(2) + " " + (py + cr * Math.sin(rad(d))).toFixed(2); }
    document.getElementById("root").setAttribute("d", "M" + C(a0 - 90) + " L" + Q(a0) + " A" + rr + " " + rr + " 0 0 1 " + Q(a1) + " L" + C(a1 + 90) + " A" + cr + " " + cr + " 0 0 1 " + C(a0 + 270) + " Z");
    kaname.style.left = (px - 28) + "px"; kaname.style.top = (py - 28) + "px";
    cover.style.right = Math.round(W - (px + r2 - 16)) + "px";
    cover.style.top = Math.round(py - cover.offsetHeight / 2) + "px";
    if (moving) requestAnimationFrame(frame); else running = false;
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }
  kick();
  window.addEventListener("resize", kick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);
})();
