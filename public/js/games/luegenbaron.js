(function () {
  "use strict";

  var username = null, roomCode = null, isHost = false;
  var players = [], host = "", currentAvatars = {};
  var settings = { rounds: 7 };
  var timerInterval = null, timerLeft = 0, timerTotal = 1, timerElId = null;
  var lieSent = false, pickSent = false;

  var socket = window.lvl3.socket;
  function $(id) { return document.getElementById(id); }
  var esc = window.lvl3.escapeHtml;

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }

  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = $("user-avatar"), nm = $("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;
    socket.emit("auth", {});
  });

  window.createRoom = function () { socket.emit("room:create", { gameType: "luegenbaron" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.pushSettings = function () {
    if (!isHost) return;
    var n = Math.min(15, Math.max(3, parseInt(($("inp-rounds") && $("inp-rounds").value) || 7, 10)));
    socket.emit("room:settings", { rounds: n });
  };
  window.startGame = function () {
    var e = $("start-error"); if (e) e.textContent = "";
    socket.emit("luegenbaron:start");
  };
  window.leaveRoom = function () { stopTimer(); socket.emit("room:leave"); roomCode = null; showScreen("join"); };
  window.playAgain = function () { socket.emit("luegenbaron:restart"); };

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
    renderPlayers();
  });
  socket.on("room:host-changed", function (d) {
    host = d.host; players = d.players; isHost = (host === username);
    if (d.avatars) currentAvatars = d.avatars;
    renderPlayers(); updateHostUI();
  });
  socket.on("room:settings-updated", function (d) { settings = d; applySettingsToUI(); });

  function enterLobby() {
    var c = $("room-code-display"); if (c) c.textContent = roomCode;
    renderPlayers(); updateHostUI(); applySettingsToUI(); showScreen("lobby");
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
  }
  function applySettingsToUI() {
    if ($("inp-rounds")) $("inp-rounds").value = settings.rounds || 7;
    var gi = $("guest-settings-display");
    if (gi) gi.textContent = "Fragen: " + (settings.rounds || 7);
  }

  // ── Game state ──
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
    if (phase === "lie")      { showLie(d); return; }
    if (phase === "pick")     { showPick(d); return; }
    if (phase === "reveal")   { showReveal(d); return; }
    if (phase === "game-end") { showEnd(d); return; }
  });

  // ── Phase 1: Lüge erfinden ──
  function showLie(d) {
    stopTimer();
    lieSent = false;
    if ($("lie-progress")) $("lie-progress").textContent = "Frage " + d.roundNumber + " / " + d.totalRounds;
    if ($("lie-question")) $("lie-question").textContent = d.question;
    var inp = $("lie-input"), btn = $("btn-lie");
    if (inp) { inp.value = ""; inp.disabled = false; }
    if (btn) { btn.disabled = false; btn.textContent = "Lüge abschicken"; }
    if ($("lie-error")) $("lie-error").textContent = "";
    if ($("lie-waiting")) $("lie-waiting").textContent = "0 / " + d.votersTotal + " haben gelogen";
    renderPlayers(d.scores || {});
    startTimer(d.timeLeft || 35, "lie-timer");
    window.lvl3.playSound("round-start");
    showScreen("lie");
    if (inp) inp.focus();
  }
  function sendLie() {
    if (lieSent) return;
    var inp = $("lie-input");
    var text = inp ? inp.value.trim() : "";
    if (!text) return;
    lieSent = true;
    if (inp) inp.disabled = true;
    var btn = $("btn-lie");
    if (btn) { btn.disabled = true; btn.textContent = "Abgeschickt ✓"; }
    socket.emit("luegenbaron:lie", { text: text });
  }
  if ($("btn-lie")) $("btn-lie").addEventListener("click", sendLie);
  if ($("lie-input")) $("lie-input").addEventListener("keydown", function (e) { if (e.key === "Enter") sendLie(); });

  socket.on("luegenbaron:lie-rejected", function (d) {
    // z.B. versehentlich die Wahrheit getippt → erneut versuchen lassen
    lieSent = false;
    var inp = $("lie-input"), btn = $("btn-lie");
    if (inp) { inp.disabled = false; inp.value = ""; inp.focus(); }
    if (btn) { btn.disabled = false; btn.textContent = "Lüge abschicken"; }
    if ($("lie-error")) $("lie-error").textContent = (d && d.reason) || "Nochmal.";
    window.lvl3.playSound("wrong");
  });
  socket.on("luegenbaron:lie-count", function (d) {
    if ($("lie-waiting")) $("lie-waiting").textContent = d.count + " / " + d.total + " haben gelogen";
  });

  // ── Phase 2: Wahrheit wählen ──
  function showPick(d) {
    stopTimer();
    pickSent = false;
    if ($("pick-progress")) $("pick-progress").textContent = "Frage " + d.roundNumber + " / " + d.totalRounds;
    if ($("pick-question")) $("pick-question").textContent = d.question;
    if ($("pick-error")) $("pick-error").textContent = "";
    if ($("pick-waiting")) $("pick-waiting").textContent = "0 / " + d.votersTotal + " haben gewählt";

    var grid = $("pick-options");
    if (grid) {
      grid.innerHTML = "";
      (d.options || []).forEach(function (opt, i) {
        var b = document.createElement("button");
        b.className = "option-btn";
        b.dataset.id = opt.id;
        b.innerHTML = '<span class="option-letter">' + String.fromCharCode(65 + i) + "</span><span>" +
          esc(opt.text) + "</span>";
        b.addEventListener("click", function () {
          if (pickSent) return;
          pickSent = true;
          grid.querySelectorAll(".option-btn").forEach(function (x) { x.disabled = true; });
          b.classList.add("selected");
          socket.emit("luegenbaron:pick", { id: opt.id });
        });
        grid.appendChild(b);
      });
    }
    renderPlayers(d.scores || {});
    startTimer(d.timeLeft || 25, "pick-timer");
    showScreen("pick");
  }
  socket.on("luegenbaron:pick-rejected", function (d) {
    // eigene Lüge gewählt → Auswahl wieder freigeben
    pickSent = false;
    var grid = $("pick-options");
    if (grid) grid.querySelectorAll(".option-btn").forEach(function (x) {
      x.disabled = false; x.classList.remove("selected");
    });
    if ($("pick-error")) $("pick-error").textContent = (d && d.reason) || "Andere Antwort wählen.";
    window.lvl3.playSound("wrong");
  });
  socket.on("luegenbaron:pick-count", function (d) {
    if ($("pick-waiting")) $("pick-waiting").textContent = d.count + " / " + d.total + " haben gewählt";
  });

  // ── Reveal ──
  function showReveal(d) {
    stopTimer();
    if ($("reveal-question")) $("reveal-question").textContent = d.question;
    var box = $("reveal-options");
    if (box) {
      box.innerHTML = "";
      (d.options || []).forEach(function (o) {
        var row = document.createElement("div");
        row.className = "reveal-opt" + (o.isTruth ? " truth" : "");
        var meta = o.isTruth
          ? "✓ Die Wahrheit"
          : (o.owners.length ? "Lüge von " + o.owners.map(esc).join(" & ") : "Haus-Lüge");
        var picked = o.pickedBy && o.pickedBy.length
          ? " · gewählt von " + o.pickedBy.map(esc).join(", ")
          : " · niemand drauf reingefallen";
        var pts = "";
        if (o.isTruth && o.pickedBy && o.pickedBy.length) pts = "+2 je";
        else if (!o.isTruth && o.owners.length && o.pickedBy && o.pickedBy.length) pts = "+" + o.pickedBy.length;
        row.innerHTML = '<div><div class="reveal-opt-text">' + esc(o.text) + "</div>" +
          '<div class="reveal-opt-meta">' + meta + picked + "</div></div>" +
          '<div class="reveal-opt-pts">' + pts + "</div>";
        box.appendChild(row);
      });
    }
    var gains = $("reveal-gains");
    if (gains) {
      gains.innerHTML = players.map(function (p) {
        var g = (d.gained && d.gained[p]) || 0;
        return '<div class="gain-row"><span>' + esc(p) + "</span>" +
          '<span style="color:' + (g > 0 ? "var(--ok)" : "var(--mut)") + '">' +
          (g > 0 ? "+" + g : "±0") + "</span></div>";
      }).join("");
    }
    renderPlayers(d.scores || {});
    var mine = (d.gained && d.gained[username]) || 0;
    window.lvl3.playSound(mine > 0 ? "correct" : "wrong");
    showScreen("reveal");
  }

  // ── Ende ──
  function showEnd(d) {
    stopTimer();
    var k = $("end-kicker"), w = $("end-winner-name"), s = $("end-sub");
    if (d.tie) {
      if (k) k.textContent = "Unentschieden";
      if (w) w.textContent = "Gleichstand!";
      if (s) s.textContent = "alle gleich verlogen";
    } else {
      if (k) k.textContent = "Größter Lügenbaron";
      if (w) w.textContent = d.winner || "—";
      if (s) s.textContent = "gewinnt das Spiel";
    }
    var el = $("end-final-scores");
    if (el) {
      el.innerHTML = (d.scores || []).map(function (row, i) {
        var medal = ["1.", "2.", "3."][i] || (i + 1) + ".";
        return '<div class="final-score-row"><span><span style="min-width:24px;display:inline-block">' +
          medal + "</span>" + esc(row.player) + "</span>" +
          '<span style="font-weight:700;color:var(--acc)">' + row.score + "</span></div>";
      }).join("");
    }
    var again = $("btn-play-again");
    if (again) again.classList.toggle("hidden", !isHost);
    showScreen("end");
  }

  // ── Timer (mehrere Phasen teilen sich die Logik) ──
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
