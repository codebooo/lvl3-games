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

  /* Global click sound — soft, creamy synth click on every click, site-wide. */
  var clickCtx;
  function lvl3Click(freq, dur, vol) {
    try {
      clickCtx = clickCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t = clickCtx.currentTime, f0 = freq || 700, d = dur || 0.05;
      var o = clickCtx.createOscillator(), g = clickCtx.createGain(), lp = clickCtx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1800;
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.4, t + d);
      g.gain.setValueAtTime(vol || 0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(lp); lp.connect(g); g.connect(clickCtx.destination);
      o.start(t); o.stop(t + d);
    } catch (e) {}
  }
  window.lvl3Click = lvl3Click;
  document.addEventListener('click', function () { lvl3Click(); }, true);

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
