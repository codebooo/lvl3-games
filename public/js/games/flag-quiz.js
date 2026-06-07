(function () {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────────
  var username = null;
  var roomCode = null;
  var isHost = false;
  var players = [];
  var host = "";
  var settings = { difficulty: "normal", pointsToWin: 10 };
  var timerInterval = null;
  var timerLeft = 0;
  var timerTotal = 1;
  var inputLocked = false;

  var socket = window.lvl3.socket;

  // ─── Section helpers ──────────────────────────────────────────────────────────
  function showSection(id) {
    document.querySelectorAll(".section").forEach(function (s) {
      s.classList.remove("active");
    });
    var el = document.getElementById(id);
    if (el) el.classList.add("active");
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = document.getElementById("user-avatar");
    var nm = document.getElementById("user-name");
    if (av) {
      av.style.background = window.lvl3.avatarColor(username);
      av.textContent = window.lvl3.avatarInitial(username);
    }
    if (nm) nm.textContent = username;
    socket.emit("auth", { username: username });
    showSection("section-entry");
  });

  // ─── Entry buttons ────────────────────────────────────────────────────────────
  document.getElementById("btn-create").addEventListener("click", function () {
    socket.emit("room:create", { gameType: "flag-quiz" });
  });

  document.getElementById("btn-join").addEventListener("click", doJoin);
  document.getElementById("inp-join-code").addEventListener("keydown", function (e) {
    if (e.key === "Enter") doJoin();
  });

  function doJoin() {
    var code = document.getElementById("inp-join-code").value.toUpperCase().trim();
    if (!code) return;
    socket.emit("room:join", { code: code });
  }

  // ─── Room events ──────────────────────────────────────────────────────────────
  socket.on("room:created", function (data) {
    roomCode = data.code;
    isHost = true;
    players = data.players;
    host = data.host;
    settings = data.settings || settings;
    enterLobby();
  });

  socket.on("room:joined", function (data) {
    roomCode = data.code;
    isHost = data.isHost;
    players = data.players;
    host = data.host;
    settings = data.settings || settings;
    enterLobby();
  });

  socket.on("room:error", function (data) {
    var err = document.getElementById("join-error");
    if (err) {
      err.textContent = data.message;
      err.style.display = "block";
    }
  });

  socket.on("room:players", function (data) {
    players = data.players;
    host = data.host;
    renderLobbyPlayers();
  });

  socket.on("room:host-changed", function (data) {
    host = data.host;
    players = data.players;
    isHost = (host === username);
    renderLobbyPlayers();
    updateHostUI();
  });

  socket.on("room:settings-updated", function (data) {
    settings = data;
    if (!isHost) {
      document.getElementById("sel-difficulty").value = data.difficulty || "normal";
      document.getElementById("sel-points").value = String(data.pointsToWin || 10);
    }
  });

  // ─── Lobby ────────────────────────────────────────────────────────────────────
  function enterLobby() {
    document.getElementById("lobby-code").textContent = roomCode;
    renderLobbyPlayers();
    updateHostUI();
    applySettingsToUI();
    showSection("section-lobby");
  }

  function renderLobbyPlayers() {
    var list = document.getElementById("lobby-player-list");
    var count = document.getElementById("lobby-player-count");
    if (count) count.textContent = "(" + players.length + "/8)";
    window.lvl3.renderPlayerList(list, players, host, {});
  }

  function updateHostUI() {
    var btnStart = document.getElementById("btn-start");
    var waitMsg = document.getElementById("waiting-msg");
    var panel = document.getElementById("settings-panel");
    if (isHost) {
      btnStart.classList.remove("hidden");
      waitMsg.classList.add("hidden");
      panel.classList.remove("disabled");
    } else {
      btnStart.classList.add("hidden");
      waitMsg.classList.remove("hidden");
      panel.classList.add("disabled");
    }
  }

  function applySettingsToUI() {
    document.getElementById("sel-difficulty").value = settings.difficulty || "normal";
    document.getElementById("sel-points").value = String(settings.pointsToWin || 10);
  }

  // Settings change listeners (host only)
  document.getElementById("sel-difficulty").addEventListener("change", function () {
    if (!isHost) return;
    settings.difficulty = this.value;
    socket.emit("room:settings", { difficulty: this.value, pointsToWin: settings.pointsToWin });
  });

  document.getElementById("sel-points").addEventListener("change", function () {
    if (!isHost) return;
    settings.pointsToWin = parseInt(this.value, 10);
    socket.emit("room:settings", { difficulty: settings.difficulty, pointsToWin: settings.pointsToWin });
  });

  document.getElementById("btn-start").addEventListener("click", function () {
    socket.emit("flag-quiz:start");
  });

  // ─── Game State Machine ───────────────────────────────────────────────────────
  socket.on("game:state", function (msg) {
    var phase = msg.phase;
    var data = msg.data || {};

    if (phase === "lobby") {
      isHost = (host === username);
      enterLobby();
      return;
    }

    if (phase === "countdown") {
      showSection("section-countdown");
      document.getElementById("countdown-number").textContent = data.count;
      window.lvl3.playSound("game-start");
      return;
    }

    if (phase === "question") {
      showQuestion(data);
      return;
    }

    if (phase === "answer-reveal") {
      showReveal(data);
      return;
    }

    if (phase === "game-end") {
      showGameEnd(data);
      return;
    }
  });

  // ─── Question phase ───────────────────────────────────────────────────────────
  function showQuestion(data) {
    stopTimer();
    inputLocked = false;

    // Progress label
    var prog = document.getElementById("q-progress");
    if (prog) prog.textContent = "Frage " + data.questionNumber + " / " + data.totalQuestions;

    // Flag image
    var img = document.getElementById("flag-img");
    if (img) {
      img.src = data.flag.imageUrl;
      img.alt = "Flagge";
    }

    // Region/type label
    var regionLabel = document.getElementById("flag-region-label");
    if (regionLabel) {
      if (data.flag.type === "state") {
        regionLabel.textContent = data.flag.region || "";
      } else {
        regionLabel.textContent = "";
      }
    }

    // Reset answer area
    var inp = document.getElementById("answer-input");
    var feedback = document.getElementById("answer-feedback");
    if (inp) { inp.value = ""; inp.disabled = false; inp.focus(); }
    if (feedback) { feedback.textContent = ""; feedback.style.color = ""; }
    document.getElementById("btn-submit").disabled = false;
    document.getElementById("answer-area").style.opacity = "1";

    // Scores sidebar
    var scoreMap = data.scores || {};
    window.lvl3.renderPlayerList(
      document.getElementById("game-player-list"),
      Object.keys(scoreMap),
      host,
      scoreMap
    );

    // Timer
    timerLeft = data.timeLeft || 15;
    timerTotal = timerLeft;
    updateTimerUI(timerLeft);
    startTimer();

    window.lvl3.playSound("round-start");
    showSection("section-game");
  }

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
    var disp = document.getElementById("timer-display");
    var bar = document.getElementById("timer-bar");
    if (disp) {
      disp.textContent = t;
      if (t <= 5) {
        disp.classList.add("warning");
      } else {
        disp.classList.remove("warning");
      }
    }
    if (bar) {
      var pct = Math.max(0, (t / timerTotal) * 100);
      bar.style.width = pct + "%";
      bar.style.background = t <= 5 ? "var(--red)" : "var(--accent3)";
    }
  }

  // ─── Answer submission ────────────────────────────────────────────────────────
  document.getElementById("btn-submit").addEventListener("click", submitAnswer);
  document.getElementById("answer-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitAnswer();
  });

  function submitAnswer() {
    if (inputLocked) return;
    var inp = document.getElementById("answer-input");
    var answer = inp.value.trim();
    if (!answer) return;
    inputLocked = true;
    inp.disabled = true;
    document.getElementById("btn-submit").disabled = true;
    socket.emit("flag-quiz:answer", { answer: answer });
  }

  // Wrong answer feedback — allow retrying
  socket.on("flag-quiz:wrong", function () {
    inputLocked = false;
    var inp = document.getElementById("answer-input");
    var feedback = document.getElementById("answer-feedback");
    if (inp) { inp.disabled = false; inp.value = ""; inp.focus(); }
    document.getElementById("btn-submit").disabled = false;
    if (feedback) {
      feedback.textContent = "Falsch! Versuch es nochmal.";
      feedback.style.color = "var(--red)";
    }
    window.lvl3.playSound("wrong");
    // flash the input
    inp.classList.add("wrong-flash");
    setTimeout(function () { inp.classList.remove("wrong-flash"); }, 400);
  });

  // ─── Reveal phase ─────────────────────────────────────────────────────────────
  function showReveal(data) {
    stopTimer();

    var img = document.getElementById("reveal-flag-img");
    if (img) img.src = data.flagImageUrl || "";

    var ans = document.getElementById("reveal-answer");
    if (ans) {
      ans.textContent = data.correctName || "";
      ans.classList.add("correct-flash");
      setTimeout(function () { ans.classList.remove("correct-flash"); }, 600);
    }

    var reg = document.getElementById("reveal-region");
    if (reg) reg.textContent = data.region ? data.region : "";

    var winMsg = document.getElementById("reveal-winner-msg");
    if (winMsg) {
      if (data.winner) {
        if (data.winner === username) {
          winMsg.innerHTML = '<span style="color:var(--green);font-weight:700">Du hast es gewusst! +1 Punkt</span>';
          window.lvl3.playSound("correct");
        } else {
          winMsg.innerHTML = '<span style="color:var(--gold)">' + esc(data.winner) + ' hat es gewusst!</span>';
        }
      } else {
        winMsg.innerHTML = '<span style="color:var(--text-dim)">Niemand hat es gewusst.</span>';
      }
    }

    var scoreMap = data.scores || {};
    window.lvl3.renderPlayerList(
      document.getElementById("reveal-player-list"),
      Object.keys(scoreMap).sort(function (a, b) { return scoreMap[b] - scoreMap[a]; }),
      host,
      scoreMap
    );

    showSection("section-reveal");
  }

  // ─── Game end ─────────────────────────────────────────────────────────────────
  function showGameEnd(data) {
    stopTimer();

    var winnerName = document.getElementById("end-winner-name");
    if (winnerName) winnerName.textContent = data.winner || "—";

    var scoresEl = document.getElementById("end-final-scores");
    if (scoresEl) {
      scoresEl.innerHTML = (data.scores || []).map(function (row, i) {
        return '<div class="final-score-row' + (i === 0 ? " first-place" : "") + '">' +
          '<div class="flex items-center gap-2">' +
          '<div class="player-avatar" style="width:30px;height:30px;font-size:12px;background:' + window.lvl3.avatarColor(row.player) + '">' +
          window.lvl3.avatarInitial(row.player) +
          '</div>' +
          '<span style="font-weight:600">' + esc(row.player) + (i === 0 ? ' <span style="color:var(--gold)">👑</span>' : "") + '</span>' +
          '</div>' +
          '<span style="font-weight:700;font-size:18px;color:var(--gold)">' + row.score + '</span>' +
          '</div>';
      }).join("");
    }

    // Only host can restart
    var btnAgain = document.getElementById("btn-play-again");
    if (btnAgain) {
      if (isHost) {
        btnAgain.classList.remove("hidden");
      } else {
        btnAgain.classList.add("hidden");
      }
    }

    showSection("section-end");
  }

  document.getElementById("btn-play-again").addEventListener("click", function () {
    socket.emit("flag-quiz:restart");
  });

  // ─── Leave room ───────────────────────────────────────────────────────────────
  window.leaveRoom = function () {
    stopTimer();
    socket.emit("room:leave");
    roomCode = null;
    showSection("section-entry");
  };

  // ─── Utility ──────────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

})();
