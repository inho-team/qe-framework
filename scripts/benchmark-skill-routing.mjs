#!/usr/bin/env node
/**
 * Deterministic skill-routing benchmark runner.
 *
 * Reads:
 *   - scripts/fixtures/skill-routing-benchmark.json
 *   - hooks/scripts/lib/intent-routes.json
 *
 * Uses a local approximation of hooks/scripts/prompt-check.mjs intent scoring.
 * No network and no LLM calls. Exports pure helpers for the guard script.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeSkillName } from './skill-usage-report.mjs';
export { normalizeSkillName };

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
export const DEFAULT_FIXTURE_PATH = join(REPO_ROOT, 'scripts', 'fixtures', 'skill-routing-benchmark.json');
export const DEFAULT_ROUTES_PATH = join(REPO_ROOT, 'hooks', 'scripts', 'lib', 'intent-routes.json');
export const DEFAULT_THRESHOLD = 3;

/**
 * Reads and parses a JSON file when it exists.
 * @param {string} path
 * @returns {unknown | null}
 */
function readJsonFile(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Loads the intent route table used by the deterministic router.
 * @param {string} routesPath
 * @returns {{routes: Record<string, string | {skill?: string}>}}
 */
export function loadRoutesConfig(routesPath = DEFAULT_ROUTES_PATH) {
  const parsed = readJsonFile(routesPath);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.routes !== 'object' || parsed.routes === null) {
    throw new Error(`Invalid routes config: ${routesPath}`);
  }
  return parsed;
}

/**
 * Loads benchmark fixture cases and preserves root metadata for validation.
 * @param {string} fixturePath
 * @returns {{exists: boolean, path: string, cases: unknown[], raw: unknown}}
 */
export function loadFixtureData(fixturePath = DEFAULT_FIXTURE_PATH) {
  const parsed = readJsonFile(fixturePath);
  if (parsed === null) {
    return {
      exists: false,
      path: fixturePath,
      cases: [],
      raw: null,
    };
  }

  let cases = [];
  if (Array.isArray(parsed)) {
    cases = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cases)) {
    cases = parsed.cases;
  }

  return {
    exists: true,
    path: fixturePath,
    cases,
    raw: parsed,
  };
}

/**
 * Tests whether a value is a non-array object.
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extracts and canonicalizes the expected skill for a fixture case.
 * @param {unknown} testCase
 * @returns {string | null}
 */
export function getExpectedSkillName(testCase) {
  if (!isPlainObject(testCase)) return null;
  if (testCase.noRoute === true) return null;

  const raw = testCase.expectedSkill
    ?? testCase.expected
    ?? testCase.skill
    ?? testCase.routeTo
    ?? null;

  if (raw == null || raw === '') return null;
  return normalizeSkillName(String(raw));
}

/**
 * Detects cases that intentionally expect no QE route.
 * @param {unknown} testCase
 * @returns {boolean}
 */
function expectsNoRoute(testCase) {
  if (!isPlainObject(testCase)) return false;
  if (testCase.noRoute === true) return true;
  return Object.hasOwn(testCase, 'expected') && testCase.expected === null;
}

/**
 * Validates fixture shape without requiring route execution.
 * @param {unknown} fixtureData
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateFixtureData(fixtureData) {
  const errors = [];
  const warnings = [];

  if (!fixtureData || typeof fixtureData !== 'object') {
    return { errors: ['Fixture payload must be an object returned by loadFixtureData().'], warnings };
  }

  if (!fixtureData.exists) {
    warnings.push(`Fixture not found: ${fixtureData.path}`);
    return { errors, warnings };
  }

  const raw = fixtureData.raw;
  const cases = fixtureData.cases;
  if (!(Array.isArray(raw) || isPlainObject(raw))) {
    errors.push('Fixture root must be an array or an object with a cases array.');
  }
  if (!Array.isArray(cases)) {
    errors.push('Fixture cases must be an array.');
    return { errors, warnings };
  }

  for (let index = 0; index < cases.length; index++) {
    const testCase = cases[index];
    const label = `cases[${index}]`;
    if (!isPlainObject(testCase)) {
      errors.push(`${label} must be an object.`);
      continue;
    }

    if (typeof testCase.prompt !== 'string' || testCase.prompt.trim() === '') {
      errors.push(`${label}.prompt must be a non-empty string.`);
    }

    const hasExpectedField = [
      testCase.expectedSkill,
      testCase.expected,
      testCase.skill,
      testCase.routeTo,
    ].some((value) => value !== undefined);

    if (!expectsNoRoute(testCase) && !hasExpectedField) {
      errors.push(`${label} must define expectedSkill/expected/skill/routeTo or set noRoute: true.`);
    }

    if (testCase.noRoute === true && hasExpectedField) {
      errors.push(`${label} cannot define both noRoute: true and an expected skill.`);
    }

    const normalizedExpected = getExpectedSkillName(testCase);
    if (!expectsNoRoute(testCase) && !normalizedExpected) {
      errors.push(`${label} expected skill must normalize to a non-empty name.`);
    }
  }

  return { errors, warnings };
}

/**
 * Normalizes a prompt for keyword matching.
 * @param {unknown} message
 * @returns {string}
 */
function normalizeMessageForMatching(message) {
  return String(message || '').toLowerCase();
}

/**
 * Splits a prompt into alphanumeric and CJK-aware word tokens.
 * @param {unknown} message
 * @returns {string[]}
 */
function toWordTokens(message) {
  return normalizeMessageForMatching(message)
    .replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3\u4e00-\u9fff\u3040-\u30ff]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Builds adjacent word bigrams for phrase-sensitive matching.
 * @param {string[]} words
 * @returns {string[]}
 */
function toBigrams(words) {
  const bigrams = [];
  for (let index = 0; index < words.length - 1; index++) {
    bigrams.push(`${words[index]} ${words[index + 1]}`);
  }
  return bigrams;
}

/**
 * Checks whether text contains CJK or Japanese kana code points.
 * @param {string} text
 * @returns {boolean}
 */
function hasCjk(text) {
  return /[\u3131-\u318e\uac00-\ud7a3\u4e00-\u9fff\u3040-\u30ff]/.test(text);
}

/**
 * Scores how strongly one route keyword set matches a prompt.
 * @param {string} message
 * @param {string} keywords
 * @returns {{keywords: string, matchedParts: number, totalWeight: number, matchRatio: number, score: number}}
 */
export function scoreRoute(message, keywords) {
  const matchMessage = normalizeMessageForMatching(message);
  const msgWords = toWordTokens(matchMessage);
  const msgBigrams = toBigrams(msgWords);
  const messageHasCjk = hasCjk(matchMessage);
  const parts = String(keywords || '').split('/').filter(Boolean);

  let matchedParts = 0;
  let totalWeight = 0;

  for (const rawPart of parts) {
    const term = rawPart.toLowerCase().replace(/-/g, ' ').trim();
    if (!term) continue;

    const termWords = term.split(/\s+/).filter(Boolean);
    const termHasCjk = hasCjk(term);

    if (termHasCjk && messageHasCjk) {
      if (matchMessage.includes(term)) {
        matchedParts += 1;
        totalWeight += term.length * 3;
        continue;
      }

      const partialMatch = termWords.some((word) => word.length >= 2 && matchMessage.includes(word));
      if (partialMatch) {
        matchedParts += 0.7;
        totalWeight += term.length * 1.5;
      }
      continue;
    }

    const bigramMatch = termWords.length === 2 && msgBigrams.includes(term);
    const allWordsMatch = !bigramMatch
      && termWords.length > 1
      && termWords.every((word) => msgWords.includes(word) || matchMessage.includes(word));
    const hasExactWord = termWords.length === 1
      && termWords.some((word) => word.length > 2 && msgWords.includes(word));
    const hasSubstring = term.length >= 4 && matchMessage.includes(term);

    if (bigramMatch) {
      matchedParts += 1;
      totalWeight += term.length * 5;
    } else if (allWordsMatch && termWords.length > 1) {
      matchedParts += 1;
      totalWeight += term.length * 4;
    } else if (hasExactWord) {
      matchedParts += 1;
      totalWeight += term.length * 2;
    } else if (hasSubstring && !hasExactWord) {
      const penalty = term.length < 6 ? 0.3 : 0.7;
      matchedParts += penalty;
      totalWeight += term.length * penalty;
    }
  }

  const matchRatio = parts.length > 0 ? matchedParts / parts.length : 0;
  const score = matchedParts > 0 ? matchRatio * 5 + totalWeight : 0;
  return {
    keywords,
    matchedParts,
    totalWeight,
    matchRatio,
    score,
  };
}

/**
 * Converts a numeric route score into a coarse confidence label.
 * @param {number} score
 * @param {number} threshold
 * @returns {'HIGH' | 'MEDIUM' | 'LOW'}
 */
export function classifyConfidence(score, threshold = DEFAULT_THRESHOLD) {
  if (score >= threshold * 1.5) return 'HIGH';
  if (score >= threshold) return 'MEDIUM';
  return 'LOW';
}

/**
 * Routes a prompt to the highest-scoring skill above threshold.
 * @param {string} message
 * @param {{routes?: Record<string, string | {skill?: string}>}} routesConfig
 * @param {{threshold?: number}} [options]
 * @returns {{matched: boolean, intent: string | null, routedTo: string | null, rawSkill: string | null, score: number, confidence: string, threshold: number}}
 */
export function routePrompt(message, routesConfig, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD;
  const routes = routesConfig?.routes || {};
  let best = null;

  for (const [keywords, routeEntry] of Object.entries(routes)) {
    const target = typeof routeEntry === 'object' ? routeEntry.skill : routeEntry;
    const scoreResult = scoreRoute(message, keywords);

    if (!best || scoreResult.score > best.score || (scoreResult.score === best.score && keywords < best.intent)) {
      best = {
        intent: keywords,
        rawSkill: target == null ? '' : String(target),
        routedTo: normalizeSkillName(target == null ? '' : String(target)),
        score: scoreResult.score,
        matchedParts: scoreResult.matchedParts,
        totalWeight: scoreResult.totalWeight,
        matchRatio: scoreResult.matchRatio,
      };
    }
  }

  if (!best) {
    return {
      matched: false,
      intent: null,
      routedTo: null,
      rawSkill: null,
      score: 0,
      confidence: 'LOW',
      threshold,
    };
  }

  const confidence = classifyConfidence(best.score, threshold);
  if (confidence === 'LOW' || !best.routedTo) {
    return {
      matched: false,
      intent: best.intent,
      routedTo: null,
      rawSkill: best.rawSkill,
      score: best.score,
      confidence,
      threshold,
    };
  }

  return {
    matched: true,
    intent: best.intent,
    routedTo: best.routedTo,
    rawSkill: best.rawSkill,
    score: best.score,
    confidence,
    threshold,
  };
}

/**
 * Returns a stable display id for a fixture case.
 * @param {unknown} testCase
 * @param {number} index
 * @returns {string}
 */
function normalizeCaseId(testCase, index) {
  if (typeof testCase.id === 'string' && testCase.id.trim()) return testCase.id.trim();
  return `case-${index + 1}`;
}

/**
 * Evaluates fixture cases and summarizes route accuracy categories.
 * @param {unknown[]} cases
 * @param {{routes?: Record<string, string | {skill?: string}>}} routesConfig
 * @param {{threshold?: number}} [options]
 * @returns {{total: number, passed: number, failed: number, accuracy: number, falsePositives: object[], falseNegatives: object[], wrongRoutes: object[], results: object[]}}
 */
export function evaluateCases(cases, routesConfig, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD;
  const results = [];

  for (let index = 0; index < cases.length; index++) {
    const testCase = cases[index];
    const prompt = typeof testCase?.prompt === 'string' ? testCase.prompt : '';
    const expectedSkill = getExpectedSkillName(testCase);
    const routed = routePrompt(prompt, routesConfig, { threshold });
    const predictedSkill = routed.routedTo;
    const pass = expectedSkill === predictedSkill;

    results.push({
      id: normalizeCaseId(testCase, index),
      prompt,
      expectedSkill,
      predictedSkill,
      pass,
      intent: routed.intent,
      score: routed.score,
      confidence: routed.confidence,
      noRoute: expectedSkill === null,
    });
  }

  const total = results.length;
  const passed = results.filter((result) => result.pass).length;
  const failed = total - passed;
  const falsePositives = results.filter((result) => result.noRoute && result.predictedSkill !== null);
  const falseNegatives = results.filter((result) => !result.noRoute && result.predictedSkill === null);
  const wrongRoutes = results.filter((result) => !result.noRoute && result.predictedSkill !== null && !result.pass);

  return {
    total,
    passed,
    failed,
    accuracy: total === 0 ? 1 : passed / total,
    falsePositives,
    falseNegatives,
    wrongRoutes,
    results,
  };
}

/**
 * Renders a markdown table for failed benchmark subsets.
 * @param {string} title
 * @param {Array<{id: string, expectedSkill: string | null, predictedSkill: string | null, intent: string | null, score: number, prompt: string}>} results
 * @returns {string[]}
 */
function renderMissList(title, results) {
  const lines = [title, ''];
  if (results.length === 0) {
    lines.push('_None._', '');
    return lines;
  }
  lines.push('| ID | Expected | Predicted | Intent | Score | Prompt |');
  lines.push('|----|----------|-----------|--------|------:|--------|');
  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.expectedSkill ?? 'NO_ROUTE'} | ${result.predictedSkill ?? 'NO_ROUTE'} | ` +
      `${result.intent ?? '-'} | ${result.score.toFixed(2)} | ${result.prompt.replace(/\|/g, '\\|')} |`
    );
  }
  lines.push('');
  return lines;
}

/**
 * Renders a compact CLI summary for a benchmark run.
 * @param {ReturnType<typeof runBenchmark>} run
 * @returns {string}
 */
export function renderSummary(run) {
  const percent = (run.summary.accuracy * 100).toFixed(1);
  const lines = [
    `skill-routing-benchmark: ${run.summary.passed}/${run.summary.total} passed (${percent}%)`,
    `fixture: ${run.fixture.path}${run.fixture.exists ? '' : ' [missing]'}`,
    `routes: ${run.routesPath}`,
  ];

  if (run.fixtureWarnings.length > 0) {
    for (const warning of run.fixtureWarnings) lines.push(`warning: ${warning}`);
  }

  if (run.fixtureErrors.length > 0) {
    for (const error of run.fixtureErrors) lines.push(`error: ${error}`);
  }

  if (run.summary.failed > 0) {
    for (const result of run.summary.results.filter((entry) => !entry.pass)) {
      lines.push(
        `miss: ${result.id} expected=${result.expectedSkill ?? 'NO_ROUTE'} ` +
        `predicted=${result.predictedSkill ?? 'NO_ROUTE'} intent=${result.intent ?? '-'} score=${result.score.toFixed(2)}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Renders a reviewable markdown baseline report.
 * @param {ReturnType<typeof runBenchmark>} run
 * @returns {string}
 */
export function renderBaselineMarkdown(run) {
  const lines = [];
  lines.push('# Skill Routing Benchmark Baseline');
  lines.push('');
  lines.push(`- Fixture: \`${run.fixture.path}\``);
  lines.push(`- Fixture present: ${run.fixture.exists ? 'yes' : 'no'}`);
  lines.push(`- Routes: \`${run.routesPath}\``);
  lines.push(`- Cases: ${run.summary.total}`);
  lines.push(`- Passed: ${run.summary.passed}`);
  lines.push(`- Failed: ${run.summary.failed}`);
  lines.push(`- Accuracy: ${(run.summary.accuracy * 100).toFixed(1)}%`);
  lines.push(`- False positives: ${run.summary.falsePositives.length}`);
  lines.push(`- False negatives: ${run.summary.falseNegatives.length}`);
  lines.push(`- Wrong-route ambiguous pairs: ${run.summary.wrongRoutes.length}`);
  lines.push('');

  if (run.fixtureWarnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of run.fixtureWarnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  if (run.fixtureErrors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const error of run.fixtureErrors) lines.push(`- ${error}`);
    lines.push('');
  }

  lines.push('## Results');
  lines.push('');
  lines.push('| ID | Expected | Predicted | Pass | Confidence | Score | Intent | Prompt |');
  lines.push('|----|----------|-----------|------|------------|------:|--------|--------|');
  for (const result of run.summary.results) {
    lines.push(
      `| ${result.id} | ${result.expectedSkill ?? 'NO_ROUTE'} | ${result.predictedSkill ?? 'NO_ROUTE'} | ` +
      `${result.pass ? 'yes' : 'no'} | ${result.confidence} | ${result.score.toFixed(2)} | ${result.intent ?? '-'} | ` +
      `${result.prompt.replace(/\|/g, '\\|')} |`
    );
  }
  lines.push('');
  lines.push(...renderMissList('## False Positives', run.summary.falsePositives));
  lines.push(...renderMissList('## False Negatives', run.summary.falseNegatives));
  lines.push(...renderMissList('## Wrong Routes / Ambiguous Pairs', run.summary.wrongRoutes));
  return lines.join('\n');
}

/**
 * Loads routes, validates fixtures, and evaluates all benchmark cases.
 * @param {{fixturePath?: string, routesPath?: string, threshold?: number}} [options]
 * @returns {{fixture: object, fixtureErrors: string[], fixtureWarnings: string[], routesPath: string, threshold: number, summary: ReturnType<typeof evaluateCases>}}
 */
export function runBenchmark(options = {}) {
  const fixturePath = options.fixturePath ? resolve(options.fixturePath) : DEFAULT_FIXTURE_PATH;
  const routesPath = options.routesPath ? resolve(options.routesPath) : DEFAULT_ROUTES_PATH;
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD;

  const routesConfig = loadRoutesConfig(routesPath);
  const fixture = loadFixtureData(fixturePath);
  const validation = validateFixtureData(fixture);
  const cases = validation.errors.length > 0 ? [] : fixture.cases;
  const summary = evaluateCases(cases, routesConfig, { threshold });

  return {
    fixture,
    fixtureErrors: validation.errors,
    fixtureWarnings: validation.warnings,
    routesPath,
    threshold,
    summary,
  };
}

/**
 * Parses CLI flags for the benchmark runner.
 * @param {string[]} argv
 * @returns {{fixturePath?: string, routesPath?: string, threshold?: number, writeBaseline?: string}}
 */
function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--fixture') {
      options.fixturePath = argv[++index];
    } else if (arg === '--routes') {
      options.routesPath = argv[++index];
    } else if (arg === '--threshold') {
      options.threshold = Number(argv[++index]);
    } else if (arg === '--write-baseline') {
      options.writeBaseline = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/**
 * Writes the benchmark baseline markdown, creating parent directories.
 * @param {string} path
 * @param {string} markdown
 * @returns {string}
 */
function writeBaseline(path, markdown) {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, markdown, 'utf8');
  return resolved;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const run = runBenchmark(options);
    console.log(renderSummary(run));

    if (options.writeBaseline) {
      const baselinePath = writeBaseline(options.writeBaseline, renderBaselineMarkdown(run));
      console.log(`baseline: ${baselinePath}`);
    }

    process.exit(run.fixtureErrors.length > 0 || run.summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(`skill-routing-benchmark: FAIL ${error.message}`);
    process.exit(1);
  }
}
