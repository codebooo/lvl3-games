/* theme.js — Lvl 3 Games theme switcher. Runs blocking in <head> to prevent FOUC. ES5-compatible. */
(function () {
  var STORAGE_KEY = 'lvl3_theme';
  var DEFAULT = 'dark';

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
    /* ☀ shown when currently dark (click → go light); ☾ shown when currently light (click → go dark) */
    btn.textContent = theme === 'dark' ? '☀' : '☾';
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
