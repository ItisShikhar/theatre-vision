(() => {
  function normalizeDomain(value) {
    if (typeof value !== "string") return null;

    const input = value.trim();
    if (!input) return null;

    let url;

    try {
      url = new URL(input.includes("://") ? input : `https://${input}`);
    } catch {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

    if (!hostname || hostname.length > 253 || hostname.includes("*")) return null;
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      return /^[\[\]a-f0-9:.]+$/.test(hostname) ? hostname : null;
    }

    const labels = hostname.split(".");
    const hasValidLabels = labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );

    return hasValidLabels ? hostname : null;
  }

  function matchesDomain(hostname, domain) {
    const normalizedHostname = normalizeDomain(hostname);
    const normalizedDomain = normalizeDomain(domain);

    return (
      Boolean(normalizedHostname) &&
      Boolean(normalizedDomain) &&
      (normalizedHostname === normalizedDomain ||
        normalizedHostname.endsWith(`.${normalizedDomain}`))
    );
  }

  function isEnabled(hostname, disabledDomains, enabledDomains) {
    const normalizedHostname = normalizeDomain(hostname);
    if (!normalizedHostname) return true;

    let matchingRule = null;

    for (const domain of Array.isArray(disabledDomains) ? disabledDomains : []) {
      const normalizedDomain = normalizeDomain(domain);

      if (
        normalizedDomain &&
        matchesDomain(normalizedHostname, normalizedDomain) &&
        (!matchingRule || normalizedDomain.length > matchingRule.domain.length)
      ) {
        matchingRule = { domain: normalizedDomain, enabled: false };
      }
    }

    for (const domain of Array.isArray(enabledDomains) ? enabledDomains : []) {
      const normalizedDomain = normalizeDomain(domain);

      if (
        normalizedDomain &&
        matchesDomain(normalizedHostname, normalizedDomain) &&
        (!matchingRule || normalizedDomain.length > matchingRule.domain.length)
      ) {
        matchingRule = { domain: normalizedDomain, enabled: true };
      }
    }

    return matchingRule?.enabled ?? true;
  }

  globalThis.ScreenlitSiteRules = Object.freeze({
    isEnabled,
    matchesDomain,
    normalizeDomain,
  });
})();
