// ---- Phase 2: Lock In Guess + Scoring ----
(function(){
  function num(x){
    const n = (typeof x === 'string') ? parseFloat(x) : x;
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  function getTargetLatLng(){
    try {
      if (typeof getTarget === 'function') {
        const t = getTarget();
        if (t && isFinite(t.lat) && isFinite(t.lon)) return { lat:+t.lat, lon:+t.lon };
      }
    } catch(e) {}
    // Some builds keep `target` as a module/global var (not attached to `window`).
    try {
      if (typeof target !== 'undefined' && target && isFinite(target.lat) && isFinite(target.lon)) {
        return { lat:+target.lat, lon:+target.lon };
      }
    } catch(e) {}
    try {
      if (window.target && isFinite(window.target.lat) && isFinite(window.target.lon)) return { lat:+window.target.lat, lon:+window.target.lon };
    } catch(e) {}
    return null;
  }

  function getRound(){
    try { return (typeof window.getRoundStateV1 === 'function') ? window.getRoundStateV1() : (window.roundStateV1 || null); } catch(e) { return null; }
  }

  function setRound(patch){
    const r = getRound();
    if (!r || typeof patch !== 'object') return;
    Object.assign(r, patch);
    try { if (typeof saveRoundState === 'function') saveRoundState(); } catch(e) {}
    try { if (typeof updateUI === 'function') updateUI(); } catch(e) {}
    try { if (typeof updateHUD === 'function') updateHUD(); } catch(e) {}
  }

  function computeGrade(distM){
    const d = Math.max(0, num(distM) ?? Infinity);
    const bands = (typeof GRADE_THRESHOLDS_M !== 'undefined' && Array.isArray(GRADE_THRESHOLDS_M)) ? GRADE_THRESHOLDS_M : [
      { label:'S', max:25 },{ label:'A', max:75 },{ label:'B', max:150 },{ label:'C', max:300 },{ label:'D', max:600 },{ label:'F', max:Infinity }
    ];
    for (const b of bands) {
      if (d <= (num(b.max) ?? Infinity)) return String(b.label || 'F');
    }
    return 'F';
  }

  function computeScore(distM){
    const d = Math.max(0, num(distM) ?? Infinity);
    const maxPts = (typeof SCORE_MAX_POINTS !== 'undefined') ? num(SCORE_MAX_POINTS) : 5000;
    const zeroAt = (typeof SCORE_ZERO_AT_M !== 'undefined') ? num(SCORE_ZERO_AT_M) : 2000;
    if (!maxPts || !zeroAt) return 0;
    // Smooth falloff: quadratic-ish clamp.
    const x = Math.min(1, d / zeroAt);
    const pts = Math.round(maxPts * Math.max(0, 1 - (x*x)));
    return Math.max(0, pts);
  }

  async function sampleGpsBriefly(){
    // Try: use a few quick samples and average them.
    // Fallback: use last known fix.
    const samples = [];
    const N = 4;
    const start = Date.now();
    for (let i = 0; i < N; i++) {
      try {
        if (typeof window.__requestGeoSample === 'function') {
          const s = await window.__requestGeoSample({ highAccuracy:true, timeoutMs:2500, maximumAgeMs:0 });
          if (s && isFinite(s.lat) && isFinite(s.lon)) samples.push(s);
        }
      } catch(e) {
        // ignore and continue
      }
      if (Date.now() - start > 3500) break;
      // small pause to allow a new fix
      await new Promise(r => setTimeout(r, 250));
    }
    if (!samples.length) {
      try {
        if (typeof window.__getLastGeoFix === 'function') {
          const s = window.__getLastGeoFix();
          if (s && isFinite(s.lat) && isFinite(s.lon)) return s;
        }
      } catch(e) {}
      // Last-ditch: use current player
      if (window.player && isFinite(window.player.lat) && isFinite(window.player.lon)) {
        return { lat: window.player.lat, lon: window.player.lon, accuracy: window.player.accuracy || null, ts: Date.now() };
      }
      return null;
    }
    // Average lat/lon; use best (lowest) accuracy as representative.
    let lat = 0, lon = 0;
    let bestAcc = null;
    for (const s of samples) {
      lat += s.lat; lon += s.lon;
      const a = num(s.accuracy);
      if (a != null) bestAcc = (bestAcc == null) ? a : Math.min(bestAcc, a);
    }
    lat /= samples.length;
    lon /= samples.length;
    return { lat, lon, accuracy: bestAcc, ts: Date.now() };
  }

  function openResultModal(html){
    const m = document.getElementById('resultModal');
    const b = document.getElementById('resultModalBody');
    if (b) b.innerHTML = html;
    if (m) m.classList.remove('hidden');
  }
  function closeResultModal(){
    const m = document.getElementById('resultModal');
    if (m) m.classList.add('hidden');
  }

  function fmtMeters(m){
    const n = num(m);
    if (n == null) return '—';
    if (n >= 1000) return `${(n/1000).toFixed(2)} km`;
    return `${Math.round(n)} m`;
  }

  async function lockInGuess(){
    const r = getRound();
    if (!r) { try { if (typeof showToast === 'function') showToast('No active round.', false); } catch(e) {} return; }
    if (r.hasGuessed) { try { if (typeof showToast === 'function') showToast('Guess already locked.', false); } catch(e) {} return; }

    const tgt = getTargetLatLng();
    if (!tgt) { try { if (typeof showToast === 'function') showToast('No target set yet.', false); } catch(e) {} return; }

    // Debug rule: if debug is enabled, use manual click location (if set), not current geolocation.
    let guess = null;
    const dbg = (typeof debugMode !== 'undefined') ? !!debugMode : !!window.debugMode;
    const pl = (typeof player !== 'undefined') ? player : window.player;
    if (dbg && pl && pl.manualOverride) {
      guess = { lat: +pl.lat, lon: +pl.lon, accuracy: num(pl.accuracy) ?? 0, ts: Date.now() };
    } else {
      try { if (typeof showToast === 'function') showToast('Locking in guess…', true); } catch(e) {}
      guess = await sampleGpsBriefly();
    }

    if (!guess || !isFinite(guess.lat) || !isFinite(guess.lon)) {
      try { if (typeof showToast === 'function') showToast('Could not get a location fix to lock in.', false); } catch(e) {}
      return;
    }

    const rawD = (typeof haversineMeters === 'function')
      ? haversineMeters(guess.lat, guess.lon, tgt.lat, tgt.lon)
      : null;

    const acc = num(guess.accuracy);
    const useAdj = (typeof USE_ACCURACY_ADJUSTED_DISTANCE !== 'undefined') ? !!USE_ACCURACY_ADJUSTED_DISTANCE : true;
    const adjD = (rawD != null)
      ? Math.max(0, rawD - (useAdj && acc != null ? acc : 0))
      : null;

    const score = computeScore(useAdj ? adjD : rawD);
    const grade = computeGrade(useAdj ? adjD : rawD);

    setRound({
      hasGuessed: true,
      guessLatLng: { lat: guess.lat, lon: guess.lon },
      guessGpsAccuracyM: acc,
      guessTimestamp: Date.now(),
      distanceToTargetM: rawD,
      adjustedDistanceM: adjD,
      scorePoints: score,
      gradeLabel: grade,
    });

    // Reveal line/markers if Leaflet helpers exist
    try {
      if (typeof window.showRevealOverlay === 'function') window.showRevealOverlay({ guess, target: tgt });
    } catch(e) {}

    const html = `
      <div class="resultStack">
        <div class="resultRow"><div class="resultLabel">Grade</div><div class="resultValue"><b>${grade}</b></div></div>
        <div class="resultRow"><div class="resultLabel">Points</div><div class="resultValue"><b>${score}</b></div></div>
        <div class="resultRow"><div class="resultLabel">Distance</div><div class="resultValue">${fmtMeters(rawD)}</div></div>
        <div class="resultRow"><div class="resultLabel">Adjusted</div><div class="resultValue">${useAdj ? fmtMeters(adjD) : '—'}</div></div>
        <div class="muted" style="margin-top:10px;">${useAdj ? `GPS accuracy used: ${acc != null ? fmtMeters(acc) : '—'}` : ''}</div>
        <div class="row" style="justify-content:space-between; gap:10px; margin-top:14px;">
          <button id="btnResultNewRound" class="primary" style="flex:1;">Start New Round</button>
          <button id="btnResultClose" style="flex:0;">Close ✕</button>
        </div>
      </div>
    `;
    openResultModal(html);

    // Wire modal buttons
    try {
      const b1 = document.getElementById('btnResultNewRound');
      if (b1) b1.onclick = () => { try { closeResultModal(); } catch(e) {} try { if (typeof window.startNewRound === 'function') window.startNewRound(); } catch(e) {} };
      const b2 = document.getElementById('btnResultClose');
      if (b2) b2.onclick = () => closeResultModal();
    } catch(e) {}
  }

  function startNewRound(){
    // Always pick a new target and immediately show the snapshot (Phase 1 behaviour)
    try { if (typeof pickNewTarget === 'function') pickNewTarget(true); } catch(e) {}
  }

  function canUseTools(){
    const r = getRound();
    return !(r && r.hasGuessed);
  }

  // Public API
  window.lockInGuess = lockInGuess;
  window.startNewRound = startNewRound;
  window.isRoundOver = () => {
    const r = getRound();
    return !!(r && r.hasGuessed);
  };
  window.canUseTools = canUseTools;
  window.closeResultModal = closeResultModal;

})();
