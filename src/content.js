// ============================================================
// Theatre Vision
// Content Script
// Part 1 - Foundation
// ============================================================

(() => {
  console.log("[Theatre Vision] Loaded", location.href, window === top ? "TOP" : "IFRAME");

  const BUTTON_CLASS = "vpm-button";
  const WRAPPER_CLASS = "vpm-wrapper";
  const PAGE_MODE_CLASS = "vpm-page-mode";
  const BODY_LOCK_CLASS = "vpm-body-lock";
  const TOOLTIP_EDGE_GUTTER = 8;
  const TOOLTIP_GAP = 8;
  const ENTER_THEATRE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 48 48" aria-hidden="true">
  <g fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.5 11 H33.5 C39.41 11 40 11.59 40 17.5 V30.5 C40 36.41 39.41 37 33.5 37 H14.5 C8.59 37 8 36.41 8 30.5 V17.5 C8 11.59 8.59 11 14.5 11 Z"/>
    <line x1="8" y1="30" x2="40" y2="30"/>
    <polyline points="21,16.5 17,20.5 21,24.5"/>
    <polyline points="27,16.5 31,20.5 27,24.5"/>
  </g>
</svg>`;
  const EXIT_THEATRE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 48 48" aria-hidden="true">
  <g fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.5 11 H33.5 C39.41 11 40 11.59 40 17.5 V30.5 C40 36.41 39.41 37 33.5 37 H14.5 C8.59 37 8 36.41 8 30.5 V17.5 C8 11.59 8.59 11 14.5 11 Z"/>
    <line x1="8" y1="30" x2="40" y2="30"/>
    <polyline points="17,16.5 21,20.5 17,24.5"/>
    <polyline points="31,16.5 27,20.5 31,24.5"/>
  </g>
</svg>`;

  let activeContainer = null;
  let activeFrame = null;
  let activeButton = null;
  let exitHint = null;

  const observedPlayers = new WeakSet();
  const buttonTooltips = new WeakMap();

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

    return [...new Set(domains.map(TheatreVisionSiteRules.normalizeDomain).filter(Boolean))];
  }

  function isSiteEnabled() {
    return (
      settingsLoaded &&
      TheatreVisionSiteRules.isEnabled(location.hostname, disabledDomains, enabledDomains)
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

    const hint = document.createElement("p");
    const escapeKey = document.createElement("kbd");
    hint.className = "hint";
    escapeKey.textContent = "Esc";
    hint.append("Press ", escapeKey, " to exit theatre mode");
    exitHint.appendChild(hint);

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
    // Dedicated player shortcuts
    const dedicated = player.closest(
      "#movie_player, .html5-video-player, .video-js, .jwplayer, .plyr",
    );
    if (dedicated) {
      return dedicated;
    }

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

      if (cls.includes("html5-video-container")) {
        score -= 40;
      }

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

    console.debug("[Theatre Vision] Selected container:", best, "Score:", bestScore);

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
  let elevatedAncestors = [];

  function isDedicatedPlayer(container) {
    return (
      container.id === "movie_player" ||
      Boolean(container.classList?.contains("html5-video-player")) ||
      Boolean(container.classList?.contains("video-js")) ||
      Boolean(container.classList?.contains("jwplayer")) ||
      Boolean(container.classList?.contains("plyr")) ||
      location.hostname.includes("youtube.com")
    );
  }

  function triggerPlayerResize() {
    window.dispatchEvent(new Event("resize"));
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }

  function createPlaceholder(element) {
    placeholder = document.createElement("div");
    placeholder.className = "vpm-placeholder";
    placeholder.style.width = element.offsetWidth + "px";
    placeholder.style.height = element.offsetHeight + "px";
    element.parentNode.insertBefore(placeholder, element);
  }

  function elevateAncestors(target) {
    let curr = target.parentElement;
    while (curr && curr !== document.documentElement) {
      saveOriginalStyles(curr);
      curr.style.zIndex = "2147483645";
      if (getComputedStyle(curr).position === "static") {
        curr.style.position = "relative";
      }
      elevatedAncestors.push(curr);
      curr = curr.parentElement;
    }
  }

  function restoreElevatedAncestors() {
    for (const ancestor of elevatedAncestors) {
      restoreOriginalStyles(ancestor);
    }
    elevatedAncestors = [];
  }

  function enterPageMode(container, button) {
    if (activeContainer && !document.contains(activeContainer)) {
      activeContainer = null;
      activeButton = null;
    }
    if (activeFrame && !document.contains(activeFrame)) {
      activeFrame = null;
      activeButton = null;
    }
    if (activeContainer || activeFrame) return;

    activeContainer = container;
    activeButton = button;
    setButtonMode(activeButton, true);

    createPlaceholder(container);
    elevateAncestors(container);

    saveOriginalStyles(container);
    if (!isDedicatedPlayer(container)) {
      container.querySelectorAll("iframe,video").forEach(saveOriginalStyles);
    }
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
    } else if (!isDedicatedPlayer(container)) {
      Object.assign(container.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });

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

        try {
          el.contentWindow?.postMessage({ source: "theatre-vision", type: "enter" }, "*");
        } catch {}
      });
    }

    document.body.style.overflow = "hidden";
    triggerPlayerResize();
    showExitHint();
    notifyParentFrameMode("enter");
    scheduleButtonUpdate();
  }

  function enterFrameMode(frame) {
    if (activeContainer && !document.contains(activeContainer)) {
      activeContainer = null;
      activeButton = null;
    }
    if (activeFrame && !document.contains(activeFrame)) {
      activeFrame = null;
      activeButton = null;
    }
    if (activeContainer || activeFrame) return;

    activeFrame = frame;
    activeButton = buttonStates.get(frame)?.button ?? null;
    if (activeButton) setButtonMode(activeButton, true);
    createPlaceholder(frame);
    elevateAncestors(frame);

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

    try {
      frame.contentWindow?.postMessage({ source: "theatre-vision", type: "enter" }, "*");
    } catch {}

    document.body.style.overflow = "hidden";
    scheduleButtonUpdate();
  }

  function notifyParentFrameMode(type) {
    if (window !== window.top) {
      window.parent.postMessage({ source: "theatre-vision", type }, "*");
    }
  }

  function exitFrameMode() {
    if (!activeFrame) return;

    const frame = activeFrame;
    try {
      frame.contentWindow?.postMessage({ source: "theatre-vision", type: "exit" }, "*");
    } catch {}

    restoreOriginalStyles(frame);
    placeholder?.remove();
    restoreOriginalStyles(document.body);
    restoreElevatedAncestors();

    placeholder = null;
    activeFrame = null;
    if (activeButton) setButtonMode(activeButton, false);
    activeButton = null;

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
    if (!isDedicatedPlayer(container)) {
      container.querySelectorAll("iframe,video").forEach((el) => {
        restoreOriginalStyles(el);
        try {
          el.contentWindow?.postMessage({ source: "theatre-vision", type: "exit" }, "*");
        } catch {}
      });
    }
    placeholder?.remove();
    restoreOriginalStyles(document.body);
    restoreElevatedAncestors();

    placeholder = null;
    if (activeButton) setButtonMode(activeButton, false);
    activeContainer = null;
    activeButton = null;

    triggerPlayerResize();
    notifyParentFrameMode("exit");
    scheduleButtonUpdate();
  }

  function togglePageMode(container, button, player) {
    if (activeContainer && !document.contains(activeContainer)) {
      activeContainer = null;
      activeButton = null;
    }
    if (activeFrame && !document.contains(activeFrame)) {
      activeFrame = null;
      activeButton = null;
    }

    if (player === activeFrame) {
      exitFrameMode();
      return;
    }

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

  function positionButton(video, button, container) {
    let rect = video.getBoundingClientRect();
    if ((rect.width < 30 || rect.height < 30) && container) {
      rect = container.getBoundingClientRect();
    }

    button.style.left = rect.right - 52 + "px";
    button.style.top = rect.top + 12 + "px";
  }

  function positionTooltip(button, tooltip) {
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(
      TOOLTIP_EDGE_GUTTER,
      viewportWidth - tooltipRect.width - TOOLTIP_EDGE_GUTTER,
    );
    const maxTop = Math.max(
      TOOLTIP_EDGE_GUTTER,
      viewportHeight - tooltipRect.height - TOOLTIP_EDGE_GUTTER,
    );
    let left = buttonRect.left - tooltipRect.width - TOOLTIP_GAP;
    let top = buttonRect.top + (buttonRect.height - tooltipRect.height) / 2;

    if (left < TOOLTIP_EDGE_GUTTER) {
      left = buttonRect.right + TOOLTIP_GAP;
    }

    left = Math.min(Math.max(left, TOOLTIP_EDGE_GUTTER), maxLeft);
    top = Math.min(Math.max(top, TOOLTIP_EDGE_GUTTER), maxTop);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function showTooltip(state) {
    state.tooltipVisible = true;
    state.tooltip.classList.add("vpm-tooltip-visible");
    positionTooltip(state.button, state.tooltip);
  }

  function hideTooltip(state) {
    state.tooltipVisible = false;
    state.tooltip.classList.remove("vpm-tooltip-visible");
  }

  function updateButtons() {
    buttonUpdateFrame = 0;

    if (activeContainer && !document.contains(activeContainer)) {
      activeContainer = null;
      activeButton = null;
      placeholder?.remove();
      placeholder = null;
      restoreElevatedAncestors();
    }
    if (activeFrame && !document.contains(activeFrame)) {
      activeFrame = null;
      activeButton = null;
      placeholder?.remove();
      placeholder = null;
      restoreElevatedAncestors();
    }

    for (const [player, state] of buttonStates) {
      if (!document.contains(player)) {
        state.abortController.abort();
        state.button.remove();
        state.tooltip.remove();
        buttonStates.delete(player);
        continue;
      }

      if (state.container && !document.contains(state.container)) {
        state.container = findPlayerContainer(player);
      }

      const rect = player.getBoundingClientRect();
      const containerRect = state.container ? state.container.getBoundingClientRect() : null;
      const visible =
        (rect.width > 80 && rect.height > 60 && rect.bottom > 0 && rect.top < window.innerHeight) ||
        (containerRect && containerRect.width > 120 && containerRect.height > 80 && containerRect.bottom > 0 && containerRect.top < window.innerHeight);
      const isActive =
        state.container === activeContainer ||
        state.container === activeFrame ||
        player === activeFrame;

      if (state.isActive !== isActive) {
        state.isActive = isActive;
        setButtonMode(state.button, isActive);
      }

      const isHovered =
        state.hovering ||
        state.button.matches(":hover") ||
        (state.container && state.container.matches(":hover")) ||
        player.matches(":hover");

      if (!isSiteEnabled()) {
        hideTooltip(state);
        state.button.classList.remove("vpm-visible");
      } else if (
        state.isFocused ||
        (visible && isHovered)
      ) {
        positionButton(player, state.button, state.container);
        state.button.classList.add("vpm-visible");
      } else {
        state.button.classList.remove("vpm-visible");
      }

      if (state.tooltipVisible) {
        positionTooltip(state.button, state.tooltip);
      }
    }
  }

  function scheduleButtonUpdate() {
    if (!buttonUpdateFrame) {
      buttonUpdateFrame = requestAnimationFrame(updateButtons);
    }
  }

  function setButtonMode(button, isActive) {
    const messageKey = isActive ? "exitTheatreMode" : "enterTheatreMode";
    const fallbackLabel = isActive ? "Exit Theatre Mode" : "Enter Theatre Mode";
    const localizedLabel = chrome.i18n?.getMessage(messageKey);

    if (!localizedLabel) {
      console.error(`[Theatre Vision] Missing localization message: ${messageKey}`);
    }

    const label = localizedLabel || fallbackLabel;
    const icon = isActive ? EXIT_THEATRE_ICON : ENTER_THEATRE_ICON;
    const currentIcon = button.querySelector("svg");

    button.removeAttribute("title");
    button.setAttribute("aria-label", label);
    if (isActive) button.setAttribute("aria-keyshortcuts", "Escape");
    else button.removeAttribute("aria-keyshortcuts");

    if (currentIcon) currentIcon.outerHTML = icon;
    else button.insertAdjacentHTML("afterbegin", icon);

    const tooltip = buttonTooltips.get(button);
    if (tooltip) {
      tooltip.replaceChildren();

      const tooltipLabel = document.createElement("span");
      tooltipLabel.className = "vpm-tooltip-label";
      tooltipLabel.textContent = label;
      tooltip.appendChild(tooltipLabel);

      if (isActive) {
        const shortcut = document.createElement("kbd");
        shortcut.textContent = "Esc";
        tooltip.appendChild(shortcut);
      }
    }
  }

  function createButton(video, container) {
    const button = document.createElement("button");
    const tooltip = document.createElement("span");

    button.className = BUTTON_CLASS;
    button.type = "button";
    tooltip.className = "vpm-tooltip";
    tooltip.setAttribute("aria-hidden", "true");
    tooltip.dir = "auto";
    buttonTooltips.set(button, tooltip);
    setButtonMode(button, false);

    document.body.appendChild(button);
    document.body.appendChild(tooltip);

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentContainer = (container && document.contains(container))
        ? container
        : (buttonStates.get(video)?.container || findPlayerContainer(video));

      togglePageMode(currentContainer, button, video);
      button.blur();
    });

    return button;
  }

  function attachButton(player) {
    if (buttonStates.has(player) || !document.body || !isSiteEnabled()) return;

    const container = findPlayerContainer(player);
    const rect = player.getBoundingClientRect();
    const containerRect = container ? container.getBoundingClientRect() : null;
    const isPlayerVisible =
      (rect.width > 30 && rect.height > 30 && getComputedStyle(player).display !== "none") ||
      (containerRect && containerRect.width > 80 && containerRect.height > 60 && getComputedStyle(container).display !== "none");

    if (!isPlayerVisible) {
      if (player instanceof HTMLIFrameElement || player instanceof HTMLFrameElement) {
        player.addEventListener("load", () => {
          attachButton(player);
          scheduleButtonUpdate();
        }, { once: true });
      } else if (player instanceof HTMLMediaElement) {
        ["loadeddata", "loadedmetadata", "canplay", "play"].forEach((evt) => {
          player.addEventListener(evt, () => {
            attachButton(player);
            scheduleButtonUpdate();
          }, { once: true });
        });
      }
      return;
    }

    const button = createButton(player, container);
    const abortController = new AbortController();
    const state = {
      abortController,
      button,
      container,
      hovering: false,
      isActive: false,
      isFocused: false,
      isHovered: false,
      tooltip: buttonTooltips.get(button),
      tooltipVisible: false,
    };
    const setHovering = (hovering) => {
      state.hovering = hovering;
      scheduleButtonUpdate();
    };

    buttonStates.set(player, state);

    const onMouseEnter = () => setHovering(true);
    const onMouseLeave = () => setHovering(false);

    player.addEventListener("mouseenter", onMouseEnter, {
      signal: abortController.signal,
    });
    player.addEventListener("mouseleave", onMouseLeave, {
      signal: abortController.signal,
    });

    if (container && container !== player) {
      container.addEventListener("mouseenter", onMouseEnter, {
        signal: abortController.signal,
      });
      container.addEventListener("mouseleave", onMouseLeave, {
        signal: abortController.signal,
      });
      container.addEventListener("mousemove", onMouseEnter, {
        signal: abortController.signal,
      });
    }

    if (player instanceof HTMLMediaElement) {
      ["loadeddata", "loadedmetadata", "canplay", "play", "playing"].forEach((evt) => {
        player.addEventListener(evt, () => scheduleButtonUpdate(), {
          signal: abortController.signal,
        });
      });
    }

    button.addEventListener("mouseenter", () => {
      state.isHovered = true;
      setHovering(true);
      showTooltip(state);
    }, { signal: abortController.signal });
    button.addEventListener("mouseleave", () => {
      state.isHovered = false;
      setHovering(false);
      hideTooltip(state);
    }, { signal: abortController.signal });
    button.addEventListener("focus", () => {
      state.isFocused = true;
      showTooltip(state);
      scheduleButtonUpdate();
    }, { signal: abortController.signal });
    button.addEventListener("blur", () => {
      state.isFocused = false;
      if (!state.isHovered) hideTooltip(state);
      scheduleButtonUpdate();
    }, { signal: abortController.signal });

    scheduleButtonUpdate();
  }

  window.addEventListener("scroll", scheduleButtonUpdate, true);
  window.addEventListener("resize", scheduleButtonUpdate);

  document.documentElement.addEventListener("mouseleave", () => {
    for (const state of buttonStates.values()) {
      state.hovering = false;
      state.isHovered = false;
      hideTooltip(state);
    }

    scheduleButtonUpdate();
  });

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

    if (!message || message.source !== "theatre-vision") return;

    if (window !== window.top && event.source === window.parent) {
      if (message.type === "exit") {
        exitPageMode();
        return;
      }
      if (message.type === "enter") {
        if (!activeContainer && !activeFrame) {
          const firstPlayer = Array.from(buttonStates.keys())[0] || document.querySelector("video,iframe");
          if (firstPlayer) {
            const container = buttonStates.get(firstPlayer)?.container || findPlayerContainer(firstPlayer);
            const btn = buttonStates.get(firstPlayer)?.button;
            enterPageMode(container, btn);
          }
        }
        return;
      }
    }

    if (message.type !== "enter" && message.type !== "exit") return;

    if (activeFrame && !document.contains(activeFrame)) {
      activeFrame = null;
      activeButton = null;
    }
    if (activeContainer && !document.contains(activeContainer)) {
      activeContainer = null;
      activeButton = null;
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

      if (!document.contains(player)) continue;

      if (buttonStates.has(player)) {
        scheduleButtonUpdate();
        continue;
      }

      const rect = player.getBoundingClientRect();

      if (rect.width < 100 || rect.height < 60) continue;

      attachButton(player);
    }
  });

  function observePlayer(player) {
    if (!observedPlayers.has(player)) {
      observedPlayers.add(player);
      resizeObserver.observe(player);

      if (player instanceof HTMLMediaElement) {
        ["loadeddata", "loadedmetadata", "canplay", "play", "playing"].forEach((evt) => {
          player.addEventListener(evt, () => {
            attachButton(player);
            scheduleButtonUpdate();
          });
        });
      } else if (player instanceof HTMLIFrameElement || player instanceof HTMLFrameElement) {
        player.addEventListener("load", () => {
          attachButton(player);
          scheduleButtonUpdate();
        });
      }
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
    let shouldUpdateButtons = false;

    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (
          target instanceof HTMLVideoElement ||
          target instanceof HTMLIFrameElement ||
          target instanceof HTMLFrameElement
        ) {
          attachButton(target);
          if (buttonStates.has(target)) shouldUpdateButtons = true;
        } else if (target instanceof Element) {
          const players = target.querySelectorAll("video,iframe,frame");

          if (players.length > 0) {
            players.forEach(attachButton);
            shouldUpdateButtons = true;
          }
        }
      } else {
        mutation.addedNodes.forEach(scanNode);
        if (mutation.removedNodes.length > 0) {
          shouldUpdateButtons = true;
          if (activeContainer && !document.contains(activeContainer)) {
            exitPageMode();
          }
          if (activeFrame && !document.contains(activeFrame)) {
            exitFrameMode();
          }
        }
      }
    }

    if (shouldUpdateButtons) scheduleButtonUpdate();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "src", "style"],
  });

  // Server switch / player swap clicks (common on streaming video sites)
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (
      target &&
      typeof target.closest === "function" &&
      target.closest(".singlemv, [data-server], .server, .server-tab, .server-item, .episode")
    ) {
      setTimeout(() => {
        if (activeContainer && !document.contains(activeContainer)) {
          exitPageMode();
        }
        if (activeFrame && !document.contains(activeFrame)) {
          exitFrameMode();
        }
        scanNode(document);
        scheduleButtonUpdate();
      }, 350);
    }
  }, true);

  // ============================================================
  // SPA navigation
  // ============================================================

  function handleNavigation() {
    if (activeContainer || activeFrame) {
      exitPageMode();
    }

    for (const [player, state] of buttonStates) {
      if (document.contains(player)) {
        state.container = findPlayerContainer(player);
      }
    }

    scanNode(document);
    scheduleButtonUpdate();
  }

  window.addEventListener("yt-navigate-finish", handleNavigation);
  document.addEventListener("yt-navigate-finish", handleNavigation);
  window.addEventListener("yt-page-data-updated", handleNavigation);
  window.addEventListener("popstate", handleNavigation);

  let previousHref = location.href;

  setInterval(() => {
    if (location.href !== previousHref) {
      previousHref = location.href;
      handleNavigation();
    } else {
      scanNode(document);
    }
  }, 1000);

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
          state.tooltip.remove();
          buttonStates.delete(player);
        }
      })
      .catch((error) => {
        console.error("[Theatre Vision] Could not update site settings.", error);
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
      console.error("[Theatre Vision] Could not load site settings.", error);
    }
  })();
})();
