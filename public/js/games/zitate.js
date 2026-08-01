(function () {
  "use strict";

  var me = null;
  var quotes = [];
  var members = [];
  var filter = "ALLE";
  var EMOJIS = ["😂", "💀", "🤦", "🧠", "❤️"];

  function $(id) { return document.getElementById(id); }
  var esc = window.lvl3.escapeHtml;

  window.lvl3.checkAuth(function (d) {
    me = d.username;
    var av = $("user-avatar"), nm = $("user-name");
    if (av) { av.style.background = window.lvl3.avatarColor(me); av.textContent = window.lvl3.avatarInitial(me); }
    if (nm) nm.textContent = me;
    var dt = $("inp-date");
    if (dt) dt.value = new Date().toISOString().slice(0, 10);
    loadMembers();
    load();
  });

  // Die vier festen Nutzer kommen aus dem Leaderboard-Endpunkt; fällt der aus,
  // bleibt wenigstens der eigene Name wählbar.
  function loadMembers() {
    fetch("/api/leaderboard")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var names = {};
        if (d && Array.isArray(d.overall)) d.overall.forEach(function (e) { names[e.username] = true; });
        if (me) names[me] = true;
        members = Object.keys(names).sort();
        fillAuthors();
      })
      .catch(function () { members = me ? [me] : []; fillAuthors(); });
  }
  function fillAuthors() {
    var sel = $("inp-author");
    if (!sel) return;
    sel.innerHTML = members.map(function (m) {
      return '<option value="' + esc(m) + '">' + esc(m) + "</option>";
    }).join("");
  }

  function load() {
    fetch("/api/zitate")
      .then(function (r) { return r.ok ? r.json() : { quotes: [] }; })
      .then(function (d) {
        quotes = d.quotes || [];
        if (d.me) me = d.me;
        render();
      })
      .catch(function () { quotes = []; render(); });
  }

  function save() {
    var text = ($("inp-text") && $("inp-text").value || "").trim();
    var author = $("inp-author") ? $("inp-author").value : "";
    var context = ($("inp-context") && $("inp-context").value || "").trim();
    var date = $("inp-date") ? $("inp-date").value : "";
    var err = $("form-error");
    if (err) err.textContent = "";
    if (!text) { if (err) err.textContent = "Zitat darf nicht leer sein."; return; }
    if (!author) { if (err) err.textContent = "Bitte Person wählen."; return; }

    var btn = $("btn-save");
    if (btn) { btn.disabled = true; btn.textContent = "Speichert…"; }
    fetch("/api/zitate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, author: author, context: context, date: date })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) {
          if ($("inp-text")) $("inp-text").value = "";
          if ($("inp-context")) $("inp-context").value = "";
          window.lvl3.showToast("Ins Buch geschrieben.", "success");
          load();
        } else if (err) { err.textContent = (d && d.error) || "Fehler."; }
      })
      .catch(function () { if (err) err.textContent = "Verbindungsfehler."; })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = "Ins Buch schreiben"; }
      });
  }
  if ($("btn-save")) $("btn-save").addEventListener("click", save);

  function react(id, emoji) {
    fetch("/api/zitate/" + encodeURIComponent(id) + "/react", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji: emoji })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) {
          var q = quotes.find(function (x) { return x.id === id; });
          if (q) q.reactions = d.reactions || {};
          render();
        }
      })
      .catch(function () {});
  }

  function del(id) {
    fetch("/api/zitate/" + encodeURIComponent(id), { method: "DELETE" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) { window.lvl3.showToast("Gelöscht.", "success"); load(); }
        else window.lvl3.showToast((d && d.error) || "Fehler.", "error");
      })
      .catch(function () { window.lvl3.showToast("Verbindungsfehler.", "error"); });
  }

  function renderFilters() {
    var row = $("filter-row");
    if (!row) return;
    var authors = {};
    quotes.forEach(function (q) { authors[q.author] = (authors[q.author] || 0) + 1; });
    var cats = ["ALLE"].concat(Object.keys(authors).sort());
    row.innerHTML = "";
    cats.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "filter-chip" + (c === filter ? " on" : "");
      b.textContent = c === "ALLE" ? "Alle (" + quotes.length + ")" : c + " (" + authors[c] + ")";
      b.addEventListener("click", function () { filter = c; render(); });
      row.appendChild(b);
    });
  }

  function reactionSummary(q) {
    var counts = {};
    Object.keys(q.reactions || {}).forEach(function (u) {
      var e = q.reactions[u];
      counts[e] = (counts[e] || 0) + 1;
    });
    return counts;
  }

  function render() {
    renderFilters();

    // Zitat des Tages: stabil pro Kalendertag, nicht bei jedem Rendern neu.
    var box = $("qotd");
    if (box) {
      if (quotes.length) {
        var day = new Date().toISOString().slice(0, 10);
        var seed = 0;
        for (var i = 0; i < day.length; i++) seed = (seed * 31 + day.charCodeAt(i)) | 0;
        var pick = quotes[Math.abs(seed) % quotes.length];
        if ($("qotd-text")) $("qotd-text").textContent = pick.text;
        if ($("qotd-author")) $("qotd-author").textContent = "— " + pick.author + " · " + pick.date;
        box.classList.remove("hidden");
      } else box.classList.add("hidden");
    }

    var list = $("quote-list");
    var shown = filter === "ALLE" ? quotes : quotes.filter(function (q) { return q.author === filter; });
    if ($("quote-count")) $("quote-count").textContent = "(" + shown.length + ")";
    if ($("empty-state")) $("empty-state").classList.toggle("hidden", quotes.length > 0);
    if (!list) return;
    list.innerHTML = "";

    shown.forEach(function (q) {
      var card = document.createElement("div");
      card.className = "quote-card";

      var counts = reactionSummary(q);
      var mineEmoji = (q.reactions || {})[me];

      var reactHtml = EMOJIS.map(function (e) {
        var n = counts[e] || 0;
        return '<button class="react-btn' + (mineEmoji === e ? " on" : "") + '" data-emoji="' + e + '">' +
          e + (n ? '<span class="react-count">' + n + "</span>" : "") + "</button>";
      }).join("");

      card.innerHTML =
        '<div class="quote-text">' + esc(q.text) + "</div>" +
        '<div class="quote-author">— ' + esc(q.author) + "</div>" +
        (q.context ? '<div class="quote-ctx">' + esc(q.context) + "</div>" : "") +
        '<div class="quote-foot">' +
          '<div class="react-row">' + reactHtml + "</div>" +
          '<div class="quote-meta">' + esc(q.date) + " · eingetragen von " + esc(q.addedBy || "?") +
          (q.addedBy === me ? ' <button class="react-btn" data-del="1" title="Löschen" style="border-color:var(--bad);color:var(--bad)">×</button>' : "") +
          "</div>" +
        "</div>";

      card.querySelectorAll(".react-btn[data-emoji]").forEach(function (b) {
        b.addEventListener("click", function () { react(q.id, b.dataset.emoji); });
      });
      var d = card.querySelector('.react-btn[data-del]');
      if (d) d.addEventListener("click", function () { del(q.id); });

      list.appendChild(card);
    });
  }
}());
