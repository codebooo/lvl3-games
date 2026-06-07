const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const sessionMiddleware = session({
  secret: "lvl3games_s3cr3t_2024",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

// Share session with socket.io
io.engine.use(sessionMiddleware);

// ─── User Data ────────────────────────────────────────────────────────────────
const USERS_FILE = path.join(__dirname, "data", "users.json");

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch (e) {
    console.error("Could not load users.json:", e.message);
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
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
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password required" });
  }

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user) {
    return res.status(401).json({ success: false, error: "Invalid username or password" });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ success: false, error: "Invalid username or password" });
  }

  req.session.username = user.username;
  req.session.save();
  return res.json({ success: true, username: user.username, passwordChanged: user.passwordChanged });
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
  req.session.destroy(() => {
    res.json({ success: true });
  });
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
    socket.username = username;
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

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Lvl 3 Games server running on port ${PORT} — http://localhost:${PORT}`);
});
