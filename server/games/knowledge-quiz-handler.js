"use strict";

const https = require("https");

// ─── Hardcoded fallback questions ────────────────────────────────────────────
const FALLBACK_QUESTIONS = {
  easy: [
    { q: "What color do you get when you mix red and blue?", a: "Purple", options: ["Purple", "Green", "Orange", "Brown"], difficulty: "easy", category: "General" },
    { q: "How many sides does a triangle have?", a: "3", options: ["3", "4", "5", "6"], difficulty: "easy", category: "Math" },
    { q: "What is the capital of France?", a: "Paris", options: ["Paris", "London", "Berlin", "Madrid"], difficulty: "easy", category: "Geography" },
    { q: "How many legs does a spider have?", a: "8", options: ["6", "8", "10", "12"], difficulty: "easy", category: "Biology" },
    { q: "What planet is known as the Red Planet?", a: "Mars", options: ["Mars", "Venus", "Jupiter", "Saturn"], difficulty: "easy", category: "Science" },
    { q: "How many continents are there on Earth?", a: "7", options: ["5", "6", "7", "8"], difficulty: "easy", category: "Geography" },
    { q: "What is H2O more commonly known as?", a: "Water", options: ["Water", "Salt", "Oxygen", "Carbon"], difficulty: "easy", category: "Science" },
    { q: "Which animal is known as man's best friend?", a: "Dog", options: ["Dog", "Cat", "Horse", "Rabbit"], difficulty: "easy", category: "Animals" },
    { q: "How many days are in a week?", a: "7", options: ["5", "6", "7", "8"], difficulty: "easy", category: "General" },
    { q: "What is the largest ocean on Earth?", a: "Pacific", options: ["Pacific", "Atlantic", "Indian", "Arctic"], difficulty: "easy", category: "Geography" },
    { q: "What color is the sky on a clear day?", a: "Blue", options: ["Blue", "Green", "Yellow", "White"], difficulty: "easy", category: "General" },
    { q: "How many months are in a year?", a: "12", options: ["10", "11", "12", "13"], difficulty: "easy", category: "General" },
    { q: "What is 5 × 5?", a: "25", options: ["20", "25", "30", "35"], difficulty: "easy", category: "Math" },
    { q: "Which planet is closest to the Sun?", a: "Mercury", options: ["Mercury", "Venus", "Earth", "Mars"], difficulty: "easy", category: "Science" },
    { q: "What is the fastest land animal?", a: "Cheetah", options: ["Cheetah", "Lion", "Horse", "Ostrich"], difficulty: "easy", category: "Animals" },
    { q: "How many hours are in a day?", a: "24", options: ["12", "20", "24", "48"], difficulty: "easy", category: "General" },
    { q: "What language is spoken in Brazil?", a: "Portuguese", options: ["Spanish", "Portuguese", "French", "English"], difficulty: "easy", category: "Geography" },
    { q: "What is the boiling point of water in Celsius?", a: "100", options: ["90", "95", "100", "110"], difficulty: "easy", category: "Science" },
    { q: "Which fruit is yellow and curved?", a: "Banana", options: ["Banana", "Apple", "Grape", "Peach"], difficulty: "easy", category: "General" },
    { q: "How many zeros are in one million?", a: "6", options: ["4", "5", "6", "7"], difficulty: "easy", category: "Math" }
  ],
  normal: [
    { q: "What is the capital of Australia?", a: "Canberra", options: ["Sydney", "Melbourne", "Canberra", "Brisbane"], difficulty: "normal", category: "Geography" },
    { q: "Who painted the Mona Lisa?", a: "Leonardo da Vinci", options: ["Michelangelo", "Leonardo da Vinci", "Raphael", "Botticelli"], difficulty: "normal", category: "Art" },
    { q: "What is the chemical symbol for gold?", a: "Au", options: ["Au", "Ag", "Fe", "Cu"], difficulty: "normal", category: "Science" },
    { q: "How many bones are in the adult human body?", a: "206", options: ["186", "196", "206", "216"], difficulty: "normal", category: "Biology" },
    { q: "In what year did World War II end?", a: "1945", options: ["1943", "1944", "1945", "1946"], difficulty: "normal", category: "History" },
    { q: "What is the largest country by area?", a: "Russia", options: ["Canada", "USA", "China", "Russia"], difficulty: "normal", category: "Geography" },
    { q: "Which element has the atomic number 1?", a: "Hydrogen", options: ["Helium", "Hydrogen", "Lithium", "Carbon"], difficulty: "normal", category: "Science" },
    { q: "Who wrote Romeo and Juliet?", a: "Shakespeare", options: ["Dickens", "Shakespeare", "Austen", "Hemingway"], difficulty: "normal", category: "Literature" },
    { q: "How many players are on a standard soccer team?", a: "11", options: ["9", "10", "11", "12"], difficulty: "normal", category: "Sports" },
    { q: "What is the currency of Japan?", a: "Yen", options: ["Won", "Yuan", "Yen", "Baht"], difficulty: "normal", category: "Geography" },
    { q: "What is the speed of light in km/s (approx)?", a: "300,000", options: ["150,000", "200,000", "300,000", "450,000"], difficulty: "normal", category: "Science" },
    { q: "Which country hosted the 2016 Summer Olympics?", a: "Brazil", options: ["China", "UK", "Brazil", "Japan"], difficulty: "normal", category: "Sports" },
    { q: "What is the tallest mountain on Earth?", a: "Everest", options: ["K2", "Everest", "Kangchenjunga", "Denali"], difficulty: "normal", category: "Geography" },
    { q: "Who invented the telephone?", a: "Alexander Graham Bell", options: ["Thomas Edison", "Nikola Tesla", "Alexander Graham Bell", "Guglielmo Marconi"], difficulty: "normal", category: "History" },
    { q: "What is the square root of 144?", a: "12", options: ["11", "12", "13", "14"], difficulty: "normal", category: "Math" },
    { q: "In which continent is Egypt located?", a: "Africa", options: ["Asia", "Africa", "Europe", "Middle East"], difficulty: "normal", category: "Geography" },
    { q: "What gas do plants absorb during photosynthesis?", a: "Carbon Dioxide", options: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], difficulty: "normal", category: "Biology" },
    { q: "Who was the first person to walk on the Moon?", a: "Neil Armstrong", options: ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "John Glenn"], difficulty: "normal", category: "History" },
    { q: "What is the largest organ in the human body?", a: "Skin", options: ["Liver", "Heart", "Skin", "Lungs"], difficulty: "normal", category: "Biology" },
    { q: "Which programming language was created by Guido van Rossum?", a: "Python", options: ["Ruby", "Java", "Python", "Perl"], difficulty: "normal", category: "Technology" }
  ],
  hard: [
    { q: "What is the Planck constant approximately equal to (in J·s)?", a: "6.626 × 10⁻³⁴", options: ["6.626 × 10⁻³⁴", "3.14 × 10⁻³²", "9.109 × 10⁻³¹", "1.602 × 10⁻¹⁹"], difficulty: "hard", category: "Physics" },
    { q: "In which year was the Magna Carta signed?", a: "1215", options: ["1066", "1215", "1415", "1517"], difficulty: "hard", category: "History" },
    { q: "What is the rarest blood type?", a: "AB-", options: ["O-", "B-", "A-", "AB-"], difficulty: "hard", category: "Biology" },
    { q: "Which country has the most UNESCO World Heritage Sites?", a: "Italy", options: ["China", "Spain", "France", "Italy"], difficulty: "hard", category: "Geography" },
    { q: "What is the integral of 1/x?", a: "ln|x| + C", options: ["x² + C", "1/x² + C", "ln|x| + C", "e^x + C"], difficulty: "hard", category: "Math" },
    { q: "Who developed the theory of general relativity?", a: "Albert Einstein", options: ["Isaac Newton", "Niels Bohr", "Albert Einstein", "Max Planck"], difficulty: "hard", category: "Science" },
    { q: "What is the capital of Kazakhstan?", a: "Astana", options: ["Almaty", "Astana", "Tashkent", "Bishkek"], difficulty: "hard", category: "Geography" },
    { q: "In Greek mythology, who is the god of the sea?", a: "Poseidon", options: ["Zeus", "Ares", "Hermes", "Poseidon"], difficulty: "hard", category: "Mythology" },
    { q: "What is the chemical formula for sulfuric acid?", a: "H₂SO₄", options: ["H₂SO₄", "HCl", "HNO₃", "H₃PO₄"], difficulty: "hard", category: "Chemistry" },
    { q: "Who wrote 'Thus Spoke Zarathustra'?", a: "Nietzsche", options: ["Hegel", "Kant", "Nietzsche", "Schopenhauer"], difficulty: "hard", category: "Philosophy" },
    { q: "What is the smallest prime number?", a: "2", options: ["0", "1", "2", "3"], difficulty: "hard", category: "Math" },
    { q: "Which war was ended by the Treaty of Westphalia?", a: "Thirty Years' War", options: ["Hundred Years' War", "Seven Years' War", "Thirty Years' War", "Napoleonic Wars"], difficulty: "hard", category: "History" },
    { q: "What is the approximate distance from Earth to the Moon in km?", a: "384,400 km", options: ["238,000 km", "384,400 km", "500,000 km", "1,000,000 km"], difficulty: "hard", category: "Science" },
    { q: "Which element has the highest melting point?", a: "Tungsten", options: ["Iron", "Platinum", "Tungsten", "Carbon"], difficulty: "hard", category: "Chemistry" },
    { q: "In computing, what does 'ASCII' stand for?", a: "American Standard Code for Information Interchange", options: ["Advanced System Control Interface Interface", "American Standard Code for Information Interchange", "Automated System for Character Input Implementation", "Applied Standard Computing Interface Index"], difficulty: "hard", category: "Technology" },
    { q: "What is Euler's number (e) approximately equal to?", a: "2.718", options: ["1.618", "2.718", "3.141", "1.414"], difficulty: "hard", category: "Math" },
    { q: "Who painted 'The Persistence of Memory'?", a: "Salvador Dalí", options: ["Pablo Picasso", "Salvador Dalí", "René Magritte", "Giorgio de Chirico"], difficulty: "hard", category: "Art" },
    { q: "What is the powerhouse of the cell?", a: "Mitochondria", options: ["Nucleus", "Ribosome", "Mitochondria", "Golgi apparatus"], difficulty: "hard", category: "Biology" },
    { q: "Which country invented paper?", a: "China", options: ["Egypt", "Mesopotamia", "China", "India"], difficulty: "hard", category: "History" },
    { q: "What does DNA stand for?", a: "Deoxyribonucleic Acid", options: ["Deoxyribonucleic Acid", "Dinitrogen Amino Acid", "Dynamic Nucleic Algorithm", "Dual Nucleotide Array"], difficulty: "hard", category: "Biology" }
  ]
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const TIMER_SECONDS = { easy: 20, normal: 15, hard: 10 };

// ─── Fetch more questions from Open Trivia DB ─────────────────────────────────
function fetchOpentdbQuestions(difficulty) {
  const diffMap = { easy: "easy", normal: "medium", hard: "hard" };
  const d = diffMap[difficulty] || "medium";
  const url = `https://opentdb.com/api.php?amount=50&difficulty=${d}&type=multiple`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.response_code !== 0 || !Array.isArray(json.results)) {
            return resolve([]);
          }
          const mapped = json.results.map((item) => {
            const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”");
            const correct = decode(item.correct_answer);
            const opts = shuffle([correct, ...item.incorrect_answers.map(decode)]);
            return {
              q: decode(item.question),
              a: correct,
              options: opts,
              difficulty,
              category: decode(item.category)
            };
          });
          resolve(mapped);
        } catch (e) {
          resolve([]);
        }
      });
    }).on("error", () => resolve([]));
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
module.exports = function (socket, io, rooms) {

  // Update settings (host only)
  socket.on("game:settings", ({ difficulty, pointsToWin, mode }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.username || room.started) return;
    if (difficulty) room.settings.difficulty = difficulty;
    if (pointsToWin) room.settings.pointsToWin = parseInt(pointsToWin, 10) || 10;
    if (mode) room.settings.mode = mode;
    io.to(socket.roomCode).emit("game:settings-updated", room.settings);
  });

  // Start game (host only)
  socket.on("game:start", async () => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || room.host !== socket.username || room.started) return;
    if (room.gameType !== "knowledge-quiz") return;

    room.started = true;

    // Load local questions
    let allQuestions;
    try {
      const qs = require("../../data/questions.json");
      allQuestions = qs.filter(q => q.difficulty === room.settings.difficulty);
      if (allQuestions.length < 10) throw new Error("Not enough");
    } catch (e) {
      allQuestions = FALLBACK_QUESTIONS[room.settings.difficulty] || FALLBACK_QUESTIONS.normal;
    }

    const questions = shuffle(allQuestions);

    // Init scores
    const scores = {};
    room.players.forEach(p => { scores[p] = 0; });

    room.gameData = {
      questions,
      index: 0,
      scores,
      mode: room.settings.mode,
      roundAnswers: {},
      phase: "idle",
      timerHandle: null,
      fetchedExtra: false
    };

    // Countdown 3 → 0
    io.to(code).emit("game:state", { phase: "countdown", data: { count: 3 } });

    let count = 3;
    const cdInterval = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(code).emit("game:state", { phase: "countdown", data: { count } });
      } else {
        clearInterval(cdInterval);
        startQuestion(code, room);
      }
    }, 1000);
  });

  // Receive answer
  socket.on("game:answer", ({ answer }) => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || !room.started) return;
    if (room.gameType !== "knowledge-quiz") return;

    const gd = room.gameData;
    if (!gd || gd.phase !== "question") return;
    if (!socket.username) return;

    const q = gd.questions[gd.index];
    if (!q) return;

    const isCorrect = normaliseAnswer(answer) === normaliseAnswer(q.a);

    if (gd.mode === "typing") {
      // Only the first correct answer wins the round
      if (isCorrect && !gd.roundWinner) {
        gd.roundWinner = socket.username;
        gd.scores[socket.username] = (gd.scores[socket.username] || 0) + 1;
        clearTimer(gd);

        io.to(code).emit("game:correct", {
          winner: socket.username,
          answer: q.a,
          scores: gd.scores
        });

        // Reveal after 1.5s
        setTimeout(() => revealAndNext(code, room), 1500);
      } else if (!isCorrect) {
        // Tell only this player they were wrong
        socket.emit("game:wrong", { answer: q.a });
      }
    } else {
      // MC mode — record each player's answer once
      if (gd.roundAnswers[socket.username] !== undefined) return;
      gd.roundAnswers[socket.username] = answer;

      // Check if all players have answered
      const allAnswered = room.players.every(p => gd.roundAnswers[p] !== undefined);
      if (allAnswered) {
        clearTimer(gd);
        doReveal(code, room);
      }
    }
  });

  // ─── Internal helpers ────────────────────────────────────────────────────────

  function normaliseAnswer(s) {
    return String(s).toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  }

  function clearTimer(gd) {
    if (gd.timerHandle) {
      clearTimeout(gd.timerHandle);
      gd.timerHandle = null;
    }
  }

  async function startQuestion(code, room) {
    const gd = room.gameData;
    if (!gd) return;

    // Fetch more questions from opentdb if running low
    if (!gd.fetchedExtra && gd.questions.length - gd.index < 5) {
      gd.fetchedExtra = true;
      const extra = await fetchOpentdbQuestions(room.settings.difficulty);
      if (extra.length > 0) {
        gd.questions = gd.questions.concat(shuffle(extra));
      }
    }

    const q = gd.questions[gd.index];
    if (!q) {
      // No more questions — end by scores
      return endGame(code, room);
    }

    gd.phase = "question";
    gd.roundAnswers = {};
    gd.roundWinner = null;

    const timeLimit = TIMER_SECONDS[room.settings.difficulty] || 15;

    io.to(code).emit("game:state", {
      phase: "question",
      data: {
        index: gd.index,
        total: gd.questions.length,
        question: q.q,
        category: q.category,
        options: gd.mode === "mc" ? q.options : null,
        timeLimit,
        mode: gd.mode,
        scores: gd.scores
      }
    });

    // Start server-side timer
    gd.timerHandle = setTimeout(() => {
      if (gd.phase !== "question") return;
      // Time's up
      if (gd.mode === "mc") {
        doReveal(code, room);
      } else {
        // Typing mode timeout — no winner
        gd.phase = "timeout";
        io.to(code).emit("game:state", {
          phase: "timeout",
          data: {
            correctAnswer: q.a,
            category: q.category,
            scores: gd.scores
          }
        });
        setTimeout(() => advanceRound(code, room), 2500);
      }
    }, timeLimit * 1000);
  }

  function doReveal(code, room) {
    const gd = room.gameData;
    if (!gd) return;
    if (gd.phase !== "question") return;
    gd.phase = "answer-reveal";

    const q = gd.questions[gd.index];

    // Award points in MC mode
    const pointsAwarded = {};
    if (gd.mode === "mc") {
      room.players.forEach(p => {
        if (normaliseAnswer(gd.roundAnswers[p] || "") === normaliseAnswer(q.a)) {
          gd.scores[p] = (gd.scores[p] || 0) + 1;
          pointsAwarded[p] = 1;
        }
      });
    } else {
      // Typing mode winner was already recorded in game:answer
      if (gd.roundWinner) {
        pointsAwarded[gd.roundWinner] = 1;
      }
    }

    io.to(code).emit("game:state", {
      phase: "answer-reveal",
      data: {
        correctAnswer: q.a,
        category: q.category,
        playerAnswers: gd.roundAnswers,
        pointsAwarded,
        scores: gd.scores
      }
    });

    setTimeout(() => advanceRound(code, room), 3000);
  }

  function revealAndNext(code, room) {
    doReveal(code, room);
  }

  function advanceRound(code, room) {
    const gd = room.gameData;
    if (!gd) return;

    gd.index++;

    // Check if someone has won
    const winner = Object.entries(gd.scores).find(([, s]) => s >= room.settings.pointsToWin);
    if (winner) {
      return endGame(code, room);
    }

    // Check if questions exhausted
    if (gd.index >= gd.questions.length) {
      return endGame(code, room);
    }

    startQuestion(code, room);
  }

  function endGame(code, room) {
    const gd = room.gameData;
    if (gd) {
      clearTimer(gd);
      gd.phase = "game-end";
    }

    // Sort by score
    const sorted = Object.entries(room.gameData.scores)
      .sort((a, b) => b[1] - a[1])
      .map(([name, score]) => ({ name, score }));

    room.started = false;

    io.to(code).emit("game:state", {
      phase: "game-end",
      data: {
        scores: room.gameData.scores,
        sorted,
        winner: sorted[0] ? sorted[0].name : null
      }
    });
  }
};
