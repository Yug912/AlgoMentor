// sidepanel.js — Main logic for the LeetHint side panel
// Connects everything: problem data, hints, score, stats

// ─────────────────────────────────────────────
// STATE — everything about current session
// ─────────────────────────────────────────────
let state = {
  problem: null,          // {title, difficulty, slug, description}
  hints: null,            // {hint1..hint5, optimal_tc, optimal_sc, pattern}
  hintsUnlocked: 1,       // how many hints currently visible (1 = only hint1)
  score: 100,             // current score
  currentTab: 'hints'     // 'hints' or 'stats'
};

// Score values for each level
const SCORE_MAP = { 1: 100, 2: 80, 3: 60, 4: 40, solution: 20 };
const LEVEL_NAMES = { 1: 'SOLO', 2: 'SHARP', 3: 'GOOD', 4: 'GUIDE', solution: 'READ' };

// ─────────────────────────────────────────────
// DOM REFERENCES — grab all elements once
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

const DOM = {
  // Header
  problemTitle:   $('problem-title'),
  difficultyBadge: $('difficulty-badge'),
  problemNumber:  $('problem-number'),

  // Tabs
  tabHints:       $('tab-hints'),
  tabStats:       $('tab-stats'),
  contentHints:   $('content-hints'),
  contentStats:   $('content-stats'),

  // States
  loadingState:   $('loading-state'),
  noProblemState: $('no-problem-state'),
  errorState:     $('error-state'),
  errorMessage:   $('error-message'),
  btnRetry:       $('btn-retry'),
  hintsLayout:    $('hints-layout'),
  loadingName:    $('loading-problem-name'),

  // API Banner
  apiBanner:      $('api-banner'),
  btnAddKey:      $('btn-add-key'),
  btnDismiss:     $('btn-dismiss'),
  apiKeySection:  $('api-key-section'),
  apiKeyInput:    $('api-key-input'),
  btnSaveKey:     $('btn-save-key'),
  btnCancelKey:   $('btn-cancel-key'),

  // Hint cards
  hintCards: {
    1:        $('hint-card-1'),
    2:        $('hint-card-2'),
    3:        $('hint-card-3'),
    4:        $('hint-card-4'),
    solution: $('hint-card-solution')
  },

  // Hint text containers
  hintTexts: {
    1:        $('hint-text-1'),
    2:        $('hint-text-2'),
    3:        $('hint-text-3'),
    4:        $('hint-text-4'),
    solution: $('hint-text-solution')
  },

  // Unlock buttons
  unlockBtns: {
    2:        $('unlock-hint-2'),
    3:        $('unlock-hint-3'),
    4:        $('unlock-hint-4'),
    solution: $('unlock-solution')
  },

  // Score segments
  scoreSegs: {
    1:        $('score-seg-1'),
    2:        $('score-seg-2'),
    3:        $('score-seg-3'),
    4:        $('score-seg-4'),
    solution: $('score-seg-solution')
  },

  // Explanation
  explanationInput: $('explanation-input'),

  // TC/SC
  tcInput:      $('tc-input'),
  scInput:      $('sc-input'),
  btnCheck:     $('btn-check-tcsc'),
  tcscResult:   $('tcsc-result'),
  optimalTcDisplay: $('optimal-tc-display'),
  optimalScDisplay: $('optimal-sc-display'),
  tcMatchIcon:  $('tc-match-icon'),
  scMatchIcon:  $('sc-match-icon'),

  // Stats
  statTotal:    $('stat-total'),
  statAvg:      $('stat-avg-score'),
  statBest:     $('stat-best'),
  easyBar:      $('easy-bar'),
  mediumBar:    $('medium-bar'),
  hardBar:      $('hard-bar'),
  easyCount:    $('easy-count'),
  mediumCount:  $('medium-count'),
  hardCount:    $('hard-count'),
  distSolo:     $('dist-solo'),
  distSharp:    $('dist-sharp'),
  distGood:     $('dist-good'),
  distGuide:    $('dist-guide'),
  distRead:     $('dist-read'),
  distSoloCount:  $('dist-solo-count'),
  distSharpCount: $('dist-sharp-count'),
  distGoodCount:  $('dist-good-count'),
  distGuideCount: $('dist-guide-count'),
  distReadCount:  $('dist-read-count'),
  keyStatus:    $('key-status'),
  btnChangeKey: $('btn-change-key')
};


// ─────────────────────────────────────────────
// 1. INITIALISE — runs when panel opens
// ─────────────────────────────────────────────
async function init() {
  setupTabListeners();
  setupApiKeyListeners();
  setupUnlockListeners();
  setupTcScListener();
  setupExplanationAutoSave();
  setupRetryListener();

  await checkApiKeyStatus();
  await loadCurrentProblem();
}


// ─────────────────────────────────────────────
// 2. TAB SWITCHING
// ─────────────────────────────────────────────
function setupTabListeners() {
  DOM.tabHints.addEventListener('click', () => switchTab('hints'));
  DOM.tabStats.addEventListener('click', () => {
    switchTab('stats');
    renderStats(); // Refresh stats when tab opens
  });
}

function switchTab(tab) {
  state.currentTab = tab;

  DOM.tabHints.classList.toggle('active', tab === 'hints');
  DOM.tabStats.classList.toggle('active', tab === 'stats');
  DOM.contentHints.classList.toggle('active', tab === 'hints');
  DOM.contentStats.classList.toggle('active', tab === 'stats');
}


// ─────────────────────────────────────────────
// 3. API KEY BANNER & SETTINGS
// ─────────────────────────────────────────────
async function checkApiKeyStatus() {
  const { geminiApiKey, apiBannerDismissed } = await chrome.storage.local.get([
    'geminiApiKey',
    'apiBannerDismissed'
  ]);

  if (geminiApiKey) {
    // Key exists — hide banner, update status text
    DOM.apiBanner.style.display = 'none';
    DOM.keyStatus.textContent = 'Gemini API key active ✅';
  } else if (apiBannerDismissed) {
    // User dismissed banner before — don't show again
    DOM.apiBanner.style.display = 'none';
  }
  // else: show banner (default visible in HTML)
}

function setupApiKeyListeners() {
  // "Add Key" → show input field
  DOM.btnAddKey.addEventListener('click', () => {
    DOM.apiBanner.style.display = 'none';
    DOM.apiKeySection.classList.add('visible');
    DOM.apiKeyInput.focus();
  });

  // "Maybe Later" → dismiss banner forever
  DOM.btnDismiss.addEventListener('click', async () => {
    DOM.apiBanner.style.display = 'none';
    await chrome.storage.local.set({ apiBannerDismissed: true });
  });

  // "Save" → save key
  DOM.btnSaveKey.addEventListener('click', saveApiKey);

  // "Cancel" → hide input
  DOM.btnCancelKey.addEventListener('click', () => {
    DOM.apiKeySection.classList.remove('visible');
  });

  // Settings tab "Change Key" button
  DOM.btnChangeKey.addEventListener('click', () => {
    switchTab('hints');
    DOM.apiBanner.style.display = 'none';
    DOM.apiKeySection.classList.add('visible');
    DOM.apiKeyInput.focus();
  });
}

async function saveApiKey() {
  const key = DOM.apiKeyInput.value.trim();
  if (!key) return;

  await chrome.storage.local.set({ geminiApiKey: key });
  DOM.apiKeySection.classList.remove('visible');
  DOM.keyStatus.textContent = 'Gemini API key active ✅';
  DOM.apiKeyInput.value = '';

  // Show brief confirmation
  showToast('✅ API key saved! Better hints enabled.');
}


// ─────────────────────────────────────────────
// 4. LOAD PROBLEM + GENERATE HINTS
// ─────────────────────────────────────────────
async function loadCurrentProblem() {
  showState('loading');

  // Ask service worker for current problem
  let response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_PROBLEM' });

  // If no data, LeetCode React might still be rendering — wait and retry once
  if (!response?.data) {
    await new Promise(r => setTimeout(r, 1500));
    response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_PROBLEM' });
  }

  if (!response?.data) {
    showState('noProblem');
    return;
  }

  state.problem = response.data;
  updateProblemHeader();
  await loadSavedProgress();
  await loadHints();
}

function updateProblemHeader() {
  const { title, difficulty, problemNumber } = state.problem;

  DOM.problemTitle.textContent = title || 'Unknown Problem';

  // Set difficulty badge
  const diff = (difficulty || 'unknown').toLowerCase();
  DOM.difficultyBadge.textContent = difficulty || '?';
  DOM.difficultyBadge.className = `difficulty-badge ${diff}`;

  DOM.problemNumber.textContent = problemNumber ? `#${problemNumber}` : '';
}

async function loadHints() {
  DOM.loadingName.textContent = state.problem.title;
  showState('loading');

  // Check cache first
  const cacheKey = `hints_${state.problem.slug}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) {
    state.hints = cached[cacheKey];
    renderHints();
    showState('hints');
    return;
  }

  // Generate fresh hints directly (gemini.js loaded via script tag)
  try {
    const hints = await generateHints(state.problem);
    await chrome.storage.local.set({ [cacheKey]: hints });
    state.hints = hints;
    renderHints();
    showState('hints');
  } catch (e) {
    console.error('LeetHint: hint generation failed →', e);
    showState('error', e.message);
  }
}

function renderHints() {
  if (!state.hints) return;

  const hintKeys = ['hint1', 'hint2', 'hint3', 'hint4', 'hint5'];
  const cardKeys = [1, 2, 3, 4, 'solution'];

  hintKeys.forEach((key, i) => {
    const cardKey = cardKeys[i];
    if (DOM.hintTexts[cardKey]) {
      DOM.hintTexts[cardKey].innerHTML = formatHintText(state.hints[key] || '');
    }
  });

  applyUnlockState(state.hintsUnlocked);
}

// Convert hint text to HTML — handles code blocks + newlines
function formatHintText(text) {
  // Escape HTML first to prevent XSS
  const escape = s => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Replace ```lang ... ``` blocks with styled <pre><code>
  let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="hint-code-block"><code class="lang-${lang || 'cpp'}">${escape(code.trim())}</code></pre>`;
  });

  // Replace inline `code` with <code>
  html = html.replace(/`([^`]+)`/g, (_, code) => `<code class="hint-inline-code">${escape(code)}</code>`);

  // Newlines → <br> (outside code blocks)
  html = html.replace(/\n/g, '<br>');

  return html;
}


// ─────────────────────────────────────────────
// 5. UNLOCK LOGIC + SCORE BAR
// ─────────────────────────────────────────────
function setupUnlockListeners() {
  // Map: button id → which card to unlock next
  const unlockMap = {
    'unlock-hint-2':   2,
    'unlock-hint-3':   3,
    'unlock-hint-4':   4,
    'unlock-solution': 'solution'
  };

  Object.entries(unlockMap).forEach(([btnId, nextCard]) => {
    const btn = $(btnId);
    if (btn) {
      btn.addEventListener('click', () => unlockHint(nextCard));
    }
  });
}

function unlockHint(cardKey) {
  // Update state
  if (cardKey === 'solution') {
    state.hintsUnlocked = 'solution';
    state.score = 20;
  } else {
    state.hintsUnlocked = cardKey;
    state.score = SCORE_MAP[cardKey];
  }

  // Apply visual changes
  applyUnlockState(state.hintsUnlocked);

  // Save progress
  saveProgress();

  // Update stats
  updateStats();
}

function applyUnlockState(unlockedLevel) {
  // Card order
  const order = [1, 2, 3, 4, 'solution'];
  const unlockedIndex = order.indexOf(unlockedLevel);

  order.forEach((key, index) => {
    const card = DOM.hintCards[key];
    const seg  = DOM.scoreSegs[key];
    if (!card || !seg) return;

    if (index < unlockedIndex) {
      // Previously unlocked — open but not current
      card.classList.remove('locked');
      card.classList.add('open');
      seg.classList.remove('locked', 'active');
      seg.classList.add('passed');

    } else if (index === unlockedIndex) {
      // Currently active — open with glow + pop animation
      card.classList.remove('locked');
      card.classList.add('open');
      seg.classList.remove('locked', 'passed');
      seg.classList.add('active');

      // Pop animation — remove & re-add to retrigger
      card.classList.remove('just-unlocked');
      void card.offsetWidth; // force reflow
      card.classList.add('just-unlocked');

      // Scroll to this card smoothly
      setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);

    } else {
      // Still locked
      card.classList.remove('open');
      card.classList.add('locked');
      seg.classList.remove('active', 'passed');
      seg.classList.add('locked');
    }
  });

  // Update score number in active segment with pulse
  const activeScoreEl = DOM.scoreSegs[unlockedLevel]?.querySelector('.score-number');
  if (activeScoreEl) {
    activeScoreEl.style.color = 'var(--accent-green)';
    activeScoreEl.style.animation = 'none';
    void activeScoreEl.offsetWidth;
    activeScoreEl.style.animation = 'scorePulse 0.5s ease';
  }
}


// ─────────────────────────────────────────────
// 6. EXPLANATION AUTO-SAVE
// ─────────────────────────────────────────────
function setupExplanationAutoSave() {
  let debounceTimer;

  DOM.explanationInput.addEventListener('input', () => {
    // Debounce — save only after user stops typing for 800ms
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (!state.problem?.slug) return;
      const key = `explanation_${state.problem.slug}`;
      await chrome.storage.local.set({ [key]: DOM.explanationInput.value });
    }, 800);
  });
}


// ─────────────────────────────────────────────
// 7. TC/SC CHECKER
// ─────────────────────────────────────────────
function setupTcScListener() {
  DOM.btnCheck.addEventListener('click', checkTcSc);
}

function checkTcSc() {
  if (!state.hints) {
    showToast('⏳ Hints not loaded yet');
    return;
  }

  const userTc = DOM.tcInput.value.trim();
  const userSc = DOM.scInput.value.trim();

  if (!userTc || !userSc) {
    showToast('Enter both TC and SC first');
    return;
  }

  const optimalTc = state.hints.optimal_tc || '';
  const optimalSc = state.hints.optimal_sc || '';

  const tcMatch = normalizeComplexity(userTc) === normalizeComplexity(optimalTc);
  const scMatch = normalizeComplexity(userSc) === normalizeComplexity(optimalSc);

  // Show results
  DOM.optimalTcDisplay.textContent = optimalTc;
  DOM.optimalScDisplay.textContent = optimalSc;
  DOM.tcMatchIcon.textContent = tcMatch ? '✅' : '❌';
  DOM.scMatchIcon.textContent = scMatch ? '✅' : '❌';
  DOM.tcscResult.style.display = 'block';
}

function normalizeComplexity(input) {
  return input
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/o\(/g, '')
    .replace(/\)/g, '')
    .replace(/\*/g, '')
    .replace(/×/g, '');
}


// ─────────────────────────────────────────────
// 8. PROGRESS SAVE & LOAD
// ─────────────────────────────────────────────
async function saveProgress() {
  if (!state.problem?.slug) return;

  const progressKey = `progress_${state.problem.slug}`;
  await chrome.storage.local.set({
    [progressKey]: {
      hintsUnlocked: state.hintsUnlocked,
      score: state.score
    }
  });
}

async function loadSavedProgress() {
  if (!state.problem?.slug) return;

  const progressKey   = `progress_${state.problem.slug}`;
  const explanationKey = `explanation_${state.problem.slug}`;

  const saved = await chrome.storage.local.get([progressKey, explanationKey]);

  if (saved[progressKey]) {
    state.hintsUnlocked = saved[progressKey].hintsUnlocked || 1;
    state.score         = saved[progressKey].score || 100;
  } else {
    // Fresh problem — reset to default
    state.hintsUnlocked = 1;
    state.score = 100;
  }

  // Restore explanation text
  if (saved[explanationKey]) {
    DOM.explanationInput.value = saved[explanationKey];
  }
}


// ─────────────────────────────────────────────
// 9. STATS — Update & Render
// ─────────────────────────────────────────────
async function updateStats() {
  if (!state.problem) return;

  const { stats = {} } = await chrome.storage.local.get('stats');

  const slug       = state.problem.slug;
  const difficulty = (state.problem.difficulty || 'unknown').toLowerCase();
  const level      = state.hintsUnlocked;

  // Initialize if first time
  if (!stats.problems) stats.problems = {};
  if (!stats.byDifficulty) stats.byDifficulty = { easy: 0, medium: 0, hard: 0 };
  if (!stats.byLevel) stats.byLevel = { 1: 0, 2: 0, 3: 0, 4: 0, solution: 0 };

  // Record this problem's current state
  const isNewProblem = !stats.problems[slug];
  stats.problems[slug] = { score: state.score, level, difficulty };

  // Update difficulty count (only for new problems)
  if (isNewProblem && stats.byDifficulty[difficulty] !== undefined) {
    stats.byDifficulty[difficulty]++;
  }

  // Update level distribution
  // Reset old level count for this problem, add new
  stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;

  // Recalculate totals
  const allProblems = Object.values(stats.problems);
  stats.totalProblems = allProblems.length;
  stats.avgScore = Math.round(
    allProblems.reduce((sum, p) => sum + p.score, 0) / allProblems.length
  );
  stats.bestScore = Math.max(...allProblems.map(p => p.score));

  await chrome.storage.local.set({ stats });
}

async function renderStats() {
  const { stats = {} } = await chrome.storage.local.get('stats');

  const total = stats.totalProblems || 0;
  DOM.statTotal.textContent = total;
  DOM.statAvg.textContent   = stats.avgScore   ? `${stats.avgScore}` : '—';
  DOM.statBest.textContent  = stats.bestScore  ? `${stats.bestScore}` : '—';

  // Difficulty bars
  const diff = stats.byDifficulty || { easy: 0, medium: 0, hard: 0 };
  const maxDiff = Math.max(diff.easy, diff.medium, diff.hard, 1);

  DOM.easyCount.textContent   = diff.easy;
  DOM.mediumCount.textContent = diff.medium;
  DOM.hardCount.textContent   = diff.hard;
  DOM.easyBar.style.width     = `${(diff.easy / maxDiff) * 100}%`;
  DOM.mediumBar.style.width   = `${(diff.medium / maxDiff) * 100}%`;
  DOM.hardBar.style.width     = `${(diff.hard / maxDiff) * 100}%`;

  // Hint level distribution
  const byLevel = stats.byLevel || {};
  const maxLevel = Math.max(...Object.values(byLevel), 1);

  const levelMap = {
    1: [DOM.distSolo,  DOM.distSoloCount],
    2: [DOM.distSharp, DOM.distSharpCount],
    3: [DOM.distGood,  DOM.distGoodCount],
    4: [DOM.distGuide, DOM.distGuideCount],
    solution: [DOM.distRead, DOM.distReadCount]
  };

  Object.entries(levelMap).forEach(([key, [bar, count]]) => {
    const val = byLevel[key] || 0;
    bar.style.width     = `${(val / maxLevel) * 100}%`;
    count.textContent   = val;
  });
}


// ─────────────────────────────────────────────
// 10. UI HELPERS
// ─────────────────────────────────────────────

// Show one of four states: 'loading' | 'noProblem' | 'error' | 'hints'
function showState(which, errorMsg = '') {
  DOM.loadingState.classList.toggle('visible',   which === 'loading');
  DOM.noProblemState.classList.toggle('visible', which === 'noProblem');
  DOM.errorState.style.display  = which === 'error' ? 'flex' : 'none';
  DOM.hintsLayout.style.display = which === 'hints' ? 'grid' : 'none';
  if (which === 'error' && errorMsg) {
    DOM.errorMessage.textContent = errorMsg;
  }
}

function setupRetryListener() {
  DOM.btnRetry.addEventListener('click', () => loadHints());
}

// Brief toast notification
function showToast(message) {
  // Remove existing toast if any
  document.querySelector('.leethint-toast')?.remove();

  const toast = document.createElement('div');
  toast.className = 'leethint-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    background: #1c2128; border: 1px solid #30363d; color: #e6edf3;
    padding: 8px 16px; border-radius: 8px; font-size: 12px;
    z-index: 9999; white-space: nowrap;
    animation: fadeSlideIn 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─────────────────────────────────────────────
// 11. LISTEN FOR PROBLEM CHANGES
//     Content script sends PROBLEM_DETECTED when:
//     - Page first loads
//     - User navigates to a new problem (SPA)
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROBLEM_DETECTED' || message.type === 'PROBLEM_CHANGED') {
    const newProblem = message.payload;

    // Ignore if it's the same problem we already have
    if (newProblem?.slug && newProblem.slug === state.problem?.slug) return;

    console.log('LeetHint: Problem changed →', newProblem?.title);

    // Reset state for new problem
    state.hints        = null;
    state.hintsUnlocked = 1;
    state.score        = 100;

    if (newProblem?.title) {
      // We already have the data from the message — use it directly
      state.problem = newProblem;
      updateProblemHeader();
      loadSavedProgress().then(() => loadHints());
    } else {
      // No data in message — fetch fresh
      loadCurrentProblem();
    }
  }
});


// ─────────────────────────────────────────────
// KICK OFF
// ─────────────────────────────────────────────
init();
