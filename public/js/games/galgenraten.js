(function () {
  "use strict";

  var username = null;
  var roomCode = null;
  var isHost = false;
  var players = [];
  var host = "";
  var settings = { playMode: "solo", wordMode: "pick", difficulty: "normal" };
  var myTeam = null;
  var lastPhase = null;
  var currentAvatars = {};

  var ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ".split("");
  var socket = window.lvl3.socket;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.lvl3.escapeHtml(String(s == null ? "" : s)); }
  function showScreen(name) {
    var els = document.querySelectorAll(".screen");
    for (var i = 0; i < els.length; i++) els[i].classList.remove("active");
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }
  function teamLabel(key) { return key === "A" ? "Team Rot" : "Team Blau"; }
  function diffLabel(d) { return d === "easy" ? "Leicht" : d === "hard" ? "Schwer" : "Mittel"; }

  // ── Auth ──
  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = $("user-avatar");
    var nm = $("user-name");
    if (av) window.lvl3.applyAvatar(av, username, d.avatar);
    if (nm) nm.textContent = username;
    socket.emit("auth", { username: username });
  });

  // ── Global actions ──
  window.createRoom = function () { socket.emit("room:create", { gameType: "galgenraten" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.leaveRoom = function () { socket.emit("room:leave"); roomCode = null; showScreen("join"); };
  window.startGame = function () { socket.emit("galgenraten:start"); };
  window.playAgain = function () { socket.emit("galgenraten:restart"); };
  window.pushSettings = function () {
    if (!isHost) return;
    var pm = $("sel-playmode"), wm = $("sel-wordmode"), df = $("sel-difficulty");
    socket.emit("room:settings", {
      playMode: pm ? pm.value : "solo",
      wordMode: wm ? wm.value : "pick",
      difficulty: df ? df.value : "normal"
    });
  };
  window.setWord = function () {
    var inp = $("set-word-input"), err = $("set-word-error");
    var w = inp ? inp.value : "";
    if (!w || !w.trim()) { if (err) err.textContent = "Bitte ein Wort eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("galgenraten:set-word", { word: w });
    if (inp) inp.value = "";
  };

  var joinInput = $("join-code-input");
  if (joinInput) joinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });
  var setInput = $("set-word-input");
  if (setInput) setInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.setWord(); });

  // ── Room events ──
  socket.on("room:created", function (data) {
    roomCode = data.code; isHost = true; players = data.players; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    settings = mergeSettings(data.settings); enterLobby();
  });
  socket.on("room:joined", function (data) {
    roomCode = data.code; isHost = data.isHost; players = data.players; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    settings = mergeSettings(data.settings); enterLobby();
  });
  socket.on("room:error", function (data) { var err = $("join-error"); if (err) err.textContent = data.message || "Fehler"; });
  socket.on("room:players", function (data) { players = data.players; host = data.host; if (data.avatars) currentAvatars = data.avatars; renderLobby(); });
  socket.on("room:host-changed", function (data) { host = data.host; players = data.players; isHost = (host === username); if (data.avatars) currentAvatars = data.avatars; renderLobby(); });
  socket.on("room:settings-updated", function (data) { settings = mergeSettings(data); renderLobby(); });
  socket.on("game:error", function (data) { window.lvl3.showToast(data.message || "Fehler", "error"); });

  function mergeSettings(s) {
    s = s || {};
    return {
      playMode: s.playMode === "team" ? "team" : "solo",
      wordMode: s.wordMode === "race" ? "race" : "pick",
      difficulty: ["easy", "normal", "hard"].indexOf(s.difficulty) !== -1 ? s.difficulty : "normal"
    };
  }

  function enterLobby() {
    var codeEl = $("room-code-display");
    if (codeEl) codeEl.textContent = roomCode || "––––";
    renderLobby();
    showScreen("lobby");
  }

  function renderLobby() {
    window.lvl3.renderPlayerList($("player-list"), players, host, {}, currentAvatars);
    var hostPanel = $("host-settings"), guestPanel = $("guest-settings");
    if (hostPanel) hostPanel.style.display = isHost ? "" : "none";
    if (guestPanel) guestPanel.style.display = isHost ? "none" : "";

    var pm = $("sel-playmode"), wm = $("sel-wordmode"), df = $("sel-difficulty");
    if (pm) pm.value = settings.playMode;
    if (wm) wm.value = settings.wordMode;
    if (df) df.value = settings.difficulty;

    var teamRows = document.querySelectorAll(".team-only");
    for (var i = 0; i < teamRows.length; i++) teamRows[i].style.display = (settings.playMode === "team") ? "" : "none";
    var diffRow = $("difficulty-row");
    if (diffRow) diffRow.style.display = (settings.playMode === "solo" || settings.wordMode === "race") ? "" : "none";

    renderTeamsPreview();

    var gsum = $("guest-settings-display");
    if (gsum) gsum.innerHTML = settingsSummary();

    var btn = $("btn-start");
    if (btn) btn.disabled = settings.playMode === "solo" ? players.length < 1 : players.length < 2;
    var hint = $("start-hint");
    if (hint) hint.textContent = (settings.playMode === "team" && players.length < 2) ? "Mindestens 2 Spieler für den Team-Modus." : "";
  }

  function settingsSummary() {
    var s = settings.playMode === "team" ? "Team" : "Solo";
    if (settings.playMode === "team") s += " · " + (settings.wordMode === "pick" ? "Eigene Wörter" : "Zufalls-Rennen");
    if (settings.playMode === "solo" || settings.wordMode === "race") s += " · " + diffLabel(settings.difficulty);
    return esc(s);
  }

  function teamSplit() {
    var half = Math.ceil(players.length / 2);
    return { A: players.slice(0, half), B: players.slice(half) };
  }
  function renderTeamsPreview() {
    var wrap = $("teams-preview");
    if (!wrap) return;
    if (settings.playMode !== "team") { wrap.innerHTML = ""; wrap.style.display = "none"; return; }
    wrap.style.display = "";
    var t = teamSplit();
    wrap.innerHTML = teamBox("Team Rot", t.A, "a") + teamBox("Team Blau", t.B, "b");
  }
  function teamBox(name, members, cls) {
    var inner = members.length ? members.map(function (m) { return esc(m); }).join(", ") : "—";
    return '<div class="team-box team-' + cls + '"><div class="team-name">' + esc(name) + '</div><div>' + inner + '</div></div>';
  }

  // ── Game state ──
  socket.on("game:state", function (msg) {
    var phase = msg.phase, data = msg.data || {};
    lastPhase = phase;
    if (data.teams) myTeam = data.teams.A.indexOf(username) !== -1 ? "A" : (data.teams.B.indexOf(username) !== -1 ? "B" : null);
    if (phase === "lobby") { enterLobby(); return; }
    if (phase === "pick") { renderPick(data); return; }
    if (phase === "guess") { renderGame(data, false); return; }
    if (phase === "round-reveal") { renderGame(data, true); return; }
    if (phase === "end") { renderEnd(data); return; }
  });

  function renderPick(data) {
    showScreen("pick");
    var amSetter = (myTeam === data.setter);
    var setterName = teamLabel(data.setter), guesserName = teamLabel(data.guesser);
    var info = $("pick-info");
    if (info) info.innerHTML = "Runde " + data.subRound + " / " + data.totalRounds + " — <strong>" + esc(setterName) + "</strong> wählt ein Wort für <strong>" + esc(guesserName) + "</strong>";
    var setArea = $("pick-setter-area"), waitArea = $("pick-wait-area");
    if (amSetter) {
      if (setArea) setArea.style.display = "";
      if (waitArea) waitArea.style.display = "none";
      var inp = $("set-word-input"); if (inp) { inp.value = ""; setTimeout(function () { inp.focus(); }, 50); }
    } else {
      if (setArea) setArea.style.display = "none";
      if (waitArea) waitArea.style.display = "";
      var w = $("pick-wait-text");
      if (w) w.textContent = setterName + " denkt sich ein Wort aus…";
    }
  }

  function renderGame(data, isReveal) {
    showScreen("game");
    var container = $("boards-container");
    if (!container) return;
    var boardsToShow = [];
    if (data.variant === "solo") {
      boardsToShow.push({ board: data.board, label: "", mine: true });
    } else if (data.variant === "race") {
      var mineKey = myTeam || "A", otherKey = (myTeam === "A") ? "B" : "A";
      boardsToShow.push({ board: data.boards[mineKey], label: teamLabel(mineKey) + " (ihr)", mine: true, key: mineKey });
      boardsToShow.push({ board: data.boards[otherKey], label: teamLabel(otherKey), mine: false, key: otherKey });
    } else {
      boardsToShow.push({ board: data.board, label: teamLabel(data.guesser) + " rät", mine: (myTeam === data.guesser), key: data.guesser });
    }
    container.className = "boards-container" + (boardsToShow.length > 1 ? " two" : "");
    container.innerHTML = boardsToShow.map(function (b) { return boardHTML(b.board, b.label, b.mine, b.key); }).join("");

    var gridBoard = null, active = false;
    if (data.variant === "solo") { gridBoard = data.board; active = !isReveal && !data.board.solved && !data.board.dead; }
    else if (data.variant === "race") { gridBoard = data.boards[myTeam || "A"]; active = !!gridBoard && !isReveal && !gridBoard.solved && !gridBoard.dead; }
    else { gridBoard = data.board; active = (myTeam === data.guesser) && !isReveal && !!data.board && !data.board.solved && !data.board.dead; }
    renderAlphabet(gridBoard, active);

    var status = $("game-status");
    if (status) status.innerHTML = gameStatusText(data, isReveal);
  }

  function boardHTML(board, label, mine, key) {
    if (!board) return "";
    var cls = "board-card" + (mine ? " mine" : "") + (key ? " team-" + key.toLowerCase() : "");
    var html = '<div class="' + cls + '">';
    if (label) html += '<div class="board-label">' + esc(label) + '</div>';
    html += '<div class="gallows-wrap' + (board.dead ? " dead" : "") + '">' + gallowsSVG(board.wrongCount, board.dead) + '</div>';
    html += '<div class="word-row">' + wordHTML(board.pattern) + '</div>';
    html += '<div class="lives">Fehler: ' + board.wrongCount + " / " + board.maxWrong + '</div>';
    html += '</div>';
    return html;
  }

  function wordHTML(pattern) {
    return (pattern || []).map(function (ch) {
      if (ch === " ") return '<span class="slot space"></span>';
      if (ch === "-") return '<span class="slot sep">-</span>';
      if (ch === null) return '<span class="slot empty"></span>';
      return '<span class="slot filled">' + esc(ch) + '</span>';
    }).join("");
  }

  function renderAlphabet(board, active) {
    var grid = $("alphabet-grid");
    if (!grid) return;
    var guessed = {}, correct = {};
    if (board) {
      for (var i = 0; i < board.guessed.length; i++) guessed[board.guessed[i]] = true;
      for (var j = 0; j < board.pattern.length; j++) { var c = board.pattern[j]; if (c && c !== " " && c !== "-") correct[c] = true; }
    }
    grid.innerHTML = ALPHA.map(function (L) {
      var isG = guessed[L], cls = "key";
      if (isG) cls += correct[L] ? " correct" : " wrong";
      return '<button class="' + cls + '" data-letter="' + L + '"' + ((isG || !active) ? " disabled" : "") + '>' + L + '</button>';
    }).join("");
  }

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".key") : null;
    if (!btn || btn.disabled) return;
    var L = btn.getAttribute("data-letter");
    if (L) socket.emit("galgenraten:guess", { letter: L });
  });
  document.addEventListener("keydown", function (e) {
    if (lastPhase !== "guess") return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    var k = (e.key || "").toUpperCase();
    if (ALPHA.indexOf(k) === -1) return;
    var btn = document.querySelector('.key[data-letter="' + k + '"]');
    if (btn && !btn.disabled) socket.emit("galgenraten:guess", { letter: k });
  });

  function gameStatusText(data, isReveal) {
    if (data.variant === "solo") {
      if (data.board.solved) return '<span class="ok">Gelöst! Stark!</span>';
      if (data.board.dead) return '<span class="bad">Verloren — das Wort war: ' + esc(data.board.word || "") + '</span>';
      return "Rate das Wort, Buchstabe für Buchstabe.";
    }
    if (data.variant === "race") return isReveal ? "" : "Zufalls-Rennen — wer knackt das Wort zuerst?";
    if (isReveal && data.board) {
      var g = teamLabel(data.guesser);
      if (data.board.solved) return '<span class="ok">' + esc(g) + ' hat das Wort geknackt!</span>';
      return '<span class="bad">' + esc(g) + ' hat es nicht geschafft. Wort: ' + esc(data.board.word || "") + '</span>';
    }
    return (myTeam === data.guesser) ? "Ihr seid dran — ratet!" : (teamLabel(data.guesser) + " rät gerade…");
  }

  function renderEnd(data) {
    showScreen("end");
    var title = $("end-title"), detail = $("end-detail"), boards = $("end-boards");
    if (data.variant === "solo") {
      if (title) title.textContent = data.board.solved ? "Gewonnen!" : "Verloren";
      if (detail) detail.innerHTML = 'Das Wort war: <strong>' + esc(data.board.word || "") + '</strong>';
      if (boards) boards.innerHTML = "";
    } else {
      var winnerName = data.winner ? teamLabel(data.winner) : null;
      if (title) title.textContent = winnerName ? (winnerName + " gewinnt!") : "Unentschieden!";
      if (data.variant === "race") {
        if (detail) detail.innerHTML = 'Das Wort war: <strong>' + esc((data.boards.A && data.boards.A.word) || "") + '</strong>';
        if (boards) boards.innerHTML = endBoardHTML("Team Rot", data.boards.A) + endBoardHTML("Team Blau", data.boards.B);
      } else {
        if (detail) detail.innerHTML = pickResultDetail(data);
        if (boards) boards.innerHTML = "";
      }
      if (data.winner && myTeam === data.winner) window.lvl3.playSound("correct");
    }
    var btn = $("btn-play-again");
    if (btn) btn.classList.toggle("hidden", !isHost);
  }

  function endBoardHTML(name, board) {
    if (!board) return "";
    var status = board.solved ? '<span class="ok">gelöst</span>' : '<span class="bad">' + board.wrongCount + ' Fehler</span>';
    return '<div class="board-card"><div class="board-label">' + esc(name) + ' — ' + status + '</div>' +
      '<div class="word-row small">' + wordHTML((board.word || "").split("")) + '</div></div>';
  }

  function pickResultDetail(data) {
    var r = data.results || {};
    function line(key) {
      var name = teamLabel(key), res = r[key];
      if (!res) return '<div>' + esc(name) + ': —</div>';
      if (res.solved) return '<div><strong>' + esc(name) + '</strong>: gelöst in ' + (res.timeMs / 1000).toFixed(1) + ' s, ' + res.wrongCount + ' Fehler</div>';
      return '<div><strong>' + esc(name) + '</strong>: nicht gelöst (' + res.revealed + ' Buchstaben, ' + res.wrongCount + ' Fehler)</div>';
    }
    return line("A") + line("B");
  }

  function gallowsSVG(wrong, dead) {
    var color = dead ? "var(--red)" : "var(--text)";
    var figColor = dead ? "var(--red)" : "var(--accent3)";
    var parts = [
      '<line x1="8" y1="134" x2="64" y2="134"/>',
      '<line x1="22" y1="134" x2="22" y2="8"/>',
      '<line x1="22" y1="8" x2="80" y2="8"/>',
      '<line x1="80" y1="8" x2="80" y2="24"/>',
      '<circle cx="80" cy="34" r="10"/>',
      '<line x1="80" y1="44" x2="80" y2="82"/>',
      '<line x1="80" y1="54" x2="64" y2="68"/>',
      '<line x1="80" y1="54" x2="96" y2="68"/>',
      '<line x1="80" y1="82" x2="66" y2="102"/>',
      '<line x1="80" y1="82" x2="94" y2="102"/>'
    ];
    var structure = parts.slice(0, Math.min(wrong, 4)).join("");
    var figure = wrong > 4 ? parts.slice(4, wrong).join("") : "";
    return '<svg viewBox="0 0 110 140" width="104" height="132" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<g stroke="' + color + '">' + structure + '</g>' +
      '<g stroke="' + figColor + '">' + figure + '</g></svg>';
  }

}());
