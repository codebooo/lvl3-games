/* ── Finanzamt ──────────────────────────────────────────────────── */
/* Shared debt calculator — Fick den Kapitalismus                    */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  var currentUser = '';

  // ── DOM refs ───────────────────────────────────────────────────
  var elDate     = document.getElementById('fa-date');
  var elAmount   = document.getElementById('fa-amount');
  var elPerson   = document.getElementById('fa-person');
  var elSubmit   = document.getElementById('fa-submit');
  var elBalances = document.getElementById('fa-balances');
  var elHistory  = document.getElementById('fa-history');

  // ── Helpers ────────────────────────────────────────────────────

  function fmtEur(n) {
    return Number(n).toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }

  function todayIso() {
    var d = new Date();
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  var esc = function (s) { return window.lvl3.escapeHtml(s); };

  // ── Populate person select ─────────────────────────────────────

  function populatePersonSelect(members) {
    elPerson.innerHTML = '<option value="">— Person —</option>';
    members.forEach(function (m) {
      if (m.toLowerCase() === currentUser.toLowerCase()) return;
      var opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      elPerson.appendChild(opt);
    });
  }

  // ── Render balances ────────────────────────────────────────────

  function renderBalances(balances) {
    if (!balances || balances.length === 0) {
      elBalances.innerHTML =
        '<div style="color:var(--green);font-size:15px;font-weight:600">Alles ausgeglichen.</div>';
      return;
    }
    var html = '<ul style="list-style:none;margin:0;padding:0">';
    balances.forEach(function (b) {
      html +=
        '<li style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px">' +
          '<span style="font-size:15px">' +
            '<strong style="color:var(--accent)">' + esc(b.from) + '</strong>' +
            ' muss ' +
            '<strong style="color:var(--text)">' + esc(b.to) + '</strong>' +
            ' zahlen' +
          '</span>' +
          '<span style="font-weight:700;font-size:16px;color:var(--gold);white-space:nowrap">' +
            fmtEur(b.amount) + ' €' +
          '</span>' +
        '</li>';
    });
    html += '</ul>';
    elBalances.innerHTML = html;
  }

  // ── Render history ─────────────────────────────────────────────

  function renderHistory(payments) {
    if (!payments || payments.length === 0) {
      elHistory.innerHTML =
        '<div style="color:var(--text-dim);font-size:14px">Noch keine Zahlungen.</div>';
      return;
    }
    var html = '<ul style="list-style:none;margin:0;padding:0">';
    payments.forEach(function (p) {
      var canDelete =
        p.payer.toLowerCase() === currentUser.toLowerCase() ||
        currentUser.toLowerCase() === 'bosse';
      html +=
        '<li style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
          '<span style="font-size:14px;color:var(--text-dim)">' +
            esc(fmtDate(p.date)) +
            ' &mdash; ' +
            '<strong style="color:var(--text)">' + esc(p.payer) + '</strong>' +
            ' zahlte ' +
            '<strong style="color:var(--gold)">' + fmtEur(p.amount) + ' €</strong>' +
            ' für ' +
            '<strong style="color:var(--text)">' + esc(p.person) + '</strong>' +
          '</span>' +
          (canDelete
            ? '<button class="btn btn-secondary btn-sm fa-delete-btn" data-id="' + esc(String(p.id)) + '" style="flex-shrink:0">Löschen</button>'
            : '') +
        '</li>';
    });
    html += '</ul>';
    elHistory.innerHTML = html;

    // Attach delete listeners
    elHistory.querySelectorAll('.fa-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        deletePayment(id);
      });
    });
  }

  // ── Fetch & render ─────────────────────────────────────────────

  function loadData() {
    fetch('/api/finanzamt')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        renderBalances(d.balances || []);
        // newest-first
        var sorted = (d.payments || []).slice().sort(function (a, b) {
          if (b.date < a.date) return -1;
          if (b.date > a.date) return 1;
          return (b.id > a.id) ? 1 : -1;
        });
        renderHistory(sorted);
      })
      .catch(function () {
        elBalances.innerHTML = '<div style="color:var(--accent);font-size:14px">Fehler beim Laden.</div>';
        elHistory.innerHTML  = '<div style="color:var(--accent);font-size:14px">Fehler beim Laden.</div>';
      });
  }

  function loadMembers() {
    fetch('/api/members')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        populatePersonSelect(d.members || []);
      })
      .catch(function () {
        // fail silently — select remains with placeholder only
      });
  }

  // ── Submit ─────────────────────────────────────────────────────

  function handleSubmit() {
    var date   = elDate.value;
    var amount = parseFloat(elAmount.value);
    var person = elPerson.value;

    if (!date) {
      window.lvl3.showToast('Bitte ein Datum angeben.', 'error');
      return;
    }
    if (!isFinite(amount) || amount <= 0) {
      window.lvl3.showToast('Bitte einen Betrag größer als 0 eingeben.', 'error');
      return;
    }
    if (!person) {
      window.lvl3.showToast('Bitte eine Person auswählen.', 'error');
      return;
    }

    elSubmit.disabled = true;

    fetch('/api/finanzamt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: date, amount: amount, person: person })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) {
          window.lvl3.showToast(d.error, 'error');
        } else {
          elAmount.value = '';
          window.lvl3.showToast('Eingetragen.', 'success');
          loadData();
        }
      })
      .catch(function () {
        window.lvl3.showToast('Netzwerkfehler.', 'error');
      })
      .then(function () {
        elSubmit.disabled = false;
      });
  }

  // ── Delete ─────────────────────────────────────────────────────

  function deletePayment(id) {
    fetch('/api/finanzamt/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) {
          window.lvl3.showToast(d.error, 'error');
        } else {
          window.lvl3.showToast('Gelöscht.', 'success');
          loadData();
        }
      })
      .catch(function () {
        window.lvl3.showToast('Netzwerkfehler.', 'error');
      });
  }

  // ── Event listeners ────────────────────────────────────────────

  elSubmit.addEventListener('click', handleSubmit);

  // ── Init ───────────────────────────────────────────────────────

  window.lvl3.checkAuth(function (d) {
    currentUser = d.username;
    elDate.value = todayIso();
    loadMembers();
    loadData();
  });

})();
