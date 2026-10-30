# Privacy Policy for Theatre Vision

Last updated: October 30, 2026

Theatre Vision ("the extension") is an open-source browser extension developed by Shikhar Srivastava. This Privacy Policy describes how the extension handles user information.

## Summary

Theatre Vision does not collect, transmit, store, or sell any personal data, browsing history, or user activity. All processing happens locally on your device inside your browser.

## Data Collection and Transmission

- **No Remote Servers or Analytics:** Theatre Vision has no backend servers, database, analytics services, or tracking beacons. It does not send any data to the developer or any third party.
- **No Personal Information:** The extension does not collect names, email addresses, IP addresses, credentials, or personal communications.
- **Local DOM and Video Inspection:** When you visit a website, the extension's content script inspects the webpage structure (DOM) locally on your device to find video players (such as `<video>` tags and embedded player iframes) and resize them to fill your browser window. No page content or media is copied, logged, or transmitted.

## Settings Storage

- **User Preferences:** Theatre Vision saves your allow and block rules (domain names where you enable or disable theatre mode) using the standard browser `chrome.storage.sync` API.
- **Syncing:** If you enable browser synchronization, your browser vendor (such as Google for Chrome) syncs these domain rules across your signed-in devices using your account. The developer cannot view or access your synced settings.

## Permissions

Theatre Vision requests the minimum permissions required to perform its single purpose:

1. **Host Permission (`<all_urls>`):**
   HTML5 videos and player iframes appear across various websites on the internet. To detect and expand video players on whatever site you visit, the content script must have permission to run on all URLs. The script executes only on your local machine to resize player elements.

2. **Storage (`storage`):**
   Required to store your custom whitelist and blacklist domain preferences so they persist across browser restarts.

## Third-Party Disclosures

Theatre Vision does not:
- Sell or rent user data to third parties.
- Use or transfer data for purposes unrelated to the extension's core feature.
- Use or transfer data for advertising, creditworthiness assessment, or lending purposes.

## Security

Because no user data is collected or transmitted outside your local browser environment, there is no risk of remote data interception or server-side data leaks from this extension.

## Open Source and Auditing

The complete source code for Theatre Vision is publicly available for review and auditing at:
https://github.com/ItisShikhar/theatre-vision

## Contact

If you have questions or feedback about this Privacy Policy, open an issue on GitHub:
https://github.com/ItisShikhar/theatre-vision/issues
