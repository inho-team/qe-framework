node test-hooks.js 2>/dev/null > run.log 2>&1
node test-hooks.js 2>/dev/null | grep "^errors:" | awk -F: '{print $2}' | tr -d ' '
