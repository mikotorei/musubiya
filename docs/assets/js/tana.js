/* 結び屋「頼む」の回る棚（表示のおまけ）
 * 中身は下の一覧（#menu）の各項目から読む。JavaScript が動かなくても一覧で全部読める。
 * 楕円の軌道（C案：手前の間隔を広げ、奥に詰める）を札が回る。止まった時だけ正面の札がひと回り大きくなり、ほかは薄くなる。
 * 札は正面の大きさで作り、縮める方向だけに使う（拡大でにじまないように）。
 */
(function () {
  "use strict";
  var stage = document.getElementById("stage");
  var menu = document.getElementById("menu");
  if (!stage || !menu) return;

  var items = Array.prototype.map.call(menu.querySelectorAll("li[data-item]"), function (li) {
    return {
      t: li.querySelector("h3").textContent.trim(),
      p: li.querySelector(".price").textContent.trim(),
      d: li.querySelector(".desc").textContent.trim()
    };
  });
  var N = items.length;
  if (!N) return;
  var orbit = document.getElementById("orbit");
  var dots = document.getElementById("dots");
  var detail = document.getElementById("detail");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var pos = 0, target = 0;   // 今の回り具合と、向かう先（札何枚分か）
  var Rx = 240, Ry = 60, cx = 0, cy = 0, cw = 244, ch = 153;
  var focus = 0;             // 0＝回っている、1＝止まって正面に目が集まる
  var startX = 0, startPos = 0, dragging = false, moved = false;
  var shown = -1;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var cards = items.map(function (it, i) {
    var b = el("button", "card"); b.type = "button";
    b.setAttribute("aria-label", it.t + " " + it.p);
    var inn = el("span", "in");
    inn.appendChild(el("span", "t", it.t));
    inn.appendChild(el("span", "p", it.p));
    b.appendChild(inn);
    b.addEventListener("click", function () { if (!moved) goTo(i); });
    stage.appendChild(b);
    dots.appendChild(document.createElement("i"));
    return b;
  });

  function measure() {
    var w = stage.clientWidth, h = stage.clientHeight, small = w <= 480;
    cw = small ? 204 : 244; ch = small ? 135 : 153;
    Rx = Math.min(w / 2 - cw * 0.26, 230);
    Ry = small ? 39 : 45;
    cx = w / 2; cy = h * 0.5;
    orbit.style.width = (Rx * 2) + "px";
    orbit.style.height = (Ry * 2) + "px";
    orbit.style.marginLeft = (-Rx) + "px";
    orbit.style.top = (cy - Ry + ch * 0.36) + "px";
    render();
  }

  function render() {
    var front = ((Math.round(pos) % N) + N) % N;
    cards.forEach(function (c, i) {
      var th0 = (i - pos) / N * Math.PI * 2;      // 正面が0
      var th = th0 + 0.5 * Math.sin(th0);          // 手前の間隔を広げ、奥に詰める
      var depth = (Math.cos(th) + 1) / 2;          // 手前1、奥0
      var x = Math.sin(th) * Rx * (1 - 0.2 * (1 - depth)); // 奥ほど横幅を少し絞る
      var y = Math.cos(th) * Ry;                   // 手前ほど下、奥ほど上
      var isFront = i === front;
      var s = 0.32 + 0.68 * Math.pow(depth, 1.4);
      if (isFront) s *= 1 + 0.16 * focus;
      s /= 1.16;                                   // 止まった正面がちょうど等倍
      c.style.transform = "translate(" + Math.round(cx + x - cw / 2) + "px, " + Math.round(cy + y - ch / 2) + "px) scale(" + (s > 0.999 ? 1 : s.toFixed(3)) + ")";
      c.style.zIndex = String(Math.round(depth * 100));
      var op = 0.3 + 0.7 * depth;
      c.style.opacity = (isFront ? op : op * (1 - 0.45 * focus)).toFixed(3);
      c.classList.toggle("front", isFront);
      c.tabIndex = isFront ? 0 : -1;
    });
    Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle("on", i === front); });
    show(front);
  }

  function show(i) {
    if (i === shown) return;
    shown = i;
    var it = items[i], body = el("div", "body");
    body.appendChild(el("p", "min", "この金額でも、使える形でお渡しします！"));
    body.appendChild(el("h2", null, it.t));
    body.appendChild(el("p", "price", it.p));
    body.appendChild(el("p", "desc", it.d));
    detail.textContent = "";
    detail.appendChild(body);
  }

  var ticking = false;
  function tick() {
    if (!dragging) {
      var diff = target - pos;
      pos = (reduce || Math.abs(diff) < 0.001) ? target : pos + diff * 0.12;
    }
    var settled = !dragging && Math.abs(target - pos) < 0.02;
    var goal = settled ? 1 : 0;
    focus = reduce ? goal : focus + (goal - focus) * (settled ? 0.12 : 0.3);
    render();
    if (dragging || Math.abs(target - pos) > 0.0005 || Math.abs(goal - focus) > 0.002) requestAnimationFrame(tick);
    else { pos = target; focus = goal; render(); ticking = false; }
  }
  function run() { if (!ticking) { ticking = true; requestAnimationFrame(tick); } }
  function goTo(i) {
    var cur = Math.round(target), curMod = ((cur % N) + N) % N, d = i - curMod;
    if (d > N / 2) d -= N;
    if (d < -N / 2) d += N;
    target = cur + d; run();
  }
  function move(n) { target = Math.round(target) + n; run(); }
  document.getElementById("prev").addEventListener("click", function () { move(-1); });
  document.getElementById("next").addEventListener("click", function () { move(1); });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (e.key === "ArrowLeft") move(-1);
    if (e.key === "ArrowRight") move(1);
  });

  // ドラッグ・スワイプで回す（指の動きに軌道がついてくる）
  stage.addEventListener("pointerdown", function (e) {
    dragging = true; moved = false; startX = e.clientX; startPos = pos;
    stage.classList.add("dragging"); run();
  });
  window.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = e.clientX - startX;
    if (Math.abs(dx) > 6) moved = true;
    pos = startPos - dx / (Rx * 0.75) * (N / (Math.PI * 2)) * 1.4;
    target = pos;
  });
  window.addEventListener("pointerup", function () {
    if (!dragging) return;
    dragging = false; stage.classList.remove("dragging");
    target = Math.round(pos); run();
    setTimeout(function () { moved = false; }, 0);
  });

  window.addEventListener("resize", measure);
  measure();
  run();
})();
