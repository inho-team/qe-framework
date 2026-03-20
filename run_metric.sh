#!/bin/bash
node test-hooks.js 2>/dev/null > run.log 2>&1
grep "^errors:" run.log | awk -F: '{print $2}' | tr -d ' '
