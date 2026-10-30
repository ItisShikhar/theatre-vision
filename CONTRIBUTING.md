# Contributing

Thank you for helping improve Theatre Vision.

## Report a Bug

Before you open an issue:

- Search existing issues for the same problem.
- Describe the steps that cause the problem.
- Include your operating system, browser and version, extension version, and the affected site.
- State what you expected and what happened.
- Include relevant console errors. Remove private data first.

## Request a Feature

Describe the problem that you want to solve. Explain how the feature can help
people who use Theatre Vision. Name any affected sites or player types.

## Develop and Test

Theatre Vision is a WebExtension for Chrome, Edge, Vivaldi, and Firefox for desktop 142 or later. It does not need a package install or a build step.

Use the browser-specific installation steps in the README. After a code
change, reload the extension and refresh affected tabs.

Test the popup, site rules, video controls, and `Esc` exit in each target
browser when possible.

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
- Do not change the Firefox add-on ID after release. Firefox uses it to sync extension data.

## Release

To create a Web Store ZIP locally on Windows, macOS, or Linux, run this Git
command from the repository root. It packages the committed `HEAD`, so commit
changes before packaging them.

```bash
git archive --format=zip --output=theatre_vision_ext.zip HEAD manifest.json _locales src assets/logo_compact_bg_16.png assets/logo_compact_bg_32.png assets/logo_compact_bg_48.png assets/logo_compact_bg_128.png assets/logo_compact_bg_512.png assets/logo_sm.png assets/github.svg assets/linkedin.svg assets/fonts/oswald-cyrillic-ext.woff2 assets/fonts/oswald-cyrillic.woff2 assets/fonts/oswald-vietnamese.woff2 assets/fonts/oswald-latin-ext.woff2 assets/fonts/oswald-latin.woff2 assets/fonts/OFL.txt
```

1. Update the version in `manifest.json`, then commit and push the change.
2. Create and push a matching version tag. For version `1.2.0`, run:

   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

The GitHub Actions release workflow checks that the tag matches the manifest
version, packages the extension, and attaches the ZIP to a GitHub Release.

## Code Style

- Use the existing JavaScript and CSS patterns.
- Keep functions focused and names clear.
- Use accessible labels and status messages for UI controls.
- Add new UI text through browser localization. Keep message keys consistent across all locales.

Thank you for contributing to Theatre Vision.
