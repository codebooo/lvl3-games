(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────────────
  var socket = window.lvl3.socket;
  var me = null;
  var isHost = false;
  var currentRoom = null;
  var currentSettings = { difficulty: "easy", pointsToWin: 10 };
  var currentSong = null;   // { previewUrl, albumArt, index, total }
  var audio = null;         // HTMLAudioElement
  var timerInterval = null;
  var timerSecondsLeft = 15;
  var pendingPreviewUrl = null; // used when autoplay was blocked
  var audioUnlocked = false;

  // ── Auth ───────────────────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    me = d.username;
    var av = document.getElementById("user-avatar");
    var nm = document.getElementById("user-name");
    if (av) {
      av.style.background = window.lvl3.avatarColor(me);
      av.textContent = window.lvl3.avatarInitial(me);
    }
    if (nm) nm.textContent = me;
    socket.emit("auth", { username: me });
  });

  // ── Screen helpers ─────────────────────────────────────────────────────────
  function showScreen(id) {
    ["screen-lobby", "screen-game", "screen-end"].forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.classList.add("hidden");
    });
    var target = document.getElementById(id);
    if (target) target.classList.remove("hidden");
  }

  // ── Lobby helpers ──────────────────────────────────────────────────────────
  function renderLobbyPlayers(players, host) {
    window.lvl3.renderPlayerList(
      document.getElementById("lobby-player-list"),
      players, host, {}
    );
  }

  function applySettings(settings) {
    currentSettings = Object.assign(currentSettings, settings);
    // Difficulty buttons
    document.querySelectorAll(".diff-btn[data-diff]").forEach(function (btn) {
      btn.classList.remove("active-easy", "active-normal", "active-hard");
      if (btn.dataset.diff === currentSettings.difficulty) {
        btn.classList.add("active-" + currentSettings.difficulty);
      }
    });
    // Points buttons
    document.querySelectorAll(".diff-btn[data-pts]").forEach(function (btn) {
      btn.classList.remove("active-easy", "active-normal", "active-hard");
      if (parseInt(btn.dataset.pts, 10) === currentSettings.pointsToWin) {
        btn.classList.add("active-normal");
      }
    });
  }

  function updateHostUI() {
    document.getElementById("settings-card").classList.toggle("hidden", !isHost);
    document.getElementById("btn-start").classList.toggle("hidden", !isHost);
    document.getElementById("waiting-msg").classList.toggle("hidden", isHost);
  }

  // ── Room actions ───────────────────────────────────────────────────────────
  window.createRoom = function () {
    socket.emit("room:create", { gameType: "song-guesser" });
  };

  window.toggleJoin = function () {
    var area = document.getElementById("join-area");
    area.classList.toggle("hidden");
    if (!area.classList.contains("hidden")) {
      document.getElementById("inp-code").focus();
    }
  };

  window.joinRoom = function () {
    var code = (document.getElementById("inp-code").value || "").toUpperCase().trim();
    if (code.length !== 4) { window.lvl3.showToast("4-stelligen Code eingeben", "error"); return; }
    socket.emit("room:join", { code: code });
  };

  window.setDifficulty = function (diff) {
    if (!isHost) return;
    currentSettings.difficulty = diff;
    applySettings(currentSettings);
    socket.emit("game:settings", { difficulty: diff });
  };

  window.setPoints = function (pts) {
    if (!isHost) return;
    currentSettings.pointsToWin = pts;
    applySettings(currentSettings);
    socket.emit("game:settings", { pointsToWin: pts });
  };

  window.startGame = function () {
    if (!isHost) return;
    socket.emit("game:start");
  };

  // ── Answer ─────────────────────────────────────────────────────────────────
  window.submitAnswer = function () {
    var inp = document.getElementById("answer-input");
    var val = (inp.value || "").trim();
    if (!val) return;
    socket.emit("game:answer", { answer: val });
    inp.value = "";
  };

  document.addEventListener("DOMContentLoaded", function () {
    var inp = document.getElementById("answer-input");
    if (inp) {
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") window.submitAnswer();
      });
    }
  });

  // ── Audio ──────────────────────────────────────────────────────────────────
  function stopAudio() {
    if (audio) {
      audio.pause();
      audio.src = "";
      audio = null;
    }
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

    audio.onended = function () {
      setWaveformPlaying(false);
      setSongStatus(false);
      stopTimer();
    };

    audio.onerror = function () {
      setWaveformPlaying(false);
      setSongStatus(false);
    };

    var playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(function () {
        audioUnlocked = true;
        setWaveformPlaying(true);
        setSongStatus(true);
        hideAutoplayOverlay();
      }).catch(function () {
        // Autoplay blocked — show overlay
        pendingPreviewUrl = previewUrl;
        showAutoplayOverlay();
      });
    }
  }

  window.unlockAudio = function () {
    hideAutoplayOverlay();
    audioUnlocked = true;
    if (pendingPreviewUrl) {
      playPreview(pendingPreviewUrl);
      pendingPreviewUrl = null;
    }
  };

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
    if (!wf) return;
    if (playing) wf.classList.add("playing");
    else wf.classList.remove("playing");
  }

  function setSongStatus(playing) {
    var el = document.getElementById("song-status");
    if (!el) return;
    el.style.display = playing ? "flex" : "none";
  }

  // ── Timer ──────────────────────────────────────────────────────────────────
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
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimerDisplay(left, total) {
    var bar = document.getElementById("timer-bar");
    var label = document.getElementById("timer-label");
    if (bar) {
      var pct = Math.max(0, (left / total) * 100);
      bar.style.width = pct + "%";
      bar.classList.toggle("urgent", left <= 5);
    }
    if (label) label.textContent = Math.max(0, left) + "s";
  }

  // ── Show question phase ────────────────────────────────────────────────────
  function showQuestion(data) {
    currentSong = data.song;
    showScreen("screen-game");

    // Round counter
    var rc = document.getElementById("round-counter");
    if (rc) rc.textContent = "Runde " + data.song.index + " / " + data.song.total;

    // Hide album art, hide reveal box, show waveform
    var albumArt = document.getElementById("album-art");
    if (albumArt) albumArt.classList.remove("visible");
    var revealBox = document.getElementById("reveal-box");
    if (revealBox) revealBox.classList.add("hidden");
    var wf = document.getElementById("waveform");
    if (wf) wf.style.display = "flex";

    // Enable input
    var inp = document.getElementById("answer-input");
    if (inp) { inp.disabled = false; inp.value = ""; inp.focus(); }
    var answerWrap = document.getElementById("answer-wrap");
    if (answerWrap) answerWrap.style.opacity = "1";

    // Scores
    if (data.scores) renderScoreboard(data.scores);

    // Start timer
    startTimer(data.timeLimit || 15);

    // Play audio
    playPreview(data.song.previewUrl);
  }

  // ── Show reveal phase ──────────────────────────────────────────────────────
  function showReveal(data) {
    stopAudio();
    stopTimer();

    // Hide waveform, show album art
    var wf = document.getElementById("waveform");
    if (wf) wf.style.display = "none";
    setSongStatus(false);

    var albumArt = document.getElementById("album-art");
    if (albumArt && data.albumArt) {
      albumArt.src = data.albumArt;
      albumArt.classList.add("visible");
    }

    // Reveal box
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
        rw.textContent = data.winner === me
          ? "Du hast es erraten! +1 Punkt"
          : data.winner + " hat es erraten!";
        if (data.winner === me) window.lvl3.playSound("correct");
        else window.lvl3.playSound("round-start");
      } else {
        rw.className = "reveal-winner timeout";
        rw.textContent = "Niemand hat es erraten.";
        window.lvl3.playSound("wrong");
      }
    }

    // Disable input during reveal
    var inp = document.getElementById("answer-input");
    if (inp) inp.disabled = true;
    var answerWrap = document.getElementById("answer-wrap");
    if (answerWrap) answerWrap.style.opacity = "0.4";

    // Update scores
    if (data.scores) renderScoreboard(data.scores);
  }

  // ── Scoreboard ─────────────────────────────────────────────────────────────
  function renderScoreboard(scores) {
    var list = document.getElementById("game-player-list");
    if (!list) return;
    var entries = Object.entries(scores).sort(function (a, b) { return b[1] - a[1]; });
    list.innerHTML = entries.map(function (e) {
      var p = e[0], s = e[1];
      return '<li class="player-item' + (p === me ? " is-host" : "") + '">' +
        '<div class="player-avatar" style="background:' + window.lvl3.avatarColor(p) + '">' +
        window.lvl3.avatarInitial(p) + '</div>' +
        '<span class="player-name">' + p + '</span>' +
        '<span class="player-score">' + s + '</span>' +
        '</li>';
    }).join("");
  }

  // ── Game end ───────────────────────────────────────────────────────────────
  function showGameEnd(data) {
    stopAudio();
    stopTimer();
    showScreen("screen-end");

    var title = document.getElementById("end-title");
    var subtitle = document.getElementById("end-subtitle");
    var finalScores = document.getElementById("final-scores");
    var btnReplay = document.getElementById("btn-replay");

    if (data.winners && data.winners.length > 0) {
      var winnerStr = data.winners.join(" & ");
      if (title) title.textContent = data.winners.includes(me) ? "Du gewinnst! 🎉" : winnerStr + " gewinnt!";
      if (subtitle) subtitle.textContent = winnerStr + " mit " + data.topScore + " Punkten";
    }

    // Render final scores sorted
    if (finalScores && data.scores) {
      var entries = Object.entries(data.scores).sort(function (a, b) { return b[1] - a[1]; });
      var medals = ["🥇", "🥈", "🥉"];
      finalScores.innerHTML = entries.map(function (e, i) {
        return '<div class="final-score-row">' +
          '<span class="rank">' + (medals[i] || (i + 1) + ".") + '</span>' +
          '<span class="final-score-name">' + e[0] + '</span>' +
          '<span class="final-score-pts">' + e[1] + '</span>' +
          '</div>';
      }).join("");
    }

    if (btnReplay) btnReplay.classList.toggle("hidden", !isHost);
  }

  window.replayGame = function () {
    socket.emit("game:replay");
  };

  // ── Socket events ──────────────────────────────────────────────────────────
  socket.on("room:created", function (data) {
    currentRoom = data.code;
    isHost = true;
    applySettings(data.settings || {});

    document.getElementById("room-code-display").textContent = data.code;
    document.getElementById("room-info").classList.remove("hidden");
    document.getElementById("create-join-area").classList.add("hidden");
    document.getElementById("player-list-wrap").classList.remove("hidden");
    renderLobbyPlayers(data.players, data.host);
    updateHostUI();
    showScreen("screen-lobby");
  });

  socket.on("room:joined", function (data) {
    currentRoom = data.code;
    isHost = data.isHost;
    applySettings(data.settings || {});

    document.getElementById("room-code-display").textContent = data.code;
    document.getElementById("room-info").classList.remove("hidden");
    document.getElementById("create-join-area").classList.add("hidden");
    document.getElementById("player-list-wrap").classList.remove("hidden");
    renderLobbyPlayers(data.players, data.host);
    updateHostUI();
    showScreen("screen-lobby");
  });

  socket.on("room:players", function (data) {
    renderLobbyPlayers(data.players, data.host);
  });

  socket.on("room:host-changed", function (data) {
    isHost = data.host === me;
    renderLobbyPlayers(data.players, data.host);
    updateHostUI();
  });

  socket.on("room:settings", function (settings) {
    applySettings(settings);
  });

  socket.on("room:error", function (data) {
    window.lvl3.showToast(data.message, "error");
  });

  socket.on("game:error", function (data) {
    window.lvl3.showToast(data.message, "error");
  });

  socket.on("game:state", function (data) {
    switch (data.phase) {
      case "lobby":
        showScreen("screen-lobby");
        if (data.scores) {
          // Reset score display
          document.querySelectorAll(".diff-btn[data-pts]").forEach(function (b) {
            b.classList.remove("active-normal");
            if (parseInt(b.dataset.pts, 10) === currentSettings.pointsToWin) b.classList.add("active-normal");
          });
        }
        break;

      case "countdown":
        // Show countdown overlay on top of lobby
        var cd = document.getElementById("screen-countdown");
        var num = document.getElementById("countdown-num");
        if (cd) cd.classList.remove("hidden");
        if (num) {
          num.textContent = data.countdown;
          // Re-trigger animation
          num.style.animation = "none";
          void num.offsetWidth;
          num.style.animation = "";
        }
        window.lvl3.playSound("tick");
        break;

      case "question":
        var cd2 = document.getElementById("screen-countdown");
        if (cd2) cd2.classList.add("hidden");
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
    if (inp) {
      inp.classList.add("shake");
      setTimeout(function () { inp.classList.remove("shake"); }, 350);
    }
    window.lvl3.playSound("wrong");
  });

}());
