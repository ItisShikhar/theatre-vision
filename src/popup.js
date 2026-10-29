const siteName = document.getElementById("siteName");
const siteAddress = document.getElementById("siteAddress");
const siteToggle = document.getElementById("siteToggle");
const statusMessage = document.getElementById("status");
const manageButton = document.getElementById("manageButton");

let currentHostname = null;
let currentRules = { disabledDomains: [], enabledDomains: [] };

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
}

function setToggleDisabled(isDisabled) {
  siteToggle.setAttribute("aria-disabled", String(isDisabled));
}

function normalizeDomains(domains) {
  if (!Array.isArray(domains)) return [];

  return [...new Set(domains.map(TheatreVisionSiteRules.normalizeDomain).filter(Boolean))];
}

function renderSiteState() {
  const isEnabled = TheatreVisionSiteRules.isEnabled(
    currentHostname,
    currentRules.disabledDomains,
    currentRules.enabledDomains,
  );

  siteToggle.setAttribute("aria-checked", String(isEnabled));
  showStatus(isEnabled ? "Theatre mode is on for this site." : "Theatre mode is off for this site.");
}

async function loadPopup() {
  setToggleDisabled(true);

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
      showStatus("Chrome pages and local files do not support site rules.", true);
      return;
    }

    currentHostname = hostname;
    siteName.textContent = hostname;
    siteAddress.textContent = "Theatre mode for this site";

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

  try {
    await setStorage({ disabledDomains, enabledDomains });
    currentRules = { disabledDomains, enabledDomains };
    renderSiteState();
    showStatus("Site rule saved.");
  } catch (error) {
    console.error("[Theatre Vision] Could not save the site rule.", error);
    siteToggle.setAttribute("aria-checked", String(wasEnabled));
    showStatus("Could not save this site rule.", true);
  } finally {
    setToggleDisabled(false);
  }
}

siteToggle.addEventListener("click", saveSiteRule);
manageButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "sync" ||
    (!changes.disabledDomains && !changes.enabledDomains) ||
    !currentHostname
  ) {
    return;
  }

  loadPopup();
});

loadPopup();
