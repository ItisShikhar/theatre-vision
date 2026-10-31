// ============================================================
// Theatre Vision
// Content Script
// Part 1 - Foundation
// ============================================================

(() => {
  console.log(
    "[Theatre Vision] Loaded",
    location.href,
    window === top ? "TOP" : "IFRAME",
  );

  const BUTTON_CLASS = "vpm-button";
  const WRAPPER_CLASS = "vpm-wrapper";
  const PAGE_MODE_CLASS = "vpm-page-mode";
  const BODY_LOCK_CLASS = "vpm-body-lock";
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const TOOLTIP_EDGE_GUTTER = 8;
  const TOOLTIP_GAP = 8;
  const BUTTON_IDLE_DELAY = 3000;
  const BUTTON_IDLE_CLASS = "vpm-button-idle";
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
  const switchTheatreMessage = (() => {
    try {
      return chrome.i18n?.getMessage("switchToTheatreMode");
    } catch {
      return null;
    }
  })();

  if (!enterTheatreMessage) {
    console.warn(
      "[Theatre Vision] Missing localization message: enterTheatreMode",
    );
  }
  if (!exitTheatreMessage) {
    console.warn(
      "[Theatre Vision] Missing localization message: exitTheatreMode",
    );
  }
  if (!switchTheatreMessage) {
    console.warn(
      "[Theatre Vision] Missing localization message: switchToTheatreMode",
    );
  }

  const ENTER_THEATRE_LABEL = enterTheatreMessage || "Enter Theatre Mode";
  const EXIT_THEATRE_LABEL = exitTheatreMessage || "Exit Theatre Mode";
  const SWITCH_THEATRE_LABEL = switchTheatreMessage || "Switch to Theatre Mode";

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

    return [
      ...new Set(
        domains.map(TheatreVisionSiteRules.normalizeDomain).filter(Boolean),
      ),
    ];
  }

  function isSiteEnabled() {
    return (
      settingsLoaded &&
      TheatreVisionSiteRules.isEnabled(
        location.hostname,
        disabledDomains,
        enabledDomains,
      )
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
    const src = (
      frame.src ||
      frame.getAttribute("src") ||
      frame.getAttribute("data-src") ||
      ""
    ).toLowerCase();
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
    if (
      !(frame instanceof HTMLIFrameElement || frame instanceof HTMLFrameElement)
    )
      return;

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

    console.debug(
      "[Theatre Vision] Selected container:",
      best,
      "Score:",
      bestScore,
    );

    return best;
  }

  // ============================================================
  // Part 2 - Page Mode
  // ============================================================

  const originalStyles = new WeakMap();

  function applyImportantStyles(element, styles) {
    if (!originalStyles.has(element)) {
      originalStyles.set(element, new Map());
    }
    const saved = originalStyles.get(element);

    for (const [prop, val] of Object.entries(styles)) {
      const cssProp = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      if (!saved.has(cssProp)) {
        saved.set(cssProp, {
          value: element.style.getPropertyValue(cssProp),
          priority: element.style.getPropertyPriority(cssProp),
        });
      }
      element.style.setProperty(cssProp, val, "important");
    }
  }

  function restoreOriginalStyles(element) {
    const saved = originalStyles.get(element);
    if (!saved) return;

    for (const [cssProp, original] of saved) {
      if (original.value) {
        element.style.setProperty(cssProp, original.value, original.priority);
      } else {
        element.style.removeProperty(cssProp);
      }
    }

    if (!element.getAttribute("style")) {
      element.removeAttribute("style");
    }

    originalStyles.delete(element);
  }

  function clearImportantStyles(element) {
    const saved = originalStyles.get(element);
    if (!saved) return;

    for (const cssProp of saved.keys()) {
      if (element.style.getPropertyPriority(cssProp) === "important") {
        element.style.removeProperty(cssProp);
      }
    }

    if (!element.getAttribute("style")) {
      element.removeAttribute("style");
    }

    originalStyles.delete(element);
  }

  // ============================================================
  // In-place Page Mode
  // ============================================================

  let placeholder = null;
  let elevatedAncestors = [];
  const savedMaxHeights = new Map();

  function applyMaxHeightOverrides(target) {
    restoreMaxHeightOverrides();
    let curr = target;
    while (
      curr &&
      curr !== document &&
      curr !== document.documentElement.parentElement
    ) {
      const inlineMaxHeight = curr.style.getPropertyValue("max-height");
      const computed = getComputedStyle(curr);

      if (
        inlineMaxHeight ||
        (computed.maxHeight && computed.maxHeight !== "none")
      ) {
        savedMaxHeights.set(curr, {
          value: inlineMaxHeight,
          priority: curr.style.getPropertyPriority("max-height"),
        });
        curr.style.setProperty("max-height", "none", "important");
      }
      curr = curr.parentElement;
    }
  }

  function restoreMaxHeightOverrides() {
    for (const [node, original] of savedMaxHeights) {
      if (document.contains(node)) {
        if (original.value) {
          node.style.setProperty(
            "max-height",
            original.value,
            original.priority,
          );
        } else {
          node.style.removeProperty("max-height");
        }
        if (!node.getAttribute("style")) {
          node.removeAttribute("style");
        }
      }
    }
    savedMaxHeights.clear();
  }

  function clearMaxHeightOverrides() {
    for (const [node] of savedMaxHeights) {
      if (document.contains(node)) {
        if (node.style.getPropertyPriority("max-height") === "important") {
          node.style.removeProperty("max-height");
        }
        if (!node.getAttribute("style")) {
          node.removeAttribute("style");
        }
      }
    }
    savedMaxHeights.clear();
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
      const computed = getComputedStyle(curr);
      const overrides = { zIndex: "2147483647" };
      if (computed.position === "static") {
        overrides.position = "relative";
      }
      if (computed.transform !== "none") {
        overrides.transform = "none";
      }
      if (computed.contain !== "none") {
        overrides.contain = "none";
      }
      if (computed.filter !== "none") {
        overrides.filter = "none";
      }
      if (computed.perspective !== "none") {
        overrides.perspective = "none";
      }
      if (computed.clipPath !== "none") {
        overrides.clipPath = "none";
      }
      if (
        computed.willChange.includes("transform") ||
        computed.willChange.includes("filter")
      ) {
        overrides.willChange = "auto";
      }
      applyImportantStyles(curr, overrides);
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

  function clearElevatedAncestors() {
    for (const ancestor of elevatedAncestors) {
      clearImportantStyles(ancestor);
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
    applyMaxHeightOverrides(container);

    applyImportantStyles(container, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      maxWidth: "100vw",
      maxHeight: "100vh",
      zIndex: "2147483647",
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
          el.contentWindow?.postMessage(
            { source: "theatre-vision", type: "enter" },
            "*",
          );
        } catch {}
      });
    }

    applyImportantStyles(document.body, { overflow: "hidden" });
    document.body.classList.add(BODY_LOCK_CLASS);
    triggerPlayerResize();
    showExitHint();
    notifyParentFrameMode("enter");
    resetButtonIdleTimer(getActiveButtonState());
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
    applyMaxHeightOverrides(frame);

    applyImportantStyles(frame, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      maxWidth: "100%",
      maxHeight: "100%",
      zIndex: "2147483647",
      margin: "0",
      border: "0",
    });

    try {
      frame.contentWindow?.postMessage(
        { source: "theatre-vision", type: "enter" },
        "*",
      );
    } catch {}

    applyImportantStyles(document.body, { overflow: "hidden" });
    document.body.classList.add(BODY_LOCK_CLASS);
    showExitHint();
    resetButtonIdleTimer(getActiveButtonState());
    scheduleButtonUpdate();
  }

  function notifyParentFrameMode(type) {
    if (window !== window.top) {
      window.parent.postMessage({ source: "theatre-vision", type }, "*");
    }
  }

  function exitFrameMode(triggerResize = true, enteringFullscreen = false) {
    if (!activeFrame) return;

    const frame = activeFrame;
    try {
      frame.contentWindow?.postMessage(
        { source: "theatre-vision", type: "exit" },
        "*",
      );
    } catch {}

    if (enteringFullscreen) {
      clearImportantStyles(frame);
      clearMaxHeightOverrides();
      clearElevatedAncestors();
      if (document.body.style.getPropertyPriority("overflow") === "important") {
        document.body.style.removeProperty("overflow");
      }
      if (!document.body.getAttribute("style")) {
        document.body.removeAttribute("style");
      }
      originalStyles.delete(document.body);
    } else {
      restoreOriginalStyles(frame);
      restoreMaxHeightOverrides();
      restoreElevatedAncestors();
      restoreOriginalStyles(document.body);
    }

    placeholder?.remove();
    document.body.classList.remove(BODY_LOCK_CLASS);

    placeholder = null;
    activeFrame = null;
    if (activeButton) setButtonMode(activeButton, false);
    activeButton = null;

    notifyParentFrameMode("exit");
    if (triggerResize) {
      triggerPlayerResize();
    }
    scheduleButtonUpdate();
  }

  function exitPageMode(triggerResize = true, enteringFullscreen = false) {
    if (activeFrame) {
      exitFrameMode(triggerResize, enteringFullscreen);
      return;
    }

    if (!activeContainer) return;

    const container = activeContainer;
    if (enteringFullscreen) {
      clearImportantStyles(container);
      clearMaxHeightOverrides();
      if (!isDedicatedPlayer(container)) {
        container.querySelectorAll("iframe,video").forEach((el) => {
          clearImportantStyles(el);
          try {
            el.contentWindow?.postMessage(
              { source: "theatre-vision", type: "exit" },
              "*",
            );
          } catch {}
        });
      }
      clearElevatedAncestors();
      if (document.body.style.getPropertyPriority("overflow") === "important") {
        document.body.style.removeProperty("overflow");
      }
      if (!document.body.getAttribute("style")) {
        document.body.removeAttribute("style");
      }
      originalStyles.delete(document.body);
    } else {
      restoreOriginalStyles(container);
      restoreMaxHeightOverrides();
      if (!isDedicatedPlayer(container)) {
        container.querySelectorAll("iframe,video").forEach((el) => {
          restoreOriginalStyles(el);
          try {
            el.contentWindow?.postMessage(
              { source: "theatre-vision", type: "exit" },
              "*",
            );
          } catch {}
        });
      }
      restoreElevatedAncestors();
      restoreOriginalStyles(document.body);
    }

    placeholder?.remove();
    document.body.classList.remove(BODY_LOCK_CLASS);

    placeholder = null;
    if (activeButton) setButtonMode(activeButton, false);
    activeContainer = null;
    activeButton = null;

    if (triggerResize) {
      triggerPlayerResize();
    }
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
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth;
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
      restoreMaxHeightOverrides();
    }
    if (activeFrame && !document.contains(activeFrame)) {
      activeFrame = null;
      activeButton = null;
      placeholder?.remove();
      placeholder = null;
      restoreElevatedAncestors();
      restoreMaxHeightOverrides();
    }

    for (const [player, state] of buttonStates) {
      if (!document.contains(player)) {
        state.abortController.abort();
        clearButtonIdleTimer(state);
        state.button.remove();
        state.tooltip.remove();
        buttonStates.delete(player);
        continue;
      }

      if (state.container && !document.contains(state.container)) {
        state.container = findPlayerContainer(player);
      }

      const rect = player.getBoundingClientRect();
      const containerRect = state.container
        ? state.container.getBoundingClientRect()
        : null;
      const visible =
        (rect.width > 80 &&
          rect.height > 60 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight) ||
        (containerRect &&
          containerRect.width > 120 &&
          containerRect.height > 80 &&
          containerRect.bottom > 0 &&
          containerRect.top < window.innerHeight);
      const isActive =
        state.container === activeContainer ||
        state.container === activeFrame ||
        player === activeFrame;
      const isNativeFullscreen = Boolean(
        document.fullscreenElement || document.webkitFullscreenElement,
      );

      const targetMode = isNativeFullscreen
        ? "fullscreen"
        : isActive
          ? "theatre"
          : "normal";

      if (state.mode !== targetMode) {
        state.mode = targetMode;
        state.isActive = isActive;
        setButtonMode(state.button, targetMode);
      }

      const isHovered =
        state.hovering ||
        state.button.matches(":hover") ||
        (state.container && state.container.matches(":hover")) ||
        player.matches(":hover");
      const isTheatreExitButton =
        state.button === activeButton &&
        Boolean(activeContainer || activeFrame);

      if (!isSiteEnabled()) {
        hideTooltip(state);
        state.button.classList.remove("vpm-visible");
      } else if (
        state.isFocused ||
        (isTheatreExitButton
          ? !state.isIdle
          : visible && isHovered && !state.isIdle)
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

  function getActiveButtonState() {
    for (const state of buttonStates.values()) {
      if (state.button === activeButton) return state;
    }

    return null;
  }

  function resetButtonIdleTimer(state) {
    if (!state) return;

    clearTimeout(state.idleTimer);
    state.idleTimer = 0;
    const wasIdle = state.isIdle;
    state.isIdle = false;
    state.button.classList.remove(BUTTON_IDLE_CLASS);
    if (wasIdle) scheduleButtonUpdate();

    state.idleTimer = setTimeout(() => {
      state.idleTimer = 0;
      if (!state.button.isConnected || state.isFocused) return;

      state.isIdle = true;
      state.button.classList.add(BUTTON_IDLE_CLASS);
      hideTooltip(state);
      scheduleButtonUpdate();
    }, BUTTON_IDLE_DELAY);
  }

  function clearButtonIdleTimer(state) {
    clearTimeout(state.idleTimer);
    state.idleTimer = 0;
  }

  function hideTheatreButtonForPointerExit() {
    if (!activeContainer && !activeFrame) return;

    const state = getActiveButtonState();
    if (!state) return;

    clearButtonIdleTimer(state);
    state.isIdle = true;
    state.button.classList.add(BUTTON_IDLE_CLASS);
    hideTooltip(state);
    scheduleButtonUpdate();
  }

  function notifyParentPointerActivity() {
    if (window === window.top) return;

    window.parent.postMessage(
      { source: "theatre-vision", type: "pointer-activity" },
      "*",
    );
  }

  function handlePointerActivity(forceNotifyParent = false, interactedFrameState = null) {
    let shouldNotifyParent = forceNotifyParent;

    if (activeContainer || activeFrame) {
      resetButtonIdleTimer(getActiveButtonState());
      shouldNotifyParent = true;
    }

    for (const [player, state] of buttonStates) {
      if (
        state.button === activeButton &&
        (activeContainer || activeFrame)
      ) {
        continue;
      }

      const isHovered =
        state.hovering ||
        state.button.matches(":hover") ||
        (state.container && state.container.matches(":hover")) ||
        player.matches(":hover");
      if (state === interactedFrameState || isHovered) {
        resetButtonIdleTimer(state);
        shouldNotifyParent = true;
      }
    }

    if (shouldNotifyParent) notifyParentPointerActivity();
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

  function setButtonMode(button, mode) {
    const isTheatre = mode === true || mode === "theatre";
    const isFullscreen =
      mode === "fullscreen" ||
      (!isTheatre &&
        Boolean(
          document.fullscreenElement || document.webkitFullscreenElement,
        ));
    const label = isTheatre
      ? EXIT_THEATRE_LABEL
      : isFullscreen
        ? SWITCH_THEATRE_LABEL
        : ENTER_THEATRE_LABEL;
    const icon = createTheatreIcon(isTheatre);
    const currentIcon = button.querySelector("svg");

    button.removeAttribute("title");
    button.setAttribute("aria-label", label);
    if (isTheatre) button.setAttribute("aria-keyshortcuts", "Escape");
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

      if (isTheatre) {
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

    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentContainer =
        container && document.contains(container)
          ? container
          : buttonStates.get(video)?.container || findPlayerContainer(video);

      const fsElement =
        document.fullscreenElement || document.webkitFullscreenElement;

      if (fsElement) {
        if (activeContainer || activeFrame) {
          exitPageMode(false, true);
        }

        try {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            await document.webkitExitFullscreen();
          }
        } catch (err) {
          console.debug("[Theatre Vision] exitFullscreen error:", err);
        }

        try {
          if (
            video instanceof HTMLIFrameElement ||
            video instanceof HTMLFrameElement
          ) {
            video.contentWindow?.postMessage(
              { source: "theatre-vision", type: "exit-native-fullscreen" },
              "*",
            );
          }
        } catch {}

        if (button.parentElement !== document.body && document.body) {
          document.body.appendChild(button);
          const currentTooltip = buttonTooltips.get(button);
          if (currentTooltip && currentTooltip.parentElement !== document.body) {
            document.body.appendChild(currentTooltip);
          }
        }

        await new Promise((resolve) => requestAnimationFrame(resolve));

        if (
          video instanceof HTMLIFrameElement ||
          video instanceof HTMLFrameElement
        ) {
          enterFrameMode(video);
        } else {
          enterPageMode(currentContainer, button);
        }
        button.blur();
        return;
      }

      togglePageMode(currentContainer, button, video);
      button.blur();
    });

    return button;
  }

  function attachButton(player) {
    if (buttonStates.has(player) || !document.body || !isSiteEnabled()) return;

    if (
      (player instanceof HTMLIFrameElement ||
        player instanceof HTMLFrameElement) &&
      !isVerifiedVideoFrame(player)
    ) {
      return;
    }

    const container = findPlayerContainer(player);
    const rect = player.getBoundingClientRect();
    const containerRect = container ? container.getBoundingClientRect() : null;
    const isPlayerVisible =
      (rect.width > 30 &&
        rect.height > 30 &&
        getComputedStyle(player).display !== "none") ||
      (containerRect &&
        containerRect.width > 80 &&
        containerRect.height > 60 &&
        getComputedStyle(container).display !== "none");

    if (!isPlayerVisible) {
      if (
        player instanceof HTMLIFrameElement ||
        player instanceof HTMLFrameElement
      ) {
        player.addEventListener(
          "load",
          () => {
            attachButton(player);
            scheduleButtonUpdate();
          },
          { once: true },
        );
      } else if (player instanceof HTMLMediaElement) {
        ["loadeddata", "loadedmetadata", "canplay", "play"].forEach((evt) => {
          player.addEventListener(
            evt,
            () => {
              attachButton(player);
              scheduleButtonUpdate();
            },
            { once: true },
          );
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
      idleTimer: 0,
      isIdle: false,
      hovering: false,
      isActive: false,
      mode: "normal",
      isFocused: false,
      isHovered: false,
      tooltip: buttonTooltips.get(button),
      tooltipVisible: false,
    };
    const setHovering = (hovering) => {
      state.hovering = hovering;
      if (hovering) resetButtonIdleTimer(state);
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
      ["loadeddata", "loadedmetadata", "canplay", "play", "playing"].forEach(
        (evt) => {
          player.addEventListener(evt, () => scheduleButtonUpdate(), {
            signal: abortController.signal,
          });
        },
      );
    }

    button.addEventListener(
      "mouseenter",
      () => {
        state.isHovered = true;
        setHovering(true);
        showTooltip(state);
      },
      { signal: abortController.signal },
    );
    button.addEventListener(
      "mouseleave",
      () => {
        state.isHovered = false;
        setHovering(false);
        hideTooltip(state);
      },
      { signal: abortController.signal },
    );
    button.addEventListener(
      "focus",
      () => {
        state.isFocused = true;
        resetButtonIdleTimer(state);
        showTooltip(state);
        scheduleButtonUpdate();
      },
      { signal: abortController.signal },
    );
    button.addEventListener(
      "blur",
      () => {
        state.isFocused = false;
        if (!state.isHovered) hideTooltip(state);
        resetButtonIdleTimer(state);
        scheduleButtonUpdate();
      },
      { signal: abortController.signal },
    );

    scheduleButtonUpdate();
  }

  function handleFullscreenChange() {
    const fsElement =
      document.fullscreenElement || document.webkitFullscreenElement;

    if (fsElement && (activeContainer || activeFrame)) {
      exitPageMode(false, true);
    }

    for (const [player, state] of buttonStates) {
      if (
        fsElement &&
        !(
          fsElement instanceof HTMLIFrameElement ||
          fsElement instanceof HTMLFrameElement
        )
      ) {
        if (fsElement.contains(player) || fsElement === player) {
          if (state.button.parentElement !== fsElement) {
            fsElement.appendChild(state.button);
            fsElement.appendChild(state.tooltip);
          }
        }
      } else {
        if (state.button.parentElement !== document.body && document.body) {
          document.body.appendChild(state.button);
          document.body.appendChild(state.tooltip);
        }
      }
      setButtonMode(state.button, false);
    }
    scheduleButtonUpdate();
  }

  window.addEventListener("scroll", scheduleButtonUpdate, {
    capture: true,
    signal: globalAbortController.signal,
  });
  window.addEventListener("resize", scheduleButtonUpdate, {
    signal: globalAbortController.signal,
  });
  window.addEventListener("pointermove", handlePointerActivity, {
    capture: true,
    passive: true,
    signal: globalAbortController.signal,
  });
  document.addEventListener("fullscreenchange", handleFullscreenChange, {
    signal: globalAbortController.signal,
  });
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange, {
    signal: globalAbortController.signal,
  });

  document.documentElement.addEventListener(
    "mouseleave",
    (event) => {
      if (event.relatedTarget === null) {
        hideTheatreButtonForPointerExit();
      }

      if (buttonStates.size === 0) return;
      for (const state of buttonStates.values()) {
        state.hovering = false;
        state.isHovered = false;
        hideTooltip(state);
      }

      scheduleButtonUpdate();
    },
    { signal: globalAbortController.signal },
  );

  // ------------------------------------------------------------
  // ESC exits page mode
  // ------------------------------------------------------------

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        exitPageMode();
      }
    },
    { signal: globalAbortController.signal },
  );

  window.addEventListener(
    "message",
    (event) => {
      const message = event.data;

      if (!message || message.source !== "theatre-vision") return;

      if (message.type === "pointer-activity") {
        const frame = Array.from(
          document.querySelectorAll("iframe,frame"),
        ).find((element) => element.contentWindow === event.source);
        if (frame) {
          handlePointerActivity(true, buttonStates.get(frame));
        }
        return;
      }

      if (window !== window.top && event.source === window.parent) {
        if (message.type === "exit-native-fullscreen") {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            try {
              if (document.exitFullscreen) {
                document.exitFullscreen();
              } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
              }
            } catch {}
          }
          return;
        }
        if (message.type === "exit") {
          exitPageMode();
          return;
        }
        if (message.type === "enter") {
          if (!activeContainer && !activeFrame) {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
              try {
                document.exitFullscreen?.();
              } catch {}
            }
            const firstPlayer =
              Array.from(buttonStates.keys())[0] ||
              document.querySelector("video,iframe");
            if (firstPlayer) {
              const container =
                buttonStates.get(firstPlayer)?.container ||
                findPlayerContainer(firstPlayer);
              const btn = buttonStates.get(firstPlayer)?.button;
              enterPageMode(container, btn);
            }
          }
          return;
        }
        if (message.type === "query-video") {
          const hasVideo =
            document.querySelector("video") !== null ||
            Array.from(buttonStates.keys()).some(
              (k) => k instanceof HTMLMediaElement,
            );
          if (hasVideo) {
            notifyParentVideoStatus(true);
          }
          return;
        }
      }

      if (message.type === "has-video") {
        const frame = Array.from(
          document.querySelectorAll("iframe,frame"),
        ).find((element) => element.contentWindow === event.source);
        if (frame) {
          verifiedVideoFrames.add(frame);
          notifyParentVideoStatus(true);
          attachButton(frame);
          scheduleButtonUpdate();
        }
        return;
      }

      if (message.type === "no-video") {
        const frame = Array.from(
          document.querySelectorAll("iframe,frame"),
        ).find((element) => element.contentWindow === event.source);
        if (frame) {
          verifiedVideoFrames.delete(frame);
          const state = buttonStates.get(frame);
          if (state) {
            state.abortController.abort();
            clearButtonIdleTimer(state);
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
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            try {
              document.exitFullscreen?.();
            } catch {}
          }
          enterFrameMode(frame);
          notifyParentFrameMode("enter");
        }
      } else if (frame === activeFrame) {
        exitFrameMode();
      }
    },
    { signal: globalAbortController.signal },
  );

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
        ["loadeddata", "loadedmetadata", "canplay", "play", "playing"].forEach(
          (evt) => {
            player.addEventListener(evt, () => {
              notifyParentVideoStatus(true);
              attachButton(player);
              scheduleButtonUpdate();
            });
          },
        );
      } else if (
        player instanceof HTMLIFrameElement ||
        player instanceof HTMLFrameElement
      ) {
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
      "ytd-player, ytd-watch-flexy, video-js, media-player, [class*='player'], [id*='player']",
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
          if (
            target instanceof HTMLIFrameElement ||
            target instanceof HTMLFrameElement
          ) {
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
                "video,iframe,frame,ytd-player,video-js,media-player,[class*='player'],[id*='player']",
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

    restoreMaxHeightOverrides();

    if (activeContainer || activeFrame) {
      exitPageMode();
    }

    notifyParentVideoStatus(false);

    for (const [player, state] of buttonStates) {
      state.abortController.abort();
      clearButtonIdleTimer(state);
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
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      if (
        target &&
        typeof target.closest === "function" &&
        target.closest(
          ".singlemv, [data-server], .server, .server-tab, .server-item, .episode, #h, #backup, [href*='#h'], [href*='#backup'], [href*='server']",
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
    },
    { capture: true, signal: globalAbortController.signal },
  );

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
            clearButtonIdleTimer(state);
            state.button.remove();
            state.tooltip.remove();
            buttonStates.delete(player);
          }
        })
        .catch((error) => {
          console.error(
            "[Theatre Vision] Could not update site settings.",
            error,
          );
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
