#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = resolve(fileURLToPath(import.meta.url), '..', '..');
const REPO_ROOT = SCRIPT_DIR;
const SKILLS_ROOT = join(REPO_ROOT, 'skills');
const AGENTS_ROOT = join(REPO_ROOT, 'agents');
const DOCS_ROOT = join(REPO_ROOT, 'docs');
const PROTOCOL_VERSION = '2025-03-26';

function walkForFiles(root, predicate, acc = []) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walkForFiles(fullPath, predicate, acc);
      continue;
    }
    if (predicate(fullPath)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 4);
  if (end < 0) return {};
  const raw = content.slice(4, end).trim();
  const data = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return data;
}

function readFileAsText(path) {
  return readFileSync(path, 'utf8');
}

function relativeRepoPath(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, '/');
}

function loadSkills() {
  return walkForFiles(SKILLS_ROOT, (path) => path.endsWith('SKILL.md')).map((path) => {
    const content = readFileAsText(path);
    const metadata = parseFrontmatter(content);
    return {
      name: basename(resolve(path, '..')),
      path,
      repoPath: relativeRepoPath(path),
      description: metadata.description || '',
      recommendedModel: metadata.recommendedModel || '',
      invocationTrigger: metadata.invocation_trigger || '',
      content,
    };
  });
}

function loadAgents() {
  return walkForFiles(AGENTS_ROOT, (path) => path.endsWith('.md')).map((path) => {
    const content = readFileAsText(path);
    return {
      name: basename(path, '.md'),
      path,
      repoPath: relativeRepoPath(path),
      content,
    };
  });
}

function loadDocs() {
  return walkForFiles(DOCS_ROOT, (path) => path.endsWith('.md')).map((path) => ({
    name: basename(path, '.md'),
    path,
    repoPath: relativeRepoPath(path),
    content: readFileAsText(path),
  }));
}

const SKILLS = loadSkills();
const AGENTS = loadAgents();
const DOCS = loadDocs();

function filterByQuery(items, query, projector) {
  if (!query) return items;
  const normalized = query.toLowerCase();
  return items.filter((item) => projector(item).toLowerCase().includes(normalized));
}

function truncate(text, max = 1200) {
  return text.length <= max ? text : `${text.slice(0, max)}\n...`;
}

function skillByName(name) {
  return SKILLS.find((item) => item.name.toLowerCase() === String(name).toLowerCase());
}

function agentByName(name) {
  return AGENTS.find((item) => item.name.toLowerCase() === String(name).toLowerCase());
}

function docByName(name) {
  return DOCS.find((item) => item.name.toLowerCase() === String(name).toLowerCase());
}

function listTools() {
  return [
    {
      name: 'qe_list_skills',
      description: 'List QE Framework skills with optional query filtering.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
    {
      name: 'qe_read_skill',
      description: 'Read a QE Framework skill instruction file by name.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      },
    },
    {
      name: 'qe_list_agents',
      description: 'List QE Framework agents with optional query filtering.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
    },
    {
      name: 'qe_read_agent',
      description: 'Read a QE Framework agent file by name.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      },
    },
    {
      name: 'qe_read_doc',
      description: 'Read a QE Framework documentation page by short name or filename stem.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      },
    },
    {
      name: 'qe_framework_help',
      description: 'Return the QE Framework quick-start and recommended workflow.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

function toolResponse(payload) {
  return {
    content: [
      {
        type: 'text',
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: typeof payload === 'string' ? { text: payload } : payload,
  };
}

function callTool(name, args = {}) {
  if (name === 'qe_list_skills') {
    const filtered = filterByQuery(
      SKILLS,
      args.query,
      (item) => `${item.name} ${item.description} ${item.invocationTrigger}`
    ).slice(0, args.limit || 50);

    return toolResponse({
      skills: filtered.map((item) => ({
        name: item.name,
        path: item.repoPath,
        description: item.description,
        recommendedModel: item.recommendedModel,
      })),
    });
  }

  if (name === 'qe_read_skill') {
    const skill = skillByName(args.name);
    if (!skill) throw new Error(`Unknown skill: ${args.name}`);
    return toolResponse({
      name: skill.name,
      path: skill.repoPath,
      description: skill.description,
      content: skill.content,
    });
  }

  if (name === 'qe_list_agents') {
    const filtered = filterByQuery(AGENTS, args.query, (item) => `${item.name} ${item.repoPath}`).slice(
      0,
      args.limit || 50
    );
    return toolResponse({
      agents: filtered.map((item) => ({
        name: item.name,
        path: item.repoPath,
      })),
    });
  }

  if (name === 'qe_read_agent') {
    const agent = agentByName(args.name);
    if (!agent) throw new Error(`Unknown agent: ${args.name}`);
    return toolResponse({
      name: agent.name,
      path: agent.repoPath,
      content: agent.content,
    });
  }

  if (name === 'qe_read_doc') {
    const doc = docByName(args.name);
    if (!doc) throw new Error(`Unknown doc: ${args.name}`);
    return toolResponse({
      name: doc.name,
      path: doc.repoPath,
      content: doc.content,
    });
  }

  if (name === 'qe_framework_help') {
    return toolResponse({
      workflow: {
        claude: ['/Qplan', '/Qgs', '/Qatomic-run', '/Qcode-run-task'],
        codex: ['$Qplan', '$Qgs', '$Qatomic-run', '$Qcode-run-task'],
      },
      docs: ['docs/USAGE_GUIDE.md', 'docs/MULTI_MODEL_SETUP.md', 'docs/SECRETS.md'],
      note: 'Claude uses plugin skills directly. Codex and Gemini should use this QE MCP server to discover QE skills, agents, and workflow docs.',
    });
  }

  throw new Error(`Unsupported tool: ${name}`);
}

function listResources() {
  const topResources = [
    {
      uri: 'qe://skills/catalog',
      name: 'QE Skill Catalog',
      description: 'Top-level QE skill catalog.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'qe://docs/usage-guide',
      name: 'QE Usage Guide',
      description: 'Detailed usage guide for the QE workflow.',
      mimeType: 'text/markdown',
    },
  ];

  const skillResources = SKILLS.map((item) => ({
    uri: `qe://skills/${encodeURIComponent(item.name)}`,
    name: `${item.name} skill`,
    description: item.description || item.repoPath,
    mimeType: 'text/markdown',
  }));

  const agentResources = AGENTS.map((item) => ({
    uri: `qe://agents/${encodeURIComponent(item.name)}`,
    name: `${item.name} agent`,
    description: item.repoPath,
    mimeType: 'text/markdown',
  }));

  return [...topResources, ...skillResources, ...agentResources];
}

function readResource(uri) {
  if (uri === 'qe://skills/catalog') {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: readFileAsText(join(SKILLS_ROOT, 'CATALOG.md')),
        },
      ],
    };
  }

  if (uri === 'qe://docs/usage-guide') {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: readFileAsText(join(DOCS_ROOT, 'USAGE_GUIDE.md')),
        },
      ],
    };
  }

  const skillMatch = uri.match(/^qe:\/\/skills\/(.+)$/);
  if (skillMatch) {
    const skill = skillByName(decodeURIComponent(skillMatch[1]));
    if (!skill) throw new Error(`Unknown skill resource: ${uri}`);
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: skill.content,
        },
      ],
    };
  }

  const agentMatch = uri.match(/^qe:\/\/agents\/(.+)$/);
  if (agentMatch) {
    const agent = agentByName(decodeURIComponent(agentMatch[1]));
    if (!agent) throw new Error(`Unknown agent resource: ${uri}`);
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: agent.content,
        },
      ],
    };
  }

  throw new Error(`Unsupported resource URI: ${uri}`);
}

function listPrompts() {
  return [
    {
      name: 'qe-use-skill',
      description: 'Load a QE skill and apply it to the current task.',
      arguments: [
        { name: 'skill', required: true },
        { name: 'task', required: false },
      ],
    },
    {
      name: 'qe-use-agent',
      description: 'Load a QE agent instruction file and apply it to the current task.',
      arguments: [
        { name: 'agent', required: true },
        { name: 'task', required: false },
      ],
    },
  ];
}

function getPrompt(name, args = {}) {
  if (name === 'qe-use-skill') {
    const skill = skillByName(args.skill);
    if (!skill) throw new Error(`Unknown skill: ${args.skill}`);
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Use QE skill "${skill.name}" from ${skill.repoPath}.`,
              'Follow the skill instructions faithfully.',
              args.task ? `Task context: ${args.task}` : '',
              '',
              truncate(skill.content, 8000),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    };
  }

  if (name === 'qe-use-agent') {
    const agent = agentByName(args.agent);
    if (!agent) throw new Error(`Unknown agent: ${args.agent}`);
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Use QE agent "${agent.name}" from ${agent.repoPath}.`,
              'Treat the following file as the authoritative role instruction.',
              args.task ? `Task context: ${args.task}` : '',
              '',
              truncate(agent.content, 8000),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    };
  }

  throw new Error(`Unsupported prompt: ${name}`);
}

function sendMessage(message) {
  const json = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
}

function sendResponse(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, error) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: error.message || String(error),
    },
  });
}

function handleRequest(message) {
  const { id, method, params = {} } = message;

  try {
    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: {
          name: 'qe-framework',
          version: '3.0.17',
        },
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'ping') {
      sendResponse(id, {});
      return;
    }

    if (method === 'tools/list') {
      sendResponse(id, { tools: listTools() });
      return;
    }

    if (method === 'tools/call') {
      sendResponse(id, callTool(params.name, params.arguments || {}));
      return;
    }

    if (method === 'resources/list') {
      sendResponse(id, { resources: listResources() });
      return;
    }

    if (method === 'resources/read') {
      sendResponse(id, readResource(params.uri));
      return;
    }

    if (method === 'prompts/list') {
      sendResponse(id, { prompts: listPrompts() });
      return;
    }

    if (method === 'prompts/get') {
      sendResponse(id, getPrompt(params.name, params.arguments || {}));
      return;
    }

    throw new Error(`Unsupported method: ${method}`);
  } catch (error) {
    if (id !== undefined) {
      sendError(id, error);
    }
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;

    const headerText = buffer.slice(0, headerEnd).toString('utf8');
    const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const bodyLength = Number(lengthMatch[1]);
    const totalLength = headerEnd + 4 + bodyLength;
    if (buffer.length < totalLength) return;

    const body = buffer.slice(headerEnd + 4, totalLength).toString('utf8');
    buffer = buffer.slice(totalLength);

    const message = JSON.parse(body);
    handleRequest(message);
  }
});
