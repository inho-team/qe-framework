#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { getDefaultSivsConfig } from './lib/codex_bridge.mjs';

const CONFIG_PATH = path.join(process.cwd(), '.qe', 'sivs-config.json');
const LEGACY_CONFIG_PATH = path.join(process.cwd(), '.qe', 'svs-config.json');

const ALLOWED_ENGINES = ['claude', 'codex'];
const ALLOWED_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const ALLOWED_TOP_LEVEL_KEYS = new Set(['spec', 'implement', 'verify', 'supervise']);
const ALLOWED_STAGE_KEYS = new Set(['engine', 'model', 'effort', 'background', 'compaction']);

/**
 * Validate configuration object against SIVS schema
 * @returns {{ valid: boolean, config?: object, errors?: string[] }}
 */
function validateConfig(config) {
  const errors = [];

  // Check top-level keys
  for (const key of Object.keys(config)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Invalid top-level key "${key}". Allowed: spec, implement, verify, supervise`);
    }
  }

  // Validate each stage
  for (const stage of ['spec', 'implement', 'verify', 'supervise']) {
    if (config[stage] !== undefined) {
      const stageConfig = config[stage];

      // Stage must be an object
      if (typeof stageConfig !== 'object' || stageConfig === null || Array.isArray(stageConfig)) {
        errors.push(`${stage} must be an object`);
        continue;
      }

      // Check allowed keys in stage
      for (const key of Object.keys(stageConfig)) {
        if (!ALLOWED_STAGE_KEYS.has(key)) {
          errors.push(`${stage}.${key} is not allowed. Allowed: engine, model, effort, background, compaction`);
        }
      }

      // Validate engine
      if (stageConfig.engine !== undefined) {
        if (!ALLOWED_ENGINES.includes(stageConfig.engine)) {
          errors.push(`${stage}.engine must be "claude" or "codex", got "${stageConfig.engine}"`);
        }
      }

      // Validate model
      if (stageConfig.model !== undefined) {
        if (typeof stageConfig.model !== 'string') {
          errors.push(`${stage}.model must be a string, got ${typeof stageConfig.model}`);
        }
      }

      // Validate effort
      if (stageConfig.effort !== undefined) {
        if (!ALLOWED_EFFORTS.includes(stageConfig.effort)) {
          errors.push(`${stage}.effort must be one of [${ALLOWED_EFFORTS.join(', ')}], got "${stageConfig.effort}"`);
        }
      }

      // Validate background
      if (stageConfig.background !== undefined) {
        if (typeof stageConfig.background !== 'boolean') {
          errors.push(`${stage}.background must be a boolean, got ${typeof stageConfig.background}`);
        }
      }

      // Validate compaction
      if (stageConfig.compaction !== undefined) {
        if (typeof stageConfig.compaction !== 'object' || stageConfig.compaction === null || Array.isArray(stageConfig.compaction)) {
          errors.push(`${stage}.compaction must be an object`);
        } else {
          const allowedCompactionKeys = new Set(['enabled', 'strategy']);
          for (const key of Object.keys(stageConfig.compaction)) {
            if (!allowedCompactionKeys.has(key)) {
              errors.push(`${stage}.compaction.${key} is not allowed. Allowed: enabled, strategy`);
            }
          }
          if (stageConfig.compaction.enabled !== undefined && typeof stageConfig.compaction.enabled !== 'boolean') {
            errors.push(`${stage}.compaction.enabled must be a boolean`);
          }
          if (stageConfig.compaction.strategy !== undefined) {
            const allowedStrategies = ['server', 'client', 'auto'];
            if (!allowedStrategies.includes(stageConfig.compaction.strategy)) {
              errors.push(`${stage}.compaction.strategy must be one of [server, client, auto], got "${stageConfig.compaction.strategy}"`);
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Merge user config with defaults
 */
function resolveConfig(config) {
  const defaults = getDefaultSivsConfig();
  const resolved = {};
  for (const stage of ['spec', 'implement', 'verify', 'supervise']) {
    resolved[stage] = {
      engine: config[stage]?.engine ?? defaults[stage].engine,
      ...(config[stage]?.model && { model: config[stage].model }),
      ...(config[stage]?.effort && { effort: config[stage].effort }),
      ...(config[stage]?.background !== undefined && { background: config[stage].background })
    };
  }
  return resolved;
}

/**
 * Format config for display
 */
function formatConfig(config) {
  const lines = [];
  for (const stage of ['spec', 'implement', 'verify', 'supervise']) {
    const stageConfig = config[stage];
    let line = `  ${stage.padEnd(12)} ${stageConfig.engine}`;
    const details = [];
    if (stageConfig.model) {
      details.push(`model: ${stageConfig.model}`);
    }
    if (stageConfig.effort) {
      details.push(`effort: ${stageConfig.effort}`);
    }
    if (stageConfig.background !== undefined) {
      details.push(`background: ${stageConfig.background}`);
    }
    if (details.length > 0) {
      line += ` (${details.join(', ')})`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Main validation logic
 */
function main() {
  try {
    // Check for new config path first, then legacy
    let configPath = CONFIG_PATH;
    if (!fs.existsSync(CONFIG_PATH)) {
      if (fs.existsSync(LEGACY_CONFIG_PATH)) {
        configPath = LEGACY_CONFIG_PATH;
        console.log('[sivs-config] Using legacy .qe/svs-config.json — consider renaming to .qe/sivs-config.json');
      } else {
        const resolved = resolveConfig({});
        console.log('[sivs-config] No .qe/sivs-config.json found. Using defaults:');
        console.log(formatConfig(resolved));
        process.exit(0);
      }
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    let config;

    try {
      config = JSON.parse(fileContent);
    } catch (e) {
      console.error(`[sivs-config] Validation error: Invalid JSON in ${configPath}`);
      process.exit(1);
    }

    // Ensure config is an object
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      console.error(`[sivs-config] Validation error: Config must be a JSON object`);
      process.exit(1);
    }

    const validation = validateConfig(config);

    if (!validation.valid) {
      for (const error of validation.errors) {
        console.error(`[sivs-config] Validation error: ${error}`);
      }
      process.exit(1);
    }

    const resolved = resolveConfig(config);
    console.log('[sivs-config] Valid configuration:');
    console.log(formatConfig(resolved));
    process.exit(0);
  } catch (e) {
    console.error(`[sivs-config] Unexpected error: ${e.message}`);
    process.exit(1);
  }
}

main();
