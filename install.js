#!/usr/bin/env node

import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const targets = [
  { src: 'skills', dest: join(homedir(), '.claude', 'commands'), label: 'skill' },
  { src: 'agents', dest: join(homedir(), '.claude', 'agents'), label: 'agent' },
];

function copyRecursive(src, dest) {
  try {
    const stat = statSync(src);
    if (stat.isDirectory()) {
      if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(src)) {
        copyRecursive(join(src, entry), join(dest, entry));
      }
    } else {
      copyFileSync(src, dest);
    }
  } catch (err) {
    console.error(`Failed to copy ${src}: ${err.message}`);
  }
}

for (const { src, dest, label } of targets) {
  const srcDir = join(__dirname, src);
  if (!existsSync(srcDir)) {
    console.log(`${src}/ not found. Skipping ${label}s.`);
    continue;
  }
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  const entries = readdirSync(srcDir);
  for (const entry of entries) {
    copyRecursive(join(srcDir, entry), join(dest, entry));
    console.log(`Installed ${label}: ${entry} -> ${dest}`);
  }
  console.log(`${entries.length} ${label}(s) installed.\n`);
}
