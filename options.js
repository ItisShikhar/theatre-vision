const domainInput = document.getElementById("domainInput");
const addButton = document.getElementById("addButton");
const saveButton = document.getElementById("saveButton");
const domainList = document.getElementById("domainList");
const enabledList = document.getElementById("enabledList");
const status = document.getElementById("status");

let disabledDomains = [];
let enabledDomains = [];
let statusTimer = 0;

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
  status.textContent = message;
  status.dataset.state = isError ? "error" : "info";

  if (message && !isError) {
    statusTimer = setTimeout(() => {
      status.textContent = "";
    }, 1800);
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
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove ${domain}`);
    removeButton.addEventListener("click", () => {
      if (list === domainList) {
        disabledDomains = disabledDomains.filter((item) => item !== domain);
      } else {
        enabledDomains = enabledDomains.filter((item) => item !== domain);
      }

      render();
    });

    row.append(label, removeButton);
    list.appendChild(row);
  });
}

function render() {
  renderDomainList(domainList, disabledDomains, "No disabled websites.");
  renderDomainList(enabledList, enabledDomains, "No enabled exceptions.");
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
    showStatus("Could not load site rules.", true);
  }
}

function addDomain() {
  const domain = TheatreVisionSiteRules.normalizeDomain(domainInput.value);

  if (!domain) {
    showStatus("Enter a valid website domain.", true);
    domainInput.focus();
    return;
  }

  if (disabledDomains.includes(domain)) {
    showStatus("This domain is already disabled.", true);
    domainInput.focus();
    return;
  }

  disabledDomains.push(domain);
  enabledDomains = enabledDomains.filter((item) => item !== domain);
  domainInput.value = "";
  showStatus("");
  render();
  domainInput.focus();
}

async function save() {
  saveButton.disabled = true;

  try {
    await setStorage({ disabledDomains, enabledDomains });
    showStatus("Site rules saved.");
  } catch (error) {
    console.error("[Theatre Vision] Could not save site rules.", error);
    showStatus("Could not save site rules.", true);
  } finally {
    saveButton.disabled = false;
  }
}

addButton.addEventListener("click", addDomain);
saveButton.addEventListener("click", save);
domainInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addDomain();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || (!changes.disabledDomains && !changes.enabledDomains)) {
    return;
  }

  load();
});

load();
