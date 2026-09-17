// Opens the extension in the browser side panel when the toolbar icon is clicked,
// so it stays open while you navigate from token to token (Hold mode).
chrome.runtime.onInstalled.addListener(function () {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
  }
});
