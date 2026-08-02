#!/usr/bin/env node
'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const commandEntrypoint = (command = '') => command.match(/hooks\/scripts\/([^"']+\.mjs)/)?.[1] || null;

export function auditHookArchitecture(root = ROOT) {
  const failures = [];
  const inventory = JSON.parse(readFileSync(join(root, 'hooks/hook-inventory.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const bundled = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  if (inventory.schema !== 1) failures.push('hook inventory schema must be 1');
  if (JSON.stringify(plugin.hooks) !== JSON.stringify(bundled.hooks)) failures.push('plugin and bundled hook manifests differ');

  const records = new Map(inventory.hooks.map((hook) => [hook.event, hook]));
  const configured = Object.entries(bundled.hooks || {});
  for (const [event, groups] of configured) {
    const record = records.get(event);
    if (!record) { failures.push(`${event}: missing inventory record`); continue; }
    if (!['keep', 'improve', 'remove'].includes(record.verdict)) failures.push(`${event}: invalid verdict`);
    if (!record.userOutcome || !Array.isArray(record.findings)) failures.push(`${event}: incomplete decision evidence`);
    for (const group of groups) {
      for (const handler of group.hooks || []) {
        const rel = commandEntrypoint(handler.command);
        if (!rel) failures.push(`${event}: command does not resolve a hook entrypoint`);
        else if (!existsSync(join(root, 'hooks/scripts', rel))) failures.push(`${event}: missing entrypoint hooks/scripts/${rel}`);
        if (handler.timeout !== record.observedTimeout.claude) failures.push(`${event}: observed Claude timeout drift`);
        if (handler.timeout !== record.targetTimeoutSeconds) failures.push(`${event}: configured timeout exceeds the audited target`);
      }
    }
  }
  for (const hook of inventory.hooks) if (!bundled.hooks?.[hook.event]) failures.push(`${hook.event}: inventoried hook is not registered`);
  for (const hook of inventory.removedHooks || []) {
    if (bundled.hooks?.[hook.event]) failures.push(`${hook.event}: removed hook is still registered`);
    if (existsSync(join(root, hook.entrypoint))) failures.push(`${hook.entrypoint}: removed hook entrypoint still exists`);
  }
  for (const item of inventory.unregisteredEntrypoints || []) {
    if (!existsSync(join(root, item.entrypoint))) failures.push(`${item.entrypoint}: inventory points to missing file`);
    if (!['keep', 'improve', 'remove'].includes(item.verdict) || !item.reason) failures.push(`${item.entrypoint}: incomplete verdict`);
  }
  for (const item of inventory.removedEntrypoints || []) if (existsSync(join(root, item.entrypoint))) failures.push(`${item.entrypoint}: removed entrypoint still exists`);
  for (const principle of inventory.principles || []) {
    if (!principle.id || !principle.rule || !/^https:\/\//.test(principle.source || '')) failures.push('invalid research principle');
  }
  return {ok: failures.length === 0, failures, registered: configured.length,
    improve: inventory.hooks.filter((hook) => hook.verdict === 'improve').length,
    removed: (inventory.removedHooks?.length || 0) + (inventory.removedEntrypoints?.length || 0),
    root: relative(process.cwd(), root) || '.'};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = auditHookArchitecture();
  if (!result.ok) {
    console.error('check-hook-architecture: FAIL');
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`check-hook-architecture: PASS (${result.registered} registered, ${result.improve} improve, ${result.removed} removed)`);
}
