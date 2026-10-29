// ============================================================
// Screenlit
// Content Script
// Part 1 - Foundation
// ============================================================

(() => {
  console.log("[Screenlit] Loaded", location.href, window === top ? "TOP" : "IFRAME");

  const BUTTON_CLASS = "vpm-button";
  const WRAPPER_CLASS = "vpm-wrapper";
  const PAGE_MODE_CLASS = "vpm-page-mode";
  const BODY_LOCK_CLASS = "vpm-body-lock";

  let activeContainer = null;
  let activeFrame = null;
  let activeButton = null;
  let exitHint = null;

  const observedPlayers = new WeakSet();

  let disabledDomains = [];
  let enabledDomains = [];
  let settingsLoaded = false;

  // ------------------------------------------------------------
  // Load settings
  // ------------------------------------------------------------

  async function loadSettings() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(
        {
          disabledDomains: [],
          enabledDomains: [],
        },
        (result) => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(new Error(error.message));
            return;
          }

          disabledDomains = normalizeDomains(result.disabledDomains);
          enabledDomains = normalizeDomains(result.enabledDomains);
          settingsLoaded = true;

          resolve();
        },
      );
    });
  }

  function normalizeDomains(domains) {
    if (!Array.isArray(domains)) return [];

    return [...new Set(domains.map(ScreenlitSiteRules.normalizeDomain).filter(Boolean))];
  }

  function isSiteEnabled() {
    return (
      settingsLoaded &&
      ScreenlitSiteRules.isEnabled(location.hostname, disabledDomains, enabledDomains)
    );
  }

  // ------------------------------------------------------------
  // Create ESC hint
  // ------------------------------------------------------------

  function createExitHint() {
    if (exitHint?.isConnected) return exitHint;
    if (!document.body) return null;

    exitHint = document.createElement("div");

    exitHint.className = "vpm-exit-hint";

    exitHint.textContent = "Press Esc or use the button to exit theatre mode.";

    document.body.appendChild(exitHint);

    return exitHint;
  }

  // ------------------------------------------------------------
  // Show hint
  // ------------------------------------------------------------

  function showExitHint() {
    const hint = exitHint || createExitHint();
    if (!hint) return;

    hint.classList.add("vpm-show");

    clearTimeout(showExitHint.timer);

    showExitHint.timer = setTimeout(() => {
      hint.classList.remove("vpm-show");
    }, 2500);
  }

  // ------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------

  function isVisible(element) {
    const rect = element.getBoundingClientRect();

    return (
      rect.width > 30 &&
      rect.height > 30 &&
      getComputedStyle(element).display !== "none" &&
      getComputedStyle(element).visibility !== "hidden"
    );
  }

  // ============================================================
  // Smart Player Detection
  // ============================================================

  function findPlayerContainer(player) {
    const playerRect = player.getBoundingClientRect();

    let best = player;
    let bestScore = -Infinity;

    let node = player;

    while (
      node &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      const rect = node.getBoundingClientRect();

      if (rect.width < 120 || rect.height < 80) {
        node = node.parentElement;
        continue;
      }

      let score = 0;

      score += Math.max(0, 40 - Math.abs(rect.width - playerRect.width) / 15);

      score += Math.max(0, 40 - Math.abs(rect.height - playerRect.height) / 15);

      const aspect = rect.width / rect.height;
      const playerAspect = playerRect.width / playerRect.height;

      score += Math.max(0, 25 - Math.abs(aspect - playerAspect) * 20);

      if (node.querySelectorAll("video,iframe,frame").length === 1) score += 30;

      // Good player keywords
      const cls = (node.className || "").toString().toLowerCase();

      [
        "player",
        "video",
        "media",
        "jw",
        "plyr",
        "vjs",
        "shaka",
        "html5",
        "stream",
        "container",
      ].forEach((keyword) => {
        if (cls.includes(keyword)) score += 10;
      });

      const style = getComputedStyle(node);

      if (style.position === "relative") score += 10;

      if (style.display === "flex" || style.display === "grid") {
        score += 5;
      }

      // Penalize full page containers
      if (
        rect.width > window.innerWidth * 0.96 &&
        rect.height > window.innerHeight * 0.96
      ) {
        score -= 60;
      }

      // Penalize obvious layout containers
      if (node.matches("body,main,article,section,header,footer,nav,aside")) {
        score -= 40;
      }

      // Penalize lots of text
      if (node.innerText && node.innerText.length > 500) {
        score -= 30;
      }

      // Prefer shallower ancestors near the player
      const distance =
        Math.abs(rect.width - playerRect.width) +
        Math.abs(rect.height - playerRect.height);

      score -= distance / 50;

      if (score > bestScore) {
        bestScore = score;
        best = node;
      }

      node = node.parentElement;
    }

    console.debug("[Screenlit] Selected container:", best, "Score:", bestScore);

    return best;
  }

  // ============================================================
  // Part 2 - Page Mode
  // ============================================================

  const originalStyles = new WeakMap();

  // ------------------------------------------------------------
  // Save original inline styles
  // ------------------------------------------------------------

  function saveOriginalStyles(container) {
    if (originalStyles.has(container)) return;

    originalStyles.set(container, {
      style: container.getAttribute("style"),
    });
  }

  // ------------------------------------------------------------
  // Restore original inline styles
  // ------------------------------------------------------------

  function restoreOriginalStyles(container) {
    const saved = originalStyles.get(container);

    if (!saved) return;

    if (saved.style === null) container.removeAttribute("style");
    else container.setAttribute("style", saved.style);

    originalStyles.delete(container);
  }

  // ============================================================
  // In-place Page Mode
  // ============================================================

  let placeholder = null;

  function createPlaceholder(element) {
    placeholder = document.createElement("div");
    placeholder.className = "vpm-placeholder";
    placeholder.style.width = element.offsetWidth + "px";
    placeholder.style.height = element.offsetHeight + "px";
    element.parentNode.insertBefore(placeholder, element);
  }

  function enterPageMode(container, button) {
    if (activeContainer || activeFrame) return;

    activeContainer = container;
    activeButton = button;
    activeButton.title = "Exit theatre mode";

    createPlaceholder(container);

    saveOriginalStyles(container);
    container.querySelectorAll("iframe,video").forEach(saveOriginalStyles);
    saveOriginalStyles(document.body);

    Object.assign(container.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      maxWidth: "100vw",
      maxHeight: "100vh",
      zIndex: "2147483645",
      margin: "0",
      padding: "0",
      overflow: "hidden",
      background: "#000",
    });

    if (container instanceof HTMLVideoElement) {
      container.style.objectFit = "contain";
    } else {
      Object.assign(container.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });
    }

    container.querySelectorAll("iframe,video").forEach((el) => {
      Object.assign(el.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
        border: "0",
      });

      if (el instanceof HTMLVideoElement) {
        el.style.objectFit = "contain";
      }
    });

    document.body.style.overflow = "hidden";
    showExitHint();
    notifyParentFrameMode("enter");
    scheduleButtonUpdate();
  }

  function enterFrameMode(frame) {
    if (activeContainer || activeFrame) return;

    activeFrame = frame;
    createPlaceholder(frame);

    saveOriginalStyles(frame);
    saveOriginalStyles(document.body);

    Object.assign(frame.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      maxWidth: "100%",
      maxHeight: "100%",
      zIndex: "2147483645",
      margin: "0",
      border: "0",
    });

    document.body.style.overflow = "hidden";
    scheduleButtonUpdate();
  }

  function notifyParentFrameMode(type) {
    if (window !== window.top) {
      window.parent.postMessage({ source: "screenlit", type }, "*");
    }
  }

  function exitFrameMode() {
    if (!activeFrame) return;

    const frame = activeFrame;
    restoreOriginalStyles(frame);
    placeholder?.remove();
    restoreOriginalStyles(document.body);

    placeholder = null;
    activeFrame = null;

    notifyParentFrameMode("exit");
    scheduleButtonUpdate();
  }

  function exitPageMode() {
    if (activeFrame) {
      exitFrameMode();
      return;
    }

    if (!activeContainer) return;

    const container = activeContainer;
    restoreOriginalStyles(container);
    container.querySelectorAll("iframe,video").forEach(restoreOriginalStyles);
    placeholder?.remove();
    restoreOriginalStyles(document.body);

    placeholder = null;
    if (activeButton) activeButton.title = "Enter theatre mode";
    activeContainer = null;
    activeButton = null;

    notifyParentFrameMode("exit");
    scheduleButtonUpdate();
  }

  function togglePageMode(container, button) {
    if (container === activeContainer) {
      exitPageMode();
      return;
    }

    enterPageMode(container, button);
  }

  // ============================================================
  // Floating Button
  // ============================================================

  const buttonStates = new Map();
  let buttonUpdateFrame = 0;

  function positionButton(video, button) {
    const rect = video.getBoundingClientRect();

    button.style.left = rect.right - 52 + "px";
    button.style.top = rect.top + 12 + "px";
  }

  function updateButtons() {
    buttonUpdateFrame = 0;

    for (const [player, state] of buttonStates) {
      if (!document.contains(player)) {
        state.abortController.abort();
        state.button.remove();
        buttonStates.delete(player);
        continue;
      }

      const rect = player.getBoundingClientRect();
      const visible =
        rect.width > 120 &&
        rect.height > 80 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight;
      const isActive =
        state.container === activeContainer ||
        state.container === activeFrame ||
        player === activeFrame;

      if (!isSiteEnabled()) {
        state.button.classList.remove("vpm-visible");
      } else if (isActive || (visible && (state.hovering || state.button.matches(":hover")))) {
        positionButton(player, state.button);
        state.button.classList.add("vpm-visible");
      } else {
        state.button.classList.remove("vpm-visible");
      }
    }
  }

  function scheduleButtonUpdate() {
    if (!buttonUpdateFrame) {
      buttonUpdateFrame = requestAnimationFrame(updateButtons);
    }
  }

  function createButton(video, container) {
    const button = document.createElement("button");

    button.className = BUTTON_CLASS;

    button.innerHTML = `
<svg viewBox="0 0 24 24" aria-hidden="true">
<path d="M4 5h16v14H4zM7 8h2v2H7zm0 6h2v2H7zm8-6h2v2h-2zm0 6h2v2h-2z"/>
</svg>
`;

    button.title = "Enter theatre mode";

    document.body.appendChild(button);

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      togglePageMode(container, button);
    });

    return button;
  }

  function attachButton(player) {
    if (buttonStates.has(player) || !document.body || !isSiteEnabled()) return;

    if (!isVisible(player)) return;

    const container = findPlayerContainer(player);
    const button = createButton(player, container);
    const abortController = new AbortController();
    const state = { abortController, button, container, hovering: false };
    const setHovering = (hovering) => {
      state.hovering = hovering;
      scheduleButtonUpdate();
    };

    buttonStates.set(player, state);

    player.addEventListener("mouseenter", () => setHovering(true), {
      signal: abortController.signal,
    });
    player.addEventListener("mouseleave", () => setHovering(false), {
      signal: abortController.signal,
    });
    button.addEventListener("mouseenter", () => setHovering(true), {
      signal: abortController.signal,
    });
    button.addEventListener("mouseleave", () => setHovering(false), {
      signal: abortController.signal,
    });

    scheduleButtonUpdate();
  }

  window.addEventListener("scroll", scheduleButtonUpdate, true);
  window.addEventListener("resize", scheduleButtonUpdate);

  // ------------------------------------------------------------
  // ESC exits page mode
  // ------------------------------------------------------------

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      exitPageMode();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;

    if (
      !message ||
      message.source !== "screenlit" ||
      (message.type !== "enter" && message.type !== "exit")
    ) {
      return;
    }

    const frame = Array.from(document.querySelectorAll("iframe,frame")).find(
      (element) => element.contentWindow === event.source,
    );

    if (!frame) return;

    if (message.type === "enter") {
      if (!activeContainer && !activeFrame) {
        enterFrameMode(frame);
        notifyParentFrameMode("enter");
      }
    } else if (frame === activeFrame) {
      exitFrameMode();
    }
  });

  // ============================================================
  // Video detection
  // ============================================================

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const player = entry.target;

      if (buttonStates.has(player) || !document.contains(player)) continue;

      const rect = player.getBoundingClientRect();

      if (rect.width < 100 || rect.height < 60) continue;

      attachButton(player);
    }
  });

  function observePlayer(player) {
    if (!observedPlayers.has(player)) {
      observedPlayers.add(player);
      resizeObserver.observe(player);
    }

    attachButton(player);
  }

  function scanNode(root) {
    if (!isSiteEnabled()) return;

    if (
      root instanceof HTMLVideoElement ||
      root instanceof HTMLIFrameElement ||
      root instanceof HTMLFrameElement
    ) {
      observePlayer(root);

      return;
    }

    if (
      !(root instanceof Element) &&
      !(root instanceof Document) &&
      !(root instanceof ShadowRoot)
    ) {
      return;
    }

    root.querySelectorAll("video,iframe,frame").forEach(observePlayer);

    // Shadow DOM support

    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) scanNode(el.shadowRoot);
    });
  }

  // ============================================================
  // Mutation Observer
  // ============================================================

  const observer = new MutationObserver((mutations) => {
    scheduleButtonUpdate();

    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (
          target instanceof HTMLVideoElement ||
          target instanceof HTMLIFrameElement ||
          target instanceof HTMLFrameElement
        ) {
          attachButton(target);
        } else if (target instanceof Element) {
          target
            .querySelectorAll("video,iframe,frame")
            .forEach(attachButton);
        }
      } else {
        mutation.addedNodes.forEach(scanNode);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "src", "style"],
  });

  // ============================================================
  // SPA navigation
  // ============================================================

  let previousHref = location.href;

  setInterval(() => {
    if (location.href !== previousHref) {
      previousHref = location.href;

      setTimeout(() => {
        scanNode(document);
      }, 1000);
    }
  }, 500);

  // ============================================================
  // Storage updates
  // ============================================================

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName !== "sync" ||
      (!changes.disabledDomains && !changes.enabledDomains)
    ) {
      return;
    }

    loadSettings()
      .then(() => {
        if (isSiteEnabled()) {
          scanNode(document);
          scheduleButtonUpdate();
          return;
        }

        if (activeContainer || activeFrame) exitPageMode();

        for (const [player, state] of buttonStates) {
          state.abortController.abort();
          state.button.remove();
          buttonStates.delete(player);
        }
      })
      .catch((error) => {
        console.error("[Screenlit] Could not update site settings.", error);
      });
  });

  // ============================================================
  // Init
  // ============================================================

  (async () => {
    try {
      await loadSettings();

      if (!isSiteEnabled()) return;

      scanNode(document);

      if (document.body) {
        createExitHint();
      } else {
        document.addEventListener("DOMContentLoaded", createExitHint, {
          once: true,
        });
      }
    } catch (error) {
      console.error("[Screenlit] Could not load site settings.", error);
    }
  })();
})();
