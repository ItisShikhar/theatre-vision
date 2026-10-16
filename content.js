// ============================================================
// Video Page Mode
// Content Script
// Part 1 - Foundation
// ============================================================

(() => {
  console.log("[VPM] Loaded", location.href, window === top ? "TOP" : "IFRAME");

  const BUTTON_CLASS = "vpm-button";
  const WRAPPER_CLASS = "vpm-wrapper";
  const PAGE_MODE_CLASS = "vpm-page-mode";
  const BODY_LOCK_CLASS = "vpm-body-lock";

  let activeContainer = null;
  let activeFrame = null;
  let activeButton = null;
  let exitHint = null;

  const processedVideos = new WeakSet();

  let disabledDomains = [];

  // ------------------------------------------------------------
  // Load settings
  // ------------------------------------------------------------

  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          disabledDomains: [],
        },
        (result) => {
          disabledDomains = result.disabledDomains
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean);

          resolve();
        },
      );
    });
  }

  // ------------------------------------------------------------
  // Is extension disabled on current domain?
  // ------------------------------------------------------------

  function extensionDisabled() {
    const host = location.hostname.toLowerCase();

    return disabledDomains.some((domain) => {
      return host === domain || host.endsWith("." + domain);
    });
  }

  // ------------------------------------------------------------
  // Create ESC hint
  // ------------------------------------------------------------

  function createExitHint() {
    exitHint = document.createElement("div");

    exitHint.className = "vpm-exit-hint";

    exitHint.textContent = "Press Esc or use the button to exit theatre mode.";

    document.body.appendChild(exitHint);
  }

  // ------------------------------------------------------------
  // Show hint
  // ------------------------------------------------------------

  function showExitHint() {
    if (!exitHint) createExitHint();

    exitHint.classList.add("vpm-show");

    clearTimeout(showExitHint.timer);

    showExitHint.timer = setTimeout(() => {
      exitHint.classList.remove("vpm-show");
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

  function findPlayerContainer(video) {
    const videoRect = video.getBoundingClientRect();

    let best = video;
    let bestScore = -Infinity;

    let node = video;

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

      // Similar size to video
      score += Math.max(0, 40 - Math.abs(rect.width - videoRect.width) / 15);

      score += Math.max(0, 40 - Math.abs(rect.height - videoRect.height) / 15);

      // Similar aspect ratio
      const aspect = rect.width / rect.height;
      const videoAspect = videoRect.width / videoRect.height;

      score += Math.max(0, 25 - Math.abs(aspect - videoAspect) * 20);

      // Contains exactly one video
      if (node.querySelectorAll("video").length === 1) score += 30;

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
        Math.abs(rect.width - videoRect.width) +
        Math.abs(rect.height - videoRect.height);

      score -= distance / 50;

      if (score > bestScore) {
        bestScore = score;
        best = node;
      }

      node = node.parentElement;
    }

    console.debug("[VPM] Selected container:", best, "Score:", bestScore);

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
  // Overlay Page Mode
  // ============================================================

  let overlay = null;
  let placeholder = null;

  let originalParent = null;
  let originalNextSibling = null;

  function restoreElementPosition(element) {
    if (!originalParent) return;

    if (originalNextSibling?.parentNode === originalParent) {
      originalParent.insertBefore(element, originalNextSibling);
    } else {
      originalParent.appendChild(element);
    }
  }

  function createOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement("div");

    overlay.className = "vpm-overlay";

    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.zIndex = "2147483645";
    overlay.style.background = "#000";

    document.documentElement.appendChild(overlay);

    return overlay;
  }

  function enterPageMode(container, button) {
    if (activeContainer || activeFrame) return;

    activeContainer = container;
    activeButton = button;
    activeButton.title = "Exit theatre mode";

    originalParent = container.parentNode;
    originalNextSibling = container.nextSibling;

    placeholder = document.createElement("div");
    placeholder.style.width = container.offsetWidth + "px";
    placeholder.style.height = container.offsetHeight + "px";

    originalParent.insertBefore(placeholder, container);

    saveOriginalStyles(container);
    container.querySelectorAll("iframe,video").forEach(saveOriginalStyles);
    saveOriginalStyles(document.body);

    createOverlay();

    overlay.appendChild(container);

    Object.assign(container.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100vw",
      height: "100vh",
      maxWidth: "100vw",
      maxHeight: "100vh",
      margin: "0",
      padding: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      background: "#000",
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
    });

    document.body.style.overflow = "hidden";
    showExitHint();
    notifyParentFrameMode("enter");
  }

  function enterFrameMode(frame) {
    if (activeContainer || activeFrame) return;

    activeFrame = frame;
    originalParent = frame.parentNode;
    originalNextSibling = frame.nextSibling;

    placeholder = document.createElement("div");
    placeholder.style.width = frame.offsetWidth + "px";
    placeholder.style.height = frame.offsetHeight + "px";
    originalParent.insertBefore(placeholder, frame);

    saveOriginalStyles(frame);
    saveOriginalStyles(document.body);

    createOverlay();
    overlay.appendChild(frame);

    Object.assign(frame.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      maxWidth: "100%",
      maxHeight: "100%",
      margin: "0",
      border: "0",
    });

    document.body.style.overflow = "hidden";
  }

  function notifyParentFrameMode(type) {
    if (window !== window.top) {
      window.parent.postMessage({ source: "video-page-mode", type }, "*");
    }
  }

  function exitFrameMode() {
    if (!activeFrame) return;

    const frame = activeFrame;
    restoreOriginalStyles(frame);
    restoreElementPosition(frame);
    placeholder?.remove();
    overlay?.remove();
    restoreOriginalStyles(document.body);

    placeholder = null;
    overlay = null;
    originalParent = null;
    originalNextSibling = null;
    activeFrame = null;

    notifyParentFrameMode("exit");
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
    restoreElementPosition(container);
    placeholder?.remove();
    overlay?.remove();
    restoreOriginalStyles(document.body);

    placeholder = null;
    overlay = null;
    originalParent = null;
    originalNextSibling = null;
    if (activeButton) activeButton.title = "Enter theatre mode";
    activeContainer = null;
    activeButton = null;

    notifyParentFrameMode("exit");
  }

  function togglePageMode(container, button) {
    console.log("[VPM] CLICK", container);

    if (container === activeContainer) {
      exitPageMode();
      return;
    }

    enterPageMode(container, button);
  }

  // ============================================================
  // Floating Button
  // ============================================================

  const buttonMap = new WeakMap();

  function positionButton(video, button) {
    const rect = video.getBoundingClientRect();

    button.style.left = rect.right - 52 + "px";
    button.style.top = rect.top + 12 + "px";
  }

  function createButton(video, container) {
    const button = document.createElement("button");

    button.className = BUTTON_CLASS;

    button.innerHTML = `
<svg viewBox="0 0 24 24">
<path d="M4 9h2V6h3V4H4zm10-5v2h3v3h2V4zm3 13h-3v2h5v-5h-2zM6 14H4v5h5v-2H6z"/>
</svg>
`;

    button.title = "Enter theatre mode";

    document.body.appendChild(button);

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      togglePageMode(container, button);
    });

    buttonMap.set(video, button);

    return button;
  }

  function attachButton(video) {
    if (processedVideos.has(video)) return;

    if (!isVisible(video)) return;

    const container = findPlayerContainer(video);

    const button = createButton(video, container);

    let hovering = false;

    function update() {
      if (!document.contains(video)) {
        button.remove();
        return;
      }

      const rect = video.getBoundingClientRect();

      const visible =
        rect.width > 120 &&
        rect.height > 80 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight;

      if (container === activeContainer) {
        positionButton(video, button);
        button.classList.add("vpm-visible");
      } else if (visible && hovering) {
        positionButton(video, button);

        button.classList.add("vpm-visible");
      } else {
        button.classList.remove("vpm-visible");
      }

      requestAnimationFrame(update);
    }

    video.addEventListener("mouseenter", () => {
      hovering = true;
    });

    video.addEventListener("mouseleave", () => {
      hovering = false;

      if (container !== activeContainer) button.classList.remove("vpm-visible");
    });

    requestAnimationFrame(update);

    processedVideos.add(video);
  }

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
      message.source !== "video-page-mode" ||
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
      const video = entry.target;

      if (processedVideos.has(video)) continue;

      const rect = video.getBoundingClientRect();

      if (rect.width < 100 || rect.height < 60) continue;

      attachButton(video);
    }
  });

  function observeVideo(video) {
    if (video.__vpmObserved) return;

    video.__vpmObserved = true;

    resizeObserver.observe(video);
  }

  function scanNode(root) {
    if (extensionDisabled()) return;

    if (root instanceof HTMLVideoElement) {
      observeVideo(root);

      return;
    }

    if (!(root instanceof Element)) return;

    root.querySelectorAll("video").forEach(observeVideo);

    // Shadow DOM support

    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) scanNode(el.shadowRoot);
    });
  }

  scanNode(document);

  // ============================================================
  // Mutation Observer
  // ============================================================

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(scanNode);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,

    subtree: true,
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

  chrome.storage.onChanged.addListener(async () => {
    await loadSettings();
  });

  // ============================================================
  // Init
  // ============================================================

  (async () => {
    await loadSettings();

    if (extensionDisabled()) return;

    createExitHint();
  })();
})();
