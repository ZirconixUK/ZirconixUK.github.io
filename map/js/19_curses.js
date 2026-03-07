// ---- Curses System (v1) ----
// For now: one test curse per heat tier (1..5). Each lasts 5 minutes and has no gameplay effects.
// Future: each tier can hold multiple curses and we pick randomly per tier.

(function () {
  const DEFAULT_DURATION_MS = 5 * 60 * 1000;

  let CURSES_CONFIG = null; // loaded from curses.json
  let active = []; // [{id, tier, name, description, appliedAt, expiresAt, stacks}]

  function nowMs() { return Date.now(); }

  function getCacheBuster() {
    // index.html sets window.__cb to its cache-buster value.
    return (typeof window.__cb !== "undefined" && window.__cb) ? String(window.__cb) : String(Date.now());
  }

  async function loadCursesConfig() {
    try {
      const cb = getCacheBuster();
      const res = await fetch(`./curses.json?cb=${encodeURIComponent(cb)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      CURSES_CONFIG = await res.json();
      return CURSES_CONFIG;
    } catch (e) {
      console.error("Failed to load curses.json", e);
      CURSES_CONFIG = null;
      return null;
    }
  }

  function tierToCurseId(tier) {
    const t = String(tier);
    if (CURSES_CONFIG && CURSES_CONFIG.tiers && CURSES_CONFIG.tiers[t] && CURSES_CONFIG.tiers[t].id) {
      return CURSES_CONFIG.tiers[t].id;
    }
    return `heat${t}`;
  }

  function getCurseDefById(id) {
    if (!CURSES_CONFIG || !CURSES_CONFIG.tiers) return null;
    const tiers = CURSES_CONFIG.tiers;
    for (const k of Object.keys(tiers)) {
      if (tiers[k] && tiers[k].id === id) return { tier: parseInt(k, 10), ...tiers[k] };
    }
    return null;
  }

  function normalizeCurseObj(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (!obj.id) return null;
    const def = getCurseDefById(obj.id);
    const tier = (typeof obj.tier === "number" && isFinite(obj.tier)) ? obj.tier : (def ? def.tier : null);
    const durationMs = (typeof obj.durationMs === "number" && isFinite(obj.durationMs))
      ? obj.durationMs
      : (def && typeof def.durationMs === "number" ? def.durationMs : (CURSES_CONFIG && CURSES_CONFIG.defaultDurationMs) || DEFAULT_DURATION_MS);

    const appliedAt = (typeof obj.appliedAt === "number" && isFinite(obj.appliedAt)) ? obj.appliedAt : nowMs();
    const expiresAt = (typeof obj.expiresAt === "number" && isFinite(obj.expiresAt))
      ? obj.expiresAt
      : (appliedAt + durationMs);

    return {
      id: String(obj.id),
      tier: (typeof tier === "number" && isFinite(tier)) ? tier : null,
      name: String(obj.name || (def && def.name) || obj.id),
      description: String(obj.description || (def && def.description) || ""),
      appliedAt,
      expiresAt,
      stacks: (typeof obj.stacks === "number" && isFinite(obj.stacks)) ? obj.stacks : 1
    };
  }

  function refreshUI() {
    try { if (typeof window.updateCursesButton === "function") window.updateCursesButton(); } catch (e) {}
    try { if (typeof window.updateCursesPanel === "function") window.updateCursesPanel(); } catch (e) {}
  }

  function saveIfPossible() {
    try { if (typeof window.saveRoundState === "function") window.saveRoundState(); } catch (e) {}
  }

  function getActiveCurses() {
    return active.slice();
  }

  function setActiveCurses(list, { silent = false } = {}) {
    const next = Array.isArray(list) ? list.map(normalizeCurseObj).filter(Boolean) : [];
    active = next;
    if (!silent) {
      refreshUI();
      saveIfPossible();
    }
  }

  function clearCurses() {
    active = [];
    refreshUI();
    saveIfPossible();
  }

  function applyCurse(curseId, { durationMs = null } = {}) {
    const id = String(curseId || "").trim();
    if (!id) return { curse: null, isNew: false };

    const def = getCurseDefById(id);
    const dur = (typeof durationMs === "number" && isFinite(durationMs))
      ? durationMs
      : (def && typeof def.durationMs === "number" ? def.durationMs : (CURSES_CONFIG && CURSES_CONFIG.defaultDurationMs) || DEFAULT_DURATION_MS);

    const existing = active.find(c => c.id === id);
    const now = nowMs();

    if (existing) {
      existing.appliedAt = now;
      existing.expiresAt = now + dur; // refresh
      refreshUI();
      saveIfPossible();
      return { curse: { ...existing }, isNew: false };
    } else {
      const created = normalizeCurseObj({
        id,
        tier: def ? def.tier : null,
        name: def ? def.name : id,
        description: def ? def.description : "",
        appliedAt: now,
        expiresAt: now + dur,
        stacks: 1
      });
      if (created) active.push(created);
      refreshUI();
      saveIfPossible();
      return { curse: created ? { ...created } : null, isNew: true };
    }
  }

  function applyTierCurse(tier) {
    const id = tierToCurseId(tier);
    return applyCurse(id);
  }

  function msLeft(c) {
    const left = (c && typeof c.expiresAt === "number") ? (c.expiresAt - nowMs()) : 0;
    return Math.max(0, left);
  }

  function tickCurses(now = Date.now()) {
    if (!active.length) return;
    const before = active.length;
    active = active.filter(c => (c && typeof c.expiresAt === "number") ? (c.expiresAt > now) : false);
    if (active.length !== before) {
      refreshUI();
      saveIfPossible();
    }
  }

  // Persist/restore helpers
  function getCursesStateForSave() {
    return active.map(c => ({
      id: c.id,
      tier: c.tier,
      name: c.name,
      description: c.description,
      appliedAt: c.appliedAt,
      expiresAt: c.expiresAt,
      stacks: c.stacks
    }));
  }

  function restoreCursesFromSave(savedList) {
    // Called by boot. Don't spam saves on restore.
    setActiveCurses(Array.isArray(savedList) ? savedList : [], { silent: true });
    // Immediately drop any expired curses.
    tickCurses(Date.now());
    refreshUI();
  }

  // Heat hook: whenever heat level increases to N, apply the tier N curse.
  // We intentionally ignore "restore" so refreshing doesn't re-trigger curses.
  function onHeatLevelChanged(prevLevel, newLevel, reason) {
    // v2 design: we *don't* auto-apply curses on level change.
    // Instead, each question roll has a chance based on the *current* heat level.
    // We keep this hook for future effects or telemetry, but no-op for now.
    return;
  }

  function getTriggerChanceForHeatLevel(level) {
    const n = (typeof level === 'number' && isFinite(level)) ? Math.max(0, Math.min(5, level | 0)) : 0;
    if (!CURSES_CONFIG || !CURSES_CONFIG.triggerChanceByHeatLevel) return 0;
    const v = CURSES_CONFIG.triggerChanceByHeatLevel[String(n)];
    return (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.min(1, v)) : 0;
  }

  // Called after a question is asked.
  // Rolls a chance to trigger a curse based on current heat level.
  function maybeTriggerCurseFromQuestion(meta = null) {
    try {
      tickCurses(Date.now());

      const lvl = (typeof window.getHeatLevel === 'function')
        ? window.getHeatLevel()
        : (typeof heatLevel !== 'undefined' ? heatLevel : 0);

      const level = (typeof lvl === 'number' && isFinite(lvl)) ? (lvl | 0) : 0;
      if (level <= 0) return { triggered: false, reason: 'heat0' };

      const p = getTriggerChanceForHeatLevel(level);
      if (p <= 0) return { triggered: false, reason: 'p0', p, level };

      const r = Math.random();
      const triggered = r < p;
      let applied = null;
      if (triggered) applied = applyTierCurse(level);
      return { triggered, p, r, level, meta, applied };
    } catch (e) {
      console.error(e);
      return { triggered: false, reason: 'error' };
    }
  }

  // Debug helper: toggle a simulated tier-3 curse (arbitrary).
  function debugSimulateCurse(on) {
    if (on) {
      applyTierCurse(3);
    } else {
      clearCurses();
    }
  }

  // Expose
  window.loadCursesConfig = loadCursesConfig;
  window.getActiveCurses = getActiveCurses;
  window.setActiveCurses = setActiveCurses; // still useful for dev tooling
  window.clearCurses = clearCurses;
  window.applyCurse = applyCurse;
  window.applyTierCurse = applyTierCurse;
  window.tickCurses = tickCurses;
  window.maybeTriggerCurseFromQuestion = maybeTriggerCurseFromQuestion;
  window.__getCursesStateForSave = getCursesStateForSave;
  window.__restoreCursesFromSave = restoreCursesFromSave;
  window.onHeatLevelChanged = onHeatLevelChanged;
  window.debugSimulateCurse = debugSimulateCurse;
  window.__msLeftOnCurse = msLeft;

  // Kick off config load ASAP (non-blocking).
  loadCursesConfig().then(() => {
    // refresh UI once definitions are known
    try { refreshUI(); } catch (e) {}
  });

})();
