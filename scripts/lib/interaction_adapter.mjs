#!/usr/bin/env node
'use strict';

export function getCommandPrefix(client = 'claude') {
  return String(client).toLowerCase().includes('codex') ? '$' : '/';
}

export function renderSkillCommand(skillName, args = '', { client = 'claude' } = {}) {
  const prefix = getCommandPrefix(client);
  const normalized = String(skillName || '').replace(/^[$/]+/, '');
  const suffix = args ? ` ${String(args).trim()}` : '';
  return `${prefix}${normalized}${suffix}`;
}

export function validateQuestionSchema(question) {
  const errors = [];
  if (!question || typeof question !== 'object') {
    return ['question must be an object'];
  }
  if (!question.id || typeof question.id !== 'string') errors.push('id is required');
  if (!question.kind || typeof question.kind !== 'string') errors.push('kind is required');
  if (!question.question || typeof question.question !== 'string') errors.push('question is required');
  if (question.kind === 'choice') {
    if (!Array.isArray(question.options) || question.options.length === 0) {
      errors.push('choice questions require non-empty options');
    } else {
      for (const [index, option] of question.options.entries()) {
        if (!option || typeof option !== 'object') {
          errors.push(`options[${index}] must be an object`);
          continue;
        }
        if (!option.label || typeof option.label !== 'string') errors.push(`options[${index}].label is required`);
        if (!option.value || typeof option.value !== 'string') errors.push(`options[${index}].value is required`);
      }
    }
  }
  return errors;
}

export function hasCodexOrHybridOption(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  return options.some((option) => {
    const text = `${option.label || ''} ${option.value || ''}`.toLowerCase();
    return text.includes('codex') || text.includes('hybrid');
  });
}

export function isSivsRoutingQuestion(question) {
  const text = `${question?.id || ''} ${question?.question || ''}`.toLowerCase();
  return (
    text.includes('sivs') ||
    (text.includes('엔진') && (text.includes('라우팅') || text.includes('설정') || text.includes('선택'))) ||
    (text.includes('engine') && (text.includes('routing') || text.includes('config') || text.includes('select'))) ||
    (text.includes('spec') && text.includes('implement') && text.includes('verify'))
  );
}

export function validateSivsQuestion(question) {
  if (!isSivsRoutingQuestion(question)) return [];
  return hasCodexOrHybridOption(question)
    ? ['SIVS questions must not offer Codex or Hybrid routing in single-AI mode']
    : [];
}

export function renderCodexChoice(question) {
  const errors = validateQuestionSchema(question);
  if (errors.length > 0) {
    throw new Error(`Invalid interaction question: ${errors.join('; ')}`);
  }
  const lines = [question.question, ''];
  question.options.forEach((option, index) => {
    const marker = option.value === question.default ? ' [default]' : '';
    lines.push(`${index + 1}. ${option.label}${marker}`);
  });
  lines.push('', 'Reply with the number or option value.');
  return lines.join('\n');
}

export function selectDefault(question, { qutopia = false, nonInteractive = false } = {}) {
  const errors = validateQuestionSchema(question);
  if (errors.length > 0) {
    throw new Error(`Invalid interaction question: ${errors.join('; ')}`);
  }
  if (nonInteractive && question.requiresExplicitAnswer && !qutopia) {
    return { selected: null, blocked: true, reason: 'explicit answer required' };
  }
  const byDefault = question.options.find((option) => option.value === question.default);
  const recommended = question.options.find((option) => /recommended/i.test(option.label || ''));
  const selected = byDefault || recommended || question.options[0];
  return { selected, blocked: false };
}
