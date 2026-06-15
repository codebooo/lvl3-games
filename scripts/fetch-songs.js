// One-off / re-runnable: build data/songs.json from Apple's iTunes Search API.
// ~100 unique songs per difficulty, each with title, artist, https previewUrl, albumArt.
// Run:  node scripts/fetch-songs.js
const https = require("https");
const fs = require("fs");
const path = require("path");

const TARGET = 100;

// Diverse search terms per difficulty so we collect enough UNIQUE tracks.
const TERMS = {
  easy: [
    "top hits 2024", "top hits 2023", "pop hits 2022", "charts 2021", "viral hits",
    "taylor swift", "ed sheeran", "billie eilish", "the weeknd", "dua lipa",
    "harry styles", "drake", "ariana grande", "justin bieber", "bruno mars",
    "adele", "post malone", "coldplay", "rihanna", "maroon 5",
    "imagine dragons", "shawn mendes", "katy perry", "sia", "david guetta"
  ],
  normal: [
    "2010s hits", "2000s hits", "rock anthems", "indie pop", "hip hop hits",
    "electronic dance", "rnb classics", "eminem", "kanye west", "linkin park",
    "red hot chili peppers", "kings of leon", "arctic monkeys", "the killers", "muse",
    "beyonce", "alicia keys", "fall out boy", "green day", "avicii",
    "calvin harris", "kendrick lamar", "lana del rey", "lorde", "the chainsmokers"
  ],
  hard: [
    "80s pop", "80s rock", "90s hits", "90s rock", "classic rock",
    "german hits", "french pop", "jazz standards", "soul classics", "motown",
    "nirvana", "radiohead", "queen", "the beatles", "david bowie",
    "fleetwood mac", "pink floyd", "the rolling stones", "metallica", "ac dc",
    "michael jackson", "prince", "abba", "the cure", "depeche mode"
  ]
};

function search(term) {
  const url = "https://itunes.apple.com/search?term=" + encodeURIComponent(term) +
    "&media=music&entity=song&limit=50&country=DE";
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d).results || []); } catch (e) { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

async function collect(diff) {
  const seen = new Set();
  const out = [];
  for (const term of TERMS[diff]) {
    if (out.length >= TARGET) break;
    const results = await search(term);
    for (const t of results) {
      if (out.length >= TARGET) break;
      if (!t.previewUrl || !t.trackName || !t.artistName) continue;
      const key = (t.trackName + "|" + t.artistName).toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: t.trackName,
        artist: t.artistName,
        previewUrl: String(t.previewUrl).replace(/^http:\/\//i, "https://"),
        albumArt: String(t.artworkUrl100 || "").replace("100x100", "300x300")
      });
    }
  }
  return out;
}

(async () => {
  const data = {};
  for (const diff of ["easy", "normal", "hard"]) {
    data[diff] = await collect(diff);
    console.error(diff + ": " + data[diff].length + " songs");
  }
  const outPath = path.join(__dirname, "..", "data", "songs.json");
  fs.writeFileSync(outPath, JSON.stringify(data, null, 1), "utf8");
  console.error("Wrote " + outPath);
})();
