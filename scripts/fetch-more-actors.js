// Adds more actors/actresses to data/movies.json using Wikipedia portrait
// thumbnails (people photos — no movie title text baked into the image).
// Dedupes by name; drops anyone without a usable portrait.
//   node scripts/fetch-more-actors.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// [difficulty, name, hintFilms, wikiTitle?]
const ADD = [
  // ── easy — very well-known, mainstream ──
  ["easy", "Keanu Reeves", "Matrix, John Wick, Speed"],
  ["easy", "Matt Damon", "Good Will Hunting, Die Bourne-Reihe, Der Marsianer"],
  ["easy", "Christian Bale", "Batman-Trilogie, American Psycho, The Machinist"],
  ["easy", "Hugh Jackman", "Wolverine, Les Misérables, The Greatest Showman"],
  ["easy", "Samuel L. Jackson", "Pulp Fiction, Die Avengers, Django Unchained"],
  ["easy", "Harrison Ford", "Indiana Jones, Star Wars, Blade Runner"],
  ["easy", "Emma Stone", "La La Land, Poor Things, Easy A"],
  ["easy", "Ryan Gosling", "La La Land, Drive, Barbie"],
  ["easy", "Jennifer Aniston", "Friends, Marley & Ich, Wir sind die Millers"],
  ["easy", "Gal Gadot", "Wonder Woman, Fast & Furious"],
  ["easy", "Tom Holland", "Spider-Man, Uncharted"],
  ["easy", "Zac Efron", "High School Musical, Baywatch"],
  ["easy", "Matthew McConaughey", "Interstellar, Dallas Buyers Club, True Detective"],
  ["easy", "Chris Pratt", "Guardians of the Galaxy, Jurassic World"],
  ["easy", "Ben Affleck", "Argo, Batman, Good Will Hunting"],

  // ── normal — acclaimed / character actors ──
  ["normal", "Pedro Pascal", "The Last of Us, The Mandalorian, Game of Thrones"],
  ["normal", "Cillian Murphy", "Peaky Blinders, Oppenheimer, Inception"],
  ["normal", "Rami Malek", "Bohemian Rhapsody, Mr. Robot"],
  ["normal", "Andrew Garfield", "The Amazing Spider-Man, The Social Network"],
  ["normal", "Robert Pattinson", "The Batman, Twilight, Tenet"],
  ["normal", "Anya Taylor-Joy", "Das Damengambit, The Menu, Furiosa"],
  ["normal", "Austin Butler", "Elvis, Dune: Part Two"],
  ["normal", "Jessica Chastain", "Zero Dark Thirty, Interstellar"],
  ["normal", "Amy Adams", "Arrival, American Hustle"],
  ["normal", "Kate Winslet", "Titanic, The Reader, Mare of Easttown"],
  ["normal", "Ralph Fiennes", "Schindlers Liste, Harry Potter, Grand Budapest Hotel"],
  ["normal", "Mahershala Ali", "Moonlight, Green Book"],
  ["normal", "Bryan Cranston", "Breaking Bad, Malcolm mittendrin"],
  ["normal", "Hugh Grant", "Notting Hill, Tatsächlich… Liebe"],
  ["normal", "Sydney Sweeney", "Euphoria, Anyone but You"],

  // ── hard — classic / international ──
  ["hard", "Toshiro Mifune", "Die sieben Samurai, Rashomon", "Toshiro Mifune"],
  ["hard", "Alain Delon", "Der eiskalte Engel, Nur die Sonne war Zeuge"],
  ["hard", "Catherine Deneuve", "Belle de Jour, Die Regenschirme von Cherbourg"],
  ["hard", "Isabelle Huppert", "Die Klavierspielerin, Elle"],
  ["hard", "Gérard Depardieu", "Cyrano, Green Card"],
  ["hard", "Bruno Ganz", "Der Untergang, Der Himmel über Berlin"],
  ["hard", "Marlene Dietrich", "Der blaue Engel, Zeugin der Anklage"],
  ["hard", "Vivien Leigh", "Vom Winde verweht, Endstation Sehnsucht"],
  ["hard", "Laurence Olivier", "Hamlet, Rebecca"],
  ["hard", "Alec Guinness", "Star Wars, Die Brücke am Kwai"],
  ["hard", "Liv Ullmann", "Persona, Szenen einer Ehe"],
  ["hard", "Toshirô…","dummy","INVALID_SKIP"],
  ["hard", "Gong Li", "Lebewohl, meine Konkubine, Rote Laterne"],
  ["hard", "Tony Leung", "In the Mood for Love, Shang-Chi", "Tony Leung Chiu-wai"],
  ["hard", "Ken Watanabe", "Last Samurai, Inception"],
];

function sleep(ms) { execFileSync("sleep", [String(ms / 1000)]); }
function curlJson(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const out = execFileSync("curl", ["-sS", "--max-time", "25", "-H", "User-Agent: lvl3-games/1.0", url], { encoding: "utf8" });
      const d = JSON.parse(out);
      if (d && !d.title && !d.thumbnail) throw new Error("empty");
      return d;
    } catch (e) { sleep(1000 * (a + 1)); }
  }
  return null;
}
function headOk(url) {
  try {
    return execFileSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "25", "-H", "User-Agent: lvl3-games/1.0", url], { encoding: "utf8" }).trim() === "200";
  } catch (e) { return false; }
}
function bestSize(url) {
  const up = url.replace(/\/(\d+)px-/, "/480px-");
  if (up !== url && headOk(up)) return up;
  return headOk(url) ? url : null;
}
function portrait(name, title) {
  const t = title || name;
  for (const lang of ["en", "de"]) {
    const d = curlJson("https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t.replace(/ /g, "_")));
    if (d && d.thumbnail && d.thumbnail.source) { const img = bestSize(d.thumbnail.source); if (img) return img; }
  }
  return null;
}

const file = path.join(__dirname, "..", "data", "movies.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const have = {};
["easy", "normal", "hard"].forEach(d => (data.actors[d] || []).forEach(a => { have[a.name.toLowerCase()] = true; }));

let added = 0, dropped = [];
for (const [diff, name, hint, title] of ADD) {
  if (title === "INVALID_SKIP") continue;
  if (have[name.toLowerCase()]) { console.log("dup  " + name); continue; }
  const img = portrait(name, title);
  if (!img) { dropped.push(name); continue; }
  data.actors[diff].push({ name: name, hint: "Bekannt aus " + hint, imageUrl: img, aliases: [] });
  have[name.toLowerCase()] = true;
  added++;
  console.log("ok  [" + diff + "] " + name);
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log("\nAdded " + added + " actors. Totals: easy=" + data.actors.easy.length +
  " normal=" + data.actors.normal.length + " hard=" + data.actors.hard.length);
if (dropped.length) { console.log("Dropped (no portrait): " + dropped.join(", ")); }
