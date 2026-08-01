// Höher oder Tiefer — zwei Wikipedia-Artikel, wer hatte mehr Aufrufe?
// Kettenmechanik: der Sieger-Artikel wird zum neuen Referenz-Artikel.
// Modi: "ffa" (auch solo) und "teams" (Team-Mehrheit entscheidet).
const stats = require("../stats");

let DATA = { period: "", articles: [] };
try { DATA = require("../../data/pageviews.json"); } catch (e) { /* guarded below */ }

const ROUND_TIME = 12;    // Sekunden pro Duell
const REVEAL_MS  = 4200;  // Pause auf dem Reveal-Screen
// Ein Duell ist nur spannend, wenn die Zahlen nicht absurd weit auseinanderliegen.
const MIN_RATIO = 1.15;
const MAX_RATIO = 6;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function teamOf(teams, username) {
  if (!teams) return null;
  if (teams.A.indexOf(username) !== -1) return "A";
  if (teams.B.indexOf(username) !== -1) return "B";
  return null;
}

function normalizeTeams(assign, players) {
  const teams = { A: [], B: [] };
  players.forEach(function (p) {
    if (assign[p] === "A") teams.A.push(p);
    else if (assign[p] === "B") teams.B.push(p);
  });
  players.forEach(function (p) {
    if (!assign[p]) (teams.A.length <= teams.B.length ? teams.A : teams.B).push(p);
  });
  return teams;
}

// Wähle einen Gegner-Artikel, dessen Aufrufzahl im interessanten Verhältnis liegt.
function pickOpponent(pool, ref, used) {
  const candidates = pool.filter(function (a) {
    if (used[a.title]) return false;
    if (a.title === ref.title) return false;
    const r = a.views > ref.views ? a.views / ref.views : ref.views / a.views;
    return r >= MIN_RATIO && r <= MAX_RATIO;
  });
  if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
  // Fallback: irgendein unbenutzter Artikel, damit das Spiel nie hängen bleibt.
  const rest = pool.filter(function (a) { return !used[a.title] && a.title !== ref.title; });
  return rest.length ? rest[Math.floor(Math.random() * rest.length)] : null;
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "hoeher-tiefer") return null;
    return r;
  }

  function presentPlayers(r) {
    return r.players.filter(function (p) { return !(r.grace && r.grace[p]); });
  }

  socket.on("room:settings", function (s) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    s = s || {};
    if (s.playMode !== undefined) r.settings.playMode = (s.playMode === "teams") ? "teams" : "ffa";
    if (s.rounds !== undefined) {
      r.settings.rounds = Math.min(30, Math.max(3, parseInt(s.rounds, 10) || 12));
    }
    io.to(socket.roomCode).emit("room:settings-updated", r.settings);
  });

  socket.on("hoeher:set-team", function (payload) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const player = payload && payload.player;
    if (r.players.indexOf(player) === -1) return;
    if (!r.settings.teamAssign) r.settings.teamAssign = {};
    const assign = r.settings.teamAssign;
    const current = normalizeTeams(assign, r.players);
    r.players.forEach(function (p) { assign[p] = teamOf(current, p); });
    assign[player] = assign[player] === "A" ? "B" : "A";
    io.to(socket.roomCode).emit("hoeher:teams", { teams: normalizeTeams(assign, r.players) });
  });

  socket.on("hoeher:get-teams", function () {
    const r = myRoom();
    if (!r) return;
    socket.emit("hoeher:teams", { teams: normalizeTeams(r.settings.teamAssign || {}, r.players) });
  });

  socket.on("hoeher:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const code = socket.roomCode;

    if (!DATA.articles || DATA.articles.length < 10) {
      socket.emit("game:error", { message: "Keine Aufruf-Daten gefunden (data/pageviews.json fehlt)." });
      return;
    }

    const playMode = r.settings.playMode === "teams" ? "teams" : "ffa";
    const rounds   = Math.min(30, Math.max(3, parseInt(r.settings.rounds, 10) || 12));

    let teams = null;
    if (playMode === "teams") {
      if (r.players.length < 2) {
        socket.emit("game:error", { message: "Für den Team-Modus braucht ihr mindestens 2 Spieler." });
        return;
      }
      teams = normalizeTeams(r.settings.teamAssign || {}, r.players);
      if (!teams.A.length || !teams.B.length) {
        socket.emit("game:error", { message: "Beide Teams brauchen mindestens 1 Spieler." });
        return;
      }
    }

    const pool = shuffle(DATA.articles);
    const gd = {
      phase: "countdown",
      playMode: playMode,
      teams: teams,
      pool: pool,
      used: {},
      totalRounds: rounds,
      roundIndex: 0,
      ref: null,          // linker Artikel (Zahl bekannt)
      chal: null,         // rechter Artikel (Zahl geheim)
      votes: {},
      scores: {},
      streaks: {},        // pro Spieler bzw. Team
      bestStreak: {},
      roundTimer: null,
      recorded: false
    };
    if (playMode === "teams") { gd.scores = { A: 0, B: 0 }; gd.streaks = { A: 0, B: 0 }; gd.bestStreak = { A: 0, B: 0 }; }
    else r.players.forEach(function (p) { gd.scores[p] = 0; gd.streaks[p] = 0; gd.bestStreak[p] = 0; });

    // Start-Referenz
    gd.ref = pool[0];
    gd.used[gd.ref.title] = true;

    r.started = true;
    r.gameData = gd;
    startCountdown(code, 3);
  });

  socket.on("hoeher:vote", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const code = socket.roomCode;
    if (gd.phase !== "duel") return;
    if (gd.votes[socket.username]) return;
    const answer = payload && payload.answer;
    if (answer !== "higher" && answer !== "lower") return;

    gd.votes[socket.username] = answer;
    const present = presentPlayers(r);
    io.to(code).emit("hoeher:voted", {
      player: socket.username,
      count: Object.keys(gd.votes).length,
      total: present.length
    });
    if (present.length > 0 && present.every(function (p) { return gd.votes[p]; })) {
      clearTimeout(gd.roundTimer);
      endRound(code);
    }
  });

  socket.on("hoeher:restart", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username) return;
    if (r.gameData && r.gameData.roundTimer) clearTimeout(r.gameData.roundTimer);
    r.started = false;
    r.gameData = {};
    io.to(socket.roomCode).emit("game:state", { phase: "lobby", data: {} });
  });

  // ── Ablauf ──
  function startCountdown(code, count) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.started) return;
    if (count <= 0) { startDuel(code); return; }
    io.to(code).emit("game:state", { phase: "countdown", data: { count: count } });
    setTimeout(function () { startCountdown(code, count - 1); }, 1000);
  }

  function startDuel(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.started) return;
    const gd = r.gameData;
    if (gd.roundIndex >= gd.totalRounds) { endGame(code); return; }

    const chal = pickOpponent(gd.pool, gd.ref, gd.used);
    if (!chal) { endGame(code); return; }   // Pool erschöpft
    gd.chal = chal;
    gd.used[chal.title] = true;
    gd.phase = "duel";
    gd.votes = {};

    io.to(code).emit("game:state", {
      phase: "duel",
      data: {
        roundNumber: gd.roundIndex + 1,
        totalRounds: gd.totalRounds,
        period: DATA.period,
        // Referenz mit Zahl, Herausforderer OHNE Zahl (Lösung bleibt serverseitig)
        ref: { title: gd.ref.title, views: gd.ref.views },
        chal: { title: gd.chal.title },
        timeLeft: ROUND_TIME,
        playMode: gd.playMode,
        teams: gd.teams,
        scores: gd.scores,
        streaks: gd.streaks,
        votersTotal: presentPlayers(r).length
      }
    });

    gd.roundTimer = setTimeout(function () { endRound(code); }, ROUND_TIME * 1000);
  }

  function endRound(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "duel") return;
    gd.phase = "reveal";

    const truth = gd.chal.views > gd.ref.views ? "higher" : "lower";
    const roundPoints = {};

    function award(key, correct) {
      if (correct) {
        gd.streaks[key] = (gd.streaks[key] || 0) + 1;
        const bonus = gd.streaks[key] >= 3 ? 2 : 1;   // Streak-Bonus ab 3 in Folge
        gd.scores[key] = (gd.scores[key] || 0) + bonus;
        if (gd.streaks[key] > (gd.bestStreak[key] || 0)) gd.bestStreak[key] = gd.streaks[key];
        roundPoints[key] = bonus;
      } else {
        gd.streaks[key] = 0;
        roundPoints[key] = 0;
      }
    }

    if (gd.playMode === "teams") {
      ["A", "B"].forEach(function (t) {
        const members = gd.teams[t];
        const right = members.filter(function (u) { return gd.votes[u] === truth; }).length;
        award(t, right * 2 > members.length);   // strikte Mehrheit
      });
    } else {
      r.players.forEach(function (p) { award(p, gd.votes[p] === truth); });
    }

    io.to(code).emit("game:state", {
      phase: "reveal",
      data: {
        roundNumber: gd.roundIndex + 1,
        totalRounds: gd.totalRounds,
        truth: truth,
        ref: { title: gd.ref.title, views: gd.ref.views },
        chal: { title: gd.chal.title, views: gd.chal.views },
        votes: gd.votes,
        roundPoints: roundPoints,
        playMode: gd.playMode,
        teams: gd.teams,
        scores: gd.scores,
        streaks: gd.streaks
      }
    });

    // Kettenmechanik: der Herausforderer wird zur neuen Referenz.
    gd.ref = gd.chal;
    gd.roundIndex++;

    setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;   // Restart/Leave-Guard
      if (gd.roundIndex >= gd.totalRounds) endGame(code);
      else startDuel(code);
    }, REVEAL_MS);
  }

  function endGame(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.recorded) return;
    gd.recorded = true;
    gd.phase = "game-end";
    r.started = false;
    if (gd.roundTimer) clearTimeout(gd.roundTimer);

    let winner = null, sorted = [], statScores = [], statWinners = [];

    if (gd.playMode === "teams") {
      if (gd.scores.A !== gd.scores.B) {
        const t = gd.scores.A > gd.scores.B ? "A" : "B";
        winner = "Team " + t;
        statWinners = gd.teams[t].slice();
      }
      sorted = [
        { player: "Team A (" + gd.teams.A.join(", ") + ")", score: gd.scores.A, streak: gd.bestStreak.A },
        { player: "Team B (" + gd.teams.B.join(", ") + ")", score: gd.scores.B, streak: gd.bestStreak.B }
      ].sort(function (a, b) { return b.score - a.score; });
      ["A", "B"].forEach(function (t) {
        gd.teams[t].forEach(function (u) { statScores.push({ username: u, score: gd.scores[t] }); });
      });
    } else {
      sorted = Object.keys(gd.scores).map(function (p) {
        return { player: p, score: gd.scores[p], streak: gd.bestStreak[p] || 0 };
      }).sort(function (a, b) { return b.score - a.score; });
      const top = sorted.length ? sorted[0].score : 0;
      const tops = sorted.filter(function (e) { return e.score === top; });
      winner = tops.length === 1 ? tops[0].player : null;
      statScores = sorted.map(function (e) { return { username: e.player, score: e.score }; });
      statWinners = winner ? [winner] : [];
    }

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: {
        winner: winner, tie: !winner, playMode: gd.playMode,
        scores: sorted, totalRounds: gd.totalRounds
      }
    });

    if (statScores.length >= 2) {
      statScores.sort(function (a, b) { return b.score - a.score; });
      try { stats.recordGameResult("hoeher-tiefer", statScores, statWinners); } catch (e) {}
    }
  }
};
