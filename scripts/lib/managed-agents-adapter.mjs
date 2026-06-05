#!/usr/bin/env node
'use strict';

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createAgentConfig } from './managed-agents.mjs';

/**
 * Parse frontmatter from an agent .md file.
 * Extracts YAML-like key: value pairs between --- delimiters.
 * @param {string} content - Raw .md file content
 * @returns {Object} Parsed frontmatter fields
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fields = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }

    fields[key] = value;
  }
  return fields;
}

/**
 * Convert a QE agent .md definition to Managed Agents API format.
 * Reads the agent file, parses frontmatter, and returns a config object
 * compatible with Anthropic's Managed Agents API.
 *
 * @param {string} agentMdPath - Absolute path to the agent .md file
 * @returns {import('./managed-agents.mjs').AgentConfig|null} Agent config or null if parse fails
 */
export function convertQeAgentToManagedConfig(agentMdPath) {
  if (!existsSync(agentMdPath)) return null;

  try {
    const content = readFileSync(agentMdPath, 'utf8');
    const fm = parseFrontmatter(content);

    const name = fm.name || agentMdPath.split('/').pop().replace('.md', '');
    const model = fm.recommendedModel || fm.model || 'sonnet';

    // Map QE model names to Claude model IDs
    const modelMap = {
      haiku: 'claude-haiku-4-5',
      sonnet: 'claude-sonnet-4-6',
      opus: 'claude-opus-4-6',
    };

    const tools = fm.tools ? fm.tools.split(',').map(t => t.trim()) : [];

    return createAgentConfig(
      name,
      modelMap[model] || model,
      tools,
      [] // mcpServers — populated at runtime
    );
  } catch {
    return null;
  }
}

/**
 * List all QE agent definitions in a directory.
 * @param {string} agentsDir - Path to the agents/ directory
 * @returns {Array<{name: string, path: string}>} Agent file list
 */
export function listQeAgents(agentsDir) {
  if (!existsSync(agentsDir)) return [];

  try {
    return readdirSync(agentsDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('references'))
      .map(f => ({
        name: f.replace('.md', ''),
        path: join(agentsDir, f)
      }));
  } catch {
    return [];
  }
}
