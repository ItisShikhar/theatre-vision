const siteName = document.getElementById("siteName");
const siteAddress = document.getElementById("siteAddress");
const siteFavicon = document.getElementById("siteFavicon");
const siteIconFallback = document.getElementById("siteIconFallback");
const siteToggle = document.getElementById("siteToggle");
const savedStatus = document.getElementById("savedStatus");
const statusMessage = document.getElementById("status");
const manageButton = document.getElementById("manageButton");

let currentHostname = null;
let currentRules = { disabledDomains: [], enabledDomains: [] };
let isSavingSiteRule = false;

function getStorage(defaults) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(defaults, (result) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(result);
    });
  });
}

function setStorage(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(values, () => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tabs[0] || null);
    });
  });
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.dataset.state = isError ? "error" : "info";
  statusMessage.hidden = !message;
}

function showSavedStatus(message = "") {
  savedStatus.textContent = message;
}

function setSiteFavicon(faviconUrl) {
  siteIconFallback.hidden = false;
  siteFavicon.hidden = true;
  siteFavicon.removeAttribute("src");

  if (typeof faviconUrl !== "string" || !faviconUrl) return;

  let url;
  try {
    url = new URL(faviconUrl);
  } catch {
    return;
  }

  if (!["http:", "https:", "data:"].includes(url.protocol)) return;

  siteFavicon.onload = () => {
    siteFavicon.hidden = false;
    siteIconFallback.hidden = true;
  };
  siteFavicon.onerror = () => {
    siteFavicon.hidden = true;
    siteIconFallback.hidden = false;
  };
  siteFavicon.src = url.href;
}

function setToggleDisabled(isDisabled) {
  siteToggle.setAttribute("aria-disabled", String(isDisabled));
}

function normalizeDomains(domains) {
  if (!Array.isArray(domains)) return [];

  return [...new Set(domains.map(TheatreVisionSiteRules.normalizeDomain).filter(Boolean))];
}

function hasSameDomains(domains, currentDomains) {
  const normalizedDomains = normalizeDomains(domains).sort();
  const sortedCurrentDomains = currentDomains.slice().sort();

  return JSON.stringify(normalizedDomains) === JSON.stringify(sortedCurrentDomains);
}

function renderSiteState() {
  const isEnabled = TheatreVisionSiteRules.isEnabled(
    currentHostname,
    currentRules.disabledDomains,
    currentRules.enabledDomains,
  );

  siteToggle.setAttribute("aria-checked", String(isEnabled));
  showStatus("");
}

async function loadPopup() {
  setToggleDisabled(true);
  showSavedStatus();
  showStatus("");

  try {
    const tab = await getActiveTab();
    const tabUrl = tab?.url;
    const url = tabUrl ? new URL(tabUrl) : null;
    const hostname = url && ["http:", "https:"].includes(url.protocol)
      ? TheatreVisionSiteRules.normalizeDomain(url.hostname)
      : null;

    if (!hostname) {
      siteName.textContent = "Unavailable on this page";
      siteAddress.textContent = "Open a website to change its rule";
      showStatus("Site rules are unavailable on Chrome pages and local files.");
      return;
    }

    currentHostname = hostname;
    siteName.textContent = hostname;
    siteAddress.textContent = "Theatre mode for this site";
    setSiteFavicon(tab.favIconUrl);

    const settings = await getStorage({
      disabledDomains: [],
      enabledDomains: [],
    });

    currentRules = {
      disabledDomains: normalizeDomains(settings.disabledDomains),
      enabledDomains: normalizeDomains(settings.enabledDomains),
    };

    renderSiteState();
    setToggleDisabled(false);
  } catch (error) {
    console.error("[Theatre Vision] Could not load site settings.", error);
    siteName.textContent = "Settings unavailable";
    siteAddress.textContent = "Try reopening this popup";
    showStatus("Could not load site settings.", true);
  }
}

async function saveSiteRule() {
  if (siteToggle.getAttribute("aria-disabled") === "true") return;

  const wasEnabled = siteToggle.getAttribute("aria-checked") === "true";
  const shouldEnable = !wasEnabled;
  const disabledDomains = currentRules.disabledDomains.filter(
    (domain) => domain !== currentHostname,
  );
  const enabledDomains = currentRules.enabledDomains.filter(
    (domain) => domain !== currentHostname,
  );

  if (shouldEnable) {
    enabledDomains.push(currentHostname);
  } else {
    disabledDomains.push(currentHostname);
  }

  siteToggle.setAttribute("aria-checked", String(shouldEnable));
  setToggleDisabled(true);
  showSavedStatus();
  showStatus("");
  isSavingSiteRule = true;

  try {
    await setStorage({ disabledDomains, enabledDomains });
    currentRules = { disabledDomains, enabledDomains };
    renderSiteState();
    showSavedStatus("Saved");
  } catch (error) {
    console.error("[Theatre Vision] Could not save the site rule.", error);
    siteToggle.setAttribute("aria-checked", String(wasEnabled));
    showStatus("Could not save this site rule.", true);
  } finally {
    isSavingSiteRule = false;
    setToggleDisabled(false);
  }
}

siteToggle.addEventListener("click", saveSiteRule);
manageButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "sync" ||
    (!changes.disabledDomains && !changes.enabledDomains) ||
    !currentHostname ||
    isSavingSiteRule
  ) {
    return;
  }

  const disabledDomainsMatch =
    !changes.disabledDomains ||
    hasSameDomains(changes.disabledDomains.newValue, currentRules.disabledDomains);
  const enabledDomainsMatch =
    !changes.enabledDomains ||
    hasSameDomains(changes.enabledDomains.newValue, currentRules.enabledDomains);

  if (disabledDomainsMatch && enabledDomainsMatch) return;

  loadPopup();
});

loadPopup();
