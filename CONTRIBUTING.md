# Contributing

Thank you for helping improve Theatre Vision.

## Report a Bug

Before you open an issue:

- Search existing issues for the same problem.
- Describe the steps that cause the problem.
- Include your operating system, Chrome version, extension version, and the affected site.
- State what you expected and what happened.
- Include relevant console errors. Remove private data first.

## Request a Feature

Describe the problem that you want to solve. Explain how the feature can help
people who use Theatre Vision. Name any affected sites or player types.

## Develop and Test

Theatre Vision is a Chrome extension. It does not need a package install or a
build step.

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the project folder.
4. After a code change, reload the extension and refresh affected tabs.
5. Test the popup, site rules, video controls, and `Esc` exit.
6. If you change UI text, update the message in every locale under `_locales/`.

Run these commands to check JavaScript syntax:

```bash
node --check src/content.js
node --check src/options.js
node --check src/popup.js
node --check src/i18n.js
```

## Pull Requests

- Keep each pull request focused on one fix or feature.
- Describe the change and how you tested it.
- Update the documentation when behavior changes.
- Keep extension permissions to the minimum required. Explain each permission change.
- Include tests when the project adds an automated test suite.

## Code Style

- Use the existing JavaScript and CSS patterns.
- Keep functions focused and names clear.
- Use accessible labels and status messages for UI controls.
- Add new UI text through Chrome localization. Keep message keys consistent across all locales.

Thank you for contributing to Theatre Vision.
