const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const compression = require("compression");
const path = require("path");
const crypto = require("crypto");
const store = require("./server/store");
const stats = require("./server/stats");

// ─── Remember-Me (stateless, signed cookie) ───────────────────────────────────
// The token is fully self-contained and HMAC-signed, so it survives server
// restarts AND redeploys (no dependency on any runtime-written file). It stays
// valid for 3 months. Secret falls back to a stable constant so it keeps working
// even when no env var is set.
const REMEMBER_SECRET   = process.env.SESSION_SECRET || "lvl3games_s3cr3t_2024";
const REMEMBER_COOKIE   = "lvl3_remember";
const REMEMBER_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // ~3 months

function b64url(str) {
  return Buffer.from(str, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = String(str).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(str, "base64").toString("utf8");
}
function signRemember(payload) {
  return crypto.createHmac("sha256", REMEMBER_SECRET).update(payload).digest("hex");
}
function makeRememberToken(username) {
  const expires = Date.now() + REMEMBER_MAX_AGE_MS;
  const payload = b64url(username) + "." + expires;
  return payload + "." + signRemember(payload);
}
function verifyRememberToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[0] + "." + parts[1];
  const expected = signRemember(payload);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const expires = parseInt(parts[1], 10);
  if (!expires || Date.now() > expires) return null;
  let username;
  try { username = b64urlDecode(parts[0]); } catch (e) { return null; }
  if (!username) return null;
  return { username, expires };
}
function setRememberCookie(res, username) {
  const token = encodeURIComponent(makeRememberToken(username));
  res.append("Set-Cookie",
    REMEMBER_COOKIE + "=" + token +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + Math.floor(REMEMBER_MAX_AGE_MS / 1000));
}
function clearRememberCookie(res) {
  res.append("Set-Cookie", REMEMBER_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

// ─── Crash Safety ──────────────────────────────────────────────────────────────
// A single throwing timer callback or socket handler must never take the whole
// process down and drop every live room. Log and keep serving.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err && err.stack ? err.stack : err);
});

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
  perMessageDeflate: { threshold: 512 }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(compression({ level: 6, threshold: 512 }));
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "30d",
  immutable: true,
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    // Don't cache HTML — always fetch fresh so game updates land immediately
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "lvl3games_s3cr3t_2024",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

// ─── Remember-Me Middleware ───────────────────────────────────────────────────
// Runs after session middleware. If the session has no user but a remember-me
// cookie is present, validate it and restore the session automatically.
app.use(function rememberMe(req, res, next) {
  if (req.session.username) return next(); // already authenticated

  // Manual cookie parse — no extra dependencies
  const cookieHeader = req.headers.cookie || "";
  let rememberVal = null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(REMEMBER_COOKIE + "=")) {
      rememberVal = decodeURIComponent(trimmed.slice((REMEMBER_COOKIE + "=").length));
      break;
    }
  }
  if (!rememberVal) return next();

  const parsed = verifyRememberToken(rememberVal);
  if (!parsed) {
    clearRememberCookie(res); // invalid / expired / tampered — drop it
    return next();
  }

  // Make sure the user still exists (e.g. removed account)
  const users = loadUsers();
  const user  = users.find(u => u.username.toLowerCase() === parsed.username.toLowerCase());
  if (!user) {
    clearRememberCookie(res);
    return next();
  }

  // Valid token — restore session and keep it long-lived
  req.session.username = user.username;
  req.session.cookie.maxAge = REMEMBER_MAX_AGE_MS;
  return next();
});

// Share session with socket.io
io.engine.use(sessionMiddleware);

// ─── User Data ────────────────────────────────────────────────────────────────
function loadUsers() {
  return store.get("users");
}

function saveUsers(users) {
  store.set("users", users);
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { username, password, rememberMe } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, error: "Benutzername erforderlich." });
  }

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user) {
    return res.status(401).json({ success: false, error: "Unbekannter Benutzer." });
  }

  // First login: skip password check, log in immediately
  if (!user.passwordChanged) {
    req.session.username = user.username;
    if (rememberMe) {
      req.session.cookie.maxAge = REMEMBER_MAX_AGE_MS;
      setRememberCookie(res, user.username);
    }
    req.session.save();
    return res.json({ success: true, username: user.username, passwordChanged: false });
  }

  // Returning user: reveal password field if not provided yet
  if (!password) {
    return res.json({ success: false, needsPassword: true });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ success: false, error: "Falsches Passwort." });
  }

  req.session.username = user.username;

  if (rememberMe) {
    // Keep both the session cookie and the signed remember cookie alive 3 months.
    req.session.cookie.maxAge = REMEMBER_MAX_AGE_MS;
    setRememberCookie(res, user.username);
  }

  req.session.save();
  return res.json({ success: true, username: user.username, passwordChanged: true });
});

app.post("/api/change-password", async (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
  }

  const users = loadUsers();
  const user = users.find(u => u.username === req.session.username);
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.passwordChanged = true;
  saveUsers(users);

  return res.json({ success: true });
});

app.get("/api/me", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const users = loadUsers();
  const user = users.find(u => u.username === req.session.username);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }
  return res.json({ username: user.username, passwordChanged: user.passwordChanged, avatar: user.avatar || null });
});

// Own 14mb parser so a ~10MB decoded avatar (≈13.3MB base64 body) isn't rejected
// by the global 12mb json limit with a generic 413 before our friendly check runs.
app.post("/api/avatar", express.json({ limit: "14mb" }), (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ success: false, error: "Nicht angemeldet." });
  }
  const { image } = req.body;
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    return res.status(400).json({ success: false, error: "Ungültiges Bildformat." });
  }

  // Compute approximate decoded byte size from the base64 portion
  const commaIdx = image.indexOf(",");
  const base64Part = commaIdx !== -1 ? image.slice(commaIdx + 1) : image;
  const byteSize = Math.floor(base64Part.length * 0.75);
  if (byteSize > 10 * 1024 * 1024) {
    return res.status(400).json({ success: false, error: "Bild zu groß (max 10 MB)." });
  }

  const users = loadUsers();
  const user = users.find(u => u.username === req.session.username);
  if (!user) {
    return res.status(404).json({ success: false, error: "Benutzer nicht gefunden." });
  }

  user.avatar = image;
  saveUsers(users);
  return res.json({ success: true, avatar: image });
});

// Serve a user's avatar as real image bytes with a long-lived, content-addressed
// cache. Lobbies reference this URL (see avatarsFor) instead of embedding the full
// multi-MB base64 in every socket broadcast — a room join used to ship the sum of
// all present players' raw avatars to everyone.
app.get("/api/avatar/:username", (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: "Nicht angemeldet." });
  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === String(req.params.username).toLowerCase());
  const data = user && user.avatar;
  const m = data && /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(data);
  if (!m) return res.status(404).end();
  const buf = Buffer.from(m[2], "base64");
  res.setHeader("Content-Type", m[1]);
  // Content changes -> ?v=<hash> changes -> new URL, so immutable is safe here.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.end(buf);
});

app.get("/api/logout", (req, res) => {
  // Expire the signed remember cookie and destroy the session.
  clearRememberCookie(res);
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────
app.get("/api/leaderboard", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }
  return res.json(stats.getLeaderboard());
});

// ─── Game Requests ────────────────────────────────────────────────────────────
function loadRequests() {
  return store.get("requests");
}

function saveRequests(reqs) {
  store.set("requests", reqs);
}

app.post("/api/request-game", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }

  const text = (req.body.text || "").trim();
  if (!text) {
    return res.status(400).json({ error: "Bitte einen Text eingeben." });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: "Text darf maximal 500 Zeichen lang sein." });
  }

  const reqs = loadRequests();
  reqs.push({ username: req.session.username, text, date: new Date().toISOString() });
  saveRequests(reqs);

  return res.json({ success: true });
});

app.get("/api/requests", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }
  if (req.session.username.toLowerCase() !== "bosse") {
    return res.status(403).json({ error: "Keine Berechtigung." });
  }
  const reqs = loadRequests();
  return res.json({ requests: reqs.slice().reverse() });
});

// ─── Bug Reports ─────────────────────────────────────────────────────────────
function loadBugReports() {
  return store.get("bugReports");
}

function saveBugReports(reports) {
  store.set("bugReports", reports);
}

app.post("/api/bug-report", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }

  const { game, details, screenshot, url, userAgent } = req.body;

  if (!details || typeof details !== "string" || details.trim().length < 30) {
    return res.status(400).json({ error: "Bitte mindestens 30 Zeichen beschreiben." });
  }

  // screenshot must be a data:image/... string if present; otherwise ignore it
  const safeScreenshot = (screenshot && typeof screenshot === "string" && screenshot.startsWith("data:image/"))
    ? screenshot
    : null;

  const reports = loadBugReports();
  reports.push({
    username:  req.session.username,
    game:      String(game || "").slice(0, 60),
    details:   details.trim().slice(0, 4000),
    screenshot: safeScreenshot,
    url:       String(url || "").slice(0, 300),
    userAgent: String(userAgent || "").slice(0, 300),
    date:      new Date().toISOString()
  });
  saveBugReports(reports);

  return res.json({ success: true });
});

app.get("/api/bug-reports", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }
  if (req.session.username.toLowerCase() !== "bosse") {
    return res.status(403).json({ error: "Keine Berechtigung." });
  }
  const reports = loadBugReports();
  return res.json({ reports: reports.slice().reverse() });
});

// ─── Members ──────────────────────────────────────────────────────────────────
app.get("/api/members", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }
  const users = loadUsers();
  return res.json({ members: users.map(u => u.username) });
});

// ─── Finanzamt ────────────────────────────────────────────────────────────────
function loadFinanzamt() {
  return store.get("finanzamt");
}

function saveFinanzamt(records) {
  store.set("finanzamt", records);
}

app.post("/api/finanzamt", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }

  const amount = Number(req.body.amount);
  if (!isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Betrag muss größer als 0 sein." });
  }

  const users   = loadUsers();
  const members = users.map(u => u.username.toLowerCase());
  const person  = String(req.body.person || "").trim();
  if (!members.includes(person.toLowerCase()) || person.toLowerCase() === req.session.username.toLowerCase()) {
    return res.status(400).json({ error: "Ungültige Person." });
  }
  // Preserve original casing from users list
  const personCanonical = users.find(u => u.username.toLowerCase() === person.toLowerCase()).username;

  const date = String(req.body.date || "").trim() || new Date().toISOString().slice(0, 10);
  const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const records = loadFinanzamt();
  records.push({ id, payer: req.session.username, person: personCanonical, amount, date, created: new Date().toISOString() });
  saveFinanzamt(records);

  return res.json({ success: true });
});

app.get("/api/finanzamt", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }

  const records = loadFinanzamt();

  // Build pairwise owes map: owes[person][payer] += amount
  const owes = {};
  for (const r of records) {
    if (!owes[r.person])        owes[r.person]        = {};
    if (!owes[r.person][r.payer]) owes[r.person][r.payer] = 0;
    owes[r.person][r.payer] += r.amount;
  }

  // Collect all unique participants
  const people = new Set();
  for (const r of records) { people.add(r.payer); people.add(r.person); }
  const list = Array.from(people);

  const balances = [];
  const seen     = new Set();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a   = list[i];
      const b   = list[j];
      const key = a + "|" + b;
      if (seen.has(key)) continue;
      seen.add(key);
      const net = ((owes[a] && owes[a][b]) || 0) - ((owes[b] && owes[b][a]) || 0);
      if (net > 0)       balances.push({ from: a, to: b, amount: Math.round(net * 100) / 100 });
      else if (net < 0)  balances.push({ from: b, to: a, amount: Math.round(-net * 100) / 100 });
    }
  }

  const payments = records
    .slice()
    .sort((a, b) => (b.created || b.date) > (a.created || a.date) ? 1 : -1)
    .map(({ id, payer, person, amount, date }) => ({ id, payer, person, amount, date }));

  return res.json({ payments, balances });
});

app.delete("/api/finanzamt/:id", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }

  const records = loadFinanzamt();
  const idx     = records.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Eintrag nicht gefunden." });

  const record = records[idx];
  if (record.payer !== req.session.username && req.session.username.toLowerCase() !== "bosse") {
    return res.status(403).json({ error: "Keine Berechtigung." });
  }

  records.splice(idx, 1);
  saveFinanzamt(records);
  return res.json({ success: true });
});

// ─── Jeopardy (saved boards + media) ────────────────────────────────────────────
// Saved games live in store "jeopardyBoards" (array of full game objects, each
// with id/name/owner; the socket handler reads this array in jeopardy:start).
// Media (cell images/audio) is stored separately in store "jeopardyMedia" — a
// map mediaId → dataURL — so board JSON stays text-only and references by id.
function loadJeopardyBoards() { return store.get("jeopardyBoards"); }
function saveJeopardyBoards(g) { store.set("jeopardyBoards", g); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// GET — list the current user's saved games (id + name only).
app.get("/api/jeopardy", (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: "Nicht angemeldet." });
  const games = loadJeopardyBoards()
    .filter(g => g.owner === req.session.username)
    .map(g => ({ id: g.id, name: g.name || "Unbenannt" }));
  return res.json({ games });
});

// GET — full game JSON (owner only).
app.get("/api/jeopardy/:id", (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: "Nicht angemeldet." });
  const game = loadJeopardyBoards().find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: "Spiel nicht gefunden." });
  if (game.owner !== req.session.username) return res.status(403).json({ error: "Keine Berechtigung." });
  return res.json({ game });
});

// POST — create or update a saved game (text only; media referenced by mediaId).
app.post("/api/jeopardy", (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: "Nicht angemeldet." });
  const incoming = req.body && req.body.game;
  if (!incoming || typeof incoming !== "object") return res.status(400).json({ error: "Ungültiges Spiel." });

  const games = loadJeopardyBoards();
  let id = incoming.id;
  if (id) {
    const existing = games.find(g => g.id === id);
    if (existing && existing.owner !== req.session.username) {
      return res.status(403).json({ error: "Keine Berechtigung." });
    }
  }
  if (!id) id = genId();

  const game = Object.assign({}, incoming, { id, owner: req.session.username });
  const idx = games.findIndex(g => g.id === id);
  if (idx === -1) games.push(game); else games[idx] = game;
  saveJeopardyBoards(games);
  return res.json({ id });
});

// DELETE — remove a saved game (owner only).
app.delete("/api/jeopardy/:id", (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: "Nicht angemeldet." });
  const games = loadJeopardyBoards();
  const idx = games.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Spiel nicht gefunden." });
  if (games[idx].owner !== req.session.username) return res.status(403).json({ error: "Keine Berechtigung." });
  games.splice(idx, 1);
  saveJeopardyBoards(games);
  return res.json({ success: true });
});

// POST media — accepts a data URL up to 15MB decoded. The global express.json
// cap is 12mb, so this route gets its own 25mb parser (covers ~15MB base64 +
// overhead). Returns { mediaId } to embed in the board's cells.
// ponytail: jeopardyMedia is one Upstash value (a map) — Upstash caps a value at
// ~100MB on paid plans / 1MB on free; per-id Redis keys if the map outgrows that.
app.post("/api/jeopardy/media", express.json({ limit: "25mb" }), (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: "Nicht angemeldet." });
  const dataUrl = req.body && req.body.dataUrl;
  if (!dataUrl || typeof dataUrl !== "string" || !/^data:(image|audio)\//.test(dataUrl)) {
    return res.status(400).json({ error: "Nur Bild- oder Audiodateien erlaubt." });
  }
  const commaIdx = dataUrl.indexOf(",");
  const base64Part = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const byteSize = Math.floor(base64Part.length * 0.75);
  if (byteSize > 15 * 1024 * 1024) {
    return res.status(400).json({ error: "Datei zu groß (max 15 MB)." });
  }

  const media = store.get("jeopardyMedia");
  const mediaId = genId();
  media[mediaId] = dataUrl;
  store.set("jeopardyMedia", media);
  return res.json({ mediaId });
});

// GET media — return the stored data URL (the client embeds it directly).
app.get("/api/jeopardy/media/:id", (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: "Nicht angemeldet." });
  const dataUrl = store.get("jeopardyMedia")[req.params.id];
  if (!dataUrl) return res.status(404).json({ error: "Medium nicht gefunden." });
  return res.json({ dataUrl });
});

// ─── Spiele-Liste (Playlist) ──────────────────────────────────────────────────
const PLAYLIST_CATEGORIES = ["pc", "web", "brettspiel"];

function loadPlaylist() {
  return store.get("playlist");
}

function savePlaylist(items) {
  store.set("playlist", items);
}

app.get("/api/playlist", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }
  const items = loadPlaylist();
  return res.json({ items: items.slice().reverse() });
});

app.post("/api/playlist", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }

  const name = String(req.body.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Name erforderlich." });
  }

  const category = String(req.body.category || "").trim();
  if (!PLAYLIST_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Ungültige Kategorie." });
  }

  const playtime   = String(req.body.playtime   || "").slice(0, 40);
  const minPlayers = String(req.body.minPlayers || "").slice(0, 20);
  const notes      = String(req.body.notes      || "").slice(0, 1000);
  const steamUrl   = String(req.body.steamUrl   || "").slice(0, 400);

  const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const date = new Date().toISOString();
  const item = {
    id,
    name:       name.slice(0, 120),
    category,
    playtime,
    minPlayers,
    notes,
    steamUrl,
    addedBy:    req.session.username,
    date
  };

  const items = loadPlaylist();
  items.push(item);
  savePlaylist(items);

  return res.json({ success: true, item });
});

app.delete("/api/playlist/:id", (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: "Nicht angemeldet." });
  }

  const items = loadPlaylist();
  const idx   = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Eintrag nicht gefunden." });

  const item = items[idx];
  if (item.addedBy !== req.session.username && req.session.username.toLowerCase() !== "bosse") {
    return res.status(403).json({ error: "Keine Berechtigung." });
  }

  items.splice(idx, 1);
  savePlaylist(items);
  return res.json({ success: true });
});

// ─── Room Management ──────────────────────────────────────────────────────────
const rooms = new Map();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateUniqueCode() {
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
  } while (rooms.has(code) && attempts < 100);
  return code;
}

// Build a { username: avatarUrl|null } map for a list of player usernames.
// Lets clients render custom profile pictures in lobbies / scoreboards while
// the existing string[] `players` shape stays untouched.
function avatarsFor(players) {
  const users = loadUsers();
  const map = {};
  (players || []).forEach(name => {
    const u = users.find(x => x.username === name);
    if (u && u.avatar) {
      // Short content-addressed URL, not the raw base64. The hash busts the cache
      // when the avatar changes; the client uses this value directly as an image URL.
      const ver = crypto.createHash("sha1").update(u.avatar).digest("hex").slice(0, 10);
      map[name] = "/api/avatar/" + encodeURIComponent(u.username) + "?v=" + ver;
    } else {
      map[name] = null;
    }
  });
  return map;
}

// How long a disconnected player is kept in their room before removal, so a
// phone that backgrounds the tab (socket drops, then reconnects) doesn't lose
// its seat / score / host role. room:resume cancels the pending removal.
const REJOIN_GRACE_MS = 90000;

// The actual removal: drop the player, clear their grace timer, reassign host
// or delete the room if it's now empty.
function removeFromRoom(code, username) {
  const room = rooms.get(code);
  if (!room) return;

  room.players = room.players.filter(p => p !== username);
  if (room.grace && room.grace[username]) { clearTimeout(room.grace[username]); delete room.grace[username]; }

  if (room.players.length === 0) {
    // Clear any pending timer handles so stale callbacks can't mutate a reused room
    if (room.gameData && typeof room.gameData === "object") {
      for (const [key, val] of Object.entries(room.gameData)) {
        if (/timer|interval/i.test(key) && val != null) {
          clearTimeout(val);
          clearInterval(val);
          room.gameData[key] = null;
        }
      }
    }
    if (room.grace) Object.values(room.grace).forEach(t => clearTimeout(t));
    rooms.delete(code);
    return;
  }

  if (room.host === username) {
    room.host = room.players[0];
    io.to(code).emit("room:host-changed", { host: room.host, players: room.players, avatars: avatarsFor(room.players) });
  } else {
    io.to(code).emit("room:players", { players: room.players, host: room.host, avatars: avatarsFor(room.players) });
  }
}

// Explicit leave (user tapped "Verlassen") — remove immediately.
function handleLeave(socket) {
  const code = socket.roomCode;
  socket.roomCode = null;
  if (!code) return;
  socket.leave(code);
  removeFromRoom(code, socket.username);
}

// Transient disconnect (network blip, tab backgrounded) — keep the player for a
// grace window; only remove if they don't reconnect in time.
function handleDisconnect(socket) {
  const code = socket.roomCode;
  const username = socket.username;
  socket.roomCode = null;
  if (!code || !username) return;
  const room = rooms.get(code);
  if (!room) return;
  if (!room.players.includes(username)) return;

  if (!room.grace) room.grace = {};
  if (room.grace[username]) clearTimeout(room.grace[username]);
  room.grace[username] = setTimeout(() => removeFromRoom(code, username), REJOIN_GRACE_MS);

  // Tell the room this player is temporarily away (clients may grey them out).
  io.to(code).emit("room:players", {
    players: room.players, host: room.host,
    avatars: avatarsFor(room.players), away: Object.keys(room.grace)
  });
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  socket.username = null;
  socket.roomCode = null;

  socket.on("auth", () => {
    // Identity comes ONLY from the shared HTTP session (io.engine.use(sessionMiddleware)).
    // The client-supplied username is ignored — trusting it let an unauthenticated
    // socket impersonate any user (host takeover, stats fraud). Bind once.
    const sessUser = socket.request && socket.request.session && socket.request.session.username;
    if (sessUser) socket.username = sessUser;
  });

  socket.on("room:create", ({ gameType }) => {
    if (!socket.username) return;

    const code = generateUniqueCode();
    const room = {
      gameType,
      host: socket.username,
      players: [socket.username],
      settings: {
        difficulty: "normal",
        pointsToWin: 10,
        mode: "mc"
      },
      gameData: {},
      started: false
    };

    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;

    socket.emit("room:created", {
      code,
      gameType,
      players: [socket.username],
      host: socket.username,
      avatars: avatarsFor(room.players),
      settings: room.settings,
      isHost: true
    });
  });

  socket.on("room:join", ({ code }) => {
    if (!socket.username) return;

    const upperCode = (code || "").toUpperCase();
    const room = rooms.get(upperCode);

    if (!room) {
      socket.emit("room:error", { message: "Room not found" });
      return;
    }
    if (room.started) {
      socket.emit("room:error", { message: "Game already started" });
      return;
    }
    if (room.players.length >= 8) {
      socket.emit("room:error", { message: "Room is full" });
      return;
    }

    if (!room.players.includes(socket.username)) {
      room.players.push(socket.username);
    }

    socket.join(upperCode);
    socket.roomCode = upperCode;

    socket.emit("room:joined", {
      code: upperCode,
      gameType: room.gameType,
      players: room.players,
      host: room.host,
      avatars: avatarsFor(room.players),
      settings: room.settings,
      isHost: room.host === socket.username
    });

    io.to(upperCode).emit("room:players", { players: room.players, host: room.host, avatars: avatarsFor(room.players) });
  });

  socket.on("room:leave", () => { socket.emit("room:left"); handleLeave(socket); });
  socket.on("disconnect", () => handleDisconnect(socket));

  // Reconnect after a transient drop: re-attach this fresh socket to the room the
  // client believes it's in, cancel the pending grace removal, and replay the
  // latest game state so the returning player is fully caught up.
  socket.on("room:resume", ({ code }) => {
    if (!socket.username || !code) return;
    const upper = String(code).toUpperCase();
    const room = rooms.get(upper);
    if (!room) { socket.emit("room:resume-failed"); return; }

    const isMember = room.players.includes(socket.username);
    if (!isMember) {
      // Not a member anymore (grace expired). Only allow rejoin if the game
      // hasn't started and there's space — same rule as room:join.
      if (room.started || room.players.length >= 8) { socket.emit("room:resume-failed"); return; }
      room.players.push(socket.username);
    }
    if (room.grace && room.grace[socket.username]) {
      clearTimeout(room.grace[socket.username]);
      delete room.grace[socket.username];
    }

    socket.join(upper);
    socket.roomCode = upper;

    socket.emit("room:joined", {
      code: upper,
      gameType: room.gameType,
      players: room.players,
      host: room.host,
      avatars: avatarsFor(room.players),
      settings: room.settings,
      isHost: room.host === socket.username,
      resumed: true
    });
    io.to(upper).emit("room:players", {
      players: room.players, host: room.host,
      avatars: avatarsFor(room.players), away: room.grace ? Object.keys(room.grace) : []
    });

    // Replay the last broadcast game state so a mid-game reconnect restores the
    // exact screen (question/reveal/etc.) rather than dropping back to the lobby.
    if (room.started && room.lastState) socket.emit("game:state", room.lastState);
  });

  // Wrap io so every `io.to(code).emit("game:state", payload)` also caches the
  // payload as room.lastState — this powers mid-game replay on room:resume, with
  // zero changes to the individual game handlers.
  const handlerIo = {
    to(code) {
      const chain = io.to(code);
      const realEmit = chain.emit.bind(chain);
      chain.emit = (event, payload) => {
        if (event === "game:state" && typeof code === "string") {
          const r = rooms.get(code);
          if (r) r.lastState = payload;
        }
        return realEmit(event, payload);
      };
      return chain;
    }
  };

  // Load game handlers
  ["logo-guesser", "knowledge-quiz", "flag-quiz", "movies-actors", "song-guesser", "galgenraten", "connect4", "verhext", "jeopardy", "siblings-dating"].forEach(g => {
    try {
      require("./server/games/" + g + "-handler")(socket, handlerIo, rooms);
    } catch (e) {
      // Handler not yet implemented, skip silently
    }
  });
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  // Hydrate the in-memory store (Redis or fs) before handling any request.
  await store.hydrate();

  // Forced password resync for David/Oskar/Marlin/Bosse: hydrate() only seeds
  // Redis from data/users.json when the Redis key is still empty, so a plain
  // edit of that file never reaches a deployment whose Redis already has a
  // cached users blob. Idempotent: only overwrites a user whose stored hash
  // doesn't already match the target, so this never touches a password the
  // user later changes via the UI.
  // ponytail: drop this whole block once it's confirmed deployed.
  {
    const resyncHashes = {
      david:  "$2a$10$WJ46IOmElr6faM0VIrB6.eBLtpsk7H3f6.Ef0JuxcKpaXHYOEEF5i",
      oskar:  "$2a$10$/1LtoaiZ9uKycykWVOLcqOhaBkck0Fd.AEU9slEGv8aqFuURJnqqe",
      marlin: "$2a$10$j4rs5oS39C4XElrcPBwYvOflb8NqJDHgC3kdoda4eXzVUIkbU7RgO",
      bosse:  "$2a$10$AUdsiIJuISpH2/sdLAn4Ne/P4g8AlGhrjV.hOibqpzgmkMHc41dY6"
    };
    const resyncUsers = loadUsers();
    let resynced = false;
    for (const user of resyncUsers) {
      const hash = resyncHashes[user.username.toLowerCase()];
      if (hash && user.password !== hash) {
        user.password = hash;
        user.passwordChanged = true;
        resynced = true;
      }
    }
    if (resynced) {
      saveUsers(resyncUsers);
      console.log("Password resync applied for david/oskar/marlin");
    }
  }

  // Hash any plaintext passwords on startup (runs after hydrate so loadUsers works)
  const users = loadUsers();
  let changed = false;
  for (const user of users) {
    if (!user.password.startsWith("$2")) {
      user.password = await bcrypt.hash(user.password, 10);
      changed = true;
    }
  }
  if (changed) {
    saveUsers(users);
    console.log("Hashed plaintext passwords and saved to users.json");
  }

  server.listen(PORT, () => {
    console.log(`Lvl 3 Games server running on port ${PORT} — http://localhost:${PORT}`);

    // Keep Render free tier alive — ping self every 14 minutes to prevent spin-down
    if (process.env.RENDER_EXTERNAL_URL) {
      const keepAliveUrl = process.env.RENDER_EXTERNAL_URL + "/api/health";
      setInterval(() => {
        https.get(keepAliveUrl, (r) => r.resume()).on("error", () => {});
      }, 14 * 60 * 1000);
      console.log("Keep-alive enabled →", keepAliveUrl);
    }
  });
})();
