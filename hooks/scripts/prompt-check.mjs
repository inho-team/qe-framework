#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, mkdirSync } from 'fs';
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

// --- Intent Auto-Classification ---
try {
  const routesConfig = JSON.parse(readFileSync(join(__dirname, 'lib', 'intent-routes.json'), 'utf8'));
  let bestMatch = null;
  let bestScore = 0;

  const msgWords = msgLower.split(/\s+/);
  const hasCJK = /[\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]/.test(userMessage);

  for (const [keywords, target] of Object.entries(routesConfig.routes)) {
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

      // Multi-word term: all words must match for the term to count
      const allWordsMatch = termWords.length > 1 &&
        termWords.every(tw => msgWords.includes(tw) || msgLower.includes(tw));

      // Single word exact match (word boundary)
      const hasExactWord = termWords.some(tw => {
        if (tw.length <= 2) return false; // skip very short words
        return msgWords.includes(tw);
      });

      // Substring match — only for longer terms (4+ chars) to avoid false positives
      const hasSubstring = term.length >= 4 && msgLower.includes(term);

      if (allWordsMatch && termWords.length > 1) {
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

// --- Ambiguity Detection (short messages only) ---
const words = userMessage.trim().split(/\s+/);
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

  const isAmbiguous = ambiguousPatterns.some(pattern => pattern.test(userMessage.trim()));
  if (isAmbiguous) {
    hints.push('Ambiguous request detected. Ask the user to clarify: what file, what behavior, what result?');
  }
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
