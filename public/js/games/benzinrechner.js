/* ── Benzinrechner ─────────────────────────────────────────────── */
/* 2-Takt Mischungsrechner for Mofas / mopeds                       */

(function () {
  'use strict';

  // ── Standard tank sizes for quick-reference table ──────────────
  const REFERENCE_SIZES = [0.5, 1, 2, 3, 5, 10];

  // ── DOM refs ───────────────────────────────────────────────────
  const elTankVolume  = document.getElementById('tank-volume');
  const elOilRatio    = document.getElementById('oil-ratio');
  const elCustomGroup = document.getElementById('custom-group');
  const elCustomPct   = document.getElementById('custom-pct');
  const elPetrolPrice = document.getElementById('petrol-price');
  const elCalcBtn     = document.getElementById('calc-btn');

  const elResultsCard   = document.getElementById('results-card');
  const elRefCard       = document.getElementById('ref-card');
  const elResultOilMl   = document.getElementById('result-oil-ml');
  const elResultRatioLbl= document.getElementById('result-ratio-label');

  const elStatOil       = document.getElementById('stat-oil');
  const elStatPetrol    = document.getElementById('stat-petrol');
  const elStatTotal     = document.getElementById('stat-total');
  const elStatCost      = document.getElementById('stat-cost');
  const elStatCostWrap  = document.getElementById('stat-cost-wrap');

  const elRefTbody      = document.getElementById('ref-tbody');

  // ── Helpers ────────────────────────────────────────────────────

  /**
   * Round a millilitre value to the nearest 0.5 ml.
   * @param {number} ml
   * @returns {number}
   */
  function roundToHalf(ml) {
    return Math.round(ml * 2) / 2;
  }

  /**
   * Format a ml value: whole numbers shown without decimal, halves shown
   * with one decimal place (e.g. 20 ml → "20", 20.5 ml → "20.5").
   * @param {number} ml
   * @returns {string}
   */
  function fmtMl(ml) {
    return ml % 1 === 0 ? ml.toFixed(0) : ml.toFixed(1);
  }

  /**
   * Format liters to 2 decimal places.
   * @param {number} liters
   * @returns {string}
   */
  function fmtL(liters) {
    return liters.toFixed(2);
  }

  /**
   * Format euros to 2 decimal places.
   * @param {number} euros
   * @returns {string}
   */
  function fmtEur(euros) {
    return euros.toFixed(2);
  }

  /**
   * Get the current effective oil percentage (0-100 scale, e.g. 2 for 2%).
   * Returns null when inputs are invalid.
   * @returns {number|null}
   */
  function getOilPct() {
    const ratioVal = elOilRatio.value;
    if (ratioVal === 'custom') {
      const pct = parseFloat(elCustomPct.value);
      if (!isFinite(pct) || pct < 0.5 || pct > 10) return null;
      return pct;
    }
    return parseFloat(ratioVal);
  }

  /**
   * Calculate oil and petrol amounts.
   * @param {number} liters  - total tank volume in liters
   * @param {number} oilPct  - oil percentage (e.g. 2 for 2%)
   * @returns {{ oilMl: number, petrolMl: number, totalMl: number }}
   */
  function calculate(liters, oilPct) {
    const totalMl  = liters * 1000;
    const oilMl    = roundToHalf(totalMl * (oilPct / 100));
    const petrolMl = totalMl - oilMl;
    return { oilMl, petrolMl, totalMl };
  }

  /**
   * Build a human-readable ratio label, e.g. "1:50 (2%)".
   * @param {number} oilPct
   * @returns {string}
   */
  function ratioLabel(oilPct) {
    const ratio = Math.round(100 / oilPct);
    return `1:${ratio} (${oilPct % 1 === 0 ? oilPct.toFixed(0) : oilPct.toFixed(1)}%)`;
  }

  // ── Animate results card ───────────────────────────────────────
  function animateResults() {
    elResultsCard.style.transition = 'none';
    elResultsCard.style.opacity = '0';
    elResultsCard.style.transform = 'translateY(10px)';
    // Force reflow
    void elResultsCard.offsetWidth;
    elResultsCard.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    elResultsCard.style.opacity = '1';
    elResultsCard.style.transform = 'translateY(0)';
  }

  // ── Show / hide custom input ───────────────────────────────────
  function syncCustomVisibility() {
    if (elOilRatio.value === 'custom') {
      elCustomGroup.classList.remove('hidden');
    } else {
      elCustomGroup.classList.add('hidden');
    }
  }

  // ── Build reference table ──────────────────────────────────────
  function buildRefTable(oilPct) {
    elRefTbody.innerHTML = '';
    REFERENCE_SIZES.forEach(function (liters) {
      const { oilMl, petrolMl } = calculate(liters, oilPct);
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border)';
      tr.innerHTML =
        '<td style="padding:9px 12px;font-weight:600">' + liters.toFixed(1) + ' L</td>' +
        '<td style="padding:9px 12px;text-align:right;color:var(--accent3)">' + fmtMl(oilMl) + ' ml</td>' +
        '<td style="padding:9px 12px;text-align:right;color:var(--text-dim)">' + fmtMl(petrolMl) + ' ml</td>';
      elRefTbody.appendChild(tr);
    });
  }

  // ── Main calculation routine ───────────────────────────────────
  function runCalculation() {
    const liters  = parseFloat(elTankVolume.value);
    const oilPct  = getOilPct();
    const price   = parseFloat(elPetrolPrice.value);

    // Validate
    if (!isFinite(liters) || liters < 0.5 || liters > 20) {
      showInputError(elTankVolume, 'Bitte ein gültiges Volumen zwischen 0.5 und 20 Liter eingeben.');
      return;
    }
    if (oilPct === null) {
      showInputError(elCustomPct, 'Bitte einen Wert zwischen 0.5% und 10% eingeben.');
      return;
    }

    clearInputErrors();

    const { oilMl, petrolMl, totalMl } = calculate(liters, oilPct);
    const label = ratioLabel(oilPct);

    // Big result
    elResultOilMl.textContent  = fmtMl(oilMl) + ' ml';
    elResultRatioLbl.textContent = 'bei ' + label;

    // Stat grid
    elStatOil.textContent    = fmtMl(oilMl) + ' ml';
    elStatPetrol.textContent = fmtL(petrolMl / 1000) + ' L';
    elStatTotal.textContent  = fmtL(totalMl / 1000) + ' L';

    if (isFinite(price) && price > 0) {
      const cost = (petrolMl / 1000) * price;
      elStatCost.textContent = '€ ' + fmtEur(cost);
      elStatCostWrap.classList.remove('hidden');
    } else {
      elStatCostWrap.classList.add('hidden');
    }

    // Show results
    const wasHidden = elResultsCard.classList.contains('hidden');
    elResultsCard.classList.remove('hidden');
    elRefCard.classList.remove('hidden');

    if (wasHidden) {
      animateResults();
    }

    // Build quick-reference table
    buildRefTable(oilPct);
  }

  // ── Input error helpers ────────────────────────────────────────
  function showInputError(inputEl, msg) {
    inputEl.style.borderColor = 'var(--red)';
    // Try to find or create a sibling error node
    let errEl = inputEl.parentElement.querySelector('.benzin-error-msg');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'benzin-error-msg';
      errEl.style.cssText = 'color:var(--red);font-size:12px;margin-top:5px';
      inputEl.parentElement.appendChild(errEl);
    }
    errEl.textContent = msg;
  }

  function clearInputErrors() {
    elTankVolume.style.borderColor = '';
    elCustomPct.style.borderColor  = '';
    document.querySelectorAll('.benzin-error-msg').forEach(function (el) {
      el.remove();
    });
  }

  // ── Live calculation on input change ──────────────────────────
  function onAnyInput() {
    // Only auto-recalculate if results are already visible
    if (!elResultsCard.classList.contains('hidden')) {
      runCalculation();
    }
  }

  // ── Event listeners ───────────────────────────────────────────
  elCalcBtn.addEventListener('click', runCalculation);

  elOilRatio.addEventListener('change', function () {
    syncCustomVisibility();
    onAnyInput();
  });

  elCustomPct.addEventListener('input', onAnyInput);
  elTankVolume.addEventListener('input', onAnyInput);
  elPetrolPrice.addEventListener('input', onAnyInput);

  // Allow Enter key on inputs to trigger calculation
  [elTankVolume, elCustomPct, elPetrolPrice].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') runCalculation();
    });
  });

  // ── Init ───────────────────────────────────────────────────────
  syncCustomVisibility();

  // Auto-run on load so the user sees a result immediately
  runCalculation();

})();
