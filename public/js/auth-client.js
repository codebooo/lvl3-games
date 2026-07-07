document.addEventListener("DOMContentLoaded", function () {
  // ─── Check existing session ───────────────────────────────────
  fetch("/api/me")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return; // not logged in — stay on login page
      if (d.passwordChanged) {
        window.location.href = "/dashboard.html";
      } else {
        // Logged in but password not yet changed — show overlay
        var overlay = document.getElementById("change-pw-overlay");
        if (overlay) overlay.classList.remove("hidden");
      }
    })
    .catch(function () { /* stay on login page */ });

  // ─── Login form ───────────────────────────────────────────────
  var loginForm = document.getElementById("login-form");
  var loginBtn  = document.getElementById("login-btn");
  var loginErr  = document.getElementById("login-error");

  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var username = document.getElementById("inp-username").value.trim();
      var password = document.getElementById("inp-password").value;

      if (!username) {
        showLoginError("Bitte Benutzernamen eingeben.");
        return;
      }

      loginBtn.disabled = true;
      // Update only the label span — using loginBtn.textContent wiped the arrow SVG
      // and permanently relabeled the button.
      var btnText = document.getElementById("btn-text");
      if (btnText) btnText.textContent = "Einloggen…";
      hideLoginError();

      var rememberEl = document.getElementById("inp-remember");
      var rememberMe = rememberEl ? rememberEl.checked : false;

      fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username, password: password, rememberMe: rememberMe })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            localStorage.setItem("lvl3_user", data.username);
            if (!data.passwordChanged) {
              var overlay = document.getElementById("change-pw-overlay");
              if (overlay) overlay.classList.remove("hidden");
            } else {
              window.location.href = "/dashboard.html";
            }
          } else if (data.needsPassword) {
            var pwField = document.getElementById("inp-password");
            if (pwField) pwField.focus();
            showLoginError("Bitte Passwort eingeben.");
          } else {
            showLoginError(data.error || "Ungültige Anmeldedaten.");
          }
        })
        .catch(function () {
          showLoginError("Verbindungsfehler. Bitte erneut versuchen.");
        })
        .finally(function () {
          loginBtn.disabled = false;
          if (btnText) btnText.textContent = "Spielen";
        });
    });
  }

  // ─── Change-password form ─────────────────────────────────────
  var changePwForm = document.getElementById("change-pw-form");
  var pwErr        = document.getElementById("pw-error");

  if (changePwForm) {
    changePwForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var newPw     = document.getElementById("inp-new-pw").value;
      var confirmPw = document.getElementById("inp-confirm-pw").value;

      hidePwError();

      if (newPw.length < 6) {
        showPwError("Das Passwort muss mindestens 6 Zeichen lang sein.");
        return;
      }
      if (newPw !== confirmPw) {
        showPwError("Die Passwörter stimmen nicht überein.");
        return;
      }

      var submitBtn = changePwForm.querySelector("button[type=submit]");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Speichern…";
      }

      fetch("/api/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: newPw })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            window.location.href = "/dashboard.html";
          } else {
            showPwError(data.error || "Fehler beim Ändern des Passworts.");
          }
        })
        .catch(function () {
          showPwError("Verbindungsfehler. Bitte erneut versuchen.");
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Passwort ändern & loslegen";
          }
        });
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────
  function showLoginError(msg) {
    if (loginErr) {
      loginErr.textContent = msg;
      loginErr.classList.add("visible");
    }
  }

  function hideLoginError() {
    if (loginErr) loginErr.classList.remove("visible");
  }

  function showPwError(msg) {
    if (pwErr) {
      pwErr.textContent = msg;
      pwErr.classList.add("visible");
    }
  }

  function hidePwError() {
    if (pwErr) pwErr.classList.remove("visible");
  }
});
