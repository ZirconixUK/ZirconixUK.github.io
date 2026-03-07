// ---- Panels toggle (gameplay + debug overlays) ----
(() => {
  const panelGameplay = document.getElementById("panelGameplay");
  const panelDebug = document.getElementById("panelDebug");
  const panelCurses = document.getElementById("panelCurses");
  const btnGameplay = document.getElementById("btnGameplay");
  const btnDebug = document.getElementById("btnDebug");
  const btnCurses = document.getElementById("btnCurses");

  function setOpen(panel, open) {
    if (!panel) return;
    panel.classList.toggle("open", open);
  }

  if (btnGameplay && panelGameplay) {
    btnGameplay.addEventListener("click", () => {
      const willOpen = !panelGameplay.classList.contains("open");
      setOpen(panelGameplay, willOpen);
      // Optional: don't stack overlays unless you want them
      if (willOpen) {
        setOpen(panelDebug, false);
        setOpen(panelCurses, false);

        // Reset gameplay menus when opening so we never land on an empty submenu state
        const gameMenu = document.getElementById("gameMenu");
        const radarMenu = document.getElementById("radarMenu");
        const thermoMenu = document.getElementById("thermoMenu");
        const dirMenu = document.getElementById("dirMenu");
        const landmarkMenu = document.getElementById("landmarkMenu");
        const photoMenu = document.getElementById("photoMenu");
        try {
          if (gameMenu) gameMenu.classList.remove("hidden");
          if (radarMenu) radarMenu.classList.add("hidden");
          if (thermoMenu) thermoMenu.classList.add("hidden");
          if (dirMenu) dirMenu.classList.add("hidden");
          if (landmarkMenu) landmarkMenu.classList.add("hidden");
          if (photoMenu) photoMenu.classList.add("hidden");
        } catch (e) {}

        // Also reset via the shared menu helper if present.
        try { if (typeof showMenu === 'function') showMenu('main'); } catch (e) {}

        // Refresh dynamic affordability/cost badges when opening.
        try { if (typeof updateHUD === 'function') updateHUD(); } catch (e) {}
        try { if (typeof window.updateCostBadgesFromConfig === 'function') window.updateCostBadgesFromConfig(); } catch (e) {}

        // Keep the panel width snug for the icon-only main menu.
        try { if (typeof updateGameplayPanelWidth === "function") updateGameplayPanelWidth(); } catch (e) {}
      }
    });
  }

  // Curses panel toggle
  if (btnCurses && panelCurses) {
    btnCurses.addEventListener("click", () => {
      const willOpen = !panelCurses.classList.contains("open");
      setOpen(panelCurses, willOpen);
      if (willOpen) {
        setOpen(panelGameplay, false);
        setOpen(panelDebug, false);
        try { if (typeof updateCursesPanel === 'function') updateCursesPanel(); } catch (e) {}
      }
    });
  }

  // Click/tap outside the gameplay panel closes it.
  // (But don't treat clicks on the toggle button itself as "outside".)
  if (panelGameplay && btnGameplay) {
    document.addEventListener(
      "pointerdown",
      (ev) => {
        if (!panelGameplay.classList.contains("open")) return;
        const t = ev.target;
        if (!t) return;
        if (panelGameplay.contains(t)) return;
        if (btnGameplay.contains(t)) return;
        setOpen(panelGameplay, false);
      },
      true // capture so we close even if the map eats the event
    );
  }

  // Click/tap outside the curses panel closes it.
  if (panelCurses && btnCurses) {
    document.addEventListener(
      "pointerdown",
      (ev) => {
        if (!panelCurses.classList.contains("open")) return;
        const t = ev.target;
        if (!t) return;
        // When the curses panel is open, tapping ANYWHERE closes it (including the panel).
        // The only exception is the toggle button, otherwise opening would immediately close.
        if (btnCurses.contains(t)) return;
        setOpen(panelCurses, false);
      },
      true
    );
  }

  if (btnDebug && panelDebug) {
    btnDebug.addEventListener("click", () => {
      const willOpen = !panelDebug.classList.contains("open");
      setOpen(panelDebug, willOpen);
      if (willOpen) {
        setOpen(panelGameplay, false);
        setOpen(panelCurses, false);
      }
    });
  }

  // Start hidden (map-first)
  setOpen(panelGameplay, false);
  setOpen(panelDebug, false);
  setOpen(panelCurses, false);
})();


// ---- Back-compat (if older single panel ids exist) ----
(() => {
  const btn = document.getElementById("btnPanel");
  const panel = document.getElementById("panel");
  if (!btn || !panel) return;
  btn.addEventListener("click", () => panel.classList.toggle("open"));
  const x = document.getElementById("btnPanelClose");
  if (x) x.addEventListener("click", () => panel.classList.remove("open"));
})();
