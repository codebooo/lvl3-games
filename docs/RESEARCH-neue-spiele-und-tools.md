# LVL³ — Research: 10 neue Spiele + 10 neue Tools

Ausbauplan für das private Party-Portal von Marlin, Oskar, David & Bosse.
Alles ist auf den bestehenden Stack zugeschnitten: Node + Express + Socket.IO,
Vanilla-JS-Frontend, Phantom-Design, 4 feste Nutzer, kostenlose & keyless
Datenquellen.

---

## 0. Wie dieses Dokument zu lesen ist

**Quellenlage — bitte ernst nehmen:**

| Aussagetyp | Verlässlichkeit |
|---|---|
| **Datenquellen / APIs** (Abschnitt 2) | **Direkt verifiziert.** Jeder Endpunkt wurde am 01.08.2026 von diesem Server aus mit `curl` aufgerufen; HTTP-Status und Beispielantwort sind unten protokolliert. |
| **Aufwands-Schätzungen** | **Am eigenen Code kalibriert** (siehe Abschnitt 1), nicht geraten. |
| **Format-Beliebtheit** ("Jackbox-Klassiker", "skribbl funktioniert weil…") | **Aus meinem eigenen Domänenwissen**, *nicht* frisch mit Quellen belegt. Drei parallele Web-Recherche-Agenten wurden mitten im Lauf von einem Session-Limit abgebrochen. Diese Einschätzungen sind plausibel und branchenüblich, aber ungeprüft — behandle sie als fundierte Meinung, nicht als Zitat. |

Wenn dir das für eine Entscheidung nicht reicht: die Recherche lässt sich nach
Reset des Limits nachziehen, dann ergänze ich echte Belege.

---

## 1. Aufwands-Maßstab (aus diesem Repo abgeleitet)

Gemessen an bestehenden Spielen:

| Größe | Bedeutung | Vergleich im Repo |
|---|---|---|
| **S** | ~150–250 Zeilen Handler, nutzt vorhandene Screen-Muster (Lobby → Countdown → Frage → Reveal → Ende) fast 1:1. Ein Abend. | `connect4-handler.js`, `flag-quiz-handler.js` |
| **M** | ~250–400 Zeilen pro Seite **plus** Datenaufbereitung (Skript + JSON). Ein Wochenende. | `siblings-dating` (407 Client + 300 Server + Fetch-Skript) |
| **L** | Neues Interaktionsparadigma (Canvas, Karte, Echtzeit-Strokes), mehrphasig. Mehrere Sessions. | `jeopardy` (718 Client + 407 Server) |

**Was jedes neue Spiel gratis erbt** (bereits gebaut, nicht neu erfinden):
Räume mit 4-Buchstaben-Code, Host/Gast-Rollen, Team-Einteilung per Klick
(1v1 / 2v1 / 3v1 / 2v2), Reconnect mit 90 s Gnadenfenster + State-Replay,
Leaderboard via `stats.recordGameResult()`, Avatar-System, Sounds, Bug-Report,
Phantom-CSS, Mobile-Pass (Safe-Area, 44 px Tap-Targets, 16 px Inputs).

**Checkliste pro neuem Spiel** (aus der `siblings-dating`-Erfahrung):
1. `server/games/<slug>-handler.js` + Slug in die Handler-Liste in `server.js`
2. `public/games/<slug>.html` (Phantom-Style von `flag-quiz.html` kopieren)
3. `public/js/games/<slug>.js`
4. Eintrag im `GAMES`-Array in `dashboard.html` (Galerie **und** Liste, `variant:` hochzählen)
5. `data/<slug>.json` + optional `scripts/fetch-<slug>.js`
6. README-Tabelle, Cache-Buster `?v=` setzen
7. **Timer-Guard nicht vergessen:** jeder verzögerte `setTimeout` braucht
   `if (!rm || rm.gameData !== gd || !rm.started) return;` — sonst crasht ein
   Restart mitten im Reveal den Prozess (dieser Bug war real).
8. **Away-Spieler ignorieren:** "warten bis alle geantwortet haben" muss
   `r.grace`-Spieler ausschließen, sonst blockiert ein Handy im Hintergrund die Runde.

---

## 2. Datenquellen — am 01.08.2026 selbst getestet

### ✅ Funktioniert, keyless, deutschsprachig nutzbar

| Quelle | Beispiel-Request | Liefert | Bewertung |
|---|---|---|---|
| **Wikipedia Pageviews** | `wikimedia.org/api/rest_v1/metrics/pageviews/per-article/de.wikipedia/all-access/all-agents/Berlin/monthly/2025060100/2025063000` | Aufrufzahlen pro Artikel/Monat | **Goldgrube.** Endlose "Höher/Tiefer"-Fragen, rein deutsch, kein Key. |
| **Wikipedia REST Summary** | `de.wikipedia.org/api/rest_v1/page/random/summary` | Zufallsartikel, Bild, Extrakt | Schon in Benutzung (Portraits). Auch `/page/summary/<Titel>`. |
| **Wikipedia Geosearch** | `de.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=52.52\|13.40&gsradius=10000&gslimit=3&format=json` | Artikel nach Koordinaten | Basis für Geo-Spiele. |
| **Wikipedia On-this-day** | `de.wikipedia.org/api/rest_v1/feed/onthisday/events/07/19` | Historische Ereignisse, deutsch | Perfekt für Chronologie-Spiel. |
| **Wikidata SPARQL** | `query.wikidata.org/sparql?format=json&query=…` | Strukturierte Fakten (Einwohner, Höhe, Jahre) | Mächtig, aber SPARQL nötig; Ergebnisse cachen. |
| **Wikimedia Commons** | `commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle=Category:Cats&…` | Bilder nach Kategorie | Freie Bilder, Attribution beachten. |
| **zippopotam.us** | `api.zippopotam.us/de/26123` → Oldenburg | Ort zu deutscher PLZ | Deutsche PLZ funktionieren! |
| **OpenFoodFacts** | `world.openfoodfacts.org/api/v2/product/4000417025005.json` | Produktdaten, Zucker, Nutri-Score, Bilder | Deutsche Barcodes vorhanden. ODbL. |
| **iTunes Search** | `itunes.apple.com/search?term=…` | 30-s-Previews, Cover | Schon in Benutzung (Song Guesser). |
| **iTunes Charts DE** | `rss.applemarketingtools.com/api/v2/de/music/most-played/10/songs.json` | Aktuelle DE-Top-Titel | Hält Song-Pool automatisch frisch. |
| **OpenTDB** | `opentdb.com/api.php?amount=1` | Trivia | **Nur Englisch** — für DE selbst übersetzen oder eigene Fragen. |
| **The Trivia API** | `the-trivia-api.com/v2/questions?limit=1` | Trivia | Keyless, aber Englisch. |
| **open-meteo** | `api.open-meteo.com/v1/forecast?…` | Wetter | Für Tools (Grillwetter). |
| **Deck of Cards** | `deckofcardsapi.com/api/deck/new/shuffle/` | Kartendeck + Bilder | Kartenspiele ohne eigene Assets. |
| **OSM Tiles** | `tile.openstreetmap.org/6/34/21.png` | Kartenkacheln | Nur mit Leaflet + Attribution, Tile-Usage-Policy beachten (privates Mini-Projekt = ok). |
| **DiceBear** | `api.dicebear.com/9.x/bottts/svg?seed=bosse` | Avatare | Fallback-Avatare. |

### ❌ Tot oder unbrauchbar (nicht einplanen)

| Quelle | Status |
|---|---|
| **restcountries.com** | `{"success":false … This API version has been deprecated}` — **nicht mehr nutzen.** |
| **numbersapi.com** | HTTP 404 — tot. |
| **de.wiktionary REST definition** | HTTP 501 — für Deutsch nicht verfügbar. Stattdessen `action=query`-API oder eigene Wortliste. |
| **Clearbit Logo API** | Abgeschaltet (deshalb nutzt Logo Guesser Favicons). |
| **logo.dev / brandfetch CDN** | Key nötig bzw. liefert HTML statt Bild. |
| **Google Street View / Mapillary** | Key nötig → **kein echtes GeoGuessr** möglich. Geo-Spiele müssen mit Karten/Fotos aus Commons arbeiten. |

### ⚖️ Rechtliches — kurz und praktisch

Spiel**mechaniken** sind grundsätzlich nicht urheberrechtlich geschützt
(Idee-Ausdruck-Trennung); geschützt sind **Namen/Marken, Logos, Artwork, Layout
und konkrete Frage-/Kartentexte**. Praxisregel für dieses Projekt:

- Mechanik nachbauen: ✅ — eigener deutscher Name, eigenes Design, eigene Inhalte.
- Nicht tun: fremde Wortmarken als Spieltitel, Original-Kartentexte oder
  Original-Grafiken übernehmen.
- Konkret: das Spektrum-Spiel heißt **"Wellenlänge"** und nutzt **selbst
  geschriebene** Achsenpaare — nicht die Kartentexte des Vorbilds.
- *Diese Einordnung ist keine Rechtsberatung; sie ist für ein privates Portal mit
  vier Nutzern aber unkritisch.*

---

## 3. Die 10 Spiele — nach Spaß-pro-Aufwand sortiert

### 🥇 1. Höher oder Tiefer — "Was googelt Deutschland?"

**Pitch:** Zwei Wikipedia-Artikel, eine Frage: Welcher wurde letzten Monat
öfter aufgerufen — *Bratwurst* oder *Boris Becker*? Endlos, immer aktuell,
absurd komisch.

- **Core Loop:** Server zeigt Artikel A mit echter Aufrufzahl, dazu Artikel B ohne Zahl. Alle tippen gleichzeitig höher/tiefer → Reveal mit echten Zahlen → richtige bleiben in der Streak.
- **Runde:** 10 s pro Duell, 10–15 Duelle. Sieger-Artikel wird das neue A (Kettenmechanik wie beim Vorbild).
- **Modi:** Solo (Streak-Rekord), FFA 2–4, Teams 2v2 (Team-Mehrheit entscheidet).
- **Scoring:** +1 pro Treffer, Streak-Bonus ×2 ab 3 in Folge. Bei Solo: Highscore in `stats`.
- **Daten:** Wikipedia Pageviews API (verifiziert). Kuratierte Liste von ~300 deutschen Artikeltiteln (Promis, Essen, Städte, Begriffe) → `scripts/fetch-pageviews.js` zieht monatlich die Zahlen in `data/pageviews.json`. Kein Live-Call im Spiel = keine Latenz.
- **Umsetzung:** Screens fast identisch zu `siblings-dating` (zwei Karten + zwei Buttons) → **Copy-Paste-Kandidat Nr. 1.** Events: `hoeher:start`, `hoeher:vote {higher|lower}`, `game:state` Phasen `countdown|duel|reveal|game-end`.
- **Aufwand:** **S**
- **Risiken:** Pageview-Zahlen sind manchmal *zu* eindeutig → Paare nach Verhältnis filtern (Faktor 1,2–5 ist spannend, Faktor 50 langweilig). Monatliches Nachziehen des JSON einplanen.

---

### 🥈 2. Lügenbaron — Bluff-Quiz

**Pitch:** Eine schwere Wissensfrage. Jeder erfindet eine **falsche** Antwort.
Alle Antworten werden gemischt gezeigt — wer die echte findet, punktet; wer
andere auf seine Lüge reinlegt, punktet doppelt.

- **Core Loop:** Frage → alle tippen eine Fake-Antwort (30 s) → Server mischt Fakes + Wahrheit → alle wählen (20 s) → Reveal: wer lag auf wessen Lüge.
- **Runde:** ~60 s, 6–8 Fragen.
- **Modi:** FFA 3–4 (Kern), 2 Spieler funktioniert schwächer (nur 1 Fake) → ab 3 empfehlen. Kein Solo.
- **Scoring:** Wahrheit gefunden +2; pro Reinfall auf deine Lüge +1; identische Fakes → Bonus für beide (schöner Zufalls-Lacher).
- **Daten:** **`data/questions.json` liegt schon da** (476 Fragen) — Freitext-Antworten sind ideal. Null neue Datenbeschaffung.
- **Umsetzung:** Zwei Eingabephasen statt einer. Events: `lb:submit-lie`, `lb:pick`. Wichtig: eingegebene Lügen sind **User-Input in `innerHTML`** → zwingend `escapeHtml` (genau die XSS-Klasse, die wir schon gefixt haben). Duplikate case-insensitive zusammenfassen; Lüge = echte Antwort → verwerfen und neu anfordern.
- **Aufwand:** **S–M**
- **Risiken:** Bei 3 Spielern nur 2 Fakes + Wahrheit → Ratequote hoch; Server kann 1–2 Server-Fakes beimischen. Tippfaule Spieler bremsen → harter Timer + "keine Lüge" zählt als Fehlrunde.

---

### 🥉 3. Stadt Land Fluss

**Pitch:** Der deutsche Klassiker, digital und mit Peer-Voting. Buchstabe fällt,
alle tippen los, wer zuerst fertig ist stoppt die Runde.

- **Core Loop:** Zufallsbuchstabe → alle füllen 5–6 Kategorien parallel → erster Fertiger drückt STOPP (oder Timer) → **gemeinsame Abstimmung** über strittige Antworten → Punkte.
- **Runde:** 60–90 s + ~45 s Voting. 5–8 Runden.
- **Modi:** FFA 2–4, Teams 2v2 (gemeinsames Formular). Solo als Zeittraining.
- **Scoring:** Klassisch: 20 = einzigartig, 10 = mehrfach, 5 = einzige Antwort in der Kategorie, 0 = ungültig/leer. Voting entscheidet Gültigkeit.
- **Daten:** Kategorien selbst definieren (Stadt, Land, Fluss, Tier, Beruf, Marke, Film…). Validierung **nicht** automatisieren — Peer-Voting ist der Spaß. Optional Plausibilitätshilfe via Wikipedia-Suche als Hinweis, nicht als Urteil.
- **Umsetzung:** Nutzt die Voting-Infrastruktur konzeptuell wie `siblings-dating`. Events: `slf:submit {answers}`, `slf:stop`, `slf:vote {player, category, valid}`. Screens: Formular-Grid, Voting-Tabelle, Punkte.
- **Aufwand:** **M**
- **Risiken:** Voting-Phase kann bei 4 Spielern × 6 Kategorien lang werden → nur *strittige* (nicht-identische) Antworten zur Abstimmung stellen, Rest automatisch gültig. Mobile: 6 Felder auf einem Handy-Screen = enges Layout, unbedingt einspaltig.

---

### 4. Wellenlänge — Spektrum-Raten

**Pitch:** Ein Regler zwischen zwei Extremen ("kalt ↔ heiß", "überschätzt ↔
unterschätzt"). Ein Spieler kennt die Zielposition und gibt **einen** Begriff
als Hinweis. Das Team dreht am Regler. Millimeterarbeit und endlose Diskussionen.

- **Core Loop:** Team A zieht Achse + geheime Zielposition → Hinweisgeber tippt einen Begriff → Team ratet per Slider → Abweichung = Punkte. Dann Team B.
- **Runde:** ~45 s, 8–10 Runden.
- **Modi:** **2v2 ist das Optimum** (nutzt die bestehende Team-Einteilung), 2v1/3v1 geht, Solo sinnlos.
- **Scoring:** 4 Punkte im inneren Band, 3/2 in den äußeren, 0 daneben. Gegnerteam darf zusätzlich "links/rechts davon" tippen (+1) → hält das wartende Team im Spiel.
- **Daten:** ~120 **selbst geschriebene** deutsche Achsenpaare in `data/wellenlaenge.json`. Ein Abend Schreibarbeit, dafür null API-Abhängigkeit — und rechtlich sauber (keine fremden Kartentexte).
- **Umsetzung:** Slider-Widget (`<input type=range>` reicht, hübsch gestyled), Zielband nur an den Hinweisgeber senden — **niemals** an alle broadcasten (klassischer Cheat-Leak). Events: `wl:clue {text}`, `wl:guess {value}`, `wl:counter-guess {side}`.
- **Aufwand:** **M**
- **Risiken:** Zielposition darf nie im `game:state` an ratende Clients gehen → getrennte Payloads pro Rolle (wie `jeopardy` es bei Antworten macht). Achsenqualität entscheidet alles: vage Paare = frustig.

---

### 5. Meiern (Mäxchen) — Würfel-Bluff

**Pitch:** Würfeln, verdeckt ansehen, dem Nächsten eine Zahl **behaupten** —
wahr oder gelogen. Der glaubt oder deckt auf. Wer falsch liegt, verliert ein
Leben. Reines Pokerface, perfekt angetrunken.

- **Core Loop:** Aktiver Spieler würfelt geheim → behauptet einen Wert (muss höher sein als die Vorgabe) → nächster: glauben oder aufdecken → Verlierer verliert Leben.
- **Runde:** 10–20 s pro Zug, Spiel bis nur einer übrig ist (~5 Min).
- **Modi:** FFA 2–4 (2 ist schon gut, 4 ideal). Teams unpassend. Solo nein.
- **Scoring:** Letzter mit Leben gewinnt; Leaderboard nach Siegen.
- **Daten:** **Keine.** Server-RNG. Absolut null Datenbeschaffung.
- **Umsetzung:** Turn-basiert wie `connect4` (dessen Sitz-/Zug-Logik ist die Vorlage). Würfelergebnis nur an den aktiven Spieler (`socket.emit`, nicht `io.to`). Events: `mx:roll`, `mx:claim {value}`, `mx:believe`, `mx:reveal`.
- **Aufwand:** **S**
- **Risiken:** Regelvarianten sind regional verschieden ("21er", Mäxchen als Sonderwurf) → eine Variante festschreiben und im Lobby-Text erklären. Ohne Gesichter fehlt Bluff-Feeling → Reaktionszeit anzeigen ("David zögerte 4 s") als Ersatz-Tell. Nettes Detail.

---

### 6. Nur ein Wort — Kooperativ

**Pitch:** Einer rät, alle anderen geben **je einen** Hinweis-Begriff. Doppelte
Hinweise werden gestrichen — Absprache unmöglich, Gedankenlesen gefragt. Kein
Gegeneinander, sondern gemeinsamer Highscore.

- **Core Loop:** Geheimwort an alle außer den Rater → jeder tippt einen Hinweis → Server streicht Duplikate (normalisiert) → Rater sieht die Reste und hat einen Versuch.
- **Runde:** ~45 s, 13 Wörter (ein Durchlauf), Rater rotiert.
- **Modi:** **Kooperativ 3–4** (Highscore gegen sich selbst — willkommener Kontrast zum sonst kompetitiven Portal). Bei 2 zu dünn.
- **Scoring:** Team-Score 0–13. Ab 11: "Telepathisch". Bestwert der Gruppe persistent speichern.
- **Daten:** Deutsche Substantive — `data/galgenraten-words.json` (123 Wörter) als Startpunkt, auf ~500 erweitern. Ein Nachmittag Wortliste oder eine freie Liste von GitHub prüfen (Lizenz beachten).
- **Umsetzung:** Duplikat-Erkennung: lowercase, Umlaute falten, Levenshtein ≤1 — **die Funktion existiert schon in `verhext-handler.js`** und ist direkt wiederverwendbar. Events: `nw:clue`, `nw:guess`.
- **Aufwand:** **M** (viel geerbte Logik)
- **Risiken:** Rater darf das Wort nie sehen → rollengetrennte Payloads. Gestrichene Hinweise **nach** der Runde zeigen, das ist der Lacher.

---

### 7. Chronologie — "Was war zuerst?"

**Pitch:** Vier Ereignisse, vier Jahreszahlen — bring sie in die richtige
Reihenfolge. Erfindung der Glühbirne vs. Gründung von Coca-Cola vs. erste
Bundesliga-Saison. Jeder überschätzt sein Geschichtswissen.

- **Core Loop:** 4–5 Karten in zufälliger Reihenfolge → alle sortieren per Drag/Tap → Reveal mit echten Jahren und Quelle.
- **Runde:** 30–45 s, 8 Runden.
- **Modi:** FFA 2–4, Teams (gemeinsam sortieren), Solo als Lernmodus.
- **Scoring:** Punkte nach korrekten Paarbeziehungen (nicht alles-oder-nichts) → auch teilweise richtig lohnt. Perfekt = Bonus.
- **Daten:** Wikidata SPARQL (Jahreszahlen) + Wikipedia On-this-day (deutsch, verifiziert) → in `data/chronologie.json` vorbacken. Deutsche Ereignisse bevorzugen, das ist der Heimvorteil.
- **Umsetzung:** Sortier-UI ist der einzige neue Baustein — auf Mobile **keine** HTML5-Drag-API (unzuverlässig), stattdessen Hoch/Runter-Pfeile pro Karte oder Tap-zum-Tauschen. Events: `chr:submit {order}`.
- **Aufwand:** **M**
- **Risiken:** Datenqualität: "Gründungsjahr" ist oft strittig → immer die Wikidata-Quelle im Reveal anzeigen, dann gibt's keine Streitereien. Drag-and-Drop auf Touch ist die klassische Falle.

---

### 8. Wer bin ich? — Promi-Raten

**Pitch:** Jeder bekommt eine Person zugewiesen, die er selbst nicht sieht —
alle anderen schon. Mit Ja/Nein-Fragen die eigene Identität herausfinden.

- **Core Loop:** Server verteilt Personen → im Kreis stellt jeder eine Ja/Nein-Frage → die anderen antworten per Button (Ja/Nein/Weiß nicht, Mehrheit gilt) → wer sich sicher ist, ratet.
- **Runde:** Fragen à 20 s, Spiel ~8 Min.
- **Modi:** FFA 3–4 (braucht Publikum). Kein Solo.
- **Scoring:** Weniger Fragen = mehr Punkte. Falsch geraten = Strafe.
- **Daten:** **Bereits vorhanden!** `data/siblings-dating.json` (38 Paare = 76 Personen mit verifizierten Portraits) und `data/movies.json` (134 Schauspieler mit Bildern). Null neue Beschaffung.
- **Umsetzung:** Der Trick ist rein visuell: eigenes Portrait wird für den Betroffenen als `?` gerendert, für alle anderen normal → **rollenabhängiges Rendering derselben Runde**. Events: `wbi:ask {text}`, `wbi:answer {yes|no|unsure}`, `wbi:solve {name}`.
- **Aufwand:** **M**
- **Risiken:** Freitextfragen kann der Server nicht moderieren → Fairness liegt bei der Gruppe (bei 4 Freunden unkritisch). Zwingend `escapeHtml` auf Fragen. Reihum-Logik braucht einen Timeout, sonst blockiert ein abgelenkter Spieler alles.

---

### 9. Montagsmaler — Zeichnen & Raten

**Pitch:** Einer malt, die anderen tippen wild ins Chat-Feld. Der größte
Lacher-Garant überhaupt — und das aufwendigste Spiel der Liste.

- **Core Loop:** Maler bekommt ein Wort → zeichnet auf Canvas (Strokes live an alle) → andere tippen Vermutungen → wer richtig liegt, punktet zeitabhängig.
- **Runde:** 60–80 s, jeder malt 2×.
- **Modi:** FFA 3–4 (bei 2 dünn), Teams 2v2 (nur eigenes Team sieht das Wort).
- **Scoring:** Rater: früher = mehr Punkte. Maler: Punkte pro erfolgreichem Rater.
- **Daten:** Deutsche Begriffe, gleiche Wortliste wie "Nur ein Wort" (Substantive + Verben, nach Schwierigkeit gestaffelt).
- **Umsetzung:** **Das ist die L-Nummer.** Neu zu bauen: Canvas mit Pointer-Events (Touch **und** Maus), Stroke-Batching (nicht jeder `mousemove` als Socket-Event — auf ~20/s bündeln), Stroke-Historie im `gameData` für Reconnect-Replay (unser `room.lastState` reicht dafür **nicht**, Strokes müssen separat gepuffert werden), Undo, Farb-/Pinselwahl, Radiergummi. Events: `mm:stroke {points[]}`, `mm:clear`, `mm:guess`.
- **Aufwand:** **L**
- **Risiken:** Bandbreite bei unkomprimierten Strokes; Mobile-Zeichnen braucht `touch-action: none`, sonst scrollt die Seite beim Malen. Nahe-Treffer ("Fahrrad" vs "Farhrad") → Levenshtein-Toleranz wie in `verhext`. **Empfehlung: erst bauen, wenn 2–3 der S/M-Spiele laufen.**

---

### 10. Supermarkt-Duell — Zucker-Schock

**Pitch:** Zwei echte Supermarktprodukte. Welches hat mehr Zucker pro 100 g?
Welches den schlechteren Nutri-Score? Überraschend lehrreich, überraschend
lustig — und garantiert hat das noch keiner deiner Freunde gespielt.

- **Core Loop:** Zwei Produktbilder → Frage (Zucker / Kalorien / Nutri-Score) → alle tippen → Reveal mit echten Werten.
- **Runde:** 15 s, 12 Runden.
- **Modi:** FFA 2–4, Teams, Solo.
- **Scoring:** +1 pro Treffer, Bonus wenn man den Abstand grob schätzt (Zusatzmodus "Wie viel Gramm?" mit Toleranz).
- **Daten:** OpenFoodFacts (verifiziert, deutsche Barcodes vorhanden, ODbL-Lizenz → Attribution nötig). `scripts/fetch-produkte.js` zieht ~200 bekannte deutsche Produkte (Nutella, Capri-Sonne, Haribo…) mit Bild + Nährwerten nach `data/produkte.json`.
- **Umsetzung:** Layout **identisch** zu `siblings-dating` (zwei Karten, zwei Buttons) → wieder Copy-Paste. Events: `sm:vote {left|right}`.
- **Aufwand:** **M** (fast nur Datenaufbereitung)
- **Risiken:** OFF-Daten sind Community-gepflegt → Lücken/Fehler; beim Fetch auf Vollständigkeit filtern (`nutriments.sugars_100g` vorhanden, Bild vorhanden). Produktbilder sind teils schlecht freigestellt. **Markenlogos = fremde Marken** → nur die von OFF gelieferten Produktfotos verwenden, nichts selbst nachbauen.

---

### Ehrenwerte Erwähnungen (nicht in den Top 10)

| Idee | Warum nicht oben |
|---|---|
| **PLZ-Quiz Deutschland** (zippopotam verifiziert) | Solide, aber schmaler Spaß-Kern; als Modus in ein Geo-Quiz integrieren. |
| **Echtes GeoGuessr** | **Nicht baubar** — Street View braucht Key. Mit Commons-Fotos + Leaflet nur ein blasser Abklatsch. |
| **Tabu / Activity** | Braucht Sprechen/Pantomime → das Portal ersetzt keinen Tisch; als Karten-Generator (Tool!) sinnvoller. |
| **Werwolf** | Braucht ≥6 Spieler. Bei 4 kaputt. |
| **1-%-Quiz-Duell** | Reizvoll, aber inhaltlich zu nah am bestehenden Wissens-Quiz. |

---

## 4. Die 10 Tools — nach Nutzen-pro-Aufwand sortiert

### 🥇 1. Terminfinder — "Wann können alle?"

**Pitch:** Raster aus Tagen × Zeitfenstern, jeder pinselt seine Verfügbarkeit
rein, die Überlappung leuchtet auf. Ende der WhatsApp-Ping-Pong-Hölle.

- **Funktion:** Host legt Zeitraum an (z. B. nächste 2 Wochen, abends). Jeder markiert per Drag "kann". Heatmap zeigt, wo alle 4 grün sind, plus "bester Termin"-Vorschlag.
- **Für 4 feste Nutzer:** Kein Einladungs-Link, keine Anonymität nötig — jeder ist eingeloggt, Namen stehen direkt an den Zellen. Massive Vereinfachung gegenüber öffentlichen Tools.
- **Daten:** Eigener Store-Key `termine` (Muster wie `finanzamt` in `store.js`).
- **Umsetzung:** Kein Socket nötig — REST + Polling genügt (wie `finanzamt`/`spiele-liste`). Grid-Painting: `pointerdown` + `pointerenter`. Mobile: Zellen ≥44 px.
- **Aufwand:** **S–M**
- **Risiken:** Grid-Drag auf Touch braucht `touch-action: none`. Zeitzonen irrelevant (alle in DE) → nicht überengineeren.

---

### 🥈 2. Turnier-Modus & ELO-Leiter

**Pitch:** "Wer ist der Beste bei LVL³?" — endlich mit Beweis. Bracket oder
Round-Robin über die bestehenden Spiele, plus dauerhafte ELO-Wertung pro Spiel.

- **Funktion:** Turnier anlegen → Spiel wählen → Modus (K.o. bei 4 = 2 Halbfinals + Finale, oder Round-Robin jeder-gegen-jeden) → Ergebnisse werden **automatisch** aus dem laufenden Spiel übernommen. ELO pro Spiel + Gesamt.
- **Für 4 Nutzer:** 4er-Bracket ist trivial darstellbar; Round-Robin = 6 Partien.
- **Daten:** **Nutzt `server/stats.js`, das schon jedes Spielergebnis protokolliert** — die Datenbasis existiert bereits. Neuer Key `turniere`.
- **Umsetzung:** In `recordGameResult()` einhaken: läuft ein Turnier, Ergebnis dem Match zuordnen. ELO: Standardformel, K=32.
- **Aufwand:** **M**
- **Risiken:** Kopplung an alle 11 Spiele → sauber über den bestehenden Stats-Hook lösen, **nicht** jeden Handler anfassen. ELO bei nur 4 Spielern schwankt stark → K niedriger (16) oder erst ab 10 Partien anzeigen.

---

### 🥉 3. Filmabend-Entscheider

**Pitch:** Jeder wirft 2 Filme in den Topf, dann Duell-Voting (A oder B), bis
ein Gewinner übrig ist. Niemand muss mehr 40 Minuten durch Netflix scrollen.

- **Funktion:** Vorschläge sammeln → paarweise Duelle (jeder stimmt ab) → Sieger per Punkten. Plus **Veto-Modus**: jeder darf einen Film streichen.
- **Daten:** Optional TMDB (Key vorhanden als Option) für Poster/Beschreibung; ohne Key rein manuell — funktioniert auch.
- **Umsetzung:** Nah an `spiele-liste`, dessen CRUD-Muster wiederverwendbar ist.
- **Aufwand:** **S–M**
- **Risiken:** Ohne Poster wirkt es trocken → TMDB-Anbindung lohnt hier tatsächlich.

---

### 4. Zitate-Buch

**Pitch:** Das Archiv für die dümmsten Sätze, die je in der Gruppe gefallen
sind. Wer, wann, in welchem Kontext. In zwei Jahren das wertvollste Feature der
Seite.

- **Funktion:** Zitat + Urheber + Datum + Kontext eintragen. Reaktionen (😂), Suche, Filter pro Person, "Zitat des Tages" auf dem Dashboard.
- **Daten:** Store-Key `zitate`.
- **Umsetzung:** Simples CRUD nach `finanzamt`-Muster. **`escapeHtml` auf allem** (Freitext von Nutzern).
- **Aufwand:** **S**
- **Risiken:** Praktisch keine. Höchster emotionaler Ertrag pro Zeile Code im ganzen Dokument.

---

### 5. Wetten-Tracker

**Pitch:** "Wetten, dass Oskar das nicht schafft?" — Wette festhalten, Einsatz
(Bier, Geld, Ehre), Ablaufdatum, später Gewinner markieren. Mit Bilanz pro Person.

- **Funktion:** Wette anlegen (Beschreibung, Parteien, Einsatz, Frist) → Status offen/entschieden → Statistik "wer gewinnt am häufigsten".
- **Daten:** Store-Key `wetten`. Bier-Schulden können optional an `finanzamt` andocken.
- **Umsetzung:** CRUD + Status-Workflow.
- **Aufwand:** **S–M**
- **Risiken:** Wer entscheidet den Ausgang? → Beide Parteien müssen bestätigen, sonst "strittig". Klein halten, kein Schiedsgerichtsverfahren einbauen.

---

### 6. LVL³ Wrapped — Jahresrückblick

**Pitch:** Spotify-Wrapped für die Gruppe: meiste Siege, längste Streak,
schlechtester Song-Rater, meistgespieltes Spiel, "Bosse hat 47× bei Galgenraten
verloren". Einmal im Jahr Gold wert.

- **Funktion:** Animierte Story-Karten (durchtippen) mit Auswertungen aus `stats.json`.
- **Daten:** **`data/stats.json` sammelt schon alles.** Für mehr Tiefe müssten Handler zusätzliche Events loggen (z. B. Reaktionszeiten) — Ausbaustufe 2.
- **Umsetzung:** Reine Auswertung + Präsentation. Das Phantom-Design mit großer Typo ist dafür wie gemacht; GSAP ist schon eingebunden.
- **Aufwand:** **M**
- **Risiken:** Die aktuellen Stats sind grob (Siege/Punkte/Spiele) → ehrlich bleiben, keine Zahlen erfinden. Vorher ein paar Monate Daten sammeln lassen, sonst ist der Rückblick leer.

---

### 7. Entscheidungs-Roulette

**Pitch:** Ein Rad, beliebige Optionen, ein Klick. "Wer holt Nachschub?",
"Welches Spiel jetzt?" — Diskussion beendet.

- **Funktion:** Optionen eintippen (oder Preset "die 4 Namen" / "alle LVL³-Spiele") → Rad dreht animiert → Ergebnis. Historie der letzten Drehungen.
- **Daten:** Presets aus dem `GAMES`-Array und der Nutzerliste; keine Persistenz nötig.
- **Umsetzung:** Canvas- oder CSS-Rotation, `cubic-bezier`-Ausrollen. **Optional Socket:** Rad synchron bei allen drehen — großer Effekt, kleiner Aufwand.
- **Aufwand:** **S**
- **Risiken:** Fairness muss serverseitig gelost werden, wenn's synchron ist (sonst kann jeder Client "gewinnen" lassen).

---

### 8. Wer bringt was?

**Pitch:** Party-Packliste. Chips, Bier, HDMI-Kabel — jeder hakt ab, was er
mitbringt. Keine vier Packungen Tortilla-Chips mehr.

- **Funktion:** Event anlegen → Items sammeln → Item "übernehmen" (Name dran) → Restliste sichtbar. Vorlagen ("Grillabend", "Zocker-Nacht").
- **Daten:** Store-Key `bringliste`.
- **Umsetzung:** CRUD, sehr nah an `spiele-liste`.
- **Aufwand:** **S**
- **Risiken:** Keine. Gutes Aufwärm-Feature.

---

### 9. Ämter-Rotation

**Pitch:** Wer ist dran mit Gastgeben, Fahren, Aufräumen? Rotiert automatisch
und merkt sich, wer sich rausgewunden hat.

- **Funktion:** Ämter definieren → Rotationsreihenfolge → "erledigt" abhaken rückt weiter. Übersicht "wer war wie oft dran".
- **Daten:** Store-Key `aemter`.
- **Umsetzung:** Minimale Logik (Index-Rotation) + Historie.
- **Aufwand:** **S**
- **Risiken:** Nur nützlich, wenn es wirklich gepflegt wird — Dashboard-Widget "du bist dran" hilft.

---

### 10. Countdown-Board

**Pitch:** "Noch 12 Tage bis Festival." Gemeinsame Vorfreude als Zahl.

- **Funktion:** Events mit Datum, Live-Countdown, Sortierung nach Nähe, abgelaufene wandern ins Archiv. Dashboard-Widget für das nächste Event.
- **Daten:** Store-Key `events`. Optional open-meteo (verifiziert) für "Wetter am Grillabend" — nette Zutat.
- **Umsetzung:** Trivial, kein Socket.
- **Aufwand:** **S**
- **Risiken:** Keine.

---

### Weitere Tool-Ideen (Kurzliste)

| Idee | Aufwand | Notiz |
|---|---|---|
| **Umfragen/Polls** | S | Strawpoll-Ersatz; überschneidet sich mit Terminfinder + Filmabend. |
| **Tier-List-Maker** | M | Drag-Ranking (Pizzasorten, Filme) — Touch-Drag ist die Hürde. |
| **Trinkspiel-Regel-Generator** | S | Regel-Pool + Zufall; passt zur Zielgruppe. |
| **Tabu-Karten-Generator** | S | Begriff + Verbotene Wörter aus eigener Liste. |
| **Foto-Wall / Erinnerungen** | M | Speicher-Problem: Avatare zeigen schon, dass Base64-in-Redis nicht skaliert. |

---

## 5. Empfohlene Reihenfolge

**Phase 1 — schnelle Siege (je ein Abend):**
1. **Höher oder Tiefer** (S) — verifizierte Datenquelle, Layout kopierbar, endloser Nachschub
2. **Lügenbaron** (S–M) — nutzt vorhandene `questions.json`, höchster Lacherfaktor
3. **Zitate-Buch** (S) — bester emotionaler Ertrag pro Zeile
4. **Meiern** (S) — null Daten nötig

**Phase 2 — Substanz (je ein Wochenende):**
5. **Terminfinder** (S–M) — löst ein echtes Alltagsproblem
6. **Stadt Land Fluss** (M) — der deutsche Klassiker, den man erwartet
7. **Wellenlänge** (M) — das beste 2v2-Spiel der Liste
8. **Turnier-Modus** (M) — macht alle bestehenden Spiele wertvoller

**Phase 3 — Ausbau:**
9. Chronologie, Wer bin ich?, Supermarkt-Duell, Nur ein Wort
10. **Montagsmaler** (L) — erst wenn die Basis läuft
11. **LVL³ Wrapped** — wenn genug Statistik-Daten zusammengekommen sind

**Begründung der Reihenfolge:** Phase 1 sind vier Features, die zusammen
vermutlich weniger Zeit kosten als Jeopardy allein — und sofort spürbar sind.
Der Turnier-Modus steht bewusst nach mehreren neuen Spielen, weil er umso mehr
Wert schafft, je mehr Spiele es zu vergleichen gibt.

---

## 6. Technische Warnungen aus der Praxis dieses Repos

Diese Punkte sind keine Theorie — sie sind alle in diesem Projekt schon als
echte Bugs aufgetreten und behoben worden. Neue Spiele sollten sie nicht
wiederholen:

1. **Timer-Guards.** Jeder verzögerte Übergang braucht die Identitätsprüfung
   (`rooms.get(code) !== room || rm.gameData !== gd || !rm.started` → return).
   Ohne sie legt ein Restart mitten im Reveal den ganzen Prozess lahm.
2. **Away-Spieler.** "Warten bis alle geantwortet haben" muss Spieler im
   90-s-Reconnect-Fenster (`room.grace`) ausschließen, sonst blockiert ein
   Handy im Hintergrund die Runde bis zum Timeout.
3. **`escapeHtml` bei jedem Freitext.** Lügenbaron, Zitate, Wer-bin-ich-Fragen,
   Stadt-Land-Fluss-Antworten sind alle Nutzer-Input, der in `innerHTML` landet.
4. **Rollen-getrennte Payloads.** Geheimwörter/Zielpositionen/Würfel niemals im
   Broadcast an alle — `socket.emit` für den Wissenden, reduzierter State für
   die anderen. Sonst steht die Lösung in der Browser-Konsole.
5. **Cache-Buster.** Statische Assets laufen mit `maxAge=30d, immutable` — jede
   geänderte JS/CSS-Datei braucht ein hochgezähltes `?v=`, sonst erreicht der
   Fix niemanden.
6. **Keine großen Blobs in den Store.** Base64-Bilder in Redis/JSON sind schon
   einmal zum Problem geworden → Dateien über einen HTTP-Endpunkt mit
   Content-Hash ausliefern.
7. **Mobile zuerst denken.** Touch-Drag (Sortieren, Zeichnen, Grid-Painting)
   ist der häufigste Stolperstein: `touch-action: none`, Tap-Targets ≥44 px,
   Inputs 16 px gegen iOS-Zoom.

---

*Erstellt am 01.08.2026. API-Verfügbarkeit direkt geprüft; Format-Einschätzungen
aus eigenem Domänenwissen (siehe Quellenlage in Abschnitt 0).*
