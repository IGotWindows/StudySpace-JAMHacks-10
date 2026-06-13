(function () {
  "use strict";

  function rnd(min, max) { return min + Math.random() * (max - min); }

  function initOrbBackground(container) {
    // --- Randomize large orb positions before mount ---
    // Each orb stays in its general quadrant but shifts within a zone each load.
    var tlOrb = container.querySelector(".orb-tl");
    if (tlOrb) {
      tlOrb.style.top  = rnd(-55, -20) + "%";
      tlOrb.style.left = rnd(-30, 15)  + "%";
      var tlSize = Math.round(rnd(560, 900));
      tlOrb.style.width = tlOrb.style.height = tlSize + "px";
    }
    var bcOrb = container.querySelector(".orb-bc");
    if (bcOrb) {
      bcOrb.style.bottom = rnd(-65, -30) + "%";
      bcOrb.style.left   = rnd(25, 65)   + "%";
      var bcSize = Math.round(rnd(700, 1050));
      bcOrb.style.width = bcOrb.style.height = bcSize + "px";
    }
    var trOrb = container.querySelector(".orb-tr");
    if (trOrb) {
      trOrb.style.top   = rnd(-45, -5)  + "%";
      trOrb.style.right = rnd(-35, 5)   + "%";
      var trSize = Math.round(rnd(520, 820));
      trOrb.style.width = trOrb.style.height = trSize + "px";
    }
    var brOrb = container.querySelector(".orb-br");
    if (brOrb) {
      brOrb.style.bottom = rnd(-55, -15) + "%";
      brOrb.style.right  = rnd(-25, 15)  + "%";
      var brSize = Math.round(rnd(580, 880));
      brOrb.style.width = brOrb.style.height = brSize + "px";
    }

    requestAnimationFrame(function () {
      container.classList.add("orbs-mounted");
    });

    var isFixed = container.classList.contains("orb-bg");
    var rect = container.getBoundingClientRect();

    // --- Floating glow particles ---
    for (var i = 0; i < 26; i++) {
      var p = document.createElement("div");
      p.className = "orb-particle";
      var size = 1.5 + Math.random() * 4;
      p.style.cssText =
        "left:" + (Math.random() * 100) + "%;" +
        "top:" + (Math.random() * 100) + "%;" +
        "width:" + size + "px;" +
        "height:" + size + "px;" +
        "animation-delay:" + (-Math.random() * 14) + "s;" +
        "animation-duration:" + (9 + Math.random() * 13) + "s;";
      container.appendChild(p);
    }

    // --- Static star field ---
    for (var j = 0; j < 45; j++) {
      var s = document.createElement("div");
      s.className = "orb-star";
      var ss = 0.5 + Math.random() * 1.8;
      s.style.cssText =
        "left:" + (Math.random() * 100) + "%;" +
        "top:" + (Math.random() * 100) + "%;" +
        "width:" + ss + "px;" +
        "height:" + ss + "px;" +
        "opacity:" + (0.15 + Math.random() * 0.55) + ";" +
        "animation-delay:" + (Math.random() * 5) + "s;";
      container.appendChild(s);
    }

    // --- Micro-orbs: randomized position + size each load ---
    for (var mi = 0; mi < 3; mi++) {
      var m = document.createElement("div");
      m.className = "orb orb-micro";
      var mSize = 100 + Math.random() * 130;
      m.style.cssText =
        "top:" + (12 + Math.random() * 68) + "%;" +
        "left:" + (5 + Math.random() * 82) + "%;" +
        "width:" + mSize + "px;height:" + mSize + "px;" +
        "transition-delay:" + (0.4 + mi * 0.2) + "s;";
      var inner = document.createElement("div");
      inner.className = "orb-inner orb-micro-inner";
      m.appendChild(inner);
      container.appendChild(m);
    }

    // --- Cursor glow follower ---
    var glow = document.createElement("div");
    glow.className = "orb-cursor-glow";
    container.appendChild(glow);

    // --- Mouse parallax on main orb-inner elements ---
    var orbInners = container.querySelectorAll(".orb:not(.orb-micro) .orb-inner");
    var depths = [0.02, -0.014, 0.026, -0.018];
    var cx = [], cy = [], tx = [], ty = [];
    for (var k = 0; k < orbInners.length; k++) { cx[k] = cy[k] = tx[k] = ty[k] = 0; }

    // --- Slow drift: random amplitude, frequency, phase per orb each load ---
    var driftAX = [], driftAY = [], driftFX = [], driftFY = [], driftPX = [], driftPY = [];
    for (var d = 0; d < orbInners.length; d++) {
      driftAX[d] = 20 + Math.random() * 30;           // px amplitude X  (20–50)
      driftAY[d] = 14 + Math.random() * 24;           // px amplitude Y  (14–38)
      driftFX[d] = 0.00007 + Math.random() * 0.00011; // cycles/ms ~14–25s period
      driftFY[d] = 0.00005 + Math.random() * 0.00009; // slightly slower Y
      driftPX[d] = Math.random() * Math.PI * 2;       // random start phase
      driftPY[d] = Math.random() * Math.PI * 2;
    }

    var glowX = 0, glowY = 0, glowTX = 0, glowTY = 0;

    function onMouseMove(e) {
      var mx = (e.clientX / window.innerWidth) - 0.5;
      var my = (e.clientY / window.innerHeight) - 0.5;
      for (var n = 0; n < orbInners.length; n++) {
        tx[n] = mx * window.innerWidth * depths[n];
        ty[n] = my * window.innerHeight * depths[n];
      }
      if (isFixed) {
        glowTX = e.clientX;
        glowTY = e.clientY;
      } else {
        rect = container.getBoundingClientRect();
        glowTX = e.clientX - rect.left;
        glowTY = e.clientY - rect.top;
      }
    }
    document.addEventListener("mousemove", onMouseMove);

    // --- Click ripple ---
    container.addEventListener("click", function (e) {
      var r = document.createElement("div");
      r.className = "orb-ripple";
      var bnd = container.getBoundingClientRect();
      r.style.left = (e.clientX - bnd.left) + "px";
      r.style.top  = (e.clientY - bnd.top)  + "px";
      container.appendChild(r);
      r.addEventListener("animationend", function () { r.remove(); });
    });

    // --- rAF loop: parallax + sinusoidal drift ---
    function tick(t) {
      for (var n = 0; n < orbInners.length; n++) {
        // Smooth parallax
        cx[n] += (tx[n] - cx[n]) * 0.045;
        cy[n] += (ty[n] - cy[n]) * 0.045;
        // Slow drift layered on top
        var dx = cx[n] + driftAX[n] * Math.sin(t * driftFX[n] + driftPX[n]);
        var dy = cy[n] + driftAY[n] * Math.cos(t * driftFY[n] + driftPY[n]);
        orbInners[n].style.transform =
          "translate(" + dx.toFixed(2) + "px," + dy.toFixed(2) + "px)";
      }
      glowX += (glowTX - glowX) * 0.09;
      glowY += (glowTY - glowY) * 0.09;
      glow.style.transform =
        "translate(" + (glowX - 150).toFixed(1) + "px," + (glowY - 150).toFixed(1) + "px)";
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  window.initOrbBackground = initOrbBackground;
})();
