const path  = require("path");
const stats = require("../stats");

let moviesData = null;
function getMoviesData() {
  if (!moviesData) {
    moviesData = require(path.join(__dirname, "../../data/movies.json"));
  }
  return moviesData;
}

// ─── Timing constants ─────────────────────────────────────────────────────────
const COUNTDOWN_SECS   = 3;
const QUESTION_SECS    = 25;
const REVEAL_SECS      = 4;
const BASE_POINTS      = [10, 5, 3, 1];

function calcPoints(position, secondsLeft, timeLimit) {
  const timeLeft = Math.max(0, secondsLeft);
  const base = BASE_POINTS[Math.min(position, 3)];
  return Math.max(1, Math.round(base * Math.max(0.1, timeLeft / timeLimit)));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalise(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCorrect(guess, item) {
  const g = normalise(guess);
  if (!g) return false;

  const canonical = normalise(item.title || item.name);
  if (g === canonical) return true;

  // check aliases
  const aliases = (item.aliases || []).map(normalise);
  if (aliases.some(a => g === a)) return true;

  // substring match — guess must cover at least 80 % of canonical length
  if (canonical.includes(g) && g.length >= canonical.length * 0.8) return true;

  return false;
}

function buildPool(category, difficulty) {
  const data = getMoviesData();
  const diff = difficulty || "normal";
  let items = [];

  if (category === "movies" || category === "mixed") {
    (data.movies[diff] || []).forEach(m => items.push({ ...m, _type: "movie" }));
  }
  if (category === "series" || category === "mixed") {
    (data.series[diff] || []).forEach(s => items.push({ ...s, _type: "series" }));
  }
  if (category === "actors" || category === "mixed") {
    (data.actors[diff] || []).forEach(a => items.push({ ...a, _type: "actor" }));
  }
  return shuffle(items);
}

// ─── Module export ────────────────────────────────────────────────────────────
module.exports = function (socket, io, rooms) {

  // ── game:settings ────────────────────────────────────────────────────────
  socket.on("game:settings", ({ difficulty, pointsToWin, category }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.username) return;
    if (room.gameType !== "movies-actors") return;

    room.settings.difficulty  = difficulty  || room.settings.difficulty;
    room.settings.pointsToWin = pointsToWin || room.settings.pointsToWin;
    room.settings.category    = category    || room.settings.category || "mixed";

    io.to(socket.roomCode).emit("game:settings-updated", room.settings);
  });

  // ── game:start ───────────────────────────────────────────────────────────
  socket.on("game:start", () => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username) return;
    if (room.gameType !== "movies-actors") return;
    if (room.started) return;

    room.started = true;

    const category = room.settings.category || "mixed";
    const difficulty = room.settings.difficulty || "normal";
    const pool = buildPool(category, difficulty);

    if (pool.length === 0) {
      socket.emit("room:error", { message: "Keine Fragen für diese Einstellungen gefunden." });
      room.started = false;
      return;
    }

    room.gameData = {
      pool,
      currentIndex: 0,
      scores: {},
      answeredThisRound: {},
      roundTimer: null,
      revealTimer: null
    };

    // initialise scores
    room.players.forEach(p => { room.gameData.scores[p] = 0; });

    // emit lobby→countdown
    io.to(code).emit("game:state", { phase: "countdown", data: { seconds: COUNTDOWN_SECS } });

    let count = COUNTDOWN_SECS;
    const cTimer = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(cTimer);
        startQuestion(code);
      } else {
        io.to(code).emit("game:state", { phase: "countdown", data: { seconds: count } });
      }
    }, 1000);
  });

  // ── game:answer ──────────────────────────────────────────────────────────
  socket.on("game:answer", ({ answer }) => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || !room.started) return;
    if (room.gameType !== "movies-actors") return;

    const gd = room.gameData;
    if (!gd || gd.phase !== "question") return; // ignore late answers during reveal/end
    if (gd.answeredThisRound[socket.username]) return;

    const item = gd.pool[gd.currentIndex];
    if (!item) return;

    if (isCorrect(answer, item)) {
      gd.answeredThisRound[socket.username] = true;

      // time + position based scoring
      const position = gd.correctCount || 0;
      gd.correctCount = position + 1;
      const gained = calcPoints(position, gd.secondsLeft || 0, QUESTION_SECS);

      gd.scores[socket.username] = (gd.scores[socket.username] || 0) + gained;

      io.to(code).emit("game:player-answered", {
        username: socket.username,
        correct: true,
        pointsGained: gained,
        scores: gd.scores
      });

      // check win condition
      if (gd.scores[socket.username] >= room.settings.pointsToWin) {
        endGame(code, socket.username);
        return;
      }

      // if everyone answered, skip to reveal early (ignore players in rejoin grace)
      const present = room.players.filter(p => !(room.grace && room.grace[p]));
      const allAnswered = present.length > 0 && present.every(p => gd.answeredThisRound[p]);
      if (allAnswered) {
        clearTimeout(gd.roundTimer);
        revealAnswer(code);
      }
    } else {
      gd.answeredThisRound[socket.username] = "wrong";
      socket.emit("game:player-answered", {
        username: socket.username,
        correct: false,
        pointsGained: 0,
        scores: gd.scores
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers (scoped to this connection's module instance but
  // operating on the shared `rooms` Map via closure)
  // ─────────────────────────────────────────────────────────────────────────

  function startQuestion(code) {
    const room = rooms.get(code);
    if (!room) return;

    const gd = room.gameData;
    const item = gd.pool[gd.currentIndex];
    if (!item) {
      // ran out of questions — nobody reached pointsToWin
      endGame(code, null);
      return;
    }

    gd.phase = "question";
    gd.answeredThisRound = {};
    gd.correctCount = 0;
    gd.secondsLeft = QUESTION_SECS;

    io.to(code).emit("game:state", {
      phase: "question",
      data: {
        questionIndex: gd.currentIndex,
        total: gd.pool.length,
        imageUrl: item.imageUrl,
        hint: item.hint,
        type: item._type,        // "movie" | "series" | "actor"
        timeLeft: QUESTION_SECS,
        scores: gd.scores
      }
    });

    // tick timer
    gd.roundTimer = setInterval(() => {
      gd.secondsLeft--;
      io.to(code).emit("game:tick", { timeLeft: gd.secondsLeft });

      if (gd.secondsLeft <= 0) {
        clearInterval(gd.roundTimer);
        revealAnswer(code);
      }
    }, 1000);
  }

  function revealAnswer(code) {
    const room = rooms.get(code);
    if (!room) return;

    const gd = room.gameData;
    if (!gd || gd.phase !== "question") return; // only reveal once, from the question phase
    gd.phase = "reveal";
    if (gd.roundTimer) { clearInterval(gd.roundTimer); gd.roundTimer = null; }
    if (gd.revealTimer) { clearTimeout(gd.revealTimer); gd.revealTimer = null; }

    const item = gd.pool[gd.currentIndex];
    const answer = item.title || item.name;

    io.to(code).emit("game:state", {
      phase: "reveal",
      data: {
        answer,
        type: item._type,
        imageUrl: item.imageUrl,
        scores: gd.scores,
        revealSeconds: REVEAL_SECS
      }
    });

    gd.revealTimer = setTimeout(() => {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return; // room emptied — stop the loop
      gd.currentIndex++;
      startQuestion(code);
    }, REVEAL_SECS * 1000);
  }

  function endGame(code, winner) {
    const room = rooms.get(code);
    if (!room) return;

    const gd = room.gameData;
    if (!gd || gd.recorded) return;   // guard double-entry (late answer + timeout race)
    gd.recorded = true;
    if (gd.roundTimer)  { clearInterval(gd.roundTimer); gd.roundTimer = null; }
    if (gd.revealTimer) { clearTimeout(gd.revealTimer); gd.revealTimer = null; }

    // determine winner by highest score if not passed in
    if (!winner) {
      let best = -1;
      Object.entries(gd.scores).forEach(([p, s]) => {
        if (s > best) { best = s; winner = p; }
      });
    }

    // sort final scores
    const finalScores = Object.entries(gd.scores)
      .sort(([, a], [, b]) => b - a)
      .map(([username, score]) => ({ username, score }));

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: { winner, finalScores }
    });

    try { stats.recordGameResult(room.gameType, finalScores, winner); } catch (e) { /* stats failure must not crash game */ }

    room.started = false;
    room.gameData = {};
  }
};
