const path = require("path");

const FALLBACK_LOGOS = [
  { name: "Apple",      domain: "apple.com",      difficulty: "easy",   aliases: ["apple inc"] },
  { name: "Google",     domain: "google.com",      difficulty: "easy",   aliases: [] },
  { name: "Nike",       domain: "nike.com",        difficulty: "easy",   aliases: [] },
  { name: "Amazon",     domain: "amazon.com",      difficulty: "easy",   aliases: [] },
  { name: "Samsung",    domain: "samsung.com",     difficulty: "easy",   aliases: [] },
  { name: "Microsoft",  domain: "microsoft.com",   difficulty: "easy",   aliases: [] },
  { name: "Coca-Cola",  domain: "coca-cola.com",   difficulty: "easy",   aliases: ["coke", "coca cola"] },
  { name: "Netflix",    domain: "netflix.com",     difficulty: "easy",   aliases: [] },
  { name: "Adidas",     domain: "adidas.com",      difficulty: "easy",   aliases: [] },
  { name: "Spotify",    domain: "spotify.com",     difficulty: "easy",   aliases: [] },
  { name: "Airbnb",     domain: "airbnb.com",      difficulty: "normal", aliases: [] },
  { name: "Uber",       domain: "uber.com",        difficulty: "normal", aliases: [] },
  { name: "Discord",    domain: "discord.com",     difficulty: "normal", aliases: [] },
  { name: "Snapchat",   domain: "snapchat.com",    difficulty: "normal", aliases: ["snap"] },
  { name: "Twitch",     domain: "twitch.tv",       difficulty: "normal", aliases: [] },
  { name: "Figma",      domain: "figma.com",       difficulty: "hard",   aliases: [] },
  { name: "Notion",     domain: "notion.so",       difficulty: "hard",   aliases: [] },
  { name: "Vercel",     domain: "vercel.com",      difficulty: "hard",   aliases: [] },
  { name: "Stripe",     domain: "stripe.com",      difficulty: "hard",   aliases: [] },
  { name: "Cloudflare", domain: "cloudflare.com",  difficulty: "hard",   aliases: [] }
];

const TIME_LIMITS = { easy: 20, normal: 15, hard: 10 };

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadLogos(difficulty) {
  let all;
  try {
    all = require(path.join(__dirname, "../../data/logos.json"));
  } catch (e) {
    all = FALLBACK_LOGOS;
  }
  return shuffle(all.filter(l => l.difficulty === difficulty));
}

function checkAnswer(answer, logo) {
  const norm = s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(answer);
  if (a === norm(logo.name)) return true;
  return (logo.aliases || []).some(alias => a === norm(alias));
}

function sortedScores(scores) {
  return Object.entries(scores)
    .map(([username, score]) => ({ username, score }))
    .sort((a, b) => b.score - a.score);
}

module.exports = function (socket, io, rooms) {

  // ── game:settings ────────────────────────────────────────────
  socket.on("game:settings", ({ difficulty, pointsToWin }) => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username) return;

    if (difficulty) room.settings.difficulty = difficulty;
    if (pointsToWin != null) room.settings.pointsToWin = Number(pointsToWin) || 10;

    io.to(code).emit("room:settings", { settings: room.settings });
  });

  // ── game:start ───────────────────────────────────────────────
  socket.on("game:start", () => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username) return;
    if (room.started) return;

    const difficulty = room.settings.difficulty || "normal";
    const logos = loadLogos(difficulty);

    room.gameData = {
      logos,
      index: 0,
      scores: {},
      timerId: null,
      difficulty,
      phase: "countdown"
    };

    // Initialise scores for every player currently in the room
    room.players.forEach(p => { room.gameData.scores[p] = 0; });

    room.started = true;

    startCountdown(code, room);
  });

  // ── game:answer ──────────────────────────────────────────────
  socket.on("game:answer", ({ answer }) => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || !room.started) return;

    const gd = room.gameData;
    if (!gd || gd.phase !== "question") return;
    if (!answer || typeof answer !== "string") return;

    const logo = gd.logos[gd.index];
    if (!logo) return;

    if (checkAnswer(answer, logo)) {
      // Stop the round timer
      if (gd.timerId) {
        clearTimeout(gd.timerId);
        gd.timerId = null;
      }

      gd.phase = "answer-reveal";

      // Update score
      if (gd.scores[socket.username] == null) gd.scores[socket.username] = 0;
      gd.scores[socket.username]++;

      io.to(code).emit("game:correct", {
        winner: socket.username,
        answer,
        correctAnswer: logo.name,
        scores: gd.scores
      });

      // Check win condition
      const ptw = room.settings.pointsToWin || 10;
      if (gd.scores[socket.username] >= ptw) {
        setTimeout(() => gameEnd(code, room), 2000);
      } else {
        setTimeout(() => nextRound(code, room), 2000);
      }
    }
  });

  // ── helpers ──────────────────────────────────────────────────

  function startCountdown(code, room) {
    const counts = [3, 2, 1];
    let i = 0;

    function emitCount() {
      if (!rooms.has(code)) return;
      io.to(code).emit("game:state", { phase: "countdown", count: counts[i] });
      i++;
      if (i < counts.length) {
        setTimeout(emitCount, 1000);
      } else {
        setTimeout(() => startRound(code, room), 1000);
      }
    }

    emitCount();
  }

  function startRound(code, room) {
    if (!rooms.has(code)) return;
    const gd = room.gameData;
    const logo = gd.logos[gd.index];
    const timeLimit = TIME_LIMITS[gd.difficulty] || 15;

    gd.phase = "question";

    io.to(code).emit("game:state", {
      phase: "question",
      logo: {
        id: gd.index,
        imageUrl: "https://logo.clearbit.com/" + logo.domain,
        difficulty: logo.difficulty
      },
      timeLimit,
      round: gd.index + 1,
      total: gd.logos.length,
      scores: gd.scores
    });

    // Timer: +1s grace so clients can render
    gd.timerId = setTimeout(() => {
      if (!rooms.has(code)) return;
      if (gd.phase !== "question") return;

      gd.phase = "timeout";

      io.to(code).emit("game:state", {
        phase: "timeout",
        correctAnswer: logo.name,
        scores: gd.scores
      });

      setTimeout(() => nextRound(code, room), 2500);
    }, (timeLimit + 1) * 1000);
  }

  function nextRound(code, room) {
    if (!rooms.has(code)) return;
    const gd = room.gameData;
    gd.index++;

    if (gd.index >= gd.logos.length) {
      // Reshuffle and reset
      gd.logos = shuffle(gd.logos);
      gd.index = 0;
    }

    startRound(code, room);
  }

  function gameEnd(code, room) {
    if (!rooms.has(code)) return;
    const gd = room.gameData;

    if (gd.timerId) {
      clearTimeout(gd.timerId);
      gd.timerId = null;
    }

    gd.phase = "game-end";
    room.started = false;

    const sorted = sortedScores(gd.scores);
    const winner = sorted.length > 0 ? sorted[0].username : null;

    io.to(code).emit("game:end", {
      winner,
      scores: sorted
    });
  }
};
