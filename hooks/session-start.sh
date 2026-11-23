# QE SessionStart launcher. hooks.json sources this file with `.` (a shell
# builtin), so it starts even when Claude Code launches the hook with an empty
# or broken PATH. Only builtins run here besides node itself: no other child
# processes, so a broken PATH cannot break the launcher and startup stays fast.

qe_node=""
if command -v node >/dev/null 2>&1; then
  qe_node="node"
else
  # PATH can be empty at startup even when node is installed, so look in the
  # usual install locations. QE_NODE_PROBES (colon-separated) replaces the list;
  # set it to an empty string to probe nothing.
  qe_probes="${QE_NODE_PROBES-$HOME/.volta/bin/node:$NVM_BIN/node:/opt/homebrew/bin/node:/usr/local/bin/node:/c/Program Files/nodejs/node.exe}"
  qe_old_ifs="$IFS"
  IFS=':'
  set -f
  for qe_candidate in $qe_probes; do
    if [ -n "$qe_candidate" ] && [ -x "$qe_candidate" ]; then
      qe_node="$qe_candidate"
      break
    fi
  done
  set +f
  IFS="$qe_old_ifs"
fi

if [ -n "$qe_node" ]; then
  "$qe_node" "$CLAUDE_PLUGIN_ROOT/hooks/session-start.mjs"
else
  printf '%s\n' '{"systemMessage":"QE: node를 찾지 못해 세션 시작 안내를 건너뛰었습니다. Node.js가 설치돼 있다면 시작 시 PATH 문제일 수 있으니 /clear 로 다시 시도하세요. 없다면 Node.js 22 이상을 설치하세요.","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"QE 플러그인의 세션 시작 안내를 불러오지 못했다: Node.js(node)를 찾지 못했다. QE 스킬은 그대로 쓸 수 있다. docs/qe/에 미완료 작업이 있는지 직접 확인하고, 사용자에게 /clear 로 다시 시도하거나 Node.js 22 이상을 설치하라고 한 번 안내한다."}}'
fi
