(function () {
  "use strict";

  // ── State ──
  var username = null;
  var roomCode = null;
  var isHost = false;
  var players = [];
  var host = "";
  var currentAvatars = {};

  // host lobby controls (mirrored to guests via room:settings-updated)
  var mode = "race";        // "race" | "standard"
  var target = 5;

  var lastPhase = null;     // detect phase transitions
  var lastRound = 0;        // detect new round to reset the word input

  var socket = window.lvl3.socket;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.lvl3.escapeHtml(String(s == null ? "" : s)); }

  function showScreen(name) {
    var els = document.querySelectorAll(".screen");
    for (var i = 0; i < els.length; i++) els[i].classList.remove("active");
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }

  // ── Auth ──
  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = $("user-avatar");
    var nm = $("user-name");
    if (av) window.lvl3.applyAvatar(av, username, d.avatar);
    if (nm) nm.textContent = username;
    socket.emit("auth", { username: username });
    showScreen("join");
  });

  // ── Global actions (referenced by onclick in the HTML) ──
  window.createRoom = function () { socket.emit("room:create", { gameType: "verhext" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.leaveRoom = function () { socket.emit("room:leave"); roomCode = null; showScreen("join"); };
  window.startGame = function () { socket.emit("verhext:start"); };
  window.playAgain = function () { socket.emit("verhext:restart"); };
  window.submitWord = function () {
    var inp = $("word-input"), err = $("word-error");
    var word = (inp ? inp.value : "").trim();
    if (!word) { if (err) err.textContent = "Bitte ein Wort eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("verhext:submit", { word: word });
    lockWordInput();
  };

  var joinInput = $("join-code-input");
  if (joinInput) joinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });
  var wordInput = $("word-input");
  if (wordInput) wordInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.submitWord(); });

  // ── Host lobby controls → room:settings ──
  function bindModeButton(id, m) {
    var btn = $(id);
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!isHost) return;
      mode = m;
      socket.emit("room:settings", { mode: mode });
    });
  }
  bindModeButton("mode-race", "race");
  bindModeButton("mode-standard", "standard");

  var targetInput = $("target-input");
  if (targetInput) targetInput.addEventListener("change", function () {
    if (!isHost) return;
    var n = parseInt(targetInput.value, 10);
    if (isNaN(n)) return;
    target = Math.max(1, Math.min(100, n));
    targetInput.value = target;
    socket.emit("room:settings", { target: target });
  });

  // ── Room events ──
  socket.on("room:created", function (data) {
    roomCode = data.code; isHost = true; players = data.players || []; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    enterLobby();
  });
  socket.on("room:joined", function (data) {
    roomCode = data.code; isHost = !!data.isHost; players = data.players || []; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    enterLobby();
  });
  socket.on("room:error", function (data) {
    var err = $("join-error"); if (err) err.textContent = (data && data.message) || "Fehler";
  });
  socket.on("room:players", function (data) {
    players = data.players || []; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    renderLobby();
  });
  socket.on("room:host-changed", function (data) {
    host = data.host; players = data.players || []; isHost = (host === username);
    if (data.avatars) currentAvatars = data.avatars;
    renderLobby();
  });
  socket.on("room:settings-updated", function (s) {
    if (!s) return;
    if (s.vMode !== undefined) mode = (s.vMode === "standard") ? "standard" : "race";
    if (s.vTarget !== undefined) target = s.vTarget;
    syncSettingsControls();
  });
  socket.on("game:error", function (data) { window.lvl3.showToast((data && data.message) || "Fehler", "error"); });

  function enterLobby() {
    var codeEl = $("room-code-display");
    if (codeEl) codeEl.textContent = roomCode || "––––";
    renderLobby();
    showScreen("lobby");
  }

  // reflect the current mode/target into the host controls + guest read-only text
  function syncSettingsControls() {
    var raceBtn = $("mode-race"), stdBtn = $("mode-standard");
    if (raceBtn) raceBtn.classList.toggle("active", mode === "race");
    if (stdBtn) stdBtn.classList.toggle("active", mode === "standard");
    var label = $("target-label");
    if (label) label.textContent = mode === "race" ? "Punkte zum Sieg" : "Anzahl Runden";
    var ti = $("target-input");
    if (ti && document.activeElement !== ti) ti.value = target;

    var disp = $("guest-settings-display");
    if (disp) disp.textContent = (mode === "race" ? "Rennen" : "Standard") + " · " +
      (mode === "race" ? ("bis " + target + " Punkte") : (target + " Runden"));
  }

  function renderLobby() {
    window.lvl3.renderPlayerList($("player-list"), players, host, {}, currentAvatars);
    var hostPanel = $("host-settings"), guestPanel = $("guest-settings");
    if (hostPanel) hostPanel.style.display = isHost ? "" : "none";
    if (guestPanel) guestPanel.style.display = isHost ? "none" : "";
    syncSettingsControls();

    var btn = $("btn-start");
    if (btn) btn.disabled = players.length < 4;
    var hint = $("start-hint");
    if (hint) hint.textContent = players.length < 4 ? "Mindestens 4 Spieler (2 Teams)" : "Bereit zum Start";

    renderTeamsPreview(splitTeams(players));
  }

  // client-side mirror of the server's team split (first half = A) for the lobby preview
  function splitTeams(list) {
    var half = Math.ceil(list.length / 2);
    return { A: list.slice(0, half), B: list.slice(half) };
  }

  function renderTeamsPreview(teams) {
    var el = $("teams-preview");
    if (!el) return;
    if (!players.length) { el.innerHTML = ""; return; }
    el.innerHTML = teamBox("a", "Team A", teams.A) + teamBox("b", "Team B", teams.B);
  }
  function teamBox(cls, name, members) {
    var inner = (members && members.length)
      ? members.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join("")
      : '<span class="empty">—</span>';
    return '<div class="team-box team-' + cls + '">' +
      '<div class="team-name">' + esc(name) + '</div>' +
      '<div class="team-members">' + inner + '</div>' +
      '</div>';
  }

  function myTeam(teams) {
    if (!teams) return null;
    if ((teams.A || []).indexOf(username) !== -1) return "A";
    if ((teams.B || []).indexOf(username) !== -1) return "B";
    return null;
  }

  // ── Game state (authoritative) ──
  // msg = { phase, data }; phase ∈ "lobby" | "word" | "reveal" | "end"
  socket.on("game:state", function (msg) {
    var phase = msg && msg.phase;
    var data = (msg && msg.data) || {};

    // keep lobby controls in sync if the server hands settings down with state
    if (typeof data.mode !== "undefined" && data.mode) mode = data.mode;
    if (typeof data.target === "number") target = data.target;

    if (phase === "lobby") { lastPhase = phase; lastRound = 0; enterLobby(); return; }
    if (phase === "word")   { renderWord(data); }
    else if (phase === "reveal") { renderReveal(data); }
    else if (phase === "end")    { renderEnd(data); }

    lastPhase = phase;
  });

  // ── Word phase ──
  function renderWord(data) {
    var team = myTeam(data.teams);

    var counter = $("word-round");
    if (counter) {
      counter.textContent = (data.mode === "standard")
        ? ("Runde " + data.round + "/" + (data.totalRounds || data.target))
        : ("Race bis " + data.target);
    }

    var w = $("prompt-word");
    if (w) w.textContent = data.word || "––––";

    var tag = $("word-team");
    if (tag) {
      tag.textContent = team ? ("Team " + team) : "Zuschauer";
      tag.className = "my-team-tag" + (team === "A" ? " team-a" : team === "B" ? " team-b" : "");
    }

    var submitted = data.submitted || [];
    var iSubmitted = submitted.indexOf(username) !== -1;

    // reset input on a brand-new round; otherwise honor server's submitted list
    if (data.round !== lastRound) {
      lastRound = data.round;
      var inp = $("word-input");
      if (inp) { inp.value = ""; inp.disabled = false; }
      var err = $("word-error"); if (err) err.textContent = "";
      var btn = $("btn-submit-word"); if (btn) btn.disabled = false;
    }

    if (iSubmitted) lockWordInput();
    else showWordSubmitArea();

    renderSubmittedNames(data.teams, submitted);
    showScreen("word");
  }

  function showWordSubmitArea() {
    var sub = $("word-submit-area"), wait = $("word-wait-area");
    if (sub) sub.style.display = "";
    if (wait) wait.style.display = "none";
  }
  function lockWordInput() {
    var inp = $("word-input"); if (inp) inp.disabled = true;
    var btn = $("btn-submit-word"); if (btn) btn.disabled = true;
    var sub = $("word-submit-area"), wait = $("word-wait-area");
    if (sub) sub.style.display = "none";
    if (wait) wait.style.display = "";
  }

  function renderSubmittedNames(teams, submitted) {
    var el = $("submitted-names");
    if (!el) return;
    var all = [].concat((teams && teams.A) || [], (teams && teams.B) || []);
    el.innerHTML = all.map(function (u) {
      var done = submitted.indexOf(u) !== -1;
      return '<span class="' + (done ? "done" : "") + '">' + esc(u) + (done ? " ✓" : " …") + '</span>';
    }).join("");
  }

  // ── Reveal phase ──
  function renderReveal(data) {
    var counter = $("reveal-round");
    if (counter) {
      counter.textContent = (data.mode === "standard")
        ? ("Runde " + data.round + "/" + (data.totalRounds || data.target))
        : ("Race bis " + data.target);
    }

    var el = $("reveal-teams");
    var reveal = data.reveal || {};
    if (el) el.innerHTML = revealBox("a", "Team A", reveal.A) + revealBox("b", "Team B", reveal.B);

    var scores = data.scores || { A: 0, B: 0 };
    var sl = $("reveal-scores");
    if (sl) sl.innerHTML = '<span class="sa">Team A · ' + scores.A + '</span>' +
                           '<span class="sb">Team B · ' + scores.B + '</span>';

    showScreen("reveal");
  }

  function revealBox(cls, name, info) {
    info = info || { words: {}, matched: false };
    var words = info.words || {};
    var rows = Object.keys(words).map(function (u) {
      return '<div class="reveal-word">' +
        '<span class="who">' + esc(u) + '</span>' +
        '<span class="what">' + esc(words[u] || "—") + '</span>' +
        '</div>';
    }).join("");
    var badge = info.matched
      ? '<span class="match-badge yes">Match +1</span>'
      : '<span class="match-badge no">Kein Match</span>';
    return '<div class="reveal-box team-' + cls + '">' +
      '<div class="reveal-head">' +
        '<span class="reveal-team-name">' + esc(name) + '</span>' + badge +
      '</div>' +
      '<div class="reveal-words">' + rows + '</div>' +
      '</div>';
  }

  // ── End phase ──
  function renderEnd(data) {
    var winner = data.winner;
    var scores = data.scores || { A: 0, B: 0 };

    var name = $("winner-name");
    if (name) {
      if (winner === "tie") name.textContent = "Unentschieden";
      else if (winner === "A") name.textContent = "Team A gewinnt!";
      else if (winner === "B") name.textContent = "Team B gewinnt!";
      else name.textContent = "Spiel beendet";
    }

    var sl = $("end-scores");
    if (sl) sl.innerHTML = '<span class="sa">Team A · ' + scores.A + '</span>' +
                           '<span class="sb">Team B · ' + scores.B + '</span>';

    var team = myTeam(data.teams);
    var sub = $("end-sub");
    if (sub) {
      if (winner === "tie") sub.textContent = "Gleicher Gedanke, gleicher Punktestand.";
      else if (team && winner === team) sub.textContent = "Euer Team denkt gleich!";
      else if (team) sub.textContent = "Beim nächsten Mal verhext ihr sie.";
      else sub.textContent = "";
    }
    if (team && winner === team) { try { window.lvl3.playSound("correct"); } catch (e) {} }

    var btn = $("btn-play-again");
    if (btn) btn.style.display = isHost ? "" : "none";

    showScreen("end");
  }

}());
