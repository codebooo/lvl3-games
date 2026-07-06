# LVL³ Games

Private multiplayer party game website for Marlin, Oksar, David & Bosse.

## Quick Start (Local)

```bash
npm install
npm start
# → Open http://localhost:3000
```

## Deploy to Render.com (Free)

1. Push this folder to a **GitHub repository**
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Click **Deploy** — you'll get a free URL like `https://lvl3-games.onrender.com`

> **Note:** Free tier spins down after 15 min idle. First load after idle takes ~30 sec. Fine for 4 friends.

## Login Credentials

Each user must change their temporary password on first login.

| User | Temp Password |
|------|--------------|
| Marlin | `Marlinski` |
| Oksar | `Oskarihehe` |
| David | `davidus` |
| Bosse | `bossito` |

## Games

| Game | Type | Description |
|------|------|-------------|
| 🏷️ Logo Guesser | Multiplayer | Type brand names from logos — Easy / Normal / Hard |
| 🧠 Wissens-Quiz | Multiplayer | General knowledge, MC or free typing |
| 🚩 Flaggen-Quiz | Multiplayer | Country + state/province flags — up to "Bist du verrückt!?" |
| 🎬 Filme & Schauspieler | Multiplayer | Movies, series, and actors |
| ⛽ Benzinrechner | Tool | 2-stroke fuel mix calculator for mofas |
| 🎵 Song Guesser | Multiplayer | Guess songs from 10-second iTunes previews |
| 💞 Siblings or Dating | Multiplayer | Two faces — siblings or a couple? Secret vote, solo / 1v1 / 2v1 / 3v1 / 2v2 |

## Multiplayer — How It Works

1. One player creates a room → gets a 4-letter code
2. Others enter the code on the same game page to join
3. Host sets difficulty + points-to-win → clicks Start
4. First player to reach the points target wins

## Data Files

| File | Contents |
|------|----------|
| `data/questions.json` | 476 quiz questions (easy/normal/hard) |
| `data/flags.json` | 295 flags — countries + US states + Bundesländer + more |
| `data/logos.json` | 178 brand logos |
| `data/movies.json` | 269 movies/series/actors across 3 difficulty levels |
| `data/users.json` | User accounts (passwords stored as bcrypt hashes) |
| `data/siblings-dating.json` | 54 celebrity pairs (siblings vs. couples) with Wikipedia portraits |

## Tech Stack

- **Backend:** Node.js + Express + Socket.io
- **Auth:** express-session + bcryptjs
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **Songs:** iTunes Search API (free 30-sec previews)
- **Logos:** Clearbit Logo API
- **Flags:** Flagpedia CDN + Wikipedia SVGs
