(function () {
  "use strict";

  var username = null, roomCode = null, isHost = false;
  var players = [], host = "", teams = null;
  var settings = { playMode: "ffa", rounds: 12 };
  var timerInterval = null, timerLeft = 0, timerTotal = 1;
  var voteLocked = false, currentAvatars = {};

  var socket = window.lvl3.socket;
  function $(id) { return document.getElementById(id); }
  var esc = window.lvl3.escapeHtml;

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }
  function nf(n) { return Number(n).toLocaleString("de-DE"); }

  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = $("user-avatar"), nm = $("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;
    socket.emit("auth", {});
  });

  window.createRoom = function () { socket.emit("room:create", { gameType: "hoeher-tiefer" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.pushSettings = function () {
    if (!isHost) return;
    var n = Math.min(30, Math.max(3, parseInt(($("inp-rounds") && $("inp-rounds").value) || 12, 10)));
    socket.emit("room:settings", { playMode: $("sel-playmode") ? $("sel-playmode").value : "ffa", rounds: n });
  };
  window.startGame = function () {
    var err = $("start-error"); if (err) err.textContent = "";
    socket.emit("hoeher:start");
  };
  window.leaveRoom = function () {
    stopTimer(); socket.emit("room:leave"); roomCode = null; showScreen("join");
  };
  window.playAgain = function () { socket.emit("hoeher:restart"); };

  var ji = $("join-code-input");
  if (ji) ji.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  // ── Room events ──
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
    renderPlayers(); socket.emit("hoeher:get-teams");
  });
  socket.on("room:host-changed", function (d) {
    host = d.host; players = d.players; isHost = (host === username);
    if (d.avatars) currentAvatars = d.avatars;
    renderPlayers(); updateHostUI(); socket.emit("hoeher:get-teams");
  });
  socket.on("room:settings-updated", function (d) { settings = d; applySettingsToUI(); });
  socket.on("hoeher:teams", function (d) { teams = d.teams; renderTeamSetup(); });

  function enterLobby() {
    var c = $("room-code-display"); if (c) c.textContent = roomCode;
    renderPlayers(); updateHostUI(); applySettingsToUI();
    socket.emit("hoeher:get-teams");
    showScreen("lobby");
  }
  function renderPlayers(scores) {
    window.lvl3.renderPlayerList($("player-list"), players, host, scores || {}, currentAvatars);
  }
  function updateHostUI() {
    var b = $("btn-start"), p = $("host-settings"), g = $("guest-settings");
    if (isHost) {
      if (b) { b.classList.remove("hidden"); b.disabled = players.length < 1; }
      if (p) p.style.display = ""; if (g) g.style.display = "none";
    } else {
      if (b) b.classList.add("hidden");
      if (p) p.style.display = "none"; if (g) g.style.display = "";
    }
    var h = $("team-hint");
    if (h) h.textContent = isHost ? "Spieler anklicken, um das Team zu wechseln" : "Der Host teilt die Teams ein";
  }
  function applySettingsToUI() {
    if ($("sel-playmode")) $("sel-playmode").value = settings.playMode || "ffa";
    if ($("inp-rounds")) $("inp-rounds").value = settings.rounds || 12;
    var gi = $("guest-settings-display");
    if (gi) gi.textContent = "Modus: " + (settings.playMode === "teams" ? "Teams" : "Jeder für sich") +
      " · Duelle: " + (settings.rounds || 12);
    renderTeamSetup();
  }
  function renderTeamSetup() {
    var box = $("team-setup"); if (!box) return;
    var on = (settings.playMode === "teams");
    box.classList.toggle("hidden", !on);
    if (!on || !teams) return;
    ["a", "b"].forEach(function (k) {
      var wrap = $("team-" + k + "-chips"); if (!wrap) return;
      wrap.innerHTML = "";
      (teams[k.toUpperCase()] || []).forEach(function (p) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "team-chip" + (isHost ? " clickable" : "");
        chip.textContent = p;
        if (isHost) chip.addEventListener("click", function () { socket.emit("hoeher:set-team", { player: p }); });
        wrap.appendChild(chip);
      });
    });
  }

  // ── Game state ──
  socket.on("game:state", function (msg) {
    var phase = msg.phase, data = msg.data || {};
    if (phase === "lobby") { stopTimer(); isHost = (host === username); enterLobby(); return; }
    if (phase === "countdown") {
      showScreen("countdown");
      var n = $("countdown-num");
      if (n) { n.textContent = data.count; n.style.animation = "none"; void n.offsetWidth; n.style.animation = ""; }
      window.lvl3.playSound("game-start");
      return;
    }
    if (phase === "duel")     { showDuel(data); return; }
    if (phase === "reveal")   { showReveal(data); return; }
    if (phase === "game-end") { showEnd(data); return; }
  });

  function showDuel(d) {
    stopTimer();
    voteLocked = false;
    if (d.teams) teams = d.teams;

    var p = $("q-progress");
    if (p) p.textContent = "Duell " + d.roundNumber + " / " + d.totalRounds;
    if ($("ref-title")) $("ref-title").textContent = d.ref.title;
    if ($("ref-views")) $("ref-views").textContent = nf(d.ref.views);
    if ($("chal-title")) $("chal-title").textContent = d.chal.title;
    if ($("period-label")) $("period-label").textContent = "Aufrufe " + (d.period || "");

    ["btn-higher", "btn-lower"].forEach(function (id) {
      var b = $(id); if (b) { b.disabled = false; b.classList.remove("selected"); }
    });
    var st = $("vote-status");
    if (st) st.textContent = "0 / " + d.votersTotal + " haben abgestimmt";

    // eigene Streak anzeigen
    var badge = $("streak-badge");
    if (badge) {
      var key = (d.playMode === "teams" && teams) ? myTeam() : username;
      var s = key && d.streaks ? (d.streaks[key] || 0) : 0;
      badge.textContent = s >= 2 ? ("🔥 " + s + "er Streak" + (s >= 3 ? " — doppelte Punkte!" : "")) : "";
    }

    renderScores(d);
    timerLeft = d.timeLeft || 12; timerTotal = timerLeft;
    updateTimerUI(timerLeft); startTimer();
    window.lvl3.playSound("round-start");
    showScreen("duel");
  }

  function myTeam() {
    if (!teams) return null;
    if ((teams.A || []).indexOf(username) !== -1) return "A";
    if ((teams.B || []).indexOf(username) !== -1) return "B";
    return null;
  }

  function renderScores(d) {
    var line = $("team-scoreline");
    if (d.playMode === "teams") {
      renderPlayers({});
      if (line) line.innerHTML = '<span class="ta">Team A ' + (d.scores.A || 0) + "</span>" +
        '<span style="color:var(--mut)"> · </span><span class="tb">' + (d.scores.B || 0) + " Team B</span>";
    } else {
      if (line) line.textContent = "";
      renderPlayers(d.scores || {});
    }
  }

  function vote(answer, btnId) {
    if (voteLocked) return;
    voteLocked = true;
    var b = $(btnId); if (b) b.classList.add("selected");
    ["btn-higher", "btn-lower"].forEach(function (id) { var x = $(id); if (x) x.disabled = true; });
    socket.emit("hoeher:vote", { answer: answer });
  }
  if ($("btn-higher")) $("btn-higher").addEventListener("click", function () { vote("higher", "btn-higher"); });
  if ($("btn-lower"))  $("btn-lower").addEventListener("click", function () { vote("lower", "btn-lower"); });

  socket.on("hoeher:voted", function (d) {
    var st = $("vote-status");
    if (st) st.textContent = d.count + " / " + d.total + " haben abgestimmt";
  });

  // ── Timer ──
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(function () {
      timerLeft -= 1; updateTimerUI(timerLeft);
      if (timerLeft <= 3 && timerLeft > 0) window.lvl3.playSound("tick");
      if (timerLeft <= 0) stopTimer();
    }, 1000);
  }
  function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
  function updateTimerUI(t) {
    var d = $("timer-display"), b = $("timer-bar");
    if (d) d.textContent = Math.max(0, t);
    if (b) b.style.width = Math.max(0, (t / timerTotal) * 100) + "%";
  }

  // ── Reveal ──
  function showReveal(d) {
    stopTimer();
    if (d.teams) teams = d.teams;
    if ($("rv-ref-title")) $("rv-ref-title").textContent = d.ref.title;
    if ($("rv-ref-views")) $("rv-ref-views").textContent = nf(d.ref.views);
    if ($("rv-chal-title")) $("rv-chal-title").textContent = d.chal.title;
    if ($("rv-chal-views")) $("rv-chal-views").textContent = nf(d.chal.views);

    var v = $("reveal-verdict");
    if (v) v.textContent = d.truth === "higher" ? "▲ Höher!" : "▼ Tiefer!";

    var mine = $("reveal-mine");
    if (mine) {
      if (d.playMode === "teams") {
        var got = [];
        if (d.roundPoints && d.roundPoints.A) got.push("Team A");
        if (d.roundPoints && d.roundPoints.B) got.push("Team B");
        mine.textContent = got.length ? "Punkt für " + got.join(" und ") : "Kein Team punktet";
      } else {
        var my = d.votes ? d.votes[username] : null;
        var pts = d.roundPoints ? d.roundPoints[username] : 0;
        if (!my) mine.textContent = "Du hast nicht abgestimmt";
        else if (my === d.truth) mine.textContent = "Richtig! +" + (pts || 1) + (pts > 1 ? " (Streak-Bonus)" : "");
        else mine.textContent = "Leider falsch — Streak zurück auf 0";
      }
    }

    var votesEl = $("reveal-votes");
    if (votesEl) {
      votesEl.innerHTML = "";
      players.forEach(function (p) {
        var vv = d.votes ? d.votes[p] : null;
        var right = vv === d.truth;
        var label = vv ? (vv === "higher" ? "▲ Höher" : "▼ Tiefer") : "— keine Stimme";
        var tag = "";
        if (d.playMode === "teams" && teams) {
          if ((teams.A || []).indexOf(p) !== -1) tag = ' <span style="color:var(--teamA)">A</span>';
          else if ((teams.B || []).indexOf(p) !== -1) tag = ' <span style="color:var(--teamB)">B</span>';
        }
        var row = document.createElement("div");
        row.className = "vote-result-row";
        row.innerHTML = "<span>" + esc(p) + tag + "</span>" +
          '<span class="' + (vv ? (right ? "v-ok" : "v-bad") : "") + '">' + label +
          (vv ? (right ? " ✓" : " ✗") : "") + "</span>";
        votesEl.appendChild(row);
      });
    }

    renderScores(d);
    var my2 = d.votes ? d.votes[username] : null;
    window.lvl3.playSound(d.playMode === "teams" ? "round-start" : (my2 === d.truth ? "correct" : "wrong"));
    showScreen("reveal");
  }

  // ── Ende ──
  function showEnd(d) {
    stopTimer();
    var k = $("end-kicker"), w = $("end-winner-name"), s = $("end-sub");
    if (d.tie) {
      if (k) k.textContent = "Unentschieden";
      if (w) w.textContent = "Gleichstand!";
      if (s) s.textContent = "niemand gewinnt — Revanche?";
    } else {
      if (k) k.textContent = "Gewinner";
      if (w) w.textContent = d.winner || "—";
      if (s) s.textContent = "gewinnt das Spiel";
    }
    var el = $("end-final-scores");
    if (el) {
      el.innerHTML = (d.scores || []).map(function (row, i) {
        var medal = ["1.", "2.", "3."][i] || (i + 1) + ".";
        var streak = row.streak ? ' <span style="color:var(--mut)">· 🔥' + row.streak + "</span>" : "";
        return '<div class="final-score-row"><span><span style="min-width:24px;display:inline-block">' +
          medal + "</span>" + esc(row.player) + streak + "</span>" +
          '<span style="font-weight:700;color:var(--acc)">' + row.score + "</span></div>";
      }).join("");
    }
    var again = $("btn-play-again");
    if (again) again.classList.toggle("hidden", !isHost);
    showScreen("end");
  }
}());
