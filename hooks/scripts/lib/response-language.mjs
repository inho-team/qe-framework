#!/usr/bin/env node
'use strict';

import { existsSync, readFileSync } from './qe-fs.mjs';
import { join } from 'node:path';

const PROFILE_NAMES = new Map([
  ['korean', 'Korean'], ['한국어', 'Korean'],
  ['english', 'English'], ['영어', 'English'],
  ['japanese', 'Japanese'], ['日本語', 'Japanese'], ['일본어', 'Japanese'],
  ['chinese', 'Chinese'], ['中文', 'Chinese'], ['중국어', 'Chinese'],
  ['spanish', 'Spanish'], ['español', 'Spanish'],
  ['french', 'French'], ['français', 'French'],
  ['german', 'German'], ['deutsch', 'German'],
  ['portuguese', 'Portuguese'], ['português', 'Portuguese'],
  ['italian', 'Italian'], ['italiano', 'Italian'],
]);

const LATIN_MARKERS = new Map([
  ['English', new Set(['a', 'an', 'and', 'are', 'can', 'do', 'explain', 'fix', 'hello', 'how', 'implement', 'is', 'please', 'the', 'this', 'update', 'what', 'why', 'you'])],
  ['Spanish', new Set(['como', 'cómo', 'el', 'esta', 'está', 'hola', 'la', 'por', 'que', 'qué', 'una', 'y'])],
  ['French', new Set(['bonjour', 'comment', 'est', 'et', 'la', 'le', 'pour', 'que', 'une', 'vous'])],
  ['German', new Set(['bitte', 'das', 'der', 'die', 'eine', 'ist', 'und', 'warum', 'wie'])],
  ['Portuguese', new Set(['como', 'está', 'isso', 'olá', 'o', 'por', 'que', 'uma', 'você'])],
  ['Italian', new Set(['che', 'ciao', 'come', 'il', 'la', 'per', 'questo', 'una'])],
]);

/** Remove code and identifier-heavy surfaces before natural-language detection. */
export function naturalLanguageText(message) {
  return String(message ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/(?:^|\s)(?:[A-Za-z]:\\|\.{0,2}\/|\/)[^\s]+/g, ' ')
    .replace(/(?:^|\s)[$/]Q[A-Za-z0-9-]+\b/g, ' ')
    .replace(/\b[\w.-]+\.(?:mjs|cjs|js|jsx|ts|tsx|json|md|yaml|yml|py|go|rs|java|kt|swift|css|html)\b/gi, ' ')
    .replace(/[_=<>()[\]{}|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function latinLanguage(text) {
  const words = text.toLocaleLowerCase('und').match(/\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu) || [];
  if (words.length === 0) return null;

  let best = null;
  let bestScore = 0;
  let tied = false;
  for (const [language, markers] of LATIN_MARKERS) {
    const score = words.reduce((sum, word) => sum + (markers.has(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = language;
      bestScore = score;
      tied = false;
    } else if (score > 0 && score === bestScore) {
      tied = true;
    }
  }

  if (bestScore > 0 && !tied) return { language: best, confidence: bestScore >= 2 ? 'high' : 'medium' };
  return null;
}

/** Detect the current prompt's natural-language family without external calls. */
export function detectPromptLanguage(message) {
  const text = naturalLanguageText(message);
  if (!text) return null;

  const hangul = (text.match(/[\p{Script=Hangul}]/gu) || []).length;
  const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const han = (text.match(/[\p{Script=Han}]/gu) || []).length;
  const hasChineseSpecificSignal = /[请这们个么为发复应说还过对从后里时会]/u.test(text);

  if (hangul >= 2) return { language: 'Korean', confidence: hangul >= 4 ? 'high' : 'medium', source: 'current-message' };
  if (kana >= 2) return { language: 'Japanese', confidence: kana >= 4 ? 'high' : 'medium', source: 'current-message' };
  // Han-only text is shared by Chinese and Japanese. Fail open unless the
  // message contains a simplified-Chinese signal that makes the distinction
  // deterministic enough for an enforcement context.
  if (han >= 2 && hasChineseSpecificSignal) return { language: 'Chinese', confidence: han >= 4 ? 'high' : 'medium', source: 'current-message' };

  const latin = latinLanguage(text);
  return latin ? { ...latin, source: 'current-message' } : null;
}

/** Read a bounded, known language name from the legacy project profile. */
export function readStoredLanguageProfile(cwd) {
  try {
    const path = join(cwd, '.qe', 'profile', 'language.md');
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8').slice(0, 2048);
    const raw = text.match(/Primary language:\s*([^\n(]+)/iu)?.[1]?.trim().toLocaleLowerCase('und');
    const language = raw ? PROFILE_NAMES.get(raw) : null;
    return language ? { language, confidence: 'fallback', source: 'stored-profile' } : null;
  } catch {
    return null;
  }
}

/** Current-message language always wins; stored profile is fallback only. */
export function resolveResponseLanguage(message, cwd) {
  return detectPromptLanguage(message) || readStoredLanguageProfile(cwd);
}

export function renderResponseLanguageHint(resolution) {
  if (!resolution?.language) return '';
  if (resolution.source === 'current-message') {
    return `[RESPONSE LANGUAGE] The user's most recent message is ${resolution.language}. Reply in ${resolution.language} for this turn. A stored language profile must not override this current-message signal.`;
  }
  return `[RESPONSE LANGUAGE] The current message has no detectable natural language. Fallback profile: ${resolution.language}. Reply in ${resolution.language} unless the user's intent indicates another language.`;
}
