/* theme.js — Lvl 3 Games theme switcher. Runs blocking in <head> to prevent FOUC. ES5-compatible. */
(function () {
  var STORAGE_KEY = 'lvl3_theme';
  var DEFAULT = 'dark';

  /* Stroke-based SVGs (currentColor) so they invert on hover and match the brutalist theme */
  var SUN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  var MOON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  function read() {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT; } catch (e) { return DEFAULT; }
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
  }

  function persist(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
  }

  function syncToggle(btn, theme) {
    if (!btn) return;
    /* sun shown when currently dark (click → go light); moon shown when currently light (click → go dark) */
    btn.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
    btn.setAttribute('aria-label', theme === 'dark' ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln');
  }

  /* Apply immediately — blocks paint so no flash */
  apply(read());

  /* Global accent — the launcher's palette picker writes 'lvl3-accent' (a hex
     string); apply it site-wide (incl. game pages) so themed accents follow the
     user's choice. Defaults to the brand red when unset. */
  var ACCENT_KEY = 'lvl3-accent';
  var ACCENT_DEFAULT = '#ff2244';

  function readAccent() {
    try { return localStorage.getItem(ACCENT_KEY) || ACCENT_DEFAULT; } catch (e) { return ACCENT_DEFAULT; }
  }

  function applyAccent(val) {
    var color = val || ACCENT_DEFAULT;
    document.documentElement.style.setProperty('--acc', color);
    document.documentElement.style.setProperty('--accent', color);
  }

  applyAccent(readAccent());

  /* Global click sound — the mixkit click WAV, decoded once, played site-wide. */
  var clickCtx, clickBuf;
  function ensureCtx() {
    clickCtx = clickCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (clickCtx.state === 'suspended') clickCtx.resume();
    return clickCtx;
  }
  // ponytail: fetch+decode once; each play is a throwaway BufferSource so clicks can overlap.
  (function loadClick() {
    try {
      fetch('/audio/click.wav').then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return ensureCtx().decodeAudioData(b); })
        .then(function (buf) { clickBuf = buf; })
        .catch(function () {});
    } catch (e) {}
  })();
  function lvl3Click(vol) {
    try {
      if (!clickBuf) return;
      var ctx = ensureCtx(), s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = clickBuf;
      g.gain.value = (vol == null ? 0.6 : vol);
      s.connect(g); g.connect(ctx.destination);
      s.start(0);
    } catch (e) {}
  }
  window.lvl3Click = lvl3Click;
  document.addEventListener('pointerdown', function () { lvl3Click(); }, true);
  window.lvl3AudioCtx = ensureCtx;

  /* Immersive "enter another dimension" sound — wavery, misty rising swell.
     Detuned shimmer sweep + filtered noise wash, ~2s. Returns its duration. */
  function lvl3Portal() {
    try {
      var ctx = ensureCtx(), t = ctx.currentTime, DUR = 2.0;
      var out = ctx.createGain(); out.gain.value = 0.9; out.connect(ctx.destination);

      // misty noise wash, slowly opening lowpass + slow tremolo = "wavery"
      var nb = ctx.createBuffer(1, ctx.sampleRate * DUR, ctx.sampleRate), d = nb.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var ns = ctx.createBufferSource(); ns.buffer = nb;
      var nf = ctx.createBiquadFilter(); nf.type = 'lowpass';
      nf.frequency.setValueAtTime(300, t); nf.frequency.exponentialRampToValueAtTime(4000, t + DUR * 0.7);
      nf.Q.value = 6;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.18, t + 0.6);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + DUR);
      var trem = ctx.createOscillator(), tg = ctx.createGain();   // tremolo = wavery
      trem.frequency.value = 7; tg.gain.value = 0.5; trem.connect(tg); tg.connect(ng.gain);
      ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); trem.start(t); trem.stop(t + DUR);

      // three detuned sine shimmers sweeping upward = "rising into another dimension"
      [220, 277, 330].forEach(function (f, k) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 3, t + DUR * 0.85);
        o.detune.value = (k - 1) * 12;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.5 + k * 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + DUR);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + DUR);
      });

      // low boom underneath for the "whoosh in"
      var b = ctx.createOscillator(), bg = ctx.createGain();
      b.type = 'sine'; b.frequency.setValueAtTime(120, t); b.frequency.exponentialRampToValueAtTime(40, t + 1.2);
      bg.gain.setValueAtTime(0.0001, t); bg.gain.exponentialRampToValueAtTime(0.3, t + 0.15);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      b.connect(bg); bg.connect(out); b.start(t); b.stop(t + 1.5);
      return DUR;
    } catch (e) { return 0; }
  }
  window.lvl3Portal = lvl3Portal;

  window.lvl3Theme = {
    current: function () { return read(); },
    set: function (theme) {
      persist(theme);
      apply(theme);
      syncToggle(document.getElementById('theme-toggle'), theme);
    },
    toggle: function () {
      var next = read() === 'dark' ? 'light' : 'dark';
      window.lvl3Theme.set(next);
    },
    accent: function () { return readAccent(); },
    setAccent: function (val) {
      try { localStorage.setItem(ACCENT_KEY, val); } catch (e) {}
      applyAccent(val);
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    syncToggle(btn, read());
    btn.addEventListener('click', function () { window.lvl3Theme.toggle(); });
  });
}());
