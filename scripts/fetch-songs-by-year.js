// Build data/songs.json from Apple's iTunes Search API, organised by release year.
//   easy   = top ~10 era-matched hits per year 1960-2026 (most recognizable)
//   hard   = deeper cuts (ranks ~11-22 per year) — less famous
//   normal = 50% easy + 50% hard (so "normal" is noticeably easier than before)
// Run:  node scripts/fetch-songs-by-year.js
const https = require("https");
const fs = require("fs");
const path = require("path");

const START = 1960, END = 2026;
const EASY_PER_YEAR = 10;   // ranks 1..10  -> easy
const HARD_PER_YEAR = 12;   // ranks 11..22 -> hard pool

function search(term) {
  const url = "https://itunes.apple.com/search?term=" + encodeURIComponent(term) +
    "&media=music&entity=song&limit=60&country=US";
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d).results || []); } catch (e) { resolve([]); } });
    }).on("error", () => resolve([]));
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const yearOf = (t) => (t.releaseDate || "").slice(0, 4);
const songOf = (t) => ({
  title: t.trackName,
  artist: t.artistName,
  previewUrl: String(t.previewUrl).replace(/^http:\/\//i, "https://"),
  albumArt: String(t.artworkUrl100 || "").replace("100x100", "300x300")
});

(async () => {
  const easy = [], hard = [];
  const globalSeen = new Set(); // title|artist across everything
  const key = (t) => (t.trackName + "|" + t.artistName).toLowerCase().trim();

  for (let y = START; y <= END; y++) {
    const queries = [`${y}`, `top hits ${y}`, `best songs ${y}`, `${y} greatest hits`, `${y} pop`, `${y} rock`, `${y} hits`, `${y} number one`, `${y} billboard`];
    const ordered = [];
    const seenYear = new Set();
    for (const q of queries) {
      const results = await search(q);
      for (const t of results) {
        if (!t.previewUrl || !t.trackName || !t.artistName) continue;
        if (yearOf(t) !== String(y)) continue;            // only songs actually released that year
        if (seenYear.has(t.trackId)) continue;
        seenYear.add(t.trackId);
        ordered.push(t);
      }
      await sleep(40);
    }
    // first EASY_PER_YEAR unique (globally) -> easy, next HARD_PER_YEAR -> hard
    let e = 0, h = 0;
    for (const t of ordered) {
      const k = key(t);
      if (globalSeen.has(k)) continue;
      if (e < EASY_PER_YEAR) { globalSeen.add(k); easy.push(songOf(t)); e++; }
      else if (h < HARD_PER_YEAR) { globalSeen.add(k); hard.push(songOf(t)); h++; }
      if (e >= EASY_PER_YEAR && h >= HARD_PER_YEAR) break;
    }
    console.error(y + ": +" + e + " easy, +" + h + " hard  (easy=" + easy.length + " hard=" + hard.length + ")");
  }

  // normal = 50% easy + 50% hard, interleaved
  function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
  const halfEasy = shuffle(easy).slice(0, Math.ceil(easy.length / 2));
  const halfHard = shuffle(hard);
  const normal = shuffle(halfEasy.concat(halfHard.slice(0, halfEasy.length)));

  const out = { easy, normal, hard };
  fs.writeFileSync(path.join(__dirname, "..", "data", "songs.json"), JSON.stringify(out, null, 1), "utf8");
  console.error("DONE  easy=" + easy.length + " normal=" + normal.length + " hard=" + hard.length);
})();
