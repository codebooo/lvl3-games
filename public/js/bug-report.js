(function () {
  "use strict";

  // ─── derive game name from URL path ─────────────────────────────────────────
  function getGameName() {
    var pathname = window.location.pathname; // e.g. "/games/logo-guesser.html"
    var seg = pathname.split("/").pop() || ""; // "logo-guesser.html"
    return seg.replace(/\.html?$/i, "") || "unknown";
  }

  // ─── inject trigger link ─────────────────────────────────────────────────────
  function createTriggerLink() {
    var link = document.createElement("button");
    link.id = "bug-report-link";
    link.textContent = "Fehler melden";
    link.setAttribute("type", "button");
    link.style.cssText = [
      "position:fixed",
      "bottom:12px",
      "right:14px",
      "font-size:12px",
      "color:var(--text-dim)",
      "background:none",
      "border:none",
      "cursor:pointer",
      "z-index:900",
      "letter-spacing:.3px",
      "padding:0",
      "text-decoration:none"
    ].join(";");

    link.addEventListener("mouseenter", function () {
      link.style.color = "var(--text)";
      link.style.textDecoration = "underline";
    });
    link.addEventListener("mouseleave", function () {
      link.style.color = "var(--text-dim)";
      link.style.textDecoration = "none";
    });

    link.addEventListener("click", openModal);
    document.body.appendChild(link);
  }

  // ─── modal state ─────────────────────────────────────────────────────────────
  var overlay = null;
  var screenshotDataUrl = null;
  var escHandler = null;

  function openModal() {
    if (overlay) return; // already open

    screenshotDataUrl = null;

    // backdrop overlay
    overlay = document.createElement("div");
    overlay.id = "bug-report-overlay";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:rgba(0,0,0,0.7)",
      "z-index:9000",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:16px",
      "box-sizing:border-box"
    ].join(";");

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });

    // panel
    var panel = document.createElement("div");
    panel.style.cssText = [
      "background:var(--card)",
      "border:2px solid var(--border)",
      "border-radius:4px",
      "padding:24px",
      "width:100%",
      "max-width:500px",
      "box-sizing:border-box",
      "display:flex",
      "flex-direction:column",
      "gap:12px",
      "max-height:90vh",
      "overflow-y:auto"
    ].join(";");

    // heading
    var heading = document.createElement("h2");
    heading.textContent = "Fehler melden";
    heading.style.cssText = "margin:0;font-size:18px;";

    // textarea + char counter
    var textareaWrap = document.createElement("div");
    textareaWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";

    var textarea = document.createElement("textarea");
    textarea.id = "bug-details";
    textarea.placeholder = "Was ist passiert? (mind. 30 Zeichen)";
    textarea.rows = 5;
    textarea.style.cssText = [
      "resize:vertical",
      "padding:8px",
      "box-sizing:border-box",
      "width:100%",
      "background:var(--card)",
      "color:var(--text)",
      "border:1px solid var(--border)",
      "border-radius:2px",
      "font-size:14px",
      "font-family:inherit"
    ].join(";");

    var charCounter = document.createElement("span");
    charCounter.style.cssText = "font-size:11px;color:var(--text-dim);text-align:right;";
    charCounter.textContent = "0 Zeichen";

    textarea.addEventListener("input", function () {
      var len = textarea.value.length;
      charCounter.textContent = len + " Zeichen";
    });

    textareaWrap.appendChild(textarea);
    textareaWrap.appendChild(charCounter);

    // inline error for textarea
    var detailsError = document.createElement("span");
    detailsError.style.cssText = "font-size:12px;color:#e05;display:none;";

    // file input section
    var fileLabel = document.createElement("label");
    fileLabel.style.cssText = "font-size:13px;color:var(--text-dim);display:flex;flex-direction:column;gap:6px;cursor:pointer;";

    var fileLabelText = document.createElement("span");
    fileLabelText.textContent = "Screenshot anhängen (optional)";

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.cssText = "font-size:12px;";

    var fileError = document.createElement("span");
    fileError.style.cssText = "font-size:12px;color:#e05;display:none;";

    var thumbWrap = document.createElement("div");
    thumbWrap.style.cssText = "display:none;";

    var thumb = document.createElement("img");
    thumb.alt = "Vorschau";
    thumb.style.cssText = "max-width:120px;max-height:80px;border:1px solid var(--border);border-radius:2px;";

    thumbWrap.appendChild(thumb);

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      fileError.style.display = "none";
      thumbWrap.style.display = "none";
      screenshotDataUrl = null;

      if (!file) return;

      if (file.size > 10 * 1024 * 1024) {
        fileError.textContent = "Datei zu groß (max 10 MB).";
        fileError.style.display = "";
        fileInput.value = "";
        return;
      }

      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          try {
            var maxEdge = 1280;
            var w = img.width;
            var h = img.height;
            if (w > maxEdge || h > maxEdge) {
              if (w >= h) {
                h = Math.round(h * maxEdge / w);
                w = maxEdge;
              } else {
                w = Math.round(w * maxEdge / h);
                h = maxEdge;
              }
            }
            var canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            screenshotDataUrl = canvas.toDataURL("image/jpeg", 0.8);
            thumb.src = screenshotDataUrl;
            thumbWrap.style.display = "";
          } catch (e) {
            // canvas failed — skip screenshot silently
            screenshotDataUrl = null;
          }
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    fileLabel.appendChild(fileLabelText);
    fileLabel.appendChild(fileInput);
    fileLabel.appendChild(fileError);
    fileLabel.appendChild(thumbWrap);

    // buttons row
    var btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";

    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Abbrechen";
    cancelBtn.style.cssText = "padding:7px 16px;cursor:pointer;background:none;border:1px solid var(--border);color:var(--text);border-radius:2px;font-size:13px;";
    cancelBtn.addEventListener("click", closeModal);

    var sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.textContent = "Senden";
    sendBtn.style.cssText = "padding:7px 16px;cursor:pointer;background:var(--accent);border:none;color:#fff;border-radius:2px;font-size:13px;font-weight:600;";
    sendBtn.addEventListener("click", function () {
      submitReport(textarea, detailsError, sendBtn);
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(sendBtn);

    // assemble panel
    panel.appendChild(heading);
    panel.appendChild(textareaWrap);
    panel.appendChild(detailsError);
    panel.appendChild(fileLabel);
    panel.appendChild(btnRow);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Esc closes — only active while modal is open
    escHandler = function (e) {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", escHandler);

    textarea.focus();
  }

  function closeModal() {
    if (overlay) {
      document.body.removeChild(overlay);
      overlay = null;
    }
    if (escHandler) {
      document.removeEventListener("keydown", escHandler);
      escHandler = null;
    }
    screenshotDataUrl = null;
  }

  function submitReport(textarea, detailsError, sendBtn) {
    detailsError.style.display = "none";

    var details = textarea.value;
    if (!details || details.trim().length < 30) {
      detailsError.textContent = "Mindestens 30 Zeichen.";
      detailsError.style.display = "";
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = "Wird gesendet…";

    var payload = {
      game:      getGameName(),
      details:   details,
      screenshot: screenshotDataUrl || null,
      url:       window.location.href,
      userAgent: navigator.userAgent
    };

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/bug-report", true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function () {
      sendBtn.disabled = false;
      sendBtn.textContent = "Senden";
      if (xhr.status === 200) {
        closeModal();
        if (window.lvl3 && typeof window.lvl3.showToast === "function") {
          window.lvl3.showToast("Danke! Fehler gemeldet.", "success");
        } else {
          alert("Danke! Fehler gemeldet.");
        }
      } else {
        var msg = "Fehler beim Senden.";
        try {
          var resp = JSON.parse(xhr.responseText);
          if (resp && resp.error) msg = resp.error;
        } catch (e) { /* ignore */ }
        detailsError.textContent = msg;
        detailsError.style.display = "";
      }
    };
    xhr.onerror = function () {
      sendBtn.disabled = false;
      sendBtn.textContent = "Senden";
      detailsError.textContent = "Netzwerkfehler. Bitte erneut versuchen.";
      detailsError.style.display = "";
    };
    xhr.send(JSON.stringify(payload));
  }

  // ─── init ─────────────────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createTriggerLink);
  } else {
    createTriggerLink();
  }
}());
