// ---- Tools config (JSON-driven costs & options metadata) ----
window.TOOLS_CONFIG = null;

function getToolCosts(toolId, optionId) {
  const cfg = window.TOOLS_CONFIG;
  const fallback = {
    heat_cost: (typeof QUESTION_HEAT_COST === "number" ? QUESTION_HEAT_COST : 0.5),
  };
  if (!cfg || !cfg.tools || !cfg.tools[toolId]) return fallback;
  const t = cfg.tools[toolId];
  const base = (t.default && typeof t.default === "object") ? t.default : fallback;

  if (!optionId || !Array.isArray(t.options)) return base;
  const opt = t.options.find(o => String(o.id) === String(optionId));
  if (opt && opt.cost && typeof opt.cost === "object") {
    return {
      heat_cost: (typeof opt.cost.heat_cost === "number") ? opt.cost.heat_cost : base.heat_cost,
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

      // If Photo Glimpse has already been purchased/viewed for the current target,
      // re-opening it should be free (both UI and in-game).
      try {
        if (toolId === 'photo' && String(optId).toLowerCase() === 'glimpse') {
          const isFree = (typeof window.isStreetViewGlimpseFreeForCurrentTarget === 'function')
            ? window.isStreetViewGlimpseFreeForCurrentTarget()
            : false;
          if (isFree) {
            cost = { heat_cost: 0 };
          }
        }
      } catch(e) {}
      const row = btn.querySelector(".costRow");
      if (!row) return;
      const items = row.querySelectorAll(".costItem");
      if (items.length >= 1) items[0].textContent = `🔥 ${Number(cost.heat_cost).toFixed(1)}`;
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
