#!/usr/bin/env node

import { readdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const targets = [
  { src: 'skills', dest: join(homedir(), '.claude', 'commands'), label: 'skill' },
  { src: 'agents', dest: join(homedir(), '.claude', 'agents'), label: 'agent' },
];

for (const { src, dest, label } of targets) {
  const srcDir = join(__dirname, src);
  if (!existsSync(srcDir)) {
    console.log(`${src}/ not found. Skipping ${label}s.`);
    continue;
  }
  const entries = readdirSync(srcDir);
  let removed = 0;
  for (const entry of entries) {
    const target = join(dest, entry);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      console.log(`Removed ${label}: ${target}`);
      removed++;
    }
  }
  console.log(`${removed} ${label}(s) removed.\n`);
}
