// api/gemini.js
// Handles all AI hint generation
// Primary: Gemini Flash API (if key exists)
// Fallback: Chrome Built-in AI (window.ai)

// ─────────────────────────────────────────────
// 0. SHARED UTILITY — paren-counting O() extractor
//    Handles arbitrary nesting: O(n*log(log(n))), O(m² × n × log(n)) etc.
//    Simple regex breaks on these; paren counting works for any depth.
// ─────────────────────────────────────────────

function extractAllBigO(text) {
  const results = [];
  let i = 0;
  while (i < text.length) {
    // Find next 'O(' (must be 'O' followed by '(')
    const idx = text.indexOf('O(', i);
    if (idx < 0) break;
    // Make sure it's not preceded by a letter (e.g. 'FOR(' or 'GOOD(')
    if (idx > 0 && /[A-Za-z]/.test(text[idx - 1])) { i = idx + 1; continue; }
    // Count parens to find the matching close
    let depth = 0;
    let j = idx + 1; // start at '('
    while (j < text.length) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') {
        depth--;
        if (depth === 0) { results.push(text.slice(idx, j + 1)); break; }
      }
      j++;
    }
    i = idx + 2; // advance past 'O('
  }
  return results;
}

// ─────────────────────────────────────────────
// 1. HINTS PROMPT — progressive learning hints
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 1a. HINTS PROMPT (Hints 1-4 + TC/SC + Pattern)
//     Model: google/gemini-2.5-pro
// ─────────────────────────────────────────────

function buildHintsPrompt(title, description, difficulty) {
  return `You are an expert DSA mentor helping a competitive programmer learn problem-solving.

Problem: "${title}" (Difficulty: ${difficulty})
Description: ${description}

Generate EXACTLY 4 progressive hints. Follow these rules STRICTLY:

HINT 1 — Pattern Recognition (MAX 2 sentences, NO algorithm name):
- Ask ONE pointed question about the constraint that reveals the approach
- Follow with a space-vs-time trade-off nudge
- KEEP IT SHORT. Example: "What does n ≤ 10^5 tell you about the time complexity you need? Is there a way to avoid rechecking elements — maybe by paying a small memory cost?"

HINT 2 — Concrete Technique (SHORT, name the data structure NOW):
- Name the exact data structure/algorithm in 1 sentence
- Show ONE step of the walkthrough with the ACTUAL example from the problem
- Keep total hint under 4 lines

HINT 3 — Algorithm Skeleton (pseudocode only, happy path):
- Write the core algorithm as clean pseudocode (4-6 lines max)
- No edge cases yet — just the main logic
- Use indentation to show structure clearly

HINT 4 — Edge Cases + Gotchas (specific to THIS problem):
- List exactly 2-3 edge cases that are easy to miss
- For each: show the test case → wrong output vs correct output
- Be specific to this problem's constraints

RULES:
- Use ACTUAL numbers/examples from the problem description, not generic ones
- Be concise — no fluff, no "Great question!", no generic advice
- Hints 1 and 2 must be SHORT (2-4 lines max each)

Respond ONLY in this exact delimiter format:
---HINT1---
...
---HINT2---
...
---HINT3---
...
---HINT4---
...
---TC---
O(...)
---SC---
O(...)
---PATTERN---
short pattern name
---END---`.trim();
}

// ─────────────────────────────────────────────
// 1b. SOLUTION PROMPT (Hint 5 — C++ code)
//     Model: deepseek/deepseek-r1
//     Gets full problem context for maximum accuracy
// ─────────────────────────────────────────────

function buildSolutionPrompt(title, number, description, difficulty) {
  const numStr = number ? `#${number} ` : '';
  return `You are a world-class competitive programming expert. Your solution WILL be submitted to LeetCode and MUST pass all test cases.

PROBLEM: ${numStr}"${title}" (${difficulty})

FULL DESCRIPTION:
${description}

INSTRUCTIONS:

Step 1 — Identify the OPTIMAL algorithm:
- Determine the theoretically best time and space complexity achievable
- Choose the known best algorithm (e.g. two-pointer, monotonic stack, DP with rolling array, etc.)
- Do NOT use brute force or suboptimal approaches

Step 2 — Write the solution:
- Use the EXACT function name from LeetCode (infer from the problem) — NEVER use 'solve' or generic names
- Use the EXACT parameter types, return type, and order from the LeetCode signature
- Do NOT use #include lines — LeetCode provides all headers
- Do NOT use std:: prefix — write vector<>, string, map<> etc. directly
- Do NOT add main() or any I/O code
- Start directly with: class Solution {
- Handle ALL edge cases: empty input, single element, duplicates, max constraints, overflow
- Use long long where overflow is possible

Step 3 — Self-verify before outputting:
- Check every loop bound is correct
- Verify no i/j confusion in 2D arrays
- Confirm return type matches exactly
- Confirm function name is correct (not 'solve')
- Confirm no #include or std:: in the code

OUTPUT FORMAT:
Wrap code in \`\`\`cpp ... \`\`\` fences.
After the closing \`\`\`, add ONE line: Approach: <name of algorithm + TC + SC>

Return ONLY the fenced code + Approach line. No other text.`.trim();
}


// backward-compat alias (Gemini direct path still uses this)
function buildPrompt(title, description, difficulty) {
  return buildHintsPrompt(title, description, difficulty);
}

// Parse the raw solution text from deepseek into a clean code string
function parseSolutionText(raw) {
  if (!raw) return '';

  // DeepSeek R1 wraps chain-of-thought in <think>...</think> — strip it first
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Extract fenced block
  const m = text.match(/```(?:cpp|c\+\+)?\s*([\s\S]*?)```/i);
  let code = (m ? m[1] : text).trim();

  // If we got the full reasoning as fallback, it's not valid code — return empty
  if (!m && code.length > 3000) return '';

  // Strip #include, using namespace std, std:: prefix
  code = code.split('\n')
    .filter(l => !l.trimStart().startsWith('#include') &&
                 !l.trim().startsWith('using namespace std'))
    .join('\n')
    .replace(/std::/g, '')
    .replace(/^\n+/, '')
    .trim();

  return code;
}


// ─────────────────────────────────────────────
// 1.5 OPENROUTER — best model, generous limits
//     Model: google/gemini-2.5-pro
//     Format: OpenAI-compatible chat completions
//     Priority: tried FIRST before direct Gemini key
// ─────────────────────────────────────────────

const OR_MODEL          = 'google/gemini-2.5-flash';  // Hints + TC/SC: cheap, fast, smart
const OR_MODEL_SOLUTION = 'deepseek/deepseek-r1';     // Solution: best at correct algorithms
const OR_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';


async function callOpenRouter(apiKey, messages, { temperature = 0.3, max_tokens = 2048, model = OR_MODEL } = {}) {
  const response = await fetch(OR_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://leethint.chrome.extension',
      'X-Title': 'LeetHint'
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenRouter (${model}): ${msg}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`OpenRouter (${model}) returned empty response`);
  return text;
}

// generateWithOpenRouter: runs THREE independent parallel calls
//   Call A — gemini-2.5-pro   → Hints 1-4 + Pattern
//   Call B — deepseek-r1      → Optimal C++ Solution
//   Call C — gemini-2.5-pro   → Optimal TC/SC (fully independent, always overwrites)
async function generateWithOpenRouter(apiKey, problemData) {
  const { title, number, description, difficulty } = problemData;
  console.log('LeetHint: Starting 3 parallel OR calls...');

  const hintsPrompt    = buildHintsPrompt(title, description, difficulty);
  const solutionPrompt = buildSolutionPrompt(title, number, description, difficulty);
  const tcscPrompt     = buildTcScPrompt(title, number, description, difficulty);

  // Use Promise.allSettled so one failing call doesn't kill the others
  const [hintsRes, solutionRes, tcscRes] = await Promise.allSettled([
    callOpenRouter(apiKey, [{ role: 'user', content: hintsPrompt }], {
      temperature: 0.3, max_tokens: 1100, model: OR_MODEL        // flash: cheap
    }),
    callOpenRouter(apiKey, [{ role: 'user', content: solutionPrompt }], {
      temperature: 0.1, max_tokens: 2000, model: OR_MODEL_SOLUTION  // r1: code quality
    }),
    callOpenRouter(apiKey, [{ role: 'user', content: tcscPrompt }], {
      temperature: 0.0, max_tokens: 50, model: 'google/gemini-2.5-pro'  // pro=accurate; 50tok=cheap
    })
  ]);

  // Hints are required — throw if they failed
  if (hintsRes.status === 'rejected') {
    throw new Error('Hints call failed: ' + hintsRes.reason?.message);
  }

  const result = parseHintsJSON(hintsRes.value);

  // Solution — use if available, empty string if call failed
  if (solutionRes.status === 'fulfilled') {
    result.hint5 = parseSolutionText(solutionRes.value);
    if (!result.hint5) console.warn('LeetHint: Solution model returned no parseable code');
  } else {
    console.warn('LeetHint: Solution call failed →', solutionRes.reason?.message);
    result.hint5 = '';
  }

  // TC/SC — independent call ALWAYS wins; fall back to hints-parsed values
  if (tcscRes.status === 'fulfilled') {
    const allMatches   = extractAllBigO(tcscRes.value);
    const indep_tc = allMatches[0] || '';
    const indep_sc = allMatches[1] || allMatches[0] || '';
    console.log('LeetHint: Independent TC =', indep_tc, '| SC =', indep_sc);
    if (indep_tc) result.optimal_tc = indep_tc;
    if (indep_sc) result.optimal_sc = indep_sc;
  } else {
    console.warn('LeetHint: TC/SC call failed →', tcscRes.reason?.message);
    // Keep whatever parseHintsJSON extracted
  }

  return result;
}

// buildTcScPrompt — independent complexity analysis, never tied to any solution
function buildTcScPrompt(title, number, description, difficulty) {
  const numStr = number ? `#${number} ` : '';
  return `You are a competitive programming complexity expert. Your job is to state the TIGHT OPTIMAL complexity for a LeetCode problem.

RULES (follow exactly):
1. Time complexity = number of operations in the optimal algorithm (TIGHT bound, not loose upper bound)
2. Space complexity = EXTRA space only (do NOT count the input itself)
3. Give the BEST KNOWN algorithm's complexity (e.g. if O(n log n) sort is needed, say O(n log n) not O(n²))
4. If n = array length, m = rows, k = string length, use those exact variables
5. Reply with ONLY 2 lines — no labels, no explanation, no extra text

EXAMPLES (show the exact format):
Problem: Two Sum → O(n) / O(n)
Problem: Merge Sort → O(n log n) / O(n)
Problem: Matrix multiplication n×n → O(n³) / O(1)
Problem: BFS on graph V vertices E edges → O(V+E) / O(V)

Now for this problem:
${numStr}"${title}" (${difficulty})
${description.slice(0, 2000)}

Reply with exactly 2 lines:
[time complexity]
[space complexity]`.trim();
}

async function getComplexityOpenRouter(apiKey, title, description, difficulty, number) {
  const prompt = buildTcScPrompt(title, number, description, difficulty);
  console.log('LeetHint: Independent TC/SC call (gemini-2.5-pro, temp=0)...');
  const text = await callOpenRouter(apiKey, [{ role: 'user', content: prompt }], {
    temperature: 0.0,
    max_tokens: 50,
    model: 'google/gemini-2.5-pro'  // pro for accuracy; only 50 tokens = cheap
  });
  console.log('LeetHint: TC/SC response:', text);
  const allMatches = extractAllBigO(text);
  const tc = allMatches[0] || '';
  const sc = allMatches[1] || allMatches[0] || '';
  console.log('LeetHint: OR TC =', tc, '| SC =', sc);
  return { tc, sc };
}


// ─────────────────────────────────────────────
// 1.6 SOLUTION VALIDATOR — second-pass AI fix
//     Takes generated C++ + problem context →
//     Returns clean, submit-ready LeetCode code
// ─────────────────────────────────────────────

async function validateSolutionCode(code, title, description) {
  const prompt = `You are an expert LeetCode C++ debugger.

Problem: "${title}"
${description.slice(0, 1500)}

Generated code to validate and fix:
\`\`\`cpp
${code}
\`\`\`

Your task: return a CORRECTED, SUBMIT-READY version.

RULES (follow strictly):
1. Use the EXACT function name LeetCode requires — NEVER use 'solve' or any invented name
2. Preserve the EXACT return type and parameter types from the LeetCode signature
3. Do NOT add #include lines — LeetCode provides all headers
4. Do NOT add 'using namespace std;'
5. Start directly with: class Solution {
6. Fix ALL compilation errors, logical errors, i/j confusion, off-by-one, overflow
7. If the approach is too slow, replace it with the correct efficient algorithm
8. Output ONLY the corrected code inside \`\`\`cpp ... \`\`\` fences — nothing else`.trim();

  // Try OpenRouter first
  const storage = await chrome.storage.local.get(['openRouterApiKey', 'geminiApiKey']);
  const orKey = storage.openRouterApiKey;
  const gemKey = storage.geminiApiKey;

  let rawText = '';

  if (orKey) {
    console.log('LeetHint: Validating solution via OpenRouter (', OR_MODEL_SOLUTION, ')...');
    rawText = await callOpenRouter(orKey, [{ role: 'user', content: prompt }], {
      temperature: 0.1,
      max_tokens: 1800,
      model: OR_MODEL_SOLUTION   // use code model for fixing
    });
  } else if (gemKey) {
    console.log('LeetHint: Validating solution via Gemini...');
    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${gemKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      })
    });
    const data = await res.json();
    rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else {
    throw new Error('No API key available for validation');
  }

  // Extract code from fence
  const match = rawText.match(/```(?:cpp|c\+\+)?\s*([\s\S]*?)```/i);
  let fixed = (match ? match[1] : rawText).trim();

  // Strip #include, using namespace std, and std:: prefix
  fixed = fixed.split('\n')
    .filter(l => !l.trimStart().startsWith('#include') &&
                 !l.trim().startsWith('using namespace std'))
    .join('\n')
    .replace(/std::/g, '')  // remove all std:: prefixes
    .replace(/^\n+/, '').trim();

  return fixed;
}

//    A separate focused prompt ONLY for complexity.
//    Runs in parallel with the hints call.
//    This is exactly like asking Gemini directly:
//    "What is the optimal TC and SC for this problem?"
// ─────────────────────────────────────────────

async function getOptimalComplexity(apiKey, title, description, difficulty) {
  // Ultra-simple prompt: just ask for the two O() values on separate lines.
  // No labels needed — we extract O(...) directly so Gemini's formatting doesn't matter.
  const prompt = `You are a competitive programming expert.

For this LeetCode problem:
"${title}" (${difficulty})
${description.slice(0, 2000)}

State ONLY the optimal time complexity on line 1 and optimal space complexity on line 2.
No labels, no explanation. Example format:
O(n log n)
O(1)`.trim();

  console.log('LeetHint: Calling dedicated TC/SC API...');

  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,   // Near-deterministic for factual complexity
        maxOutputTokens: 60 // Only need 2 lines
      }
    })
  });

  if (!response.ok) {
    console.warn('LeetHint: TC/SC dedicated call failed, HTTP', response.status);
    return { tc: '', sc: '' };
  }

  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  console.log('LeetHint: TC/SC dedicated response:', text);

  // Paren-counting extraction — finds all O() in response, handles any nesting depth
  const allMatches = extractAllBigO(text);

  const tc = allMatches[0] || '';
  const sc = allMatches[1] || allMatches[0] || ''; // fallback to first if only one found

  console.log('LeetHint: Dedicated TC =', tc, '| SC =', sc);
  return { tc, sc };
}



// ─────────────────────────────────────────────
// 3. GEMINI FLASH API CALL — hints
// ─────────────────────────────────────────────

async function generateWithGemini(apiKey, prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  console.log('LeetHint: Calling Gemini hints API...');

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
  console.log('LeetHint: Gemini hints raw response →', rawText?.slice(0, 100));
  if (!rawText) throw new Error('Empty response from Gemini');

  return parseHintsJSON(rawText);
}


// ─────────────────────────────────────────────
// 4. CHROME BUILT-IN AI FALLBACK
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
// 5. PARSE HINTS RESPONSE → structured object
// ─────────────────────────────────────────────

function parseHintsJSON(rawText) {
  // ── Pre-process: strip wrapping markdown fences ──────────────────────
  // Gemini sometimes wraps the whole reply in ```...``` which hides the
  // ---HINT1--- delimiters and causes "missing required hints" error.
  let text = String(rawText || '').trim();

  // Strip leading ``` fence (with optional language tag like ```text)
  text = text.replace(/^```[\w\s]*\n?/, '').trim();
  // Strip trailing ``` fence
  text = text.replace(/\n?```\s*$/, '').trim();
  // Normalise smart/em-dashes → regular hyphens so ---HINT1--- always matches
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
  // hint4 stops at ---TC--- because we removed ---HINT5--- from the hints-only prompt
  const hint4 = extract('HINT4', 'TC') || extract('HINT4', 'END') || extract('HINT4', null);

  // hint5 comes from a separate solution model call — may or may not be in this response
  const hint5raw = extract('HINT5', 'TC') || extract('HINT5', 'END') || '';
  const hint5 = hint5raw
    .replace(/```(?:cpp|c\+\+)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  // hint5 is now generated by a separate model call — only require hint1 here
  if (!hint1) {
    throw new Error('Failed to parse AI response: missing required hints. Please retry.');
  }

  // TC/SC from hints response — paren-counting extraction handles any nesting depth
  let optimal_tc = '';
  let optimal_sc = '';

  // First try the structured ---TC--- / ---SC--- sections
  const tcSection = extract('TC', 'SC');
  const scSection = extract('SC', 'PATTERN') || extract('SC', 'END') || extract('SC', null);
  const tcInSection = extractAllBigO(tcSection);
  const scInSection = extractAllBigO(scSection);
  if (tcInSection.length) optimal_tc = tcInSection[0];
  if (scInSection.length) optimal_sc = scInSection[0];

  // Fallback: scan entire text for O() expressions if sections didn't yield values
  if (!optimal_tc || !optimal_sc) {
    const all    = extractAllBigO(text);
    const unique = [...new Set(all)];
    // Take the last two unique O() expressions — Gemini typically puts TC then SC at the end
    if (!optimal_tc) optimal_tc = unique[unique.length - 2] || unique[unique.length - 1] || '';
    if (!optimal_sc) optimal_sc = unique[unique.length - 1] || '';
  }

  const pattern = extract('PATTERN', 'END') || 'Unknown';

  return { hint1, hint2, hint3, hint4, hint5, optimal_tc, optimal_sc, pattern };
}


// ─────────────────────────────────────────────
// 6. MAIN EXPORT — generateHints()
//    Strategy:
//      Call 1 — hints + code (always)
//      Call 2 — dedicated TC/SC (ONLY if Call 1 failed to parse TC/SC)
//    This saves API quota: 1 call on happy path, 2 only when needed.
//    Falls back to Chrome Built-in AI if no Gemini API key.
// ─────────────────────────────────────────────

async function generateHints(problemData) {
  const { title, description, difficulty, problemNumber: number } = problemData;
  console.log('LeetHint: generateHints() called for:', title);
  console.log('LeetHint: description length:', description?.length);

  const prompt = buildPrompt(title, description, difficulty);

  // ─── PRIORITY 1: OpenRouter (google/gemini-2.5-pro) ───────────────────────
  // Best model quality + no strict rate limits. Tried first if key is present.
  const storage = await chrome.storage.local.get(['openRouterApiKey', 'geminiApiKey']);
  const openRouterKey = storage.openRouterApiKey;
  const geminiApiKey  = storage.geminiApiKey;

  console.log('LeetHint: OpenRouter key?', !!openRouterKey, '| Gemini key?', !!geminiApiKey);

  if (openRouterKey) {
    try {
      console.log('LeetHint: Using dual-model OpenRouter...');
      console.log('  Hints 1-4 →', OR_MODEL, '| Solution →', OR_MODEL_SOLUTION);
      // Pass full problemData — generateWithOpenRouter makes two parallel calls
      const hintsResult = await generateWithOpenRouter(openRouterKey, problemData);

      if (!hintsResult.optimal_tc || !hintsResult.optimal_sc) {
        console.log('LeetHint: TC/SC missing — dedicated OR call...');
        try {
          const c = await getComplexityOpenRouter(openRouterKey, title, description, difficulty);
          if (c.tc) hintsResult.optimal_tc = c.tc;
          if (c.sc) hintsResult.optimal_sc = c.sc;
        } catch (e) { console.warn('LeetHint: OR TC/SC call failed →', e.message); }
      }

      console.log('LeetHint: FINAL TC =', hintsResult.optimal_tc, '| SC =', hintsResult.optimal_sc);
      console.log('LeetHint: OpenRouter dual-model succeeded ✅');
      return hintsResult;
    } catch (e) {
      console.warn('LeetHint: OpenRouter failed →', e.message, '— trying Gemini...');
    }
  }

  // ─── PRIORITY 2: Direct Google Gemini key ────────────────────────────────
  if (geminiApiKey) {
    try {
      // ── CALL 1: Hints + code ──────────────────────────────────────────
      console.log('LeetHint: Fetching hints from Gemini (Call 1)...');
      const hintsResult = await generateWithGemini(geminiApiKey, prompt);

      // ── CALL 2 (conditional): Dedicated TC/SC ─────────────────────────
      // Only fires when Call 1 did not produce parseable TC/SC.
      if (!hintsResult.optimal_tc || !hintsResult.optimal_sc) {
        console.log('LeetHint: TC/SC missing — making dedicated call (Call 2)...');
        try {
          const complexity = await getOptimalComplexity(geminiApiKey, title, description, difficulty);
          if (complexity.tc) {
            hintsResult.optimal_tc = complexity.tc;
            console.log('LeetHint: TC from dedicated call →', complexity.tc);
          }
          if (complexity.sc) {
            hintsResult.optimal_sc = complexity.sc;
            console.log('LeetHint: SC from dedicated call →', complexity.sc);
          }
        } catch (tcErr) {
          console.warn('LeetHint: Dedicated TC/SC call failed →', tcErr.message);
        }
      } else {
        console.log('LeetHint: TC/SC parsed from hints — skipping dedicated call ✅');
      }

      console.log('LeetHint: FINAL TC =', hintsResult.optimal_tc, '| SC =', hintsResult.optimal_sc);
      console.log('LeetHint: Gemini succeeded ✅');
      return hintsResult;

    } catch (e) {
      console.warn('LeetHint: Gemini failed →', e.message);
      // Fall through to Built-in AI
    }
  }

  // ─── PRIORITY 3: Chrome Built-in AI ──────────────────────────────────────
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
// 7. TC/SC COMPARISON — smart matching
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
