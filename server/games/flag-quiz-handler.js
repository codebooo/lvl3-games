const path = require("path");
const ALL_FLAGS = require("../../data/flags.json");

const DIFFICULTY_TIME = { easy: 20, normal: 15, hard: 10, crazy: 8 };
const COUNTDOWN_SECS = 3;

function filterFlags(difficulty) {
  if (difficulty === "easy") {
    return ALL_FLAGS.filter(f => f.difficulty === "easy");
  }
  if (difficulty === "normal") {
    return ALL_FLAGS.filter(f => f.difficulty === "easy" || f.difficulty === "normal");
  }
  if (difficulty === "hard") {
    return ALL_FLAGS.filter(f => f.type === "country");
  }
  // crazy: hard countries + all state/province flags
  return ALL_FLAGS.filter(f => f.difficulty === "hard" || f.type === "state");
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function checkAnswer(input, flag) {
  const norm = s => s.trim().toLowerCase().replace(/[''`]/g, "'");
  const guess = norm(input);
  if (norm(flag.name) === guess) return true;
  return (flag.aliases || []).some(a => norm(a) === guess);
}

function getFlagImageUrl(flag) {
  if (flag.imageUrl) return flag.imageUrl;
  // country flags: use flagpedia CDN
  return "https://flagpedia.net/data/flags/w320/" + flag.iso2.toLowerCase() + ".png";
}

module.exports = function (socket, io, rooms) {

  // ─── Start Game ──────────────────────────────────────────────────────────────
  socket.on("flag-quiz:start", () => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.gameType !== "flag-quiz") return;
    if (room.host !== socket.username) return;
    if (room.started) return;

    room.started = true;

    const difficulty = (room.settings.difficulty || "normal").toLowerCase();
    const pool = shuffle(filterFlags(difficulty));
    const timePerRound = DIFFICULTY_TIME[difficulty] || 15;

    room.gameData = {
      phase: "countdown",
      scores: {},
      pool,
      currentIndex: 0,
      timePerRound,
      currentFlag: null,
      roundTimer: null,
      roundWinner: null,
      answeredThisRound: new Set()
    };

    // Initialise scores for all players
    room.players.forEach(p => { room.gameData.scores[p] = 0; });

    io.to(code).emit("game:state", { phase: "countdown", data: { count: COUNTDOWN_SECS } });
    startCountdown(code, COUNTDOWN_SECS);
  });

  // ─── Answer Submission ───────────────────────────────────────────────────────
  socket.on("flag-quiz:answer", ({ answer }) => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || !room.gameData) return;
    const gd = room.gameData;
    if (gd.phase !== "question") return;
    if (gd.answeredThisRound.has(socket.username)) return;
    if (!answer || typeof answer !== "string") return;

    gd.answeredThisRound.add(socket.username);

    if (checkAnswer(answer, gd.currentFlag)) {
      // correct — award point, end round immediately
      gd.scores[socket.username] = (gd.scores[socket.username] || 0) + 1;
      gd.roundWinner = socket.username;
      clearTimeout(gd.roundTimer);
      endRound(code);
    } else {
      // wrong — tell just that player
      socket.emit("flag-quiz:wrong", { player: socket.username });
    }
  });

  // ─── Host returns to lobby ────────────────────────────────────────────────────
  socket.on("flag-quiz:restart", () => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username) return;
    if (room.gameData && room.gameData.roundTimer) {
      clearTimeout(room.gameData.roundTimer);
    }
    room.started = false;
    room.gameData = {};
    io.to(code).emit("game:state", { phase: "lobby", data: {} });
  });

  // ─── Settings update (host only) ─────────────────────────────────────────────
  socket.on("room:settings", ({ difficulty, pointsToWin }) => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username || room.started) return;
    if (difficulty !== undefined) room.settings.difficulty = difficulty;
    if (pointsToWin !== undefined) room.settings.pointsToWin = parseInt(pointsToWin, 10) || 10;
    io.to(code).emit("room:settings-updated", room.settings);
  });

  // ─────────────────────────────────────────────────────────────────────────────

  function startCountdown(code, count) {
    if (count <= 0) {
      startQuestion(code);
      return;
    }
    io.to(code).emit("game:state", { phase: "countdown", data: { count } });
    setTimeout(() => startCountdown(code, count - 1), 1000);
  }

  function startQuestion(code) {
    const room = rooms.get(code);
    if (!room) return;
    const gd = room.gameData;
    if (gd.currentIndex >= gd.pool.length) {
      // ran out of flags — end game with current scores
      endGame(code);
      return;
    }

    const flag = gd.pool[gd.currentIndex];
    gd.currentFlag = flag;
    gd.phase = "question";
    gd.roundWinner = null;
    gd.answeredThisRound = new Set();

    const questionNumber = gd.currentIndex + 1;
    const totalQuestions = gd.pool.length;

    io.to(code).emit("game:state", {
      phase: "question",
      data: {
        questionNumber,
        totalQuestions,
        flag: {
          imageUrl: getFlagImageUrl(flag),
          region: flag.region,
          type: flag.type
        },
        timeLeft: gd.timePerRound,
        scores: gd.scores
      }
    });

    gd.roundTimer = setTimeout(() => endRound(code), gd.timePerRound * 1000);
  }

  function endRound(code) {
    const room = rooms.get(code);
    if (!room) return;
    const gd = room.gameData;
    if (gd.phase !== "question") return;

    gd.phase = "answer-reveal";

    const flag = gd.currentFlag;
    io.to(code).emit("game:state", {
      phase: "answer-reveal",
      data: {
        correctName: flag.name,
        flagImageUrl: getFlagImageUrl(flag),
        region: flag.region,
        type: flag.type,
        winner: gd.roundWinner,
        scores: gd.scores
      }
    });

    gd.currentIndex++;

    // Check win condition
    const pointsToWin = room.settings.pointsToWin || 10;
    const winner = Object.entries(gd.scores).find(([, s]) => s >= pointsToWin);
    if (winner) {
      setTimeout(() => endGame(code), 3000);
    } else {
      setTimeout(() => startQuestion(code), 3000);
    }
  }

  function endGame(code) {
    const room = rooms.get(code);
    if (!room) return;
    const gd = room.gameData;

    gd.phase = "game-end";
    room.started = false;

    const sorted = Object.entries(gd.scores)
      .sort((a, b) => b[1] - a[1])
      .map(([player, score]) => ({ player, score }));

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: {
        winner: sorted[0] ? sorted[0].player : null,
        scores: sorted
      }
    });
  }
};
