// Re-resolve real TMDB image URLs for data/movies.json (the stored hashes were fabricated).
// Key is read from env so it never lands in the repo:
//   TMDB_API_KEY=xxxxx node scripts/enrich-movies.js
const https = require("https");
const fs = require("fs");
const path = require("path");

const KEY = process.env.TMDB_API_KEY;
if (!KEY) { console.error("Set TMDB_API_KEY env var"); process.exit(1); }

const IMG = "https://image.tmdb.org/t/p/w500";
const FILE = path.join(__dirname, "..", "data", "movies.json");
const data = JSON.parse(fs.readFileSync(FILE, "utf8"));

function get(urlPath) {
  return new Promise((resolve) => {
    https.get("https://api.themoviedb.org/3" + urlPath + (urlPath.includes("?") ? "&" : "?") + "api_key=" + KEY, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    }).on("error", () => resolve(null));
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function resolveMovie(title, year) {
  const q = "/search/movie?query=" + encodeURIComponent(title) + (year ? "&year=" + year : "");
  const r = await get(q);
  const hit = r && r.results && r.results.find(x => x.poster_path) ;
  return hit ? IMG + hit.poster_path : null;
}
async function resolveTv(title) {
  const r = await get("/search/tv?query=" + encodeURIComponent(title));
  const hit = r && r.results && r.results.find(x => x.poster_path);
  return hit ? IMG + hit.poster_path : null;
}
async function resolvePerson(name) {
  const r = await get("/search/person?query=" + encodeURIComponent(name));
  const hit = r && r.results && r.results.find(x => x.profile_path);
  return hit ? IMG + hit.profile_path : null;
}

(async () => {
  let ok = 0, miss = 0;
  for (const diff of Object.keys(data.movies || {})) {
    for (const m of data.movies[diff]) {
      const url = await resolveMovie(m.title, m.year);
      if (url) { m.imageUrl = url; ok++; } else { miss++; console.error("MISS movie:", m.title); }
      await sleep(50);
    }
  }
  for (const diff of Object.keys(data.series || {})) {
    for (const s of data.series[diff]) {
      const url = await resolveTv(s.title || s.name);
      if (url) { s.imageUrl = url; ok++; } else { miss++; console.error("MISS series:", s.title || s.name); }
      await sleep(50);
    }
  }
  for (const diff of Object.keys(data.actors || {})) {
    for (const a of data.actors[diff]) {
      const url = await resolvePerson(a.name || a.title);
      if (url) { a.imageUrl = url; ok++; } else { miss++; console.error("MISS actor:", a.name || a.title); }
      await sleep(50);
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
  console.error("Done. resolved=" + ok + " missed=" + miss);
})();
