// service-worker.js
// Ephemeral background script — NO global state variables!
// All state lives in chrome.storage

// AI generation happens in sidepanel.js (has window access)
// Service worker only handles storage + tab management

// Open side panel when extension icon is clicked on LeetCode
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.includes('leetcode.com/problems/')) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// Auto-enable side panel only on LeetCode problem pages
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  const isLeetCodeProblem = tab.url && tab.url.includes('leetcode.com/problems/');

  await chrome.sidePanel.setOptions({
    tabId,
    enabled: isLeetCodeProblem,
    path: 'sidepanel/sidepanel.html'
  });
});

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {

    // Content script detected a problem — store it
    if (message.type === 'PROBLEM_DETECTED') {
      await chrome.storage.local.set({
        currentProblem: message.payload
      });
      sendResponse({ success: true });
    }

    // Side panel is asking for the current problem
    if (message.type === 'GET_CURRENT_PROBLEM') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab?.url?.includes('leetcode.com/problems/')) {
          // Step 1: Try messaging the existing content script
          try {
            const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PROBLEM_DATA' });
            if (res?.data?.title) {
              await chrome.storage.local.set({ currentProblem: res.data });
              sendResponse({ success: true, data: res.data });
              return;
            }
          } catch (e) {
            // Content script not loaded (extension was reloaded) — inject it now
            console.log('LeetHint SW: injecting content script into tab', tab.id);
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content/content.js']
              });
              // Give it time to run & extract data
              await new Promise(r => setTimeout(r, 1500));
              // Try again
              const res2 = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PROBLEM_DATA' });
              if (res2?.data?.title) {
                await chrome.storage.local.set({ currentProblem: res2.data });
                sendResponse({ success: true, data: res2.data });
                return;
              }
            } catch (injectErr) {
              console.log('LeetHint SW: inject failed', injectErr.message);
            }
          }
        } else {
          // Not on a LeetCode problem page — clear stale data
          await chrome.storage.local.remove('currentProblem');
          sendResponse({ success: true, data: null });
          return;
        }
      } catch (e) {
        console.log('LeetHint SW: tab query failed', e.message);
      }

      // Final fallback: return whatever is in storage
      const { currentProblem } = await chrome.storage.local.get('currentProblem');
      sendResponse({ success: true, data: currentProblem || null });
    }

    // Side panel is asking to generate hints
    if (message.type === 'GENERATE_HINTS') {
      try {
        const { currentProblem } = await chrome.storage.local.get('currentProblem');
        if (!currentProblem) {
          sendResponse({ success: false, error: 'No problem data found' });
          return;
        }

        // Check cache first — don't call AI again for same problem
        const cacheKey = `hints_${currentProblem.slug}`;
        const cached = await chrome.storage.local.get(cacheKey);
        if (cached[cacheKey]) {
          sendResponse({ success: true, data: cached[cacheKey] });
          return;
        }

        // Generate fresh hints
        const hints = await generateHints(currentProblem);

        // Cache the result for this problem
        await chrome.storage.local.set({ [cacheKey]: hints });

        sendResponse({ success: true, data: hints });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }

  })();
  return true; // Keep channel open for async response
});
