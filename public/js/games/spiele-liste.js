/* ── Spiele-Liste ───────────────────────────────────────────────── */
/* Shared game wishlist with categories, random picker, and auth.   */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  var currentUser   = '';
  var allItems      = [];
  var activeFilter  = 'alle';
  var activeCat     = 'pc';
  var isSpinning    = false;

  // ── DOM refs ───────────────────────────────────────────────────
  var elName        = document.getElementById('sl-name');
  var elCatGroup    = document.getElementById('sl-cat-group');
  var elSteamGroup  = document.getElementById('sl-steam-group');
  var elSteam       = document.getElementById('sl-steam');
  var elPlaytime    = document.getElementById('sl-playtime');
  var elMinPlayers  = document.getElementById('sl-minplayers');
  var elNotes       = document.getElementById('sl-notes');
  var elAddBtn      = document.getElementById('sl-add-btn');
  var elFilterTabs  = document.getElementById('sl-filter-tabs');
  var elListInner   = document.getElementById('sl-list-inner');
  var elRandomBtn   = document.getElementById('sl-random-btn');
  var elRandomBanner = document.getElementById('sl-random-banner');
  var elRandomName  = document.getElementById('sl-random-name');

  // ── Helpers ────────────────────────────────────────────────────
  var esc = window.lvl3 && window.lvl3.escapeHtml
    ? window.lvl3.escapeHtml
    : function (s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

  function toast(msg, type) {
    if (window.lvl3 && window.lvl3.showToast) {
      window.lvl3.showToast(msg, type || 'info');
    }
  }

  function isBosse() {
    return currentUser.toLowerCase() === 'bosse';
  }

  function canDelete(item) {
    return isBosse() || (item.addedBy && item.addedBy === currentUser);
  }

  // ── Category metadata ──────────────────────────────────────────
  var CAT_META = {
    pc:         { label: 'PC (Steam)', badgeClass: 'badge badge-pc' },
    web:        { label: 'Web',        badgeClass: 'badge badge-web' },
    brettspiel: { label: 'Brettspiel', badgeClass: 'badge badge-brettspiel' }
  };

  function catLabel(cat) {
    return (CAT_META[cat] && CAT_META[cat].label) || cat;
  }

  function catBadgeClass(cat) {
    return (CAT_META[cat] && CAT_META[cat].badgeClass) || 'badge';
  }

  // ── Segmented category buttons ─────────────────────────────────
  var catBtns = elCatGroup ? elCatGroup.querySelectorAll('.seg-btn') : [];

  function setActiveCat(val) {
    activeCat = val;
    for (var i = 0; i < catBtns.length; i++) {
      var btn = catBtns[i];
      if (btn.getAttribute('data-value') === val) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    // Show/hide steam link field
    if (elSteamGroup) {
      elSteamGroup.style.display = (val === 'pc') ? '' : 'none';
    }
  }

  for (var ci = 0; ci < catBtns.length; ci++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        setActiveCat(btn.getAttribute('data-value'));
      });
    })(catBtns[ci]);
  }

  // Init: pc is default, so steam field visible
  setActiveCat('pc');

  // ── Filter tabs ────────────────────────────────────────────────
  var filterBtns = elFilterTabs ? elFilterTabs.querySelectorAll('.filter-tab') : [];

  function setActiveFilter(val) {
    activeFilter = val;
    for (var fi = 0; fi < filterBtns.length; fi++) {
      var fb = filterBtns[fi];
      if (fb.getAttribute('data-filter') === val) {
        fb.classList.add('active');
        fb.setAttribute('aria-selected', 'true');
      } else {
        fb.classList.remove('active');
        fb.setAttribute('aria-selected', 'false');
      }
    }
    renderList();
    // Clear random banner when filter changes
    hideBanner();
  }

  for (var fi = 0; fi < filterBtns.length; fi++) {
    (function (fb) {
      fb.addEventListener('click', function () {
        setActiveFilter(fb.getAttribute('data-filter'));
      });
    })(filterBtns[fi]);
  }

  // ── Filtered items ─────────────────────────────────────────────
  function getFiltered() {
    if (activeFilter === 'alle') return allItems.slice();
    return allItems.filter(function (item) {
      return item.category === activeFilter;
    });
  }

  // ── Render list ────────────────────────────────────────────────
  function renderList() {
    var items = getFiltered();

    if (!items.length) {
      elListInner.innerHTML =
        '<div class="empty-state">' +
        '<strong>Keine Einträge</strong>' +
        (activeFilter !== 'alle'
          ? 'Noch keine Spiele in dieser Kategorie.'
          : 'Fügt das erste Spiel hinzu!') +
        '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += renderEntry(items[i]);
    }
    elListInner.innerHTML = html;

    // Attach delete listeners
    var delBtns = elListInner.querySelectorAll('.sl-del-btn');
    for (var d = 0; d < delBtns.length; d++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          deleteItem(id);
        });
      })(delBtns[d]);
    }
  }

  function renderEntry(item) {
    var badgeClass = catBadgeClass(item.category);
    var label      = catLabel(item.category);
    var safeName   = esc(item.name || '');
    var safeAdded  = esc(item.addedBy || '');
    var safeNotes  = esc(item.notes || '');
    var safeTime   = esc(item.playtime || '');
    var safeSteam  = esc(item.steamUrl || '');

    var steamHtml = '';
    if (item.category === 'pc' && item.steamUrl && /^https?:\/\//i.test(item.steamUrl)) {
      steamHtml = ' <a href="' + safeSteam + '" target="_blank" rel="noopener noreferrer" class="steam-link">Steam &#8599;</a>';
    }

    var meta = '<span class="' + badgeClass + '">' + esc(label) + '</span>';
    if (item.playtime) {
      meta += '<span class="meta-dot">·</span><span>' + safeTime + '</span>';
    }
    if (item.minPlayers) {
      meta += '<span class="meta-dot">·</span><span>Min. ' + esc(String(item.minPlayers)) + ' Spieler</span>';
    }
    if (item.addedBy) {
      meta += '<span class="meta-dot">·</span><span style="color:var(--text-muted)">von ' + safeAdded + '</span>';
    }

    var notesHtml = '';
    if (item.notes) {
      notesHtml = '<div class="spiele-notes">' + safeNotes + '</div>';
    }

    var deleteHtml = '';
    if (canDelete(item)) {
      deleteHtml =
        '<button type="button" class="btn btn-danger btn-sm sl-del-btn" ' +
        'data-id="' + esc(String(item.id)) + '" ' +
        'aria-label="Eintrag löschen: ' + safeName + '">' +
        'Löschen</button>';
    }

    return (
      '<div class="spiele-entry" data-id="' + esc(String(item.id)) + '" data-cat="' + esc(item.category || '') + '">' +
        '<div class="spiele-entry-body">' +
          '<div class="spiele-entry-name">' + safeName + steamHtml + '</div>' +
          '<div class="spiele-meta">' + meta + '</div>' +
          notesHtml +
        '</div>' +
        '<div class="spiele-entry-actions">' + deleteHtml + '</div>' +
      '</div>'
    );
  }

  // ── API calls ──────────────────────────────────────────────────
  function fetchList() {
    fetch('/api/playlist')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        allItems = Array.isArray(data.items) ? data.items : [];
        renderList();
      })
      .catch(function () {
        toast('Fehler beim Laden der Liste.', 'error');
        elListInner.innerHTML =
          '<div class="empty-state"><strong>Fehler</strong>Liste konnte nicht geladen werden.</div>';
      });
  }

  function addItem() {
    var name = elName.value.trim();
    if (!name) {
      toast('Bitte einen Spielnamen eingeben.', 'error');
      elName.focus();
      return;
    }
    if (!activeCat) {
      toast('Bitte eine Kategorie wählen.', 'error');
      return;
    }

    var steamUrl = '';
    if (activeCat === 'pc') {
      steamUrl = elSteam.value.trim();
      if (steamUrl && !/^https?:\/\//i.test(steamUrl)) {
        toast('Steam-Link muss mit http:// oder https:// beginnen.', 'error');
        elSteam.focus();
        return;
      }
    }

    var payload = {
      name:       name,
      category:   activeCat,
      playtime:   elPlaytime.value.trim(),
      minPlayers: elMinPlayers.value ? parseInt(elMinPlayers.value, 10) : null,
      notes:      elNotes.value.trim(),
      steamUrl:   steamUrl
    };

    elAddBtn.disabled = true;

    fetch('/api/playlist', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          toast(data.error, 'error');
        } else {
          clearForm();
          fetchList();
          toast('Hinzugefügt.');
        }
      })
      .catch(function () {
        toast('Fehler beim Hinzufügen.', 'error');
      })
      .then(function () {
        elAddBtn.disabled = false;
      });
  }

  function deleteItem(id) {
    fetch('/api/playlist/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          toast(data.error, 'error');
        } else {
          fetchList();
          toast('Gelöscht.');
          hideBanner();
        }
      })
      .catch(function () {
        toast('Fehler beim Löschen.', 'error');
      });
  }

  // ── Form helpers ───────────────────────────────────────────────
  function clearForm() {
    elName.value = '';
    elPlaytime.value = '';
    elMinPlayers.value = '';
    elNotes.value = '';
    elSteam.value = '';
    setActiveCat('pc');
  }

  // ── Random picker ──────────────────────────────────────────────
  function hideBanner() {
    elRandomBanner.classList.remove('visible');
    elRandomName.textContent = '';
    // Remove winner highlights
    var winners = elListInner.querySelectorAll('.random-winner');
    for (var w = 0; w < winners.length; w++) {
      winners[w].classList.remove('random-winner');
    }
  }

  function pickRandom() {
    if (isSpinning) return;

    var items = getFiltered();
    if (!items.length) {
      toast('Liste ist leer.', 'error');
      return;
    }

    // Get entry DOM nodes in current filtered order
    var entryNodes = elListInner.querySelectorAll('.spiele-entry');
    if (!entryNodes.length) {
      toast('Liste ist leer.', 'error');
      return;
    }

    // Clear previous winner
    hideBanner();

    isSpinning = true;
    elRandomBtn.disabled = true;

    // Build index list of entry nodes
    var nodeList = [];
    for (var n = 0; n < entryNodes.length; n++) {
      nodeList.push(entryNodes[n]);
    }

    var totalSteps  = 14;            // number of highlight flashes
    var baseDelay   = 60;            // ms for first step
    var decelFactor = 1.22;          // each step gets this much slower
    var step        = 0;
    var lastNode    = null;

    // Choose the final winner in advance
    var winnerIdx  = Math.floor(Math.random() * nodeList.length);
    var winnerNode = nodeList[winnerIdx];
    var winnerName = items[winnerIdx] ? items[winnerIdx].name : winnerNode.querySelector('.spiele-entry-name').textContent;

    function doStep() {
      // Remove highlight from last
      if (lastNode) {
        lastNode.classList.remove('random-highlight');
      }

      if (step < totalSteps - 1) {
        // Pick a random node for this flash (avoid same as last when possible)
        var idx;
        if (nodeList.length > 1) {
          do {
            idx = Math.floor(Math.random() * nodeList.length);
          } while (nodeList[idx] === lastNode);
        } else {
          idx = 0;
        }
        var node = nodeList[idx];
        node.classList.add('random-highlight');
        // Scroll into view gently
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        lastNode = node;
        step++;
        var delay = Math.round(baseDelay * Math.pow(decelFactor, step));
        setTimeout(doStep, delay);
      } else {
        // Final step — land on the pre-chosen winner
        winnerNode.classList.add('random-winner');
        winnerNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Show banner
        elRandomName.textContent = winnerName;
        elRandomBanner.classList.add('visible');

        isSpinning = false;
        elRandomBtn.disabled = false;
      }
    }

    setTimeout(doStep, baseDelay);
  }

  // ── Event listeners ────────────────────────────────────────────
  elAddBtn.addEventListener('click', addItem);

  elName.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addItem();
  });

  elRandomBtn.addEventListener('click', pickRandom);

  // ── Init ───────────────────────────────────────────────────────
  window.lvl3.checkAuth(function (d) {
    currentUser = (d && d.username) ? d.username : '';
    fetchList();
  });

})();
