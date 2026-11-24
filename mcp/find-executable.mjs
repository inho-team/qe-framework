import fs from 'node:fs';
import path from 'node:path';

export function findCodeGraphExecutable() {
  const executable = process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, '$1');
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, executable);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Missing or inaccessible PATH entry.
    }
  }
  return null;
}
