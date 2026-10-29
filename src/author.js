(() => {
  const author = Object.freeze({
    name: "Shikhar Srivastava",
    links: Object.freeze({
      github: Object.freeze({
        label: "GitHub",
        url: "https://github.com/ItisShikhar",
        icon: "../assets/github.svg",
      }),
      linkedin: Object.freeze({
        label: "LinkedIn",
        url: "https://www.linkedin.com/in/itisshikhar",
        icon: "../assets/linkedin.svg",
      }),
      sourceCode: Object.freeze({
        label: "Source code",
        url: "https://github.com/ItisShikhar/theatre-vision",
      }),
    }),
  });

  document.querySelectorAll("[data-author-name]").forEach((element) => {
    element.textContent = author.name;
  });

  document.querySelectorAll("[data-author-link]").forEach((anchor) => {
    const link = author.links[anchor.dataset.authorLink];
    if (!link) return;

    const linkLabel =
      anchor.dataset.authorLink === "sourceCode"
        ? TheatreVisionI18n.getMessage("sourceCodeLabel", [], link.label)
        : link.label;

    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.setAttribute(
      "aria-label",
      anchor.hasAttribute("data-author-name-link")
        ? TheatreVisionI18n.getMessage(
          "authorProfileLink",
          [author.name, linkLabel],
          `${author.name} on ${linkLabel}`,
        )
        : linkLabel,
    );

    const labelElement = anchor.querySelector("[data-author-label]");
    if (labelElement) labelElement.textContent = linkLabel;

    const icon = anchor.querySelector("[data-author-icon]");
    if (icon && link.icon) icon.src = link.icon;
  });

  globalThis.TheatreVisionAuthor = author;
})();
