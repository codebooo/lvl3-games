const path    = require("path");
const stats   = require("../stats");
const ALL_FLAGS = require("../../data/flags.json");

const DIFFICULTY_TIME = { easy: 20, normal: 15, hard: 10, crazy: 8 };
const BASE_POINTS = [10, 5, 3, 1];

function filterFlags(difficulty) {
  if (difficulty === "easy") return ALL_FLAGS.filter(f => f.difficulty === "easy");
  if (difficulty === "normal") return ALL_FLAGS.filter(f => f.difficulty === "easy" || f.difficulty === "normal");
  if (difficulty === "hard") return ALL_FLAGS.filter(f => f.type === "country");
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
  return "https://flagpedia.net/data/flags/w320/" + flag.iso2.toLowerCase() + ".png";
}

function calcPoints(position, timeLeft, timeLimit) {
  const base = BASE_POINTS[Math.min(position, 3)];
  const mult = Math.max(0.1, timeLeft / timeLimit);
  return Math.max(1, Math.round(base * mult));
}

function getMcOptions(correctFlag, pool) {
  const wrongs = shuffle(pool.filter(f => f.name !== correctFlag.name)).slice(0, 3);
  const opts = [{ text: correctFlag.name, correct: true },
    ...wrongs.map(f => ({ text: f.name, correct: false }))];
  return shuffle(opts);
}

module.exports = function (socket, io, rooms) {

  socket.on("flag-quiz:start", () => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.gameType !== "flag-quiz") return;
    if (room.host !== socket.username) return;
    if (room.started) return;

    room.started = true;
    const difficulty = (room.settings.difficulty || "normal").toLowerCase();
    const answerMode = room.settings.answerMode || "type";
    const pool = shuffle(filterFlags(difficulty));
    const timePerRound = DIFFICULTY_TIME[difficulty] || 15;

    room.gameData = {
      phase: "countdown",
      scores: {},
      pool,
      currentIndex: 0,
      timePerRound,
      answerMode,
      currentFlag: null,
      roundTimer: null,
      roundStartTime: null,
      answeredCorrectly: [],
      answeredThisRound: new Set()
    };

    room.players.forEach(p => { room.gameData.scores[p] = 0; });

    io.to(code).emit("game:state", { phase: "countdown", data: { count: 3 } });
    startCountdown(code, 3);
  });

  socket.on("flag-quiz:answer", ({ answer }) => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || !room.gameData) return;
    const gd = room.gameData;
    if (gd.phase !== "question") return;
    if (gd.answeredThisRound.has(socket.username)) return;
    if (!answer || typeof answer !== "string") return;

    const isMC = gd.answerMode === "mc";

    if (checkAnswer(answer, gd.currentFlag)) {
      gd.answeredThisRound.add(socket.username);
      const position = gd.answeredCorrectly.length;
      gd.answeredCorrectly.push(socket.username);

      const elapsed = (Date.now() - gd.roundStartTime) / 1000;
      const timeLeft = Math.max(0, gd.timePerRound - elapsed);
      const pts = calcPoints(position, timeLeft, gd.timePerRound);

      gd.scores[socket.username] = (gd.scores[socket.username] || 0) + pts;

      socket.emit("flag-quiz:correct", { points: pts, scores: gd.scores });
      io.to(code).emit("flag-quiz:player-correct", {
        player: socket.username, points: pts, position: position + 1, scores: gd.scores
      });

      // Check if all players answered
      if (gd.answeredCorrectly.length >= room.players.length) {
        clearTimeout(gd.roundTimer);
        endRound(code);
      }
    } else {
      // Wrong answer
      if (isMC) {
        // MC: lock out this player (add to answered so they can't retry)
        gd.answeredThisRound.add(socket.username);
      }
      socket.emit("flag-quiz:wrong", { player: socket.username });
    }
  });

  socket.on("flag-quiz:restart", () => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username) return;
    if (room.gameData && room.gameData.roundTimer) clearTimeout(room.gameData.roundTimer);
    room.started = false;
    room.gameData = {};
    io.to(code).emit("game:state", { phase: "lobby", data: {} });
  });

  socket.on("room:settings", ({ difficulty, pointsToWin, answerMode }) => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username || room.started) return;
    if (room.gameType !== "flag-quiz") return;
    if (difficulty !== undefined) room.settings.difficulty = difficulty;
    if (pointsToWin !== undefined) room.settings.pointsToWin = Math.min(1000, Math.max(1, parseInt(pointsToWin, 10) || 10));
    if (answerMode !== undefined) room.settings.answerMode = answerMode;
    io.to(code).emit("room:settings-updated", room.settings);
  });

  function startCountdown(code, count) {
    if (count <= 0) { startQuestion(code); return; }
    io.to(code).emit("game:state", { phase: "countdown", data: { count } });
    setTimeout(() => startCountdown(code, count - 1), 1000);
  }

  function startQuestion(code) {
    const room = rooms.get(code);
    if (!room) return;
    const gd = room.gameData;
    if (gd.currentIndex >= gd.pool.length) { endGame(code); return; }

    const flag = gd.pool[gd.currentIndex];
    gd.currentFlag = flag;
    gd.phase = "question";
    gd.answeredCorrectly = [];
    gd.answeredThisRound = new Set();
    gd.roundStartTime = Date.now();

    const options = gd.answerMode === "mc" ? getMcOptions(flag, gd.pool) : null;

    io.to(code).emit("game:state", {
      phase: "question",
      data: {
        questionNumber: gd.currentIndex + 1,
        totalQuestions: gd.pool.length,
        flag: { imageUrl: getFlagImageUrl(flag), region: flag.region, type: flag.type },
        timeLeft: gd.timePerRound,
        scores: gd.scores,
        answerMode: gd.answerMode,
        options
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
        winners: gd.answeredCorrectly,
        scores: gd.scores
      }
    });

    gd.currentIndex++;
    const pointsToWin = room.settings.pointsToWin || 10;
    const gameWinner = Object.entries(gd.scores).find(([, s]) => s >= pointsToWin);
    if (gameWinner) {
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

    const winner = sorted[0] ? sorted[0].player : null;

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: { winner, scores: sorted }
    });

    // Normalise to {username, score} for stats
    const sortedForStats = sorted.map(e => ({ username: e.player, score: e.score }));
    try { stats.recordGameResult(room.gameType, sortedForStats, winner); } catch (e) { /* stats failure must not crash game */ }
  }
};
