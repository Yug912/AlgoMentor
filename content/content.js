// content.js
// Runs directly on LeetCode problem pages
// Job: Extract problem data and send it to the side panel via service worker

// ─────────────────────────────────────────────
// 1. EXTRACT PROBLEM DATA FROM DOM
// ─────────────────────────────────────────────

function getProblemData() {
  // --- TITLE ---
  const titleEl =
    document.querySelector('.text-title-large a') ||
    document.querySelector('[data-cy="question-title"]') ||
    document.querySelector('h1');

  let title = '';
  if (titleEl) {
    title = titleEl.textContent.trim();
  } else {
    const pageTitle = document.title;
    title = pageTitle.replace(' - LeetCode', '').trim();
  }

  // --- DIFFICULTY ---
  let difficulty = 'Unknown';
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent.trim();
    if (
      (text === 'Easy' || text === 'Medium' || text === 'Hard') &&
      el.children.length === 0
    ) {
      difficulty = text;
      break;
    }
  }

  // --- SLUG & NUMBER ---
  const urlParts = window.location.pathname.split('/');
  const slug = urlParts[2] || '';

  const numberEl = document.querySelector('.text-label-3') ||
                   document.querySelector('[data-cy="question-number"]');
  const problemNumber = numberEl ? numberEl.textContent.trim().replace('.', '') : '';

  // --- DESCRIPTION ---
  // LeetCode class names change frequently — try many selectors in order
  const descEl =
    document.querySelector('[data-track-load="description_content"]') || // Most stable
    document.querySelector('.elfjS') ||                                   // 2023 class
    document.querySelector('[class*="question-content"]') ||              // Wildcard
    document.querySelector('.question-content') ||                        // Old UI
    document.querySelector('[data-key="description-content"]') ||
    document.querySelector('.content__u3I1') ||
    // Last resort: find the description tab panel
    document.querySelector('[role="tabpanel"] .prose') ||
    document.querySelector('[role="tabpanel"]');

  let description = descEl ? descEl.innerText.trim() : '';

  // Extra fallback: grab text from description tab area
  if (!description) {
    const tabPanel = document.querySelector('[data-layout-path="/c0/ts0/t0"]') ||
                     document.querySelector('[class*="description"]');
    if (tabPanel) description = tabPanel.innerText.trim();
  }

  return { title, difficulty, slug, problemNumber, description };
}


// ─────────────────────────────────────────────
// 2. WAIT FOR LEETCODE TO FINISH RENDERING
// ─────────────────────────────────────────────
// LeetCode is React-based → DOM loads AFTER the JS runs
// We use MutationObserver to detect when content is ready

function waitForProblemAndExtract() {
  // Check if problem title is already in DOM
  const alreadyLoaded = document.querySelector('.text-title-large') ||
                        document.querySelector('[data-cy="question-title"]') ||
                        document.querySelector('h1');

  if (alreadyLoaded) {
    // DOM is ready, extract and send immediately
    sendProblemData();
    return;
  }

  // DOM not ready yet — watch for changes
  const observer = new MutationObserver(() => {
    const titleEl = document.querySelector('.text-title-large') ||
                    document.querySelector('[data-cy="question-title"]') ||
                    document.querySelector('h1');

    if (titleEl && titleEl.textContent.trim()) {
      observer.disconnect(); // Stop watching
      sendProblemData();
    }
  });

  observer.observe(document.body, {
    childList: true,   // Watch for added/removed child elements
    subtree: true      // Watch ALL descendants, not just direct children
  });
}


// ─────────────────────────────────────────────
// 3. SEND DATA TO SERVICE WORKER
// ─────────────────────────────────────────────
// Content script → Service Worker → Side Panel
// Direct content script ↔ side panel messaging is NOT possible

async function sendProblemData(retryCount = 0) {
  const data = getProblemData();

  // Only send if we actually got a title
  if (!data.title) return;

  // If description is empty, LeetCode might still be rendering
  // Retry up to 3 times with increasing delays
  if (!data.description && retryCount < 3) {
    console.log(`LeetHint: description empty, retrying in ${(retryCount + 1) * 1000}ms...`);
    setTimeout(() => sendProblemData(retryCount + 1), (retryCount + 1) * 1000);
    return;
  }

  console.log(`LeetHint: Sending problem "${data.title}", desc length: ${data.description.length}`);

  try {
    await chrome.runtime.sendMessage({
      type: 'PROBLEM_DETECTED',
      payload: data
    });
  } catch (e) {
    console.log('LeetHint: could not send message', e.message);
  }
}


// ─────────────────────────────────────────────
// 4. LISTEN FOR REQUESTS FROM SIDE PANEL
// ─────────────────────────────────────────────
// Side panel can ask: "hey content script, give me current problem data"

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PROBLEM_DATA') {
    const data = getProblemData();
    sendResponse({ success: true, data });
  }
  return true; // Keep channel open for async
});


// ─────────────────────────────────────────────
// 5. HANDLE SPA NAVIGATION
// ─────────────────────────────────────────────
// LeetCode is a Single Page App (SPA).
// When user goes from problem A → problem B,
// the PAGE does NOT reload, only the URL changes.
// So content.js only runs ONCE — we must watch for URL changes.

let lastUrl = window.location.href;

const urlObserver = new MutationObserver(() => {
  const currentUrl = window.location.href;

  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;

    // URL changed — check if it's a new problem page
    if (currentUrl.includes('leetcode.com/problems/')) {
      // Wait a bit for React to render the new problem
      setTimeout(() => {
        waitForProblemAndExtract();
      }, 1000);
    }
  }
});

// Observe URL changes by watching document title changes (reliable SPA trick)
urlObserver.observe(document.querySelector('title') || document.head, {
  childList: true,
  subtree: true,
  characterData: true
});


// ─────────────────────────────────────────────
// 6. KICK OFF ON LOAD
// ─────────────────────────────────────────────
waitForProblemAndExtract();
