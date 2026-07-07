// Siblings or Dating — zwei Portraits, alle stimmen geheim ab: Geschwister oder Paar?
// Modi: "ffa" (jeder für sich, funktioniert auch solo) und "teams" (Host teilt die
// Spieler frei in Team A / Team B — 1v1, 2v1, 3v1, 2v2 …). Team-Punkt, wenn die
// Mehrheit des Teams richtig liegt; bei Gleichstand innerhalb des Teams kein Punkt.
const stats = require("../stats");

let PAIRS = [];
try { PAIRS = require("../../data/siblings-dating.json"); } catch (e) { /* empty deck guarded below */ }

const ROUND_TIME = 20;   // seconds per pair
const REVEAL_MS  = 5000; // pause on the reveal screen

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a deck of `n` pairs that's as close to 50/50 siblings/couples as the
// data allows, then shuffle it — so "always guess couple" can't win even though
// there are more couple pairs than sibling pairs in the dataset.
function balancedDeck(pairs, n) {
  const sib = shuffle(pairs.filter(p => p.answer === "siblings"));
  const cpl = shuffle(pairs.filter(p => p.answer === "couple"));
  const out = [];
  let i = 0, j = 0;
  while (out.length < n && (i < sib.length || j < cpl.length)) {
    // Alternate, pulling from whichever pool keeps the counts balanced.
    const takeSib = (out.length % 2 === 0) ? i < sib.length : !(j < cpl.length);
    if (takeSib && i < sib.length) out.push(sib[i++]);
    else if (j < cpl.length) out.push(cpl[j++]);
    else if (i < sib.length) out.push(sib[i++]);
  }
  return shuffle(out);
}

function teamOf(teams, username) {
  if (teams.A.indexOf(username) !== -1) return "A";
  if (teams.B.indexOf(username) !== -1) return "B";
  return null;
}

// Normalise the host's assignment against the current player list:
// drop players who left, alternate unassigned players onto the smaller team.
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

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "siblings-dating") return null;
    return r;
  }

  socket.on("room:settings", function (s) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    s = s || {};
    if (s.playMode !== undefined) r.settings.playMode = (s.playMode === "teams") ? "teams" : "ffa";
    if (s.rounds !== undefined) {
      r.settings.rounds = Math.min(PAIRS.length || 10, Math.max(3, parseInt(s.rounds, 10) || 10));
    }
    io.to(socket.roomCode).emit("room:settings-updated", r.settings);
  });

  // Host clicks a player chip in the lobby to move them A → B → A …
  socket.on("siblings-dating:set-team", function (payload) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const player = payload && payload.player;
    if (r.players.indexOf(player) === -1) return;
    if (!r.settings.teamAssign) r.settings.teamAssign = {};
    // Materialize the current split for everyone first — otherwise the
    // auto-balance in normalizeTeams() would shuffle unassigned players
    // to the other side whenever a single player is toggled.
    const assign = r.settings.teamAssign;
    const current = normalizeTeams(assign, r.players);
    r.players.forEach(function (p) { assign[p] = teamOf(current, p); });
    assign[player] = assign[player] === "A" ? "B" : "A";
    io.to(socket.roomCode).emit("siblings-dating:teams", {
      teams: normalizeTeams(r.settings.teamAssign, r.players)
    });
  });

  // Anyone entering the lobby can ask for the current split preview.
  socket.on("siblings-dating:get-teams", function () {
    const r = myRoom();
    if (!r) return;
    socket.emit("siblings-dating:teams", {
      teams: normalizeTeams(r.settings.teamAssign || {}, r.players)
    });
  });

  socket.on("siblings-dating:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const code = socket.roomCode;

    if (!PAIRS.length) {
      socket.emit("game:error", { message: "Keine Spieldaten gefunden (data/siblings-dating.json fehlt)." });
      return;
    }

    const playMode = r.settings.playMode === "teams" ? "teams" : "ffa";
    const rounds   = Math.min(PAIRS.length, Math.max(3, parseInt(r.settings.rounds, 10) || 10));

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

    r.started = true;
    const gd = {
      phase: "countdown",
      playMode: playMode,
      teams: teams,
      deck: balancedDeck(PAIRS, rounds),
      roundIndex: 0,
      votes: {},
      scores: {},        // ffa: per player · teams: { A, B }
      roundTimer: null,
      recorded: false
    };
    if (playMode === "teams") { gd.scores = { A: 0, B: 0 }; }
    else r.players.forEach(function (p) { gd.scores[p] = 0; });
    r.gameData = gd;

    startCountdown(code, 3);
  });

  socket.on("siblings-dating:vote", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const code = socket.roomCode;
    if (gd.phase !== "question") return;
    if (gd.votes[socket.username]) return;
    const answer = payload && payload.answer;
    if (answer !== "siblings" && answer !== "couple") return;

    gd.votes[socket.username] = answer;
    io.to(code).emit("siblings-dating:voted", {
      player: socket.username,
      count: Object.keys(gd.votes).length,
      total: r.players.length
    });

    if (Object.keys(gd.votes).length >= r.players.length) {
      clearTimeout(gd.roundTimer);
      endRound(code);
    }
  });

  socket.on("siblings-dating:restart", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username) return;
    if (r.gameData && r.gameData.roundTimer) clearTimeout(r.gameData.roundTimer);
    r.started = false;
    r.gameData = {};
    io.to(socket.roomCode).emit("game:state", { phase: "lobby", data: {} });
  });

  // ── round flow ──
  function startCountdown(code, count) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.started) return;
    if (count <= 0) { startQuestion(code); return; }
    io.to(code).emit("game:state", { phase: "countdown", data: { count: count } });
    setTimeout(function () { startCountdown(code, count - 1); }, 1000);
  }

  function startQuestion(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.started) return;
    const gd = r.gameData;
    if (gd.roundIndex >= gd.deck.length) { endGame(code); return; }

    const pair = gd.deck[gd.roundIndex];
    gd.phase = "question";
    gd.votes = {};

    io.to(code).emit("game:state", {
      phase: "question",
      data: {
        roundNumber: gd.roundIndex + 1,
        totalRounds: gd.deck.length,
        img1: pair.person1.img,
        img2: pair.person2.img,
        timeLeft: ROUND_TIME,
        playMode: gd.playMode,
        teams: gd.teams,
        scores: gd.scores,
        votedCount: 0,
        votersTotal: r.players.length
      }
    });

    gd.roundTimer = setTimeout(function () { endRound(code); }, ROUND_TIME * 1000);
  }

  function endRound(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "question") return;
    gd.phase = "reveal";

    const pair = gd.deck[gd.roundIndex];
    const correct = pair.answer;
    const roundPoints = {}; // teams mode: which team scored

    if (gd.playMode === "teams") {
      ["A", "B"].forEach(function (t) {
        const members = gd.teams[t];
        const right = members.filter(function (u) { return gd.votes[u] === correct; }).length;
        // strict majority of the whole team must be right (unvoted members count against)
        if (right * 2 > members.length) {
          gd.scores[t] += 1;
          roundPoints[t] = true;
        }
      });
    } else {
      r.players.forEach(function (p) {
        if (gd.votes[p] === correct) gd.scores[p] = (gd.scores[p] || 0) + 1;
      });
    }

    io.to(code).emit("game:state", {
      phase: "reveal",
      data: {
        roundNumber: gd.roundIndex + 1,
        totalRounds: gd.deck.length,
        answer: correct,
        relation: pair.relation,
        person1: pair.person1,
        person2: pair.person2,
        votes: gd.votes,
        playMode: gd.playMode,
        teams: gd.teams,
        roundPoints: roundPoints,
        scores: gd.scores
      }
    });

    gd.roundIndex++;
    setTimeout(function () {
      const room = rooms.get(code);
      if (!room || room.gameData !== gd || !room.started) return;
      if (gd.roundIndex >= gd.deck.length) endGame(code);
      else startQuestion(code);
    }, REVEAL_MS);
  }

  function endGame(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    gd.phase = "game-end";
    r.started = false;

    let winner = null;       // display string
    let sorted = [];         // [{player, score}] for the final board
    let statScores = [];     // [{username, score}] for the leaderboard
    let statWinners = [];

    if (gd.playMode === "teams") {
      if (gd.scores.A !== gd.scores.B) {
        const t = gd.scores.A > gd.scores.B ? "A" : "B";
        winner = "Team " + t;
        statWinners = gd.teams[t].slice();
      }
      sorted = [
        { player: "Team A (" + gd.teams.A.join(", ") + ")", score: gd.scores.A },
        { player: "Team B (" + gd.teams.B.join(", ") + ")", score: gd.scores.B }
      ].sort(function (a, b) { return b.score - a.score; });
      ["A", "B"].forEach(function (t) {
        gd.teams[t].forEach(function (u) { statScores.push({ username: u, score: gd.scores[t] }); });
      });
    } else {
      sorted = Object.keys(gd.scores)
        .map(function (p) { return { player: p, score: gd.scores[p] }; })
        .sort(function (a, b) { return b.score - a.score; });
      const top = sorted.length ? sorted[0].score : 0;
      const tops = sorted.filter(function (e) { return e.score === top; });
      winner = tops.length === 1 ? tops[0].player : null;
      statScores = sorted.map(function (e) { return { username: e.player, score: e.score }; });
      statWinners = winner ? [winner] : [];
    }

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: {
        winner: winner,
        tie: !winner,
        playMode: gd.playMode,
        teams: gd.teams,
        scores: sorted,
        totalRounds: gd.deck.length
      }
    });

    if (!gd.recorded && statScores.length >= 2) {
      gd.recorded = true;
      statScores.sort(function (a, b) { return b.score - a.score; });
      try { stats.recordGameResult("siblings-dating", statScores, statWinners); } catch (e) { /* stats failure must not crash game */ }
    }
  }
};
