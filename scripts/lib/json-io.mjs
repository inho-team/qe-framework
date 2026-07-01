/**
 * lib/json-io.mjs
 *
 * Minimal JSON file helpers. These two functions used to live in
 * `ai_team_config.mjs`, which was removed in the v4.0.0 single-engine refactor.
 * `qe_secrets.mjs` still needs the helpers, so this file keeps that import
 * chain small and explicit.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Read and parse a JSON file, stripping a leading UTF-8 BOM if present.
 *
 * @param {string} path
 * @returns {any} parsed JSON
 */
export function readJsonFile(path) {
  const raw = readFileSync(path, 'utf8');
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

/**
 * Serialize `data` as pretty JSON (2-space indent, trailing newline),
 * creating the parent directory if it does not exist.
 *
 * @param {string} path
 * @param {any} data
 */
export function writeJsonFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
