// Jeopardy — authoritative handler. The room HOST is a non-scoring game master
// (builds the boards, picks cells, opens buzzing, judges). Contestants = the
// room's players minus the host; they buzz and answer. Server owns scoring,
// buzz order, and which cell answers are revealed — clients are never trusted.
//
// Two 5x5 boards: board 0 (100..500 per row), board 1 "Double" (200..1000).
// Buzz scoring for a cell worth V: the FIRST buzzer earns +V (correct) or
// -0.5V (wrong); any LATER buzzer earns +0.5V (correct) or -0.5V (wrong).
// Answers are only ever sent to clients once the cell is resolved.
const stats = require("../stats");

const ROWS = 5;
const COLS = 5;

// Contestants are everyone in the room except the host (the game master).
function contestantsOf(r) {
  return r.players.filter(function (u) { return u !== r.host; });
}

// Validate a saved/inline game has two fully-filled 5x5 boards.
function boardsFilled(game) {
  if (!game || !Array.isArray(game.boards) || game.boards.length !== 2) return false;
  for (const board of game.boards) {
    if (!board || !Array.isArray(board.categories) || board.categories.length !== COLS) return false;
    for (const cat of board.categories) {
      if (!cat || !Array.isArray(cat.cells) || cat.cells.length !== ROWS) return false;
      for (const cell of cat.cells) {
        if (!cell || typeof cell.clue !== "string" || !cell.clue.trim()) return false;
        if (typeof cell.answer !== "string" || !cell.answer.trim()) return false;
      }
    }
  }
  return true;
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "jeopardy") return null;
    return r;
  }

  function isHost(r) {
    return r && r.host === socket.username;
  }

  function isContestant(r) {
    return r && r.players.includes(socket.username) && socket.username !== r.host;
  }

  // ── jeopardy:start ──────────────────────────────────────────────────────────
  socket.on("jeopardy:start", function (payload) {
    const r = myRoom();
    if (!isHost(r) || r.started) return;
    if (r.players.length < 4) {
      socket.emit("game:error", { message: "Jeopardy braucht mindestens 4 Spieler (1 Host + 3 Kandidaten)." });
      return;
    }

    // Load by saved id, or accept an inline game object.
    let game = null;
    if (payload && payload.gameId) {
      const saved = (store.get("jeopardyBoards") || []).find(function (g) { return g.id === payload.gameId; });
      // Owner-only: the HTTP GET route enforces this; the socket path must too,
      // or a user could load someone else's private board (clues + answers).
      if (saved && saved.owner !== socket.username) {
        socket.emit("game:error", { message: "Kein Zugriff auf dieses Spielbrett." });
        return;
      }
      if (saved) game = saved;
    } else if (payload && payload.game) {
      game = payload.game;
    }
    if (!boardsFilled(game)) {
      socket.emit("game:error", { message: "Spielbrett ist unvollständig — bitte alle Felder ausfüllen." });
      return;
    }

    const scores = {};
    contestantsOf(r).forEach(function (u) { scores[u] = 0; });

    r.gameData = {
      game: game,
      boardIndex: 0,
      // used[boardIndex][cat][row] — independent per board.
      used: [makeUsedGrid(), makeUsedGrid()],
      scores: scores,
      phase: "board",
      current: null,         // {cat,row,value,boardIndex}
      buzzed: [],            // contestants who already buzzed THIS cell
      firstBuzzer: null,     // first contestant to buzz this cell (gets full value)
      currentBuzzer: null,   // contestant currently being judged
      buzzingOpen: false,
      answerRevealed: false,
      final: null,           // {wagers:{}, answers:{}, judged:{}, revealed:bool}
      winner: null,
      recorded: false
    };
    r.started = true;
    emitState(socket.roomCode);
  });

  // ── jeopardy:pick ──────────────────────────────────────────────────────────
  socket.on("jeopardy:pick", function (payload) {
    const r = myRoom();
    if (!isHost(r) || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "board") return;
    const cat = payload && payload.cat, row = payload && payload.row;
    if (!cellInRange(cat, row)) return;
    if (gd.used[gd.boardIndex][cat][row]) return;

    const cell = gd.game.boards[gd.boardIndex].categories[cat].cells[row];
    gd.current = { cat: cat, row: row, value: cell.value, boardIndex: gd.boardIndex };
    gd.buzzed = [];
    gd.firstBuzzer = null;
    gd.currentBuzzer = null;
    gd.buzzingOpen = false;
    gd.answerRevealed = false;
    gd.phase = "clue";
    emitState(socket.roomCode);
  });

  // ── jeopardy:open-buzz ───────────────────────────────────────────────────────
  socket.on("jeopardy:open-buzz", function () {
    const r = myRoom();
    if (!isHost(r) || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "clue" || !gd.current) return;
    gd.buzzingOpen = true;
    emitState(socket.roomCode);
  });

  // ── jeopardy:buzz ────────────────────────────────────────────────────────────
  socket.on("jeopardy:buzz", function () {
    const r = myRoom();
    if (!isContestant(r) || !r.gameData) return;
    const gd = r.gameData;
    if (!gd.buzzingOpen || gd.phase !== "clue") return;       // buzzing closed
    if (gd.buzzed.indexOf(socket.username) !== -1) return;     // already buzzed this cell
    if (gd.currentBuzzer) return;                              // someone holds the buzz
    gd.currentBuzzer = socket.username;
    if (!gd.firstBuzzer) gd.firstBuzzer = socket.username;     // remember the first ever buzzer
    gd.buzzingOpen = false;
    gd.phase = "answer";
    emitState(socket.roomCode);
  });

  // ── jeopardy:judge ───────────────────────────────────────────────────────────
  socket.on("jeopardy:judge", function (payload) {
    const r = myRoom();
    if (!isHost(r) || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "answer" || !gd.current || !gd.currentBuzzer) return;
    const correct = !!(payload && payload.correct);
    const V = gd.current.value;
    const buzzer = gd.currentBuzzer;
    const isFirst = buzzer === gd.firstBuzzer;

    let delta;
    if (correct) delta = isFirst ? V : Math.round(0.5 * V);
    else delta = -Math.round(0.5 * V);
    gd.scores[buzzer] = (gd.scores[buzzer] || 0) + delta;

    if (gd.buzzed.indexOf(buzzer) === -1) gd.buzzed.push(buzzer);
    gd.currentBuzzer = null;

    const total = contestantsOf(r).length;
    if (correct || gd.buzzed.length >= total) {
      // Resolved: reveal the answer, mark the cell used, return to the board.
      gd.answerRevealed = true;
      gd.used[gd.current.boardIndex][gd.current.cat][gd.current.row] = true;
      gd.phase = "reveal";
    } else {
      // Wrong with contestants left → reopen buzzing for the same clue.
      gd.phase = "clue";
      gd.buzzingOpen = true;
    }
    emitState(socket.roomCode);
  });

  // ── jeopardy:close-clue ───────────────────────────────────────────────────────
  // Host gives up on the clue: reveal the answer, mark used, no score change.
  socket.on("jeopardy:close-clue", function () {
    const r = myRoom();
    if (!isHost(r) || !r.gameData) return;
    const gd = r.gameData;
    if (!gd.current || (gd.phase !== "clue" && gd.phase !== "answer")) return;
    gd.answerRevealed = true;
    gd.currentBuzzer = null;
    gd.buzzingOpen = false;
    gd.used[gd.current.boardIndex][gd.current.cat][gd.current.row] = true;
    gd.phase = "reveal";
    emitState(socket.roomCode);
  });

  // ── jeopardy:back-to-board ─────────────────────────────────────────────────────
  // Host dismisses a revealed clue and returns to the board grid.
  socket.on("jeopardy:back-to-board", function () {
    const r = myRoom();
    if (!isHost(r) || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "reveal") return;
    gd.current = null;
    gd.buzzed = [];
    gd.firstBuzzer = null;
    gd.currentBuzzer = null;
    gd.buzzingOpen = false;
    gd.answerRevealed = false;
    gd.phase = "board";
    emitState(socket.roomCode);
  });

  // ── jeopardy:next-board ────────────────────────────────────────────────────────
  socket.on("jeopardy:next-board", function () {
    const r = myRoom();
    if (!isHost(r) || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "board") return;
    if (gd.boardIndex === 0) {
      gd.boardIndex = 1;
      emitState(socket.roomCode);
      return;
    }
    // Past the last board → Final Jeopardy or end.
    if (gd.game.finalEnabled && gd.game.final) {
      gd.phase = "final-wager";
      gd.final = { wagers: {}, answers: {}, judged: {}, revealed: false };
    } else {
      endGame(r);
    }
    emitState(socket.roomCode);
  });

  // ── Final Jeopardy ─────────────────────────────────────────────────────────────
  socket.on("jeopardy:final-wager", function (payload) {
    const r = myRoom();
    if (!isContestant(r) || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "final-wager" || !gd.final) return;
    let amount = payload && Number(payload.amount);
    if (!Number.isFinite(amount)) return;
    // Clamp to 0..own score (negative scores can wager nothing).
    const max = Math.max(0, gd.scores[socket.username] || 0);
    amount = Math.max(0, Math.min(Math.round(amount), max));
    gd.final.wagers[socket.username] = amount;
    // Once every contestant has wagered, move to the answer phase.
    if (contestantsOf(r).every(function (u) { return gd.final.wagers[u] != null; })) {
      gd.phase = "final-answer";
    }
    emitState(socket.roomCode);
  });

  socket.on("jeopardy:final-answer", function (payload) {
    const r = myRoom();
    if (!isContestant(r) || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "final-answer" || !gd.final) return;
    const text = payload && typeof payload.text === "string" ? payload.text.slice(0, 500) : "";
    gd.final.answers[socket.username] = text;
    if (contestantsOf(r).every(function (u) { return gd.final.answers[u] != null; })) {
      gd.phase = "final-reveal";
      gd.final.revealed = true;
    }
    emitState(socket.roomCode);
  });

  socket.on("jeopardy:final-judge", function (payload) {
    const r = myRoom();
    if (!isHost(r) || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "final-reveal" || !gd.final) return;
    const username = payload && payload.username;
    if (!username || contestantsOf(r).indexOf(username) === -1) return;
    if (gd.final.judged[username]) return;                  // judge each contestant once
    const wager = gd.final.wagers[username] || 0;
    gd.scores[username] = (gd.scores[username] || 0) + (payload.correct ? wager : -wager);
    gd.final.judged[username] = true;
    if (contestantsOf(r).every(function (u) { return gd.final.judged[u]; })) {
      endGame(r);
    }
    emitState(socket.roomCode);
  });

  // ── jeopardy:restart ───────────────────────────────────────────────────────────
  socket.on("jeopardy:restart", function () {
    const r = myRoom();
    if (!isHost(r)) return;
    r.started = false;
    r.gameData = {};
    io.to(socket.roomCode).emit("game:state", { phase: "lobby", data: {} });
  });

  // ── helpers ──────────────────────────────────────────────────────────────────
  function makeUsedGrid() {
    const grid = [];
    for (let c = 0; c < COLS; c++) {
      const col = [];
      for (let row = 0; row < ROWS; row++) col.push(false);
      grid.push(col);
    }
    return grid;
  }

  function cellInRange(cat, row) {
    // Must be integers — a fractional index (e.g. cat:1.5) passed the old
    // typeof/range check then threw on used[bi][1.5][row] (undefined deref).
    return Number.isInteger(cat) && Number.isInteger(row) &&
           cat >= 0 && cat < COLS && row >= 0 && row < ROWS;
  }

  // Compute winner(s) and record stats once. Contestants only (host never scores).
  function endGame(r) {
    const gd = r.gameData;
    gd.phase = "end";
    if (gd.recorded) return;
    gd.recorded = true;
    r.started = false;

    const cs = contestantsOf(r);
    if (cs.length < 2) return;     // recordGameResult needs >=2 entries
    const sortedScores = cs
      .map(function (u) { return { username: u, score: gd.scores[u] || 0 }; })
      .sort(function (a, b) { return b.score - a.score; });
    const top = sortedScores[0].score;
    const winners = sortedScores.filter(function (s) { return s.score === top; }).map(function (s) { return s.username; });
    gd.winner = winners.length === 1 ? winners[0] : "tie";
    try { stats.recordGameResult("jeopardy", sortedScores, winners); } catch (e) {}
  }

  // Build the client-facing board: category names + per-cell value/used, and the
  // clue/answer/media ONLY for the cell currently in play (and only its answer
  // once revealed). Unrevealed answers are never sent.
  function clientBoard(gd) {
    const board = gd.game.boards[gd.boardIndex];
    const used = gd.used[gd.boardIndex];
    return {
      categories: board.categories.map(function (cat, ci) {
        return {
          name: cat.name,
          cells: cat.cells.map(function (cell, ri) {
            return { value: cell.value, used: !!used[ci][ri] };
          })
        };
      })
    };
  }

  function emitState(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.gameData.game) return;
    const gd = r.gameData;

    let current = null;
    if (gd.current) {
      const cell = gd.game.boards[gd.current.boardIndex].categories[gd.current.cat].cells[gd.current.row];
      current = {
        cat: gd.current.cat,
        row: gd.current.row,
        value: gd.current.value,
        clue: cell.clue,
        mediaType: cell.mediaType || "none",
        mediaId: cell.mediaId || null,
        // Answer only once the cell is resolved/revealed.
        answer: gd.answerRevealed ? cell.answer : null
      };
    }

    let final = null;
    if (gd.final) {
      const f = gd.game.final || {};
      final = {
        category: f.category || "",
        // Clue is shown during wager/answer; the answer text only at reveal.
        clue: f.clue || "",
        answer: gd.final.revealed ? (f.answer || "") : null,
        wagers: gd.final.wagers,
        // Answers only surfaced at reveal time (host judges from them).
        answers: gd.final.revealed ? gd.final.answers : {},
        judged: gd.final.judged
      };
    }

    const data = {
      phase: gd.phase,
      boardIndex: gd.boardIndex,
      board: clientBoard(gd),
      scores: gd.scores,
      contestants: contestantsOf(r),
      host: r.host,
      current: current,
      buzzingOpen: gd.buzzingOpen,
      currentBuzzer: gd.currentBuzzer,
      buzzed: gd.buzzed,
      answerRevealed: gd.answerRevealed,
      final: final,
      winner: gd.winner
    };
    io.to(code).emit("game:state", { phase: gd.phase, data: data });
  }
};

// store is required lazily at module scope so jeopardy:start can read saved boards.
const store = require("../store");
