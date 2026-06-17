"use strict";

// ─── Stats Module ─────────────────────────────────────────────────────────────
// Persists per-user win/score/gamesPlayed stats via the shared store
// (Redis-backed in production, data/stats.json on disk in dev).
// Stays synchronous — the store hydrates all keys at boot before handlers run.

const store = require("./store");

// ─── Internal helpers ─────────────────────────────────────────────────────────

function loadStats() {
  return store.get("stats");
}

function saveStats(data) {
  store.set("stats", data);
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
