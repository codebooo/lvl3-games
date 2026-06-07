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

  var socket = window.lvl3.socket;

  function showSection(id) {
    document.querySelectorAll(".section").forEach(function (s) { s.classList.remove("active"); });
    var el = document.getElementById(id);
    if (el) el.classList.add("active");
  }

  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = document.getElementById("user-avatar");
    var nm = document.getElementById("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;
    socket.emit("auth", { username: username });
    showSection("section-entry");
  });

  document.getElementById("btn-create").addEventListener("click", function () {
    socket.emit("room:create", { gameType: "flag-quiz" });
  });

  document.getElementById("btn-join").addEventListener("click", doJoin);
  document.getElementById("inp-join-code").addEventListener("keydown", function (e) { if (e.key === "Enter") doJoin(); });

  function doJoin() {
    var code = document.getElementById("inp-join-code").value.toUpperCase().trim();
    if (!code) return;
    socket.emit("room:join", { code: code });
  }

  socket.on("room:created", function (data) {
    roomCode = data.code; isHost = true; players = data.players; host = data.host;
    settings = data.settings || settings;
    enterLobby();
  });

  socket.on("room:joined", function (data) {
    roomCode = data.code; isHost = data.isHost; players = data.players; host = data.host;
    settings = data.settings || settings;
    enterLobby();
  });

  socket.on("room:error", function (data) {
    var err = document.getElementById("join-error");
    if (err) { err.textContent = data.message; err.style.display = "block"; }
  });

  socket.on("room:players", function (data) {
    players = data.players; host = data.host;
    renderLobbyPlayers();
  });

  socket.on("room:host-changed", function (data) {
    host = data.host; players = data.players; isHost = (host === username);
    renderLobbyPlayers(); updateHostUI();
  });

  socket.on("room:settings-updated", function (data) {
    settings = data;
    applySettingsToUI();
  });

  function enterLobby() {
    document.getElementById("lobby-code").textContent = roomCode;
    renderLobbyPlayers(); updateHostUI(); applySettingsToUI();
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
      btnStart.classList.remove("hidden"); waitMsg.classList.add("hidden");
      panel.classList.remove("disabled");
    } else {
      btnStart.classList.add("hidden"); waitMsg.classList.remove("hidden");
      panel.classList.add("disabled");
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

  ["sel-difficulty", "sel-answer-mode"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("change", emitSettings);
  });
  var inpPts = document.getElementById("inp-points");
  if (inpPts) { inpPts.addEventListener("change", emitSettings); inpPts.addEventListener("input", emitSettings); }

  document.getElementById("btn-start").addEventListener("click", function () {
    socket.emit("flag-quiz:start");
  });

  // ─── Game state ───────────────────────────────────────────────
  socket.on("game:state", function (msg) {
    var phase = msg.phase;
    var data = msg.data || {};

    if (phase === "lobby") { isHost = (host === username); enterLobby(); return; }

    if (phase === "countdown") {
      showSection("section-countdown");
      var num = document.getElementById("countdown-number");
      if (num) { num.textContent = data.count; num.style.animation = "none"; void num.offsetWidth; num.style.animation = "countPop 0.7s ease"; }
      window.lvl3.playSound("game-start");
      return;
    }

    if (phase === "question") { showQuestion(data); return; }
    if (phase === "answer-reveal") { showReveal(data); return; }
    if (phase === "game-end") { showGameEnd(data); return; }
  });

  // ─── Question ────────────────────────────────────────────────
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
      if (inp) { inp.value = ""; inp.disabled = false; inp.focus(); }
      if (feedback) { feedback.textContent = ""; feedback.style.color = ""; }
      document.getElementById("btn-submit").disabled = false;
    }

    var scoreMap = data.scores || {};
    window.lvl3.renderPlayerList(document.getElementById("game-player-list"), Object.keys(scoreMap), host, scoreMap);

    timerLeft = data.timeLeft || 15;
    timerTotal = timerLeft;
    updateTimerUI(timerLeft);
    startTimer();

    window.lvl3.playSound("round-start");
    showSection("section-game");
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
      var pct = Math.max(0, (t / timerTotal) * 100);
      bar.style.width = pct + "%";
      bar.style.background = t <= 5 ? "var(--red)" : "var(--accent3)";
    }
  }

  document.getElementById("btn-submit").addEventListener("click", submitAnswer);
  document.getElementById("answer-input").addEventListener("keydown", function (e) { if (e.key === "Enter") submitAnswer(); });

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

  socket.on("flag-quiz:wrong", function () {
    if (currentAnswerMode === "mc") {
      // Already locked in MC — highlight wrong option if visible
      window.lvl3.playSound("wrong");
      return;
    }
    inputLocked = false;
    var inp = document.getElementById("answer-input");
    var feedback = document.getElementById("answer-feedback");
    if (inp) { inp.disabled = false; inp.value = ""; inp.focus(); }
    document.getElementById("btn-submit").disabled = false;
    if (feedback) { feedback.textContent = "Falsch! Versuch es nochmal."; feedback.style.color = "var(--red)"; }
    window.lvl3.playSound("wrong");
    if (inp) {
      inp.classList.add("wrong-flash");
      setTimeout(function () { inp.classList.remove("wrong-flash"); }, 400);
    }
  });

  socket.on("flag-quiz:correct", function (data) {
    // Personal feedback
    var feedback = document.getElementById("answer-feedback");
    if (feedback && currentAnswerMode === "type") {
      feedback.textContent = "✓ +" + data.points + " Punkte!";
      feedback.style.color = "var(--green)";
    }
    window.lvl3.playSound("correct");
    if (data.scores) {
      window.lvl3.renderPlayerList(document.getElementById("game-player-list"), Object.keys(data.scores), host, data.scores);
    }
  });

  socket.on("flag-quiz:player-correct", function (data) {
    if (data.scores) {
      window.lvl3.renderPlayerList(document.getElementById("game-player-list"), Object.keys(data.scores), host, data.scores);
    }
  });

  // ─── Reveal ──────────────────────────────────────────────────
  function showReveal(data) {
    stopTimer();

    var img = document.getElementById("reveal-flag-img");
    if (img) img.src = data.flagImageUrl || "";

    var ans = document.getElementById("reveal-answer");
    if (ans) { ans.textContent = data.correctName || ""; ans.classList.add("correct-flash"); setTimeout(function () { ans.classList.remove("correct-flash"); }, 600); }

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
          winMsg.innerHTML = '<span style="color:var(--gold)">' + esc(winners[0]) + (winners.length > 1 ? " u.a." : "") + " hat es gewusst!</span>";
        }
      } else {
        winMsg.innerHTML = '<span style="color:var(--text-dim)">Niemand hat es gewusst.</span>';
      }
    }

    var scoreMap = data.scores || {};
    var sorted = Object.keys(scoreMap).sort(function (a, b) { return scoreMap[b] - scoreMap[a]; });
    window.lvl3.renderPlayerList(document.getElementById("reveal-player-list"), sorted, host, scoreMap);

    showSection("section-reveal");
  }

  // ─── Game end ─────────────────────────────────────────────────
  function showGameEnd(data) {
    stopTimer();
    var winnerName = document.getElementById("end-winner-name");
    if (winnerName) winnerName.textContent = data.winner || "—";

    var scoresEl = document.getElementById("end-final-scores");
    if (scoresEl) {
      scoresEl.innerHTML = (data.scores || []).map(function (row, i) {
        var medal = ["🥇","🥈","🥉"][i] || (i + 1) + ".";
        return '<div class="final-score-row' + (i === 0 ? " first-place" : "") + '">' +
          '<div class="flex items-center gap-2">' +
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
    showSection("section-end");
  }

  document.getElementById("btn-play-again").addEventListener("click", function () {
    socket.emit("flag-quiz:restart");
  });

  window.leaveRoom = function () {
    stopTimer();
    socket.emit("room:leave");
    roomCode = null;
    showSection("section-entry");
  };

  function esc(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

}());
