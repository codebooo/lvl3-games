(function () {
  "use strict";

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

  // ── Screen switcher ───────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = document.getElementById("screen-" + name);
    if (el) el.classList.add("active");
  }

  // ── DOM refs ──────────────────────────────────────────────────
  var elUserAvatar     = document.getElementById("user-avatar");
  var elUserName       = document.getElementById("user-name");
  var elRoomCode       = document.getElementById("room-code-display");
  var elPlayerList     = document.getElementById("player-list");
  var elJoinInput      = document.getElementById("join-code-input");
  var elJoinError      = document.getElementById("join-error");
  var elHostSettings   = document.getElementById("host-settings");
  var elGuestSettings  = document.getElementById("guest-settings");
  var elSelDiff        = document.getElementById("sel-difficulty");
  var elInpPoints      = document.getElementById("inp-points");
  var elBtnStart       = document.getElementById("btn-start");
  var elGuestDisplay   = document.getElementById("guest-settings-display");
  var elCountdownNum   = document.getElementById("countdown-num");
  var elRoundInfo      = document.getElementById("round-info");
  var elLogoImg        = document.getElementById("logo-img");
  var elAnswerInput    = document.getElementById("answer-input");
  var elBtnSubmit      = document.getElementById("btn-submit");
  var elFeedbackBanner = document.getElementById("feedback-banner");
  var elTimerDisplay   = document.getElementById("timer-display");
  var elTimerBar       = document.getElementById("timer-bar");
  var elWinnerName     = document.getElementById("winner-name");
  var elFinalScores    = document.getElementById("final-scores");

  // ── Helpers ───────────────────────────────────────────────────
  function updatePlayerList() {
    window.lvl3.renderPlayerList(elPlayerList, players, host, currentScores);
  }

  function setAnswerEnabled(enabled) {
    elAnswerInput.disabled = !enabled;
    elBtnSubmit.disabled   = !enabled;
    if (enabled) { elAnswerInput.value = ""; elAnswerInput.focus(); }
  }

  function clearTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function startTimer(seconds) {
    clearTimer();
    timerSeconds = seconds;
    timerMax = seconds;
    function tick() {
      var pct = (timerSeconds / timerMax) * 100;
      if (elTimerBar) {
        elTimerBar.style.width = pct + "%";
        elTimerBar.style.background = timerSeconds <= 5 ? "var(--red)" : "var(--accent)";
      }
      if (elTimerDisplay) elTimerDisplay.textContent = timerSeconds;
      if (timerSeconds <= 0) { clearTimer(); return; }
      timerSeconds--;
    }
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function renderLobbyControls() {
    if (isHost) {
      elHostSettings.style.display = "";
      elGuestSettings.style.display = "none";
      elBtnStart.disabled = players.length < 2;
    } else {
      elHostSettings.style.display = "none";
      elGuestSettings.style.display = "";
    }
  }

  function applySettings(s) {
    if (!s) return;
    if (elSelDiff) elSelDiff.value = s.difficulty || "normal";
    if (elInpPoints) elInpPoints.value = s.pointsToWin || 10;
    var diffLabels = { easy: "Easy", normal: "Normal", hard: "Hard" };
    if (elGuestDisplay) {
      elGuestDisplay.textContent =
        "Schwierigkeit: " + (diffLabels[s.difficulty] || "Normal") +
        " · Punkte zum Sieg: " + (s.pointsToWin || 10);
    }
  }

  function afterJoin(data) {
    roomCode = data.code;
    isHost   = data.isHost;
    host     = data.host;
    players  = data.players || [];
    if (elRoomCode) elRoomCode.textContent = roomCode;
    applySettings(data.settings);
    renderLobbyControls();
    updatePlayerList();
    showScreen("lobby");
  }

  // ── Auth ──────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    myUsername = d.username;
    if (elUserAvatar) {
      elUserAvatar.style.background = window.lvl3.avatarColor(myUsername);
      elUserAvatar.textContent = window.lvl3.avatarInitial(myUsername);
    }
    if (elUserName) elUserName.textContent = myUsername;
    socket.emit("auth", { username: myUsername });
  });

  // ── Global actions ────────────────────────────────────────────
  window.createRoom = function () {
    socket.emit("room:create", { gameType: "logo-guesser" });
  };

  window.joinRoom = function () {
    var code = elJoinInput.value.trim().toUpperCase();
    if (!code) { elJoinError.textContent = "Bitte Code eingeben."; return; }
    elJoinError.textContent = "";
    socket.emit("room:join", { code: code });
  };

  window.pushSettings = function () {
    if (!isHost) return;
    socket.emit("game:settings", {
      difficulty:  elSelDiff.value,
      pointsToWin: Math.min(1000, Math.max(1, parseInt(elInpPoints.value, 10) || 10))
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

  window.backToLobby = function () {
    currentScores = {};
    updatePlayerList();
    renderLobbyControls();
    showScreen("lobby");
  };

  elJoinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  // ── Answer ────────────────────────────────────────────────────
  function submitAnswer() {
    if (answerSubmitted) return;
    var answer = elAnswerInput.value.trim();
    if (!answer) return;
    answerSubmitted = true;
    setAnswerEnabled(false);
    socket.emit("game:answer", { answer: answer });
  }
  elBtnSubmit.addEventListener("click", submitAnswer);
  elAnswerInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submitAnswer(); });

  // ── Socket events ──────────────────────────────────────────────
  socket.on("room:created", function (data) { afterJoin(data); });
  socket.on("room:joined",  function (data) { afterJoin(data); });

  socket.on("room:error", function (data) {
    elJoinError.textContent = data.message || "Fehler";
  });

  socket.on("room:players", function (data) {
    players = data.players || [];
    host    = data.host;
    isHost  = host === myUsername;
    renderLobbyControls();
    updatePlayerList();
  });

  socket.on("room:host-changed", function (data) {
    players = data.players || [];
    host    = data.host;
    isHost  = host === myUsername;
    renderLobbyControls();
    updatePlayerList();
  });

  socket.on("room:settings", function (data) {
    applySettings(data.settings || data);
  });

  socket.on("game:state", function (data) {
    currentPhase = data.phase;

    if (data.phase === "countdown") {
      showScreen("countdown");
      var n = data.count !== undefined ? data.count : data.countdown;
      if (elCountdownNum) {
        elCountdownNum.textContent = (n === 0 || n === "GO") ? "GO!" : n;
        elCountdownNum.style.animation = "none";
        void elCountdownNum.offsetWidth;
        elCountdownNum.style.animation = "";
      }
      clearTimer();
      setAnswerEnabled(false);
      return;
    }

    if (data.phase === "question") {
      showScreen("question");
      if (data.scores) currentScores = data.scores;
      answerSubmitted = false;

      var _fallback = (data.logo && data.logo.fallbackUrl) || "/img/logo-fallback.svg";
      elLogoImg.onerror = function () { elLogoImg.onerror = null; elLogoImg.src = _fallback; };
      elLogoImg.src = (data.logo && data.logo.imageUrl) || "";

      if (elRoundInfo) elRoundInfo.textContent = "Runde " + data.round;
      startTimer(data.timeLimit);
      setAnswerEnabled(true);
      elFeedbackBanner.className = "feedback-banner";
      elFeedbackBanner.textContent = "";
      updatePlayerList();
      window.lvl3.playSound("round-start");
      return;
    }

    if (data.phase === "timeout") {
      clearTimer();
      if (elTimerBar) elTimerBar.style.width = "0%";
      if (elTimerDisplay) elTimerDisplay.textContent = "0";
      setAnswerEnabled(false);
      if (data.scores) currentScores = data.scores;
      updatePlayerList();
      elFeedbackBanner.className = "feedback-banner show-timeout";
      elFeedbackBanner.textContent = "Zeit! Richtig: " + data.correctAnswer;
      return;
    }
  });

  socket.on("game:correct", function (data) {
    if (data.scores) currentScores = data.scores;
    updatePlayerList();
    var isSelf = data.winner === myUsername;
    window.lvl3.playSound(isSelf ? "correct" : "round-start");
    elFeedbackBanner.className = "feedback-banner show-correct";
    if (isSelf) {
      elFeedbackBanner.textContent = "Richtig! +" + (data.points || 1) + " Punkte! (" + data.correctAnswer + ")";
    } else {
      elFeedbackBanner.textContent = data.winner + " war zuerst! (+" + (data.points || 1) + " Punkte)";
    }
  });

  socket.on("game:wrong", function () {
    if (currentPhase !== "question") return;
    answerSubmitted = false;
    setAnswerEnabled(true);
    window.lvl3.playSound("wrong");
    elAnswerInput.classList.add("wrong-flash");
    setTimeout(function () { elAnswerInput.classList.remove("wrong-flash"); }, 400);
  });

  socket.on("game:end", function (data) {
    clearTimer();
    window.lvl3.playSound("game-start");
    if (elWinnerName) elWinnerName.textContent = data.winner || "—";
    if (elFinalScores) {
      elFinalScores.innerHTML = "";
      (data.scores || []).forEach(function (entry, idx) {
        var row = document.createElement("div");
        row.className = "final-score-row" + (idx === 0 ? " first-place" : "");
        row.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:18px;min-width:28px">' + (["1.","2.","3."][idx] || (idx + 1) + ".") + '</span>' +
            '<div class="player-avatar" style="width:28px;height:28px;font-size:11px;background:' + window.lvl3.avatarColor(entry.username) + '">' + window.lvl3.avatarInitial(entry.username) + '</div>' +
            '<span style="font-weight:600">' + entry.username + '</span>' +
          '</div>' +
          '<span class="player-score">' + entry.score + '</span>';
        elFinalScores.appendChild(row);
      });
    }
    showScreen("end");
  });

}());
