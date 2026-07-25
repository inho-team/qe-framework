#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), '.qe', 'sivs-config.json');
const LEGACY_CONFIG_PATH = path.join(process.cwd(), '.qe', 'svs-config.json');
const STAGES = ['spec', 'implement', 'verify', 'supervise'];
const ALLOWED_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const ALLOWED_TOP_LEVEL_KEYS = new Set(['schemaVersion', ...STAGES]);
const ALLOWED_STAGE_KEYS = new Set(['model', 'effort', 'compaction']);

function validateConfig(config) {
  const errors = [];
  for (const key of Object.keys(config)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Invalid top-level key "${key}". Allowed: schemaVersion, ${STAGES.join(', ')}`);
    }
  }
  if (config.schemaVersion !== undefined && config.schemaVersion !== 2) {
    errors.push(`schemaVersion must be 2, got ${JSON.stringify(config.schemaVersion)}`);
  }

  for (const stage of STAGES) {
    const stageConfig = config[stage];
    if (stageConfig === undefined) continue;
    if (typeof stageConfig !== 'object' || stageConfig === null || Array.isArray(stageConfig)) {
      errors.push(`${stage} must be an object`);
      continue;
    }
    for (const key of Object.keys(stageConfig)) {
      if (!ALLOWED_STAGE_KEYS.has(key)) {
        const migration = key === 'engine' || key === 'background'
          ? ' Remove engine/background: SIVS now uses the active client only.'
          : '';
        errors.push(`${stage}.${key} is not allowed. Allowed: model, effort, compaction.${migration}`);
      }
    }
    if (stageConfig.model !== undefined && (typeof stageConfig.model !== 'string' || !stageConfig.model.trim())) {
      errors.push(`${stage}.model must be a non-empty string`);
    }
    if (stageConfig.effort !== undefined && !ALLOWED_EFFORTS.includes(stageConfig.effort)) {
      errors.push(`${stage}.effort must be one of [${ALLOWED_EFFORTS.join(', ')}], got "${stageConfig.effort}"`);
    }
    if (stageConfig.compaction !== undefined) {
      const compaction = stageConfig.compaction;
      if (typeof compaction !== 'object' || compaction === null || Array.isArray(compaction)) {
        errors.push(`${stage}.compaction must be an object`);
      } else {
        for (const key of Object.keys(compaction)) {
          if (!['enabled', 'strategy'].includes(key)) errors.push(`${stage}.compaction.${key} is not allowed`);
        }
        if (compaction.enabled !== undefined && typeof compaction.enabled !== 'boolean') errors.push(`${stage}.compaction.enabled must be a boolean`);
        if (compaction.strategy !== undefined && !['server', 'client', 'auto'].includes(compaction.strategy)) errors.push(`${stage}.compaction.strategy must be one of [server, client, auto]`);
      }
    }
  }
  return errors;
}

function resolveConfig(config = {}) {
  return Object.fromEntries(STAGES.map((stage) => [stage, {
    effort: config[stage]?.effort || ((stage === 'verify' || stage === 'supervise') ? 'high' : 'default'),
    ...(config[stage]?.model ? { model: config[stage].model } : {}),
  }]));
}

function formatConfig(config) {
  return STAGES.map((stage) => {
    const current = config[stage];
    return `  ${stage.padEnd(12)} effort: ${current.effort}${current.model ? `, model: ${current.model}` : ''}`;
  }).join('\n');
}

function main() {
  let configPath = CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    if (fs.existsSync(LEGACY_CONFIG_PATH)) {
      console.error('[sivs-config] Legacy .qe/svs-config.json is unsupported. Create .qe/sivs-config.json with schemaVersion: 2.');
      process.exit(1);
    }
    console.log('[sivs-config] No .qe/sivs-config.json found. Single-AI defaults:');
    console.log(formatConfig(resolveConfig()));
    return;
  }
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {
    console.error(`[sivs-config] Validation error: Invalid JSON in ${configPath}`);
    process.exit(1);
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    console.error('[sivs-config] Validation error: Config must be a JSON object');
    process.exit(1);
  }
  const errors = validateConfig(config);
  if (errors.length) {
    errors.forEach((error) => console.error(`[sivs-config] Validation error: ${error}`));
    process.exit(1);
  }
  console.log('[sivs-config] Valid single-AI role configuration:');
  console.log(formatConfig(resolveConfig(config)));
}

main();
