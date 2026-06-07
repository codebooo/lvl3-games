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
      (title ? '<div class="toast-title">' + title + "</div>" : "") +
      '<div class="toast-msg">' + msg + "</div>";
    container.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  function renderPlayerList(el, players, host, scores) {
    if (!el) return;
    scores = scores || {};
    el.innerHTML = players.map(function (p) {
      return '<li class="player-item' + (p === host ? " is-host" : "") + '">' +
        '<div class="player-avatar" style="background:' + avatarColor(p) + '">' + avatarInitial(p) + '</div>' +
        '<span class="player-name">' + p + (p === host ? '<span class="host-badge">Host</span>' : "") + '</span>' +
        '<span class="player-score">' + (scores[p] || 0) + '</span>' +
        '</li>';
    }).join("");
  }

  function playSound(type) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
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
      g.gain.setValueAtTime(c.vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + c.dur);
      o.start();
      o.stop(ctx.currentTime + c.dur);
    } catch (e) {
      // AudioContext not available or blocked — fail silently
    }
  }

  // Skip HTTP polling handshake — go straight to WebSocket (saves 2 round trips)
  const socket = io({ transports: ["websocket", "polling"], upgrade: true });

  return {
    socket,
    getUsername,
    setUsername,
    checkAuth,
    showToast,
    formatTime,
    avatarColor,
    avatarInitial,
    renderPlayerList,
    playSound
  };
})();
