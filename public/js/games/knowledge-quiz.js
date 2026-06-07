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
  var timerInterval = null;
  var timerSeconds = 0;
  var hasAnswered = false;
  var currentCorrectAnswer = null;

  // ─── Element refs ────────────────────────────────────────────────────────────
  var sLobby   = document.getElementById("section-lobby");
  var sGame    = document.getElementById("section-game");
  var sEnd     = document.getElementById("section-end");

  var elRoomCode       = document.getElementById("room-code-display");
  var elPlayerLobby    = document.getElementById("player-list-lobby");
  var elPlayerGame     = document.getElementById("player-list-game");
  var elSettingsPanel  = document.getElementById("settings-panel");
  var elSettingsRO     = document.getElementById("settings-readonly");
  var elStartWrap      = document.getElementById("start-wrap");
  var elBtnStart       = document.getElementById("btn-start");
  var elWaitingMsg     = document.getElementById("waiting-msg");

  var elCountdownOverlay = document.getElementById("countdown-overlay");
  var elCountdownNumber  = document.getElementById("countdown-number");
  var elTimerBar         = document.getElementById("timer-bar");
  var elTimerDisplay     = document.getElementById("timer-display");
  var elRoundIndicator   = document.getElementById("round-indicator");
  var elCategoryLabel    = document.getElementById("category-label");
  var elRevealBanner     = document.getElementById("reveal-banner");
  var elQuestionText     = document.getElementById("question-text");
  var elOptionsGrid      = document.getElementById("options-grid");
  var elAnswerRow        = document.getElementById("answer-row");
  var elAnswerInput      = document.getElementById("answer-input");
  var elBtnSubmit        = document.getElementById("btn-submit");
  var elTypingHint       = document.getElementById("typing-hint");
  var elWaitingAnswers   = document.getElementById("waiting-answers");

  var elWinnerName      = document.getElementById("winner-name");
  var elFinalScores     = document.getElementById("final-scores");
  var elBtnPlayAgain    = document.getElementById("btn-play-again");
  var elPointsToWinDisp = document.getElementById("points-to-win-display");

  var selDifficulty = document.getElementById("sel-difficulty");
  var selMode       = document.getElementById("sel-mode");
  var selPoints     = document.getElementById("sel-points");

  var LETTERS = ["A", "B", "C", "D"];

  // ─── Section switcher ────────────────────────────────────────────────────────
  function showSection(name) {
    [sLobby, sGame, sEnd].forEach(function (s) { s.classList.remove("active"); });
    if (name === "lobby") sLobby.classList.add("active");
    if (name === "game")  sGame.classList.add("active");
    if (name === "end")   sEnd.classList.add("active");
  }

  // ─── Auth & init ─────────────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = document.getElementById("user-avatar");
    var nm = document.getElementById("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;

    socket.emit("auth", { username: username });

    // Create or join room
    var params = new URLSearchParams(window.location.search);
    var joinCode = params.get("code");
    if (joinCode) {
      socket.emit("room:join", { code: joinCode });
    } else {
      socket.emit("room:create", { gameType: "knowledge-quiz" });
    }
  });

  // ─── Settings change listeners ───────────────────────────────────────────────
  function emitSettings() {
    socket.emit("game:settings", {
      difficulty: selDifficulty.value,
      mode: selMode.value,
      pointsToWin: selPoints.value
    });
  }

  selDifficulty.addEventListener("change", emitSettings);
  selMode.addEventListener("change", emitSettings);
  selPoints.addEventListener("change", emitSettings);

  // ─── Start button ────────────────────────────────────────────────────────────
  elBtnStart.addEventListener("click", function () {
    socket.emit("game:start");
  });

  // ─── Play again ──────────────────────────────────────────────────────────────
  elBtnPlayAgain.addEventListener("click", function () {
    showSection("lobby");
    resetGameUI();
    if (isHost) {
      elBtnStart.disabled = currentPlayers.length < 1;
    }
  });

  // ─── Answer submission ───────────────────────────────────────────────────────
  function submitAnswer(answer) {
    if (hasAnswered) return;
    hasAnswered = true;
    socket.emit("game:answer", { answer: answer });
  }

  // MC option clicks
  for (var i = 0; i < 4; i++) {
    (function (idx) {
      var btn = document.getElementById("opt-" + idx);
      btn.addEventListener("click", function () {
        if (hasAnswered) return;
        var answer = btn.querySelector(".option-text").textContent;
        markOptionSelected(idx);
        submitAnswer(answer);
      });
    })(i);
  }

  // Typing submit
  elBtnSubmit.addEventListener("click", function () {
    var val = elAnswerInput.value.trim();
    if (!val) return;
    submitAnswer(val);
    elBtnSubmit.disabled = true;
    elAnswerInput.disabled = true;
  });

  elAnswerInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var val = elAnswerInput.value.trim();
      if (!val || hasAnswered) return;
      submitAnswer(val);
      elBtnSubmit.disabled = true;
      elAnswerInput.disabled = true;
    }
  });

  // ─── Room events ─────────────────────────────────────────────────────────────
  socket.on("room:created", function (data) {
    roomCode = data.code;
    isHost = true;
    currentPlayers = data.players;
    currentHost = data.host;
    currentSettings = Object.assign(currentSettings, data.settings);
    elRoomCode.textContent = roomCode;
    renderLobbyPlayers();
    updateHostUI();
    updateStartButton();
  });

  socket.on("room:joined", function (data) {
    roomCode = data.code;
    isHost = data.isHost;
    currentPlayers = data.players;
    currentHost = data.host;
    currentSettings = Object.assign(currentSettings, data.settings);
    elRoomCode.textContent = roomCode;
    applySettingsToUI(data.settings);
    renderLobbyPlayers();
    updateHostUI();
    updateStartButton();
  });

  socket.on("room:players", function (data) {
    currentPlayers = data.players;
    currentHost = data.host;
    isHost = data.host === username;
    renderLobbyPlayers();
    updateHostUI();
    updateStartButton();
  });

  socket.on("room:host-changed", function (data) {
    currentPlayers = data.players;
    currentHost = data.host;
    isHost = data.host === username;
    renderLobbyPlayers();
    updateHostUI();
    updateStartButton();
  });

  socket.on("room:error", function (data) {
    window.lvl3.showToast(data.message || "Fehler", "error", "Fehler");
  });

  socket.on("game:settings-updated", function (settings) {
    currentSettings = Object.assign(currentSettings, settings);
    if (!isHost) applySettingsToUI(settings);
    if (elPointsToWinDisp) elPointsToWinDisp.textContent = settings.pointsToWin || 10;
  });

  // ─── Game state machine ───────────────────────────────────────────────────────
  socket.on("game:state", function (payload) {
    var phase = payload.phase;
    var data  = payload.data || {};

    if (phase === "countdown") {
      handleCountdown(data);
    } else if (phase === "question") {
      handleQuestion(data);
    } else if (phase === "answer-reveal") {
      handleReveal(data);
    } else if (phase === "timeout") {
      handleTimeout(data);
    } else if (phase === "game-end") {
      handleGameEnd(data);
    }
  });

  socket.on("game:correct", function (data) {
    // Typing mode — someone got it right
    stopTimer();
    if (data.winner === username) {
      window.lvl3.playSound("correct");
      elRevealBanner.textContent = "Richtig! +1 Punkt";
      elRevealBanner.className = "kq-correct-banner";
      elRevealBanner.classList.remove("hidden");
    } else {
      elRevealBanner.textContent = data.winner + " war zuerst richtig!";
      elRevealBanner.className = "kq-correct-banner";
      elRevealBanner.classList.remove("hidden");
    }
    // Disable input
    elAnswerInput.disabled = true;
    elBtnSubmit.disabled = true;
    // Update scores
    if (data.scores) {
      currentScores = data.scores;
      renderGamePlayers();
    }
  });

  socket.on("game:wrong", function () {
    // Only shown to the submitter in typing mode
    elAnswerInput.value = "";
    elAnswerInput.disabled = false;
    elBtnSubmit.disabled = false;
    hasAnswered = false;
    window.lvl3.showToast("Falsch — versuch's nochmal!", "error");
    window.lvl3.playSound("wrong");
  });

  // ─── Phase handlers ──────────────────────────────────────────────────────────
  function handleCountdown(data) {
    stopTimer();
    showSection("game");
    elCountdownNumber.textContent = data.count;
    elCountdownOverlay.classList.remove("hidden");
    elQuestionText.style.display = "none";
    elOptionsGrid.classList.add("hidden");
    elAnswerRow.classList.add("hidden");
    elTypingHint.classList.add("hidden");
    elRevealBanner.classList.add("hidden");
    elCategoryLabel.classList.add("hidden");
    elWaitingAnswers.style.display = "none";
    window.lvl3.playSound("game-start");
  }

  function handleQuestion(data) {
    stopTimer();
    resetAnswerState();

    elCountdownOverlay.classList.add("hidden");
    elRevealBanner.classList.add("hidden");
    elWaitingAnswers.style.display = "none";

    currentCorrectAnswer = null; // unknown to client until reveal

    // Category
    if (data.category) {
      elCategoryLabel.textContent = data.category;
      elCategoryLabel.classList.remove("hidden");
    } else {
      elCategoryLabel.classList.add("hidden");
    }

    // Round indicator
    elRoundIndicator.textContent = "Runde " + ((data.index || 0) + 1);

    // Question text
    elQuestionText.textContent = data.question || "";
    elQuestionText.style.display = "block";

    // Mode-specific UI
    if (data.mode === "mc" && data.options) {
      renderMCOptions(data.options);
      elOptionsGrid.classList.remove("hidden");
      elAnswerRow.classList.add("hidden");
      elTypingHint.classList.add("hidden");
    } else {
      elOptionsGrid.classList.add("hidden");
      elAnswerRow.classList.remove("hidden");
      elTypingHint.classList.remove("hidden");
      elAnswerInput.value = "";
      elAnswerInput.disabled = false;
      elBtnSubmit.disabled = false;
      setTimeout(function () { elAnswerInput.focus(); }, 50);
    }

    // Update scores
    if (data.scores) {
      currentScores = data.scores;
      renderGamePlayers();
    }
    if (data.mode) currentSettings.mode = data.mode;
    if (elPointsToWinDisp) elPointsToWinDisp.textContent = currentSettings.pointsToWin || 10;

    // Timer
    startTimer(data.timeLimit || 15);
    window.lvl3.playSound("round-start");
  }

  function handleReveal(data) {
    stopTimer();
    currentCorrectAnswer = data.correctAnswer;

    // Highlight MC options
    if (currentSettings.mode === "mc") {
      highlightMCOptions(data);
    } else {
      // Typing: show correct answer
      elAnswerInput.disabled = true;
      elBtnSubmit.disabled = true;
    }

    // Banner
    var scored = data.pointsAwarded && Object.keys(data.pointsAwarded).length > 0;
    var myPoint = data.pointsAwarded && data.pointsAwarded[username];
    if (myPoint) {
      elRevealBanner.textContent = "Richtig! Die Antwort war: " + data.correctAnswer;
      elRevealBanner.className = "kq-correct-banner";
      window.lvl3.playSound("correct");
    } else if (!scored) {
      elRevealBanner.textContent = "Niemand hatte die richtige Antwort: " + data.correctAnswer;
      elRevealBanner.className = "kq-correct-banner nobody";
      window.lvl3.playSound("wrong");
    } else {
      elRevealBanner.textContent = "Die richtige Antwort war: " + data.correctAnswer;
      elRevealBanner.className = "kq-correct-banner nobody";
    }
    elRevealBanner.classList.remove("hidden");
    elWaitingAnswers.style.display = "none";

    // Update scores with +N animations
    if (data.scores) {
      animateScoreChanges(data.pointsAwarded || {}, currentScores, data.scores);
      currentScores = data.scores;
      renderGamePlayers();
    }
  }

  function handleTimeout(data) {
    stopTimer();
    elRevealBanner.textContent = "Zeit abgelaufen! Richtige Antwort: " + (data.correctAnswer || "?");
    elRevealBanner.className = "kq-correct-banner nobody";
    elRevealBanner.classList.remove("hidden");
    elAnswerInput.disabled = true;
    elBtnSubmit.disabled = true;
    elWaitingAnswers.style.display = "none";
    if (data.scores) {
      currentScores = data.scores;
      renderGamePlayers();
    }
    window.lvl3.playSound("wrong");
  }

  function handleGameEnd(data) {
    stopTimer();
    showSection("end");

    if (data.winner) {
      elWinnerName.textContent = data.winner;
    } else {
      elWinnerName.textContent = "Unentschieden";
    }

    // Final scores
    var sorted = data.sorted || [];
    elFinalScores.innerHTML = sorted.map(function (entry, idx) {
      return '<div class="final-score-row' + (idx === 0 ? " first-place" : "") + '">' +
        '<div class="flex items-center gap-2">' +
          '<div class="player-avatar" style="background:' + window.lvl3.avatarColor(entry.name) + ';width:32px;height:32px;font-size:13px">' + window.lvl3.avatarInitial(entry.name) + '</div>' +
          '<span style="font-weight:600">' + (idx === 0 ? "🥇 " : idx === 1 ? "🥈 " : idx === 2 ? "🥉 " : "") + entry.name + '</span>' +
        '</div>' +
        '<span style="font-weight:700;font-size:20px;color:var(--gold)">' + entry.score + '</span>' +
        '</div>';
    }).join("");

    window.lvl3.playSound("game-start");
  }

  // ─── Timer ────────────────────────────────────────────────────────────────────
  function startTimer(seconds) {
    stopTimer();
    timerSeconds = seconds;
    elTimerDisplay.textContent = timerSeconds;
    elTimerDisplay.classList.remove("warning");
    elTimerBar.style.transition = "none";
    elTimerBar.style.width = "100%";

    // Force reflow so the transition restart works
    void elTimerBar.offsetWidth;
    elTimerBar.style.transition = "width " + seconds + "s linear";
    elTimerBar.style.width = "0%";

    timerInterval = setInterval(function () {
      timerSeconds--;
      elTimerDisplay.textContent = timerSeconds;
      if (timerSeconds <= 5) {
        elTimerDisplay.classList.add("warning");
        window.lvl3.playSound("tick");
      }
      if (timerSeconds <= 0) {
        stopTimer();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ─── MC helpers ───────────────────────────────────────────────────────────────
  function renderMCOptions(options) {
    for (var i = 0; i < 4; i++) {
      var btn = document.getElementById("opt-" + i);
      var textEl = btn.querySelector(".option-text");
      var letterEl = btn.querySelector(".option-letter");
      btn.className = "option-btn";
      btn.disabled = false;
      textEl.textContent = options[i] || "";
      letterEl.textContent = LETTERS[i];
    }
  }

  function markOptionSelected(idx) {
    for (var i = 0; i < 4; i++) {
      var btn = document.getElementById("opt-" + i);
      btn.disabled = true;
      if (i === idx) btn.classList.add("selected");
    }
    // Show "Waiting for others" in MC mode
    elWaitingAnswers.textContent = "Warten auf andere Spieler...";
    elWaitingAnswers.style.display = "block";
  }

  function highlightMCOptions(data) {
    var correct = data.correctAnswer;
    var myAnswer = data.playerAnswers && data.playerAnswers[username];
    for (var i = 0; i < 4; i++) {
      var btn = document.getElementById("opt-" + i);
      var text = btn.querySelector(".option-text").textContent;
      btn.disabled = true;
      btn.classList.remove("selected", "correct", "wrong");
      if (normaliseForCompare(text) === normaliseForCompare(correct)) {
        btn.classList.add("correct");
      } else if (myAnswer && normaliseForCompare(text) === normaliseForCompare(myAnswer) && normaliseForCompare(myAnswer) !== normaliseForCompare(correct)) {
        btn.classList.add("wrong");
      }
    }
  }

  function normaliseForCompare(s) {
    return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  }

  // ─── Score animations ─────────────────────────────────────────────────────────
  function animateScoreChanges(pointsAwarded, oldScores, newScores) {
    Object.keys(pointsAwarded || {}).forEach(function (player) {
      var delta = (newScores[player] || 0) - (oldScores[player] || 0);
      if (delta <= 0) return;
      // Find the player item in the sidebar
      var items = elPlayerGame.querySelectorAll(".player-item");
      items.forEach(function (li) {
        var nameEl = li.querySelector(".player-name");
        if (!nameEl) return;
        var pName = nameEl.textContent.replace(/Host$/, "").trim();
        if (pName === player) {
          var delta_el = document.createElement("span");
          delta_el.className = "score-delta";
          delta_el.textContent = "+" + delta;
          li.style.position = "relative";
          li.appendChild(delta_el);
          setTimeout(function () { delta_el.remove(); }, 1000);
        }
      });
    });
  }

  // ─── Render helpers ───────────────────────────────────────────────────────────
  function renderLobbyPlayers() {
    window.lvl3.renderPlayerList(elPlayerLobby, currentPlayers, currentHost, currentScores);
  }

  function renderGamePlayers() {
    window.lvl3.renderPlayerList(elPlayerGame, currentPlayers, currentHost, currentScores);
  }

  function updateHostUI() {
    if (isHost) {
      elSettingsPanel.classList.remove("hidden");
      elSettingsRO.classList.add("hidden");
      elStartWrap.classList.remove("hidden");
    } else {
      elSettingsPanel.classList.add("hidden");
      elSettingsRO.classList.remove("hidden");
      elStartWrap.classList.add("hidden");
    }
  }

  function updateStartButton() {
    if (!isHost) return;
    var ready = currentPlayers.length >= 1;
    elBtnStart.disabled = !ready;
    elWaitingMsg.textContent = ready ? "" : "Mindestens 1 Spieler erforderlich";
  }

  function applySettingsToUI(settings) {
    if (settings.difficulty) selDifficulty.value = settings.difficulty;
    if (settings.mode) selMode.value = settings.mode;
    if (settings.pointsToWin) selPoints.value = String(settings.pointsToWin);
    if (elPointsToWinDisp) elPointsToWinDisp.textContent = settings.pointsToWin || 10;
  }

  function resetAnswerState() {
    hasAnswered = false;
    currentCorrectAnswer = null;
    elAnswerInput.value = "";
    elAnswerInput.disabled = false;
    elBtnSubmit.disabled = false;
  }

  function resetGameUI() {
    stopTimer();
    elTimerBar.style.width = "100%";
    elTimerDisplay.textContent = "--";
    elTimerDisplay.classList.remove("warning");
    elCountdownOverlay.classList.add("hidden");
    elRevealBanner.classList.add("hidden");
    elOptionsGrid.classList.add("hidden");
    elAnswerRow.classList.add("hidden");
    elTypingHint.classList.add("hidden");
    elWaitingAnswers.style.display = "none";
    elCategoryLabel.classList.add("hidden");
    elQuestionText.style.display = "none";
    currentScores = {};
    hasAnswered = false;
  }

})();
