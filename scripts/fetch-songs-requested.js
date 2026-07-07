// Adds a curated request list to data/songs.json using Apple's iTunes Search API
// (free, legal 30-second previews — the same source the game already uses; no
// downloading of full tracks from anywhere). Each entry is searched by
// "title artist", the best music match with a previewUrl is kept, bucketed into
// easy/normal/hard by era/popularity, then merged into songs.json (dedup by
// title+artist). Usage: node scripts/fetch-songs-requested.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// [title, artist, bucket]. bucket: modern hits -> easy, 2010s/rap -> normal,
// rock/classics/indie -> hard. (Feel free to rebalance.)
const REQUESTS = [
  ["Blinding Lights", "The Weeknd", "easy"],
  ["Shape of You", "Ed Sheeran", "easy"],
  ["As It Was", "Harry Styles", "easy"],
  ["Die With A Smile", "Lady Gaga Bruno Mars", "easy"],
  ["Espresso", "Sabrina Carpenter", "easy"],
  ["Cruel Summer", "Taylor Swift", "easy"],
  ["Flowers", "Miley Cyrus", "easy"],
  ["Seven", "Jung Kook Latto", "easy"],
  ["Stay", "The Kid LAROI Justin Bieber", "easy"],
  ["Watermelon Sugar", "Harry Styles", "easy"],
  ["Don't Start Now", "Dua Lipa", "easy"],
  ["Drivers License", "Olivia Rodrigo", "easy"],
  ["Kill Bill", "SZA", "easy"],
  ["Beautiful Things", "Benson Boone", "easy"],
  ["Sunroof", "Nicky Youre dazy", "easy"],
  ["Levitating", "Dua Lipa", "easy"],
  ["Peaches", "Justin Bieber Daniel Caesar Giveon", "easy"],
  ["Save Your Tears", "The Weeknd", "easy"],
  ["Bad Guy", "Billie Eilish", "easy"],
  ["One Dance", "Drake Wizkid Kyla", "easy"],
  ["Sunflower", "Post Malone Swae Lee", "easy"],
  ["Starboy", "The Weeknd Daft Punk", "easy"],
  ["Heat Waves", "Glass Animals", "easy"],

  ["Lucid Dreams", "Juice WRLD", "normal"],
  ["God's Plan", "Drake", "normal"],
  ["Goosebumps", "Travis Scott", "normal"],
  ["HUMBLE.", "Kendrick Lamar", "normal"],
  ["Lose Yourself", "Eminem", "normal"],
  ["rockstar", "Post Malone 21 Savage", "normal"],
  ["SICKO MODE", "Travis Scott", "normal"],
  ["All of Me", "John Legend", "normal"],
  ["The Hills", "The Weeknd", "normal"],
  ["Location", "Khalid", "normal"],
  ["No Role Modelz", "J. Cole", "normal"],
  ["Better Now", "Post Malone", "normal"],
  ["Psycho", "Post Malone Ty Dolla $ign", "normal"],
  ["Nice For What", "Drake", "normal"],
  ["Mask Off", "Future", "normal"],
  ["Congratulations", "Post Malone Quavo", "normal"],
  ["Mo Bamba", "Sheck Wes", "normal"],
  ["Sweater Weather", "The Neighbourhood", "normal"],
  ["I Wanna Be Yours", "Arctic Monkeys", "normal"],
  ["Someone You Loved", "Lewis Capaldi", "normal"],
  ["lovely", "Billie Eilish Khalid", "normal"],
  ["Another Love", "Tom Odell", "normal"],
  ["Let Her Go", "Passenger", "normal"],
  ["Photograph", "Ed Sheeran", "normal"],
  ["Thinking Out Loud", "Ed Sheeran", "normal"],
  ["Take Me to Church", "Hozier", "normal"],
  ["Say You Won't Let Go", "James Arthur", "normal"],
  ["Ho Hey", "The Lumineers", "normal"],
  ["Closer", "The Chainsmokers Halsey", "normal"],
  ["Perfect", "Ed Sheeran", "normal"],
  ["Stressed Out", "Twenty One Pilots", "normal"],
  ["Demons", "Imagine Dragons", "normal"],
  ["Believer", "Imagine Dragons", "normal"],
  ["Thunder", "Imagine Dragons", "normal"],

  ["Mr. Brightside", "The Killers", "hard"],
  ["Smells Like Teen Spirit", "Nirvana", "hard"],
  ["Creep", "Radiohead", "hard"],
  ["Riptide", "Vance Joy", "hard"],
  ["Do I Wanna Know?", "Arctic Monkeys", "hard"],
  ["505", "Arctic Monkeys", "hard"],
  ["Yellow", "Coldplay", "hard"],
  ["Wonderwall", "Oasis", "hard"],
  ["In the End", "Linkin Park", "hard"],
  ["Seven Nation Army", "The White Stripes", "hard"],
  ["Use Somebody", "Kings of Leon", "hard"],
  ["Sugar, We're Goin Down", "Fall Out Boy", "hard"],
  ["Boulevard of Broken Dreams", "Green Day", "hard"],
  ["The Night We Met", "Lord Huron", "hard"],
  ["Rivers and Roads", "The Head and the Heart", "hard"],
  ["Skinny Love", "Bon Iver", "hard"],
  ["Vienna", "Billy Joel", "hard"],
  ["Landslide", "Fleetwood Mac", "hard"],
  ["Fast Car", "Tracy Chapman", "hard"],
  ["Banana Pancakes", "Jack Johnson", "hard"],
  ["Put Your Records On", "Corinne Bailey Rae", "hard"],
  ["Dog Days Are Over", "Florence + the Machine", "hard"],
  ["Wait", "M83", "hard"],
  ["Dreams", "Fleetwood Mac", "hard"],
  ["Every Breath You Take", "The Police", "hard"],
  ["Don't Stop Believin'", "Journey", "hard"],
  ["Billie Jean", "Michael Jackson", "hard"],
  ["Bohemian Rhapsody", "Queen", "hard"],
  ["Dancing Queen", "ABBA", "hard"],
  ["September", "Earth, Wind & Fire", "hard"],
  ["Africa", "Toto", "hard"],
  ["Sweet Child O' Mine", "Guns N' Roses", "hard"],
  ["Livin' on a Prayer", "Bon Jovi", "hard"],
  ["Don't Stop Me Now", "Queen", "hard"],
  ["I Wanna Dance with Somebody", "Whitney Houston", "hard"],
  ["Hotel California", "Eagles", "hard"],
  ["Go Your Own Way", "Fleetwood Mac", "hard"],
  ["Superstition", "Stevie Wonder", "hard"],
  ["Under Pressure", "Queen David Bowie", "hard"],
  ["Take on Me", "a-ha", "hard"],
  ["Here Comes the Sun", "The Beatles", "hard"],
  ["Stand by Me", "Ben E. King", "hard"],
  ["Linger", "The Cranberries", "hard"],
];

function search(term) {
  const url = "https://itunes.apple.com/search?term=" + encodeURIComponent(term) +
    "&media=music&entity=song&limit=8&country=DE";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = execFileSync("curl", ["-sS", "--max-time", "25", url], { encoding: "utf8", maxBuffer: 8e6 });
      return JSON.parse(out).results || [];
    } catch (e) {
      execFileSync("sleep", [String(attempt + 1)]);
    }
  }
  return [];
}

function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

function pick(results, title, artist) {
  const nt = norm(title), na = norm(artist.split(" ")[0]);
  // prefer a result whose track matches the title and has a preview
  const withPreview = results.filter(r => r.previewUrl && r.trackName && r.artistName);
  const exact = withPreview.find(r => norm(r.trackName).includes(nt) && norm(r.artistName).includes(na));
  return exact || withPreview.find(r => norm(r.trackName).includes(nt)) || withPreview[0] || null;
}

const file = path.join(__dirname, "..", "data", "songs.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
["easy", "normal", "hard"].forEach(b => { if (!Array.isArray(data[b])) data[b] = []; });

const seen = {};
["easy", "normal", "hard"].forEach(b => data[b].forEach(s => { seen[norm(s.title) + "|" + norm(s.artist)] = true; }));

let added = 0, missing = [];
for (const [title, artist, bucket] of REQUESTS) {
  const hit = pick(search(title + " " + artist), title, artist);
  if (!hit) { missing.push(title + " — " + artist); continue; }
  const key = norm(hit.trackName) + "|" + norm(hit.artistName);
  if (seen[key]) { console.log("dup  " + title); continue; }
  seen[key] = true;
  data[bucket].push({
    title: hit.trackName,
    artist: hit.artistName,
    previewUrl: (hit.previewUrl || "").replace(/^http:\/\//i, "https://"),
    albumArt: (hit.artworkUrl100 || "").replace("100x100bb", "300x300bb")
  });
  added++;
  console.log("ok  [" + bucket + "] " + hit.trackName + " — " + hit.artistName);
}

fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
console.log("\nAdded " + added + " songs. Totals: easy=" + data.easy.length + " normal=" + data.normal.length + " hard=" + data.hard.length);
if (missing.length) { console.log("Not found (" + missing.length + "):"); missing.forEach(m => console.log("  - " + m)); }
