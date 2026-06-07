(function () {
  "use strict";

  var socket = window.lvl3.socket;
  var me = null;
  var isHost = false;
  var currentRoom = null;
  var currentSettings = { difficulty: "easy", pointsToWin: 10 };
  var currentSong = null;
  var audio = null;
  var timerInterval = null;
  var timerSecondsLeft = 15;
  var pendingPreviewUrl = null;
  var audioUnlocked = false;

  // ── Screen switcher ───────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = document.getElementById("screen-" + name);
    if (el) el.classList.add("active");
  }

  // ── Auth ───────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    me = d.username;
    var av = document.getElementById("user-avatar");
    var nm = document.getElementById("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(me); av.textContent = window.lvl3.avatarInitial(me); }
    if (nm) nm.textContent = me;
    socket.emit("auth", { username: me });
  });

  // ── Settings helpers ───────────────────────────────────────────
  function applySettings(settings) {
    currentSettings = Object.assign(currentSettings, settings);
    document.querySelectorAll(".diff-btn[data-diff]").forEach(function (btn) {
      btn.classList.remove("active-easy", "active-normal", "active-hard");
      if (btn.dataset.diff === currentSettings.difficulty) {
        btn.classList.add("active-" + currentSettings.difficulty);
      }
    });
    var inpPts = document.getElementById("inp-points");
    if (inpPts && document.activeElement !== inpPts) {
      inpPts.value = currentSettings.pointsToWin || 10;
    }
  }

  function updateHostUI() {
    var hostSettings = document.getElementById("host-settings");
    var guestSettings = document.getElementById("guest-settings");
    var btnStart = document.getElementById("btn-start");
    if (hostSettings) hostSettings.style.display = isHost ? "" : "none";
    if (guestSettings) guestSettings.style.display = isHost ? "none" : "";
    if (btnStart) { btnStart.disabled = !isHost; }
  }

  // ── Global actions ─────────────────────────────────────────────
  window.createRoom = function () {
    socket.emit("room:create", { gameType: "song-guesser" });
  };

  window.joinRoom = function () {
    var inp = document.getElementById("join-code-input");
    var err = document.getElementById("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (code.length !== 4) { if (err) err.textContent = "4-stelligen Code eingeben"; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };

  window.setDifficulty = function (diff) {
    if (!isHost) return;
    currentSettings.difficulty = diff;
    applySettings(currentSettings);
    socket.emit("game:settings", { difficulty: diff });
  };

  window.setPoints = function () {
    if (!isHost) return;
    var inp = document.getElementById("inp-points");
    var pts = Math.min(1000, Math.max(1, parseInt(inp && inp.value, 10) || 10));
    currentSettings.pointsToWin = pts;
    socket.emit("game:settings", { pointsToWin: pts });
  };

  window.startGame = function () {
    if (!isHost) return;
    socket.emit("game:start");
  };

  window.leaveRoom = function () {
    stopAudio();
    stopTimer();
    socket.emit("room:leave");
    currentRoom = null;
    showScreen("join");
  };

  window.replayGame = function () {
    socket.emit("game:replay");
  };

  window.submitAnswer = function () {
    var inp = document.getElementById("answer-input");
    var val = (inp ? inp.value : "").trim();
    if (!val) return;
    socket.emit("game:answer", { answer: val });
    if (inp) inp.value = "";
  };

  window.unlockAudio = function () {
    hideAutoplayOverlay();
    audioUnlocked = true;
    if (pendingPreviewUrl) {
      playPreview(pendingPreviewUrl);
      pendingPreviewUrl = null;
    }
  };

  // Enter key on join + answer
  var joinInput = document.getElementById("join-code-input");
  if (joinInput) joinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  var answerInput = document.getElementById("answer-input");
  if (answerInput) answerInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.submitAnswer(); });

  // ── Audio ──────────────────────────────────────────────────────
  function stopAudio() {
    if (audio) { audio.pause(); audio.src = ""; audio = null; }
    stopTimer();
    setWaveformPlaying(false);
  }

  function playPreview(previewUrl) {
    stopAudio();
    audio = new Audio(previewUrl);
    audio.volume = 0.85;

    audio.ontimeupdate = function () {
      if (audio && audio.currentTime >= 10) {
        audio.pause();
        stopTimer();
        setWaveformPlaying(false);
        setSongStatus(false);
      }
    };

    audio.onended = function () { setWaveformPlaying(false); setSongStatus(false); stopTimer(); };
    audio.onerror = function () { setWaveformPlaying(false); setSongStatus(false); };

    var playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(function () {
        audioUnlocked = true;
        setWaveformPlaying(true);
        setSongStatus(true);
        hideAutoplayOverlay();
      }).catch(function () {
        pendingPreviewUrl = previewUrl;
        showAutoplayOverlay();
      });
    }
  }

  function showAutoplayOverlay() {
    var o = document.getElementById("autoplay-overlay");
    if (o) o.classList.remove("hidden");
  }
  function hideAutoplayOverlay() {
    var o = document.getElementById("autoplay-overlay");
    if (o) o.classList.add("hidden");
  }
  function setWaveformPlaying(playing) {
    var wf = document.getElementById("waveform");
    if (wf) { if (playing) wf.classList.add("playing"); else wf.classList.remove("playing"); }
  }
  function setSongStatus(playing) {
    var el = document.getElementById("song-status");
    if (el) el.style.display = playing ? "flex" : "none";
  }

  // ── Timer ──────────────────────────────────────────────────────
  function startTimer(seconds) {
    stopTimer();
    timerSecondsLeft = seconds;
    updateTimerDisplay(seconds, seconds);
    timerInterval = setInterval(function () {
      timerSecondsLeft--;
      updateTimerDisplay(timerSecondsLeft, seconds);
      if (timerSecondsLeft <= 0) stopTimer();
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function updateTimerDisplay(left, total) {
    var bar   = document.getElementById("timer-bar");
    var label = document.getElementById("timer-label");
    if (bar) {
      var pct = Math.max(0, (left / total) * 100);
      bar.style.width = pct + "%";
      bar.classList.toggle("urgent", left <= 5);
    }
    if (label) label.textContent = Math.max(0, left) + "s";
  }

  // ── Scoreboard ─────────────────────────────────────────────────
  function renderScoreboard(scores) {
    var list = document.getElementById("player-list");
    if (!list) return;
    var entries = Object.entries(scores).sort(function (a, b) { return b[1] - a[1]; });
    list.innerHTML = entries.map(function (e) {
      return '<li class="player-item' + (e[0] === me ? " is-host" : "") + '">' +
        '<div class="player-avatar" style="background:' + window.lvl3.avatarColor(e[0]) + '">' + window.lvl3.avatarInitial(e[0]) + '</div>' +
        '<span class="player-name">' + e[0] + '</span>' +
        '<span class="player-score">' + e[1] + '</span>' +
        '</li>';
    }).join("");
  }

  // ── Question phase ─────────────────────────────────────────────
  function showQuestion(data) {
    currentSong = data.song;
    showScreen("game");

    var rc = document.getElementById("round-counter");
    if (rc) rc.textContent = "Runde " + data.song.index + " / " + data.song.total;

    var albumArt  = document.getElementById("album-art");
    var revealBox = document.getElementById("reveal-box");
    var wf        = document.getElementById("waveform");
    if (albumArt)  albumArt.classList.remove("visible");
    if (revealBox) revealBox.classList.add("hidden");
    if (wf)        wf.style.display = "flex";

    var inp         = document.getElementById("answer-input");
    var answerWrap  = document.getElementById("answer-wrap");
    if (inp)        { inp.disabled = false; inp.value = ""; inp.focus(); }
    if (answerWrap) answerWrap.style.opacity = "1";

    if (data.scores) renderScoreboard(data.scores);
    startTimer(data.timeLimit || 15);
    playPreview(data.song.previewUrl);
  }

  // ── Reveal phase ───────────────────────────────────────────────
  function showReveal(data) {
    stopAudio();
    stopTimer();

    var wf = document.getElementById("waveform");
    if (wf) wf.style.display = "none";
    setSongStatus(false);

    var albumArt = document.getElementById("album-art");
    if (albumArt && data.albumArt) { albumArt.src = data.albumArt; albumArt.classList.add("visible"); }

    var rb = document.getElementById("reveal-box");
    var rt = document.getElementById("reveal-title");
    var ra = document.getElementById("reveal-artist");
    var rw = document.getElementById("reveal-winner");
    if (rb) rb.classList.remove("hidden");
    if (rt && data.correctAnswer) rt.textContent = data.correctAnswer.title;
    if (ra && data.correctAnswer) ra.textContent = data.correctAnswer.artist;
    if (rw) {
      if (data.winner) {
        rw.className = "reveal-winner correct";
        rw.textContent = data.winner === me ? "Du hast es erraten! +" + (data.points || 1) + " Punkt" : data.winner + " hat es erraten!";
        window.lvl3.playSound(data.winner === me ? "correct" : "round-start");
      } else {
        rw.className = "reveal-winner timeout";
        rw.textContent = "Niemand hat es erraten.";
        window.lvl3.playSound("wrong");
      }
    }

    var inp        = document.getElementById("answer-input");
    var answerWrap = document.getElementById("answer-wrap");
    if (inp)        inp.disabled = true;
    if (answerWrap) answerWrap.style.opacity = "0.4";

    if (data.scores) renderScoreboard(data.scores);
  }

  // ── Game end ───────────────────────────────────────────────────
  function showGameEnd(data) {
    stopAudio();
    stopTimer();
    showScreen("end");

    var title      = document.getElementById("end-title");
    var subtitle   = document.getElementById("end-subtitle");
    var finalScores = document.getElementById("final-scores");
    var btnReplay  = document.getElementById("btn-replay");

    if (data.winners && data.winners.length > 0) {
      var winnerStr = data.winners.join(" & ");
      if (title)    title.textContent    = data.winners.includes(me) ? "Du gewinnst! 🎉" : winnerStr + " gewinnt!";
      if (subtitle) subtitle.textContent = winnerStr + " mit " + data.topScore + " Punkten";
    }

    if (finalScores && data.scores) {
      var entries = Object.entries(data.scores).sort(function (a, b) { return b[1] - a[1]; });
      var medals  = ["🥇","🥈","🥉"];
      finalScores.innerHTML = entries.map(function (e, i) {
        return '<div class="final-score-row">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:18px;min-width:24px">' + (medals[i] || (i + 1) + ".") + '</span>' +
            '<div class="player-avatar" style="width:28px;height:28px;font-size:11px;background:' + window.lvl3.avatarColor(e[0]) + '">' + window.lvl3.avatarInitial(e[0]) + '</div>' +
            '<span style="font-weight:600">' + e[0] + '</span>' +
          '</div>' +
          '<span class="player-score">' + e[1] + '</span>' +
          '</div>';
      }).join("");
    }

    if (btnReplay) btnReplay.classList.toggle("hidden", !isHost);
  }

  // ── Socket events ──────────────────────────────────────────────
  socket.on("room:created", function (data) {
    currentRoom = data.code;
    isHost = true;
    applySettings(data.settings || {});
    var rcd = document.getElementById("room-code-display");
    if (rcd) rcd.textContent = data.code;
    if (data.players) window.lvl3.renderPlayerList(document.getElementById("player-list"), data.players, data.host, {});
    updateHostUI();
    showScreen("lobby");
  });

  socket.on("room:joined", function (data) {
    currentRoom = data.code;
    isHost = data.isHost;
    applySettings(data.settings || {});
    var rcd = document.getElementById("room-code-display");
    if (rcd) rcd.textContent = data.code;
    if (data.players) window.lvl3.renderPlayerList(document.getElementById("player-list"), data.players, data.host, {});
    updateHostUI();
    showScreen("lobby");
  });

  socket.on("room:players", function (data) {
    window.lvl3.renderPlayerList(document.getElementById("player-list"), data.players, data.host, {});
  });

  socket.on("room:host-changed", function (data) {
    isHost = data.host === me;
    window.lvl3.renderPlayerList(document.getElementById("player-list"), data.players, data.host, {});
    updateHostUI();
  });

  socket.on("room:settings", function (settings) { applySettings(settings); });
  socket.on("room:error",    function (data) {
    var err = document.getElementById("join-error");
    if (err) err.textContent = data.message || "Fehler";
  });
  socket.on("game:error",    function (data) { window.lvl3.showToast(data.message, "error"); });

  socket.on("game:state", function (data) {
    switch (data.phase) {
      case "lobby":
        showScreen("lobby");
        applySettings(currentSettings);
        break;

      case "countdown":
        showScreen("countdown");
        var num = document.getElementById("countdown-num");
        if (num) {
          num.textContent = data.countdown;
          num.style.animation = "none"; void num.offsetWidth; num.style.animation = "";
        }
        window.lvl3.playSound("tick");
        break;

      case "question":
        window.lvl3.playSound("game-start");
        showQuestion(data);
        break;

      case "answer-reveal":
        showReveal(data);
        break;

      case "game-end":
        showGameEnd(data);
        break;
    }
  });

  socket.on("game:wrong", function () {
    var inp = document.getElementById("answer-input");
    if (inp) { inp.classList.add("shake"); setTimeout(function () { inp.classList.remove("shake"); }, 350); }
    window.lvl3.playSound("wrong");
  });

}());
