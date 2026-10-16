const input = document.getElementById("domainInput");
const addButton = document.getElementById("addButton");
const saveButton = document.getElementById("saveButton");
const list = document.getElementById("domainList");
const status = document.getElementById("status");

let domains = [];

// ------------------------------------------------------------
// Normalize domain
// ------------------------------------------------------------

function normalizeDomain(value) {
  value = value.trim().toLowerCase();

  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.replace(/\/.*$/, "");

  return value;
}

// ------------------------------------------------------------
// Render list
// ------------------------------------------------------------

function render() {
  list.innerHTML = "";

  if (domains.length === 0) {
    list.innerHTML = '<div class="empty">No disabled websites.</div>';

    return;
  }

  domains
    .slice()
    .sort()
    .forEach((domain) => {
      const row = document.createElement("div");
      row.className = "domain-item";

      const label = document.createElement("span");
      label.textContent = domain;

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "Remove";

      remove.onclick = () => {
        domains = domains.filter((x) => x !== domain);

        render();
      };

      row.appendChild(label);
      row.appendChild(remove);

      list.appendChild(row);
    });
}

// ------------------------------------------------------------
// Load
// ------------------------------------------------------------

async function load() {
  const result = await chrome.storage.sync.get({
    disabledDomains: [],
  });

  domains = result.disabledDomains || [];

  render();
}

// ------------------------------------------------------------
// Add
// ------------------------------------------------------------

function addDomain() {
  const domain = normalizeDomain(input.value);

  if (!domain) return;

  if (domains.includes(domain)) {
    input.value = "";

    return;
  }

  domains.push(domain);

  input.value = "";

  render();

  input.focus();
}

// ------------------------------------------------------------
// Save
// ------------------------------------------------------------

async function save() {
  await chrome.storage.sync.set({
    disabledDomains: domains,
  });

  status.textContent = "Saved!";

  setTimeout(() => {
    status.textContent = "";
  }, 1500);
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

addButton.addEventListener("click", addDomain);

saveButton.addEventListener("click", save);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addDomain();
  }
});

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------

load();
