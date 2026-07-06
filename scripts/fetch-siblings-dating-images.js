// Builds data/siblings-dating.json for the "Siblings or Dating" game.
// For every curated pair it resolves both portrait thumbnails via the
// Wikipedia REST summary API (en first, de fallback), verifies the image
// URLs actually load, and bakes them into the JSON. Pairs with a missing
// portrait are dropped and reported.
//
// Usage: node scripts/fetch-siblings-dating-images.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// [answer, relation, person1, person2, wikiTitle1?, wikiTitle2?]
// answer: "siblings" | "couple". wikiTitle defaults to the display name.
const PAIRS = [
  // ── Geschwister ──
  ["siblings", "Brüder",                    "Chris Hemsworth", "Liam Hemsworth"],
  ["siblings", "Geschwister",               "Jake Gyllenhaal", "Maggie Gyllenhaal"],
  ["siblings", "Schwestern",                "Dakota Fanning", "Elle Fanning"],
  ["siblings", "Schwestern",                "Gigi Hadid", "Bella Hadid"],
  ["siblings", "Schwestern",                "Kendall Jenner", "Kylie Jenner"],
  ["siblings", "Brüder",                    "Ben Affleck", "Casey Affleck"],
  ["siblings", "Brüder",                    "Owen Wilson", "Luke Wilson"],
  ["siblings", "Brüder",                    "James Franco", "Dave Franco"],
  ["siblings", "Schwestern",                "Zooey Deschanel", "Emily Deschanel"],
  ["siblings", "Schwestern",                "Miley Cyrus", "Noah Cyrus"],
  ["siblings", "Brüder",                    "Macaulay Culkin", "Kieran Culkin"],
  ["siblings", "Brüder",                    "Alexander Skarsgård", "Bill Skarsgård"],
  ["siblings", "Schwestern",                "Kate Mara", "Rooney Mara"],
  ["siblings", "Schwestern",                "Beyoncé", "Solange Knowles"],
  ["siblings", "Geschwister",               "Jaden Smith", "Willow Smith"],
  ["siblings", "Brüder",                    "Chris Evans", "Scott Evans", "Chris Evans (actor)", "Scott Evans (actor)"],
  ["siblings", "Zwillinge (Tokio Hotel)",   "Bill Kaulitz", "Tom Kaulitz"],
  ["siblings", "Brüder",                    "Jimi Blue Ochsenknecht", "Wilson Gonzalez Ochsenknecht"],
  ["siblings", "Geschwister",               "Shirley MacLaine", "Warren Beatty"],
  ["siblings", "Geschwister",               "Julia Roberts", "Eric Roberts"],
  ["siblings", "Brüder",                    "Charlie Sheen", "Emilio Estevez"],
  ["siblings", "Geschwister",               "Jonah Hill", "Beanie Feldstein"],
  ["siblings", "Brüder (Oasis)",            "Liam Gallagher", "Noel Gallagher"],
  ["siblings", "Schwestern",                "Venus Williams", "Serena Williams"],
  ["siblings", "Brüder",                    "Wladimir Klitschko", "Vitali Klitschko", "Wladimir Klitschko", "Vitali Klitschko"],
  ["siblings", "Brüder (Jonas Brothers)",   "Joe Jonas", "Nick Jonas"],
  ["siblings", "Geschwister",               "Angelina Jolie", "James Haven"],
  ["siblings", "Schwestern",                "Elizabeth Olsen", "Mary-Kate Olsen"],
  ["siblings", "Schwestern",                "Penélope Cruz", "Mónica Cruz"],
  // ── Paare ──
  ["couple", "Verheiratet seit 2012",       "Ryan Reynolds", "Blake Lively"],
  ["couple", "Ein Paar (verlobt)",          "Tom Holland", "Zendaya"],
  ["couple", "Verheiratet seit 2018",       "Justin Bieber", "Hailey Bieber"],
  ["couple", "Ein Paar (verlobt)",          "Taylor Swift", "Travis Kelce"],
  ["couple", "Ein Paar seit 2011",          "Ryan Gosling", "Eva Mendes"],
  ["couple", "Verheiratet seit 2010",       "John Krasinski", "Emily Blunt"],
  ["couple", "Verheiratet seit 2015",       "Ashton Kutcher", "Mila Kunis"],
  ["couple", "Verheiratet seit 2018",       "Nick Jonas", "Priyanka Chopra"],
  ["couple", "Verheiratet seit 2014",       "George Clooney", "Amal Clooney"],
  ["couple", "Verheiratet seit 1999",       "David Beckham", "Victoria Beckham"],
  ["couple", "Verheiratet seit 2019",       "Heidi Klum", "Tom Kaulitz"],
  ["couple", "Verheiratet seit 1992",       "Barack Obama", "Michelle Obama"],
  ["couple", "Verheiratet seit 2013",       "Chrissy Teigen", "John Legend"],
  ["couple", "Ein Paar seit 1983",          "Kurt Russell", "Goldie Hawn"],
  ["couple", "Verheiratet seit 1988",       "Tom Hanks", "Rita Wilson"],
  ["couple", "Verheiratet seit 2010",       "Javier Bardem", "Penélope Cruz"],
  ["couple", "Verheiratet seit 2011",       "Daniel Craig", "Rachel Weisz"],
  ["couple", "Verheiratet seit 2010",       "Chris Hemsworth", "Elsa Pataky"],
  ["couple", "Verheiratet seit 2015",       "Benji Madden", "Cameron Diaz"],
  ["couple", "Verheiratet seit 2017",       "Alexis Ohanian", "Serena Williams"],
  ["couple", "Verheiratet seit 2008",       "Jay-Z", "Beyoncé"],
  ["couple", "Verheiratet seit 2011",       "Prinz William", "Kate Middleton", "William, Prince of Wales", "Catherine, Princess of Wales"],
  ["couple", "Ein Paar seit 2023",          "Timothée Chalamet", "Kylie Jenner"],
  ["couple", "Ein Paar (verlobt)",          "Jason Statham", "Rosie Huntington-Whiteley"],
  ["couple", "Verheiratet seit 2011",       "Michael Bublé", "Luisana Lopilato"],
  ["couple", "Ein Paar seit 2019",          "Keanu Reeves", "Alexandra Grant"],
];

function sleep(ms) {
  execFileSync("sleep", [String(ms / 1000)]);
}

function curlJson(url) {
  // Wikipedia occasionally throttles rapid sequential requests — retry with backoff.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = execFileSync("curl", ["-sS", "--max-time", "25", "-H", "User-Agent: lvl3-games/1.0", url], { encoding: "utf8" });
      const data = JSON.parse(out);
      if (data && !data.title && !data.thumbnail) throw new Error("empty");
      return data;
    } catch (e) {
      sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

function headOk(url) {
  try {
    const out = execFileSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "25",
      "-H", "User-Agent: lvl3-games/1.0", url], { encoding: "utf8" });
    return out.trim() === "200";
  } catch (e) {
    return false;
  }
}

// Try a crisper 480px render first; Wikipedia rejects widths beyond the
// original file size with a 400, so fall back to the API-provided thumbnail.
function bestSize(url) {
  const up = url.replace(/\/(\d+)px-/, "/480px-");
  if (up !== url && headOk(up)) return up;
  return headOk(url) ? url : null;
}

const imgCache = {};
function portraitFor(name, wikiTitle) {
  const title = wikiTitle || name;
  if (imgCache[title] !== undefined) return imgCache[title];
  let img = null;
  for (const lang of ["en", "de"]) {
    const data = curlJson("https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")));
    if (data && data.thumbnail && data.thumbnail.source) {
      img = bestSize(data.thumbnail.source);
      if (img) break;
    }
  }
  if (!img) console.log("  ! no portrait for " + title);
  imgCache[title] = img;
  return img;
}

const out = [];
const dropped = [];
for (const [answer, relation, n1, n2, t1, t2] of PAIRS) {
  const img1 = portraitFor(n1, t1);
  const img2 = portraitFor(n2, t2);
  if (!img1 || !img2) {
    dropped.push(n1 + " & " + n2 + (img1 ? "" : " [no image: " + n1 + "]") + (img2 ? "" : " [no image: " + n2 + "]"));
    continue;
  }
  out.push({ answer, relation, person1: { name: n1, img: img1 }, person2: { name: n2, img: img2 } });
  console.log("ok  " + n1 + " & " + n2);
}

const target = path.join(__dirname, "..", "data", "siblings-dating.json");
fs.writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log("\nWrote " + out.length + " pairs to " + target);
if (dropped.length) {
  console.log("Dropped " + dropped.length + ":");
  dropped.forEach(d => console.log("  - " + d));
}
