// api/gemini.js
// Handles all AI hint generation
// Primary: Gemini Flash API (if key exists)
// Fallback: Chrome Built-in AI (window.ai)

// ─────────────────────────────────────────────
// 1. THE MASTER PROMPT — This is the secret sauce
//    Tells AI exactly HOW to generate hints
// ─────────────────────────────────────────────

function buildPrompt(title, description, difficulty) {
  return `You are an expert DSA mentor helping a competitive programmer learn problem-solving.

Problem: "${title}" (Difficulty: ${difficulty})
Description: ${description}

Generate EXACTLY 5 progressive hints and the optimal solution analysis.
Follow these rules STRICTLY:

HINT 1 — Pattern Recognition (MAX 2 sentences, NO algorithm name):
- Ask ONE pointed question about the constraint that reveals the time complexity needed
- Immediately follow with a space-vs-time trade-off nudge
- KEEP IT SHORT. Example: "What does n ≤ 10^5 tell you about the time complexity you need? Is there a way to avoid rechecking elements — maybe by paying a small memory cost?"

HINT 2 — Concrete Technique (SHORT, name the data structure NOW):
- Name the exact data structure/algorithm in 1 sentence
- Show ONE step of the walkthrough with the ACTUAL example from the problem
- Ask what to store — keep total hint under 4 lines

HINT 3 — Algorithm Skeleton (pseudocode only, happy path):
- Write the core algorithm as clean pseudocode (4-6 lines max)
- No edge cases yet — just the main logic
- Use indentation to show structure clearly

HINT 4 — Edge Cases + Gotchas (specific to THIS problem):
- List exactly 2-3 edge cases that are easy to miss
- For each: show the test case → wrong output vs correct output
- Be specific to this problem's constraints

HINT 5 — Full Solution (C++ code ONLY, nothing else):
- Write clean, well-commented C++ code
- Preserve the exact LeetCode function signature
- Never create main() or solve()
- Return ONLY class Solution { ... };
- No markdown fences

RULES:
- Use ACTUAL numbers/examples from the problem description, not generic ones
- Be concise — no fluff, no "Great question!", no generic advice
- Hints 1 and 2 must be SHORT (2-4 lines max each)

Respond ONLY in this exact delimiter format (no JSON, no markdown outside the delimiters):
---HINT1---
...
---HINT2---
...
---HINT3---
...
---HINT4---
...
---HINT5---
class Solution { ... };
---TC---
O(...)
---SC---
O(...)
---PATTERN---
short pattern name
---END---`.trim();
}


// ─────────────────────────────────────────────
// 2. GEMINI FLASH API CALL
// ─────────────────────────────────────────────

async function generateWithGemini(apiKey, prompt) {
  // gemini-2.0-flash: stable, free, widely available in v1
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  console.log('LeetHint: Calling Gemini API...');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048
        // NOTE: responseMimeType removed — causes failures on some API keys/regions
      }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${response.status}`;
    console.error('LeetHint: Gemini API error →', msg);
    throw new Error(`Gemini: ${msg}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('LeetHint: Gemini raw response →', rawText?.slice(0, 100));
  if (!rawText) throw new Error('Empty response from Gemini');

  return parseHintsJSON(rawText);
}


// ─────────────────────────────────────────────
// 3. CHROME BUILT-IN AI FALLBACK
// ─────────────────────────────────────────────

async function generateWithBuiltinAI(prompt) {
  const AIModel = window.LanguageModel || window.ai?.languageModel;
  if (!AIModel) throw new Error('Chrome Built-in AI not available');

  const session = await AIModel.create({
    systemPrompt: 'You are a DSA mentor. Always respond with valid JSON only.',
    expectedInputLanguages:  ['en'],
    expectedOutputLanguages: ['en']
  });

  const result = await session.prompt(prompt);
  session.destroy();
  return parseHintsJSON(result);
}


// ─────────────────────────────────────────────
// 4. PARSE AI RESPONSE → structured object
// ─────────────────────────────────────────────

function parseHintsJSON(rawText) {
  // ── Pre-process: strip any wrapping markdown code fences ──────────────
  // Gemini sometimes wraps the whole reply in ```...``` which hides the
  // ---HINT1--- delimiters entirely and causes "missing required hints".
  let text = String(rawText || '').trim();
  console.log('LeetHint DEBUG: raw response (first 300):', text.slice(0, 300));

  // Strip leading ``` fence (with optional language tag)
  text = text.replace(/^```[\w\s]*\n?/, '').trim();
  // Strip trailing ``` fence
  text = text.replace(/\n?```\s*$/, '').trim();
  // Normalise smart/em-dashes to regular hyphens so --- still matches
  text = text.replace(/[—–]/g, '-');

  // Helper: extract text between two delimiter tags
  const extract = (startTag, endTag) => {
    const startRe = new RegExp(`---\\s*${startTag}\\s*---`, 'i');
    const endRe   = endTag ? new RegExp(`---\\s*${endTag}\\s*---`, 'i') : null;
    const startMatch = text.match(startRe);
    if (!startMatch) return '';
    const from = startMatch.index + startMatch[0].length;
    const remaining = text.slice(from);
    if (!endRe) return remaining.trim();
    const endMatch = remaining.match(endRe);
    return remaining.slice(0, endMatch ? endMatch.index : remaining.length).trim();
  };

  const hint1 = extract('HINT1', 'HINT2');
  const hint2 = extract('HINT2', 'HINT3');
  const hint3 = extract('HINT3', 'HINT4');
  const hint4 = extract('HINT4', 'HINT5');

  // hint5: stop at ---TC--- or ---END--- or end of text
  const hint5raw = extract('HINT5', 'TC') || extract('HINT5', 'END') || extract('HINT5', null);
  const hint5 = hint5raw
    .replace(/```(?:cpp|c\+\+)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  if (!hint1 || !hint5) {
    throw new Error('Failed to parse AI response: missing required hints. Please retry.');
  }

  // TC/SC — 4 strategies: tags → "Time Complexity:" → "TC:" → scan all O(...)
  let optimal_tc = extract('TC', 'SC');
  let optimal_sc = extract('SC', 'PATTERN') || extract('SC', 'END') || extract('SC', null);

  console.log('LeetHint DEBUG: raw TC section:', JSON.stringify(optimal_tc));
  console.log('LeetHint DEBUG: raw SC section:', JSON.stringify(optimal_sc));
  console.log('LeetHint DEBUG: last 400 chars of response:', text.slice(-400));

  // bigO: allows ONE level of nested parens so O(n log(n)) works correctly
  const bigO = (s) => { const m = String(s||'').match(/O\([^()\n]{0,40}(?:\([^()\n]{0,20}\)[^()\n]{0,20})?\)/); return m ? m[0] : ''; };
  optimal_tc = bigO(optimal_tc);
  optimal_sc = bigO(optimal_sc);

  if (!optimal_tc) { const m = text.match(/time\s+complexity\s*[:\-]?\s*(O\([^)\n]{1,40}\))/i); if (m) optimal_tc = m[1]; }
  if (!optimal_sc) { const m = text.match(/space\s+complexity\s*[:\-]?\s*(O\([^)\n]{1,40}\))/i); if (m) optimal_sc = m[1]; }
  if (!optimal_tc) { const m = text.match(/\bTC\s*[:\-]\s*(O\([^)\n]{1,40}\))/i); if (m) optimal_tc = m[1]; }
  if (!optimal_sc) { const m = text.match(/\bSC\s*[:\-]\s*(O\([^)\n]{1,40}\))/i); if (m) optimal_sc = m[1]; }

  if (!optimal_tc || !optimal_sc) {
    // Use same improved bigO regex for the full-text scan
    const all    = [...text.matchAll(/O\([^()\n]{0,40}(?:\([^()\n]{0,20}\)[^()\n]{0,20})?\)/g)].map(m => m[0]);
    const unique = [...new Set(all)];
    console.log('LeetHint DEBUG: all O() found:', unique);
    // TC and SC appear last in the response (after ---TC--- and ---SC--- tags)
    // so pick the final two unique values — last = SC, second-to-last = TC
    if (!optimal_tc) optimal_tc = unique[unique.length - 2] || unique[unique.length - 1] || 'N/A';
    if (!optimal_sc) optimal_sc = unique[unique.length - 1] || 'N/A';
  }

  console.log('LeetHint DEBUG: final TC =', optimal_tc, '| SC =', optimal_sc);

  const pattern = extract('PATTERN', 'END') || 'Unknown';

  return { hint1, hint2, hint3, hint4, hint5, optimal_tc, optimal_sc, pattern };
}


// ─────────────────────────────────────────────
// 5. MAIN EXPORT — generateHints()
//    Tries Gemini first, falls back to Built-in AI
// ─────────────────────────────────────────────

async function generateHints(problemData) {
  const { title, description, difficulty } = problemData;
  console.log('LeetHint: generateHints() called for:', title);
  console.log('LeetHint: description length:', description?.length);

  const prompt = buildPrompt(title, description, difficulty);

  // Check if user has saved a Gemini API key
  const storage = await chrome.storage.local.get('geminiApiKey');
  const geminiApiKey = storage.geminiApiKey;
  console.log('LeetHint: API key found?', !!geminiApiKey, geminiApiKey ? `(${geminiApiKey.slice(0,8)}...)` : 'none');

  if (geminiApiKey) {
    try {
      console.log('LeetHint: Using Gemini Flash API');
      const result = await generateWithGemini(geminiApiKey, prompt);
      console.log('LeetHint: Gemini succeeded ✅');
      return result;
    } catch (e) {
      console.warn('LeetHint: Gemini failed →', e.message);
      // Fall through to Built-in AI
    }
  }

  // Fallback to Chrome Built-in AI
  console.log('LeetHint: Trying Chrome Built-in AI...');
  const AIModel = window.LanguageModel || window.ai?.languageModel;
  console.log('LeetHint: LanguageModel available?', !!AIModel);

  try {
    return await generateWithBuiltinAI(prompt);
  } catch (e) {
    console.error('LeetHint: Built-in AI also failed →', e.message);
    const hint = geminiApiKey ? 'Check your API key in Settings.' : 'Add a Gemini API key in Settings.';
    throw new Error(`${e.message}. ${hint}`);
  }
}


// ─────────────────────────────────────────────
// 6. TC/SC COMPARISON — smart matching
// ─────────────────────────────────────────────

function normalizeComplexity(input) {
  return input
    .toLowerCase()
    .replace(/\s+/g, '')       // Remove all spaces
    .replace(/o\(/g, '')       // Remove "O("
    .replace(/\)/g, '')        // Remove ")"
    .replace(/\*/g, '')        // Remove multiplication signs
    .replace(/×/g, '');        // Remove × symbol
}

function compareComplexity(userInput, optimal) {
  const userNorm = normalizeComplexity(userInput);
  const optNorm  = normalizeComplexity(optimal);

  return userNorm === optNorm;
}
