"use strict";

// ─── Stats Module ─────────────────────────────────────────────────────────────
// Persists per-user win/score/gamesPlayed stats to data/stats.json.
// Uses synchronous fs to match the loadUsers/saveUsers style in server.js.

const fs   = require("fs");
const path = require("path");

const STATS_FILE = path.join(__dirname, "../data/stats.json");

// ─── Internal helpers ─────────────────────────────────────────────────────────

function loadStats() {
  try {
    const raw = fs.readFileSync(STATS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // Basic sanity check — must be an object with the expected keys
    if (parsed && typeof parsed === "object" && parsed.overall && parsed.perGame) {
      return parsed;
    }
    throw new Error("Unexpected shape");
  } catch (e) {
    // Missing or corrupt — start fresh
    return { overall: {}, perGame: {} };
  }
}

function saveStats(data) {
  const dir = path.dirname(STATS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = STATS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, STATS_FILE);
}

function emptyEntry() {
  return { wins: 0, points: 0, gamesPlayed: 0 };
}

function ensureUser(bucket, username) {
  if (!bucket[username]) bucket[username] = emptyEntry();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * recordGameResult(gameType, sortedScores, winner)
 *
 * @param {string}   gameType     - one of the five game slugs
 * @param {Array}    sortedScores - [{username, score}, …] sorted by score desc
 * @param {string}   winner       - username of the winner (or null)
 */
function recordGameResult(gameType, sortedScores, winner) {
  if (!Array.isArray(sortedScores) || sortedScores.length < 2) return;
  const winnerList = Array.isArray(winner) ? winner : (winner ? [winner] : []);

  const data = loadStats();

  if (!data.perGame[gameType]) data.perGame[gameType] = {};

  for (const entry of sortedScores) {
    const { username, score } = entry;
    if (!username || typeof score !== "number") continue;

    // overall
    ensureUser(data.overall, username);
    data.overall[username].gamesPlayed += 1;
    data.overall[username].points      += score;
    if (winnerList.indexOf(username) !== -1) data.overall[username].wins += 1;

    // per-game
    ensureUser(data.perGame[gameType], username);
    data.perGame[gameType][username].gamesPlayed += 1;
    data.perGame[gameType][username].points      += score;
    if (winnerList.indexOf(username) !== -1) data.perGame[gameType][username].wins += 1;
  }

  saveStats(data);
}

/**
 * getLeaderboard()
 *
 * Returns:
 * {
 *   overall: [{ username, wins, points, gamesPlayed }, …],   // sorted wins↓ then points↓
 *   perGame: {
 *     "logo-guesser":    [{ username, wins, points, gamesPlayed }, …],
 *     "knowledge-quiz":  […],
 *     …
 *   }
 * }
 */
function getLeaderboard() {
  const data = loadStats();

  function bucketToArray(bucket) {
    return Object.entries(bucket)
      .map(([username, s]) => ({ username, wins: s.wins, points: s.points, gamesPlayed: s.gamesPlayed }))
      .sort((a, b) => b.wins - a.wins || b.points - a.points);
  }

  const perGame = {};
  for (const [gameType, bucket] of Object.entries(data.perGame)) {
    perGame[gameType] = bucketToArray(bucket);
  }

  return {
    overall: bucketToArray(data.overall),
    perGame
  };
}

module.exports = { recordGameResult, getLeaderboard };
