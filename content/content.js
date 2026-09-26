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
// 5. HANDLE SPA NAVIGATION — robust 3-layer approach
// ─────────────────────────────────────────────
// LeetCode is a React SPA. When navigating between problems:
//   - The PAGE does NOT reload
//   - URL changes via history.pushState (not hashchange, not popstate alone)
//   - The old DOM is still present briefly during transition
//
// Fix: intercept history.pushState + popstate + title mutation as triple safety net.
// Always verify the SLUG changed before re-sending, and always wait for new DOM.

let lastSlug = '';         // Track by slug, not full URL (avoids query-param false positives)
let navDebounceTimer = null;

function getCurrentSlug() {
  const parts = window.location.pathname.split('/');
  // pathname is /problems/<slug>/... — index 2
  return (parts[2] || '').toLowerCase();
}

function onNavigate() {
  const slug = getCurrentSlug();
  if (!slug || !window.location.pathname.includes('/problems/')) return;
  if (slug === lastSlug) return;   // Same problem — ignore

  lastSlug = slug;
  console.log('LeetHint: Navigation detected → new slug:', slug);

  // Clear any pending debounce
  clearTimeout(navDebounceTimer);

  // Wait for React to unmount old DOM and mount new problem DOM
  navDebounceTimer = setTimeout(() => {
    waitForNewProblemAndExtract(slug);
  }, 800);
}

// Wait specifically for a NEW problem title (different from current slug)
function waitForNewProblemAndExtract(expectedSlug) {
  let attempts = 0;
  const maxAttempts = 30; // 30 × 300ms = 9 seconds max

  const poll = setInterval(() => {
    attempts++;

    // Get current slug from URL (it should match expectedSlug now)
    const urlSlug = getCurrentSlug();
    if (urlSlug !== expectedSlug) {
      // URL changed again before we finished — abort this round
      clearInterval(poll);
      return;
    }

    const titleEl = document.querySelector('.text-title-large') ||
                    document.querySelector('[data-cy="question-title"]');

    if (titleEl && titleEl.textContent.trim()) {
      clearInterval(poll);
      // Extra 200ms to let description render
      setTimeout(() => sendProblemData(), 200);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(poll);
      console.warn('LeetHint: Timed out waiting for new problem DOM');
    }
  }, 300);
}

// ── Layer 1: Intercept history.pushState / replaceState ──────────────────────
// This is the most reliable method for React Router / Next.js SPAs
(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);

  history.pushState = function(...args) {
    _push(...args);
    onNavigate();
  };
  history.replaceState = function(...args) {
    _replace(...args);
    onNavigate();
  };
})();

// ── Layer 2: popstate (browser back/forward buttons) ─────────────────────────
window.addEventListener('popstate', onNavigate);

// ── Layer 3: MutationObserver on <title> as final fallback ───────────────────
const titleObserver = new MutationObserver(onNavigate);
const titleEl = document.querySelector('title') || document.head;
titleObserver.observe(titleEl, { childList: true, subtree: true, characterData: true });


// ─────────────────────────────────────────────
// 6. KICK OFF ON LOAD
// ─────────────────────────────────────────────
lastSlug = getCurrentSlug();
waitForProblemAndExtract();

