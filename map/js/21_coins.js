// ---- Phase 3: Coins (movement economy) ----

// Persisted coin state lives alongside the rest of the round state in js/04_state.js
// and is restored in js/13_boot.js.

let coinCount = 0;
let coinProgressM = 0;      // meters towards next coin
let coinLastLatLng = null;  // {lat, lon}

function __haversineMeters(a, b) {
  try {
    // Our shared helper signature is: haversineMeters(lat1, lon1, lat2, lon2)
    // (not object-based). Use it if present.
    if (typeof window.haversineMeters === 'function') {
      const fn = window.haversineMeters;
      if (fn.length >= 4) {
        return fn(+a.lat, +a.lon, +b.lat, +b.lon);
      }
    }
  } catch (e) {}
  const R = 6371000;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad((+b.lat) - (+a.lat));
  const dLon = toRad((+b.lon) - (+a.lon));
  const lat1 = toRad(+a.lat);
  const lat2 = toRad(+b.lat);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getCoins() {
  return (typeof coinCount === 'number' && isFinite(coinCount)) ? (coinCount | 0) : 0;
}

function setCoins(n, { silent = false } = {}) {
  coinCount = Math.max(0, (n | 0));
  try { if (!silent && typeof updateUI === 'function') updateUI(); } catch (e) {}
  try { if (typeof saveRoundState === 'function') saveRoundState(); } catch (e) {}
  try { __scheduleCoinsUIRefresh(); } catch (e) {}
}

function addCoins(n, { silent = false } = {}) {
  setCoins(getCoins() + (n | 0), { silent });
}

function canAffordCoins(cost) {
  const c = (typeof cost === 'number' && isFinite(cost)) ? (cost | 0) : 0;
  return getCoins() >= c;
}

function spendCoins(cost, { reason = '' } = {}) {
  const c = (typeof cost === 'number' && isFinite(cost)) ? (cost | 0) : 0;
  if (c <= 0) return { ok: true, spent: 0, remaining: getCoins() };
  if (!canAffordCoins(c)) return { ok: false, spent: 0, remaining: getCoins() };
  coinCount = Math.max(0, getCoins() - c);
  try { if (typeof saveRoundState === 'function') saveRoundState(); } catch (e) {}
  try { if (typeof updateUI === 'function') updateUI(); } catch (e) {}
  try { __scheduleCoinsUIRefresh(); } catch (e) {}
  try {
    if (reason && typeof log === 'function') log(`🟡 Spent ${c} coin${c === 1 ? '' : 's'}${reason ? `: ${reason}` : ''}.`);
  } catch (e) {}
  return { ok: true, spent: c, remaining: getCoins() };
}

function coinsNeeded(cost) {
  const c = (typeof cost === 'number' && isFinite(cost)) ? (cost | 0) : 0;
  return Math.max(0, c - getCoins());
}

function metersToNextCoin() {
  const step = (typeof COIN_EARN_METERS === 'number' && isFinite(COIN_EARN_METERS) && COIN_EARN_METERS > 0) ? COIN_EARN_METERS : 100;
  const p = (typeof coinProgressM === 'number' && isFinite(coinProgressM)) ? coinProgressM : 0;
  return Math.max(0, step - p);
}

function updateCoinsUIOnly() {
  try {
    const el = document.getElementById('coinsMain');
    if (el) el.textContent = String(getCoins());
  } catch (e) {}

  // Photo menu header coin display (helps avoid confusion about affordability)
  try {
    const el2 = document.getElementById('photoCoins');
    if (el2) el2.textContent = String(getCoins());
  } catch (e) {}

  // Update tool cost badges (heat + coins)
  try { if (typeof window.updateCostBadgesFromConfig === 'function') window.updateCostBadgesFromConfig(); } catch (e) {}
}

// Full UI refresh (menus/affordability) can be expensive. Schedule it so multiple
// updates in a single frame only refresh once.
let __coinsUIRefreshPending = false;

function __refreshCoinsUIOnce() {
  try { if (typeof updateCoinsUIOnly === 'function') updateCoinsUIOnly(); } catch (e) {}
  try { if (typeof window.updateHUD === 'function') window.updateHUD(); } catch (e) {}
  try { if (typeof window.updateUI === 'function') window.updateUI(); } catch (e) {}
}

function __scheduleCoinsUIRefresh() {
  if (__coinsUIRefreshPending) return;
  __coinsUIRefreshPending = true;
  const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
  raf(() => {
    __coinsUIRefreshPending = false;
    __refreshCoinsUIOnce();
  });
}

function initCoinsForNewRound(startLatLng) {
  const stipend = (typeof COIN_START_STIPEND === 'number' && isFinite(COIN_START_STIPEND)) ? (COIN_START_STIPEND | 0) : 3;
  coinCount = Math.max(0, stipend);
  coinProgressM = 0;
  coinLastLatLng = (startLatLng && typeof startLatLng.lat === 'number' && typeof startLatLng.lon === 'number')
    ? { lat: startLatLng.lat, lon: startLatLng.lon }
    : null;
  try { if (typeof saveRoundState === 'function') saveRoundState(); } catch (e) {}
  try { updateCoinsUIOnly(); } catch (e) {}
  try { __scheduleCoinsUIRefresh(); } catch (e) {}
}

function onPlayerMovedForCoins(a, b, cLat, dLon) {
  // Only earn coins during an active round.
  try {
    if (typeof window.isRoundOver === 'function' && window.isRoundOver()) return;
  } catch (e) {}


  // Back-compat: called as (nextLat,nextLon). New form: (prevLat,prevLon,nextLat,nextLon).
  let prev = null;
  let nextLat = null;
  let nextLon = null;
  if (typeof cLat === 'number' && typeof dLon === 'number') {
    // new signature
    if (typeof a === 'number' && typeof b === 'number') prev = { lat: a, lon: b };
    nextLat = cLat; nextLon = dLon;
  } else {
    nextLat = a; nextLon = b;
  }
  if (typeof nextLat !== 'number' || typeof nextLon !== 'number' || !isFinite(nextLat) || !isFinite(nextLon)) return;
  const next = { lat: nextLat, lon: nextLon };

  const base = prev ? prev : coinLastLatLng;
  if (!base) {
    coinLastLatLng = { ...next };
    return;
  }

  const d = __haversineMeters(base, next);
  if (!isFinite(d) || d <= 0) {
    coinLastLatLng = { ...next };
    return;
  }
  coinLastLatLng = { ...next };

  const step = (typeof COIN_EARN_METERS === 'number' && isFinite(COIN_EARN_METERS) && COIN_EARN_METERS > 0) ? COIN_EARN_METERS : 100;
  coinProgressM = (typeof coinProgressM === 'number' && isFinite(coinProgressM)) ? coinProgressM : 0;
  coinProgressM += d;

  let earned = 0;
  while (coinProgressM >= step) {
    coinProgressM -= step;
    earned++;
  }
  if (earned > 0) {
    coinCount = Math.max(0, getCoins() + earned);
    try { if (typeof log === 'function') log(`🟡 Earned ${earned} coin${earned === 1 ? '' : 's'} from movement.`); } catch (e) {}
    try { if (typeof saveRoundState === 'function') saveRoundState(); } catch (e) {}
  } else {
    // In debug mode, make progress visible so it doesn't feel broken when clicks are < 100m.
    try {
      if (typeof debugMode !== 'undefined' && debugMode && typeof log === 'function') {
        const prog = Math.max(0, Math.min(step, (typeof coinProgressM === 'number' && isFinite(coinProgressM)) ? coinProgressM : 0));
        // Only log meaningful moves to avoid noise.
        if (d >= 5) log(`🟡 Walked ${d.toFixed(0)}m (${prog.toFixed(0)}/${step.toFixed(0)}m to next coin)`);
      }
    } catch(e) {}
    // Don't spam full UI refreshes while just accumulating progress.
    // (Progress persists via the next earned coin / other state changes.)
  }
  updateCoinsUIOnly();
  if (earned > 0) {
    try { __scheduleCoinsUIRefresh(); } catch (e) {}
  }
}

// Expose a small API
window.__coins = {
  getCoins,
  setCoins,
  addCoins,
  spendCoins,
  canAffordCoins,
  coinsNeeded,
  metersToNextCoin,
  initCoinsForNewRound,
  onPlayerMovedForCoins,
  // for persistence
  __getState: () => ({ coinCount, coinProgressM, coinLastLatLng }),
  __restoreState: (s) => {
    try {
      if (!s || typeof s !== 'object') return;
      if (typeof s.coinCount === 'number' && isFinite(s.coinCount)) coinCount = Math.max(0, (s.coinCount | 0));
      if (typeof s.coinProgressM === 'number' && isFinite(s.coinProgressM)) coinProgressM = Math.max(0, s.coinProgressM);
      if (s.coinLastLatLng && typeof s.coinLastLatLng.lat === 'number' && typeof s.coinLastLatLng.lon === 'number') {
        coinLastLatLng = { lat: s.coinLastLatLng.lat, lon: s.coinLastLatLng.lon };
      } else {
        coinLastLatLng = null;
      }
      updateCoinsUIOnly();
      try { __scheduleCoinsUIRefresh(); } catch (e) {}
    } catch (e) {}
  },
};
