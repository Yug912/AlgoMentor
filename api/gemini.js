// api/gemini.js
// Handles all AI hint generation
// Primary: Gemini Flash API (if key exists)
// Fallback: Chrome Built-in AI (window.ai)

// ─────────────────────────────────────────────
// 1. THE MASTER PROMPT — This is the secret sauce
//    Tells AI exactly HOW to generate hints
// ─────────────────────────────────────────────

function buildPrompt(title, description, difficulty) {
  return `
You are an expert DSA mentor helping a competitive programmer learn problem-solving.

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
- Example: "Use a HashMap. For nums=[2,7,11,15], target=9: see 2 → complement is 7, store {2:0}. See 7 → complement 2 is in map! Return [0,1]. What do you store as key vs value?"

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
- Use EXACTLY this format:
\`\`\`cpp
// your code here
\`\`\`
- NO dry run, NO explanation text before or after the code block
- Just the code block, nothing else

RULES:
- Use ACTUAL numbers/examples from the problem description, not generic ones
- Be concise — no fluff, no "Great question!", no generic advice
- Hints 1 and 2 must be SHORT (2-4 lines max each)
- Hints 3, 4, 5 can be detailed

Respond ONLY with this exact JSON (no extra markdown outside the JSON):
{
  "hint1": "...",
  "hint2": "...",
  "hint3": "...",
  "hint4": "...",
  "hint5": "... (include the \`\`\`cpp code block inside this string, use \\n for newlines)",
  "optimal_tc": "O(...)",
  "optimal_sc": "O(...)",
  "pattern": "..."
}
`.trim();
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
  try {
    // Sometimes AI wraps JSON in ```json ... ``` — strip that
    const cleaned = rawText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    // Validate all required fields exist
    const required = ['hint1', 'hint2', 'hint3', 'hint4', 'hint5', 'optimal_tc', 'optimal_sc'];
    for (const field of required) {
      if (!parsed[field]) throw new Error(`Missing field: ${field}`);
    }

    return parsed;
  } catch (e) {
    throw new Error(`Failed to parse AI response: ${e.message}`);
  }
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
