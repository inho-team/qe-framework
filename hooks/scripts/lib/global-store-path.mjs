import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** Return the current user's canonical QE store path. */
export function resolveGlobalQeStorePath() {
  if (arguments.length !== 0) {
    throw new TypeError('resolveGlobalQeStorePath does not accept arguments');
  }

  const home = homedir();
  if (!isAbsolute(home)) {
    throw new Error('Unable to resolve absolute user home');
  }

  return join(home, '.qe', 'qe.db');
}
