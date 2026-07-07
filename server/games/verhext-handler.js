// Verhext — 2 teams of players each get the SAME random German word. Each player
// privately submits a word they think their teammate(s) will also submit. A team
// scores +1 for a round IF all its members submitted the "same" word (typo-tolerant
// Levenshtein). Race mode (first to N points) or standard mode (N rounds). Most points wins.
const stats = require("../stats");

let WORDS = { easy: [], normal: [], hard: [] };
try { WORDS = require("../../data/galgenraten-words.json"); } catch (e) { /* fallback below */ }

const FALLBACK  = ["COMPUTER", "URLAUB", "SOMMER", "FREUNDE", "BÄCKER", "GARTEN", "FERNSEHER", "KAFFEE"];
const REVEAL_MS = 4000; // pause on the reveal screen before the next round / end
const WORD_MS   = 45000; // max time for a round's word phase before it force-resolves

function randInt(n) { return Math.floor(Math.random() * n); }

function randomWord() {
  // ponytail: one mixed pool is enough — Verhext has no difficulty setting.
  let pool = [].concat(WORDS.easy || [], WORDS.normal || [], WORDS.hard || []);
  if (!pool.length) pool = FALLBACK;
  return String(pool[randInt(pool.length)]).toUpperCase();
}

// normalize for comparison: lowercase, fold German umlauts to ascii digraphs
// (ä→ae etc, so "Bäcker" == "baecker"), trim, collapse internal whitespace
function normalize(w) {
  return String(w || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/\s+/g, " ").trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function same(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a.length || !b.length) return false;
  const tol = Math.max(1, Math.floor(Math.min(a.length, b.length) / 5));
  return levenshtein(a, b) <= tol;
}

// a team matches if every pair of its members' words is "same"
function teamMatches(words) {
  if (words.length < 2) return false;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      if (!same(words[i], words[j])) return false;
    }
  }
  return true;
}

function splitTeams(players) {
  const half = Math.ceil(players.length / 2);
  return { A: players.slice(0, half), B: players.slice(half) };
}
function teamOf(gd, username) {
  if (gd.teams.A.indexOf(username) !== -1) return "A";
  if (gd.teams.B.indexOf(username) !== -1) return "B";
  return null;
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "verhext") return null;
    return r;
  }

  socket.on("room:settings", function (s) {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    s = s || {};
    if (s.mode !== undefined) r.settings.vMode = (s.mode === "standard") ? "standard" : "race";
    if (s.target !== undefined) {
      const n = parseInt(s.target, 10);
      if (!isNaN(n)) {
        const mode = r.settings.vMode === "standard" ? "standard" : "race";
        r.settings.vTarget = mode === "race"
          ? Math.max(1, Math.min(50, n))
          : Math.max(1, Math.min(100, n));
      }
    }
    io.to(socket.roomCode).emit("room:settings-updated", r.settings);
  });

  socket.on("verhext:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    if (r.players.length < 4) {
      socket.emit("game:error", { message: "Verhext braucht mindestens 4 Spieler (2 Teams)." });
      return;
    }
    const mode   = r.settings.vMode === "standard" ? "standard" : "race";
    const target = (typeof r.settings.vTarget === "number") ? r.settings.vTarget : 5;

    r.started = true;
    r.gameData = {
      mode: mode,
      target: target,
      teams: splitTeams(r.players),
      scores: { A: 0, B: 0 },
      round: 0,
      word: "",
      submissions: {},   // username -> { raw, norm }
      reveal: null,
      winner: null,
      recorded: false
    };
    startRound(socket.roomCode);
  });

  socket.on("verhext:submit", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "word") return;
    const t = teamOf(gd, socket.username);
    if (!t) return;
    if (gd.submissions[socket.username]) return; // already submitted this round
    const raw = String((payload && payload.word) || "").slice(0, 60);
    if (!normalize(raw).length) return;
    gd.submissions[socket.username] = { raw: raw, norm: normalize(raw) };

    // Resolve when every player STILL PRESENT has submitted (not the start-of-game
    // snapshot) — otherwise a disconnect during the word phase freezes the round
    // forever. The word timer below is the backstop if someone just never submits.
    const present = r.players.filter(p => teamOf(gd, p));
    const allIn = present.length > 0 && present.every(p => gd.submissions[p]);
    if (allIn) resolveRound(socket.roomCode);
    else emitState(socket.roomCode, "word");
  });

  socket.on("verhext:restart", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username) return;
    r.started = false;
    r.gameData = {};
    io.to(socket.roomCode).emit("game:state", { phase: "lobby", data: {} });
  });

  // ── round / end helpers ──
  function startRound(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    gd.round += 1;
    gd.word = randomWord();
    gd.submissions = {};
    gd.reveal = null;
    gd.phase = "word";
    // Backstop: force-resolve the round if not everyone submits in time (e.g. a
    // player disconnected mid-phase). Guarded against restart/room-empty.
    if (gd.wordTimer) clearTimeout(gd.wordTimer);
    gd.wordTimer = setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started || gd.phase !== "word") return;
      resolveRound(code);
    }, WORD_MS);
    emitState(code, "word");
  }

  function resolveRound(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.phase !== "word") return;  // already resolved (timer + last submit raced)
    if (gd.wordTimer) { clearTimeout(gd.wordTimer); gd.wordTimer = null; }
    const reveal = {};
    ["A", "B"].forEach(function (t) {
      const words = {};
      const list = [];
      (gd.teams[t] || []).forEach(function (u) {
        const sub = gd.submissions[u];
        const w = sub ? sub.raw : "";
        words[u] = w;
        list.push(w);
      });
      const matched = teamMatches(list);
      if (matched) gd.scores[t] += 1;
      reveal[t] = { words: words, matched: matched };
    });
    gd.reveal = reveal;
    gd.phase = "reveal";
    emitState(code, "reveal");

    const over = isOver(gd);
    setTimeout(function () {
      const rm = rooms.get(code);
      if (!rm || rm.gameData !== gd || !rm.started) return;  // restart/leave guard
      if (over) endGame(code); else startRound(code);
    }, REVEAL_MS);
  }

  function isOver(gd) {
    if (gd.mode === "race") return gd.scores.A >= gd.target || gd.scores.B >= gd.target;
    return gd.round >= gd.target; // standard: target rounds played
  }

  function endGame(code) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    let winner;
    if (gd.scores.A > gd.scores.B) winner = "A";
    else if (gd.scores.B > gd.scores.A) winner = "B";
    else winner = "tie";
    gd.winner = winner;
    gd.phase = "end";
    r.started = false;
    recordTeam(r, gd, winner === "tie" ? null : winner);
    emitState(code, "end");
  }

  function recordTeam(r, gd, winner) {
    if (gd.recorded) return;
    gd.recorded = true;
    const scores = [];
    ["A", "B"].forEach(function (t) {
      (gd.teams[t] || []).forEach(function (u) {
        scores.push({ username: u, score: (winner === t) ? 10 : 0 });
      });
    });
    if (scores.length < 2) return;
    scores.sort(function (x, y) { return y.score - x.score; });
    const winners = winner ? (gd.teams[winner] || []).slice() : [];
    try { stats.recordGameResult("verhext", scores, winners); } catch (e) {}
  }

  function emitState(code, phase) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const data = {
      mode: gd.mode,
      target: gd.target,
      round: gd.round,
      totalRounds: gd.mode === "standard" ? gd.target : null,
      teams: { A: gd.teams.A.slice(), B: gd.teams.B.slice() },
      word: (phase === "word" || phase === "reveal") ? gd.word : "",
      submitted: Object.keys(gd.submissions), // names only — never the words during "word"
      scores: { A: gd.scores.A, B: gd.scores.B },
      reveal: phase === "reveal" ? gd.reveal : null,
      winner: gd.winner || null
    };
    io.to(code).emit("game:state", { phase: phase, data: data });
  }
};
