// Service worker — handles tab screenshot capture

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureTab') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.warn('Capture failed:', chrome.runtime.lastError.message);
        sendResponse(null);
      } else {
        sendResponse(dataUrl);
      }
    });
    return true; // Keep channel open for async response
  }

  if (msg.action === 'doodleDeactivated') {
    // Could update badge if needed
  }
});
