#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readJsonFile, writeJsonFile } from './json-io.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..', '..');
const DEFAULT_REGISTRY_PATH = resolve(os.homedir(), '.qe', 'mcp', 'registry.json');
const QE_MCP_SERVER_PATH = resolve(REPO_ROOT, 'scripts', 'qe_mcp_server.mjs');
const QE_SECRET_LAUNCH_PATH = resolve(REPO_ROOT, 'scripts', 'qe_secret_launch.mjs');

function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

export function getDefaultRegistryPath() {
  return DEFAULT_REGISTRY_PATH;
}

export function getClientConfigPaths() {
  const home = os.homedir();
  const appData = process.env.APPDATA || resolve(home, 'AppData', 'Roaming');
  return {
    claude: resolve(home, '.claude.json'),
    codex: resolve(home, '.codex', 'config.toml'),
    gemini: resolve(home, '.gemini', 'settings.json'),
    claudeDesktop: resolve(appData, 'Claude', 'claude_desktop_config.json'),
  };
}

export function defaultRegistry() {
  return {
    version: 1,
    servers: {
      qeFramework: {
        description: 'Expose QE Framework skills, agents, docs, and prompts through a shared MCP server.',
        transport: 'stdio',
        command: process.execPath,
        args: [QE_MCP_SERVER_PATH],
        cwd: REPO_ROOT,
        trust: true,
        env: {},
        envSecrets: {},
        enabledClients: ['claude', 'codex', 'gemini'],
      },
    },
  };
}

export function readRegistry(path = DEFAULT_REGISTRY_PATH) {
  if (!existsSync(path)) {
    return defaultRegistry();
  }
  return readJsonFile(path);
}

export function writeRegistry(path = DEFAULT_REGISTRY_PATH, data) {
  ensureParentDir(path);
  writeJsonFile(path, data);
}

function quoteToml(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildLaunchDefinition(server) {
  const base = {
    command: server.command,
    args: Array.isArray(server.args) ? [...server.args] : [],
    cwd: server.cwd || REPO_ROOT,
    env: { ...(server.env || {}) },
    trust: Boolean(server.trust),
    transport: server.transport || 'stdio',
  };

  const envSecretEntries = Object.entries(server.envSecrets || {});
  if (envSecretEntries.length === 0) {
    return base;
  }

  return {
    ...base,
    command: process.execPath,
    args: [
      QE_SECRET_LAUNCH_PATH,
      '--cwd',
      base.cwd,
      ...envSecretEntries.flatMap(([envName, secretName]) => ['--env-secret', `${envName}=${secretName}`]),
      '--',
      base.command,
      ...base.args,
    ],
  };
}

function upsertClaudeConfig(configPath, registry) {
  const current = existsSync(configPath) ? readJsonFile(configPath) : {};
  const next = { ...current, mcpServers: { ...(current.mcpServers || {}) } };

  for (const [name, server] of Object.entries(registry.servers || {})) {
    if (server.enabledClients && !server.enabledClients.includes('claude')) continue;
    const launch = buildLaunchDefinition(server);
    next.mcpServers[name] = {
      command: launch.command,
      args: launch.args,
      env: launch.env,
      cwd: launch.cwd,
    };
  }

  ensureParentDir(configPath);
  writeJsonFile(configPath, next);
  return configPath;
}

function upsertGeminiConfig(configPath, registry) {
  const current = existsSync(configPath) ? readJsonFile(configPath) : {};
  const next = {
    ...current,
    mcpServers: { ...(current.mcpServers || {}) },
    mcp: { ...(current.mcp || {}) },
  };

  for (const [name, server] of Object.entries(registry.servers || {})) {
    if (server.enabledClients && !server.enabledClients.includes('gemini')) continue;
    const launch = buildLaunchDefinition(server);
    next.mcpServers[name] = {
      command: launch.command,
      args: launch.args,
      env: launch.env,
      cwd: launch.cwd,
      trust: launch.trust,
    };
  }

  ensureParentDir(configPath);
  writeJsonFile(configPath, next);
  return configPath;
}

function parseTomlSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;

  lines.forEach((line, index) => {
    const match = line.match(/^\[(.+)\]$/);
    if (match) {
      if (current) current.end = index;
      current = { name: match[1], start: index, end: lines.length };
      sections.push(current);
    }
  });

  return { lines, sections };
}

function renderCodexSection(name, server) {
  const launch = buildLaunchDefinition(server);
  const lines = [`[mcp_servers.${name}]`];
  if (launch.transport === 'stdio') {
    lines.push(`command = ${quoteToml(launch.command)}`);
    if (launch.args?.length) {
      lines.push(`args = [${launch.args.map(quoteToml).join(', ')}]`);
    }
    if (launch.cwd) {
      lines.push(`cwd = ${quoteToml(launch.cwd)}`);
    }
    if (Object.keys(launch.env || {}).length > 0) {
      lines.push('[mcp_servers.' + name + '.env]');
      for (const [key, value] of Object.entries(launch.env)) {
        lines.push(`${key} = ${quoteToml(value)}`);
      }
    }
  } else if (launch.transport === 'http') {
    lines.push(`url = ${quoteToml(server.url)}`);
  }
  return lines.join('\n');
}

function upsertCodexConfig(configPath, registry) {
  const currentText = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const { lines, sections } = parseTomlSections(currentText);
  let nextText = currentText.trimEnd();

  for (const [name, server] of Object.entries(registry.servers || {})) {
    if (server.enabledClients && !server.enabledClients.includes('codex')) continue;
    const sectionName = `mcp_servers.${name}`;
    const envSectionName = `mcp_servers.${name}.env`;
    const section = sections.find((item) => item.name === sectionName);
    const envSection = sections.find((item) => item.name === envSectionName);
    const render = renderCodexSection(name, server);

    if (!section) {
      nextText = `${nextText}\n\n${render}`.trim();
      continue;
    }

    const start = section.start;
    const end = envSection ? envSection.end : section.end;
    const before = lines.slice(0, start).join('\n');
    const after = lines.slice(end).join('\n');
    nextText = [before, render, after].filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n');
  }

  ensureParentDir(configPath);
  writeFileSync(configPath, `${nextText.trim()}\n`, 'utf8');
  return configPath;
}

export function syncRegistryToClients({
  registryPath = DEFAULT_REGISTRY_PATH,
  clients = ['claude', 'codex', 'gemini'],
  dryRun = false,
  paths = getClientConfigPaths(),
}) {
  const registry = readRegistry(registryPath);
  const applied = [];

  for (const client of clients) {
    const target = paths[client];
    if (!target) {
      throw new Error(`Unknown client: ${client}`);
    }

    if (dryRun) {
      applied.push({ client, path: target, dry_run: true });
      continue;
    }

    if (client === 'claude') {
      upsertClaudeConfig(target, registry);
    } else if (client === 'gemini') {
      upsertGeminiConfig(target, registry);
    } else if (client === 'codex') {
      upsertCodexConfig(target, registry);
    } else {
      throw new Error(`Unsupported client: ${client}`);
    }

    applied.push({ client, path: target, dry_run: false });
  }

  return {
    registry_path: registryPath,
    clients: applied,
  };
}
