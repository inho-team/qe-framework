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
  id: 'sivs-routing',
  kind: 'choice',
  question: 'SIVS 엔진 라우팅을 설정하시겠습니까?',
  default: 'hybrid',
  requiresExplicitAnswer: true,
  options: [
    { label: 'Claude + Codex Hybrid (Recommended)', value: 'hybrid' },
    { label: 'Claude single-engine', value: 'claude' },
    { label: 'Configure later', value: 'later' },
  ],
};

test('command rendering uses client-specific prefixes', () => {
  assert.equal(getCommandPrefix('claude'), '/');
  assert.equal(getCommandPrefix('codex'), '$');
  assert.equal(renderSkillCommand('/Qgs', 'qa-virtual-association: QA 가상 협회', { client: 'codex' }), '$Qgs qa-virtual-association: QA 가상 협회');
  assert.equal(renderSkillCommand('Qexecute -verify', 'a1b2c3d4', { client: 'claude' }), '/Qexecute -verify a1b2c3d4');
});

test('SIVS questions require Codex or Hybrid option', () => {
  assert.deepEqual(validateQuestionSchema(sivsQuestion), []);
  assert.equal(hasCodexOrHybridOption(sivsQuestion), true);
  assert.deepEqual(validateSivsQuestion(sivsQuestion), []);

  const bad = {
    ...sivsQuestion,
    options: [{ label: 'Claude single-engine', value: 'claude' }],
  };
  assert.deepEqual(validateSivsQuestion(bad), ['SIVS routing questions must include a Codex or Hybrid option']);
});

test('Codex choice rendering and defaults preserve the same schema', () => {
  const rendered = renderCodexChoice(sivsQuestion);
  assert.match(rendered, /1\. Claude \+ Codex Hybrid/);
  assert.match(rendered, /\[default\]/);

  assert.deepEqual(selectDefault(sivsQuestion, { qutopia: true }).selected.value, 'hybrid');
  assert.equal(selectDefault(sivsQuestion, { nonInteractive: true }).blocked, true);
});
