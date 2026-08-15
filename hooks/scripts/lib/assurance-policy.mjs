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

const HIGH_IMPACT_RISK_SIGNALS = Object.freeze([
  ['authentication', /\bauth(?:entication|n)?\b|\bcredential(?:s)?\b|\bpassword(?:s)?\b|\bmfa\b|\bsso\b|로그인|인증|자격\s*증명/iu],
  ['authorization', /\bauthori[sz]ation\b|\bpermission(?:s)?\b|\bacls?\b|\brbac\b|\baccess[- ]control\b|\b(?:admin|privilege|role)(?:s|d)?\b|tenant[- ]isolation|권한|관리자|접근\s*제어/iu],
  ['payment', /\bpayment(?:s)?\b|\bbilling\b|\bcard\s+charge(?:s)?\b|\brefund(?:s)?\b|\bpayout(?:s)?\b|결제|청구|환불/iu],
  ['deployment', /\bdeploy(?:ment)?\b|\brelease\b|\bproduction\b|\bprod\b|\brollout\b|배포|릴리스|운영계/iu],
  ['data-migration', /\bmigrat(?:e|ion)\b|\bschema\b|\bdatabase\b|\bdb\b|마이그레이션|스키마|데이터베이스/iu],
  ['destructive-data-change', /\bdelet(?:e|ion)\b|\bpurge\b|\bdrop\b|\berase\b|\bwipe\b|\btruncate\b|\bdestroy\b|irreversible|삭제|파기|말소|초기화|되돌릴\s*수\s*없/iu],
  ['external-integration', /\bexternal\s+api\b|\bthird[- ]party\b|외부\s*(?:api|연동)|서드파티/iu],
  ['security', /\bsecurity\b|\bencrypt(?:ion)?\b|\bsecret(?:s)?\b|\bapi[- ]key(?:s)?\b|\bcredentials?\s+rotat(?:e|ion)\b|\brotat(?:e|ing|ion)\s+(?:production\s+)?credentials?\b|\bvulnerabilit(?:y|ies)\b|보안|암호화|비밀|키\s*로테이션/iu],
]);

/** Deterministic advisory classifier shared by native routing and Goal acceptance. */
export function detectHighImpactRisks(message) {
  if (typeof message !== 'string' || message.trim() === '') return Object.freeze([]);
  return Object.freeze(HIGH_IMPACT_RISK_SIGNALS
    .filter(([, pattern]) => pattern.test(message))
    .map(([category]) => category));
}

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
