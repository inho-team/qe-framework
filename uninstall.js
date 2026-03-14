#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const targets = [
  { src: 'skills', dest: path.join(os.homedir(), '.claude', 'commands'), label: 'skill' },
  { src: 'agents', dest: path.join(os.homedir(), '.claude', 'agents'), label: 'agent' },
];

function removeRecursive(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      removeRecursive(path.join(target, entry));
    }
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

for (const { src, dest, label } of targets) {
  const srcDir = path.join(__dirname, src);
  if (!fs.existsSync(srcDir)) {
    console.log(`${src}/ not found. Skipping ${label}s.`);
    continue;
  }
  const entries = fs.readdirSync(srcDir);
  let removed = 0;
  for (const entry of entries) {
    const target = path.join(dest, entry);
    if (fs.existsSync(target)) {
      removeRecursive(target);
      console.log(`Removed ${label}: ${target}`);
      removed++;
    }
  }
  console.log(`${removed} ${label}(s) removed.\n`);
}
