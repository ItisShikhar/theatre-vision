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
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const TOOLTIP_EDGE_GUTTER = 8;
  const TOOLTIP_GAP = 8;
  const enterTheatreMessage = (() => {
    try {
      return chrome.i18n?.getMessage("enterTheatreMode");
    } catch {
      return null;
    }
  })();
  const exitTheatreMessage = (() => {
    try {
      return chrome.i18n?.getMessage("exitTheatreMode");
    } catch {
      return null;
    }
  })();

  if (!enterTheatreMessage) {
    console.error("[Theatre Vision] Missing localization message: enterTheatreMode");
  }
  if (!exitTheatreMessage) {
    console.error("[Theatre Vision] Missing localization message: exitTheatreMode");
  }

  const ENTER_THEATRE_LABEL = enterTheatreMessage || "Enter Theatre Mode";
  const EXIT_THEATRE_LABEL = exitTheatreMessage || "Exit Theatre Mode";

  let activeContainer = null;
  let activeFrame = null;
  let activeButton = null;
  let exitHint = null;

  const observedPlayers = new WeakSet();
  const verifiedVideoFrames = new WeakSet();
  const buttonTooltips = new WeakMap();

  let disabledDomains = [];
  let enabledDomains = [];
  let settingsLoaded = false;

  const globalAbortController = new AbortController();
  let isTornDown = false;

  function isExtensionValid() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------
  // Load settings
  // ------------------------------------------------------------

  async function loadSettings() {
    return new Promise((resolve, reject) => {
      if (!isExtensionValid()) {
        resolve();
        return;
      }

      try {
        chrome.storage.sync.get(
          {
            disabledDomains: [],
            enabledDomains: [],
          },
          (result) => {
            let error = null;
            try {
              error = chrome.runtime?.lastError;
            } catch (err) {
              error = err;
            }

            if (error) {
              reject(new Error(error.message));
              return;
            }

            disabledDomains = normalizeDomains(result?.disabledDomains);
            enabledDomains = normalizeDomains(result?.enabledDomains);
            settingsLoaded = true;

            resolve();
          },
        );
      } catch (err) {
        reject(err);
      }
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

  // ------------------------------------------------------------
  // Frame Video Verification
  // ------------------------------------------------------------

  // Fast-path: saves ~100ms on major video sites before the button appears.
  function isKnownVideoEmbed(frame) {
    const src = (frame.src || frame.getAttribute("src") || frame.getAttribute("data-src") || "").toLowerCase();
    if (!src) return false;

    return (
      src.includes("youtube.com/embed/") ||
      src.includes("youtube-nocookie.com/embed/") ||
      src.includes("player.vimeo.com/video/") ||
      src.includes("dailymotion.com/embed/") ||
      src.includes("player.twitch.tv") ||
      src.includes("twitch.tv/embed") ||
      src.includes("tiktok.com/embed") ||
      src.includes("rumble.com/embed/") ||
      src.includes("player.kick.com") ||
      src.includes("kick.com/embed/") ||
      src.includes("bilibili.com/player/") ||
      src.includes("streamable.com/e/") ||
      src.includes("wistia.net/embed/")
    );
  }

  function isVerifiedVideoFrame(frame) {
    if (verifiedVideoFrames.has(frame)) return true;

    try {
      if (frame.contentDocument?.querySelector("video")) {
        verifiedVideoFrames.add(frame);
        return true;
      }
    } catch {}

    if (isKnownVideoEmbed(frame)) {
      verifiedVideoFrames.add(frame);
      return true;
    }

    return false;
  }

  function notifyParentVideoStatus(hasVideo) {
    if (window !== window.top) {
      try {
        window.parent.postMessage(
          {
            source: "theatre-vision",
            type: hasVideo ? "has-video" : "no-video",
          },
          "*",
        );
      } catch {}
    }
  }

  function queryFrameVideo(frame) {
    if (!(frame instanceof HTMLIFrameElement || frame instanceof HTMLFrameElement)) return;

    if (isVerifiedVideoFrame(frame)) {
      attachButton(frame);
      return;
    }

    try {
      frame.contentWindow?.postMessage(
        { source: "theatre-vision", type: "query-video" },
        "*",
      );
    } catch {}
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

  function applyImportantStyles(element, styles) {
    for (const [prop, val] of Object.entries(styles)) {
      element.style.setProperty(prop, val, "important");
    }
  }

  function isDedicatedPlayer(container) {
    return (
      container.id === "movie_player" ||
      Boolean(container.classList?.contains("html5-video-player")) ||
      Boolean(container.classList?.contains("video-js")) ||
      Boolean(container.classList?.contains("jwplayer")) ||
      Boolean(container.classList?.contains("plyr")) ||
      Boolean(container.classList?.contains("video-player")) ||
      Boolean(container.classList?.contains("video-player__container")) ||
      location.hostname.includes("youtube.com") ||
      location.hostname.includes("twitch.tv")
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
      curr.style.setProperty("z-index", "2147483645", "important");
      const computed = getComputedStyle(curr);
      if (computed.position === "static") {
        curr.style.setProperty("position", "relative", "important");
      }
      if (computed.transform !== "none") {
        curr.style.setProperty("transform", "none", "important");
      }
      if (computed.contain !== "none") {
        curr.style.setProperty("contain", "none", "important");
      }
      if (computed.filter !== "none") {
        curr.style.setProperty("filter", "none", "important");
      }
      if (computed.perspective !== "none") {
        curr.style.setProperty("perspective", "none", "important");
      }
      if (computed.clipPath !== "none") {
        curr.style.setProperty("clip-path", "none", "important");
      }
      if (
        computed.willChange.includes("transform") ||
        computed.willChange.includes("filter")
      ) {
        curr.style.setProperty("will-change", "auto", "important");
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

    applyImportantStyles(container, {
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
      applyImportantStyles(container, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });

      container.querySelectorAll("iframe,video").forEach((el) => {
        applyImportantStyles(el, {
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

    document.body.classList.add(BODY_LOCK_CLASS);
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

    applyImportantStyles(frame, {
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

    document.body.classList.add(BODY_LOCK_CLASS);
    document.body.style.overflow = "hidden";
    showExitHint();
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
    document.body.classList.remove(BODY_LOCK_CLASS);

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
    document.body.classList.remove(BODY_LOCK_CLASS);

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
    if (isTornDown) return;

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
    if (isTornDown) return;
    if (buttonStates.size === 0 && !activeContainer && !activeFrame) return;
    if (!buttonUpdateFrame) {
      buttonUpdateFrame = requestAnimationFrame(updateButtons);
    }
  }

  function createTheatreIcon(isActive) {
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("width", "96");
    svg.setAttribute("height", "96");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("aria-hidden", "true");

    const group = document.createElementNS(SVG_NAMESPACE, "g");
    group.setAttribute("fill", "none");
    group.setAttribute("stroke", "#ffffff");
    group.setAttribute("stroke-width", "2.6");
    group.setAttribute("stroke-linecap", "round");
    group.setAttribute("stroke-linejoin", "round");

    const frame = document.createElementNS(SVG_NAMESPACE, "path");
    frame.setAttribute(
      "d",
      "M14.5 11 H33.5 C39.41 11 40 11.59 40 17.5 V30.5 C40 36.41 39.41 37 33.5 37 H14.5 C8.59 37 8 36.41 8 30.5 V17.5 C8 11.59 8.59 11 14.5 11 Z",
    );

    const divider = document.createElementNS(SVG_NAMESPACE, "line");
    divider.setAttribute("x1", "8");
    divider.setAttribute("y1", "30");
    divider.setAttribute("x2", "40");
    divider.setAttribute("y2", "30");

    const leftChevron = document.createElementNS(SVG_NAMESPACE, "polyline");
    leftChevron.setAttribute(
      "points",
      isActive ? "17,16.5 21,20.5 17,24.5" : "21,16.5 17,20.5 21,24.5",
    );

    const rightChevron = document.createElementNS(SVG_NAMESPACE, "polyline");
    rightChevron.setAttribute(
      "points",
      isActive ? "31,16.5 27,20.5 31,24.5" : "27,16.5 31,20.5 27,24.5",
    );

    group.append(frame, divider, leftChevron, rightChevron);
    svg.appendChild(group);
    return svg;
  }

  function setButtonMode(button, isActive) {
    const label = isActive ? EXIT_THEATRE_LABEL : ENTER_THEATRE_LABEL;
    const icon = createTheatreIcon(isActive);
    const currentIcon = button.querySelector("svg");

    button.removeAttribute("title");
    button.setAttribute("aria-label", label);
    if (isActive) button.setAttribute("aria-keyshortcuts", "Escape");
    else button.removeAttribute("aria-keyshortcuts");

    if (currentIcon) currentIcon.replaceWith(icon);
    else button.insertBefore(icon, button.firstChild);

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

    if (
      (player instanceof HTMLIFrameElement || player instanceof HTMLFrameElement) &&
      !isVerifiedVideoFrame(player)
    ) {
      return;
    }

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

  window.addEventListener("scroll", scheduleButtonUpdate, {
    capture: true,
    signal: globalAbortController.signal,
  });
  window.addEventListener("resize", scheduleButtonUpdate, {
    signal: globalAbortController.signal,
  });

  document.documentElement.addEventListener("mouseleave", () => {
    if (buttonStates.size === 0) return;
    for (const state of buttonStates.values()) {
      state.hovering = false;
      state.isHovered = false;
      hideTooltip(state);
    }

    scheduleButtonUpdate();
  }, { signal: globalAbortController.signal });

  // ------------------------------------------------------------
  // ESC exits page mode
  // ------------------------------------------------------------

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      exitPageMode();
    }
  }, { signal: globalAbortController.signal });

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
      if (message.type === "query-video") {
        const hasVideo =
          document.querySelector("video") !== null ||
          Array.from(buttonStates.keys()).some((k) => k instanceof HTMLMediaElement);
        if (hasVideo) {
          notifyParentVideoStatus(true);
        }
        return;
      }
    }

    if (message.type === "has-video") {
      const frame = Array.from(document.querySelectorAll("iframe,frame")).find(
        (element) => element.contentWindow === event.source,
      );
      if (frame) {
        verifiedVideoFrames.add(frame);
        notifyParentVideoStatus(true);
        attachButton(frame);
        scheduleButtonUpdate();
      }
      return;
    }

    if (message.type === "no-video") {
      const frame = Array.from(document.querySelectorAll("iframe,frame")).find(
        (element) => element.contentWindow === event.source,
      );
      if (frame) {
        verifiedVideoFrames.delete(frame);
        const state = buttonStates.get(frame);
        if (state) {
          state.abortController.abort();
          state.button.remove();
          state.tooltip.remove();
          buttonStates.delete(frame);
          scheduleButtonUpdate();
        }
      }
      return;
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
  }, { signal: globalAbortController.signal });

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

      if (player instanceof HTMLMediaElement || isVerifiedVideoFrame(player)) {
        attachButton(player);
      } else {
        queryFrameVideo(player);
      }
    }
  });

  function observePlayer(player) {
    if (!observedPlayers.has(player)) {
      observedPlayers.add(player);
      resizeObserver.observe(player);

      if (player instanceof HTMLMediaElement) {
        ["loadeddata", "loadedmetadata", "canplay", "play", "playing"].forEach((evt) => {
          player.addEventListener(evt, () => {
            notifyParentVideoStatus(true);
            attachButton(player);
            scheduleButtonUpdate();
          });
        });
      } else if (player instanceof HTMLIFrameElement || player instanceof HTMLFrameElement) {
        player.addEventListener("load", () => {
          queryFrameVideo(player);
          scheduleButtonUpdate();
        });
      }
    }

    if (player instanceof HTMLMediaElement) {
      notifyParentVideoStatus(true);
      attachButton(player);
    } else if (isVerifiedVideoFrame(player)) {
      attachButton(player);
    } else {
      queryFrameVideo(player);
    }
  }

  function scanNode(root) {
    if (!isSiteEnabled() || !root) return;

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

    if (window !== window.top && root.querySelector?.("video")) {
      notifyParentVideoStatus(true);
    }

    const players = root.querySelectorAll("video,iframe,frame");
    for (let i = 0; i < players.length; i++) {
      observePlayer(players[i]);
    }

    // Shadow DOM support: inspect specific host elements rather than every DOM node
    if (root instanceof Element && root.shadowRoot) {
      scanNode(root.shadowRoot);
    }

    const shadowHosts = root.querySelectorAll(
      "ytd-player, ytd-watch-flexy, video-js, media-player, [class*='player'], [id*='player']"
    );
    for (let i = 0; i < shadowHosts.length; i++) {
      const host = shadowHosts[i];
      if (host.shadowRoot) {
        scanNode(host.shadowRoot);
      }
    }
  }

  // ============================================================
  // Mutation Observer
  // ============================================================

  const observer = new MutationObserver((mutations) => {
    let shouldUpdateButtons = false;

    for (let m = 0; m < mutations.length; m++) {
      const mutation = mutations[m];
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (
          target instanceof HTMLVideoElement ||
          target instanceof HTMLIFrameElement ||
          target instanceof HTMLFrameElement
        ) {
          if (target instanceof HTMLIFrameElement || target instanceof HTMLFrameElement) {
            queryFrameVideo(target);
          } else {
            attachButton(target);
          }
          if (buttonStates.has(target)) shouldUpdateButtons = true;
        }
      } else if (mutation.type === "childList") {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node instanceof Element) {
            if (
              node instanceof HTMLVideoElement ||
              node instanceof HTMLIFrameElement ||
              node instanceof HTMLFrameElement
            ) {
              observePlayer(node);
              shouldUpdateButtons = true;
            } else if (
              node.querySelector(
                "video,iframe,frame,ytd-player,video-js,media-player,[class*='player'],[id*='player']"
              )
            ) {
              scanNode(node);
              shouldUpdateButtons = true;
            }
          }
        }
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
    attributeFilter: ["src"],
  });

  function teardown() {
    if (isTornDown) return;
    isTornDown = true;

    clearInterval(pollInterval);
    if (buttonUpdateFrame) {
      cancelAnimationFrame(buttonUpdateFrame);
      buttonUpdateFrame = 0;
    }
    observer.disconnect();
    resizeObserver.disconnect();
    globalAbortController.abort();

    if (activeContainer || activeFrame) {
      exitPageMode();
    }

    notifyParentVideoStatus(false);

    for (const [player, state] of buttonStates) {
      state.abortController.abort();
      state.button.remove();
      state.tooltip.remove();
      buttonStates.delete(player);
    }

    if (exitHint?.isConnected) {
      exitHint.remove();
      exitHint = null;
    }
  }

  // Server switch / player swap clicks (common on streaming video sites)
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (
      target &&
      typeof target.closest === "function" &&
      target.closest(
        ".singlemv, [data-server], .server, .server-tab, .server-item, .episode, #h, #backup, [href*='#h'], [href*='#backup'], [href*='server']"
      )
    ) {
      setTimeout(() => {
        if (!isExtensionValid()) {
          teardown();
          return;
        }
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
  }, { capture: true, signal: globalAbortController.signal });

  // ============================================================
  // SPA navigation
  // ============================================================

  function handleNavigation() {
    if (!isExtensionValid()) {
      teardown();
      return;
    }

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

  window.addEventListener("yt-navigate-finish", handleNavigation, {
    signal: globalAbortController.signal,
  });
  document.addEventListener("yt-navigate-finish", handleNavigation, {
    signal: globalAbortController.signal,
  });
  window.addEventListener("yt-page-data-updated", handleNavigation, {
    signal: globalAbortController.signal,
  });
  window.addEventListener("popstate", handleNavigation, {
    signal: globalAbortController.signal,
  });

  let previousHref = location.href;
  let trackedVideoCount = 0;

  const pollInterval = setInterval(() => {
    if (!isExtensionValid()) {
      teardown();
      return;
    }

    if (location.href !== previousHref) {
      previousHref = location.href;
      handleNavigation();
      return;
    }

    // Lightweight detector:
    // If no players are tracked, check quickly if any video/iframe has appeared.
    // document.querySelector is O(1) compared to full tree traversal.
    if (buttonStates.size === 0) {
      if (document.querySelector("video,iframe,frame,ytd-player,video-js")) {
        scanNode(document);
        scheduleButtonUpdate();
      }
      return;
    }

    // If players are already active, only rescan if video count changed or if detached
    const domVideos = document.querySelectorAll("video");
    if (domVideos.length !== trackedVideoCount) {
      trackedVideoCount = domVideos.length;
      scanNode(document);
      scheduleButtonUpdate();
    }
  }, 1000);

  // ============================================================
  // Storage updates
  // ============================================================

  try {
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (!isExtensionValid()) {
        teardown();
        return;
      }

      if (
        areaName !== "sync" ||
        (!changes.disabledDomains && !changes.enabledDomains)
      ) {
        return;
      }

      loadSettings()
        .then(() => {
          if (!isExtensionValid()) {
            teardown();
            return;
          }

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
  } catch (error) {
    if (!isExtensionValid()) {
      teardown();
    } else {
      console.error(
        "[Theatre Vision] Could not register site settings listener.",
        error,
      );
    }
  }

  // ============================================================
  // Init
  // ============================================================

  (async () => {
    try {
      await loadSettings();

      if (!isSiteEnabled()) return;

      scanNode(document);
      scheduleButtonUpdate();
    } catch (error) {
      console.error("[Theatre Vision] Could not load site settings.", error);
    }
  })();
})();
