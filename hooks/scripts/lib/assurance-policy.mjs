/**
 * Progressive Assurance entry policy.
 *
 * Full SIVS is an explicit user choice. Prompt size, risk words, file count,
 * and natural-language goal detection never promote an ordinary request into
 * the structured workflow. Safety and response invariants remain enabled in
 * both modes and are enforced by their dedicated gates.
 */

export const ASSURANCE_MODE = Object.freeze({
  NATIVE: 'native',
  FULL_SIVS: 'full-sivs',
});

export const EXECUTION_MODE = Object.freeze({
  SOLO: 'solo',
  SUBAGENT: 'subagent',
  WAVE: 'wave',
  DURABLE: 'durable',
  ISOLATED: 'isolated',
});

const EXECUTION_MODES = new Set(Object.values(EXECUTION_MODE));

const EXPLICIT_ENTRY = /^\s*[$/](Qplan|Qgoal)(?=$|\s)/i;

/** Resolve the workflow entry without interpreting the request's semantics. */
export function resolveAssurancePolicy(message) {
  const match = typeof message === 'string' ? EXPLICIT_ENTRY.exec(message) : null;
  const skill = match?.[1]?.toLowerCase() || null;
  return Object.freeze({
    mode: skill ? ASSURANCE_MODE.FULL_SIVS : ASSURANCE_MODE.NATIVE,
    trigger: skill ? `explicit-${skill}` : 'ordinary-request',
    explicitSkill: skill,
    safetyKernel: true,
    responseStyle: true,
  });
}

export function isExplicitFullSivsEntry(message) {
  return resolveAssurancePolicy(message).mode === ASSURANCE_MODE.FULL_SIVS;
}

/** Resolve execution independently from Full SIVS activation. */
export function resolveExecutionAssurance({
  message = '',
  executionMode = EXECUTION_MODE.SOLO,
  longRunning = false,
  highRisk = false,
} = {}) {
  if (!EXECUTION_MODES.has(executionMode)) {
    throw new TypeError(`unknown execution mode: ${executionMode}`);
  }
  if (typeof longRunning !== 'boolean' || typeof highRisk !== 'boolean') {
    throw new TypeError('longRunning and highRisk must be booleans');
  }

  const assurance = resolveAssurancePolicy(message);
  const controllerRequired = executionMode === EXECUTION_MODE.DURABLE
    || longRunning
    || highRisk;

  return Object.freeze({
    assuranceMode: assurance.mode,
    executionMode,
    controllerRequired,
    controllerReason: executionMode === EXECUTION_MODE.DURABLE
      ? 'durable-execution'
      : longRunning
        ? 'long-running'
        : highRisk
          ? 'high-risk'
          : 'not-required',
    safetyKernel: assurance.safetyKernel,
    responseStyle: assurance.responseStyle,
  });
}
