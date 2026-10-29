const domainInput = document.getElementById("domainInput");
const addButton = document.getElementById("addButton");
const enabledDomainInput = document.getElementById("enabledDomainInput");
const enableButton = document.getElementById("enableButton");
const domainList = document.getElementById("domainList");
const enabledList = document.getElementById("enabledList");
const blockedStatus = document.getElementById("blockedStatus");
const enabledStatus = document.getElementById("enabledStatus");
const status = document.getElementById("status");
const t = (key, substitutions = [], fallback = "") =>
  TheatreVisionI18n.getMessage(key, substitutions, fallback);

let disabledDomains = [];
let enabledDomains = [];
let statusTimer = 0;
let statusClearTimer = 0;
let saveQueue = Promise.resolve();

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

function normalizeDomains(domains) {
  if (!Array.isArray(domains)) return [];

  return [...new Set(domains.map(TheatreVisionSiteRules.normalizeDomain).filter(Boolean))];
}

function showStatus(message, isError = false) {
  clearTimeout(statusTimer);
  clearTimeout(statusClearTimer);

  status.textContent = message;
  status.dataset.state = isError ? "error" : "info";
  status.dataset.visible = "false";

  if (!message) return;

  void status.offsetWidth;
  status.dataset.visible = "true";

  if (!isError) {
    statusTimer = setTimeout(() => {
      status.dataset.visible = "false";
      statusClearTimer = setTimeout(() => {
        if (status.dataset.visible === "false") {
          status.textContent = "";
        }
        statusClearTimer = 0;
      }, 220);
    }, 3200);
  }
}

function renderDomainList(list, domains, emptyMessage) {
  list.replaceChildren();

  if (domains.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = emptyMessage;
    list.appendChild(empty);
    return;
  }

  domains.slice().sort().forEach((domain) => {
    const row = document.createElement("div");
    row.className = "domain-item";

    const label = document.createElement("span");
    label.className = "domain-name";
    label.textContent = domain;

    const removeButton = document.createElement("button");
    removeButton.className = "remove";
    removeButton.type = "button";
    removeButton.setAttribute(
      "aria-label",
      t("removeDomainLabel", [domain], `Remove ${domain}`),
    );

    const removeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    removeIcon.setAttribute("viewBox", "0 0 24 24");
    removeIcon.setAttribute("aria-hidden", "true");
    removeIcon.setAttribute("focusable", "false");

    const removeIconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    removeIconPath.setAttribute(
      "d",
      "M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v7m4-7v7",
    );
    removeIconPath.setAttribute("fill", "none");
    removeIconPath.setAttribute("stroke", "currentColor");
    removeIconPath.setAttribute("stroke-linecap", "round");
    removeIconPath.setAttribute("stroke-linejoin", "round");
    removeIconPath.setAttribute("stroke-width", "1.7");

    removeIcon.appendChild(removeIconPath);
    removeButton.appendChild(removeIcon);

    removeButton.addEventListener("click", () => {
      if (list === domainList) {
        disabledDomains = disabledDomains.filter((item) => item !== domain);
      } else {
        enabledDomains = enabledDomains.filter((item) => item !== domain);
      }

      render();
      void saveRules();
    });

    row.append(label, removeButton);
    list.appendChild(row);
  });
}

function render() {
  renderDomainList(
    domainList,
    disabledDomains,
    t("noBlockedDomains", [], "No blocked domains."),
  );
  renderDomainList(
    enabledList,
    enabledDomains,
    t("noAllowedSubdomains", [], "No allowed subdomains."),
  );
}

async function load() {
  try {
    const result = await getStorage({
      disabledDomains: [],
      enabledDomains: [],
    });

    disabledDomains = normalizeDomains(result.disabledDomains);
    enabledDomains = normalizeDomains(result.enabledDomains);
    render();
  } catch (error) {
    console.error("[Theatre Vision] Could not load site rules.", error);
    showStatus(t("couldNotLoadSiteRules", [], "Could not load site rules."), true);
  }
}

function showFieldStatus(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function addDomain(input, fieldStatus, isException) {
  const domain = TheatreVisionSiteRules.normalizeDomain(input.value);

  if (!domain) {
    showFieldStatus(
      fieldStatus,
      t("enterValidDomain", [], "Enter a valid website domain."),
    );
    input.focus();
    return;
  }

  const targetDomains = isException ? enabledDomains : disabledDomains;

  if (
    isException &&
    !disabledDomains.some(
      (blockedDomain) =>
        blockedDomain !== domain &&
        TheatreVisionSiteRules.matchesDomain(domain, blockedDomain),
    )
  ) {
    showFieldStatus(
      fieldStatus,
      t(
        "enterSubdomainOfBlockedDomain",
        [],
        "Enter a subdomain of a blocked domain.",
      ),
    );
    input.focus();
    return;
  }

  if (targetDomains.includes(domain)) {
    showFieldStatus(
      fieldStatus,
      isException
        ? t("subdomainAlreadyAllowed", [], "This subdomain is already allowed.")
        : t("domainAlreadyBlocked", [], "This domain is already blocked."),
    );
    input.focus();
    return;
  }

  if (isException) {
    enabledDomains.push(domain);
    disabledDomains = disabledDomains.filter((item) => item !== domain);
  } else {
    disabledDomains.push(domain);
    enabledDomains = enabledDomains.filter((item) => item !== domain);
  }

  input.value = "";
  showFieldStatus(fieldStatus, "");
  showStatus("");
  render();
  void saveRules();
  input.focus();
}

async function saveRules() {
  const rules = {
    disabledDomains: [...disabledDomains],
    enabledDomains: [...enabledDomains],
  };
  const saveOperation = saveQueue.catch(() => {}).then(() => setStorage(rules));
  saveQueue = saveOperation;

  try {
    await saveOperation;
    showStatus(t("saved", [], "Saved"));
  } catch (error) {
    console.error("[Theatre Vision] Could not save site rules.", error);
    showStatus(t("couldNotSaveSiteRules", [], "Could not save site rules."), true);
  }
}

addButton.addEventListener("click", () => addDomain(domainInput, blockedStatus, false));
enableButton.addEventListener("click", () =>
  addDomain(enabledDomainInput, enabledStatus, true),
);
domainInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addDomain(domainInput, blockedStatus, false);
});
enabledDomainInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    addDomain(enabledDomainInput, enabledStatus, true);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || (!changes.disabledDomains && !changes.enabledDomains)) {
    return;
  }

  load();
});

load();
