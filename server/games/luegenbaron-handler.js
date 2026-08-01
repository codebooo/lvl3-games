// Lügenbaron — Bluff-Quiz. Alle erfinden eine falsche Antwort auf eine Frage,
// dann muss jeder aus dem Mix die echte Antwort finden. Punkte für Wahrheit
// finden UND dafür, andere auf die eigene Lüge reinzulegen.
const stats = require("../stats");

let QUESTIONS = [];
try { QUESTIONS = require("../../data/luegenbaron.json"); } catch (e) { /* guarded below */ }

const LIE_TIME  = 35;    // Sekunden zum Lügen erfinden
const PICK_TIME = 25;    // Sekunden zum Wählen
const REVEAL_MS = 6500;  // Reveal-Pause
const MAX_LEN   = 80;    // maximale Antwortlänge

// Server-Lügen, falls zu wenige Spieler eigene Fakes liefern (sonst ist die
// Ratequote bei 2-3 Spielern zu hoch).
const HOUSE_LIES = ["42", "Keine Ahnung", "Sieben", "Berlin", "1995", "Der Dachs", "Zwölf", "Blau"];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "luegenbaron") return null;
    return r;
  }
  function present(r) {
    return r.players.filter(function (p) { return !(r.grace && r.grace[p]); });
  }

  socket.on("room:settings", function (s) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    s = s || {};
    if (s.rounds !== undefined) {
      r.settings.rounds = Math.min(15, Math.max(3, parseInt(s.rounds, 10) || 7));
    }
    io.to(socket.roomCode).emit("room:settings-updated", r.settings);
  });

  socket.on("luegenbaron:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const code = socket.roomCode;

    if (!QUESTIONS.length) {
      socket.emit("game:error", { message: "Keine Fragen gefunden (data/luegenbaron.json fehlt)." });
      return;
    }
    if (r.players.length < 2) {
      socket.emit("game:error", { message: "Lügenbaron braucht mindestens 2 Spieler (am besten 3–4)." });
      return;
    }

    const rounds = Math.min(15, Math.max(3, parseInt(r.settings.rounds, 10) || 7));
    const gd = {
      phase: "countdown",
      deck: shuffle(QUESTIONS).slice(0, rounds),
      roundIndex: 0,
      lies: {},        // username -> {raw, norm}
      picks: {},       // username -> optionId
      options: [],     // [{id, text, owner|null}]  owner=null => Wahrheit
      scores: {},
      timer: null,
      recorded: false
    };
    r.players.forEach(function (p) { gd.scores[p] = 0; });
    r.started = true;
    r.gameData = gd;
    countdown(code, 3);
  });

  socket.on("luegenbaron:lie", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "lie") return;
    if (gd.lies[socket.username]) return;

    const raw = String((payload && payload.text) || "").trim().slice(0, MAX_LEN);
    if (!norm(raw)) return;

    const q = gd.deck[gd.roundIndex];
    // Wer versehentlich die Wahrheit tippt, muss nochmal — sonst wäre die
    // "Lüge" nicht von der echten Antwort zu unterscheiden.
    if (norm(raw) === norm(q.a)) {
      socket.emit("luegenbaron:lie-rejected", { reason: "Das ist die richtige Antwort! Denk dir eine Lüge aus." });
      return;
    }
    // Doppelte Lügen zusammenlegen: beide Urheber bekommen später Punkte.
    gd.lies[socket.username] = { raw: raw, norm: norm(raw) };
    io.to(socket.roomCode).emit("luegenbaron:lie-count", {
      count: Object.keys(gd.lies).length, total: present(r).length
    });

    const pl = present(r);
    if (pl.length > 0 && pl.every(function (p) { return gd.lies[p]; })) {
      clearTimeout(gd.timer);
      startPick(socket.roomCode);
    }
  });

  socket.on("luegenbaron:pick", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const code = socket.roomCode;
    if (gd.phase !== "pick") return;
    if (gd.picks[socket.username]) return;

    const id = payload && payload.id;
    const opt = gd.options.find(function (o) { return o.id === id; });
    if (!opt) return;
    // Man darf nicht die eigene Lüge wählen.
    if (opt.owners && opt.owners.indexOf(socket.username) !== -1) {
      socket.emit("luegenbaron:pick-rejected", { reason: "Das ist deine eigene Lüge!" });
      return;
    }

    gd.picks[socket.username] = id;
    io.to(code).emit("luegenbaron:pick-count", {
      count: Object.keys(gd.picks).length, total: present(r).length
    });

    const pl = present(r);
    if (pl.length > 0 && pl.every(function (p) { return gd.picks[p]; })) {
      clearTimeout(gd.timer);
      endRound(code);
    }
  });

  socket.on("luegenbaron:restart", function () {
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
    if (n <= 0) { startLie(code); return; }
    io.to(code).emit("game:state", { phase: "countdown", data: { count: n } });
    setTimeout(function () { countdown(code, n - 1); }, 1000);
  }

  function startLie(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.started) return;
    const gd = r.gameData;
    if (gd.roundIndex >= gd.deck.length) { endGame(code); return; }

    gd.phase = "lie";
    gd.lies = {};
    gd.picks = {};
    gd.options = [];
    const q = gd.deck[gd.roundIndex];

    io.to(code).emit("game:state", {
      phase: "lie",
      data: {
        roundNumber: gd.roundIndex + 1, totalRounds: gd.deck.length,
        question: q.q, timeLeft: LIE_TIME,
        scores: gd.scores, votersTotal: present(r).length
      }
    });
    gd.timer = setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      startPick(code);
    }, LIE_TIME * 1000);
  }

  function startPick(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "lie") return;
    gd.phase = "pick";
    const q = gd.deck[gd.roundIndex];

    // Lügen nach normalisiertem Text gruppieren (Duplikate = mehrere Urheber).
    const byNorm = {};
    Object.keys(gd.lies).forEach(function (u) {
      const l = gd.lies[u];
      if (!byNorm[l.norm]) byNorm[l.norm] = { text: l.raw, owners: [] };
      byNorm[l.norm].owners.push(u);
    });

    let opts = Object.keys(byNorm).map(function (k, i) {
      return { id: "L" + i, text: byNorm[k].text, owners: byNorm[k].owners };
    });

    // Zu wenige Lügen? Haus-Lügen auffüllen, damit Raten nicht trivial ist.
    let hi = 0;
    const houses = shuffle(HOUSE_LIES);
    while (opts.length < 3 && hi < houses.length) {
      const cand = houses[hi++];
      if (norm(cand) === norm(q.a)) continue;
      if (opts.some(function (o) { return norm(o.text) === norm(cand); })) continue;
      opts.push({ id: "H" + hi, text: cand, owners: [] });
    }

    opts.push({ id: "T", text: q.a, owners: null });   // owners null => Wahrheit
    gd.options = shuffle(opts);

    io.to(code).emit("game:state", {
      phase: "pick",
      data: {
        roundNumber: gd.roundIndex + 1, totalRounds: gd.deck.length,
        question: q.q, timeLeft: PICK_TIME,
        // Urheber werden NICHT mitgesendet — sonst stünde die Lösung im Client.
        options: gd.options.map(function (o) { return { id: o.id, text: o.text }; }),
        scores: gd.scores, votersTotal: present(r).length
      }
    });
    gd.timer = setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      endRound(code);
    }, PICK_TIME * 1000);
  }

  function endRound(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "pick") return;
    gd.phase = "reveal";
    const q = gd.deck[gd.roundIndex];

    const gained = {};
    r.players.forEach(function (p) { gained[p] = 0; });

    Object.keys(gd.picks).forEach(function (voter) {
      const opt = gd.options.find(function (o) { return o.id === gd.picks[voter]; });
      if (!opt) return;
      if (opt.owners === null) {
        gained[voter] = (gained[voter] || 0) + 2;          // Wahrheit gefunden
      } else {
        opt.owners.forEach(function (owner) {              // reingelegt
          if (owner !== voter) gained[owner] = (gained[owner] || 0) + 1;
        });
      }
    });
    Object.keys(gained).forEach(function (p) { gd.scores[p] = (gd.scores[p] || 0) + gained[p]; });

    io.to(code).emit("game:state", {
      phase: "reveal",
      data: {
        roundNumber: gd.roundIndex + 1, totalRounds: gd.deck.length,
        question: q.q, truth: q.a,
        // Jetzt dürfen Urheber gezeigt werden — die Runde ist vorbei.
        options: gd.options.map(function (o) {
          return {
            id: o.id, text: o.text,
            isTruth: o.owners === null,
            owners: o.owners || [],
            pickedBy: Object.keys(gd.picks).filter(function (v) { return gd.picks[v] === o.id; })
          };
        }),
        gained: gained, scores: gd.scores
      }
    });

    gd.roundIndex++;
    setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      if (gd.roundIndex >= gd.deck.length) endGame(code);
      else startLie(code);
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

    const sorted = Object.keys(gd.scores).map(function (p) {
      return { player: p, score: gd.scores[p] };
    }).sort(function (a, b) { return b.score - a.score; });
    const top = sorted.length ? sorted[0].score : 0;
    const tops = sorted.filter(function (e) { return e.score === top; });
    const winner = tops.length === 1 ? tops[0].player : null;

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: { winner: winner, tie: !winner, scores: sorted, totalRounds: gd.deck.length }
    });

    const statScores = sorted.map(function (e) { return { username: e.player, score: e.score }; });
    if (statScores.length >= 2) {
      try { stats.recordGameResult("luegenbaron", statScores, winner ? [winner] : []); } catch (e) {}
    }
  }
};
