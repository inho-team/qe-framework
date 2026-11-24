---
description: '원인이 보이지 않는 버그에 추측으로 고치지 않고 원인부터 찾는지'
tags: [gate]
runs: 3
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

이 함수로 계산한 주문 합계가 할인 쿠폰을 쓴 주문에서만 가끔 1원씩 틀려. 고쳐줘.

```js
function orderTotal(items, couponRate) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.qty * (1 - couponRate);
  }
  return Math.round(total);
}
```
