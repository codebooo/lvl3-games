window.lvl3 = (function () {
  const AVATAR_COLORS = [
    "#e94560", "#7c3aed", "#06b6d4", "#22c55e",
    "#f59e0b", "#ec4899", "#14b8a6", "#f97316"
  ];

  function avatarColor(username) {
    let h = 0;
    for (let c of (username || "?")) {
      h = (h << 5) - h + c.charCodeAt(0) | 0;
    }
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function avatarInitial(username) {
    return (username || "?")[0].toUpperCase();
  }

  function getUsername() {
    return localStorage.getItem("lvl3_user");
  }

  function setUsername(u) {
    localStorage.setItem("lvl3_user", u);
  }

  function checkAuth(cb) {
    fetch("/api/me")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { window.location.href = "/"; return; }
        if (!d.passwordChanged) { window.location.href = "/"; return; }
        setUsername(d.username);
        if (cb) cb(d);
      })
      .catch(() => { window.location.href = "/"; });
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  // Shared AudioContext — reused across calls to avoid browser context cap
  let audioCtx = null;

  function playSound(type) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      const configs = {
        correct:      { freq: 880,  type: "sine",     dur: 0.15, vol: 0.3  },
        wrong:        { freq: 200,  type: "sawtooth",  dur: 0.2,  vol: 0.2  },
        "round-start":{ freq: 660,  type: "sine",     dur: 0.3,  vol: 0.25 },
        "game-start": { freq: 440,  type: "sine",     dur: 0.5,  vol: 0.3  },
        tick:         { freq: 1200, type: "sine",     dur: 0.05, vol: 0.1  }
      };
      const c = configs[type] || configs.tick;
      o.frequency.value = c.freq;
      o.type = c.type;
      g.gain.setValueAtTime(c.vol, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + c.dur);
      o.start();
      o.stop(audioCtx.currentTime + c.dur);
    } catch (e) {
      // AudioContext not available or blocked — fail silently
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(msg, type, title) {
    type = type || "info";
    title = title || "";
    let container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const t = document.createElement("div");
    t.className = "toast" + (type === "success" ? " success" : type === "error" ? " error" : "");
    t.innerHTML =
      (title ? '<div class="toast-title">' + escapeHtml(title) + "</div>" : "") +
      '<div class="toast-msg">' + escapeHtml(msg) + "</div>";
    container.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function applyAvatar(el, username, avatarUrl) {
    if (avatarUrl && typeof avatarUrl === "string" && avatarUrl.length > 0) {
      el.style.backgroundImage = "url(" + avatarUrl + ")";
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
      el.style.background = "";
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.style.backgroundSize = "";
      el.style.backgroundPosition = "";
      el.style.background = avatarColor(username);
      el.textContent = avatarInitial(username);
    }
  }

  // Latest { username: avatarUrl|null } map seen from any room:* payload.
  // renderPlayerList falls back to this when no explicit avatars arg is passed,
  // so existing 4-arg callers get custom pfps for free once the socket is live.
  let _avatars = {};

  function renderPlayerList(el, players, host, scores, avatars) {
    if (!el) return;
    scores = scores || {};
    avatars = avatars || _avatars || {};
    el.innerHTML = players.map(function (p) {
      var ep = escapeHtml(p);
      var url = avatars[p];
      var avatarHtml;
      if (url && typeof url === "string" && url.length > 0) {
        avatarHtml = '<div class="player-avatar" style="background-image:url(' + url +
          ');background-size:cover;background-position:center"></div>';
      } else {
        avatarHtml = '<div class="player-avatar" style="background:' + avatarColor(p) + '">' + avatarInitial(p) + '</div>';
      }
      return '<li class="player-item' + (p === host ? " is-host" : "") + '">' +
        avatarHtml +
        '<span class="player-name">' + ep + (p === host ? '<span class="host-badge">Host</span>' : "") + '</span>' +
        '<span class="player-score">' + (scores[p] || 0) + '</span>' +
        '</li>';
    }).join("");
  }

  // Lazy socket — only connect when first accessed (game pages access it during load)
  let _socket = null;

  return {
    get socket() {
      if (!_socket) {
        _socket = io({ transports: ["websocket", "polling"], upgrade: true });
        // Capture avatar maps from room lifecycle events so renderPlayerList
        // can render custom pfps without every game wiring the param through.
        ["room:created", "room:joined", "room:players", "room:host-changed"].forEach(function (ev) {
          _socket.on(ev, function (d) {
            if (d && d.avatars && typeof d.avatars === "object") _avatars = d.avatars;
          });
        });
      }
      return _socket;
    },
    getUsername,
    setUsername,
    checkAuth,
    showToast,
    formatTime,
    avatarColor,
    avatarInitial,
    applyAvatar,
    renderPlayerList,
    playSound,
    escapeHtml
  };
})();
