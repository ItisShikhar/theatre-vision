// Reserved for future features.
//
// Potential uses:
// - Keyboard shortcuts
// - Context menu
// - Toolbar button actions
// - Cross-tab communication
//
// Keeping this file now avoids needing to update the manifest later.

chrome.runtime.onInstalled.addListener(() => {
    console.log("Video Page Mode installed.");
});