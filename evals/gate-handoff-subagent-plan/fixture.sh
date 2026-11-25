#!/usr/bin/env bash
set -eu

git init -q
cat > package.json <<'JSON'
{ "name": "todo-cli", "version": "0.1.0", "type": "module", "bin": { "todo": "todo.js" }, "scripts": { "test": "node --test" } }
JSON
cat > todo.js <<'JS'
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = 'todos.json';
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []);
const [command, ...rest] = process.argv.slice(2);
const todos = load();
if (command === 'add') {
  todos.push({ id: todos.length + 1, title: rest.join(' '), done: false });
  writeFileSync(FILE, JSON.stringify(todos, null, 2));
} else if (command === 'list') {
  for (const t of todos) console.log(`#${t.id} [${t.done ? 'x' : ' '}] ${t.title}`);
}
JS
git add . && git -c user.name=QE -c user.email=qe@example.invalid commit -qm 'todo cli'
git checkout -q -b feat/todo-due-date

goal="$HOME/.qe/tasks/2026-11-25-todo-due-date"
mkdir -p "$goal"
printf '{"goal": "할 일에 마감일", "project": "%s", "state": "active", "worktrees": [], "sessions": []}\n' "$(pwd -W 2>/dev/null || pwd)" > "$goal/status.json"
cat > "$goal/intent.md" <<'MD'
# 할 일 마감일 — 확정된 의도

## 왜 하는가
팀원들이 마감을 자주 놓친다.

## 원하는 결과와 완료 기준
- `todo add "보고서" --due 2026-12-01`로 마감일을 넣을 수 있다.
- `todo list`에서 마감이 지난 항목이 맨 위에 `(지남)`과 함께 온다. 오늘이 마감인 항목은 지난 것이 아니다.
- 잘못된 날짜는 저장하지 않고 오류를 낸다. 마감일이 없는 할 일은 지금처럼 동작한다.

## 이번에 하지 않을 일
- 알림 기능
MD
