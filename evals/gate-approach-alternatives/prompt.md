---
description: '요구를 확정한 뒤 접근 방식을 고를 때, 대안을 이름으로 들어 비교하거나 하나뿐인 이유를 말하는지'
tags: [gate]
runs: 3
max_turns: 6
allowed_tools: [Read, Glob, Grep, Skill]
---

(Qunderstand 인터뷰 중) 네가 되짚어 준 내용이 맞아. 정리하면: 팀원들이 마감을 자주 놓쳐서, `todo add "보고서" --due 2026-12-01`처럼 마감일을 넣고 `todo list`에서 지난 항목이 맨 위에 `(지남)`과 함께 오면 돼. 잘못된 날짜는 오류, 알림은 이번에 안 해. 네 역질문에도 답했지: 오늘이 마감인 항목은 아직 안 지난 것으로 보고, 완료한 항목에는 `(지남)`을 안 붙여. 무엇을 만들지는 이걸로 됐어. 지금 코드는 아래 한 파일이고 Node 22야. 다음으로 넘어가 줘.

```js
// todo.js
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
```
