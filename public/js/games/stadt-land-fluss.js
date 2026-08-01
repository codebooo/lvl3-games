(function () {
  "use strict";

  var username = null, roomCode = null, isHost = false;
  var players = [], host = "", currentAvatars = {};
  var settings = { rounds: 5 };
  var categories = [];
  var timerInterval = null, timerLeft = 0, timerTotal = 1, timerElId = null;
  var stopped = false;
  var myChallenges = {};   // "user|cat" -> true (lokale Anzeige)

  // Vorschläge zum Antippen — der Host kann natürlich alles frei eintippen.
  var PRESETS = ["Stadt", "Land", "Fluss", "Tier", "Beruf", "Marke", "Film", "Band",
                 "Essen", "Getränk", "Pflanze", "Sportart", "Serie", "Videospiel",
                 "Körperteil", "Werkzeug", "Promi", "Automarke", "Fluchwort"];

  var socket = window.lvl3.socket;
  function $(id) { return document.getElementById(id); }
  var esc = window.lvl3.escapeHtml;

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var el = $("screen-" + name);
    if (el) el.classList.add("active");
  }

  window.lvl3.checkAuth(function (d) {
    username = d.username;
    var av = $("user-avatar"), nm = $("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(username); av.textContent = window.lvl3.avatarInitial(username); }
    if (nm) nm.textContent = username;
    socket.emit("auth", {});
  });

  window.createRoom = function () { socket.emit("room:create", { gameType: "stadt-land-fluss" }); };
  window.joinRoom = function () {
    var inp = $("join-code-input"), err = $("join-error");
    var code = (inp ? inp.value : "").toUpperCase().trim();
    if (!code) { if (err) err.textContent = "Bitte Code eingeben."; return; }
    if (err) err.textContent = "";
    socket.emit("room:join", { code: code });
  };
  window.pushSettings = function () {
    if (!isHost) return;
    var n = Math.min(15, Math.max(1, parseInt(($("inp-rounds") && $("inp-rounds").value) || 5, 10)));
    socket.emit("room:settings", { rounds: n });
  };
  window.startGame = function () {
    var e = $("start-error"); if (e) e.textContent = "";
    socket.emit("slf:start");
  };
  window.leaveRoom = function () { stopTimer(); socket.emit("room:leave"); roomCode = null; showScreen("join"); };
  window.playAgain = function () { socket.emit("slf:restart"); };

  var ji = $("join-code-input");
  if (ji) ji.addEventListener("keydown", function (e) { if (e.key === "Enter") window.joinRoom(); });

  socket.on("room:created", function (d) {
    roomCode = d.code; isHost = true; players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    settings = d.settings || settings; enterLobby();
  });
  socket.on("room:joined", function (d) {
    roomCode = d.code; isHost = d.isHost; players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    settings = d.settings || settings; enterLobby();
  });
  socket.on("room:error", function (d) { var e = $("join-error"); if (e) e.textContent = d.message || "Fehler"; });
  socket.on("game:error", function (d) {
    var msg = (d && d.message) || "Fehler";
    var ce = $("cat-error"), se = $("start-error");
    if (/Kategorie/i.test(msg) && ce) ce.textContent = msg;
    else if (se) se.textContent = msg;
  });
  socket.on("room:players", function (d) {
    players = d.players; host = d.host;
    if (d.avatars) currentAvatars = d.avatars;
    renderPlayers();
  });
  socket.on("room:host-changed", function (d) {
    host = d.host; players = d.players; isHost = (host === username);
    if (d.avatars) currentAvatars = d.avatars;
    renderPlayers(); updateHostUI(); renderCategories();
  });
  socket.on("room:settings-updated", function (d) { settings = d; applySettingsToUI(); });
  socket.on("slf:categories", function (d) {
    categories = d.categories || [];
    if ($("cat-error")) $("cat-error").textContent = "";
    renderCategories();
  });

  function enterLobby() {
    var c = $("room-code-display"); if (c) c.textContent = roomCode;
    renderPlayers(); updateHostUI(); applySettingsToUI();
    socket.emit("slf:get-categories");
    renderPresets();
    showScreen("lobby");
  }
  function renderPlayers(scores) {
    window.lvl3.renderPlayerList($("player-list"), players, host, scores || {}, currentAvatars);
  }
  function updateHostUI() {
    var b = $("btn-start"), p = $("host-settings"), g = $("guest-settings"), hc = $("cat-host-controls");
    if (isHost) {
      if (b) b.classList.remove("hidden");
      if (p) p.style.display = ""; if (g) g.style.display = "none";
      if (hc) hc.style.display = "";
    } else {
      if (b) b.classList.add("hidden");
      if (p) p.style.display = "none"; if (g) g.style.display = "";
      if (hc) hc.style.display = "none";
    }
  }
  function applySettingsToUI() {
    if ($("inp-rounds")) $("inp-rounds").value = settings.rounds || 5;
    var gi = $("guest-settings-display");
    if (gi) gi.textContent = "Runden: " + (settings.rounds || 5);
  }

  // ── Kategorie-Editor ──
  function renderCategories() {
    var list = $("cat-list");
    if ($("cat-count")) $("cat-count").textContent = "(" + categories.length + ")";
    if (!list) return;
    list.innerHTML = "";
    categories.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "cat-item";
      var name = document.createElement("span");
      name.className = "cat-name";
      name.textContent = c;
      row.appendChild(name);
      if (isHost) {
        var del = document.createElement("button");
        del.className = "cat-del";
        del.type = "button";
        del.textContent = "×";
        del.title = "Kategorie entfernen";
        del.addEventListener("click", function () {
          socket.emit("slf:remove-category", { name: c });
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    });
    if (!categories.length) {
      list.innerHTML = '<div class="hint" style="margin:0">Keine Kategorien — mindestens eine hinzufügen.</div>';
    }
  }
  function renderPresets() {
    var box = $("cat-presets");
    if (!box) return;
    box.innerHTML = "";
    PRESETS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "preset-chip";
      b.textContent = "+ " + p;
      b.addEventListener("click", function () { socket.emit("slf:add-category", { name: p }); });
      box.appendChild(b);
    });
  }
  function addCategory() {
    var inp = $("cat-new");
    var v = inp ? inp.value.trim() : "";
    if (!v) return;
    socket.emit("slf:add-category", { name: v });
    if (inp) { inp.value = ""; inp.focus(); }
  }
  if ($("btn-cat-add")) $("btn-cat-add").addEventListener("click", addCategory);
  if ($("cat-new")) $("cat-new").addEventListener("keydown", function (e) { if (e.key === "Enter") addCategory(); });
  if ($("btn-cat-reset")) $("btn-cat-reset").addEventListener("click", function () {
    socket.emit("slf:reset-categories");
  });

  // ── Game state ──
  socket.on("game:state", function (msg) {
    var phase = msg.phase, d = msg.data || {};
    if (phase === "lobby") { stopTimer(); isHost = (host === username); enterLobby(); return; }
    if (phase === "countdown") {
      showScreen("countdown");
      var n = $("countdown-num");
      if (n) { n.textContent = d.count; n.style.animation = "none"; void n.offsetWidth; n.style.animation = ""; }
      window.lvl3.playSound("game-start");
      return;
    }
    if (phase === "write")    { showWrite(d); return; }
    if (phase === "review")   { showReview(d); return; }
    if (phase === "result")   { showResult(d); return; }
    if (phase === "game-end") { showEnd(d); return; }
  });

  // ── Schreibphase ──
  function collectAnswers() {
    var out = {};
    categories.forEach(function (c, i) {
      var el = $("wf-" + i);
      out[c] = el ? el.value : "";
    });
    return out;
  }

  function showWrite(d) {
    stopTimer();
    stopped = false;
    categories = d.categories || categories;
    if ($("write-progress")) $("write-progress").textContent = "Runde " + d.roundNumber + " / " + d.totalRounds;
    if ($("write-letter")) $("write-letter").textContent = d.letter;
    if ($("write-waiting")) $("write-waiting").textContent = "";

    var grid = $("write-grid");
    if (grid) {
      grid.innerHTML = "";
      categories.forEach(function (c, i) {
        var row = document.createElement("div");
        row.className = "write-row";
        var lab = document.createElement("label");
        lab.setAttribute("for", "wf-" + i);
        lab.textContent = c;
        var inp = document.createElement("input");
        inp.className = "p-field";
        inp.id = "wf-" + i;
        inp.autocomplete = "off";
        inp.maxLength = 40;
        inp.placeholder = d.letter + "…";
        // Zwischenstand laufend an den Server, damit bei STOPP/Timeout nichts verloren geht
        inp.addEventListener("input", queueSubmit);
        row.appendChild(lab); row.appendChild(inp);
        grid.appendChild(row);
      });
      var first = $("wf-0");
      if (first) first.focus();
    }
    var sb = $("stop-btn");
    if (sb) { sb.disabled = false; sb.textContent = "STOPP — ich bin fertig!"; }
    renderPlayers(d.scores || {});
    startTimer(d.timeLeft || 90, "write-timer");
    window.lvl3.playSound("round-start");
    showScreen("write");
  }

  // Debounced: nicht bei jedem Tastendruck ein Socket-Event
  var submitTimer = null;
  function queueSubmit() {
    if (submitTimer) clearTimeout(submitTimer);
    submitTimer = setTimeout(function () {
      socket.emit("slf:submit", { answers: collectAnswers() });
    }, 600);
  }

  if ($("stop-btn")) $("stop-btn").addEventListener("click", function () {
    if (stopped) return;
    stopped = true;
    this.disabled = true;
    this.textContent = "Gestoppt!";
    if (submitTimer) clearTimeout(submitTimer);
    socket.emit("slf:stop", { answers: collectAnswers() });
  });

  socket.on("slf:submit-count", function (d) {
    if ($("write-waiting")) $("write-waiting").textContent = d.count + " / " + d.total + " haben etwas eingetippt";
  });

  // ── Review ──
  function showReview(d) {
    stopTimer();
    myChallenges = {};
    categories = d.categories || categories;
    if ($("rev-progress")) $("rev-progress").textContent = "Runde " + d.roundNumber + " / " + d.totalRounds;
    if ($("rev-stopped")) {
      $("rev-stopped").textContent = d.stoppedBy
        ? (d.stoppedBy + " hat gestoppt · Buchstabe " + d.letter)
        : ("Zeit abgelaufen · Buchstabe " + d.letter);
    }
    var fin = $("btn-finish-review");
    if (fin) fin.classList.toggle("hidden", !isHost);
    buildReviewTable(d);
    startTimer(d.timeLeft || 45, "rev-timer");
    showScreen("review");
  }

  function buildReviewTable(d) {
    var t = $("rev-table");
    if (!t) return;
    var plist = d.players || players;
    var html = "<thead><tr><th>Kategorie</th>";
    plist.forEach(function (p) { html += "<th>" + esc(p) + "</th>"; });
    html += "</tr></thead><tbody>";
    (d.categories || []).forEach(function (cat) {
      html += "<tr><th>" + esc(cat) + "</th>";
      plist.forEach(function (p) {
        var text = (d.answers && d.answers[p] && d.answers[p][cat]) || "";
        var key = p + "|" + cat;
        var mine = p === username;
        var can = !mine && !!text;
        var cls = "ans-cell" + (can ? " challengeable" : "");
        html += '<td class="' + cls + '" data-key="' + esc(key) + '" data-player="' + esc(p) +
          '" data-cat="' + esc(cat) + '">' +
          (text ? esc(text) : '<span class="ans-empty">—</span>') +
          '<span class="chal-count" data-count="' + esc(key) + '"></span></td>';
      });
      html += "</tr>";
    });
    html += "</tbody>";
    t.innerHTML = html;

    t.querySelectorAll(".ans-cell.challengeable").forEach(function (cell) {
      cell.addEventListener("click", function () {
        socket.emit("slf:challenge", {
          player: cell.dataset.player, category: cell.dataset.cat
        });
      });
    });
    applyChallenges(d.challenges || {});
  }

  function applyChallenges(ch) {
    var t = $("rev-table");
    if (!t) return;
    t.querySelectorAll(".ans-cell").forEach(function (cell) {
      var key = cell.dataset.key;
      var list = ch[key] || [];
      var cnt = cell.querySelector(".chal-count");
      if (cnt) cnt.textContent = list.length ? "✗" + list.length : "";
      cell.classList.toggle("challenged", list.indexOf(username) !== -1);
    });
  }
  socket.on("slf:challenges", function (d) { applyChallenges(d.challenges || {}); });

  if ($("btn-finish-review")) $("btn-finish-review").addEventListener("click", function () {
    this.disabled = true;
    socket.emit("slf:finish-review");
    var self = this;
    setTimeout(function () { self.disabled = false; }, 1500);
  });

  // ── Rundenergebnis ──
  function showResult(d) {
    stopTimer();
    if ($("res-kicker")) $("res-kicker").textContent =
      "Runde " + d.roundNumber + " / " + d.totalRounds + " ausgewertet";
    if ($("res-letter")) $("res-letter").textContent = d.letter;

    var t = $("res-table");
    if (t) {
      var plist = d.players || players;
      var html = "<thead><tr><th>Kategorie</th>";
      plist.forEach(function (p) { html += "<th>" + esc(p) + "</th>"; });
      html += "</tr></thead><tbody>";
      (d.categories || []).forEach(function (cat) {
        html += "<tr><th>" + esc(cat) + "</th>";
        plist.forEach(function (p) {
          var det = (d.detail && d.detail[p + "|" + cat]) || { text: "", points: 0, reason: "" };
          var txt = det.text ? esc(det.text) : '<span class="ans-empty">—</span>';
          var pts = '<span class="pts' + (det.points ? "" : " pts-0") + '"> ' +
            (det.points ? "+" + det.points : "0") + "</span>";
          var reason = det.reason ? '<div class="card-meta">' + esc(det.reason) + "</div>" : "";
          html += "<td>" + txt + pts + reason + "</td>";
        });
        html += "</tr>";
      });
      html += "<tr><th>Runde</th>";
      plist.forEach(function (p) {
        html += '<td><span class="pts">+' + ((d.roundPoints && d.roundPoints[p]) || 0) + "</span></td>";
      });
      html += "</tr><tr><th>Gesamt</th>";
      plist.forEach(function (p) {
        html += "<td><strong>" + ((d.scores && d.scores[p]) || 0) + "</strong></td>";
      });
      html += "</tr></tbody>";
      t.innerHTML = html;
    }
    renderPlayers(d.scores || {});
    var mine = (d.roundPoints && d.roundPoints[username]) || 0;
    window.lvl3.playSound(mine > 0 ? "correct" : "wrong");
    showScreen("result");
  }

  function showEnd(d) {
    stopTimer();
    var k = $("end-kicker"), w = $("end-winner-name"), s = $("end-sub");
    if (d.tie) {
      if (k) k.textContent = "Unentschieden";
      if (w) w.textContent = "Gleichstand!";
      if (s) s.textContent = "niemand gewinnt";
    } else {
      if (k) k.textContent = "Gewinner";
      if (w) w.textContent = d.winner || "—";
      if (s) s.textContent = "gewinnt das Spiel";
    }
    var el = $("end-final-scores");
    if (el) {
      el.innerHTML = (d.scores || []).map(function (row, i) {
        var medal = ["1.", "2.", "3."][i] || (i + 1) + ".";
        return '<div class="final-score-row"><span><span style="min-width:24px;display:inline-block">' +
          medal + "</span>" + esc(row.player) + "</span>" +
          '<span style="font-weight:700;color:var(--acc)">' + row.score + "</span></div>";
      }).join("");
    }
    var again = $("btn-play-again");
    if (again) again.classList.toggle("hidden", !isHost);
    showScreen("end");
  }

  // ── Timer ──
  function startTimer(secs, elId) {
    stopTimer();
    timerLeft = secs; timerTotal = secs; timerElId = elId;
    updateTimerUI();
    timerInterval = setInterval(function () {
      timerLeft -= 1; updateTimerUI();
      if (timerLeft <= 3 && timerLeft > 0) window.lvl3.playSound("tick");
      if (timerLeft <= 0) stopTimer();
    }, 1000);
  }
  function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
  function updateTimerUI() {
    var el = timerElId ? $(timerElId) : null;
    if (el) el.textContent = Math.max(0, timerLeft);
    var bar = $("timer-bar");
    if (bar) bar.style.width = Math.max(0, (timerLeft / timerTotal) * 100) + "%";
  }
}());
