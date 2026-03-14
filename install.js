#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const targets = [
  { src: 'skills', dest: path.join(os.homedir(), '.claude', 'commands'), label: 'skill' },
  { src: 'agents', dest: path.join(os.homedir(), '.claude', 'agents'), label: 'agent' },
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

for (const { src, dest, label } of targets) {
  const srcDir = path.join(__dirname, src);
  if (!fs.existsSync(srcDir)) {
    console.log(`${src}/ not found. Skipping ${label}s.`);
    continue;
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(srcDir);
  for (const entry of entries) {
    copyRecursive(path.join(srcDir, entry), path.join(dest, entry));
    console.log(`Installed ${label}: ${entry} -> ${dest}`);
  }
  console.log(`${entries.length} ${label}(s) installed.\n`);
}
