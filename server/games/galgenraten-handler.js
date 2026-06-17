// Galgenraten (Hangman) — Solo, Team "Wort wählen" (each side sets a word for the
// other; faster guesser wins) and Team "Zufalls-Rennen" (same random word, race).
const stats = require("../stats");

let WORDS = { easy: [], normal: [], hard: [] };
try { WORDS = require("../../data/galgenraten-words.json"); } catch (e) { /* fallback below */ }

const FALLBACK   = ["GALGENRATEN", "COMPUTER", "URLAUB", "SOMMER", "FREUNDE"];
const MAX_WRONG  = 10;   // number of gallows stages drawn on the client
const REVEAL_MS  = 4200; // pause between pick-mode rounds / before the end screen

function randInt(n) { return Math.floor(Math.random() * n); }

function randomWord(difficulty) {
  let pool = WORDS[difficulty];
  if (!pool || !pool.length) pool = WORDS.normal;
  if (!pool || !pool.length) pool = FALLBACK;
  return String(pool[randInt(pool.length)]).toUpperCase();
}

function normalizeWord(w) {
  return String(w || "").toUpperCase().replace(/\s+/g, " ").trim();
}
const WORD_RE = /^[A-ZÄÖÜ][A-ZÄÖÜ \-]*$/;

function isSep(ch) { return ch === " " || ch === "-"; }

function makeBoard(word) {
  return { word: word, guessed: [], wrongCount: 0, solved: false, dead: false, startTime: Date.now(), endTime: null };
}
function isSolved(b) {
  for (const ch of b.word) { if (!isSep(ch) && b.guessed.indexOf(ch) === -1) return false; }
  return true;
}
function revealedCount(b) {
  let n = 0;
  for (const ch of b.word) { if (!isSep(ch) && b.guessed.indexOf(ch) !== -1) n++; }
  return n;
}
function patternOf(b) {
  return b.word.split("").map(function (ch) {
    if (isSep(ch)) return ch;
    return b.guessed.indexOf(ch) !== -1 ? ch : null;
  });
}
function applyGuess(b, letter) {
  letter = String(letter || "").toUpperCase();
  if (letter.length !== 1 || !/[A-ZÄÖÜ]/.test(letter)) return false;
  if (b.solved || b.dead) return false;
  if (b.guessed.indexOf(letter) !== -1) return false;
  b.guessed.push(letter);
  if (b.word.indexOf(letter) === -1) {
    b.wrongCount++;
    if (b.wrongCount >= MAX_WRONG) b.dead = true;
  }
  if (isSolved(b)) { b.solved = true; b.endTime = Date.now(); }
  return true;
}
function boardView(b, reveal) {
  return {
    pattern: patternOf(b),
    guessed: b.guessed.slice(),
    wrongCount: b.wrongCount,
    maxWrong: MAX_WRONG,
    solved: b.solved,
    dead: b.dead,
    word: reveal ? b.word : undefined
  };
}
function splitTeams(players) {
  const half = Math.ceil(players.length / 2);
  return { A: players.slice(0, half), B: players.slice(half) };
}
function teamOf(gd, username) {
  if (gd.teams.A.indexOf(username) !== -1) return "A";
  if (gd.teams.B.indexOf(username) !== -1) return "B";
  return null;
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "galgenraten") return null;
    return r;
  }

  socket.on("room:settings", function (s) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    s = s || {};
    if (s.playMode !== undefined)  r.settings.playMode = (s.playMode === "team") ? "team" : "solo";
    if (s.wordMode !== undefined)  r.settings.wordMode = (s.wordMode === "pick") ? "pick" : "race";
    if (s.difficulty !== undefined && ["easy", "normal", "hard"].indexOf(s.difficulty) !== -1) {
      r.settings.difficulty = s.difficulty;
    }
    io.to(socket.roomCode).emit("room:settings-updated", r.settings);
  });

  socket.on("galgenraten:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const code = socket.roomCode;

    const playMode   = r.settings.playMode === "team" ? "team" : "solo";
    const wordMode   = r.settings.wordMode === "pick" ? "pick" : "race";
    const difficulty = ["easy", "normal", "hard"].indexOf(r.settings.difficulty) !== -1 ? r.settings.difficulty : "normal";

    if (playMode === "team" && r.players.length < 2) {
      socket.emit("game:error", { message: "Für den Team-Modus braucht ihr mindestens 2 Spieler." });
      return;
    }

    r.started = true;

    if (playMode === "solo") {
      r.gameData = { mode: "single", playMode: playMode, wordMode: wordMode, difficulty: difficulty, board: makeBoard(randomWord(difficulty)) };
      emitState(code, "guess");
      return;
    }

    const teams = splitTeams(r.players);
    r.gameData = { playMode: playMode, wordMode: wordMode, difficulty: difficulty, teams: teams, recorded: false, winner: null };

    if (wordMode === "race") {
      const w = randomWord(difficulty);
      r.gameData.mode = "race";
      r.gameData.boards = { A: makeBoard(w), B: makeBoard(w) };
      emitState(code, "guess");
    } else {
      r.gameData.mode = "pick";
      r.gameData.sequence = [["A", "B"], ["B", "A"]];
      r.gameData.subRound = 0;
      r.gameData.results = { A: null, B: null };
      startPickRound(code);
    }
  });

  socket.on("galgenraten:set-word", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData || r.gameData.mode !== "pick") return;
    const gd = r.gameData;
    if (gd.phase !== "pick") return;
    if (teamOf(gd, socket.username) !== gd.currentSetter) return;
    const w = normalizeWord(payload && payload.word);
    if (w.length < 3 || w.length > 30 || !WORD_RE.test(w)) {
      socket.emit("game:error", { message: "Ungültiges Wort: 3–30 Zeichen, nur Buchstaben (A–Z, Ä, Ö, Ü), Leerzeichen und Bindestriche." });
      return;
    }
    gd.board = makeBoard(w);
    gd.phase = "guess";
    emitState(socket.roomCode, "guess");
  });

  socket.on("galgenraten:guess", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const code = socket.roomCode;
    const letter = payload && payload.letter;

    if (gd.mode === "single") {
      if (!applyGuess(gd.board, letter)) return;
      if (gd.board.solved || gd.board.dead) { r.started = false; emitState(code, "end"); }
      else emitState(code, "guess");
      return;
    }

    if (gd.mode === "race") {
      const t = teamOf(gd, socket.username);
      if (!t) return;
      if (!applyGuess(gd.boards[t], letter)) return;
      const A = gd.boards.A, B = gd.boards.B;
      const over = A.solved || B.solved || ((A.solved || A.dead) && (B.solved || B.dead));
      if (over) finishRace(code);
      else emitState(code, "guess");
      return;
    }

    if (gd.mode === "pick") {
      if (gd.phase !== "guess") return;
      if (teamOf(gd, socket.username) !== gd.currentGuesser) return;
      if (!applyGuess(gd.board, letter)) return;
      if (gd.board.solved || gd.board.dead) {
        gd.results[gd.currentGuesser] = {
          solved: gd.board.solved,
          timeMs: (gd.board.endTime || Date.now()) - gd.board.startTime,
          wrongCount: gd.board.wrongCount,
          revealed: revealedCount(gd.board)
        };
        gd.phase = "round-reveal";
        emitState(code, "round-reveal");
        gd.subRound++;
        if (gd.subRound >= gd.sequence.length) setTimeout(function () { finishPick(code); }, REVEAL_MS);
        else setTimeout(function () { startPickRound(code); }, REVEAL_MS);
      } else {
        emitState(code, "guess");
      }
      return;
    }
  });

  socket.on("galgenraten:restart", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username) return;
    r.started = false;
    r.gameData = {};
    io.to(socket.roomCode).emit("game:state", { phase: "lobby", data: {} });
  });

  // ── round / end helpers ──
  function startPickRound(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const pair = gd.sequence[gd.subRound];
    gd.currentSetter = pair[0];
    gd.currentGuesser = pair[1];
    gd.board = null;
    gd.phase = "pick";
    io.to(code).emit("game:state", { phase: "pick", data: {
      variant: "pick", subRound: gd.subRound + 1, totalRounds: gd.sequence.length,
      setter: gd.currentSetter, guesser: gd.currentGuesser, teams: gd.teams
    }});
  }

  function finishRace(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const A = gd.boards.A, B = gd.boards.B;
    let winner;
    if (A.solved && !B.solved) winner = "A";
    else if (B.solved && !A.solved) winner = "B";
    else if (A.solved && B.solved) winner = (A.endTime <= B.endTime) ? "A" : "B";
    else {
      const ra = revealedCount(A), rb = revealedCount(B);
      if (ra !== rb) winner = ra > rb ? "A" : "B";
      else if (A.wrongCount !== B.wrongCount) winner = A.wrongCount < B.wrongCount ? "A" : "B";
      else winner = null;
    }
    gd.winner = winner;
    r.started = false;
    recordTeam(r, gd, winner);
    emitState(code, "end");
  }

  function finishPick(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const winner = comparePick(gd.results.A, gd.results.B);
    gd.winner = winner;
    gd.phase = "end";
    r.started = false;
    recordTeam(r, gd, winner);
    emitState(code, "end");
  }

  function comparePick(a, b) {
    if (!a && !b) return null;
    if (a && !b) return "A";
    if (b && !a) return "B";
    if (a.solved && !b.solved) return "A";
    if (b.solved && !a.solved) return "B";
    if (a.solved && b.solved) {
      if (a.timeMs !== b.timeMs) return a.timeMs < b.timeMs ? "A" : "B";
      if (a.wrongCount !== b.wrongCount) return a.wrongCount < b.wrongCount ? "A" : "B";
      return null;
    }
    if (a.revealed !== b.revealed) return a.revealed > b.revealed ? "A" : "B";
    if (a.wrongCount !== b.wrongCount) return a.wrongCount < b.wrongCount ? "A" : "B";
    return null;
  }

  function recordTeam(r, gd, winner) {
    if (gd.recorded) return;
    gd.recorded = true;
    const scores = [];
    ["A", "B"].forEach(function (t) {
      (gd.teams[t] || []).forEach(function (u) {
        scores.push({ username: u, score: (winner === t) ? 10 : 0 });
      });
    });
    if (scores.length < 2) return;
    scores.sort(function (x, y) { return y.score - x.score; });
    const winners = winner ? (gd.teams[winner] || []).slice() : [];
    try { stats.recordGameResult("galgenraten", scores, winners); } catch (e) {}
  }

  function emitState(code, phase) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const reveal = (phase === "end" || phase === "round-reveal");
    let data;
    if (gd.mode === "single") {
      data = { variant: "solo", board: boardView(gd.board, reveal), won: gd.board.solved };
    } else if (gd.mode === "race") {
      data = {
        variant: "race", teams: gd.teams,
        boards: { A: boardView(gd.boards.A, reveal), B: boardView(gd.boards.B, reveal) },
        winner: gd.winner || null
      };
    } else {
      data = {
        variant: "pick",
        subRound: (gd.subRound || 0) + 1,
        totalRounds: gd.sequence ? gd.sequence.length : 2,
        setter: gd.currentSetter, guesser: gd.currentGuesser,
        teams: gd.teams,
        board: gd.board ? boardView(gd.board, reveal) : null,
        results: gd.results || null,
        winner: gd.winner || null
      };
    }
    io.to(code).emit("game:state", { phase: phase, data: data });
  }
};
