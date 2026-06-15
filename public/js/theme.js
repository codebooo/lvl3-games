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
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    syncToggle(btn, read());
    btn.addEventListener('click', function () { window.lvl3Theme.toggle(); });
  });
}());
