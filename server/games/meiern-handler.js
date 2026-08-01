// Meiern (Mäxchen) — Würfel-Bluff. Der aktive Spieler würfelt verdeckt und
// behauptet einen Wert, der höher sein muss als die Vorgabe. Der Nächste glaubt
// (und muss selbst höher behaupten) oder deckt auf. Wer falsch liegt, verliert
// ein Leben. Letzter mit Leben gewinnt.
//
// Festgelegte Variante (regional gibt es viele): Mäxchen (2-1) schlägt alles,
// Pasch schlägt Nicht-Pasch, sonst zählt der höhere Zahlenwert.
const stats = require("../stats");

// Rangfolge aufsteigend. Zwei Würfel, absteigend gelesen: 6,5 -> 65.
const RANK = [31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65,
              11, 22, 33, 44, 55, 66,
              21];                       // 21 = Mäxchen, höchster Wert
const LIVES = 3;
const TURN_MS = 40000;   // Zwangs-Zug, falls jemand einschläft

function rankOf(v) { return RANK.indexOf(v); }
function label(v) {
  if (v === 21) return "Mäxchen";
  var s = String(v);
  if (s[0] === s[1]) return s[0] + "er Pasch";
  return s;
}
function roll() {
  const a = 1 + Math.floor(Math.random() * 6);
  const b = 1 + Math.floor(Math.random() * 6);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return hi * 10 + lo;   // z.B. 6,5 -> 65 ; 2,1 -> 21 (Mäxchen)
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "meiern") return null;
    return r;
  }

  // Nur lebende Spieler, die auch da sind, in Sitzreihenfolge.
  function aliveSeats(gd) {
    return gd.seats.filter(function (p) { return gd.lives[p] > 0; });
  }
  function nextAlive(gd, from) {
    const seats = gd.seats;
    const n = seats.length;
    let i = seats.indexOf(from);
    for (let k = 1; k <= n; k++) {
      const cand = seats[(i + k) % n];
      if (gd.lives[cand] > 0) return cand;
    }
    return from;
  }

  socket.on("meiern:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    if (r.players.length < 2) {
      socket.emit("game:error", { message: "Meiern braucht mindestens 2 Spieler." });
      return;
    }
    const code = socket.roomCode;
    const gd = {
      phase: "turn",
      seats: r.players.slice(),
      lives: {},
      current: r.players[0],
      claim: null,          // letzte Behauptung (Wert)
      claimBy: null,
      actual: null,         // tatsächlicher Wurf des aktuellen Spielers (geheim!)
      hasRolled: false,
      lastReveal: null,
      turnTimer: null,
      recorded: false
    };
    r.players.forEach(function (p) { gd.lives[p] = LIVES; });
    r.started = true;
    r.gameData = gd;
    emitState(code, "Los geht's — " + gd.current + " beginnt.");
    armTurnTimer(code);
  });

  // Würfeln (nur der aktive Spieler, Ergebnis geht NUR an ihn)
  socket.on("meiern:roll", function () {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "turn" || gd.current !== socket.username || gd.hasRolled) return;
    gd.actual = roll();
    gd.hasRolled = true;
    // Nur an den Würfelnden — sonst stünde der Bluff in der Konsole aller.
    socket.emit("meiern:your-roll", {
      value: gd.actual, label: label(gd.actual),
      mustBeat: gd.claim, mustBeatLabel: gd.claim ? label(gd.claim) : null
    });
    emitState(socket.roomCode);
  });

  // Behaupten
  socket.on("meiern:claim", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const code = socket.roomCode;
    if (gd.phase !== "turn" || gd.current !== socket.username) return;
    if (!gd.hasRolled) { socket.emit("game:error", { message: "Erst würfeln!" }); return; }

    const v = parseInt(payload && payload.value, 10);
    if (rankOf(v) === -1) return;
    if (gd.claim !== null && rankOf(v) <= rankOf(gd.claim)) {
      socket.emit("game:error", { message: "Muss höher sein als " + label(gd.claim) + "." });
      return;
    }

    gd.claim = v;
    gd.claimBy = socket.username;
    gd.claimWasTrue = (rankOf(gd.actual) >= rankOf(v));   // serverseitig gemerkt
    gd.hasRolled = false;
    gd.actual = null;
    gd.current = nextAlive(gd, socket.username);
    clearTimeout(gd.turnTimer);
    emitState(code, gd.claimBy + " behauptet: " + label(v));
    armTurnTimer(code);
  });

  // Glauben → man ist selbst dran und muss höher behaupten
  socket.on("meiern:believe", function () {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "turn" || gd.current !== socket.username) return;
    if (gd.claim === null) return;
    emitState(socket.roomCode, socket.username + " glaubt es — und muss jetzt höher.");
  });

  // Aufdecken
  socket.on("meiern:doubt", function () {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const code = socket.roomCode;
    if (gd.phase !== "turn" || gd.current !== socket.username) return;
    if (gd.claim === null || !gd.claimBy) return;

    const wasTrue = !!gd.claimWasTrue;
    const loser = wasTrue ? socket.username : gd.claimBy;
    // Mäxchen aufdecken kostet doppelt, wenn es stimmte.
    const cost = (wasTrue && gd.claim === 21) ? 2 : 1;
    gd.lives[loser] = Math.max(0, gd.lives[loser] - cost);

    gd.lastReveal = {
      claim: gd.claim, claimLabel: label(gd.claim), claimBy: gd.claimBy,
      doubter: socket.username, wasTrue: wasTrue, loser: loser, cost: cost
    };

    clearTimeout(gd.turnTimer);

    const alive = aliveSeats(gd);
    if (alive.length <= 1) {
      gd.phase = "reveal";
      emitState(code);
      setTimeout(function () {
        const rm = rooms.get(code);
        if (!rm || rm.gameData !== gd || !rm.started) return;
        endGame(code);
      }, 4200);
      return;
    }

    // Neue Runde: Verlierer (falls noch am Leben) beginnt, sonst der Nächste.
    gd.claim = null; gd.claimBy = null; gd.claimWasTrue = null;
    gd.hasRolled = false; gd.actual = null;
    gd.current = gd.lives[loser] > 0 ? loser : nextAlive(gd, loser);
    gd.phase = "reveal";
    emitState(code);
    setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      gd.phase = "turn";
      gd.lastReveal = null;
      emitState(code, "Neue Runde — " + gd.current + " beginnt.");
      armTurnTimer(code);
    }, 4200);
  });

  socket.on("meiern:restart", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username) return;
    if (r.gameData && r.gameData.turnTimer) clearTimeout(r.gameData.turnTimer);
    r.started = false;
    r.gameData = {};
    io.to(socket.roomCode).emit("game:state", { phase: "lobby", data: {} });
  });

  // Wer zu lange braucht, verliert automatisch ein Leben (verhindert Blockade).
  function armTurnTimer(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.turnTimer) clearTimeout(gd.turnTimer);
    gd.turnTimer = setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started || gd.phase !== "turn") return;
      const slow = gd.current;
      gd.lives[slow] = Math.max(0, gd.lives[slow] - 1);
      gd.claim = null; gd.claimBy = null; gd.claimWasTrue = null;
      gd.hasRolled = false; gd.actual = null;
      if (aliveSeats(gd).length <= 1) { endGame(code); return; }
      gd.current = gd.lives[slow] > 0 ? slow : nextAlive(gd, slow);
      emitState(code, slow + " hat zu lange gebraucht und verliert ein Leben.");
      armTurnTimer(code);
    }, TURN_MS);
  }

  function emitState(code, message) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    io.to(code).emit("game:state", {
      phase: gd.phase,
      data: {
        seats: gd.seats,
        lives: gd.lives,
        current: gd.current,
        claim: gd.claim,
        claimLabel: gd.claim ? label(gd.claim) : null,
        claimBy: gd.claimBy,
        hasRolled: gd.hasRolled,
        // Erlaubte Behauptungen für den aktiven Spieler
        allowed: RANK.filter(function (v) { return gd.claim === null || rankOf(v) > rankOf(gd.claim); })
                     .map(function (v) { return { value: v, label: label(v) }; }),
        reveal: gd.lastReveal,
        message: message || null
      }
    });
  }

  function endGame(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.recorded) return;
    gd.recorded = true;
    gd.phase = "game-end";
    r.started = false;
    if (gd.turnTimer) clearTimeout(gd.turnTimer);

    const sorted = gd.seats.map(function (p) { return { player: p, score: gd.lives[p] }; })
                           .sort(function (a, b) { return b.score - a.score; });
    const alive = sorted.filter(function (e) { return e.score > 0; });
    const winner = alive.length === 1 ? alive[0].player : (sorted.length && sorted[0].score > 0 ? sorted[0].player : null);

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: { winner: winner, tie: !winner, scores: sorted, lives: gd.lives }
    });

    const statScores = sorted.map(function (e) { return { username: e.player, score: e.score }; });
    if (statScores.length >= 2) {
      try { stats.recordGameResult("meiern", statScores, winner ? [winner] : []); } catch (e) {}
    }
  }
};
