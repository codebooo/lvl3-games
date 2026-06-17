"use strict";

// ─── Persistence Store ─────────────────────────────────────────────────────────
// In-memory cache hydrated once from Redis at startup, with write-through on
// every save. This keeps every request/socket handler SYNCHRONOUS — only server
// startup is async (calls hydrate()).
//
// When Upstash Redis env vars are set, data is backed by Redis (REST API) and
// survives restarts/redeploys on ephemeral hosts (Render free tier). Otherwise
// it falls back to the committed data/*.json files on disk (local dev), with
// atomic writes (temp file + rename), preserving the original behavior exactly.

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const { URL } = require("url");

// ─── Logical keys → files & defaults ────────────────────────────────────────────
const KEYS = {
  users:      { file: "users.json",       default: () => [] },
  requests:   { file: "requests.json",     default: () => [] },
  bugReports: { file: "bug-reports.json",  default: () => [] },
  finanzamt:  { file: "finanzamt.json",    default: () => [] },
  playlist:   { file: "playlist.json",     default: () => [] },
  stats:      { file: "stats.json",        default: () => ({ overall: {}, perGame: {} }) }
};

const DATA_DIR = path.join(__dirname, "..", "data");

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const useRedis = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// In-memory cache: key → parsed value
const mem = {};

// ─── Upstash REST helper ─────────────────────────────────────────────────────────
// POST the command array (e.g. ["GET","lvl3:users"]) to the Upstash REST URL.
// Resolves with the `result` field of the JSON response (string | null).
function redisCommand(argsArray) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(UPSTASH_URL);
    } catch (e) {
      return reject(new Error("Invalid UPSTASH_REDIS_REST_URL: " + e.message));
    }

    const body = JSON.stringify(argsArray);

    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + parsed.search,
      method:   "POST",
      headers: {
        "Authorization":  "Bearer " + UPSTASH_TOKEN,
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error("Upstash HTTP " + res.statusCode + ": " + data));
        }
        try {
          const json = JSON.parse(data);
          resolve(json.result);
        } catch (e) {
          reject(new Error("Upstash response parse error: " + e.message));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── fs helpers (dev fallback) ──────────────────────────────────────────────────
function diskRead(key) {
  const { file, default: makeDefault } = KEYS[key];
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return makeDefault();
  }
}

function diskWrite(key, value) {
  const { file } = KEYS[key];
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const full = path.join(DATA_DIR, file);
  const tmp  = full + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, full);
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Load every logical key into the in-memory cache. Call once at startup before
// the server begins handling requests.
async function hydrate() {
  for (const key of Object.keys(KEYS)) {
    if (useRedis) {
      const result = await redisCommand(["GET", "lvl3:" + key]);
      if (result === null || result === undefined) {
        // Seed from the committed data file (or default), then persist to Redis.
        const seed = diskRead(key);
        await redisCommand(["SET", "lvl3:" + key, JSON.stringify(seed)]);
        mem[key] = seed;
      } else {
        try {
          mem[key] = JSON.parse(result);
        } catch (e) {
          mem[key] = KEYS[key].default();
        }
      }
    } else {
      mem[key] = diskRead(key);
    }
  }
}

// Synchronous read from the in-memory cache.
function get(key) {
  return mem[key];
}

// Synchronous write-through. Updates the cache immediately; persists to Redis
// (fire-and-forget) or disk (atomic) depending on configuration.
function set(key, value) {
  mem[key] = value;
  if (useRedis) {
    redisCommand(["SET", "lvl3:" + key, JSON.stringify(value)]).catch(console.error);
  } else {
    diskWrite(key, value);
  }
}

module.exports = { useRedis, hydrate, get, set, redisCommand };
