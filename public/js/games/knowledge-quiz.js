(function () {
  "use strict";

  var socket = window.lvl3.socket;
  var username = null;
  var roomCode = null;
  var isHost = false;
  var currentSettings = { difficulty: "normal", mode: "mc", pointsToWin: 10 };
  var currentScores = {};
  var currentPlayers = [];
  var currentHost = null;
  var currentAvatars = {};
  var timerInterval = null;
  var timerSeconds = 0;
  var hasAnswered = false;

  // ── Screen switcher ───────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = document.getElementById("screen-" + name);
    if (el) el.classList.add("active");
  }

  // ── DOM refs ──────────────────────────────────────────────────
  var elRoomCode       = document.getElementById("room-code-display");
  var elPlayerList     = document.getElementById("player-list");
  var elSettingsPanel  = document.getElementById("settings-panel");
  var elSettingsRO     = document.getElementById("settings-readonly");
  var elBtnStart       = document.getElementById("btn-start");
  var elWaitingMsg     = document.getElementById("waiting-msg");
  var elCountdownNum   = document.getElementById("countdown-num");
  var elTimerBar       = document.getElementById("timer-bar");
  var elTimerDisplay   = document.getElementById("timer-display");
  var elRoundIndicator = document.getElementById("round-indicator");
  var elCategoryLabel  = document.getElementById("category-label");
  var elRevealBanner   = document.getElementById("reveal-banner");
  var elQuestionText   = document.getElementById("question-text");
  var elOptionsGrid    = document.getElementById("options-grid");
  var elAnswerRow      = document.getElementById("answer-row");
  var elAnswerInput    = document.getElementById("answer-input");
  var elBtnSubmit      = document.getElementById("btn-submit");
  var elTypingHint     = document.getElementById("typing-hint");
  var elWaitingAnswers = document.getElementById("waiting-answers");
  var elWinnerName     = document.getElementById("winner-name");
  var elFinalScores    = document.getElementById("final-scores");
  var selDifficulty    = document.getElementById("sel-difficulty");
  var selMode          = document.getElementById("sel-mode");
  var selPoints        = document.getElementById("inp-points");

  // ── Helpers ───────────────────────────────────────────────────
  function updatePlayerList() {
    window.lvl3.renderPlayerList(elPlayerList, currentPlayers, currentHost, currentScores, currentAvatars);
  }

  function clearTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function startTimer(seconds) {
    clearTimer();
    timerSeconds = seconds;
    var timerMax = seconds;
    function tick() {
      var pct = (timerSeconds / timerMax) * 100;
      if (elTimerBar) {
        elTimerBar.style.width = pct + "%";
        elTimerBar.style.background = timerSeconds <= 5 ? "var(--red)" : "var(--accent3)";
      }
      if (elTimerDisplay) {
        elTimerDisplay.textContent = timerSeconds;
        elTimerDisplay.classList.toggle("warning", timerSeconds <= 5);
      }
      if (timerSeconds <= 0) { clearTimer(); return; }
      timerSeconds--;
    }
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function renderHostControls() {
    if (isHost) {
      if (elSettingsPanel) elSettingsPanel.classList.remove("hidden");
      if (elSettingsRO)    elSettingsRO.classList.add("hidden");
      if (elBtnStart)      { elBtnStart.style.display = ""; elBtnStart.disabled = currentPlayers.length < 1; }
      if (elWaitingMsg)    elWaitingMsg.textContent = currentPlayers.length < 1 ? "Warte auf Spieler…" : "";
    } else {
      if (elSettingsPanel) elSettingsPanel.classList.add("hidden");
      if (elSettingsRO)    elSettingsRO.classList.remove("hidden");
      if (elBtnStart)      elBtnStart.style.display = "none";
      if (elWaitingMsg)    elWaitingMsg.textContent = "Warte auf den Host…";
    }
  }

  function applySettings(s) {
    if (!s) return;
    if (selDifficulty && s.difficulty)  selDifficulty.value  = s.difficulty;
    if (selMode       && s.mode)        selMode.value        = s.mode;
    if (selPoints     && s.pointsToWin) selPoints.value      = s.pointsToWin;
    currentSettings = Object.assign(currentSettings, s);
  }

  function afterJoin(data) {
    roomCode       = data.code;
    isHost         = data.isHost;
    currentHost    = data.host;
    currentPlayers = data.players || [];
    if (data.avatars) currentAvatars = data.avatars;
    if (elRoomCode) elRoomCode.textContent = roomCode;
    applySettings(data.settings);
    renderHostControls();
    updatePlayerList();
    showScreen("lobby");
  }

  // ── Auth ──────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = document.getElementById("user-avatar");
    var nm = document.getElementById("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;
    socket.emit("auth", { username: username });
  });

  // ── Global actions ────────────────────────────────────────────
  window.createRoom = function () {
    socket.emit("room:create", { gameType: "knowledge-quiz" });
  };

  window.joinRoom = function () {
    var inp = document.getElementById("join-code-input");
    var err = document.getElementById("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };

  window.pushSettings = function () {
    if (!isHost) return;
    var pts = Math.min(1000, Math.max(1, parseInt(selPoints && selPoints.value, 10) || 10));
    socket.emit("room:settings", {
      difficulty:  selDifficulty ? selDifficulty.value : "normal",
      mode:        selMode       ? selMode.value       : "mc",
      pointsToWin: pts
    });
  };

  window.startGame = function () {
    if (!isHost) return;
    socket.emit("game:start");
  };

  window.leaveRoom = function () {
    clearTimer();
    socket.emit("room:leave");
    roomCode = null;
    currentScores = {};
    showScreen("join");
  };

  window.playAgain = function () {
    currentScores = {};
    updatePlayerList();
    renderHostControls();
    showScreen("lobby");
  };

  var joinInput = document.getElementById("join-code-input");
  if (joinInput) joinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  // ── Room events ───────────────────────────────────────────────
  socket.on("room:created", function (data) { afterJoin(data); });
  socket.on("room:joined",  function (data) { afterJoin(data); });

  socket.on("room:error", function (data) {
    var err = document.getElementById("join-error");
    if (err) err.textContent = data.message || "Fehler";
  });

  socket.on("room:players", function (data) {
    currentPlayers = data.players || [];
    currentHost    = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    isHost = currentHost === username;
    renderHostControls();
    updatePlayerList();
  });

  socket.on("room:host-changed", function (data) {
    currentPlayers = data.players || [];
    currentHost    = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    isHost = currentHost === username;
    renderHostControls();
    updatePlayerList();
  });

  socket.on("room:settings", function (data) {
    applySettings(data.settings || data);
  });

  // ── Game state ────────────────────────────────────────────────
  socket.on("game:state", function () {
    var msg = arguments[0];
    var d = (msg && msg.data) ? msg.data : {};
    var phase = msg && msg.phase;

    if (phase === "countdown") {
      showScreen("countdown");
      var n = d.count !== undefined ? d.count : 0;
      if (elCountdownNum) {
        elCountdownNum.textContent = (n === 0 || n === "GO") ? "GO!" : n;
        elCountdownNum.style.animation = "none"; void elCountdownNum.offsetWidth; elCountdownNum.style.animation = "";
      }
      clearTimer();
      return;
    }

    if (phase === "question")      { showQuestion(d); return; }
    if (phase === "answer-reveal") { showReveal(d); return; }
    if (phase === "timeout")       { showReveal(d); return; }
    if (phase === "game-end")      { showEnd(d); return; }

    if (phase === "lobby") {
      isHost = currentHost === username;
      renderHostControls();
      updatePlayerList();
      showScreen("lobby");
      return;
    }
  });

  // ── Question ──────────────────────────────────────────────────
  function showQuestion(data) {
    showScreen("question");
    hasAnswered = false;

    if (data.scores) currentScores = data.scores;
    updatePlayerList();

    var timeLimit = data.timeLimit || 15;
    var qNum = (data.index !== undefined) ? (data.index + 1) : "";
    var qTotal = data.total ? "/" + data.total : "";
    if (elRoundIndicator) elRoundIndicator.textContent = "Frage " + qNum + qTotal;
    if (elCategoryLabel)  { elCategoryLabel.textContent = data.category || ""; elCategoryLabel.classList.toggle("hidden", !data.category); }
    if (elRevealBanner)   elRevealBanner.classList.add("hidden");
    if (elQuestionText)   { elQuestionText.textContent = data.question || ""; elQuestionText.style.display = "block"; }
    if (elWaitingAnswers) elWaitingAnswers.style.display = "none";

    startTimer(timeLimit);

    var mode = data.mode || currentSettings.mode || "mc";

    if (mode === "mc") {
      if (elOptionsGrid) elOptionsGrid.classList.remove("hidden");
      if (elAnswerRow)   elAnswerRow.classList.add("hidden");
      if (elTypingHint)  elTypingHint.classList.add("hidden");

      var opts = data.options || [];
      for (var i = 0; i < 4; i++) {
        var btn = document.getElementById("opt-" + i);
        if (!btn) continue;
        btn.className = "option-btn";
        btn.disabled = false;
        var textEl = btn.querySelector(".option-text");
        if (textEl) textEl.textContent = opts[i] || "";
        (function (optText, optBtn) {
          optBtn.onclick = function () {
            if (hasAnswered) return;
            hasAnswered = true;
            optBtn.classList.add("selected");
            document.querySelectorAll("#options-grid .option-btn").forEach(function (b) { b.disabled = true; });
            if (elWaitingAnswers) { elWaitingAnswers.style.display = "block"; elWaitingAnswers.textContent = "Warte auf andere Spieler…"; }
            socket.emit("game:answer", { answer: optText });
          };
        }(opts[i], btn));
      }
    } else {
      if (elOptionsGrid) elOptionsGrid.classList.add("hidden");
      if (elAnswerRow)   elAnswerRow.classList.remove("hidden");
      if (elTypingHint)  elTypingHint.classList.remove("hidden");
      if (elAnswerInput) { elAnswerInput.value = ""; elAnswerInput.disabled = false; elAnswerInput.focus(); }
      if (elBtnSubmit)   elBtnSubmit.disabled = false;
    }

    window.lvl3.playSound("round-start");
  }

  // ── Typing submit ─────────────────────────────────────────────
  if (elBtnSubmit)   elBtnSubmit.addEventListener("click", submitTyping);
  if (elAnswerInput) elAnswerInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submitTyping(); });

  function submitTyping() {
    if (hasAnswered) return;
    var answer = elAnswerInput ? elAnswerInput.value.trim() : "";
    if (!answer) return;
    hasAnswered = true;
    if (elAnswerInput) elAnswerInput.disabled = true;
    if (elBtnSubmit)   elBtnSubmit.disabled = true;
    socket.emit("game:answer", { answer: answer });
  }

  socket.on("game:correct", function (data) {
    if (data.scores) currentScores = data.scores;
    updatePlayerList();
    window.lvl3.playSound(data.winner === username ? "correct" : "round-start");
  });

  socket.on("game:wrong", function () {
    if ((currentSettings.mode || "mc") !== "typing") return;
    hasAnswered = false;
    if (elAnswerInput) {
      elAnswerInput.disabled = false;
      elAnswerInput.classList.add("wrong-flash");
      setTimeout(function () { elAnswerInput.classList.remove("wrong-flash"); }, 400);
    }
    if (elBtnSubmit) elBtnSubmit.disabled = false;
    window.lvl3.playSound("wrong");
  });

  // ── Reveal ────────────────────────────────────────────────────
  function showReveal(data) {
    clearTimer();
    if (data.scores) currentScores = data.scores;
    updatePlayerList();

    if (elOptionsGrid) {
      document.querySelectorAll("#options-grid .option-btn").forEach(function (btn) {
        btn.disabled = true;
        var textEl = btn.querySelector(".option-text");
        var text   = textEl ? textEl.textContent : "";
        if (text === data.correctAnswer) btn.classList.add("correct");
        else if (btn.classList.contains("selected")) btn.classList.add("wrong");
      });
    }

    if (elRevealBanner) {
      elRevealBanner.classList.remove("hidden", "nobody");
      // MC mode sends a pointsAwarded map (no single "winner"); typing mode may send winner.
      var awarded = data.pointsAwarded || {};
      var winners = Object.keys(awarded);
      var myPts = awarded[username];
      if (myPts !== undefined && myPts !== null) {
        elRevealBanner.textContent = "Richtig! +" + myPts + " Punkte";
      } else if (data.winner === username) {
        elRevealBanner.textContent = "Richtig! +" + (data.points || "") + " Punkte";
      } else if (winners.length > 0) {
        elRevealBanner.textContent = winners[0] + " hat es gewusst! (" + data.correctAnswer + ")";
      } else if (data.winner) {
        elRevealBanner.textContent = data.winner + " hat es gewusst! (" + data.correctAnswer + ")";
      } else {
        elRevealBanner.classList.add("nobody");
        elRevealBanner.textContent = "Niemand wusste es. Richtig: " + data.correctAnswer;
      }
    }

    if (elTimerBar) elTimerBar.style.width = "0%";
  }

  // ── End ───────────────────────────────────────────────────────
  function showEnd(data) {
    clearTimer();
    if (elWinnerName) elWinnerName.textContent = data.winner || "—";
    if (elFinalScores) {
      elFinalScores.innerHTML = "";
      (data.sorted || []).forEach(function (entry, idx) {
        var row = document.createElement("div");
        row.className = "final-score-row" + (idx === 0 ? " first-place" : "");
        row.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:18px;min-width:28px">' + (["1.","2.","3."][idx] || (idx + 1) + ".") + '</span>' +
            '<div class="player-avatar" style="width:28px;height:28px;font-size:11px;background:' + window.lvl3.avatarColor(entry.name) + '">' + window.lvl3.avatarInitial(entry.name) + '</div>' +
            '<span style="font-weight:600">' + entry.name + '</span>' +
          '</div>' +
          '<span class="player-score">' + entry.score + '</span>';
        elFinalScores.appendChild(row);
      });
    }
    showScreen("end");
  }

}());
