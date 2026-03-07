// ---- Tools config (JSON-driven costs & options metadata) ----
window.TOOLS_CONFIG = null;

function getToolCosts(toolId, optionId) {
  const cfg = window.TOOLS_CONFIG;
  const fallback = {
    heat_cost: (typeof QUESTION_HEAT_COST === "number" ? QUESTION_HEAT_COST : 0.5),
    coin_cost: 0,
  };
  if (!cfg || !cfg.tools || !cfg.tools[toolId]) return fallback;
  const t = cfg.tools[toolId];
  const baseRaw = (t.default && typeof t.default === "object") ? t.default : fallback;
  const base = {
    heat_cost: (typeof baseRaw.heat_cost === 'number') ? baseRaw.heat_cost : fallback.heat_cost,
    coin_cost: (typeof baseRaw.coin_cost === 'number') ? baseRaw.coin_cost : 0,
  };

  if (!optionId || !Array.isArray(t.options)) return base;
  const opt = t.options.find(o => String(o.id) === String(optionId));
  if (opt && opt.cost && typeof opt.cost === "object") {
    return {
      heat_cost: (typeof opt.cost.heat_cost === "number") ? opt.cost.heat_cost : base.heat_cost,
      coin_cost: (typeof opt.cost.coin_cost === "number") ? opt.cost.coin_cost : (typeof base.coin_cost === 'number' ? base.coin_cost : 0),
    };
  }
  return base;
}

function updateCostBadgesFromConfig() {
  const map = [
    { toolId: "radar", selector: "[data-radar]", getOption: (el) => el.getAttribute("data-radar") },
    { toolId: "thermometer", selector: "[data-thermo]", getOption: (el) => el.getAttribute("data-thermo") },
    { toolId: "nsew", selector: "[data-dir]", getOption: (el) => el.getAttribute("data-dir") },
    { toolId: "landmark", selector: "[data-landmark]", getOption: (el) => el.getAttribute("data-landmark") },
    { toolId: "photo", selector: "[data-photo]", getOption: (el) => el.getAttribute("data-photo") },
  ];
  map.forEach(({toolId, selector, getOption}) => {
    document.querySelectorAll(selector).forEach(btn => {
      const optId = getOption(btn);
      let cost = getToolCosts(toolId, optId);

      // Photo costs are dynamic per round:
      // - Starter photo is always free
      // - Extra photos become free to re-open after purchase
      // - Uncorrupt becomes free once applied
      try {
        if (toolId === 'photo') {
          const id = String(optId || '').toLowerCase();
          const rs = (typeof window.getRoundStateV1 === 'function') ? window.getRoundStateV1() : null;
          const photos = (rs && Array.isArray(rs.photos)) ? rs.photos : [];

          if (id === 'starter') {
            cost = { heat_cost: 0, coin_cost: 0 };
          }

          if (id === 'near100' || id === 'near200') {
            const owned = photos.some(p => p && String(p.kind) === id && p.url);
            if (owned) cost = { heat_cost: 0, coin_cost: 0 };
          }

          if (id === 'uncorrupt') {
            const done = (rs && rs.photosUncorrupted) ? true : false;
            if (done) cost = { heat_cost: 0, coin_cost: 0 };
          }
        }
      } catch(e) {}
      const row = btn.querySelector(".costRow");
      if (!row) return;
      const items = row.querySelectorAll(".costItem");
      if (items.length >= 1) items[0].textContent = `🔥 ${Number(cost.heat_cost).toFixed(1)}`;
      if (items.length >= 2) items[1].textContent = `🟡 ${Number(cost.coin_cost||0).toFixed(0)}`;
    });
  });
}

async function loadToolsConfig() {
  try {
    const res = await fetch("tools.json", { cache: "no-store" });
    if (!res.ok) throw new Error("tools.json not found");
    window.TOOLS_CONFIG = await res.json();
    updateCostBadgesFromConfig();
  } catch (e) {
    window.TOOLS_CONFIG = null;
  }
}

loadToolsConfig();
window.updateCostBadgesFromConfig = updateCostBadgesFromConfig;
window.getToolCosts = getToolCosts;
