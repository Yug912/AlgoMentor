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
// When user navigates AWAY from LeetCode, tell sidepanel to clear stale state
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  const isLeetCodeProblem = tab.url && tab.url.includes('leetcode.com/problems/');

  await chrome.sidePanel.setOptions({
    tabId,
    enabled: isLeetCodeProblem,
    path: 'sidepanel/sidepanel.html'
  });

  // Only send NO_PROBLEM if this tab explicitly navigated to a non-LeetCode URL
  // (Don't fire on tab switches — only on actual page navigations)
  if (!isLeetCodeProblem && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
    await chrome.storage.local.remove('currentProblem');
    chrome.runtime.sendMessage({ type: 'NO_PROBLEM' }).catch(() => {});
  }
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

        if (!tab?.url?.includes('leetcode.com/problems/')) {
          // Not on a LeetCode problem page — clear stale data
          await chrome.storage.local.remove('currentProblem');
          sendResponse({ success: true, data: null });
          return;
        }

        // ── FAST PATH: return cached data from storage immediately ──
        const stored = await chrome.storage.local.get('currentProblem');
        if (stored.currentProblem?.title) {
          sendResponse({ success: true, data: stored.currentProblem });
          return;
        }

        // ── SLOW PATH: storage empty — ask content script directly ──
        try {
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PROBLEM_DATA' });
          if (res?.data?.title) {
            await chrome.storage.local.set({ currentProblem: res.data });
            sendResponse({ success: true, data: res.data });
            return;
          }
        } catch (e) {
          // Content script not loaded — inject it
          console.log('LeetHint SW: injecting content script into tab', tab.id);
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content/content.js']
            });
            // Give it time to render & extract data
            await new Promise(r => setTimeout(r, 1000));
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

      } catch (e) {
        console.log('LeetHint SW: tab query failed', e.message);
      }

      // Final fallback
      sendResponse({ success: true, data: null });
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
