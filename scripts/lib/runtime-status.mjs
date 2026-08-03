// Host-neutral facade for process liveness and durable local job projection.
// Compatibility bridges may re-export these primitives, while neutral hooks
// depend on the underlying focused modules directly.
export { isProcessAlive } from './process-liveness.mjs';
export {
  detectJobStaleness,
  getLatestDurableJobStatus,
  isRuntimeLossMessage,
  resolveDurableJobStateDir,
} from './job-status.mjs';
