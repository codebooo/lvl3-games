(function () {
  "use strict";

  var username = null, roomCode = null, isHost = false;
  var players = [], host = "", currentAvatars = {};
  var myRoll = null;   // eigener geheimer Wurf {value,label}

  var socket = window.lvl3.socket;
  function $(id) { return document.getElementById(id); }
  var esc = window.lvl3.escapeHtml;

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }

  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = $("user-avatar"), nm = $("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;
    socket.emit("auth", {});
  });

  window.createRoom = function () { socket.emit("room:create", { gameType: "meiern" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.startGame = function () {
    var e = $("start-error"); if (e) e.textContent = "";
    socket.emit("meiern:start");
  };
  window.leaveRoom = function () { socket.emit("room:leave"); roomCode = null; showScreen("join"); };
  window.playAgain = function () { socket.emit("meiern:restart"); };

  var ji = $("join-code-input");
  if (ji) ji.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  socket.on("room:created", function (d) {
    roomCode = d.code; isHost = true; players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    enterLobby();
  });
  socket.on("room:joined", function (d) {
    roomCode = d.code; isHost = d.isHost; players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    enterLobby();
  });
  socket.on("room:error", function (d) { var e = $("join-error"); if (e) e.textContent = d.message || "Fehler"; });
  socket.on("game:error", function (d) {
    var e = $("start-error"); if (e) e.textContent = (d && d.message) || "Fehler";
    var t = $("turn-msg"); if (t && d && d.message) t.textContent = d.message;
  });
  socket.on("room:players", function (d) {
    players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    renderPlayers();
  });
  socket.on("room:host-changed", function (d) {
    host = d.host; players = d.players; isHost = (host === username);
    if (d.avatars) currentAvatars = d.avatars;
    renderPlayers(); updateHostUI();
  });

  function enterLobby() {
    var c = $("room-code-display"); if (c) c.textContent = roomCode;
    renderPlayers(); updateHostUI(); showScreen("lobby");
  }
  function renderPlayers(scores) {
    window.lvl3.renderPlayerList($("player-list"), players, host, scores || {}, currentAvatars);
  }
  function updateHostUI() {
    var b = $("btn-start"), p = $("host-settings"), g = $("guest-settings");
    if (isHost) {
      if (b) b.classList.remove("hidden");
      if (p) p.style.display = ""; if (g) g.style.display = "none";
    } else {
      if (b) b.classList.add("hidden");
      if (p) p.style.display = "none"; if (g) g.style.display = "";
    }
  }

  // Der eigene Wurf kommt privat — nur an diesen Socket.
  socket.on("meiern:your-roll", function (d) {
    myRoll = d;
    var s = String(d.value);
    if ($("die-1")) $("die-1").textContent = s[0];
    if ($("die-2")) $("die-2").textContent = s[1];
    if ($("my-roll-label")) {
      $("my-roll-label").textContent = "Du hast " + d.label + " — nur du siehst das" +
        (d.mustBeatLabel ? " · musst über " + d.mustBeatLabel : "");
    }
    if ($("my-roll-box")) $("my-roll-box").classList.remove("hidden");
    window.lvl3.playSound("round-start");
  });

  socket.on("game:state", function (msg) {
    var phase = msg.phase, d = msg.data || {};
    if (phase === "lobby") { myRoll = null; isHost = (host === username); enterLobby(); return; }
    if (phase === "turn")     { showTurn(d); return; }
    if (phase === "reveal")   { showReveal(d); return; }
    if (phase === "game-end") { showEnd(d); return; }
  });

  function hearts(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += "♥";
    return s || "—";
  }

  function renderLives(el, d) {
    if (!el) return;
    el.innerHTML = (d.seats || []).map(function (p) {
      var lives = (d.lives && d.lives[p]) || 0;
      var cls = "life-row" + (p === d.current ? " is-current" : "") + (lives <= 0 ? " dead" : "");
      return '<div class="' + cls + '"><span>' + esc(p) + (p === d.current ? " ◀" : "") + "</span>" +
        '<span class="hearts" style="color:var(--acc)">' + hearts(lives) + "</span></div>";
    }).join("");
  }

  function showTurn(d) {
    var mine = d.current === username;
    if ($("turn-kicker")) $("turn-kicker").textContent = mine ? "Du bist dran" : "Am Zug";
    if ($("turn-who")) $("turn-who").textContent = mine ? "Du" : d.current;

    if ($("claim-display")) $("claim-display").textContent = d.claimLabel || "—";
    if ($("claim-by")) {
      $("claim-by").textContent = d.claimBy
        ? ("behauptet von " + d.claimBy)
        : "noch keine Behauptung — du darfst frei ansagen";
    }

    // Eigener Wurf nur zeigen, solange er gültig ist (also im eigenen Zug).
    if (!mine || !d.hasRolled) {
      if ($("my-roll-box")) $("my-roll-box").classList.add("hidden");
      if (!d.hasRolled) myRoll = null;
    }

    var actions = $("actions");
    if (actions) actions.classList.toggle("hidden", !mine);

    if (mine) {
      // Würfeln-Button nur solange nicht gewürfelt
      if ($("action-roll")) $("action-roll").classList.toggle("hidden", d.hasRolled);
      // Behauptungs-Buttons erst nach dem Würfeln
      if ($("action-claim")) $("action-claim").classList.toggle("hidden", !d.hasRolled);
      // Aufdecken nur wenn es eine Behauptung gibt und noch nicht gewürfelt wurde
      if ($("action-doubt")) $("action-doubt").classList.toggle("hidden", !d.claim || d.hasRolled);

      var grid = $("claim-options");
      if (grid && d.hasRolled) {
        grid.innerHTML = "";
        (d.allowed || []).forEach(function (opt) {
          var b = document.createElement("button");
          b.className = "claim-btn" + (opt.value === 21 ? " max" : "");
          b.textContent = opt.label;
          b.addEventListener("click", function () {
            grid.querySelectorAll(".claim-btn").forEach(function (x) { x.disabled = true; });
            socket.emit("meiern:claim", { value: opt.value });
          });
          grid.appendChild(b);
        });
      }
    }

    if ($("turn-msg")) $("turn-msg").textContent = d.message || "";
    renderLives($("lives-list"), d);
    renderPlayers();
    showScreen("turn");
  }

  if ($("btn-roll")) $("btn-roll").addEventListener("click", function () {
    this.disabled = true;
    socket.emit("meiern:roll");
    var self = this;
    setTimeout(function () { self.disabled = false; }, 800);
  });
  if ($("btn-doubt")) $("btn-doubt").addEventListener("click", function () {
    this.disabled = true;
    socket.emit("meiern:doubt");
    var self = this;
    setTimeout(function () { self.disabled = false; }, 1200);
  });

  function showReveal(d) {
    var rv = d.reveal;
    if ($("my-roll-box")) $("my-roll-box").classList.add("hidden");
    myRoll = null;
    if (rv) {
      if ($("rv-headline")) $("rv-headline").textContent = rv.wasTrue ? "Es war wahr!" : "Erwischt — gelogen!";
      if ($("rv-box")) {
        $("rv-box").innerHTML =
          '<div style="font-size:15px;line-height:1.7">' +
          "<strong>" + esc(rv.claimBy) + "</strong> behauptete <strong style='color:var(--acc)'>" +
          esc(rv.claimLabel) + "</strong>.<br>" +
          "<strong>" + esc(rv.doubter) + "</strong> hat aufgedeckt.<br>" +
          (rv.wasTrue
            ? "Die Behauptung stimmte — <strong>" + esc(rv.loser) + "</strong> verliert " + rv.cost + " Leben."
            : "Die Behauptung war falsch — <strong>" + esc(rv.loser) + "</strong> verliert " + rv.cost + " Leben.") +
          "</div>";
      }
      window.lvl3.playSound(rv.loser === username ? "wrong" : "correct");
    }
    renderLives($("rv-lives"), d);
    showScreen("reveal");
  }

  function showEnd(d) {
    var k = $("end-kicker"), w = $("end-winner-name"), s = $("end-sub");
    if (d.tie) {
      if (k) k.textContent = "Unentschieden";
      if (w) w.textContent = "Kein Sieger";
      if (s) s.textContent = "alle gleichzeitig am Ende";
    } else {
      if (k) k.textContent = "Gewinner";
      if (w) w.textContent = d.winner || "—";
      if (s) s.textContent = "hat als Letzter Leben übrig";
    }
    var el = $("end-final-scores");
    if (el) {
      el.innerHTML = (d.scores || []).map(function (row, i) {
        var medal = ["1.", "2.", "3."][i] || (i + 1) + ".";
        return '<div class="final-score-row"><span><span style="min-width:24px;display:inline-block">' +
          medal + "</span>" + esc(row.player) + "</span>" +
          '<span class="hearts" style="color:var(--acc)">' + hearts(row.score) + "</span></div>";
      }).join("");
    }
    var again = $("btn-play-again");
    if (again) again.classList.toggle("hidden", !isHost);
    showScreen("end");
  }
}());
