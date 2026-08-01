(function () {
  "use strict";

  var username = null, roomCode = null, isHost = false;
  var players = [], host = "", currentAvatars = {}, teams = null;
  var settings = { rounds: 8 };
  var timerInterval = null, timerLeft = 0, timerTotal = 1, timerElId = null;
  var BAND = 6;

  var socket = window.lvl3.socket;
  function $(id) { return document.getElementById(id); }
  var esc = window.lvl3.escapeHtml;

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }
  function myTeam() {
    if (!teams) return null;
    if ((teams.A || []).indexOf(username) !== -1) return "A";
    if ((teams.B || []).indexOf(username) !== -1) return "B";
    return null;
  }

  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = $("user-avatar"), nm = $("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;
    socket.emit("auth", {});
  });

  window.createRoom = function () { socket.emit("room:create", { gameType: "wellenlaenge" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.pushSettings = function () {
    if (!isHost) return;
    var n = Math.min(20, Math.max(2, parseInt(($("inp-rounds") && $("inp-rounds").value) || 8, 10)));
    socket.emit("room:settings", { rounds: n });
  };
  window.startGame = function () {
    var e = $("start-error"); if (e) e.textContent = "";
    socket.emit("wl:start");
  };
  window.leaveRoom = function () { stopTimer(); socket.emit("room:leave"); roomCode = null; showScreen("join"); };
  window.playAgain = function () { socket.emit("wl:restart"); };

  var ji = $("join-code-input");
  if (ji) ji.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  socket.on("room:created", function (d) {
    roomCode = d.code; isHost = true; players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    settings = d.settings || settings; enterLobby();
  });
  socket.on("room:joined", function (d) {
    roomCode = d.code; isHost = d.isHost; players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    settings = d.settings || settings; enterLobby();
  });
  socket.on("room:error", function (d) { var e = $("join-error"); if (e) e.textContent = d.message || "Fehler"; });
  socket.on("game:error", function (d) { var e = $("start-error"); if (e) e.textContent = (d && d.message) || "Fehler"; });
  socket.on("room:players", function (d) {
    players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    renderPlayers(); socket.emit("wl:get-teams");
  });
  socket.on("room:host-changed", function (d) {
    host = d.host; players = d.players; isHost = (host === username);
    if (d.avatars) currentAvatars = d.avatars;
    renderPlayers(); updateHostUI(); socket.emit("wl:get-teams");
  });
  socket.on("room:settings-updated", function (d) { settings = d; applySettingsToUI(); });
  socket.on("wl:teams", function (d) { teams = d.teams; renderTeams(); });

  function enterLobby() {
    var c = $("room-code-display"); if (c) c.textContent = roomCode;
    renderPlayers(); updateHostUI(); applySettingsToUI();
    socket.emit("wl:get-teams"); showScreen("lobby");
  }
  function renderPlayers(scores) {
    window.lvl3.renderPlayerList($("player-list"), players, host, scores || {}, currentAvatars);
  }
  function updateHostUI() {
    var b = $("btn-start"), p = $("host-settings"), g = $("guest-settings");
    if (isHost) {
      if (b) b.classList.remove("hidden");
      if (p) p.style.display = ""; if (g) g.style.display = "none";
    } else {
      if (b) b.classList.add("hidden");
      if (p) p.style.display = "none"; if (g) g.style.display = "";
    }
    var h = $("team-hint");
    if (h) h.textContent = isHost ? "Spieler anklicken, um das Team zu wechseln" : "Der Host teilt die Teams ein";
  }
  function applySettingsToUI() {
    if ($("inp-rounds")) $("inp-rounds").value = settings.rounds || 8;
    var gi = $("guest-settings-display");
    if (gi) gi.textContent = "Runden: " + (settings.rounds || 8);
  }
  function renderTeams() {
    if (!teams) return;
    ["a", "b"].forEach(function (k) {
      var wrap = $("team-" + k + "-chips"); if (!wrap) return;
      wrap.innerHTML = "";
      (teams[k.toUpperCase()] || []).forEach(function (p) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "team-chip" + (isHost ? " clickable" : "");
        chip.textContent = p;
        if (isHost) chip.addEventListener("click", function () { socket.emit("wl:set-team", { player: p }); });
        wrap.appendChild(chip);
      });
    });
  }

  function pos(el, pct) { if (el) { el.style.left = pct + "%"; el.style.display = "block"; } }
  function band(el, center, halfWidth) {
    if (!el) return;
    var l = Math.max(0, center - halfWidth), r = Math.min(100, center + halfWidth);
    el.style.left = l + "%"; el.style.width = (r - l) + "%"; el.style.display = "block";
  }
  function scoreLine(el, d) {
    if (!el) return;
    el.innerHTML = '<span class="ta">Team A ' + (d.scores.A || 0) + "</span>" +
      '<span style="color:var(--mut)"> · </span><span class="tb">' + (d.scores.B || 0) + " Team B</span>";
  }

  socket.on("game:state", function (msg) {
    var phase = msg.phase, d = msg.data || {};
    if (phase === "lobby") { stopTimer(); isHost = (host === username); enterLobby(); return; }
    if (phase === "countdown") {
      showScreen("countdown");
      var n = $("countdown-num");
      if (n) { n.textContent = d.count; n.style.animation = "none"; void n.offsetWidth; n.style.animation = ""; }
      window.lvl3.playSound("game-start");
      return;
    }
    if (phase === "clue")     { showClue(d); return; }
    if (phase === "guess")    { showGuess(d); return; }
    if (phase === "reveal")   { showReveal(d); return; }
    if (phase === "game-end") { showEnd(d); return; }
  });

  // ── Hinweis-Phase ──
  function showClue(d) {
    stopTimer();
    if (d.teams) teams = d.teams;
    if (typeof d.band === "number") BAND = d.band;
    if ($("clue-progress")) $("clue-progress").textContent = "Runde " + d.roundNumber + " / " + d.totalRounds;
    var pill = $("clue-turn");
    if (pill) {
      pill.textContent = "Team " + d.activeTeam + " gibt den Hinweis";
      pill.className = "turn-pill " + d.activeTeam.toLowerCase();
    }
    if ($("clue-left")) $("clue-left").textContent = d.axis.left;
    if ($("clue-right")) $("clue-right").textContent = d.axis.right;

    var isGiver = d.clueGiver === username;
    // Zielband nur für den Hinweisgeber — target kommt für alle anderen gar nicht mit.
    ["cb1", "cb2", "cb3", "cm-target"].forEach(function (id) {
      var el = $(id); if (el) el.style.display = "none";
    });
    if (isGiver && typeof d.target === "number") {
      band($("cb3"), d.target, BAND * 3);
      band($("cb2"), d.target, BAND * 2);
      band($("cb1"), d.target, BAND);
      pos($("cm-target"), d.target);
    }

    if ($("clue-role")) {
      $("clue-role").textContent = isGiver
        ? "Du bist Hinweisgeber — nur du siehst das Ziel. Ein Wort, keine Zahlen!"
        : (d.clueGiver + " überlegt sich einen Hinweis…");
    }
    var wrap = $("clue-input-wrap");
    if (wrap) wrap.classList.toggle("hidden", !isGiver);
    var inp = $("clue-input"), btn = $("btn-clue");
    if (inp) { inp.value = ""; inp.disabled = false; }
    if (btn) { btn.disabled = false; btn.textContent = "Hinweis geben"; }

    renderPlayers();
    startTimer(d.timeLeft || 60, "clue-timer");
    window.lvl3.playSound("round-start");
    showScreen("clue");
    if (isGiver && inp) inp.focus();
  }
  function sendClue() {
    var inp = $("clue-input");
    var t = inp ? inp.value.trim() : "";
    if (!t) return;
    if (inp) inp.disabled = true;
    var btn = $("btn-clue");
    if (btn) { btn.disabled = true; btn.textContent = "Abgeschickt ✓"; }
    socket.emit("wl:clue", { text: t });
  }
  if ($("btn-clue")) $("btn-clue").addEventListener("click", sendClue);
  if ($("clue-input")) $("clue-input").addEventListener("keydown", function (e) { if (e.key === "Enter") sendClue(); });

  // ── Rate-Phase ──
  function showGuess(d) {
    stopTimer();
    if (d.teams) teams = d.teams;
    if ($("guess-progress")) $("guess-progress").textContent = "Runde " + d.roundNumber + " / " + d.totalRounds;
    var pill = $("guess-turn");
    if (pill) {
      pill.textContent = "Team " + d.activeTeam + " rät";
      pill.className = "turn-pill " + d.activeTeam.toLowerCase();
    }
    if ($("guess-clue")) $("guess-clue").textContent = d.clue || "—";
    if ($("guess-left")) $("guess-left").textContent = d.axis.left;
    if ($("guess-right")) $("guess-right").textContent = d.axis.right;

    var mt = myTeam();
    var isActive = mt === d.activeTeam;
    var isGiver = d.clueGiver === username;
    var canSlide = isActive && !isGiver;

    var sl = $("guess-slider");
    if (sl) {
      sl.value = d.guess == null ? 50 : d.guess;
      sl.disabled = !canSlide;
      pos($("gm-guess"), Number(sl.value));
    }
    var lock = $("btn-lock");
    if (lock) { lock.classList.toggle("hidden", !canSlide); lock.disabled = false; }
    var cr = $("counter-row");
    if (cr) cr.classList.toggle("hidden", isActive);
    ["btn-left", "btn-right"].forEach(function (id) {
      var b = $(id); if (b) { b.disabled = false; b.classList.remove("selected"); }
    });

    if ($("guess-role")) {
      $("guess-role").textContent = canSlide
        ? "Schiebt den Regler — jeder aus dem Team darf, der letzte Wert gilt."
        : (isGiver ? "Du hast den Hinweis gegeben — jetzt still sein!"
                   : "Ratet, auf welcher Seite der Schätzung das Ziel liegt (+1).");
    }
    scoreLine($("guess-score"), d);
    renderPlayers();
    startTimer(d.timeLeft || 60, "guess-timer");
    showScreen("guess");
  }

  var slideTimer = null;
  if ($("guess-slider")) $("guess-slider").addEventListener("input", function () {
    pos($("gm-guess"), Number(this.value));
    var v = Number(this.value);
    if (slideTimer) clearTimeout(slideTimer);
    // gebündelt senden, nicht bei jedem Pixel
    slideTimer = setTimeout(function () { socket.emit("wl:guess", { value: v }); }, 120);
  });
  socket.on("wl:guess-live", function (d) {
    var sl = $("guess-slider");
    // Nur fremde Bewegungen übernehmen, sonst springt der eigene Regler
    if (sl && sl.disabled) { sl.value = d.value; }
    pos($("gm-guess"), d.value);
  });
  if ($("btn-lock")) $("btn-lock").addEventListener("click", function () {
    this.disabled = true;
    socket.emit("wl:lock");
  });
  if ($("btn-left")) $("btn-left").addEventListener("click", function () {
    this.classList.add("selected");
    var o = $("btn-right"); if (o) o.classList.remove("selected");
    socket.emit("wl:counter", { side: "left" });
  });
  if ($("btn-right")) $("btn-right").addEventListener("click", function () {
    this.classList.add("selected");
    var o = $("btn-left"); if (o) o.classList.remove("selected");
    socket.emit("wl:counter", { side: "right" });
  });
  socket.on("wl:counter-set", function (d) {
    if ($("guess-role")) {
      $("guess-role").textContent = "Gegenteam tippt: Ziel liegt " + (d.side === "left" ? "links" : "rechts");
    }
  });

  // ── Reveal ──
  function showReveal(d) {
    stopTimer();
    if (typeof d.band === "number") BAND = d.band;
    if ($("rv-kicker")) $("rv-kicker").textContent = "Runde " + d.roundNumber + " / " + d.totalRounds;
    if ($("rv-clue")) $("rv-clue").textContent = d.clue || "—";
    if ($("rv-left")) $("rv-left").textContent = d.axis.left;
    if ($("rv-right")) $("rv-right").textContent = d.axis.right;

    band($("rb3"), d.target, BAND * 3);
    band($("rb2"), d.target, BAND * 2);
    band($("rb1"), d.target, BAND);
    pos($("rm-target"), d.target);
    pos($("rm-guess"), d.guess);

    if ($("rv-points")) $("rv-points").textContent = "+" + d.points + " für Team " + d.activeTeam;
    if ($("rv-detail")) {
      var txt = "Abstand " + d.distance.toFixed(1) + " Punkte";
      if (d.counter) {
        txt += " · Gegenteam tippte " + (d.counter === "left" ? "links" : "rechts") +
          (d.counterOk ? " → richtig, +1 für Team " + d.counterTeam : " → falsch");
      }
      $("rv-detail").textContent = txt;
    }
    scoreLine($("rv-score"), d);
    window.lvl3.playSound(d.points >= 3 ? "correct" : "wrong");
    showScreen("reveal");
  }

  function showEnd(d) {
    stopTimer();
    var k = $("end-kicker"), w = $("end-winner-name"), s = $("end-sub");
    if (d.tie) {
      if (k) k.textContent = "Unentschieden";
      if (w) w.textContent = "Gleichstand!";
      if (s) s.textContent = "perfekt aufeinander eingestellt";
    } else {
      if (k) k.textContent = "Gewinner";
      if (w) w.textContent = d.winner || "—";
      if (s) s.textContent = "gewinnt das Spiel";
    }
    var el = $("end-final-scores");
    if (el) {
      el.innerHTML = (d.scores || []).map(function (row, i) {
        var medal = ["1.", "2."][i] || (i + 1) + ".";
        return '<div class="final-score-row"><span><span style="min-width:24px;display:inline-block">' +
          medal + "</span>" + esc(row.player) + "</span>" +
          '<span style="font-weight:700;color:var(--acc)">' + row.score + "</span></div>";
      }).join("");
    }
    var again = $("btn-play-again");
    if (again) again.classList.toggle("hidden", !isHost);
    showScreen("end");
  }

  function startTimer(secs, elId) {
    stopTimer();
    timerLeft = secs; timerTotal = secs; timerElId = elId;
    updateTimerUI();
    timerInterval = setInterval(function () {
      timerLeft -= 1; updateTimerUI();
      if (timerLeft <= 3 && timerLeft > 0) window.lvl3.playSound("tick");
      if (timerLeft <= 0) stopTimer();
    }, 1000);
  }
  function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
  function updateTimerUI() {
    var el = timerElId ? $(timerElId) : null;
    if (el) el.textContent = Math.max(0, timerLeft);
    var bar = $("timer-bar");
    if (bar) bar.style.width = Math.max(0, (timerLeft / timerTotal) * 100) + "%";
  }
}());
