/* phantom-ui.js — shared chrome for LVL³ game/tool pages.
   Custom cursor (dot + trailing ring) and the entrance animation, both of which
   were previously copy-pasted into every page. Auto-disables on touch devices.
   Include AFTER the page markup (or with defer). */
(function () {
  "use strict";

  // ── Custom cursor ──
  (function () {
    if (window.matchMedia && window.matchMedia("(hover:none)").matches) return;
    var cur = document.getElementById("cursor");
    var ring = document.getElementById("cursor-ring");
    if (!cur || !ring) return;
    var rx = 0, ry = 0, tx = 0, ty = 0;
    var HIT = "button,a,input,select,textarea,.portrait,.vote-btn,.team-chip," +
              ".option-btn,.card,.lg-logo-wrap,.flag-wrap,[data-cursor]";
    window.addEventListener("mousemove", function (e) {
      tx = e.clientX; ty = e.clientY;
      cur.style.left = tx + "px"; cur.style.top = ty + "px";
      var hit = e.target.closest && e.target.closest(HIT);
      if (hit) {
        ring.style.opacity = "1";
        ring.style.transform = "translate(-50%,-50%) scale(1)";
        cur.style.width = "5px"; cur.style.height = "5px";
      } else {
        ring.style.opacity = "0";
        ring.style.transform = "translate(-50%,-50%) scale(.4)";
        cur.style.width = "8px"; cur.style.height = "8px";
      }
    });
    (function loop() {
      rx += (tx - rx) * 0.18; ry += (ty - ry) * 0.18;
      ring.style.left = rx + "px"; ring.style.top = ry + "px";
      requestAnimationFrame(loop);
    }());
  }());

  // ── Entrance animation (no-op without GSAP) ──
  document.addEventListener("DOMContentLoaded", function () {
    if (!window.gsap) return;
    var g = window.gsap;
    g.from(".site-header > *", { y: -14, opacity: 0, duration: 0.7, stagger: 0.06, ease: "power3.out" });
    g.from(".rail > *", { x: -18, opacity: 0, duration: 0.7, stagger: 0.1, delay: 0.15, ease: "power3.out" });
    var first = document.querySelector(".screen.active");
    if (first) g.from(first.children, { y: 26, opacity: 0, duration: 0.8, stagger: 0.07, delay: 0.2, ease: "power3.out" });
  });
}());
