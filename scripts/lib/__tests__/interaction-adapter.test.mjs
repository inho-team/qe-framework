import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCommandPrefix,
  hasCodexOrHybridOption,
  renderCodexChoice,
  renderSkillCommand,
  selectDefault,
  validateQuestionSchema,
  validateSivsQuestion,
} from '../interaction_adapter.mjs';

const sivsQuestion = {
  id: 'sivs-quality-profile',
  kind: 'choice',
  question: 'SIVS 고품질 검증 수준을 설정하시겠습니까?',
  default: 'high-qa',
  requiresExplicitAnswer: true,
  options: [
    { label: '기본 고품질 QA (Recommended)', value: 'high-qa' },
    { label: 'Configure later', value: 'later' },
  ],
};

test('command rendering uses client-specific prefixes', () => {
  assert.equal(getCommandPrefix('claude'), '/');
  assert.equal(getCommandPrefix('codex'), '$');
  assert.equal(renderSkillCommand('/Qgs', 'qa-virtual-association: QA 가상 협회', { client: 'codex' }), '$Qgs qa-virtual-association: QA 가상 협회');
  assert.equal(renderSkillCommand('Qexecute -verify', 'a1b2c3d4', { client: 'claude' }), '/Qexecute -verify a1b2c3d4');
});

test('SIVS quality questions use the single-AI profile', () => {
  assert.deepEqual(validateQuestionSchema(sivsQuestion), []);
  assert.equal(hasCodexOrHybridOption(sivsQuestion), false);
  assert.deepEqual(validateSivsQuestion(sivsQuestion), []);

  const bad = {
    ...sivsQuestion,
    options: [{ label: '기본 고품질 QA', value: 'high-qa' }],
  };
  assert.deepEqual(validateSivsQuestion(bad), []);

  const legacy = {
    ...sivsQuestion,
    options: [{ label: 'Claude + Codex Hybrid', value: 'hybrid' }],
  };
  assert.deepEqual(validateSivsQuestion(legacy), ['SIVS questions must not offer Codex or Hybrid routing in single-AI mode']);
});

test('Codex choice rendering and defaults preserve the same schema', () => {
  const rendered = renderCodexChoice(sivsQuestion);
  assert.match(rendered, /1\. 기본 고품질 QA/);
  assert.match(rendered, /\[default\]/);

  assert.deepEqual(selectDefault(sivsQuestion, { qutopia: true }).selected.value, 'high-qa');
  assert.equal(selectDefault(sivsQuestion, { nonInteractive: true }).blocked, true);
});
