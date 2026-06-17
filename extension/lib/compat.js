// Normalises chrome.* vs browser.* across Chromium and Firefox.
// Import this everywhere instead of referencing either global directly.
const ext = (typeof browser !== 'undefined') ? browser : chrome;
export default ext;
