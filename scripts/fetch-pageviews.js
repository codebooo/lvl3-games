// Builds data/pageviews.json for "Höher oder Tiefer".
// Pulls real monthly view counts for curated German Wikipedia articles from the
// keyless Wikimedia Pageviews API. Re-run occasionally to refresh the numbers.
//   node scripts/fetch-pageviews.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TITLES = [
  // Prominente / Musik
  "Helene Fischer", "Rammstein", "Taylor Swift", "Michael Jackson", "Die Ärzte",
  "Herbert Grönemeyer", "Nena", "Kraftwerk", "Scooter (Band)", "Peter Maffay",
  "Udo Lindenberg", "Bushido (Rapper)", "Sido", "Kollegah", "Capital Bra",
  // Schauspiel / Film / TV
  "Til Schweiger", "Matthias Schweighöfer", "Christoph Waltz", "Diane Kruger",
  "Tatort", "Der Schuh des Manitu", "Das Boot", "Good Bye, Lenin!", "Lindenstraße",
  "Wetten, dass..?", "Tagesschau (Nachrichtensendung)", "Germany’s Next Topmodel",
  // Sport
  "Michael Schumacher", "Sebastian Vettel", "Dirk Nowitzki", "Boris Becker",
  "Steffi Graf", "Manuel Neuer", "Thomas Müller", "Franz Beckenbauer",
  "FC Bayern München", "Borussia Dortmund", "Bundesliga", "Formel 1",
  "Olympische Sommerspiele", "Fußball-Weltmeisterschaft 2014",
  // Essen & Trinken
  "Bratwurst", "Currywurst", "Döner Kebab", "Sauerkraut", "Brezel", "Schnitzel",
  "Schwarzwälder Kirschtorte", "Spätzle", "Leberkäse", "Weißwurst", "Pizza",
  "Bier", "Weizenbier", "Apfelschorle", "Kartoffelsalat", "Nutella", "Haribo",
  "Gummibärchen", "Marzipan", "Lebkuchen", "Glühwein", "Jägermeister",
  // Städte Deutschland
  "Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main", "Stuttgart",
  "Düsseldorf", "Leipzig", "Dresden", "Hannover", "Nürnberg", "Bremen",
  "Oldenburg (Oldb)", "Kiel", "Rostock", "Freiburg im Breisgau", "Heidelberg",
  "Bielefeld", "Wolfsburg", "Gelsenkirchen",
  // Länder & Geografie
  "Deutschland", "Österreich", "Schweiz", "Frankreich", "Italien", "Spanien",
  "Niederlande", "Polen", "Japan", "Vereinigte Staaten", "Brasilien", "Australien",
  "Zugspitze", "Rhein", "Donau", "Bodensee", "Nordsee", "Ostsee", "Schwarzwald",
  "Sylt", "Mallorca",
  // Technik & Marken
  "Volkswagen", "BMW", "Mercedes-Benz", "Porsche", "Audi", "Aldi", "Lidl",
  "Rewe", "Deutsche Bahn", "Lufthansa", "Siemens", "Bosch (Unternehmen)",
  "Adidas", "Puma SE", "Nivea", "Ritter Sport", "Miele", "Thermomix",
  // Wissenschaft & Geschichte
  "Albert Einstein", "Johann Wolfgang von Goethe", "Ludwig van Beethoven",
  "Wolfgang Amadeus Mozart", "Karl Marx", "Otto von Bismarck", "Angela Merkel",
  "Helmut Kohl", "Berliner Mauer", "Zweiter Weltkrieg", "Römisches Reich",
  "Mittelalter", "Industrielle Revolution", "Mondlandung", "Titanic",
  "Tschernobyl", "Deutsche Wiedervereinigung",
  // Tiere & Natur
  "Hund", "Hauskatze", "Pferd", "Igel", "Fuchs", "Wildschwein", "Wolf",
  "Braunbär", "Elefanten", "Blauwal", "Weißer Hai", "Tintenfische", "Biene",
  "Wespen", "Regenwurm", "Marienkäfer", "Eichhörnchen", "Waschbär",
  // Alltag & Kultur
  "Oktoberfest", "Karneval", "Weihnachten", "Ostern", "Führerschein",
  "Bundesautobahn", "Mofa", "Fahrrad", "Kaffee", "Schlaf", "Traum",
  "Liebe", "Geld", "Steuer", "Miete", "Elektroauto", "Solarenergie",
  "Künstliche Intelligenz", "Internet", "Smartphone", "WhatsApp", "YouTube",
  "Netflix", "Minecraft", "Fortnite", "Schach", "Mensch ärgere Dich nicht",
  "Skat", "Monopoly", "Lego", "Playmobil",
  // Kurioses (gute Höher/Tiefer-Kandidaten)
  "Klopapier", "Gartenzwerg", "Jodeln", "Lederhose", "Dirndl", "Kuckucksuhr",
  "Schrebergarten", "Autobahnraststätte", "Pfand", "Mülltrennung",
  "Sockensortierung", "Kehrwoche", "Bausparvertrag", "Fußpilz", "Schluckauf",
  "Niesen", "Gähnen", "Kitzeln", "Schnarchen"
];

// Previous full month (the API only has complete data for finished months).
const now = new Date();
const y = now.getUTCFullYear();
const m = now.getUTCMonth(); // 0-based; using this gives us last month
const start = new Date(Date.UTC(y, m - 1, 1));
const end = new Date(Date.UTC(y, m, 0));
const pad = (n) => String(n).padStart(2, "0");
const from = `${start.getUTCFullYear()}${pad(start.getUTCMonth() + 1)}0100`;
const to = `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}00`;
const period = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`;

function sleep(ms) { execFileSync("sleep", [String(ms / 1000)]); }

function views(title) {
  const enc = encodeURIComponent(title.replace(/ /g, "_"));
  const url = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/" +
    "de.wikipedia/all-access/all-agents/" + enc + "/monthly/" + from + "/" + to;
  // The API rate-limits with a JSON error body that parses fine but has no
  // `items` — treating that as "article doesn't exist" silently dropped ~75
  // perfectly real titles. So: retry on a missing `items`, only give up on a
  // genuine 404 (type contains "not_found"), and throttle between calls.
  for (let a = 0; a < 5; a++) {
    try {
      const out = execFileSync("curl", ["-sS", "--max-time", "25",
        "-H", "User-Agent: lvl3-games/1.0 (private hobby project)", url], { encoding: "utf8" });
      const j = JSON.parse(out);
      if (j && j.items && j.items.length) return j.items[0].views;
      if (j && typeof j.type === "string" && /not_found|not-found/i.test(j.type)) return null;
      sleep(900 * (a + 1));   // rate limited or transient → back off and retry
    } catch (e) { sleep(900 * (a + 1)); }
  }
  return null;
}

const entries = [];
const missing = [];
for (const t of TITLES) {
  const v = views(t);
  sleep(250);   // be a good citizen: stay well under the API's rate limit
  if (v == null || v < 300) { missing.push(t + (v == null ? " (kein Treffer)" : " (nur " + v + ")")); continue; }
  entries.push({ title: t, views: v });
  console.log(String(v).padStart(8) + "  " + t);
}

entries.sort((a, b) => b.views - a.views);
const target = path.join(__dirname, "..", "data", "pageviews.json");
fs.writeFileSync(target, JSON.stringify({ period, articles: entries }, null, 1) + "\n");
console.log("\nWrote " + entries.length + " articles for " + period + " to data/pageviews.json");
if (missing.length) { console.log("Übersprungen (" + missing.length + "): " + missing.join(", ")); }
