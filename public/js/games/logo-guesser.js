(function () {
  "use strict";

  // ── State ────────────────────────────────────────────────────
  var socket = window.lvl3.socket;
  var myUsername = null;
  var isHost = false;
  var roomCode = null;
  var players = [];
  var host = null;
  var currentScores = {};
  var timerInterval = null;
  var timerSeconds = 0;
  var timerMax = 15;
  var answerSubmitted = false;
  var currentPhase = null;

  // ── DOM refs ─────────────────────────────────────────────────
  var sections = {};
  document.querySelectorAll("[data-section]").forEach(function (el) {
    sections[el.dataset.section] = el;
  });

  function showSection(name) {
    Object.keys(sections).forEach(function (k) {
      sections[k].classList.toggle("active", k === name);
    });
  }

  var elUserAvatar    = document.getElementById("user-avatar");
  var elUserName      = document.getElementById("user-name");

  // Lobby
  var elLobbyPre      = document.getElementById("lobby-pre");
  var elLobbyRoom     = document.getElementById("lobby-room");
  var elRoomCode      = document.getElementById("room-code-display");
  var elLobbyPlayers  = document.getElementById("lobby-player-list");
  var elInputCode     = document.getElementById("input-code");
  var elBtnCreate     = document.getElementById("btn-create");
  var elBtnJoin       = document.getElementById("btn-join");
  var elLobbyError    = document.getElementById("lobby-error");

  // Settings (host)
  var elSettingsPanel = document.getElementById("settings-panel");
  var elSettingsGuest = document.getElementById("settings-guest");
  var elSelectDiff    = document.getElementById("select-difficulty");
  var elInputPoints   = document.getElementById("input-points");
  var elBtnStart      = document.getElementById("btn-start");
  var elGuestDiff     = document.getElementById("guest-difficulty");
  var elGuestPoints   = document.getElementById("guest-points");

  // Game
  var elRoundInfo     = document.getElementById("round-info");
  var elLogoImg       = document.getElementById("logo-img");
  var elAnswerInput   = document.getElementById("answer-input");
  var elBtnSubmit     = document.getElementById("btn-submit-answer");
  var elCorrectBanner = document.getElementById("correct-banner");
  var elTimerNumber   = document.getElementById("timer-number");
  var elTimerBar      = document.getElementById("timer-bar");
  var elGamePlayers   = document.getElementById("game-player-list");

  // Countdown overlay
  var elCountdownOverlay = document.getElementById("countdown-overlay");
  var elCountdownNumber  = document.getElementById("countdown-number");

  // Game-end
  var elEndWinner     = document.getElementById("end-winner-name");
  var elEndScores     = document.getElementById("end-scores");
  var elBtnNewGame    = document.getElementById("btn-new-game");

  // ── Helpers ──────────────────────────────────────────────────
  function showLobbyError(msg) {
    elLobbyError.textContent = msg;
    elLobbyError.classList.add("visible");
    setTimeout(function () { elLobbyError.classList.remove("visible"); }, 3500);
  }

  function setAnswerEnabled(enabled) {
    elAnswerInput.disabled  = !enabled;
    elBtnSubmit.disabled    = !enabled;
    if (enabled) {
      elAnswerInput.value = "";
      elAnswerInput.focus();
    }
  }

  function clearTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function startTimer(seconds) {
    clearTimer();
    timerSeconds = seconds;
    timerMax = seconds;

    function tick() {
      var pct = (timerSeconds / timerMax) * 100;
      elTimerBar.style.width = pct + "%";
      elTimerBar.style.background = timerSeconds <= 5 ? "var(--red)" : "var(--accent3)";
      elTimerNumber.textContent = timerSeconds;
      elTimerNumber.classList.toggle("warning", timerSeconds <= 5);

      if (timerSeconds <= 0) {
        clearTimer();
        return;
      }
      timerSeconds--;
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function updateGamePlayerList() {
    window.lvl3.renderPlayerList(elGamePlayers, players, host, currentScores);
  }

  function updateLobbyPlayerList() {
    window.lvl3.renderPlayerList(elLobbyPlayers, players, host, {});
  }

  function showCountdown(count) {
    elCountdownOverlay.classList.remove("hidden");
    if (count === "GO" || count === 0) {
      elCountdownNumber.textContent = "GO!";
      elCountdownNumber.style.color = "var(--green)";
      setTimeout(function () {
        elCountdownOverlay.classList.add("hidden");
        elCountdownNumber.style.color = "var(--accent)";
      }, 700);
    } else {
      elCountdownNumber.textContent = count;
      elCountdownNumber.style.color = "var(--accent)";
      // Re-trigger animation
      elCountdownNumber.style.animation = "none";
      void elCountdownNumber.offsetWidth;
      elCountdownNumber.style.animation = "countPop 0.6s ease";
    }
  }

  function applySettings(settings) {
    if (!settings) return;
    elSelectDiff.value   = settings.difficulty || "normal";
    elInputPoints.value  = settings.pointsToWin || 10;
    // Guest display
    var diffLabels = { easy: "Easy", normal: "Normal", hard: "Hard" };
    elGuestDiff.textContent   = diffLabels[settings.difficulty] || "Normal";
    elGuestPoints.textContent = settings.pointsToWin || 10;
  }

  function renderHostControls() {
    if (isHost) {
      elSettingsPanel.classList.remove("hidden");
      elSettingsGuest.classList.add("hidden");
      // Enable start button when 2+ players
      elBtnStart.disabled = players.length < 2;
    } else {
      elSettingsPanel.classList.add("hidden");
      elSettingsGuest.classList.remove("hidden");
    }
  }

  function afterJoin(data) {
    roomCode = data.code;
    isHost   = data.isHost;
    host     = data.host;
    players  = data.players || [];

    elLobbyPre.classList.add("hidden");
    elLobbyRoom.classList.remove("hidden");
    elRoomCode.textContent = roomCode;

    applySettings(data.settings);
    renderHostControls();
    updateLobbyPlayerList();
  }

  // ── Auth & connect ───────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    myUsername = d.username;

    if (elUserAvatar) {
      elUserAvatar.style.background = window.lvl3.avatarColor(myUsername);
      elUserAvatar.textContent = window.lvl3.avatarInitial(myUsername);
    }
    if (elUserName) elUserName.textContent = myUsername;

    socket.emit("auth", { username: myUsername });
  });

  // ── Lobby actions ────────────────────────────────────────────
  elBtnCreate.addEventListener("click", function () {
    if (!myUsername) return;
    socket.emit("room:create", { gameType: "logo-guesser" });
  });

  elBtnJoin.addEventListener("click", function () {
    var code = elInputCode.value.trim().toUpperCase();
    if (!code) { showLobbyError("Bitte Raum-Code eingeben."); return; }
    socket.emit("room:join", { code: code });
  });

  elInputCode.addEventListener("keydown", function (e) {
    if (e.key === "Enter") elBtnJoin.click();
  });

  // Host: settings change → emit to server
  function emitSettings() {
    if (!isHost) return;
    socket.emit("game:settings", {
      difficulty:   elSelectDiff.value,
      pointsToWin:  parseInt(elInputPoints.value, 10) || 10
    });
  }

  elSelectDiff.addEventListener("change",  emitSettings);
  elInputPoints.addEventListener("change", emitSettings);
  elInputPoints.addEventListener("input",  emitSettings);

  elBtnStart.addEventListener("click", function () {
    if (!isHost) return;
    socket.emit("game:start");
  });

  // ── Answer submission ────────────────────────────────────────
  function submitAnswer() {
    if (answerSubmitted) return;
    var answer = elAnswerInput.value.trim();
    if (!answer) return;
    answerSubmitted = true;
    setAnswerEnabled(false);
    socket.emit("game:answer", { answer: answer });
  }

  elBtnSubmit.addEventListener("click", submitAnswer);
  elAnswerInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitAnswer();
  });

  // ── New game ─────────────────────────────────────────────────
  elBtnNewGame.addEventListener("click", function () {
    // Return to lobby section; host can restart
    currentScores = {};
    showSection("lobby");
    // Re-render lobby state
    if (roomCode) {
      elLobbyPre.classList.add("hidden");
      elLobbyRoom.classList.remove("hidden");
      renderHostControls();
      updateLobbyPlayerList();
    }
  });

  // ── Socket events ────────────────────────────────────────────

  socket.on("room:created", function (data) {
    afterJoin(data);
  });

  socket.on("room:joined", function (data) {
    afterJoin(data);
  });

  socket.on("room:players", function (data) {
    players = data.players || [];
    host    = data.host;
    isHost  = host === myUsername;
    renderHostControls();
    updateLobbyPlayerList();
    updateGamePlayerList();
  });

  socket.on("room:host-changed", function (data) {
    players = data.players || [];
    host    = data.host;
    isHost  = host === myUsername;
    renderHostControls();
    updateLobbyPlayerList();
    updateGamePlayerList();
    window.lvl3.showToast("Du bist jetzt der Host!", "info", "Host gewechselt");
  });

  socket.on("room:error", function (data) {
    showLobbyError(data.message || "Fehler beim Beitreten.");
  });

  socket.on("room:settings", function (data) {
    applySettings(data.settings);
  });

  // ── game:state ───────────────────────────────────────────────
  socket.on("game:state", function (data) {
    currentPhase = data.phase;

    if (data.phase === "countdown") {
      // Show the game section behind the overlay
      showSection("game");
      showCountdown(data.count);
      window.lvl3.playSound("round-start");
      clearTimer();
      setAnswerEnabled(false);
      elCorrectBanner.className = "correct-banner";
      elCorrectBanner.textContent = "";
    }

    else if (data.phase === "question") {
      // Hide countdown overlay (last count triggers this path after GO)
      elCountdownOverlay.classList.add("hidden");
      showSection("game");

      if (data.scores) currentScores = data.scores;

      answerSubmitted = false;

      // Logo
      elLogoImg.src = data.logo.imageUrl;
      elLogoImg.alt = "Logo";

      // Round info
      elRoundInfo.textContent = "Runde " + data.round;

      // Timer
      startTimer(data.timeLimit);

      // Enable input
      setAnswerEnabled(true);

      // Clear banner
      elCorrectBanner.className = "correct-banner";
      elCorrectBanner.textContent = "";

      // Update scores sidebar
      updateGamePlayerList();

      window.lvl3.playSound("round-start");
    }

    else if (data.phase === "timeout") {
      clearTimer();
      elTimerBar.style.width = "0%";
      elTimerNumber.textContent = "0";
      setAnswerEnabled(false);

      if (data.scores) currentScores = data.scores;
      updateGamePlayerList();

      elCorrectBanner.className = "correct-banner show-timeout";
      elCorrectBanner.textContent = "Zeit abgelaufen! Richtige Antwort: " + data.correctAnswer;
    }
  });

  // ── game:correct ─────────────────────────────────────────────
  socket.on("game:correct", function (data) {
    clearTimer();
    elTimerBar.style.width = "0%";
    setAnswerEnabled(false);

    if (data.scores) currentScores = data.scores;
    updateGamePlayerList();

    var isSelf = data.winner === myUsername;
    window.lvl3.playSound(isSelf ? "correct" : "round-start");

    elCorrectBanner.className = "correct-banner show-correct";
    if (isSelf) {
      elCorrectBanner.textContent = "Richtig! Du hast es gewusst! (" + data.correctAnswer + ")";
    } else {
      elCorrectBanner.textContent = data.winner + " war zuerst! Richtige Antwort: " + data.correctAnswer;
    }
  });

  // ── game:end ─────────────────────────────────────────────────
  socket.on("game:end", function (data) {
    clearTimer();

    window.lvl3.playSound("game-start");

    elEndWinner.textContent = data.winner || "—";

    // Render final scores
    elEndScores.innerHTML = "";
    if (data.scores && data.scores.length) {
      data.scores.forEach(function (entry, idx) {
        var row = document.createElement("div");
        row.className = "final-score-row" + (idx === 0 ? " first-place" : "");
        row.innerHTML =
          '<div class="flex items-center gap-2">' +
            '<span style="font-size:18px;min-width:28px">' + (idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : (idx + 1) + ".") + '</span>' +
            '<div class="player-avatar" style="width:30px;height:30px;font-size:12px;background:' + window.lvl3.avatarColor(entry.username) + '">' + window.lvl3.avatarInitial(entry.username) + '</div>' +
            '<span style="font-weight:600">' + entry.username + '</span>' +
          '</div>' +
          '<span class="player-score">' + entry.score + '</span>';
        elEndScores.appendChild(row);
      });
    }

    showSection("game-end");
  });

})();
