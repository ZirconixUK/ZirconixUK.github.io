// Google Street View Static API "Photo Glimpse"
// - No location links (to avoid spoilers)
// - Intended as a Jet Lag-style "photo question" analogue
(function(){
  // Cache the last successfully shown glimpse so re-opening it doesn't
  // consume additional API quota or in-game costs.
  let __cachedTargetKey = null;
  let __cachedImgUrl = null;
  let __cachedHtml = null;
  let __cachedLoaded = false;

  function targetKey(tgt){
    if (!tgt) return null;
    const id = tgt.id || tgt.osm_id || tgt.name || '';
    const lat = (typeof tgt.lat === 'number' || typeof tgt.lat === 'string') ? String(tgt.lat) : '';
    const lon = (typeof tgt.lon === 'number' || typeof tgt.lon === 'string') ? String(tgt.lon) : '';
    return `${id}|${lat}|${lon}`;
  }

  function clearCache(){
    __cachedTargetKey = null;
    __cachedImgUrl = null;
    __cachedHtml = null;
    __cachedLoaded = false;
    try { if (typeof window.updateCostBadgesFromConfig === 'function') window.updateCostBadgesFromConfig(); } catch(e) {}
  }

  function isStreetViewGlimpseFreeForCurrentTarget(){
    // "Free" means we already successfully loaded (and cached) the glimpse for this target.
    const tgt = getTargetSafe();
    const k = targetKey(tgt);
    return !!(k && __cachedTargetKey === k && __cachedLoaded && __cachedHtml);
  }

  function openModal(){
    const m = document.getElementById('photoModal');
    if (!m) return;
    m.classList.remove('hidden');
  }
  function closeModal(){
    const m = document.getElementById('photoModal');
    if (!m) return;
    m.classList.add('hidden');
  }

  function setModal(bodyHtml, footerText){
    const body = document.getElementById('photoModalBody');
    const footer = document.getElementById('photoModalFooter');
    if (body) body.innerHTML = bodyHtml;
    if (footer) footer.textContent = footerText || '';
  }

  function toNum(x){
    const n = (typeof x === 'string') ? parseFloat(x) : x;
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  function getTargetSafe(){
    let tgt = null;
    try { if (typeof getTarget === 'function') tgt = getTarget(); } catch(e) {}
    if (!tgt) { try { if (typeof target !== 'undefined') tgt = target; } catch(e) {} }
    if (!tgt) { try { tgt = window.target; } catch(e) {} }
    return tgt;
  }

  function buildStreetViewUrl(lat, lon){
    // Read config values if available
    const key = (typeof GOOGLE_STREETVIEW_API_KEY !== 'undefined') ? GOOGLE_STREETVIEW_API_KEY : '';
    const size = (typeof STREETVIEW_SIZE !== 'undefined') ? STREETVIEW_SIZE : '640x640';
    const fov = (typeof STREETVIEW_FOV !== 'undefined') ? STREETVIEW_FOV : 90;
    const pitch = (typeof STREETVIEW_PITCH !== 'undefined') ? STREETVIEW_PITCH : 0;
    const heading = (typeof STREETVIEW_HEADING !== 'undefined') ? STREETVIEW_HEADING : null;

    if (!key) return { ok:false, reason:'no_key', url:null };

    const params = new URLSearchParams();
    params.set('size', String(size));
    params.set('location', `${lat},${lon}`);
    params.set('fov', String(fov));
    params.set('pitch', String(pitch));
    // If heading is null, omit it and let Google choose.
    if (heading !== null && heading !== undefined && heading !== '') {
      params.set('heading', String(heading));
    }
    // You can optionally enforce radius; leaving it out tends to find the best pano.
    // params.set('radius', '50');
    params.set('key', String(key));

    return {
      ok:true,
      url: `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`,
      reason:null,
    };
  }

  function setLoading(){
    setModal('<div class="muted">Loading…</div>', '');
  }

  function setNoKey(){
    setModal(
      '<div class="muted">Photo Glimpse is disabled: no Google Street View API key is set.</div>' +
      '<div class="muted" style="margin-top:8px;">Set <b>GOOGLE_STREETVIEW_API_KEY</b> in <b>js/00_config.js</b> to enable.</div>',
      ''
    );
  }

  function setError(msg){
    setModal(`<div class="muted">${msg}</div>`, 'Imagery © Google');
  }

  function setPhoto(imgUrl){
    // Crop + blur for "glimpse" effect
    const html = `
      <div class="photo-glimpse-frame">
        <img class="photo-glimpse-img" src="${imgUrl}" alt="Street View glimpse" loading="lazy" />
      </div>
      <div class="muted" style="margin-top:10px;">Tip: treat this like a quick glance — look for obvious anchors, not the exact address.</div>
    `;
    setModal(html, 'Imagery © Google');
  }

  async function showStreetViewGlimpseForTarget(){
    const tgt = getTargetSafe();
    const lat = toNum(tgt && tgt.lat);
    const lon = toNum(tgt && tgt.lon);

    // If we already loaded a glimpse for this target during this round,
    // just reopen it without re-requesting or re-charging.
    const k = targetKey(tgt);
    if (k && __cachedTargetKey === k && __cachedLoaded && __cachedHtml) {
      openModal();
      setModal(__cachedHtml, 'Imagery © Google');
      if (typeof window.log === 'function') window.log('📷 Photo Glimpse: re-opened cached image (no extra cost).');
      return { ok:true, cached:true };
    }

    if (!tgt || lat == null || lon == null) {
      if (typeof window.showToast === 'function') window.showToast('No target set yet.', false);
      return { ok:false, reason:'no_target' };
    }

    openModal();
    setLoading();

    const built = buildStreetViewUrl(lat, lon);
    if (!built.ok) {
      setNoKey();
      if (typeof window.log === 'function') window.log('📷 Photo Glimpse: disabled (no Street View API key).');
      return { ok:false, reason:'no_key' };
    }

    // We can’t reliably preflight the image without triggering another request.
    // Instead, let the <img> load and handle errors.
    setPhoto(built.url);

    // Cache the URL and mark as current target (we'll mark loaded on onload).
    __cachedTargetKey = k;
    __cachedImgUrl = built.url;
    __cachedLoaded = false;

    // Attach a one-time error handler to show a friendly message if the image fails.
    const img = document.querySelector('#photoModalBody img.photo-glimpse-img');
    if (img) {
      img.onload = () => {
        try {
          const body = document.getElementById('photoModalBody');
          __cachedHtml = body ? body.innerHTML : null;
          __cachedLoaded = true;
          try { if (typeof window.updateCostBadgesFromConfig === 'function') window.updateCostBadgesFromConfig(); } catch(e) {}
        } catch(e) {}
      };
      img.onerror = () => {
        setError('Could not load Street View imagery for this target right now (no coverage, quota, or network issue).');
        if (typeof window.log === 'function') window.log('📷 Photo Glimpse: Street View image failed to load.');
        clearCache();
      };
    }

    if (typeof window.log === 'function') window.log('📷 Photo Glimpse: Street View image loaded (or loading).');
    return { ok:true, cached:false };
  }

  function bindPhotoModal(){
    const m = document.getElementById('photoModal');
    if (!m) return;
    const close = document.getElementById('photoModalClose');
    if (close && !close.dataset.bound) {
      close.dataset.bound = '1';
      close.addEventListener('click', closeModal);
    }
    if (!m.dataset.boundBackdrop) {
      m.dataset.boundBackdrop = '1';
      m.addEventListener('click', (e) => {
        if (e.target === m) closeModal();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
      });
    }
  }

  // Expose
  window.showStreetViewGlimpseForTarget = showStreetViewGlimpseForTarget;
  window.bindPhotoModal = bindPhotoModal;
  window.clearStreetViewGlimpseCache = clearCache;
  window.isStreetViewGlimpseFreeForCurrentTarget = isStreetViewGlimpseFreeForCurrentTarget;
})();
