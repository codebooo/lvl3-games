const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const compression = require("compression");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const stats = require("./server/stats");

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
    if (trimmed.startsWith("lvl3_remember=")) {
      rememberVal = decodeURIComponent(trimmed.slice("lvl3_remember=".length));
      break;
    }
  }
  if (!rememberVal) return next();

  const colonIdx = rememberVal.lastIndexOf(":");
  if (colonIdx === -1) return next();

  const cookieUsername = rememberVal.slice(0, colonIdx);
  const token          = rememberVal.slice(colonIdx + 1);
  if (!cookieUsername || !token) return next();

  const users = loadUsers();
  const user  = users.find(u => u.username.toLowerCase() === cookieUsername.toLowerCase());

  if (!user || !user.rememberTokenHash) {
    // Clear stale cookie
    res.setHeader("Set-Cookie", "lvl3_remember=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return next();
  }

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const hashBuf = Buffer.from(hash);
  const storedBuf = Buffer.from(user.rememberTokenHash);
  const tokenValid = hashBuf.length === storedBuf.length &&
    crypto.timingSafeEqual(hashBuf, storedBuf);
  if (!tokenValid) {
    res.setHeader("Set-Cookie", "lvl3_remember=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return next();
  }

  // Valid token — restore session
  req.session.username = user.username;
  return next();
});

// Share session with socket.io
io.engine.use(sessionMiddleware);

// ─── User Data ────────────────────────────────────────────────────────────────
const USERS_FILE = path.join(__dirname, "data", "users.json");

let usersCache = null;

function loadUsers() {
  if (usersCache) return usersCache;
  try {
    usersCache = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    return usersCache;
  } catch (e) {
    console.error("Could not load users.json:", e.message);
    return [];
  }
}

function saveUsers(users) {
  usersCache = users;
  const tmp = USERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), "utf8");
  fs.renameSync(tmp, USERS_FILE);
}

// Hash any plaintext passwords on startup
(async function hashPlaintextPasswords() {
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
})();

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

  // First login: skip password check, log in immediately (no remember-me for first-login flow)
  if (!user.passwordChanged) {
    req.session.username = user.username;
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
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    req.session.cookie.maxAge = THIRTY_DAYS;

    const token = crypto.randomBytes(32).toString("hex");
    user.rememberTokenHash = crypto.createHash("sha256").update(token).digest("hex");
    saveUsers(users);

    const cookieVal = encodeURIComponent(user.username + ":" + token);
    res.setHeader(
      "Set-Cookie",
      `lvl3_remember=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${THIRTY_DAYS / 1000}`
    );
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
  return res.json({ username: user.username, passwordChanged: user.passwordChanged });
});

app.get("/api/logout", (req, res) => {
  // Clear remember-me token from users.json and expire the cookie
  if (req.session.username) {
    const users = loadUsers();
    const user  = users.find(u => u.username === req.session.username);
    if (user && user.rememberTokenHash) {
      delete user.rememberTokenHash;
      saveUsers(users);
    }
  }
  res.setHeader("Set-Cookie", "lvl3_remember=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
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
const REQUESTS_FILE = path.join(__dirname, "data", "requests.json");

function loadRequests() {
  try {
    const raw    = fs.readFileSync(REQUESTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    throw new Error("Unexpected shape");
  } catch (e) {
    return [];
  }
}

function saveRequests(reqs) {
  const dir = path.dirname(REQUESTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = REQUESTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(reqs, null, 2), "utf8");
  fs.renameSync(tmp, REQUESTS_FILE);
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

function handleLeave(socket) {
  const code = socket.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) {
    socket.roomCode = null;
    return;
  }

  room.players = room.players.filter(p => p !== socket.username);
  socket.roomCode = null;

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
    rooms.delete(code);
    return;
  }

  if (room.host === socket.username) {
    room.host = room.players[0];
    io.to(code).emit("room:host-changed", { host: room.host, players: room.players });
  } else {
    io.to(code).emit("room:players", { players: room.players, host: room.host });
  }
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  socket.username = null;
  socket.roomCode = null;

  socket.on("auth", ({ username }) => {
    const sessUser = socket.request && socket.request.session && socket.request.session.username;
    socket.username = sessUser || username;
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
      settings: room.settings,
      isHost: room.host === socket.username
    });

    io.to(upperCode).emit("room:players", { players: room.players, host: room.host });
  });

  socket.on("room:leave", () => handleLeave(socket));
  socket.on("disconnect", () => handleLeave(socket));

  // Load game handlers
  ["logo-guesser", "knowledge-quiz", "flag-quiz", "movies-actors", "song-guesser"].forEach(g => {
    try {
      require("./server/games/" + g + "-handler")(socket, io, rooms);
    } catch (e) {
      // Handler not yet implemented, skip silently
    }
  });
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
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
