const https = require("https");

const SEARCH_TERMS = {
  easy: [
    "top hits 2024", "pop hits 2023", "chart hits 2022",
    "billie eilish", "taylor swift", "ed sheeran",
    "drake", "the weeknd", "dua lipa", "harry styles"
  ],
  normal: [
    "2010s hits", "rock anthems", "hip hop classic",
    "electronic dance", "indie pop", "2000s hits",
    "eminem", "kanye west", "coldplay", "rihanna"
  ],
  hard: [
    "80s pop", "90s classic", "german hits",
    "french pop", "alternative rock 90s", "jazz standards",
    "classic rock", "metal", "nirvana", "radiohead"
  ]
};

function fetchSongs(difficulty, callback) {
  const terms = SEARCH_TERMS[difficulty] || SEARCH_TERMS.normal;
  const term = terms[Math.floor(Math.random() * terms.length)];
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=50&country=DE`;

  https.get(url, (res) => {
    let data = "";
    res.on("data", (chunk) => { data += chunk; });
    res.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        const songs = (parsed.results || [])
          .filter(t => t.previewUrl && t.trackName && t.artistName)
          .map(t => ({
            title: t.trackName,
            artist: t.artistName,
            previewUrl: (t.previewUrl || "").replace(/^http:\/\//i, "https://"),
            albumArt: t.artworkUrl100
          }));
        callback(null, songs);
      } catch (e) {
        callback(e, []);
      }
    });
  }).on("error", (e) => {
    callback(e, []);
  });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(str) {
  return (str || "").toLowerCase().trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function isCorrectAnswer(answer, song) {
  const a = normalize(answer);
  const title = normalize(song.title);
  const artist = normalize(song.artist);

  if (!a || a.length < 2) return false;

  // Exact match
  if (a === title || a === artist) return true;

  // Answer contained in title or artist
  if (title.includes(a) || artist.includes(a)) return true;

  // Title or artist starts with answer (min 3 chars)
  if (a.length >= 3) {
    if (title.startsWith(a) || artist.startsWith(a)) return true;
  }

  return false;
}

module.exports = function (socket, io, rooms) {

  // ─── Settings ────────────────────────────────────────────────────────────────
  socket.on("game:settings", ({ difficulty, pointsToWin }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.username || room.started) return;
    if (difficulty) room.settings.difficulty = difficulty;
    if (pointsToWin) room.settings.pointsToWin = parseInt(pointsToWin, 10) || 10;
    io.to(socket.roomCode).emit("room:settings", room.settings);
  });

  // ─── Start ───────────────────────────────────────────────────────────────────
  socket.on("game:start", () => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username || room.started) return;

    room.started = true;
    const difficulty = room.settings.difficulty || "normal";

    fetchSongs(difficulty, (err, songs) => {
      if (err || songs.length < 5) {
        room.started = false;
        socket.emit("game:error", { message: "Konnte keine Songs laden. Bitte erneut versuchen." });
        return;
      }

      const shuffled = shuffle(songs).slice(0, 20);
      room.gameData = {
        songs: shuffled,
        index: 0,
        scores: {},
        phase: "idle",
        roundWinner: null,
        roundTimer: null,
        answered: false
      };

      // Init scores
      room.players.forEach(p => { room.gameData.scores[p] = 0; });

      // Countdown then first round
      io.to(code).emit("game:state", { phase: "countdown", countdown: 3, scores: room.gameData.scores });
      let count = 3;
      const countInterval = setInterval(() => {
        count--;
        if (count > 0) {
          io.to(code).emit("game:state", { phase: "countdown", countdown: count, scores: room.gameData.scores });
        } else {
          clearInterval(countInterval);
          startRound(code, room);
        }
      }, 1000);
    });
  });

  // ─── Answer ──────────────────────────────────────────────────────────────────
  socket.on("game:answer", ({ answer }) => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || !room.gameData || room.gameData.phase !== "question") return;
    if (room.gameData.answered) return; // round already won

    const song = room.gameData.songs[room.gameData.index];
    if (!song) return;

    if (isCorrectAnswer(answer, song)) {
      room.gameData.answered = true;
      room.gameData.roundWinner = socket.username;

      // Award point
      if (room.gameData.scores[socket.username] === undefined) {
        room.gameData.scores[socket.username] = 0;
      }
      room.gameData.scores[socket.username]++;

      // Cancel round timer
      if (room.gameData.roundTimer) {
        clearTimeout(room.gameData.roundTimer);
        room.gameData.roundTimer = null;
      }

      endRound(code, room, socket.username);
    } else {
      // Wrong answer — tell only that player
      socket.emit("game:wrong", { answer });
    }
  });

  // ─── Replay ──────────────────────────────────────────────────────────────────
  socket.on("game:replay", () => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username) return;

    room.started = false;
    room.gameData = {};
    io.to(code).emit("game:state", { phase: "lobby", scores: {} });
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function startRound(code, room) {
    const gd = room.gameData;
    if (gd.index >= gd.songs.length) {
      endGame(code, room);
      return;
    }

    gd.phase = "question";
    gd.answered = false;
    gd.roundWinner = null;

    const song = gd.songs[gd.index];
    const timeLimit = 15;

    io.to(code).emit("game:state", {
      phase: "question",
      song: {
        previewUrl: song.previewUrl,
        albumArt: song.albumArt,
        index: gd.index + 1,
        total: gd.songs.length
      },
      timeLimit,
      scores: gd.scores
    });

    // Auto-end round after timeLimit + 1s buffer
    gd.roundTimer = setTimeout(() => {
      if (gd.phase === "question" && !gd.answered) {
        gd.answered = true;
        endRound(code, room, null);
      }
    }, (timeLimit + 1) * 1000);
  }

  function endRound(code, room, winner) {
    const gd = room.gameData;
    gd.phase = "reveal";
    const song = gd.songs[gd.index];

    // Check win condition
    const pointsToWin = room.settings.pointsToWin || 10;
    const gameOver = winner && gd.scores[winner] >= pointsToWin;

    io.to(code).emit("game:state", {
      phase: "answer-reveal",
      correctAnswer: { title: song.title, artist: song.artist },
      albumArt: song.albumArt,
      winner: winner,
      scores: gd.scores,
      gameOver
    });

    if (gameOver) {
      setTimeout(() => endGame(code, room), 3000);
    } else {
      // Next round after 4 seconds
      setTimeout(() => {
        gd.index++;
        if (gd.index >= gd.songs.length) {
          endGame(code, room);
        } else {
          startRound(code, room);
        }
      }, 4000);
    }
  }

  function endGame(code, room) {
    const gd = room.gameData;
    gd.phase = "game-end";
    room.started = false;

    // Find winner(s)
    const scores = gd.scores || {};
    const maxScore = Math.max(0, ...Object.values(scores));
    const winners = Object.entries(scores)
      .filter(([, s]) => s === maxScore)
      .map(([p]) => p);

    io.to(code).emit("game:state", {
      phase: "game-end",
      scores,
      winners,
      topScore: maxScore
    });
  }
};
