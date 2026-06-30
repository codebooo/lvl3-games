(function () {
  "use strict";

  // ── State ──
  var username = null;
  var roomCode = null;
  var isHost = false;
  var players = [];
  var host = "";
  var currentAvatars = {};

  var ROWS = 5, COLS = 5;
  // Default per-row values: board 0 = 100..500, board 1 (Double) = 200..1000.
  var DEFAULT_VALUES = [[100, 200, 300, 400, 500], [200, 400, 600, 800, 1000]];

  // Builder model (host, pre-start). boards[b].categories[c] = { name, cells:[{clue,answer,value,mediaType,mediaId}] }
  var builder = makeBuilder();
  var bldActiveBoard = 0;
  var bldEditing = null;            // { board, cat, row } currently in the modal
  var bldPendingMedia = null;       // { type, id } chosen in the modal, applied on save

  var lastState = null;             // last game:state data (for re-render after media load)

  var socket = window.lvl3.socket;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.lvl3.escapeHtml(String(s == null ? "" : s)); }
  function toast(m) { try { window.lvl3.showToast(m, "error"); } catch (e) {} }

  function showScreen(name) {
    var els = document.querySelectorAll(".screen");
    for (var i = 0; i < els.length; i++) els[i].classList.remove("active");
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }

  function makeBuilder() {
    var boards = [];
    for (var b = 0; b < 2; b++) {
      var cats = [];
      for (var c = 0; c < COLS; c++) {
        var cells = [];
        for (var r = 0; r < ROWS; r++) {
          cells.push({ clue: "", answer: "", value: DEFAULT_VALUES[b][r], mediaType: "none", mediaId: null });
        }
        cats.push({ name: "", cells: cells });
      }
      boards.push({ categories: cats });
    }
    return { boards: boards, finalEnabled: false, final: { category: "", clue: "", answer: "" } };
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

  // ── Global actions (onclick handlers in the HTML) ──
  window.createRoom = function () { socket.emit("room:create", { gameType: "jeopardy" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.leaveRoom = function () { socket.emit("room:leave"); roomCode = null; showScreen("join"); };

  var joinInput = $("join-code-input");
  if (joinInput) joinInput.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  // ── Room events ──
  socket.on("room:created", function (data) {
    roomCode = data.code; isHost = true; players = data.players || []; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    enterRoom();
  });
  socket.on("room:joined", function (data) {
    roomCode = data.code; isHost = !!data.isHost; players = data.players || []; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    enterRoom();
  });
  socket.on("room:error", function (data) {
    var err = $("join-error");
    if (err) err.textContent = (data && data.message) || "Fehler";
  });
  socket.on("room:players", function (data) {
    players = data.players || []; host = data.host;
    if (data.avatars) currentAvatars = data.avatars;
    renderPlayers();
  });
  socket.on("room:host-changed", function (data) {
    host = data.host; players = data.players || []; isHost = (host === username);
    if (data.avatars) currentAvatars = data.avatars;
    if (lastState) renderPlayers(); else enterRoom();
  });
  socket.on("room:settings-updated", function () { /* no per-room settings for jeopardy */ });
  socket.on("game:error", function (data) { toast((data && data.message) || "Fehler"); });

  function enterRoom() {
    var codeEl = $("room-code-display");
    if (codeEl) codeEl.textContent = roomCode || "––––";
    renderPlayers();
    // Host builds the board; guests wait in the lobby.
    if (isHost) { buildBuilder(); loadSavedList(); showScreen("builder"); }
    else showScreen("lobby");
  }

  function renderPlayers() {
    var scores = (lastState && lastState.scores) || {};
    window.lvl3.renderPlayerList($("player-list"), players, host, scores, currentAvatars);
    var codeEl = $("room-code-display");
    if (codeEl && roomCode) codeEl.textContent = roomCode;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BUILDER (host, before start)
  // ══════════════════════════════════════════════════════════════════════════
  function buildBuilder() {
    for (var b = 0; b < 2; b++) {
      renderBldCats(b);
      renderBldGrid(b);
    }
    var ft = $("bld-final-toggle");
    if (ft) ft.checked = builder.finalEnabled;
    syncFinalFields();
    bldShowBoard(bldActiveBoard);
  }

  function renderBldCats(b) {
    var el = $("bld-cats-" + b);
    if (!el) return;
    el.innerHTML = "";
    for (var c = 0; c < COLS; c++) {
      var inp = document.createElement("input");
      inp.className = "p-field";
      inp.placeholder = "Kategorie " + (c + 1);
      inp.value = builder.boards[b].categories[c].name;
      (function (board, cat, input) {
        input.addEventListener("input", function () { builder.boards[board].categories[cat].name = input.value; });
      })(b, c, inp);
      el.appendChild(inp);
    }
  }

  function renderBldGrid(b) {
    var el = $("bld-grid-" + b);
    if (!el) return;
    el.innerHTML = "";
    // Column-major so the grid reads category-by-category, top to bottom.
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cell = builder.boards[b].categories[c].cells[r];
        var filled = !!(cell.clue.trim() && cell.answer.trim());
        var div = document.createElement("div");
        div.className = "bld-cell " + (filled ? "filled" : "empty");
        div.innerHTML = '<div class="val">' + esc(cell.value) + '</div>' +
          '<div class="mark">' + (filled ? "Fertig" : "Leer") +
          (cell.mediaType && cell.mediaType !== "none" ? " · " + esc(cell.mediaType) : "") + '</div>';
        (function (board, cat, row) {
          div.addEventListener("click", function () { openCellModal(board, cat, row); });
        })(b, c, r);
        el.appendChild(div);
      }
    }
  }

  window.bldShowBoard = function (b) {
    bldActiveBoard = b;
    var tabs = document.querySelectorAll(".bld-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("active", tabs[i].getAttribute("data-board") === String(b));
    var boards = document.querySelectorAll(".bld-board");
    for (var j = 0; j < boards.length; j++) boards[j].classList.toggle("active", boards[j].getAttribute("data-board") === String(b));
  };

  window.bldToggleFinal = function () {
    var ft = $("bld-final-toggle");
    builder.finalEnabled = !!(ft && ft.checked);
    syncFinalFields();
  };

  function syncFinalFields() {
    var wrap = $("bld-final-fields");
    if (wrap) wrap.classList.toggle("active", builder.finalEnabled);
    setVal("bld-final-cat", builder.final.category);
    setVal("bld-final-clue", builder.final.clue);
    setVal("bld-final-answer", builder.final.answer);
  }
  function setVal(id, v) { var el = $(id); if (el) el.value = v || ""; }

  // ── Cell editor modal ──
  function openCellModal(b, c, r) {
    bldEditing = { board: b, cat: c, row: r };
    var cell = builder.boards[b].categories[c].cells[r];
    bldPendingMedia = { type: cell.mediaType || "none", id: cell.mediaId || null };
    setVal("cell-clue", cell.clue);
    setVal("cell-answer", cell.answer);
    setVal("cell-value", cell.value);
    var fileInp = $("cell-media");
    if (fileInp) fileInp.value = "";
    renderMediaMark();
    var title = $("cell-modal-title");
    if (title) title.textContent = (builder.boards[b].categories[c].name || ("Kategorie " + (c + 1))) + " · " + cell.value;
    var modal = $("cell-modal");
    if (modal) modal.classList.add("active");
  }

  window.closeCellModal = function () {
    var modal = $("cell-modal");
    if (modal) modal.classList.remove("active");
    bldEditing = null; bldPendingMedia = null;
  };

  window.clearCellMedia = function () {
    bldPendingMedia = { type: "none", id: null };
    var fileInp = $("cell-media");
    if (fileInp) fileInp.value = "";
    renderMediaMark();
  };

  window.saveCellModal = function () {
    if (!bldEditing) return;
    var cell = builder.boards[bldEditing.board].categories[bldEditing.cat].cells[bldEditing.row];
    var clue = $("cell-clue"), answer = $("cell-answer"), value = $("cell-value");
    cell.clue = clue ? clue.value.trim() : "";
    cell.answer = answer ? answer.value.trim() : "";
    var v = value ? parseInt(value.value, 10) : NaN;
    if (Number.isFinite(v)) cell.value = v;
    cell.mediaType = (bldPendingMedia && bldPendingMedia.type) || "none";
    cell.mediaId = (bldPendingMedia && bldPendingMedia.id) || null;
    var b = bldEditing.board;
    window.closeCellModal();
    renderBldGrid(b);
  };

  function renderMediaMark() {
    var mark = $("cell-media-mark"), preview = $("cell-media-preview");
    var t = bldPendingMedia && bldPendingMedia.type, id = bldPendingMedia && bldPendingMedia.id;
    if (mark) mark.textContent = (t && t !== "none" && id) ? (t + " gesetzt") : "Keine Medien";
    if (preview) {
      if (t === "image" && id) preview.innerHTML = '<img class="media-thumb" src="/api/jeopardy/media/' + esc(id) + '">';
      else if (t === "audio" && id) preview.innerHTML = '<audio controls style="width:100%" src="/api/jeopardy/media/' + esc(id) + '"></audio>';
      else preview.innerHTML = "";
    }
  }

  // Media upload: read file -> dataUrl -> POST /api/jeopardy/media -> store mediaId.
  var mediaInput = $("cell-media");
  if (mediaInput) {
    mediaInput.addEventListener("change", function () {
      var file = mediaInput.files && mediaInput.files[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) { toast("Datei zu groß (max. 15 MB)."); mediaInput.value = ""; return; }
      var type = file.type.indexOf("audio") === 0 ? "audio" : (file.type.indexOf("image") === 0 ? "image" : null);
      if (!type) { toast("Nur Bild- oder Audiodateien."); mediaInput.value = ""; return; }
      var reader = new FileReader();
      reader.onload = function () {
        fetch("/api/jeopardy/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: reader.result })
        }).then(function (res) {
          if (!res.ok) throw new Error("upload failed");
          return res.json();
        }).then(function (json) {
          if (!json || !json.mediaId) throw new Error("no mediaId");
          bldPendingMedia = { type: type, id: json.mediaId };
          renderMediaMark();
        }).catch(function () { toast("Upload fehlgeschlagen."); });
      };
      reader.readAsDataURL(file);
    });
  }

  // ── Save / load boards (REST) ──
  window.saveBoard = function () {
    var nameEl = $("bld-name");
    var name = nameEl ? nameEl.value.trim() : "";
    if (!name) { toast("Bitte einen Board-Namen eingeben."); return; }
    var game = collectGame();
    game.name = name;
    fetch("/api/jeopardy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: game })
    }).then(function (res) {
      if (!res.ok) throw new Error("save failed");
      return res.json();
    }).then(function () {
      window.lvl3.showToast("Board gespeichert.", "success");
      loadSavedList();
    }).catch(function () { toast("Speichern fehlgeschlagen."); });
  };

  function loadSavedList() {
    var sel = $("bld-load-select");
    if (!sel) return;
    fetch("/api/jeopardy").then(function (res) {
      if (!res.ok) throw new Error();
      return res.json();
    }).then(function (list) {
      var items = (list && list.boards) || list || [];
      sel.innerHTML = '<option value="">Gespeichertes Board laden…</option>';
      items.forEach(function (g) {
        var opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = g.name || g.id;
        sel.appendChild(opt);
      });
    }).catch(function () { /* no saved boards / route absent — silent */ });
  }

  window.loadSavedBoard = function () {
    var sel = $("bld-load-select");
    var id = sel ? sel.value : "";
    if (!id) { toast("Bitte ein gespeichertes Board wählen."); return; }
    fetch("/api/jeopardy/" + encodeURIComponent(id)).then(function (res) {
      if (!res.ok) throw new Error();
      return res.json();
    }).then(function (json) {
      var game = (json && json.game) || json;
      if (!game || !Array.isArray(game.boards)) throw new Error();
      adoptGame(game);
      buildBuilder();
      window.lvl3.showToast("Board geladen.", "success");
    }).catch(function () { toast("Laden fehlgeschlagen."); });
  };

  // Pull the live builder model out of the DOM-bound state into a handler-shaped game.
  function collectGame() {
    builder.final.category = ($("bld-final-cat") || {}).value || "";
    builder.final.clue = ($("bld-final-clue") || {}).value || "";
    builder.final.answer = ($("bld-final-answer") || {}).value || "";
    return {
      boards: builder.boards.map(function (board) {
        return {
          categories: board.categories.map(function (cat) {
            return {
              name: cat.name,
              cells: cat.cells.map(function (cell) {
                return {
                  clue: cell.clue, answer: cell.answer, value: cell.value,
                  mediaType: cell.mediaType || "none", mediaId: cell.mediaId || null
                };
              })
            };
          })
        };
      }),
      finalEnabled: !!builder.finalEnabled,
      final: { category: builder.final.category, clue: builder.final.clue, answer: builder.final.answer }
    };
  }

  // Replace the builder model from a loaded/saved game (fills any missing fields).
  function adoptGame(game) {
    var fresh = makeBuilder();
    for (var b = 0; b < 2; b++) {
      var src = game.boards[b];
      if (!src || !Array.isArray(src.categories)) continue;
      for (var c = 0; c < COLS; c++) {
        var sc = src.categories[c];
        if (!sc) continue;
        if (typeof sc.name === "string") fresh.boards[b].categories[c].name = sc.name;
        var scells = sc.cells || [];
        for (var r = 0; r < ROWS; r++) {
          var s = scells[r];
          if (!s) continue;
          var dst = fresh.boards[b].categories[c].cells[r];
          dst.clue = typeof s.clue === "string" ? s.clue : "";
          dst.answer = typeof s.answer === "string" ? s.answer : "";
          if (Number.isFinite(s.value)) dst.value = s.value;
          dst.mediaType = s.mediaType || "none";
          dst.mediaId = s.mediaId || null;
        }
      }
    }
    fresh.finalEnabled = !!game.finalEnabled;
    if (game.final) {
      fresh.final.category = game.final.category || "";
      fresh.final.clue = game.final.clue || "";
      fresh.final.answer = game.final.answer || "";
    }
    builder = fresh;
  }

  // Every cell must have a clue + answer before the host can start.
  function allCellsFilled() {
    for (var b = 0; b < 2; b++)
      for (var c = 0; c < COLS; c++)
        for (var r = 0; r < ROWS; r++) {
          var cell = builder.boards[b].categories[c].cells[r];
          if (!cell.clue.trim() || !cell.answer.trim()) return false;
        }
    return true;
  }

  window.startGame = function () {
    if (!allCellsFilled()) { toast("Spielbrett ist unvollständig — bitte alle Felder ausfüllen."); return; }
    if (builder.finalEnabled) {
      var f = builder.final;
      if (!f.category.trim() || !f.clue.trim() || !f.answer.trim()) {
        // sync from DOM in case fields changed but model not yet flushed
        collectGame();
        f = builder.final;
        if (!f.category.trim() || !f.clue.trim() || !f.answer.trim()) {
          toast("Final Jeopardy ist aktiviert, aber unvollständig."); return;
        }
      }
    }
    socket.emit("jeopardy:start", { game: collectGame() });
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  PLAY — authoritative game:state
  // ══════════════════════════════════════════════════════════════════════════
  // msg = { phase, data }
  //   phase ∈ lobby|board|clue|answer|reveal|final-wager|final-answer|final-reveal|end
  //   data  = { board, boardIndex, scores, contestants, host, current,
  //             buzzingOpen, currentBuzzer, buzzed, answerRevealed, final, winner }
  socket.on("game:state", function (msg) {
    var phase = msg && msg.phase;
    var data = (msg && msg.data) || {};

    if (phase === "lobby") {
      lastState = null;
      isHost = (host === username);
      enterRoom();
      return;
    }

    lastState = data;
    if (data.host) host = data.host;
    isHost = (host === username);
    renderPlayers();

    switch (phase) {
      case "board": renderBoard(data); showScreen("board"); break;
      case "clue":
      case "answer":
      case "reveal": renderClue(phase, data); showScreen("clue"); break;
      case "final-wager":
      case "final-answer":
      case "final-reveal": renderFinal(phase, data); showScreen("final"); break;
      case "end": renderEnd(data); showScreen("end"); break;
    }
  });

  function amContestant(data) {
    return data && Array.isArray(data.contestants) && data.contestants.indexOf(username) !== -1;
  }

  // ── BOARD ──
  function renderBoard(data) {
    var board = data.board || { categories: [] };
    var idx = $("board-idx");
    if (idx) idx.textContent = (data.boardIndex === 1 ? "Board 2 · Double" : "Board 1");
    var role = $("board-role");
    if (role) role.textContent = isHost ? "Du bist Host" : (amContestant(data) ? "Kandidat" : "Zuschauer");

    var cats = $("jp-cats");
    if (cats) {
      cats.innerHTML = "";
      (board.categories || []).forEach(function (cat) {
        var d = document.createElement("div");
        d.className = "jp-cat";
        d.textContent = cat.name || "";
        cats.appendChild(d);
      });
    }

    var grid = $("jp-grid");
    if (grid) {
      grid.innerHTML = "";
      var categories = board.categories || [];
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < categories.length; c++) {
          var cell = categories[c].cells[r];
          var div = document.createElement("div");
          var canPick = isHost && !cell.used;
          div.className = "jp-cell" + (cell.used ? " used" : "") + (canPick ? " pick" : "");
          div.textContent = cell.used ? "" : cell.value;
          if (canPick) {
            (function (cat, row) {
              div.addEventListener("click", function () { socket.emit("jeopardy:pick", { cat: cat, row: row }); });
            })(c, r);
          }
          grid.appendChild(div);
        }
      }
    }

    renderScoreboard($("board-scoreboard"), data, null);

    // Host controls under the board: advance to next board / final / end.
    var foot = $("board-foot");
    if (foot) {
      foot.innerHTML = "";
      if (isHost) {
        var label = data.boardIndex === 0 ? "Weiter zu Board 2" : "Final Jeopardy / Ende";
        var btn = document.createElement("button");
        btn.className = "p-btn p-btn-ghost p-btn-sm";
        btn.textContent = label;
        btn.addEventListener("click", function () { socket.emit("jeopardy:next-board"); });
        foot.appendChild(btn);
      }
    }
  }

  // ── CLUE / ANSWER / REVEAL ──
  function renderClue(phase, data) {
    var cur = data.current || {};
    var board = data.board || { categories: [] };
    var catName = (board.categories[cur.cat] && board.categories[cur.cat].name) || "";

    setText("clue-cat", catName);
    setText("clue-val", cur.value != null ? String(cur.value) : "");
    setText("clue-text", cur.clue || "");

    // Media (image / audio) for the active clue.
    var media = $("clue-media");
    if (media) {
      if (cur.mediaType === "image" && cur.mediaId)
        media.innerHTML = '<img src="/api/jeopardy/media/' + esc(cur.mediaId) + '">';
      else if (cur.mediaType === "audio" && cur.mediaId)
        media.innerHTML = '<audio controls src="/api/jeopardy/media/' + esc(cur.mediaId) + '"></audio>';
      else media.innerHTML = "";
    }

    // Answer is only present when the server reveals it (contestants never see it early).
    var ansEl = $("clue-answer");
    if (ansEl) ansEl.textContent = cur.answer ? ("Antwort: " + cur.answer) : "";

    // Buzz state line.
    var status = $("clue-buzzer-status");
    if (status) {
      if (data.currentBuzzer) status.textContent = data.currentBuzzer + " buzzert!";
      else if (data.buzzingOpen) status.textContent = "Buzzer offen!";
      else if (phase === "reveal") status.textContent = "Aufgelöst";
      else status.textContent = "Buzzer geschlossen";
    }

    // Contestant buzzer button.
    var buzzer = $("buzzer-btn");
    if (buzzer) {
      var contestant = amContestant(data);
      var alreadyBuzzed = Array.isArray(data.buzzed) && data.buzzed.indexOf(username) !== -1;
      var canBuzz = contestant && phase === "clue" && data.buzzingOpen && !data.currentBuzzer && !alreadyBuzzed;
      buzzer.style.display = (contestant && phase !== "reveal") ? "" : "none";
      buzzer.disabled = !canBuzz;
    }

    // Host controls depend on phase.
    var controls = $("clue-controls");
    if (controls) {
      controls.innerHTML = "";
      if (isHost) {
        if (phase === "clue") {
          if (!data.buzzingOpen) ctrlBtn(controls, "Buzzer öffnen", function () { socket.emit("jeopardy:open-buzz"); }, true);
          ctrlBtn(controls, "Clue auflösen", function () { socket.emit("jeopardy:close-clue"); }, false);
        } else if (phase === "answer") {
          ctrlBtn(controls, "Richtig", function () { socket.emit("jeopardy:judge", { correct: true }); }, true);
          ctrlBtn(controls, "Falsch", function () { socket.emit("jeopardy:judge", { correct: false }); }, false);
          ctrlBtn(controls, "Clue auflösen", function () { socket.emit("jeopardy:close-clue"); }, false);
        } else if (phase === "reveal") {
          ctrlBtn(controls, "Zurück zum Board", function () { socket.emit("jeopardy:back-to-board"); }, true);
        }
      }
    }

    renderScoreboard($("clue-scoreboard"), data, data.currentBuzzer);
  }

  function ctrlBtn(parent, label, onClick, primary) {
    var btn = document.createElement("button");
    btn.className = "p-btn " + (primary ? "p-btn-primary" : "p-btn-ghost") + " p-btn-sm";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    parent.appendChild(btn);
  }

  window.buzz = function () { socket.emit("jeopardy:buzz"); };

  // ── FINAL ──
  function renderFinal(phase, data) {
    var f = data.final || {};
    setText("final-cat", f.category || "");
    setText("final-clue", f.clue || "");

    var body = $("final-body");
    var list = $("final-list");
    var controls = $("final-controls");
    if (list) list.innerHTML = "";
    if (controls) controls.innerHTML = "";
    if (body) body.innerHTML = "";

    var contestant = amContestant(data);

    if (phase === "final-wager") {
      if (body && contestant) {
        var myScore = (data.scores && data.scores[username]) || 0;
        var wagered = f.wagers && f.wagers[username] != null;
        if (wagered) {
          body.innerHTML = '<div class="p-sub">Einsatz abgegeben: ' + esc(f.wagers[username]) + '</div>';
        } else {
          body.innerHTML =
            '<div class="p-sub" style="margin-bottom:10px">Dein Punktestand: ' + esc(myScore) + ' · max. Einsatz: ' + esc(Math.max(0, myScore)) + '</div>' +
            '<input class="p-field" id="final-wager-input" type="number" min="0" max="' + esc(Math.max(0, myScore)) + '" placeholder="Einsatz">' +
            '<button class="p-btn p-btn-primary p-btn-sm" id="final-wager-btn" style="margin-top:12px">Einsatz abgeben</button>';
          var wb = $("final-wager-btn");
          if (wb) wb.addEventListener("click", function () {
            var inp = $("final-wager-input");
            var amt = inp ? parseInt(inp.value, 10) : NaN;
            if (!Number.isFinite(amt)) { toast("Bitte einen Einsatz eingeben."); return; }
            socket.emit("jeopardy:final-wager", { amount: amt });
          });
        }
      } else if (body) {
        body.innerHTML = '<div class="p-sub">Kandidaten setzen ihre Einsätze…</div>';
      }
    } else if (phase === "final-answer") {
      if (body && contestant) {
        var answered = f.answers && f.answers[username] != null;
        if (answered) {
          body.innerHTML = '<div class="p-sub">Antwort abgegeben.</div>';
        } else {
          body.innerHTML =
            '<input class="p-field" id="final-answer-input" placeholder="Deine Antwort">' +
            '<button class="p-btn p-btn-primary p-btn-sm" id="final-answer-btn" style="margin-top:12px">Antwort abgeben</button>';
          var ab = $("final-answer-btn");
          if (ab) ab.addEventListener("click", function () {
            var inp = $("final-answer-input");
            socket.emit("jeopardy:final-answer", { text: inp ? inp.value : "" });
          });
        }
      } else if (body) {
        body.innerHTML = '<div class="p-sub">Kandidaten beantworten die Frage…</div>';
      }
    } else if (phase === "final-reveal") {
      if (body) body.innerHTML = '<div class="clue-answer">Lösung: ' + esc(f.answer || "") + '</div>';
      // Host judges each contestant's submitted answer.
      if (list) {
        (data.contestants || []).forEach(function (u) {
          var li = document.createElement("li");
          var ans = (f.answers && f.answers[u] != null) ? f.answers[u] : "";
          var wager = (f.wagers && f.wagers[u] != null) ? f.wagers[u] : 0;
          var judged = f.judged && f.judged[u];
          var nameSpan = '<span class="fl-name">' + esc(u) + '</span>';
          var metaSpan = '<span class="fl-meta">"' + esc(ans) + '" · Einsatz ' + esc(wager) + '</span>';
          li.innerHTML = nameSpan + metaSpan;
          if (isHost && !judged) {
            var judge = document.createElement("span");
            judge.className = "fl-judge";
            var ok = document.createElement("button");
            ok.className = "p-btn p-btn-primary p-btn-sm";
            ok.textContent = "✓";
            ok.addEventListener("click", (function (user) { return function () { socket.emit("jeopardy:final-judge", { username: user, correct: true }); }; })(u));
            var no = document.createElement("button");
            no.className = "p-btn p-btn-ghost p-btn-sm";
            no.textContent = "✗";
            no.addEventListener("click", (function (user) { return function () { socket.emit("jeopardy:final-judge", { username: user, correct: false }); }; })(u));
            judge.appendChild(ok); judge.appendChild(no);
            li.appendChild(judge);
          } else if (judged) {
            var done = document.createElement("span");
            done.className = "fl-meta";
            done.textContent = "✓ gewertet";
            li.appendChild(done);
          }
          list.appendChild(li);
        });
      }
    }
  }

  // ── END ──
  function renderEnd(data) {
    var name = $("winner-name"), sub = $("end-sub");
    if (data.winner === "tie") {
      if (name) name.textContent = "Unentschieden";
      if (sub) sub.textContent = "Mehrere Kandidaten an der Spitze";
    } else if (data.winner) {
      if (name) name.textContent = data.winner + " gewinnt!";
      if (sub) sub.textContent = (data.winner === username) ? "Stark gespielt!" : "Viel Glück beim nächsten Mal";
      if (data.winner === username) { try { window.lvl3.playSound("correct"); } catch (e) {} }
    } else {
      if (name) name.textContent = "Spiel beendet";
      if (sub) sub.textContent = "";
    }
    renderScoreboard($("end-scoreboard"), data, null);
    var btn = $("btn-play-again");
    if (btn) btn.style.display = isHost ? "" : "none";
  }

  window.playAgain = function () { socket.emit("jeopardy:restart"); };

  // ── Scoreboard (contestants + scores; highlight the current buzzer) ──
  function renderScoreboard(el, data, buzzer) {
    if (!el) return;
    var contestants = data.contestants || [];
    var scores = data.scores || {};
    var sorted = contestants.slice().sort(function (a, b) { return (scores[b] || 0) - (scores[a] || 0); });
    el.innerHTML = sorted.map(function (u) {
      return '<li' + (u === buzzer ? ' class="is-buzzer"' : "") + '>' +
        '<span class="sb-name">' + esc(u) + (u === username ? " (Du)" : "") + '</span>' +
        '<span class="sb-score">' + esc(scores[u] || 0) + '</span>' +
        '</li>';
    }).join("");
  }

  function setText(id, v) { var el = $(id); if (el) el.textContent = v || ""; }

}());
