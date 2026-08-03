// Stable host-neutral facade for npm lifecycle dispatch. The package manifest
// invokes package-lifecycle.mjs directly; tests and internal callers may use
// this name without duplicating installer behavior.
export {
  runPackageLifecycle,
  runPackageLifecycleCli,
} from './package-lifecycle.mjs';
