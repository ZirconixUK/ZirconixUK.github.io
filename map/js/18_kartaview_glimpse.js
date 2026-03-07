// KartaView (OpenStreetCam) Photo Glimpse
// Public endpoints (no key required) via api.openstreetcam.org
(function(){
  const API_BASE = 'https://api.openstreetcam.org/2.0/photo/';

  function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  function firstArrayIn(obj){
    if (!obj || typeof obj !== 'object') return null;
    // Common shapes
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.result)) return obj.result;
    if (obj.result && Array.isArray(obj.result.data)) return obj.result.data;
    if (obj.result && Array.isArray(obj.result.photos)) return obj.result.photos;
    if (Array.isArray(obj.photos)) return obj.photos;
    // Fallback: DFS search for first array of objects with id/lat/lng
    const stack = [obj];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
          const hasId = ('id' in v[0]) || ('photoId' in v[0]);
          const hasLL = (('lat' in v[0]) || ('matchLat' in v[0])) && (('lng' in v[0]) || ('matchLng' in v[0]));
          if (hasId || hasLL) return v;
        } else if (v && typeof v === 'object') {
          stack.push(v);
        }
      }
    }
    return null;
  }

  function toNum(x){
    const n = (typeof x === 'string') ? parseFloat(x) : x;
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  function photoToImageUrl(p){
    if (!p || typeof p !== 'object') return null;
    const candidates = [
      p.lth_name, p.lthName, p.thumb_name, p.thumbName, p.image, p.url,
      p.original, p.large, p.small,
    ].filter(Boolean).map(String);

    for (const c of candidates) {
      if (/^https?:\/\//i.test(c)) return c;
      // Some APIs return relative paths under /files/photo/...
      if (c.includes('/files/photo/')) return 'https://api.openstreetcam.org' + c;
      if (c.startsWith('files/photo/')) return 'https://api.openstreetcam.org/' + c;
      if (c.includes('photo/') && (c.endsWith('.jpg') || c.endsWith('.jpeg') || c.endsWith('.png'))) {
        // Try best-effort
        if (c.startsWith('/')) return 'https://api.openstreetcam.org' + c;
        return 'https://api.openstreetcam.org/' + c;
      }
    }

    // If we only have a filename, we can't reliably reconstruct folders.
    return null;
  }

  function photoToKartaViewLink(p){
    // KartaView viewer URLs commonly use: /details/{sequenceId}/{sequenceIndex}/track-info
    const sid = p && (p.sequenceId ?? p.sequenceid);
    const sidx = p && (p.sequenceIndex ?? p.sequenceindex);
    if (sid != null && sidx != null) {
      return `https://kartaview.org/details/${sid}/${sidx}/track-info`;
    }
    return 'https://kartaview.org/map';
  }

  async function fetchNearbyPhotos(lat, lon, radiusM, limit){
    const url = API_BASE + `?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lon)}&radius=${encodeURIComponent(radiusM)}&itemsPerPage=${encodeURIComponent(limit||50)}&page=1`;
    const res = await fetch(url, { method:'GET', mode:'cors', cache:'no-store' });
    if (!res.ok) throw new Error(`KartaView API error: HTTP ${res.status}`);
    return await res.json();
  }

  
  async function fetchPhotoDetailsById(photoId){
    if (photoId == null) return null;
    // KartaView 2.0 docs describe a photo-details endpoint by id.
    // We try a couple of common URL shapes.
    const candidates = [
      `https://api.openstreetcam.org/2.0/photo/${encodeURIComponent(photoId)}`,
      `https://api.openstreetcam.org/2.0/photo/${encodeURIComponent(photoId)}/`,
      `https://api.openstreetcam.org/2.0/photo/?photoId=${encodeURIComponent(photoId)}`,
      `https://api.openstreetcam.org/2.0/photo/?id=${encodeURIComponent(photoId)}`
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { method:'GET', mode:'cors', cache:'no-store' });
        if (!res.ok) continue;
        const json = await res.json();
        // Some endpoints wrap the photo under 'result' or 'data'
        if (json && typeof json === 'object') {
          if (json.result && typeof json.result === 'object') {
            if (json.result.data && typeof json.result.data === 'object') return json.result.data;
            if (json.result.photo && typeof json.result.photo === 'object') return json.result.photo;
            return json.result;
          }
          if (json.data && typeof json.data === 'object') return json.data;
        }
        return json;
      } catch (e) {
        // try next
      }
    }
    return null;
  }

async function getGlimpse(lat, lon){
    // Expand radius until we find something.
    const radii = [40, 80, 150, 300, 600, 1200, 2500];
    for (const r of radii) {
      let json;
      try {
        json = await fetchNearbyPhotos(lat, lon, r, 50);
      } catch (e) {
        // If CORS/network fails, bail quickly.
        throw e;
      }
      const arr = firstArrayIn(json);
      if (arr && arr.length) {
        // Prefer photos that have an image URL field
        const withUrl = arr.filter(p => !!photoToImageUrl(p));
        const chosen = pickRandom(withUrl.length ? withUrl : arr);
        return { photo: chosen, radius: r };
      }
    }
    return { photo: null, radius: null };
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

  function setModalLoading(){
    const body = document.getElementById('photoModalBody');
    const footer = document.getElementById('photoModalFooter');
    if (body) body.innerHTML = '<div class="muted">Loading…</div>';
    if (footer) footer.textContent = '';
  }

  function setModalError(msg){
    const body = document.getElementById('photoModalBody');
    const footer = document.getElementById('photoModalFooter');
    if (body) body.innerHTML = `<div class="muted">${msg}</div>`;
    if (footer) {
      // Avoid external links that could reveal the target location.
      footer.textContent = 'Imagery: KartaView contributors (CC BY-SA).';
    }
  }

  function setModalPhoto(p, radius){
    const body = document.getElementById('photoModalBody');
    const footer = document.getElementById('photoModalFooter');
    const imgUrl = photoToImageUrl(p);

    if (body) {
      if (imgUrl) {
        body.innerHTML = `<img src="${imgUrl}" alt="KartaView photo glimpse" loading="lazy" />`;
      } else {
        // Don't provide external links that could reveal the target location.
        body.innerHTML = `<div class="muted">Found KartaView imagery metadata nearby (within ~${radius}m), but couldn’t obtain a direct image URL.</div>`;
      }
    }

    if (footer) {
      footer.textContent = 'Imagery: KartaView contributors (CC BY-SA).';
    }
  }

  async function showKartaViewGlimpseForTarget(){
    // Target is stored as a top-level global lexical binding (`let target = ...`) in our modular scripts.
    // That does NOT appear on `window`, so we must read it directly.
    let tgt = null;
    try {
      if (typeof getTarget === 'function') tgt = getTarget();
    } catch (e) {}
    if (!tgt) {
      try { if (typeof target !== 'undefined') tgt = target; } catch (e) {}
    }
    if (!tgt) {
      try { tgt = window.target; } catch (e) {}
    }
    const lat = toNum(tgt && tgt.lat);
    const lon = toNum(tgt && tgt.lon);
    if (!tgt || lat == null || lon == null) {
      if (typeof window.showToast === 'function') window.showToast('No target set yet.', false);
      return { ok:false, reason:'no_target' };
    }

    openModal();
    setModalLoading();

    try {
      const { photo, radius } = await getGlimpse(lat, lon);
      if (!photo) {
        setModalError('No KartaView imagery found near the target (within ~2.5km).');
        if (typeof window.log === 'function') window.log('📷 Photo Glimpse: no KartaView photos found near target.');
        return { ok:false, reason:'none' };
      }

      // If the nearby search response doesn’t include a usable image URL, try fetching
      // detailed metadata for this photo by id (often includes lth_name/thumb_name paths).
      let chosen = photo;
      if (!photoToImageUrl(chosen)) {
        const pid = chosen && (chosen.id ?? chosen.photoId ?? chosen.photo_id);
        const details = await fetchPhotoDetailsById(pid);
        if (details && typeof details === 'object') {
          chosen = Object.assign({}, details, chosen);
        }
      }

      // If we still don't have an image URL, do NOT offer an external link (it can reveal location).
      setModalPhoto(chosen, radius);
      if (typeof window.log === 'function') window.log(`📷 Photo Glimpse: found KartaView photo within ~${radius}m of target.`);
      return { ok:true, radius };
    } catch (e) {
      console.error(e);
      setModalError('Couldn\'t load KartaView imagery right now (network/CORS).');
      if (typeof window.log === 'function') window.log('📷 Photo Glimpse: failed to load KartaView imagery (see console).');
      return { ok:false, reason:'error' };
    }
  }

  // Wire modal close
  function bindModal(){
    const closeBtn = document.getElementById('photoModalClose');
    const modal = document.getElementById('photoModal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  window.showKartaViewGlimpseForTarget = showKartaViewGlimpseForTarget;
  window.bindPhotoModal = bindModal;
})();
