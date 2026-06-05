#!/usr/bin/env node
'use strict';

/**
 * Managed Agents API compatibility layer.
 * Provides type definitions and helper functions for future
 * integration with Anthropic's Managed Agents API.
 *
 * @see https://platform.claude.com/docs/en/managed-agents/overview
 */

/**
 * @typedef {Object} AgentConfig
 * @property {string} name - Agent display name
 * @property {string} model - Model ID (e.g., 'claude-sonnet-4-6')
 * @property {string[]} tools - List of tool names available to the agent
 * @property {Object[]} [mcpServers] - Optional MCP server configurations
 * @property {string} [instructions] - Optional system instructions
 * @property {number} [maxTurns] - Optional max conversation turns
 */

/**
 * @typedef {Object} ThreadMessage
 * @property {string} agentName - Target agent name
 * @property {string} content - Message content
 * @property {string} [role] - Message role ('user' | 'assistant')
 * @property {string} timestamp - ISO-8601 timestamp
 */

/**
 * @typedef {Object} AgentResult
 * @property {string} agentName - Agent that produced the result
 * @property {string} status - 'completed' | 'failed' | 'timeout'
 * @property {string} [output] - Agent output text
 * @property {number} [durationMs] - Execution time in milliseconds
 * @property {number} [tokenUsage] - Total tokens used
 */

/**
 * Create an agent configuration object.
 * @param {string} name - Agent name
 * @param {string} model - Model ID
 * @param {string[]} [tools=[]] - Available tools
 * @param {Object[]} [mcpServers=[]] - MCP server configs
 * @returns {AgentConfig}
 */
export function createAgentConfig(name, model, tools = [], mcpServers = []) {
  return {
    name,
    model,
    tools,
    mcpServers,
    instructions: '',
    maxTurns: 25
  };
}

/**
 * Create a thread message for agent communication.
 * @param {string} agentName - Target agent
 * @param {string} content - Message content
 * @param {string} [role='user'] - Message role
 * @returns {ThreadMessage}
 */
export function createThreadMessage(agentName, content, role = 'user') {
  return {
    agentName,
    content,
    role,
    timestamp: new Date().toISOString()
  };
}

/**
 * Format an agent execution result for display/logging.
 * @param {AgentResult} result - Raw agent result
 * @returns {string} Formatted result string
 */
export function formatAgentResult(result) {
  const status = result.status === 'completed' ? 'OK' : result.status.toUpperCase();
  const duration = result.durationMs ? ` (${Math.round(result.durationMs / 1000)}s)` : '';
  const tokens = result.tokenUsage ? ` [${result.tokenUsage} tokens]` : '';

  let formatted = `[${result.agentName}] ${status}${duration}${tokens}`;

  if (result.output) {
    const preview = result.output.length > 200
      ? result.output.slice(0, 200) + '...'
      : result.output;
    formatted += `\n  ${preview}`;
  }

  return formatted;
}
