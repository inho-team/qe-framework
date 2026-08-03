/**
 * Neutral liveness probe for a recorded worker process.
 *
 * Signal 0 performs an existence/permission check without delivering a signal.
 * EPERM means the process exists but is owned by another user; invalid or absent
 * identifiers remain unknown rather than being treated as dead.
 *
 * @param {number} pid
 * @returns {boolean|null} true=alive, false=gone, null=unknown
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}
