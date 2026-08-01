// Wellenlänge — Spektrum-Raten für zwei Teams. Ein Hinweisgeber sieht die
// geheime Zielposition auf einer Achse und darf EINEN Begriff nennen. Sein Team
// dreht am Regler. Das Gegenteam darf zusätzlich raten, ob das Ziel links oder
// rechts der Team-Schätzung liegt.
//
// Wichtig: Die Zielposition wird NUR an den Hinweisgeber gesendet.
const stats = require("../stats");

let AXES = [];
try { AXES = require("../../data/wellenlaenge.json"); } catch (e) { /* guarded below */ }

const CLUE_TIME  = 60;
const GUESS_TIME = 60;
const REVEAL_MS  = 6000;
const BAND = 6;   // halbe Breite des inneren Trefferbandes in Prozentpunkten

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function teamOf(teams, u) {
  if (!teams) return null;
  if (teams.A.indexOf(u) !== -1) return "A";
  if (teams.B.indexOf(u) !== -1) return "B";
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

// Punkte nach Abstand zum Ziel: 4 im inneren Band, dann 3, 2, sonst 0.
function pointsFor(dist) {
  if (dist <= BAND) return 4;
  if (dist <= BAND * 2) return 3;
  if (dist <= BAND * 3) return 2;
  return 0;
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "wellenlaenge") return null;
    return r;
  }

  socket.on("room:settings", function (s) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    s = s || {};
    if (s.rounds !== undefined) r.settings.rounds = Math.min(20, Math.max(2, parseInt(s.rounds, 10) || 8));
    io.to(socket.roomCode).emit("room:settings-updated", r.settings);
  });

  socket.on("wl:set-team", function (payload) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const player = payload && payload.player;
    if (r.players.indexOf(player) === -1) return;
    if (!r.settings.teamAssign) r.settings.teamAssign = {};
    const assign = r.settings.teamAssign;
    const cur = normalizeTeams(assign, r.players);
    r.players.forEach(function (p) { assign[p] = teamOf(cur, p); });
    assign[player] = assign[player] === "A" ? "B" : "A";
    io.to(socket.roomCode).emit("wl:teams", { teams: normalizeTeams(assign, r.players) });
  });

  socket.on("wl:get-teams", function () {
    const r = myRoom();
    if (!r) return;
    socket.emit("wl:teams", { teams: normalizeTeams(r.settings.teamAssign || {}, r.players) });
  });

  socket.on("wl:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const code = socket.roomCode;
    if (!AXES.length) {
      socket.emit("game:error", { message: "Keine Achsen gefunden (data/wellenlaenge.json fehlt)." });
      return;
    }
    if (r.players.length < 2) {
      socket.emit("game:error", { message: "Wellenlänge braucht mindestens 2 Spieler (am besten 4 für 2v2)." });
      return;
    }
    const teams = normalizeTeams(r.settings.teamAssign || {}, r.players);
    if (!teams.A.length || !teams.B.length) {
      socket.emit("game:error", { message: "Beide Teams brauchen mindestens 1 Spieler." });
      return;
    }
    const rounds = Math.min(20, Math.max(2, parseInt(r.settings.rounds, 10) || 8));

    r.started = true;
    r.gameData = {
      phase: "countdown",
      teams: teams,
      deck: shuffle(AXES).slice(0, rounds),
      roundIndex: 0,
      activeTeam: "A",
      clueGiver: teams.A[0],
      giverIndex: { A: 0, B: 0 },
      target: null,      // 0..100 — geheim!
      clue: null,
      guess: null,
      counter: null,     // "left" | "right" vom Gegenteam
      scores: { A: 0, B: 0 },
      timer: null,
      recorded: false
    };
    countdown(code, 3);
  });

  // Hinweis geben (nur der Hinweisgeber)
  socket.on("wl:clue", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "clue" || gd.clueGiver !== socket.username) return;
    const text = String((payload && payload.text) || "").trim().slice(0, 60);
    if (!text) return;
    gd.clue = text;
    clearTimeout(gd.timer);
    startGuess(socket.roomCode);
  });

  // Team-Schätzung (jeder aus dem aktiven Team darf schieben, letzter Wert gilt)
  socket.on("wl:guess", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "guess") return;
    if (teamOf(gd.teams, socket.username) !== gd.activeTeam) return;
    if (socket.username === gd.clueGiver) return;   // Hinweisgeber darf nicht raten
    const v = Number(payload && payload.value);
    if (!isFinite(v) || v < 0 || v > 100) return;
    gd.guess = v;
    io.to(socket.roomCode).emit("wl:guess-live", { value: v, by: socket.username });
  });

  // Gegenteam: links oder rechts davon?
  socket.on("wl:counter", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const code = socket.roomCode;
    if (gd.phase !== "guess") return;
    const t = teamOf(gd.teams, socket.username);
    if (!t || t === gd.activeTeam) return;
    const side = payload && payload.side;
    if (side !== "left" && side !== "right") return;
    gd.counter = side;
    io.to(code).emit("wl:counter-set", { side: side });
  });

  socket.on("wl:lock", function () {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "guess") return;
    if (teamOf(gd.teams, socket.username) !== gd.activeTeam) return;
    if (gd.guess === null) return;
    clearTimeout(gd.timer);
    endRound(socket.roomCode);
  });

  socket.on("wl:restart", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username) return;
    if (r.gameData && r.gameData.timer) clearTimeout(r.gameData.timer);
    r.started = false;
    r.gameData = {};
    io.to(socket.roomCode).emit("game:state", { phase: "lobby", data: {} });
  });

  // ── Ablauf ──
  function countdown(code, n) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.started) return;
    if (n <= 0) { startClue(code); return; }
    io.to(code).emit("game:state", { phase: "countdown", data: { count: n } });
    setTimeout(function () { countdown(code, n - 1); }, 1000);
  }

  function startClue(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.started) return;
    const gd = r.gameData;
    if (gd.roundIndex >= gd.deck.length) { endGame(code); return; }

    const axis = gd.deck[gd.roundIndex];
    // Ziel nicht zu weit außen — sonst ist der Hinweis kaum gebbar.
    gd.target = 8 + Math.random() * 84;
    gd.clue = null; gd.guess = null; gd.counter = null;
    gd.phase = "clue";

    // Hinweisgeber rotiert innerhalb des Teams
    const members = gd.teams[gd.activeTeam];
    gd.clueGiver = members[gd.giverIndex[gd.activeTeam] % members.length];

    const base = {
      roundNumber: gd.roundIndex + 1, totalRounds: gd.deck.length,
      axis: { left: axis[0], right: axis[1] },
      activeTeam: gd.activeTeam, clueGiver: gd.clueGiver,
      teams: gd.teams, scores: gd.scores, timeLeft: CLUE_TIME
    };

    // Alle bekommen den State OHNE Ziel …
    r.players.forEach(function (p) {
      const sockets = socketsOf(code, p);
      const isGiver = p === gd.clueGiver;
      sockets.forEach(function (s) {
        s.emit("game:state", {
          phase: "clue",
          data: isGiver ? Object.assign({}, base, { target: gd.target }) : base
        });
      });
    });

    gd.timer = setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      // kein Hinweis abgegeben → Runde ohne Punkte weiter
      gd.clue = "(kein Hinweis)";
      startGuess(code);
    }, CLUE_TIME * 1000);
  }

  // Alle Sockets eines Nutzers im Raum finden (mehrere Tabs möglich)
  function socketsOf(code, username) {
    const room = io.sockets.adapter.rooms.get(code);
    const out = [];
    if (!room) return out;
    room.forEach(function (sid) {
      const s = io.sockets.sockets.get(sid);
      if (s && s.username === username) out.push(s);
    });
    return out;
  }

  function startGuess(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "clue") return;
    gd.phase = "guess";
    gd.guess = 50;   // Startposition des Reglers
    const axis = gd.deck[gd.roundIndex];

    io.to(code).emit("game:state", {
      phase: "guess",
      data: {
        roundNumber: gd.roundIndex + 1, totalRounds: gd.deck.length,
        axis: { left: axis[0], right: axis[1] },
        clue: gd.clue, activeTeam: gd.activeTeam, clueGiver: gd.clueGiver,
        teams: gd.teams, scores: gd.scores, guess: gd.guess, timeLeft: GUESS_TIME
      }
    });

    gd.timer = setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      endRound(code);
    }, GUESS_TIME * 1000);
  }

  function endRound(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "guess") return;
    gd.phase = "reveal";

    const guess = gd.guess === null ? 50 : gd.guess;
    const dist = Math.abs(guess - gd.target);
    const pts = pointsFor(dist);
    gd.scores[gd.activeTeam] += pts;

    // Gegenteam: richtige Seite erraten = 1 Punkt (nur wenn nicht getroffen)
    const other = gd.activeTeam === "A" ? "B" : "A";
    let counterOk = false;
    if (gd.counter && pts < 4) {
      const targetIsLeft = gd.target < guess;
      counterOk = (gd.counter === "left" && targetIsLeft) || (gd.counter === "right" && !targetIsLeft);
      if (counterOk) gd.scores[other] += 1;
    }

    const axis = gd.deck[gd.roundIndex];
    io.to(code).emit("game:state", {
      phase: "reveal",
      data: {
        roundNumber: gd.roundIndex + 1, totalRounds: gd.deck.length,
        axis: { left: axis[0], right: axis[1] },
        clue: gd.clue, target: gd.target, guess: guess,
        distance: dist, points: pts,
        activeTeam: gd.activeTeam, clueGiver: gd.clueGiver,
        counter: gd.counter, counterOk: counterOk, counterTeam: other,
        teams: gd.teams, scores: gd.scores, band: BAND
      }
    });

    gd.giverIndex[gd.activeTeam]++;
    gd.activeTeam = other;
    gd.roundIndex++;

    setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      if (gd.roundIndex >= gd.deck.length) endGame(code);
      else startClue(code);
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
    if (gd.timer) clearTimeout(gd.timer);

    let winner = null, statWinners = [];
    if (gd.scores.A !== gd.scores.B) {
      const t = gd.scores.A > gd.scores.B ? "A" : "B";
      winner = "Team " + t;
      statWinners = gd.teams[t].slice();
    }
    const sorted = [
      { player: "Team A (" + gd.teams.A.join(", ") + ")", score: gd.scores.A },
      { player: "Team B (" + gd.teams.B.join(", ") + ")", score: gd.scores.B }
    ].sort(function (a, b) { return b.score - a.score; });

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: { winner: winner, tie: !winner, scores: sorted, totalRounds: gd.deck.length }
    });

    const statScores = [];
    ["A", "B"].forEach(function (t) {
      gd.teams[t].forEach(function (u) { statScores.push({ username: u, score: gd.scores[t] }); });
    });
    if (statScores.length >= 2) {
      statScores.sort(function (a, b) { return b.score - a.score; });
      try { stats.recordGameResult("wellenlaenge", statScores, statWinners); } catch (e) {}
    }
  }
};
