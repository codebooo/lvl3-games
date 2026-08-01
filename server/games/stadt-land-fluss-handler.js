// Stadt Land Fluss — mit FREI KONFIGURIERBAREN Kategorien.
// Der Host kann Kategorien hinzufügen und löschen, auch Stadt, Land und Fluss
// selbst. Einzige Regel: mindestens eine Kategorie muss übrig bleiben.
//
// Ablauf: Buchstabe → alle füllen parallel → erster drückt STOPP (oder Timer)
// → Review: jeder darf fremde Antworten anzweifeln (Mehrheit der anderen
// entscheidet) → Punkte.
const stats = require("../stats");

const DEFAULT_CATEGORIES = ["Stadt", "Land", "Fluss", "Tier", "Beruf"];
const MAX_CATEGORIES = 8;
const MIN_CATEGORIES = 1;
const MAX_CAT_LEN = 24;
const MAX_ANSWER_LEN = 40;
const WRITE_TIME  = 90;    // Sekunden Schreibphase (Backstop)
const REVIEW_TIME = 45;    // Sekunden Review/Anzweifeln
const NEXT_MS     = 5000;  // Pause vor der nächsten Runde

// Q, X, Y sind für die meisten Kategorien unfair — rausgelassen.
const LETTERS = "ABCDEFGHIJKLMNOPRSTUVWZ".split("");

function norm(s) {
  return String(s || "").toLowerCase().trim()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}
function cleanCat(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, MAX_CAT_LEN);
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "stadt-land-fluss") return null;
    return r;
  }
  function present(r) {
    return r.players.filter(function (p) { return !(r.grace && r.grace[p]); });
  }
  function cats(r) {
    if (!Array.isArray(r.settings.categories) || !r.settings.categories.length) {
      r.settings.categories = DEFAULT_CATEGORIES.slice();
    }
    return r.settings.categories;
  }

  // ── Kategorie-Verwaltung (nur Host, nur vor dem Start) ──
  socket.on("slf:add-category", function (payload) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const name = cleanCat(payload && payload.name);
    if (!name) return;
    const list = cats(r);
    if (list.length >= MAX_CATEGORIES) {
      socket.emit("game:error", { message: "Maximal " + MAX_CATEGORIES + " Kategorien." });
      return;
    }
    if (list.some(function (c) { return norm(c) === norm(name); })) {
      socket.emit("game:error", { message: "\"" + name + "\" gibt es schon." });
      return;
    }
    list.push(name);
    io.to(socket.roomCode).emit("slf:categories", { categories: list });
  });

  socket.on("slf:remove-category", function (payload) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const name = payload && payload.name;
    const list = cats(r);
    const i = list.findIndex(function (c) { return c === name; });
    if (i === -1) return;
    if (list.length <= MIN_CATEGORIES) {
      socket.emit("game:error", { message: "Mindestens eine Kategorie muss bleiben." });
      return;
    }
    list.splice(i, 1);   // Stadt/Land/Fluss dürfen ausdrücklich auch weg
    io.to(socket.roomCode).emit("slf:categories", { categories: list });
  });

  socket.on("slf:reset-categories", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    r.settings.categories = DEFAULT_CATEGORIES.slice();
    io.to(socket.roomCode).emit("slf:categories", { categories: r.settings.categories });
  });

  socket.on("slf:get-categories", function () {
    const r = myRoom();
    if (!r) return;
    socket.emit("slf:categories", { categories: cats(r) });
  });

  socket.on("room:settings", function (s) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    s = s || {};
    if (s.rounds !== undefined) {
      r.settings.rounds = Math.min(15, Math.max(1, parseInt(s.rounds, 10) || 5));
    }
    io.to(socket.roomCode).emit("room:settings-updated", r.settings);
  });

  // ── Start ──
  socket.on("slf:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    const code = socket.roomCode;
    const categories = cats(r).slice();
    if (!categories.length) {
      socket.emit("game:error", { message: "Mindestens eine Kategorie nötig." });
      return;
    }
    const rounds = Math.min(15, Math.max(1, parseInt(r.settings.rounds, 10) || 5));

    r.started = true;
    r.gameData = {
      phase: "countdown",
      categories: categories,
      totalRounds: rounds,
      roundIndex: 0,
      letter: null,
      usedLetters: {},
      answers: {},      // username -> { category -> text }
      stopped: false,
      stoppedBy: null,
      challenges: {},   // "user|cat" -> [challengers]
      roundScores: {},
      scores: {},
      timer: null,
      recorded: false
    };
    r.players.forEach(function (p) { r.gameData.scores[p] = 0; });
    countdown(code, 3);
  });

  // ── Schreibphase ──
  socket.on("slf:submit", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "write") return;
    const incoming = (payload && payload.answers) || {};
    const mine = {};
    gd.categories.forEach(function (c) {
      const v = String(incoming[c] || "").trim().slice(0, MAX_ANSWER_LEN);
      mine[c] = v;
    });
    gd.answers[socket.username] = mine;
    io.to(socket.roomCode).emit("slf:submit-count", {
      count: Object.keys(gd.answers).length, total: present(r).length
    });
  });

  // STOPP — beendet die Schreibphase für alle
  socket.on("slf:stop", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const code = socket.roomCode;
    if (gd.phase !== "write" || gd.stopped) return;
    // Letzten Stand des Stoppers noch übernehmen
    const incoming = (payload && payload.answers) || {};
    const mine = {};
    gd.categories.forEach(function (c) { mine[c] = String(incoming[c] || "").trim().slice(0, MAX_ANSWER_LEN); });
    gd.answers[socket.username] = mine;

    gd.stopped = true;
    gd.stoppedBy = socket.username;
    clearTimeout(gd.timer);
    startReview(code);
  });

  // ── Review: fremde Antwort anzweifeln (Toggle) ──
  socket.on("slf:challenge", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "review") return;
    const target = payload && payload.player;
    const cat = payload && payload.category;
    if (!target || !cat) return;
    if (target === socket.username) return;             // eigene nicht anzweifeln
    if (gd.categories.indexOf(cat) === -1) return;
    if (!gd.answers[target] || !norm(gd.answers[target][cat])) return;  // Leeres ist schon 0

    const key = target + "|" + cat;
    if (!gd.challenges[key]) gd.challenges[key] = [];
    const list = gd.challenges[key];
    const i = list.indexOf(socket.username);
    if (i === -1) list.push(socket.username); else list.splice(i, 1);

    io.to(socket.roomCode).emit("slf:challenges", { challenges: gd.challenges });
  });

  socket.on("slf:finish-review", function () {
    const r = myRoom();
    if (!r || !r.gameData) return;
    if (r.host !== socket.username) return;
    if (r.gameData.phase !== "review") return;
    clearTimeout(r.gameData.timer);
    scoreRound(socket.roomCode);
  });

  socket.on("slf:restart", function () {
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
    if (n <= 0) { startWrite(code); return; }
    io.to(code).emit("game:state", { phase: "countdown", data: { count: n } });
    setTimeout(function () { countdown(code, n - 1); }, 1000);
  }

  function startWrite(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData || !r.started) return;
    const gd = r.gameData;
    if (gd.roundIndex >= gd.totalRounds) { endGame(code); return; }

    // Buchstabe ohne Wiederholung, solange möglich
    let pool = LETTERS.filter(function (l) { return !gd.usedLetters[l]; });
    if (!pool.length) { gd.usedLetters = {}; pool = LETTERS.slice(); }
    const letter = pool[Math.floor(Math.random() * pool.length)];
    gd.usedLetters[letter] = true;

    gd.phase = "write";
    gd.letter = letter;
    gd.answers = {};
    gd.challenges = {};
    gd.stopped = false;
    gd.stoppedBy = null;

    io.to(code).emit("game:state", {
      phase: "write",
      data: {
        roundNumber: gd.roundIndex + 1, totalRounds: gd.totalRounds,
        letter: letter, categories: gd.categories,
        timeLeft: WRITE_TIME, scores: gd.scores, votersTotal: present(r).length
      }
    });
    gd.timer = setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      gd.stopped = true; gd.stoppedBy = null;   // Zeit abgelaufen
      startReview(code);
    }, WRITE_TIME * 1000);
  }

  function startReview(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "write") return;
    gd.phase = "review";

    // Fehlende Spieler bekommen leere Antworten, damit die Tabelle komplett ist.
    r.players.forEach(function (p) {
      if (!gd.answers[p]) {
        const empty = {};
        gd.categories.forEach(function (c) { empty[c] = ""; });
        gd.answers[p] = empty;
      }
    });

    io.to(code).emit("game:state", {
      phase: "review",
      data: {
        roundNumber: gd.roundIndex + 1, totalRounds: gd.totalRounds,
        letter: gd.letter, categories: gd.categories,
        answers: gd.answers, players: r.players.slice(),
        stoppedBy: gd.stoppedBy, timeLeft: REVIEW_TIME,
        challenges: gd.challenges, scores: gd.scores
      }
    });
    gd.timer = setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      scoreRound(code);
    }, REVIEW_TIME * 1000);
  }

  function scoreRound(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "review") return;
    gd.phase = "result";

    const L = norm(gd.letter);
    const valid = {};    // "user|cat" -> bool
    const detail = {};   // "user|cat" -> {text, points, reason}
    const roundPts = {};
    r.players.forEach(function (p) { roundPts[p] = 0; });

    gd.categories.forEach(function (cat) {
      // 1. Gültigkeit bestimmen
      r.players.forEach(function (p) {
        const text = (gd.answers[p] && gd.answers[p][cat]) || "";
        const n = norm(text);
        const key = p + "|" + cat;
        if (!n) { valid[key] = false; detail[key] = { text: text, points: 0, reason: "leer" }; return; }
        if (n[0] !== L) { valid[key] = false; detail[key] = { text: text, points: 0, reason: "falscher Buchstabe" }; return; }
        // Anzweifeln: Mehrheit der ANDEREN Spieler muss dagegen sein
        const challengers = (gd.challenges[key] || []).filter(function (c) { return c !== p; });
        const others = r.players.length - 1;
        if (others > 0 && challengers.length * 2 > others) {
          valid[key] = false;
          detail[key] = { text: text, points: 0, reason: "abgelehnt (" + challengers.length + ")" };
          return;
        }
        valid[key] = true;
        detail[key] = { text: text, points: 0, reason: "" };
      });

      // 2. Punkte: 20 = einziger mit gültiger Antwort, 10 = einzigartig, 5 = geteilt
      const validPlayers = r.players.filter(function (p) { return valid[p + "|" + cat]; });
      const counts = {};
      validPlayers.forEach(function (p) {
        const n = norm(gd.answers[p][cat]);
        counts[n] = (counts[n] || 0) + 1;
      });
      validPlayers.forEach(function (p) {
        const key = p + "|" + cat;
        const n = norm(gd.answers[p][cat]);
        let pts;
        if (validPlayers.length === 1) pts = 20;
        else if (counts[n] === 1) pts = 10;
        else pts = 5;
        detail[key].points = pts;
        roundPts[p] += pts;
      });
    });

    Object.keys(roundPts).forEach(function (p) { gd.scores[p] = (gd.scores[p] || 0) + roundPts[p]; });
    gd.roundScores = roundPts;

    io.to(code).emit("game:state", {
      phase: "result",
      data: {
        roundNumber: gd.roundIndex + 1, totalRounds: gd.totalRounds,
        letter: gd.letter, categories: gd.categories,
        players: r.players.slice(), detail: detail,
        roundPoints: roundPts, scores: gd.scores
      }
    });

    gd.roundIndex++;
    setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;
      if (gd.roundIndex >= gd.totalRounds) endGame(code);
      else startWrite(code);
    }, NEXT_MS);
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
      data: {
        winner: winner, tie: !winner, scores: sorted,
        totalRounds: gd.totalRounds, categories: gd.categories
      }
    });

    const statScores = sorted.map(function (e) { return { username: e.player, score: e.score }; });
    if (statScores.length >= 2) {
      try { stats.recordGameResult("stadt-land-fluss", statScores, winner ? [winner] : []); } catch (e) {}
    }
  }
};
