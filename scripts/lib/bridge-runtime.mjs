// Stable neutral facade retained by the G001 acceptance contract. The concrete
// neutral implementation lives in delegation-context.mjs so existing bridge
// imports and new neutral callers share the same function identities.
export {
  DELEGATION_ARTIFACT_BYTE_CAP,
  DELEGATION_TRUNCATION_MARKER,
  SIVS_STAGES,
  buildDelegationContext,
  loadSivsConfig,
  loadSvsConfig,
} from './delegation-context.mjs';
