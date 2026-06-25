#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { atomicWriteJson, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';
import { parseHelpFlag } from './lib/help-flag-parser.mjs';
// wiki-retrieve top-level은 fs/path만 import한다(wiki-router는 그 안에서 lazy) → 매 프롬프트
// selfTest 부작용 없음. estimateTokens를 여기서 static import하면 그 위험이 생기므로 안 한다.
import { wikiRetrieve, PUSH_FLOOR } from '../../scripts/lib/wiki-retrieve.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let input = '';
try {
  input = readFileSync('/dev/stdin', 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(input);
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// --- Fast-path: empty message early-exit (before config/state I/O) ---
const userMessage = data.user_message || data.message || '';
if (!userMessage || !userMessage.trim()) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = data.cwd || data.directory || process.cwd();
const cfg = loadConfig(cwd);

const cachePath = join(cwd, '.qe', 'planning', 'cache', 'cjk-translations.json');

// --- Load Unified State ---
const state = readUnifiedState(cwd);

const hints = [];
const msgLower = userMessage.toLowerCase();

// --- Help Flag Detection (early, before other classifications) ---
const helpFlag = parseHelpFlag(userMessage);
if (helpFlag.matched) {
  hints.push(`[HELP] SKILL REQUIRED: Invoke /Qhelp with argument '${helpFlag.skillName}' BEFORE generating any response. Do NOT answer without the skill.`);
}

// --- QE Conventions Memory Check ---
// ... (omitted for brevity, assume unchanged until negative feedback) ...

// --- QE Conventions Memory Check ---
// If the user's auto-memory doesn't have qe_conventions_routing.md, hint Claude to read QE_CONVENTIONS.md
try {
  const home = process.env.HOME || '/root';
  const encodedCwd = cwd.replace(/\//g, '-');
  const memoryDir = join(home, '.claude', 'projects', encodedCwd, 'memory');
  const conventionsMemory = join(memoryDir, 'qe_conventions_routing.md');
  if (!existsSync(conventionsMemory)) {
    hints.push('[QE_CONVENTIONS] No routing rules in memory. Read QE_CONVENTIONS.md from the QE Framework plugin and save the Override Map + key skill routing table to auto-memory as a feedback type. File: find QE_CONVENTIONS.md in the project or plugin root.');
  }
} catch {
  // Fault-tolerant: skip on error
}

// --- Ambiguity Detection (BEFORE classification — short messages only) ---
const words = userMessage.trim().split(/\s+/);
let isAmbiguous = false;
if (words.length <= cfg.ambiguous_max_words && userMessage.length <= cfg.ambiguous_max_chars) {
  const ambiguousPatterns = [
    /^help\s*me$/i,
    /^fix\s*it$/i,
    /^make\s*it\s*better$/i,
    /^do\s*something$/i,
    /^change\s*this$/i,
    /^update\s*it$/i,
    /^improve\s*this$/i,
    /^clean\s*it\s*up$/i,
    /^just\s*do\s*it$/i,
    /^handle\s*it$/i,
  ];

  isAmbiguous = ambiguousPatterns.some(pattern => pattern.test(userMessage.trim()));
  if (isAmbiguous) {
    hints.push('Ambiguous request detected. Ask the user to clarify: what file, what behavior, what result?');
  }
}

// --- Negative Feedback Detection (save-to-memory hint) ---
if (!isAmbiguous && words.length > 5) {
  const koreanCorrection = /몇\s*번을?\s*말해|또\s*그러|아까\s*말했|이미\s*말했|반복하지|다시\s*말하|왜\s*안\s|하지\s*마|하지\s*말고|그만|안\s*된다고|몇\s*번이나/.test(userMessage);
  const englishCorrection = /\b(stop doing|don't do|never do|I already told|how many times|I said don't|stop repeating)\b/i.test(userMessage);

  // Exclude code blocks
  const hasCodeBlock = /```[\s\S]*```|`[^`]+`/.test(userMessage);

  if ((koreanCorrection || englishCorrection) && !hasCodeBlock) {
    hints.push('[FEEDBACK] User correction detected. Save this feedback to auto-memory as a feedback type memory so it persists across sessions. Extract the specific rule the user is enforcing.');
    // Persist feedback for follow-up enforcement
    state.pending_feedback = {
      message: userMessage,
      detected_at: new Date().toISOString(),
      acted: false
    };
    writeUnifiedState(cwd, state);
  }
}

// --- Language Detection (save to .qe/profile/language.md) ---
try {
  const profileDir = join(cwd, '.qe', 'profile');
  const languagePath = join(profileDir, 'language.md');

  // Only detect if language.md doesn't exist yet (first detection per project)
  if (!existsSync(languagePath)) {
    const detected = detectLanguage(userMessage);
    if (detected) {
      if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });

      const langNames = {
        ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese',
        fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese',
        it: 'Italian', ru: 'Russian', ar: 'Arabic', vi: 'Vietnamese',
        th: 'Thai', hi: 'Hindi',
      };
      const langName = langNames[detected] || detected;
      const now = new Date().toISOString().split('T')[0];

      const content = `# Language Profile

## Settings
- Primary language: ${detected} (${langName})
- Response language: ${detected} + English for technical terms (no other scripts; no Chinese/Japanese unless that is the user's language)
- Internal processing language: en (always English)

## Detection History
- ${now}: ${langName} detected
`;
      writeFileSync(languagePath, content, 'utf8');
      hints.push(`[LANG] Detected: ${detected} (${langName}). Saved to .qe/profile/language.md`);
    }
  }
} catch {
  // Fault-tolerant: skip language detection on error
}

// --- Strategic Planning Hint ---
if (!isAmbiguous) {
  const planKeywords = /\b(new project|start project|roadmap|milestone|planning|plan phase|architecture|overall|전략|계획|로드맵|마일스톤)\b/i;
  if (planKeywords.test(userMessage)) {
    hints.push('[PLAN] Strategic roadmap detected. This project uses the PSE Loop (Plan-Spec-Execute). Run `/Qplan` first to establish/update the roadmap before Spec generation.');
  }
}

// --- Intent Auto-Classification (skip if ambiguous or help-flag matched) ---
if (!isAmbiguous && !helpFlag.matched) try {
  const routesConfig = JSON.parse(readFileSync(join(__dirname, 'lib', 'intent-routes.json'), 'utf8'));
  let bestMatch = null;
  let bestScore = 0;

  const hasCJK = /[\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]/.test(userMessage);

  // --- i18n: translate non-English input to English keywords via Haiku ---
  let translatedTerms = '';
  if (hasCJK) {
    try {
      const routeKeys = Object.keys(routesConfig.routes).join(', ');
      translatedTerms = await translateToKeywords(userMessage, routeKeys, cachePath);
    } catch {}
  }

  const matchMsg = msgLower + (translatedTerms ? ' ' + translatedTerms.toLowerCase() : '');
  const msgWords = matchMsg.split(/\s+/);

  // Build bigrams for contextual matching (e.g., "create skill" vs "create command")
  const msgBigrams = [];
  for (let i = 0; i < msgWords.length - 1; i++) {
    msgBigrams.push(msgWords[i] + ' ' + msgWords[i + 1]);
  }

  for (const [keywords, routeEntry] of Object.entries(routesConfig.routes)) {
    const target = typeof routeEntry === 'object' ? routeEntry.skill : routeEntry;
    const parts = keywords.split('/');
    let matchedParts = 0;
    let totalWeight = 0;

    for (const part of parts) {
      const term = part.toLowerCase().replace(/-/g, ' ');
      const termWords = term.split(/\s+/);
      const isCJKTerm = /[\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]/.test(term);

      // CJK terms use substring matching with high weight (no word boundaries in CJK)
      if (isCJKTerm && hasCJK) {
        if (matchMsg.includes(term)) {
          matchedParts++;
          totalWeight += term.length * 3;  // CJK substring = 3x weight
          continue;
        }
        // Partial CJK match: check each word in the term
        const cjkWords = term.split(/\s+/);
        const partialMatch = cjkWords.some(w => w.length >= 2 && matchMsg.includes(w));
        if (partialMatch) {
          matchedParts += 0.7;
          totalWeight += term.length * 1.5;
          continue;
        }
        continue;
      }

      // Multi-word term: check bigram match first, then all-words fallback
      const bigramMatch = termWords.length === 2 && msgBigrams.includes(term);
      const allWordsMatch = !bigramMatch && termWords.length > 1 &&
        termWords.every(tw => msgWords.includes(tw) || matchMsg.includes(tw));

      // Single word exact match (word boundary)
      const hasExactWord = termWords.some(tw => {
        if (tw.length <= 2) return false; // skip very short words
        return msgWords.includes(tw);
      });

      // Substring match — only for longer terms (4+ chars) to avoid false positives
      const hasSubstring = term.length >= 4 && matchMsg.includes(term);

      if (bigramMatch) {
        matchedParts++;
        totalWeight += term.length * 5;  // bigram exact = 5x weight (strongest signal)
      } else if (allWordsMatch && termWords.length > 1) {
        matchedParts++;
        totalWeight += term.length * 4;  // multi-word exact = 4x weight
      } else if (hasExactWord) {
        matchedParts++;
        totalWeight += term.length * 2;  // exact word match = 2x weight
      } else if (hasSubstring && !hasExactWord) {
        // Penalize substring-only matches for common short words
        const penalty = term.length < 6 ? 0.3 : 0.7;
        matchedParts += penalty;
        totalWeight += term.length * penalty;
      }
    }

    // Score = matched keyword ratio * total weight
    // Normalize by number of parts to favor routes where more keywords match
    const matchRatio = parts.length > 0 ? matchedParts / parts.length : 0;
    const score = matchedParts > 0 ? matchRatio * 5 + totalWeight : 0;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { intent: keywords, routed_to: target };
    }
  }

  // --- 3-Tier Confidence Classification ---
  const threshold = cfg.intent_confidence_threshold || 10;
  let confidence_level = 'LOW';
  if (bestScore >= threshold * 1.5) {
    confidence_level = 'HIGH';
  } else if (bestScore >= threshold) {
    confidence_level = 'MEDIUM';
  }

  if (bestMatch && confidence_level !== 'LOW') {
    state.intent_route = {
      intent: bestMatch.intent,
      routed_to: bestMatch.routed_to,
      confidence: bestScore,
      confidence_level: confidence_level,
      classified_at: new Date().toISOString()
    };
    writeUnifiedState(cwd, state);

    if (confidence_level === 'HIGH') {
      hints.push(`[INTENT] SKILL REQUIRED: Invoke /${bestMatch.routed_to} BEFORE generating any response. Do NOT answer without the skill. (intent: ${bestMatch.intent})`);
    } else {
      hints.push(`[INTENT] Skill suggested: /${bestMatch.routed_to} may be relevant to this request. (intent: ${bestMatch.intent}, confidence: MEDIUM)`);
    }
  }
} catch {
  // Fault-tolerant: skip classification on error
}

// --- Wiki knowledge hint (push) — appended AFTER existing hints so a wiki failure can
// never suppress INTENT/HELP. Own try/catch → fail-open. wikiRetrieve short-circuits to []
// when .qe/wiki is absent (one statSync), so non-wiki projects pay ~nothing and emit nothing.
try {
  const wikiHits = await wikiRetrieve(userMessage, cwd);
  if (wikiHits.length > 0 && wikiHits[0].score >= PUSH_FLOOR) {
    const slugs = wikiHits.slice(0, 2).map((h) => String(h.pageRef).replace(/^.*\//, '')).join(', ');
    // 토큰 예산: slug-only + 120자 상한(≈≤40토큰). estimateTokens는 selfTest 위험 때문에 import 안 함.
    let line = `[Wiki] 관련 지식: ${slugs} — /Qwiki-query로 상세`;
    if (line.length > 120) line = line.slice(0, 119) + '…';
    hints.push(line);
  }
} catch {
  // fail-open: wiki hint is advisory, never block the hook
}

if (hints.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `[QE] ${hints.join(' | ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}

/**
 * Translate non-English user message to English keywords via claude CLI (Haiku).
 * Returns space-separated English keywords for intent matching.
 */
async function translateToKeywords(message, routeKeys, cachePath) {
  // --- Cache Check ---
  const hash = createHash('md5').update(message).digest('hex');
  let cache = {};
  try {
    if (existsSync(cachePath)) {
      cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (cache[hash]) return cache[hash];
    }
  } catch {}

  // Read Claude Code OAuth token for direct API call (fast, no CLI startup)
  const credPath = join(process.env.HOME || '/root', '.claude', '.credentials.json');
  if (!existsSync(credPath)) return '';

  const creds = JSON.parse(readFileSync(credPath, 'utf8'));
  const token = creds?.claudeAiOauth?.accessToken;
  if (!token) return '';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `TASK: keyword extraction. Output ONLY space-separated English keywords. No sentences.\nAvailable: ${routeKeys}\nMessage: "${message}"\nKeywords:`
        }]
      }),
      signal: AbortSignal.timeout(800),
    });

    if (!resp.ok) return '';
    const body = await resp.json();
    const keywords = (body.content?.[0]?.text || '').trim().toLowerCase();

    // --- Update Cache ---
    if (keywords) {
      try {
        const cacheDir = dirname(cachePath);
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
        cache[hash] = keywords;
        // Limit cache size to ~100 entries (LRU-ish)
        const keys = Object.keys(cache);
        if (keys.length > 100) delete cache[keys[0]];
        writeFileSync(cachePath, JSON.stringify(cache, null, 2));
      } catch {}
    }

    return keywords;
  } catch {
    return '';
  }
}

/**
 * Detect language from message text using Unicode range analysis.
 * Returns ISO 639-1 code or null if undetectable.
 */
function detectLanguage(text) {
  if (!text || text.trim().length === 0) return null;

  // Count characters by script
  const counts = { ko: 0, ja: 0, zh: 0, latin: 0, cyrillic: 0, arabic: 0, thai: 0, devanagari: 0 };

  for (const ch of text) {
    const cp = ch.codePointAt(0);
    // Korean: Hangul Jamo + Hangul Syllables + Hangul Compatibility Jamo
    if ((cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3131 && cp <= 0x318E) || (cp >= 0xAC00 && cp <= 0xD7A3)) {
      counts.ko++;
    }
    // Japanese: Hiragana + Katakana (but not CJK Unified — shared with Chinese)
    else if ((cp >= 0x3040 && cp <= 0x309F) || (cp >= 0x30A0 && cp <= 0x30FF)) {
      counts.ja++;
    }
    // CJK Unified Ideographs (shared by Chinese/Japanese/Korean)
    else if (cp >= 0x4E00 && cp <= 0x9FFF) {
      counts.zh++; // default to Chinese; Japanese disambiguated by kana presence
    }
    // Latin
    else if ((cp >= 0x0041 && cp <= 0x024F)) {
      counts.latin++;
    }
    // Cyrillic
    else if (cp >= 0x0400 && cp <= 0x04FF) {
      counts.cyrillic++;
    }
    // Arabic
    else if (cp >= 0x0600 && cp <= 0x06FF) {
      counts.arabic++;
    }
    // Thai
    else if (cp >= 0x0E00 && cp <= 0x0E7F) {
      counts.thai++;
    }
    // Devanagari (Hindi)
    else if (cp >= 0x0900 && cp <= 0x097F) {
      counts.devanagari++;
    }
  }

  // If Japanese kana is present, CJK chars are likely Japanese too
  if (counts.ja > 0) {
    counts.ja += counts.zh;
    counts.zh = 0;
  }

  // Find dominant script
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;

  entries.sort((a, b) => b[1] - a[1]);
  const [dominant, count] = entries[0];

  if (count === 0) return null;

  // Map script to language
  const scriptToLang = {
    ko: 'ko', ja: 'ja', zh: 'zh', cyrillic: 'ru', arabic: 'ar', thai: 'th', devanagari: 'hi',
  };

  if (scriptToLang[dominant]) return scriptToLang[dominant];

  // Latin script — detect specific language by common words/patterns
  if (dominant === 'latin') {
    const lower = text.toLowerCase();

    // Detect by unique diacritics/characters first (strong signal, no word counting needed)
    if (/[àâçéèêëîïôùûüÿœæ]/i.test(text) && /\b(le|la|les|des|une?|est|sont|dans|pour|avec|cette?|très|mais|qui|que)\b/.test(lower)) return 'fr';
    if (/[äöüß]/i.test(text) && /\b(der|die|das|ein|eine?|ist|sind|für|mit|und|oder|nicht|über|Sie)\b/.test(lower)) return 'de';
    if (/[áéíóúñ¿¡]/i.test(text) && /\b(el|la|los|las|una?|es|son|para|con|del|por|más|pero)\b/.test(lower)) return 'es';
    if (/[ãõçáéíóú]/i.test(text) && /\b(não|também|é|são|uma?|essa?|pelo|para|com)\b/.test(lower)) return 'pt';
    if (/[àèéìíòóùú]/i.test(text) && /\b(il|lo|gli|è|sono|non|questo|questa|anche|può|della)\b/.test(lower)) return 'it';

    // Vietnamese: unique diacritics (ơ, ư, ă, đ) + tonal marks
    if (/[ơưăđ]/i.test(text) && /\b(của|và|không|có|được|này|là|một|những|các)\b/.test(lower)) return 'vi';

    // Fallback: function word counting for text without clear diacritics
    const langScores = [];

    const frWords = (lower.match(/\b(le|la|les|des|une?|est|sont|dans|pour|avec|cette?|très|aussi|mais|qui|que|dont|nous|vous)\b/g) || []).length;
    if (frWords >= 1) langScores.push(['fr', frWords]);

    const deWords = (lower.match(/\b(der|die|das|ein|eine|ist|sind|für|mit|und|oder|aber|nicht|diese[rnms]?|über|können)\b/g) || []).length;
    if (deWords >= 1) langScores.push(['de', deWords]);

    const esWords = (lower.match(/\b(el|la|los|las|una?|es|son|para|con|del|por|como|más|pero)\b/g) || []).length;
    if (esWords >= 1) langScores.push(['es', esWords]);

    const ptWords = (lower.match(/\b(não|também|é|são|uma?|essa?|pelo|para|com)\b/g) || []).length;
    if (ptWords >= 1) langScores.push(['pt', ptWords]);

    const itWords = (lower.match(/\b(il|lo|gli|è|sono|non|questo|questa|anche|può|della|delle)\b/g) || []).length;
    if (itWords >= 1) langScores.push(['it', itWords]);

    // Pick the language with most function word matches (if any beat English default)
    if (langScores.length > 0) {
      langScores.sort((a, b) => b[1] - a[1]);
      // Require 3+ function word matches to override English (prevents false positives
      // from single common words like "la" or "le" appearing in English text)
      if (langScores[0][1] >= 3) return langScores[0][0];
    }

    // Default Latin → English
    return 'en';
  }

  return null;
}
