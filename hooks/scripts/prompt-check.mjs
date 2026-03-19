#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';

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

const cwd = data.cwd || data.directory || process.cwd();
const cfg = loadConfig(cwd);
const userMessage = data.user_message || data.message || '';

if (!userMessage) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const hints = [];
const msgLower = userMessage.toLowerCase();

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
- Response language: ${detected} (same as user's language)
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

// --- Intent Auto-Classification (skip if ambiguous) ---
if (!isAmbiguous) try {
  const routesConfig = JSON.parse(readFileSync(join(__dirname, 'lib', 'intent-routes.json'), 'utf8'));
  let bestMatch = null;
  let bestScore = 0;

  const msgWords = msgLower.split(/\s+/);
  const hasCJK = /[\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]/.test(userMessage);

  // Build bigrams for contextual matching (e.g., "create skill" vs "create command")
  const msgBigrams = [];
  for (let i = 0; i < msgWords.length - 1; i++) {
    msgBigrams.push(msgWords[i] + ' ' + msgWords[i + 1]);
  }

  for (const [keywords, routeEntry] of Object.entries(routesConfig.routes)) {
    const target = typeof routeEntry === 'object' ? routeEntry.skill : routeEntry;
    const routeIntent = typeof routeEntry === 'object' ? routeEntry.intent : null;
    const parts = keywords.split('/');
    let matchedParts = 0;
    let totalWeight = 0;

    for (const part of parts) {
      const term = part.toLowerCase().replace(/-/g, ' ');
      const termWords = term.split(/\s+/);
      const isCJKTerm = /[\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]/.test(term);

      // CJK terms use substring matching with high weight (no word boundaries in CJK)
      if (isCJKTerm && hasCJK) {
        if (msgLower.includes(term)) {
          matchedParts++;
          totalWeight += term.length * 3;  // CJK substring = 3x weight
          continue;
        }
        // Partial CJK match: check each word in the term
        const cjkWords = term.split(/\s+/);
        const partialMatch = cjkWords.some(w => w.length >= 2 && msgLower.includes(w));
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
        termWords.every(tw => msgWords.includes(tw) || msgLower.includes(tw));

      // Single word exact match (word boundary)
      const hasExactWord = termWords.some(tw => {
        if (tw.length <= 2) return false; // skip very short words
        return msgWords.includes(tw);
      });

      // Substring match — only for longer terms (4+ chars) to avoid false positives
      const hasSubstring = term.length >= 4 && msgLower.includes(term);

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
      bestMatch = { intent: routeIntent || keywords, routed_to: target };
    }
  }

  if (bestMatch && bestScore >= cfg.intent_confidence_threshold) {
    const stateDir = join(cwd, '.qe', 'state');
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    atomicWriteJson(join(stateDir, 'intent-route.json'), {
      intent: bestMatch.intent,
      routed_to: bestMatch.routed_to,
      confidence: bestScore,
      classified_at: new Date().toISOString()
    });
    hints.push(`[INTENT] Auto-classified → ${bestMatch.routed_to} (intent: ${bestMatch.intent})`);
  }
} catch {
  // Fault-tolerant: skip classification on error
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
