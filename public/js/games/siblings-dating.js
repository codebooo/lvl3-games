(function () {
  "use strict";

  var username = null;
  var roomCode = null;
  var isHost = false;
  var players = [];
  var host = "";
  var settings = { playMode: "ffa", rounds: 10 };
  var teams = null;            // { A: [...], B: [...] } lobby preview + in-game
  var timerInterval = null;
  var timerLeft = 0;
  var timerTotal = 1;
  var voteLocked = false;
  var currentAvatars = {};

  var socket = window.lvl3.socket;

  function $(id) { return document.getElementById(id); }

  // ── Screen switcher ───────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }

  // ── Auth ──────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = $("user-avatar");
    var nm = $("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;
    socket.emit("auth", { username: username });
  });

  // ── Global actions ────────────────────────────────────────────
  window.createRoom = function () {
    socket.emit("room:create", { gameType: "siblings-dating" });
  };

  window.joinRoom = function () {
    var inp = $("join-code-input");
    var err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };

  window.pushSettings = function () {
    if (!isHost) return;
    var pts = Math.min(30, Math.max(3, parseInt(($("inp-rounds") && $("inp-rounds").value) || 10, 10)));
    socket.emit("room:settings", {
      playMode: $("sel-playmode") ? $("sel-playmode").value : "ffa",
      rounds: pts
    });
  };

  window.startGame = function () {
    var err = $("start-error");
    if (err) err.textContent = "";
    socket.emit("siblings-dating:start");
  };

  window.leaveRoom = function () {
    stopTimer();
    socket.emit("room:leave");
    roomCode = null;
    showScreen("join");
  };

  window.playAgain = function () {
    socket.emit("siblings-dating:restart");
  };

  var joinInput = $("join-code-input");
  if (joinInput) joinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  // ── Room events ───────────────────────────────────────────────
  socket.on("room:created", function (data) {
    roomCode = data.code; isHost = true; players = data.players; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    settings = data.settings || settings;
    enterLobby();
  });

  socket.on("room:joined", function (data) {
    roomCode = data.code; isHost = data.isHost; players = data.players; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    settings = data.settings || settings;
    enterLobby();
  });

  socket.on("room:error", function (data) {
    var err = $("join-error");
    if (err) err.textContent = data.message || "Fehler";
  });

  socket.on("game:error", function (data) {
    var err = $("start-error");
    if (err) err.textContent = (data && data.message) || "Fehler";
  });

  socket.on("room:players", function (data) {
    players = data.players; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    renderPlayers();
    socket.emit("siblings-dating:get-teams");
  });

  socket.on("room:host-changed", function (data) {
    host = data.host; players = data.players; isHost = (host === username);
    if (data.avatars) currentAvatars = data.avatars;
    renderPlayers(); updateHostUI();
    socket.emit("siblings-dating:get-teams");
  });

  socket.on("room:settings-updated", function (data) {
    settings = data;
    applySettingsToUI();
  });

  socket.on("siblings-dating:teams", function (data) {
    teams = data.teams;
    renderTeamSetup();
  });

  function enterLobby() {
    var codeEl = $("room-code-display");
    if (codeEl) codeEl.textContent = roomCode;
    renderPlayers(); updateHostUI(); applySettingsToUI();
    socket.emit("siblings-dating:get-teams");
    showScreen("lobby");
  }

  function renderPlayers(scores) {
    window.lvl3.renderPlayerList($("player-list"), players, host, scores || {}, currentAvatars);
  }

  function updateHostUI() {
    var btnStart = $("btn-start");
    var panel    = $("host-settings");
    var guest    = $("guest-settings");
    if (isHost) {
      if (btnStart) { btnStart.classList.remove("hidden"); btnStart.disabled = players.length < 1; }
      if (panel) panel.style.display = "";
      if (guest) guest.style.display = "none";
    } else {
      if (btnStart) btnStart.classList.add("hidden");
      if (panel) panel.style.display = "none";
      if (guest) guest.style.display = "";
    }
    var hint = $("team-hint");
    if (hint) hint.textContent = isHost
      ? "Spieler anklicken, um das Team zu wechseln"
      : "Der Host teilt die Teams ein";
  }

  function applySettingsToUI() {
    var selMode = $("sel-playmode");
    var inpRounds = $("inp-rounds");
    if (selMode) selMode.value = settings.playMode || "ffa";
    if (inpRounds) inpRounds.value = settings.rounds || 10;
    var guestInfo = $("guest-settings-display");
    if (guestInfo) {
      guestInfo.textContent = "Modus: " + ((settings.playMode === "teams") ? "Teams" : "Jeder für sich") +
        " · Runden: " + (settings.rounds || 10);
    }
    renderTeamSetup();
  }

  function renderTeamSetup() {
    var box = $("team-setup");
    if (!box) return;
    var teamsMode = (settings.playMode === "teams");
    box.classList.toggle("hidden", !teamsMode);
    if (!teamsMode || !teams) return;
    ["a", "b"].forEach(function (key) {
      var wrap = $("team-" + key + "-chips");
      if (!wrap) return;
      wrap.innerHTML = "";
      (teams[key.toUpperCase()] || []).forEach(function (p) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "team-chip" + (isHost ? " clickable" : "");
        chip.textContent = p;
        if (isHost) {
          chip.addEventListener("click", function () {
            socket.emit("siblings-dating:set-team", { player: p });
          });
        }
        wrap.appendChild(chip);
      });
    });
  }

  // ── Game state ────────────────────────────────────────────────
  socket.on("game:state", function (msg) {
    var phase = msg.phase;
    var data  = msg.data || {};

    if (phase === "lobby") { isHost = (host === username); enterLobby(); return; }

    if (phase === "countdown") {
      showScreen("countdown");
      var num = $("countdown-num");
      if (num) {
        num.textContent = data.count;
        num.style.animation = "none"; void num.offsetWidth; num.style.animation = "";
      }
      window.lvl3.playSound("game-start");
      return;
    }

    if (phase === "question") { showQuestion(data); return; }
    if (phase === "reveal")   { showReveal(data);   return; }
    if (phase === "game-end") { showGameEnd(data);  return; }
  });

  // ── Question ──────────────────────────────────────────────────
  function showQuestion(data) {
    stopTimer();
    voteLocked = false;
    if (data.teams) teams = data.teams;

    var prog = $("q-progress");
    if (prog) prog.textContent = "Runde " + data.roundNumber + " / " + data.totalRounds;

    var i1 = $("pair-img-1"), i2 = $("pair-img-2");
    if (i1) i1.src = data.img1;
    if (i2) i2.src = data.img2;

    [["btn-vote-siblings", "siblings"], ["btn-vote-couple", "couple"]].forEach(function (pair) {
      var btn = $(pair[0]);
      if (!btn) return;
      btn.disabled = false;
      btn.classList.remove("selected");
    });

    var status = $("vote-status");
    if (status) status.textContent = "0 / " + data.votersTotal + " haben abgestimmt";

    renderScores(data);

    timerLeft = data.timeLeft || 20;
    timerTotal = timerLeft;
    updateTimerUI(timerLeft);
    startTimer();

    window.lvl3.playSound("round-start");
    showScreen("question");
  }

  function renderScores(data) {
    var line = $("team-scoreline");
    if (data.playMode === "teams") {
      renderPlayers({});
      if (line) line.innerHTML = '<span class="ta">Team A ' + (data.scores.A || 0) + '</span>' +
        '<span style="color:var(--mut)"> · </span>' +
        '<span class="tb">' + (data.scores.B || 0) + ' Team B</span>';
    } else {
      if (line) line.textContent = "";
      renderPlayers(data.scores || {});
    }
  }

  function vote(answer, btnId) {
    if (voteLocked) return;
    voteLocked = true;
    var btn = $(btnId);
    if (btn) btn.classList.add("selected");
    ["btn-vote-siblings", "btn-vote-couple"].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = true;
    });
    socket.emit("siblings-dating:vote", { answer: answer });
    window.lvl3.playSound("correct");
  }

  var btnSib = $("btn-vote-siblings");
  var btnCpl = $("btn-vote-couple");
  if (btnSib) btnSib.addEventListener("click", function () { vote("siblings", "btn-vote-siblings"); });
  if (btnCpl) btnCpl.addEventListener("click", function () { vote("couple", "btn-vote-couple"); });

  socket.on("siblings-dating:voted", function (data) {
    var status = $("vote-status");
    if (status) status.textContent = data.count + " / " + data.total + " haben abgestimmt";
  });

  // ── Timer ─────────────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(function () {
      timerLeft -= 1;
      updateTimerUI(timerLeft);
      if (timerLeft <= 3 && timerLeft > 0) window.lvl3.playSound("tick");
      if (timerLeft <= 0) stopTimer();
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function updateTimerUI(t) {
    var disp = $("timer-display");
    var bar  = $("timer-bar");
    if (disp) disp.textContent = t;
    if (bar) bar.style.width = Math.max(0, (t / timerTotal) * 100) + "%";
  }

  // ── Reveal ────────────────────────────────────────────────────
  function showReveal(data) {
    stopTimer();
    if (data.teams) teams = data.teams;

    var i1 = $("reveal-img-1"), i2 = $("reveal-img-2");
    if (i1) i1.src = data.person1.img;
    if (i2) i2.src = data.person2.img;
    var n1 = $("reveal-name-1"), n2 = $("reveal-name-2");
    if (n1) n1.textContent = data.person1.name;
    if (n2) n2.textContent = data.person2.name;

    var verdict = $("reveal-verdict");
    if (verdict) verdict.textContent = data.answer === "couple" ? "Ein Paar!" : "Geschwister!";
    var rel = $("reveal-relation");
    if (rel) rel.textContent = data.relation || "";

    var rp = $("reveal-roundpoints");
    if (rp) {
      if (data.playMode === "teams") {
        var got = [];
        if (data.roundPoints && data.roundPoints.A) got.push("Team A");
        if (data.roundPoints && data.roundPoints.B) got.push("Team B");
        rp.textContent = got.length ? "+1 Punkt für " + got.join(" und ") : "Kein Team punktet";
      } else {
        var mine = data.votes ? data.votes[username] : null;
        if (!mine) rp.textContent = "Du hast nicht abgestimmt";
        else rp.textContent = (mine === data.answer) ? "Richtig! +1 Punkt" : "Leider falsch";
      }
    }

    var votesEl = $("reveal-votes");
    if (votesEl) {
      votesEl.innerHTML = "";
      players.forEach(function (p) {
        var v = data.votes ? data.votes[p] : null;
        var right = v === data.answer;
        var label = v ? (v === "couple" ? "❤️ Paar" : "👫 Geschwister") : "— keine Stimme";
        var teamTag = "";
        if (data.playMode === "teams" && teams) {
          if ((teams.A || []).indexOf(p) !== -1) teamTag = ' <span style="color:var(--teamA)">A</span>';
          else if ((teams.B || []).indexOf(p) !== -1) teamTag = ' <span style="color:var(--teamB)">B</span>';
        }
        var row = document.createElement("div");
        row.className = "vote-result-row";
        row.innerHTML = "<span>" + esc(p) + teamTag + "</span>" +
          '<span class="' + (v ? (right ? "v-ok" : "v-bad") : "") + '">' + label + (v ? (right ? " ✓" : " ✗") : "") + "</span>";
        votesEl.appendChild(row);
      });
    }

    renderScores(data);
    window.lvl3.playSound(data.playMode === "teams" || !data.votes ? "round-start" :
      (data.votes[username] === data.answer ? "correct" : "wrong"));
    showScreen("reveal");
  }

  // ── Game end ──────────────────────────────────────────────────
  function showGameEnd(data) {
    stopTimer();
    var kick = $("end-kicker");
    var winnerEl = $("end-winner-name");
    var sub = $("end-sub");
    if (data.tie) {
      if (kick) kick.textContent = "Unentschieden";
      if (winnerEl) winnerEl.textContent = "Gleichstand!";
      if (sub) sub.textContent = "niemand gewinnt — Revanche?";
    } else {
      if (kick) kick.textContent = "Gewinner";
      if (winnerEl) winnerEl.textContent = data.winner || "—";
      if (sub) sub.textContent = "gewinnt das Spiel";
    }

    var scoresEl = $("end-final-scores");
    if (scoresEl) {
      scoresEl.innerHTML = (data.scores || []).map(function (row, i) {
        var medal = ["1.", "2.", "3."][i] || (i + 1) + ".";
        return '<div class="final-score-row">' +
          '<span><span style="min-width:24px;display:inline-block">' + medal + "</span>" + esc(row.player) + "</span>" +
          '<span style="font-weight:700;color:var(--acc)">' + row.score + " / " + data.totalRounds + "</span>" +
          "</div>";
      }).join("");
    }

    var btnAgain = $("btn-play-again");
    if (btnAgain) btnAgain.classList.toggle("hidden", !isHost);
    showScreen("end");
  }

  function esc(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

}());
