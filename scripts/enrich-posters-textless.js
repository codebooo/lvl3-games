// Replace movie/series poster URLs in data/movies.json with TEXTLESS posters
// (TMDB posters whose iso_639_1 is null have no title/language text baked in).
// Actors are people photos (no title) — left untouched but re-verified.
//   TMDB_API_KEY=xxxxx node scripts/enrich-posters-textless.js
const https = require("https");
const fs = require("fs");
const path = require("path");

const KEY = process.env.TMDB_API_KEY;
if (!KEY) { console.error("Set TMDB_API_KEY"); process.exit(1); }

const IMG = "https://image.tmdb.org/t/p/w500";
const FILE = path.join(__dirname, "..", "data", "movies.json");
const data = JSON.parse(fs.readFileSync(FILE, "utf8"));

function get(p) {
  return new Promise((resolve) => {
    https.get("https://api.themoviedb.org/3" + p + (p.includes("?") ? "&" : "?") + "api_key=" + KEY, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    }).on("error", () => resolve(null));
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// pick the best textless poster: iso_639_1 === null, highest vote_count; else null
function pickTextless(images) {
  if (!images || !Array.isArray(images.posters)) return null;
  const textless = images.posters.filter(p => p.iso_639_1 === null);
  if (!textless.length) return null;
  textless.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
  return textless[0].file_path;
}

async function resolve(type, title, year) {
  const sq = "/search/" + type + "?query=" + encodeURIComponent(title) + (year && type === "movie" ? "&year=" + year : "");
  const sr = await get(sq);
  const hit = sr && sr.results && sr.results[0];
  if (!hit) return null;
  await sleep(40);
  const imgs = await get("/" + type + "/" + hit.id + "/images?include_image_language=null");
  const textless = pickTextless(imgs);
  if (textless) return IMG + textless;
  // fallback: search poster_path (may have text, but better than nothing)
  return hit.poster_path ? IMG + hit.poster_path : null;
}

(async () => {
  let textlessCount = 0, fallback = 0, miss = 0;
  for (const diff of Object.keys(data.movies || {})) {
    for (const m of data.movies[diff]) {
      const before = m.imageUrl;
      const url = await resolve("movie", m.title, m.year);
      if (url) { m.imageUrl = url; if (url !== before) textlessCount++; else fallback++; } else { miss++; console.error("MISS movie:", m.title); }
      await sleep(40);
    }
  }
  for (const diff of Object.keys(data.series || {})) {
    for (const s of data.series[diff]) {
      const url = await resolve("tv", s.title || s.name);
      if (url) { s.imageUrl = url; textlessCount++; } else { miss++; console.error("MISS series:", s.title || s.name); }
      await sleep(40);
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
  console.error("DONE updated=" + textlessCount + " fallback=" + fallback + " missed=" + miss);
})();
