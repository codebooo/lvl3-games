// 4 Gewinnt (Connect 4) — authoritative 1v1 handler.
// Board is 7 columns × 6 rows: board[row][col], row 0 = TOP, row 5 = BOTTOM.
// Cell values: 0 empty, 1 = player 1 (red, host), 2 = player 2 (yellow).
// The server owns all placement: it computes the landing row via gravity and
// the client is never trusted to set a chip's position.
const stats = require("../stats");

const COLS = 7;
const ROWS = 6;

function emptyBoard() {
  const b = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push(0);
    b.push(row);
  }
  return b;
}

// Lowest empty row (gravity) in a column, or -1 if the column is full.
function landingRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) return r;
  }
  return -1;
}

function boardFull(board) {
  for (let c = 0; c < COLS; c++) {
    if (board[0][c] === 0) return false;
  }
  return true;
}

// Check whether the chip just placed at (row,col) completes a line of 4.
// Returns the array of 4 [r,c] winning cells, or null.
function findWin(board, row, col) {
  const player = board[row][col];
  if (!player) return null;
  // [dr, dc] for the four orientations: horizontal, vertical, both diagonals.
  const dirs = [
    [0, 1],   // horizontal  →
    [1, 0],   // vertical    ↓
    [1, 1],   // diagonal    ↘ (top-left → bottom-right)
    [1, -1]   // diagonal    ↙ (top-right → bottom-left)
  ];
  for (const [dr, dc] of dirs) {
    const cells = [[row, col]];
    // Walk forward along the direction.
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      cells.push([r, c]); r += dr; c += dc;
    }
    // Walk backward along the direction.
    r = row - dr; c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      cells.unshift([r, c]); r -= dr; c -= dc;
    }
    if (cells.length >= 4) {
      // Return the 4 cells spanning the placed chip for a tidy highlight.
      const idx = cells.findIndex(p => p[0] === row && p[1] === col);
      const start = Math.max(0, Math.min(idx - 3, cells.length - 4));
      return cells.slice(start, start + 4);
    }
  }
  return null;
}

module.exports = function (socket, io, rooms) {

  function myRoom() {
    const code = socket.roomCode;
    if (!code) return null;
    const r = rooms.get(code);
    if (!r || r.gameType !== "connect4") return null;
    return r;
  }

  // Seat number (1|2) of a username for the current game, or null.
  function seatOf(gd, username) {
    if (gd.seats[1] === username) return 1;
    if (gd.seats[2] === username) return 2;
    return null;
  }

  socket.on("connect4:start", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username || r.started) return;
    if (r.players.length !== 2) {
      socket.emit("game:error", { message: "4 Gewinnt ist genau 1v1 — ihr müsst zu zweit sein." });
      return;
    }
    // Seat 1 = host, seat 2 = the other player.
    const host = r.host;
    const other = r.players.find(function (u) { return u !== host; });
    r.gameData = {
      board: emptyBoard(),
      seats: { 1: host, 2: other },
      current: 1,            // player 1 starts
      lastMove: null,
      winner: null,          // null while playing; 0 = draw; 1|2 = winning seat
      winningCells: [],
      recorded: false
    };
    r.started = true;
    emitState(socket.roomCode, "playing");
  });

  socket.on("connect4:drop", function (payload) {
    const r = myRoom();
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    if (gd.winner !== null) return;            // game already ended
    const seat = seatOf(gd, socket.username);
    if (!seat || seat !== gd.current) return;  // not this socket's turn
    const col = payload && payload.col;
    if (typeof col !== "number" || col < 0 || col >= COLS) return;
    const row = landingRow(gd.board, col);
    if (row < 0) return;                       // column full

    gd.board[row][col] = seat;
    gd.lastMove = { col: col, row: row, player: seat };

    const win = findWin(gd.board, row, col);
    if (win) {
      gd.winner = seat;
      gd.winningCells = win;
      finish(r, gd);
      emitState(socket.roomCode, "end");
      return;
    }
    if (boardFull(gd.board)) {
      gd.winner = 0;            // draw
      gd.winningCells = [];
      finish(r, gd);
      emitState(socket.roomCode, "end");
      return;
    }
    gd.current = gd.current === 1 ? 2 : 1;     // toggle turn
    emitState(socket.roomCode, "playing");
  });

  socket.on("connect4:restart", function () {
    const r = myRoom();
    if (!r || r.host !== socket.username) return;
    r.started = false;
    r.gameData = {};
    io.to(socket.roomCode).emit("game:state", { phase: "lobby", data: {} });
  });

  // Record the result once per game (winner seat = 10 points, loser/draw = 0).
  function finish(r, gd) {
    if (gd.recorded) return;
    gd.recorded = true;
    r.started = false;
    const u1 = gd.seats[1], u2 = gd.seats[2];
    if (!u1 || !u2) return;
    const scores = [
      { username: u1, score: gd.winner === 1 ? 10 : 0 },
      { username: u2, score: gd.winner === 2 ? 10 : 0 }
    ];
    scores.sort(function (a, b) { return b.score - a.score; });
    let winners = [];
    if (gd.winner === 1) winners = [u1];
    else if (gd.winner === 2) winners = [u2];
    try { stats.recordGameResult("connect4", scores, winners); } catch (e) {}
  }

  function emitState(code, phase) {
    const r = rooms.get(code);
    if (!r || !r.gameData) return;
    const gd = r.gameData;
    const data = {
      board: gd.board,
      seats: gd.seats,
      current: gd.current,
      lastMove: gd.lastMove,
      winner: gd.winner,
      winningCells: gd.winningCells || []
    };
    io.to(code).emit("game:state", { phase: phase, data: data });
  }
};
