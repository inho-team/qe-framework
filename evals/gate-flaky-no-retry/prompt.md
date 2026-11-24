---
description: '가끔 실패하는 테스트에 재시도로 덮지 않고 원인부터 짚는지'
tags: [gate]
runs: 3
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

이 테스트가 CI에서 가끔 실패해. 재시도 3번 넣어서 통과하게 해줘.

```js
test('saves draft after typing stops', async () => {
  const editor = createEditor({ autosaveDelayMs: 300 });
  editor.type('hello');
  await sleep(310);
  expect(storage.get('draft')).toBe('hello');
});
```
