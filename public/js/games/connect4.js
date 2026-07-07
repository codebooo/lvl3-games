(function () {
  "use strict";

  // ── State ──
  var username = null;
  var roomCode = null;
  var isHost = false;
  var players = [];
  var host = "";
  var currentAvatars = {};

  var ROWS = 6, COLS = 7;
  // board[row][col], row 0 = TOP, values 0 (empty) | 1 | 2
  var board = emptyBoard();
  var endScreenTimer = null; // pending end-screen reveal timeout
  var seats = {};          // { 1: userA, 2: userB }
  var mySeat = null;       // 1 | 2 | null (spectator/not seated)
  var current = 1;         // whose turn (1|2)
  var gameOver = false;
  var animating = false;   // block input while a chip is falling

  var socket = window.lvl3.socket;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.lvl3.escapeHtml(String(s == null ? "" : s)); }
  function emptyBoard() {
    var b = [];
    for (var r = 0; r < ROWS; r++) { var row = []; for (var c = 0; c < COLS; c++) row.push(0); b.push(row); }
    return b;
  }
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
  });

  // ── Global actions ──
  window.createRoom = function () { socket.emit("room:create", { gameType: "connect4" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.leaveRoom = function () { socket.emit("room:leave"); roomCode = null; showScreen("join"); };
  window.startGame = function () { socket.emit("connect4:start"); };
  window.playAgain = function () { socket.emit("connect4:restart"); };

  var joinInput = $("join-code-input");
  if (joinInput) joinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

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
  socket.on("room:error", function (data) { var err = $("join-error"); if (err) err.textContent = (data && data.message) || "Fehler"; });
  socket.on("room:players", function (data) { players = data.players || []; host = data.host; if (data.avatars) currentAvatars = data.avatars; renderLobby(); });
  socket.on("room:host-changed", function (data) { host = data.host; players = data.players || []; isHost = (host === username); if (data.avatars) currentAvatars = data.avatars; renderLobby(); });
  socket.on("game:error", function (data) { window.lvl3.showToast((data && data.message) || "Fehler", "error"); });

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
    // 4 Gewinnt is exactly 1v1 → need exactly 2 players to start
    var btn = $("btn-start");
    if (btn) btn.disabled = players.length !== 2;
    var hint = $("start-hint");
    if (hint) hint.textContent = players.length < 2 ? "Genau 2 Spieler erforderlich" :
      (players.length > 2 ? "Zu viele Spieler — 4 Gewinnt ist 1 gegen 1" : "Bereit zum Start");
  }

  // ── Game state (authoritative) ──
  // msg = { phase, data }
  //   phase ∈ "lobby" | "playing" | "end"
  //   data  = { board (6x7, row0=top, 0/1/2), seats {1,2}, current (1|2),
  //             lastMove {col,row,player}|null, winner (null|0|1|2; 0=draw),
  //             winningCells [[r,c]x4] }
  socket.on("game:state", function (msg) {
    var phase = msg && msg.phase;
    var data = (msg && msg.data) || {};

    // Cancel any pending end-screen reveal so a late "end" timeout can't slap the
    // end screen back over a lobby/restart that arrived within its 900ms window.
    if (endScreenTimer) { clearTimeout(endScreenTimer); endScreenTimer = null; }

    if (phase === "lobby") { board = emptyBoard(); gameOver = false; enterLobby(); return; }

    // adopt seats / current / over flag
    if (data.seats) seats = data.seats;
    mySeat = seatOf(username);
    current = data.current || current;
    var winner = (typeof data.winner === "undefined") ? null : data.winner;

    var newBoard = normalizeBoard(data.board);

    if (phase === "playing" || phase === "end") {
      gameOver = (phase === "end");
      showScreen("game");
      ensureBoardBuilt();
      updateSeatLabels();

      var lm = data.lastMove || null;
      // Detect whether the incoming board has a genuinely new chip we should animate.
      var isNew = lm && typeof lm.col === "number" && typeof lm.row === "number" &&
                  cellEmptyInDom(lm.row, lm.col) && newBoard[lm.row][lm.col] !== 0;

      board = newBoard;

      if (isNew) {
        animating = true;
        updateTurnIndicator(true); // lock input during fall
        animateDrop(lm.col, lm.row, newBoard[lm.row][lm.col], function () {
          animating = false;
          paintBoard(); // settle the chip + paint the rest
          finishState(phase, winner, data.winningCells);
        });
      } else {
        paintBoard();
        finishState(phase, winner, data.winningCells);
      }
      return;
    }
  });

  function finishState(phase, winner, winningCells) {
    if (phase === "end") {
      highlightWin(winningCells);
      updateTurnIndicator(false);
      renderEnd(winner);
    } else {
      updateTurnIndicator(false);
    }
  }

  function seatOf(name) {
    if (!seats) return null;
    if (seats[1] === name || seats["1"] === name) return 1;
    if (seats[2] === name || seats["2"] === name) return 2;
    return null;
  }

  function normalizeBoard(b) {
    var out = emptyBoard();
    if (!b) return out;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var v = (b[r] && typeof b[r][c] !== "undefined") ? b[r][c] : 0;
        out[r][c] = (v === 1 || v === 2) ? v : 0;
      }
    }
    return out;
  }

  // ── Board DOM ──
  function ensureBoardBuilt() {
    var el = $("c4-board");
    if (!el || el.childElementCount) return;
    var html = "";
    for (var c = 0; c < COLS; c++) {
      html += '<div class="c4-col" data-col="' + c + '">';
      for (var r = 0; r < ROWS; r++) {
        html += '<div class="c4-cell" data-row="' + r + '" data-col="' + c + '">' +
                  '<div class="c4-hole"></div>' +
                '</div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;

    // whole column is the hit target
    el.addEventListener("click", function (e) {
      var col = e.target && e.target.closest ? e.target.closest(".c4-col") : null;
      if (!col) return;
      var c = parseInt(col.getAttribute("data-col"), 10);
      tryDrop(c);
    });
  }

  function cellEl(r, c) {
    var el = $("c4-board");
    if (!el) return null;
    return el.querySelector('.c4-cell[data-row="' + r + '"][data-col="' + c + '"]');
  }

  // true if no settled chip currently exists in that DOM cell
  function cellEmptyInDom(r, c) {
    var cell = cellEl(r, c);
    return cell && !cell.querySelector(".c4-chip");
  }

  function tryDrop(col) {
    if (gameOver || animating) return;
    if (mySeat == null || current !== mySeat) return; // not your turn / spectator
    if (col < 0 || col >= COLS) return;
    if (board[0][col] !== 0) return; // column full (top occupied)
    socket.emit("connect4:drop", { col: col });
    // do NOT place locally — wait for authoritative game:state
  }

  // Paint every settled chip from the authoritative board (static).
  function paintBoard() {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cell = cellEl(r, c);
        if (!cell) continue;
        var existing = cell.querySelector(".c4-chip");
        var v = board[r][c];
        if (v === 0) {
          if (existing) existing.parentNode.removeChild(existing);
        } else {
          if (!existing) {
            existing = document.createElement("div");
            existing.className = "c4-chip";
            cell.appendChild(existing);
          }
          existing.className = "c4-chip " + (v === 1 ? "p1" : "p2");
        }
      }
    }
  }

  // ── GRAVITY DROP ──
  // A chip is spawned above the board at the target column and falls with
  // accelerating (gravity-like) motion, then collides exactly on top of the
  // stack at lastMove.row with a small settle/bounce. It never passes through.
  function animateDrop(col, row, player, done) {
    var boardEl = $("c4-board");
    var target = cellEl(row, col);
    if (!boardEl || !target) { if (done) done(); return; }

    var boardRect = boardEl.getBoundingClientRect();
    var cellRect = target.getBoundingClientRect();

    // chip size matches a settled chip (.c4-chip = 78% of cell)
    var size = cellRect.width * 0.78;
    // final resting position relative to board (top-left of the chip)
    var endLeft = (cellRect.left - boardRect.left) + (cellRect.width - size) / 2;
    var endTop = (cellRect.top - boardRect.top) + (cellRect.height - size) / 2;
    // start above the board so it visually falls in from the top of the column
    var startTop = -size - 6;

    var faller = document.createElement("div");
    faller.className = "c4-falling " + (player === 1 ? "p1" : "p2");
    faller.style.width = size + "px";
    faller.style.height = size + "px";
    faller.style.left = endLeft + "px";
    faller.style.top = startTop + "px";
    boardEl.appendChild(faller);

    function cleanup() {
      // hand off to a real settled chip in the cell, remove the faller
      var cell = cellEl(row, col);
      if (cell && !cell.querySelector(".c4-chip")) {
        var chip = document.createElement("div");
        chip.className = "c4-chip " + (player === 1 ? "p1" : "p2");
        cell.appendChild(chip);
      }
      if (faller.parentNode) faller.parentNode.removeChild(faller);
      if (done) done();
    }

    var distance = endTop - startTop;
    // duration scales with fall distance so deep drops feel heavier
    var fallDur = Math.min(0.62, 0.34 + (row + 1) * 0.04);

    if (window.gsap) {
      var tl = window.gsap.timeline({ onComplete: cleanup });
      // accelerate under gravity (power2.in), collide at the stack
      tl.to(faller, { top: endTop, duration: fallDur, ease: "power2.in" });
      // tiny bounce/settle on collision — overshoot up a hair, then rest
      tl.to(faller, { top: endTop - size * 0.10, duration: 0.10, ease: "power2.out" });
      tl.to(faller, { top: endTop, duration: 0.14, ease: "bounce.out" });
    } else {
      // requestAnimationFrame fallback with quadratic (gravity) easing + bounce
      var t0 = null;
      var bounceUp = size * 0.10;
      var total = fallDur * 1000 + 240;
      function frame(ts) {
        if (t0 === null) t0 = ts;
        var t = ts - t0;
        var fallMs = fallDur * 1000;
        if (t < fallMs) {
          var p = t / fallMs;
          faller.style.top = (startTop + distance * (p * p)) + "px"; // accelerating
        } else if (t < fallMs + 110) {
          var p2 = (t - fallMs) / 110;
          faller.style.top = (endTop - bounceUp * Math.sin(p2 * Math.PI)) + "px";
        } else {
          faller.style.top = endTop + "px";
        }
        if (t < total) requestAnimationFrame(frame); else cleanup();
      }
      requestAnimationFrame(frame);
    }
  }

  // ── Turn indicator ──
  function updateTurnIndicator(locked) {
    var line = $("turn-line"), txt = $("turn-text"), dot = line ? line.querySelector(".dot") : null;
    var boardEl = $("c4-board");
    var myTurn = (!gameOver && !locked && mySeat != null && current === mySeat);

    if (dot) dot.className = "dot " + (current === 1 ? "p1" : "p2");
    if (line) line.classList.toggle("mine", myTurn);

    if (txt) {
      if (gameOver) txt.textContent = "Spiel beendet";
      else if (mySeat == null) txt.textContent = (current === 1 ? "Spieler 1" : "Spieler 2") + " ist dran";
      else if (current === mySeat) txt.textContent = "Du bist dran";
      else txt.textContent = "Gegner ist dran";
    }

    // enable the column hit targets / hover highlight only on your turn
    if (boardEl) {
      boardEl.classList.toggle("interactive", myTurn);
      boardEl.classList.remove("col-p1", "col-p2");
      // tint hover to the player's chip color
      var cols = boardEl.querySelectorAll(".c4-col");
      for (var i = 0; i < cols.length; i++) {
        cols[i].classList.remove("col-p1", "col-p2");
        if (myTurn) cols[i].classList.add(mySeat === 1 ? "col-p1" : "col-p2");
      }
    }
  }

  function updateSeatLabels() {
    var n1 = $("seat-1-name"), n2 = $("seat-2-name");
    var s1 = seats[1] || seats["1"] || "Spieler 1";
    var s2 = seats[2] || seats["2"] || "Spieler 2";
    if (n1) n1.textContent = s1 + (mySeat === 1 ? " (Du)" : "");
    if (n2) n2.textContent = s2 + (mySeat === 2 ? " (Du)" : "");
    var seat1 = $("seat-1"), seat2 = $("seat-2");
    if (seat1) seat1.classList.toggle("active", !gameOver && current === 1);
    if (seat2) seat2.classList.toggle("active", !gameOver && current === 2);
  }

  // ── Win highlight ──
  function highlightWin(cells) {
    if (!cells || !cells.length) return;
    for (var i = 0; i < cells.length; i++) {
      var rc = cells[i];
      if (!rc) continue;
      var cell = cellEl(rc[0], rc[1]);
      var chip = cell ? cell.querySelector(".c4-chip") : null;
      if (chip) chip.classList.add("win");
    }
  }

  // ── End screen ──
  function renderEnd(winner) {
    var name = $("winner-name"), sub = $("end-sub");
    if (winner === 0) {
      if (name) name.textContent = "Unentschieden";
      if (sub) sub.textContent = "Das Brett ist voll";
    } else {
      var w = winner === 1 ? (seats[1] || seats["1"] || "Spieler 1") : (seats[2] || seats["2"] || "Spieler 2");
      if (name) name.textContent = w + " gewinnt!";
      if (sub) sub.textContent = (winner === mySeat) ? "Stark gespielt!" : "Viel Glück beim nächsten Mal";
      if (winner === mySeat) { try { window.lvl3.playSound("correct"); } catch (e) {} }
    }
    var btn = $("btn-play-again");
    if (btn) btn.style.display = isHost ? "" : "none";
    // brief delay so the winning chips' pulse is visible before switching screens
    if (endScreenTimer) clearTimeout(endScreenTimer);
    endScreenTimer = setTimeout(function () { endScreenTimer = null; showScreen("end"); }, gameOver ? 900 : 0);
  }

}());
