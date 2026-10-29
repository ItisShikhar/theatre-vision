(() => {
  const extensionI18n = globalThis.chrome?.i18n;
  const uiLanguage = extensionI18n?.getUILanguage?.() || "en";

  function getMessage(key, substitutions = [], fallback = "") {
    return extensionI18n?.getMessage(key, substitutions) || fallback;
  }

  function localizeAttribute(attribute, dataAttribute) {
    document.querySelectorAll(`[${dataAttribute}]`).forEach((element) => {
      const key = element.getAttribute(dataAttribute);
      const fallback = element.getAttribute(attribute) || "";
      element.setAttribute(attribute, getMessage(key, [], fallback));
    });
  }

  document.documentElement.lang = uiLanguage.replace("_", "-");
  document.documentElement.dir = /^ar(?:[-_]|$)/i.test(uiLanguage) ? "rtl" : "ltr";

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const fallback = element.textContent.trim();
    element.textContent = getMessage(element.dataset.i18n, [], fallback);
  });

  localizeAttribute("aria-label", "data-i18n-aria-label");
  localizeAttribute("placeholder", "data-i18n-placeholder");
  localizeAttribute("alt", "data-i18n-alt");

  globalThis.TheatreVisionI18n = Object.freeze({ getMessage });
})();
