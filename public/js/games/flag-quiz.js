(function () {
  "use strict";

  var username = null;
  var roomCode = null;
  var isHost = false;
  var players = [];
  var host = "";
  var settings = { difficulty: "normal", pointsToWin: 10, answerMode: "type" };
  var timerInterval = null;
  var timerLeft = 0;
  var timerTotal = 1;
  var inputLocked = false;
  var currentAnswerMode = "type";
  var currentAvatars = {};

  var socket = window.lvl3.socket;

  // ── Screen switcher ───────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = document.getElementById("screen-" + name);
    if (el) el.classList.add("active");
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
    socket.emit("room:create", { gameType: "flag-quiz" });
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
    emitSettings();
  };

  window.startGame = function () {
    socket.emit("flag-quiz:start");
  };

  window.leaveRoom = function () {
    stopTimer();
    socket.emit("room:leave");
    roomCode = null;
    showScreen("join");
  };

  window.playAgain = function () {
    socket.emit("flag-quiz:restart");
  };

  // Enter key on join code
  var joinInput = document.getElementById("join-code-input");
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
    var err = document.getElementById("join-error");
    if (err) err.textContent = data.message || "Fehler";
  });

  socket.on("room:players", function (data) {
    players = data.players; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    renderPlayers();
  });

  socket.on("room:host-changed", function (data) {
    host = data.host; players = data.players; isHost = (host === username);
    if (data.avatars) currentAvatars = data.avatars;
    renderPlayers(); updateHostUI();
  });

  socket.on("room:settings-updated", function (data) {
    settings = data;
    applySettingsToUI();
  });

  function enterLobby() {
    var codeEl = document.getElementById("room-code-display");
    if (codeEl) codeEl.textContent = roomCode;
    renderPlayers(); updateHostUI(); applySettingsToUI();
    showScreen("lobby");
  }

  function renderPlayers() {
    var list = document.getElementById("player-list");
    var scoreMap = {};
    players.forEach(function (p) { scoreMap[p] = 0; });
    window.lvl3.renderPlayerList(list, players, host, {}, currentAvatars);
  }

  function updateHostUI() {
    var btnStart = document.getElementById("btn-start");
    var panel    = document.getElementById("host-settings");
    var guest    = document.getElementById("guest-settings");
    if (isHost) {
      if (btnStart) { btnStart.classList.remove("hidden"); btnStart.disabled = players.length < 1; }
      if (panel) panel.style.display = "";
      if (guest) guest.style.display = "none";
    } else {
      if (btnStart) btnStart.classList.add("hidden");
      if (panel) panel.style.display = "none";
      if (guest) guest.style.display = "";
    }
  }

  function applySettingsToUI() {
    var selDiff = document.getElementById("sel-difficulty");
    var inpPts  = document.getElementById("inp-points");
    var selMode = document.getElementById("sel-answer-mode");
    if (selDiff) selDiff.value = settings.difficulty || "normal";
    if (inpPts)  inpPts.value  = settings.pointsToWin || 10;
    if (selMode) selMode.value  = settings.answerMode || "type";
  }

  function emitSettings() {
    if (!isHost) return;
    var selDiff = document.getElementById("sel-difficulty");
    var inpPts  = document.getElementById("inp-points");
    var selMode = document.getElementById("sel-answer-mode");
    var pts = Math.min(1000, Math.max(1, parseInt((inpPts && inpPts.value) || 10, 10)));
    socket.emit("room:settings", {
      difficulty:  selDiff ? selDiff.value : "normal",
      pointsToWin: pts,
      answerMode:  selMode ? selMode.value : "type"
    });
  }

  // ── Game state ────────────────────────────────────────────────
  socket.on("game:state", function (msg) {
    var phase = msg.phase;
    var data  = msg.data || {};

    if (phase === "lobby") { stopTimer(); isHost = (host === username); enterLobby(); return; }

    if (phase === "countdown") {
      showScreen("countdown");
      var num = document.getElementById("countdown-num");
      if (num) {
        num.textContent = data.count;
        num.style.animation = "none"; void num.offsetWidth; num.style.animation = "";
      }
      window.lvl3.playSound("game-start");
      return;
    }

    if (phase === "question")     { showQuestion(data); return; }
    if (phase === "answer-reveal"){ showReveal(data);   return; }
    if (phase === "game-end")     { showGameEnd(data);  return; }
  });

  // ── Question ──────────────────────────────────────────────────
  function showQuestion(data) {
    stopTimer();
    inputLocked = false;
    currentAnswerMode = data.answerMode || "type";

    var prog = document.getElementById("q-progress");
    if (prog) prog.textContent = "Frage " + data.questionNumber + " / " + data.totalQuestions;

    var img = document.getElementById("flag-img");
    if (img) { img.src = data.flag.imageUrl; img.alt = "Flagge"; }

    var regionLabel = document.getElementById("flag-region-label");
    if (regionLabel) regionLabel.textContent = (data.flag.type === "state" && data.flag.region) ? data.flag.region : "";

    var typeArea = document.getElementById("answer-area-type");
    var mcArea   = document.getElementById("answer-area-mc");

    if (currentAnswerMode === "mc") {
      if (typeArea) typeArea.classList.add("hidden");
      if (mcArea)   mcArea.classList.remove("hidden");
      renderMcOptions(data.options || []);
    } else {
      if (typeArea) typeArea.classList.remove("hidden");
      if (mcArea)   mcArea.classList.add("hidden");
      var inp = document.getElementById("answer-input");
      var feedback = document.getElementById("answer-feedback");
      if (inp)      { inp.value = ""; inp.disabled = false; inp.focus(); }
      if (feedback) { feedback.textContent = ""; feedback.style.color = ""; }
      var btn = document.getElementById("btn-submit");
      if (btn) btn.disabled = false;
    }

    var scoreMap = data.scores || {};
    window.lvl3.renderPlayerList(
      document.getElementById("player-list"),
      Object.keys(scoreMap), host, scoreMap, currentAvatars
    );

    timerLeft = data.timeLeft || 15;
    timerTotal = timerLeft;
    updateTimerUI(timerLeft);
    startTimer();

    window.lvl3.playSound("round-start");
    showScreen("question");
  }

  function renderMcOptions(options) {
    var grid = document.getElementById("mc-options");
    if (!grid) return;
    grid.innerHTML = "";
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.className = "option-btn";
      btn.textContent = opt.text;
      btn.addEventListener("click", function () {
        if (inputLocked) return;
        inputLocked = true;
        grid.querySelectorAll(".option-btn").forEach(function (b) { b.disabled = true; });
        socket.emit("flag-quiz:answer", { answer: opt.text });
      });
      grid.appendChild(btn);
    });
  }

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
    var disp = document.getElementById("timer-display");
    var bar  = document.getElementById("timer-bar");
    if (disp) {
      disp.textContent = t;
      disp.classList.toggle("warning", t <= 5);
    }
    if (bar) {
      bar.style.width = Math.max(0, (t / timerTotal) * 100) + "%";
      bar.style.background = t <= 5 ? "var(--red)" : "var(--accent3)";
    }
  }

  // ── Answer submission ──────────────────────────────────────────
  var btnSubmit = document.getElementById("btn-submit");
  var ansInput  = document.getElementById("answer-input");
  if (btnSubmit) btnSubmit.addEventListener("click", submitAnswer);
  if (ansInput)  ansInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submitAnswer(); });

  function submitAnswer() {
    if (inputLocked) return;
    var inp = document.getElementById("answer-input");
    var answer = inp ? inp.value.trim() : "";
    if (!answer) return;
    inputLocked = true;
    if (inp) inp.disabled = true;
    var btn = document.getElementById("btn-submit");
    if (btn) btn.disabled = true;
    socket.emit("flag-quiz:answer", { answer: answer });
  }

  // ── Answer feedback ───────────────────────────────────────────
  socket.on("flag-quiz:wrong", function () {
    if (currentAnswerMode === "mc") { window.lvl3.playSound("wrong"); return; }
    inputLocked = false;
    var inp      = document.getElementById("answer-input");
    var feedback = document.getElementById("answer-feedback");
    var btn      = document.getElementById("btn-submit");
    if (inp) { inp.disabled = false; inp.value = ""; inp.focus(); }
    if (btn) btn.disabled = false;
    if (feedback) { feedback.textContent = "Falsch! Versuch es nochmal."; feedback.style.color = "var(--red)"; }
    window.lvl3.playSound("wrong");
    if (inp) {
      inp.classList.add("wrong-flash");
      setTimeout(function () { inp.classList.remove("wrong-flash"); }, 400);
    }
  });

  socket.on("flag-quiz:correct", function (data) {
    var feedback = document.getElementById("answer-feedback");
    if (feedback && currentAnswerMode === "type") {
      feedback.textContent = "✓ +" + data.points + " Punkte!";
      feedback.style.color = "var(--green)";
    }
    window.lvl3.playSound("correct");
    if (data.scores) {
      window.lvl3.renderPlayerList(
        document.getElementById("player-list"),
        Object.keys(data.scores), host, data.scores, currentAvatars
      );
    }
  });

  socket.on("flag-quiz:player-correct", function (data) {
    if (data.scores) {
      window.lvl3.renderPlayerList(
        document.getElementById("player-list"),
        Object.keys(data.scores), host, data.scores, currentAvatars
      );
    }
  });

  // ── Reveal ────────────────────────────────────────────────────
  function showReveal(data) {
    stopTimer();
    var img = document.getElementById("reveal-flag-img");
    if (img) img.src = data.flagImageUrl || "";

    var ans = document.getElementById("reveal-answer");
    if (ans) ans.textContent = data.correctName || "";

    var reg = document.getElementById("reveal-region");
    if (reg) reg.textContent = data.region || "";

    var winMsg = document.getElementById("reveal-winner-msg");
    if (winMsg) {
      var winners = data.winners || [];
      if (winners.length > 0) {
        if (winners.includes(username)) {
          winMsg.innerHTML = '<span style="color:var(--green);font-weight:700">Du hast es gewusst!</span>';
          window.lvl3.playSound("correct");
        } else {
          winMsg.innerHTML = '<span style="color:var(--gold)">' + esc(winners[0]) +
            (winners.length > 1 ? " u.a." : "") + " hat es gewusst!</span>";
        }
      } else {
        winMsg.innerHTML = '<span style="color:var(--text-dim)">Niemand hat es gewusst.</span>';
      }
    }

    var scoreMap = data.scores || {};
    var sorted = Object.keys(scoreMap).sort(function (a, b) { return scoreMap[b] - scoreMap[a]; });
    window.lvl3.renderPlayerList(document.getElementById("reveal-player-list"), sorted, host, scoreMap, currentAvatars);

    showScreen("reveal");
  }

  // ── Game end ──────────────────────────────────────────────────
  function showGameEnd(data) {
    stopTimer();
    var winnerEl = document.getElementById("end-winner-name");
    if (winnerEl) winnerEl.textContent = data.winner || "—";

    var scoresEl = document.getElementById("end-final-scores");
    if (scoresEl) {
      scoresEl.innerHTML = (data.scores || []).map(function (row, i) {
        var medal = ["1.","2.","3."][i] || (i + 1) + ".";
        return '<div class="final-score-row' + (i === 0 ? " first-place" : "") + '">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:16px;min-width:24px">' + medal + '</span>' +
          '<div class="player-avatar" style="width:28px;height:28px;font-size:11px;background:' + window.lvl3.avatarColor(row.player) + '">' + window.lvl3.avatarInitial(row.player) + '</div>' +
          '<span style="font-weight:700">' + esc(row.player) + '</span>' +
          '</div>' +
          '<span style="font-weight:900;font-size:18px;color:var(--gold)">' + row.score + '</span>' +
          '</div>';
      }).join("");
    }

    var btnAgain = document.getElementById("btn-play-again");
    if (btnAgain) btnAgain.classList.toggle("hidden", !isHost);
    showScreen("end");
  }

  function esc(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

}());
