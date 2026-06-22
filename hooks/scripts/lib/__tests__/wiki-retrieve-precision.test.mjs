import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { wikiRetrieve } from '../../../../scripts/lib/wiki-retrieve.mjs';

/**
 * 정밀도 게이트 — "유용성"을 반증 가능하게 한다(게이트 finding 8).
 * 시드 wiki + (의도 → 기대 pageRef) 쌍으로 top-1 hit rate를 측정해 기준선과 비교한다.
 * 회귀: 매처가 confidently-wrong 페이지를 반환하면 이 테스트가 잡는다.
 */

/** 알려진 페이지로 시드된 임시 wiki를 만든다. @returns {string} root */
function seedWiki() {
  const root = mkdtempSync(path.join(tmpdir(), 'wiki-precision-'));
  const hist = path.join(root, '.qe', 'wiki', 'pages', 'history', 'indexes');
  mkdirSync(hist, { recursive: true });
  writeFileSync(path.join(hist, 'entities.md'), [
    '- [[entities/napoleon]] — napoleon bonaparte 프랑스 군인 황제 기동전 대육군 코르시카 워털루',
    '- [[entities/wellington]] — wellington 영국 장군 워털루 전투 승리',
    '- [[entities/josephine]] — josephine 황후 나폴레옹 첫 부인',
  ].join('\n') + '\n');
  writeFileSync(path.join(hist, 'concepts.md'), [
    '- [[concepts/maneuver-warfare]] — 기동전 maneuver warfare 속도 기동 우회',
    '- [[concepts/levee-en-masse]] — 국민개병 대규모 징병 프랑스혁명',
  ].join('\n') + '\n');
  writeFileSync(path.join(root, '.qe', 'wiki', 'pages', 'history', 'aliases.md'),
    '| 별칭 | 정본명 |\n| --- | --- |\n| 나폴레옹 | napoleon |\n| 웰링턴 | wellington |\n| 기동전 | maneuver |\n');
  return root;
}

const CASES = [
  { intent: '나폴레옹 대육군 코르시카 황제', expect: 'entities/napoleon' },
  { intent: 'wellington 워털루 영국 장군', expect: 'entities/wellington' },
  { intent: 'maneuver warfare 속도 기동 우회', expect: 'concepts/maneuver-warfare' },
  { intent: '국민개병 대규모 징병 프랑스혁명', expect: 'concepts/levee-en-masse' },
];

test('wikiRetrieve precision: top-1 hit rate ≥ baseline (0.75)', async () => {
  const root = seedWiki();
  try {
    let hits = 0;
    for (const c of CASES) {
      const r = await wikiRetrieve(c.intent, root);
      if (r.length > 0 && r[0].pageRef === c.expect) hits += 1;
    }
    const rate = hits / CASES.length;
    assert.ok(rate >= 0.75, `top-1 hit rate ${rate} below baseline 0.75 (${hits}/${CASES.length})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('wikiRetrieve precision: alias-normalized Korean query hits English page', async () => {
  const root = seedWiki();
  try {
    const r = await wikiRetrieve('나폴레옹 기동전 대육군', root);
    assert.ok(r.length > 0 && r[0].pageRef === 'entities/napoleon', `expected napoleon top-1, got ${JSON.stringify(r[0])}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
