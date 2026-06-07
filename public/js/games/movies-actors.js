(function () {
  "use strict";

  // ─── State ─────────────────────────────────────────────────────────────────
  var socket       = window.lvl3.socket;
  var myUsername   = null;
  var myRoomCode   = null;
  var isHost       = false;
  var currentPhase = "join";
  var timerInterval = null;
  var timerTotal    = 25;
  var revealInterval = null;

  var CATEGORY_LABELS = {
    movie:  { label: "Film",          icon: "🎬", cls: "movie"  },
    series: { label: "Serie",         icon: "📺", cls: "series" },
    actor:  { label: "Schauspieler",  icon: "🎭", cls: "actor"  }
  };

  // ─── DOM helpers ───────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function showScreen(name) {
    ["join","lobby","countdown","question","reveal","end"].forEach(function (s) {
      var el = $("screen-" + s);
      if (el) {
        el.classList.toggle("active", s === name);
        // flex for active screens
        if (s === name) el.style.display = "flex";
        else            el.style.display = "none";
      }
    });
    currentPhase = name;
  }

  function setCategoryBadge(elId, type) {
    var el = $(elId);
    if (!el) return;
    var info = CATEGORY_LABELS[type] || CATEGORY_LABELS.movie;
    el.className = "category-badge " + info.cls;
    el.textContent = info.icon + " " + info.label;
  }

  // ─── Poster with fallback ───────────────────────────────────────────────────
  window.showPosterFallback = function (img) {
    img.style.display = "none";
    var fallbackId = img.id + "-fallback";
    // derive fallback id from poster id convention
    if (img.id === "poster-img")    fallbackId = "poster-fallback";
    if (img.id === "reveal-poster") fallbackId = "reveal-poster-fallback";
    var fb = $(fallbackId);
    if (fb) fb.style.display = "flex";
  };

  function setPoster(imgId, fallbackId, url, type) {
    var img = $(imgId);
    var fb  = $(fallbackId);
    if (!img || !fb) return;

    // reset fallback icon based on type
    var icons = { movie: "🎬", series: "📺", actor: "🎭" };
    fb.textContent = icons[type] || "🎬";

    if (url) {
      img.style.display = "block";
      fb.style.display  = "none";
      img.src = url;
    } else {
      img.style.display = "none";
      fb.style.display  = "flex";
    }
  }

  // ─── Timer bar ─────────────────────────────────────────────────────────────
  function setTimerBar(current, total) {
    var bar = $("timer-bar");
    if (!bar) return;
    var pct = Math.max(0, Math.min(100, (current / total) * 100));
    bar.style.width = pct + "%";
    // colour shift: green → amber → red
    if (pct > 50)      bar.style.background = "var(--green)";
    else if (pct > 25) bar.style.background = "var(--gold)";
    else               bar.style.background = "var(--accent)";
  }

  function clearTimers() {
    if (timerInterval)  { clearInterval(timerInterval);  timerInterval  = null; }
    if (revealInterval) { clearInterval(revealInterval); revealInterval = null; }
  }

  // ─── Player list ───────────────────────────────────────────────────────────
  function renderPlayers(players, host, scores) {
    window.lvl3.renderPlayerList($("player-list"), players, host, scores || {});
  }

  // ─── Auth & init ───────────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    myUsername = d.username;

    var av = $("user-avatar");
    var nm = $("user-name");
    if (av) {
      av.style.background = window.lvl3.avatarColor(myUsername);
      av.textContent      = window.lvl3.avatarInitial(myUsername);
    }
    if (nm) nm.textContent = myUsername;

    socket.emit("auth", { username: myUsername });

    // auto-join from URL ?code=XXXX
    var params = new URLSearchParams(window.location.search);
    var codeParam = params.get("code");
    if (codeParam) {
      var inp = $("join-code-input");
      if (inp) inp.value = codeParam.toUpperCase();
      joinRoom();
    }
  });

  // ─── Room actions ──────────────────────────────────────────────────────────
  window.createRoom = function () {
    socket.emit("room:create", { gameType: "movies-actors" });
  };

  window.joinRoom = function () {
    var inp  = $("join-code-input");
    var code = (inp ? inp.value : "").trim().toUpperCase();
    if (!code) { window.lvl3.showToast("Bitte Code eingeben", "error"); return; }
    socket.emit("room:join", { code: code });
  };

  window.leaveRoom = function () {
    socket.emit("room:leave");
    myRoomCode = null;
    isHost     = false;
    clearTimers();
    showScreen("join");
    window.location.href = "/dashboard.html";
  };

  window.backToLobby = function () {
    showScreen("lobby");
    setTimerBar(100, 100);
  };

  // ─── Host controls ─────────────────────────────────────────────────────────
  window.pushSettings = function () {
    if (!isHost) return;
    socket.emit("game:settings", {
      category:    $("setting-category")   ? $("setting-category").value   : "mixed",
      difficulty:  $("setting-difficulty") ? $("setting-difficulty").value : "normal",
      pointsToWin: $("setting-points")     ? parseInt($("setting-points").value, 10) : 10
    });
  };

  window.startGame = function () {
    if (!isHost) return;
    socket.emit("game:start");
  };

  // ─── Answer ────────────────────────────────────────────────────────────────
  window.submitAnswer = function () {
    var inp = $("answer-input");
    if (!inp) return;
    var val = inp.value.trim();
    if (!val) return;
    socket.emit("game:answer", { answer: val });
    inp.value = "";
    inp.focus();
  };

  // Enter key on answer input
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && currentPhase === "question") {
      window.submitAnswer();
    }
  });

  // ─── Socket events ─────────────────────────────────────────────────────────

  socket.on("room:created", function (d) {
    myRoomCode = d.code;
    isHost     = true;
    $("room-code-display").textContent = d.code;
    renderPlayers(d.players, d.host, {});
    applySettings(d.settings);
    setHostMode(true);
    showScreen("lobby");
  });

  socket.on("room:joined", function (d) {
    myRoomCode = d.code;
    isHost     = d.isHost;
    $("room-code-display").textContent = d.code;
    renderPlayers(d.players, d.host, {});
    applySettings(d.settings);
    setHostMode(d.isHost);
    showScreen("lobby");
  });

  socket.on("room:players", function (d) {
    renderPlayers(d.players, d.host, {});
  });

  socket.on("room:host-changed", function (d) {
    isHost = (d.host === myUsername);
    renderPlayers(d.players, d.host, {});
    setHostMode(isHost);
  });

  socket.on("room:error", function (d) {
    window.lvl3.showToast(d.message || "Fehler", "error");
  });

  socket.on("game:settings-updated", function (settings) {
    applySettings(settings);
  });

  // ── Main state machine ──
  socket.on("game:state", function (msg) {
    var phase = msg.phase;
    var data  = msg.data || {};

    clearTimers();

    if (phase === "countdown") {
      showScreen("countdown");
      $("countdown-num").textContent = data.seconds;
      window.lvl3.playSound("game-start");

    } else if (phase === "question") {
      showQuestion(data);

    } else if (phase === "reveal") {
      showReveal(data);

    } else if (phase === "game-end") {
      showGameEnd(data);
    }
  });

  socket.on("game:tick", function (d) {
    var tl = d.timeLeft;
    $("timer-display") && ($("timer-display").textContent = tl);
    setTimerBar(tl, timerTotal);
    if (tl <= 5) window.lvl3.playSound("tick");
  });

  socket.on("game:player-answered", function (d) {
    // update sidebar scores
    if (d.scores) {
      var list = $("player-list");
      if (list) {
        // re-render with updated scores — we need players array; rebuild from list items
        var items = list.querySelectorAll(".player-name");
        var players = Array.from(items).map(function (el) {
          return el.childNodes[0].textContent.trim();
        });
        // crude: just update score spans
        list.querySelectorAll(".player-item").forEach(function (li) {
          var nameEl = li.querySelector(".player-name");
          var scoreEl = li.querySelector(".player-score");
          if (!nameEl || !scoreEl) return;
          var p = nameEl.childNodes[0].textContent.trim();
          if (d.scores[p] !== undefined) scoreEl.textContent = d.scores[p];
        });
      }
    }

    if (d.username === myUsername) {
      if (d.correct) {
        window.lvl3.playSound("correct");
        var banner = $("answered-banner");
        if (banner) {
          banner.style.display = "block";
          banner.textContent   = "Richtig! +" + d.pointsGained + " Punkte";
        }
        var inp = $("answer-input");
        if (inp) inp.disabled = true;
        var btn = $("submit-btn");
        if (btn) btn.disabled = true;
      } else {
        window.lvl3.playSound("wrong");
        var ainp = $("answer-input");
        if (ainp) {
          ainp.classList.add("wrong-flash");
          setTimeout(function () { ainp.classList.remove("wrong-flash"); }, 400);
        }
      }
    }
  });

  // ─── Phase renderers ───────────────────────────────────────────────────────

  function showQuestion(data) {
    timerTotal = data.timeLeft || 25;

    $("progress-label").textContent = "Frage " + (data.questionIndex + 1) + " / " + data.total;

    setCategoryBadge("category-badge", data.type);

    setPoster("poster-img", "poster-fallback", data.imageUrl, data.type);

    $("hint-text").textContent = data.hint || "";

    // reset answer area
    var inp = $("answer-input");
    if (inp) { inp.value = ""; inp.disabled = false; inp.focus(); }
    var btn = $("submit-btn");
    if (btn) btn.disabled = false;
    var banner = $("answered-banner");
    if (banner) banner.style.display = "none";

    $("timer-display").textContent = data.timeLeft;
    setTimerBar(data.timeLeft, timerTotal);

    showScreen("question");
    window.lvl3.playSound("round-start");
  }

  function showReveal(data) {
    setCategoryBadge("reveal-category-badge", data.type);
    setPoster("reveal-poster", "reveal-poster-fallback", data.imageUrl, data.type);
    $("reveal-answer-text").textContent = data.answer || "";

    // scores in reveal panel
    var revealList = $("reveal-scores");
    if (revealList && data.scores) {
      var sorted = Object.entries(data.scores).sort(function (a, b) { return b[1] - a[1]; });
      revealList.innerHTML = sorted.map(function (entry, i) {
        var p = entry[0]; var s = entry[1];
        return '<li class="player-item' + (i === 0 ? " is-host" : "") + '">' +
          '<div class="player-avatar" style="background:' + window.lvl3.avatarColor(p) + '">' + window.lvl3.avatarInitial(p) + '</div>' +
          '<span class="player-name">' + p + '</span>' +
          '<span class="player-score">' + s + '</span>' +
          '</li>';
      }).join("");
    }

    var revealSecs = data.revealSeconds || 4;
    $("reveal-countdown").textContent = revealSecs;

    showScreen("reveal");
    setTimerBar(100, 100);

    revealInterval = setInterval(function () {
      revealSecs--;
      var el = $("reveal-countdown");
      if (el) el.textContent = revealSecs;
      if (revealSecs <= 0) {
        clearInterval(revealInterval);
        revealInterval = null;
      }
    }, 1000);
  }

  function showGameEnd(data) {
    $("winner-name").textContent = data.winner || "Niemand";

    var fs = $("final-scores");
    if (fs && data.finalScores) {
      fs.innerHTML = data.finalScores.map(function (row, i) {
        return '<div class="final-score-row' + (i === 0 ? " first-place" : "") + '">' +
          '<div class="flex items-center" style="gap:10px;align-items:center">' +
          '<span style="font-size:18px">' + (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1) + ".") + '</span>' +
          '<div class="player-avatar" style="background:' + window.lvl3.avatarColor(row.username) + ';width:28px;height:28px;font-size:12px">' + window.lvl3.avatarInitial(row.username) + '</div>' +
          '<span style="font-weight:600">' + row.username + '</span>' +
          '</div>' +
          '<span style="font-weight:700;color:var(--gold)">' + row.score + ' P.</span>' +
          '</div>';
      }).join("");
    }

    showScreen("end");
    setTimerBar(0, 100);
  }

  // ─── Settings helpers ──────────────────────────────────────────────────────

  function applySettings(settings) {
    if (!settings) return;

    // update selects if host
    if (isHost) {
      var cat  = $("setting-category");
      var diff = $("setting-difficulty");
      var pts  = $("setting-points");
      if (cat  && settings.category)    cat.value  = settings.category;
      if (diff && settings.difficulty)  diff.value = settings.difficulty;
      if (pts  && settings.pointsToWin) pts.value  = String(settings.pointsToWin);
    }

    // update guest display
    var catLabels = { movies: "Filme", series: "Serien", actors: "Schauspieler", mixed: "Gemischt" };
    var diffLabels = { easy: "Leicht", normal: "Normal", hard: "Schwer" };
    var guestDisp = $("guest-settings-display");
    if (guestDisp) {
      guestDisp.textContent =
        (catLabels[settings.category] || "Gemischt") + " · " +
        (diffLabels[settings.difficulty] || "Normal") + " · " +
        (settings.pointsToWin || 10) + " Punkte zum Sieg";
    }
  }

  function setHostMode(host) {
    var hs = $("host-settings");
    var gs = $("guest-settings");
    if (hs) hs.style.display = host ? "block" : "none";
    if (gs) gs.style.display = host ? "none"  : "block";
  }

})();
