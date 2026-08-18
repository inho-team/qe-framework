# 하네스 신호 격리 남은 작업

이 문서는 하네스 연구 실행을 다시 열기 전에 끝내야 할 작업을 정리한다. 현재 완료된 기반과 아직 검증되지 않은 설계를 구분하며, 각 단계의 진입 조건과 완료 기준을 명시한다.

## 현재 상태

append-only fact contract 기반은 완료됐다.

| 항목 | 상태 | 근거 |
|---|---|---|
| fact contract | 완료 | `core/rules/harness-signal-fact-events.contract.json` |
| shipped validator | 완료 | `scripts/lib/harness-signal-fact-events.mjs` |
| exhaustive tests | 완료 | `scripts/lib/__tests__/harness-signal-fact-events.test.mjs` |
| commit | 완료 | `004314bc28cec51ca8f5ce17ac7c1fe27cdda2fd` |
| focused verification | 완료 | 18/18 PASS |
| Verify / Risk Proof / Supervise | 완료 | 모두 PASS |

이 기반이 보장하는 범위는 다음과 같다.

- contract bytes와 validator authority를 SHA-256으로 고정한다.
- collector arrival order, observer-local time, channel-local order를 분리한다.
- residual 뒤에 도착한 wait, census, frame, closure fact를 append할 수 있다.
- contract cache poisoning, accessor, prototype, cycle, 크기 초과 입력을 fail closed 처리한다.
- package에는 contract와 validator가 포함되고 test는 제외된다.

다음 항목은 아직 보장하지 않는다.

- raw frame 의미와 발신자 진위
- caller provenance
- 하나의 trace를 최종 authority로 선택하는 절차
- terminal success 또는 quiescent 판정
- 실제 macOS process group과 TERM/KILL 격리

## 권장 실행 순서

| 순서 | 작업 | 우선순위 | 선행조건 |
|---:|---|---|---|
| 1 | terminal projection 계약 수정 및 Spec gate 통과 | P0 | 완료된 fact contract |
| 2 | pure terminal projector 구현 및 검증 | P0 | 1번 PASS |
| 3 | macOS self-group signal primitive 재설계 | P1 | 2번 commit 및 독립 검증 |
| 4 | guardian·outer lifecycle composition | P1 | 3번 commit 및 실제 probe PASS |
| 5 | study supervisor 통합 | P2 | 4번 completion evidence |
| 6 | immutable publication과 TerminalSeal | P2 | 5번 completion evidence |
| 7 | 240-cell canonical study 재개 여부 결정 | P3 | 1~6 완료 및 새 비용 승인 |

## 1. terminal projection 계약 수정

현재 `harness-signal-terminal-projection:G001`은 구현 전에 차단됐다. 제품 소스는 생성되지 않았다.

### 반드시 고칠 항목

1. authority tuple을 모든 문서에서 동일하게 사용한다.

   - canonical bytes: `1877`
   - SHA-256: `5663a40106642962b762b82e2b513ea226195d16a4b2d3e4fa485d7559d49bec`
   - TASK_REQUEST, VERIFY_CHECKLIST, planning authority, validator literal, 독립 test literal이 모두 일치해야 한다.

2. invalid trace와 valid-but-incomplete trace를 분리한다.

   - fact contract가 거부하는 duplicate event, eventId mismatch, ordinal gap, duplicate closure는 projector도 `TypeError`로 거부한다.
   - fact contract상 유효하지만 branch에 불필요한 opposite-branch frame, extra wait PID, missing required fact는 `WAIT_INCOMPLETE` terminal residual로 분류한다.
   - 두 범주를 같은 test table에 섞지 않는다.

3. canonical profile을 재사용한다.

   - `canonicalTerminalJson`은 완료된 `canonicalFactJson`과 같은 compact JSON profile을 사용한다.
   - object key 정렬, integer 제한, ASCII 문자열, accessor/prototype/cycle 거부, depth/node/byte cap, trailing LF 없음 규칙을 그대로 따른다.
   - projection contract authority만 pretty JSON + one LF를 사용한다.

4. terminal-complete 조건을 고정한다.

   - required 10개 channel closure가 모두 `eof`이고 `errorCode=null`이어야 한다.
   - `timeout` 또는 `error` closure가 하나라도 있으면 `WAIT_INCOMPLETE`다.
   - guardian, outer, decoy, sentinel, fixture wait PID는 모두 달라야 한다.
   - cooperative sentinel-only census의 sole PID는 sentinel wait PID와 같아야 한다.

5. failure lifecycle을 닫는다.

   - success branch와 blocker branch를 상호 배타적으로 정의한다.
   - blocker evidence, audited Goal blocked, on-hold task/checklist, `TASK_LOG` 갱신 경로를 모두 명시한다.
   - 실행하지 않은 항목은 `not-selected` 또는 `not-run-after-blocker`로 기록한다.

### 완료 기준

- Structural, Critical, Edge Spec reviewer가 모두 PASS한다.
- projection contract authority의 bytes/hash를 literal test가 재계산한다.
- `TypeError` 입력과 `WAIT_INCOMPLETE` 입력의 fixture 목록이 서로 겹치지 않는다.
- 구현 파일을 만들기 전에 위 조건을 충족한다.

## 2. pure terminal projector 구현

Spec gate PASS 후 다음 세 파일만 변경한다.

- `core/rules/harness-signal-terminal-projection.contract.json`
- `scripts/lib/harness-signal-terminal-projection.mjs`
- `scripts/lib/__tests__/harness-signal-terminal-projection.test.mjs`

projector는 validated fact trace만 입력받는다. 출력은 `collecting`, `terminal-residual`, `terminal-complete` 중 하나다.

### 핵심 규칙

- required closure가 부족하면 `collecting`이다.
- 가장 작은 collector ordinal의 residual이 최종 reason이다.
- residual 뒤에 complete facts가 와도 success로 승격하지 않는다.
- closed trace에 required fact가 부족하면 `WAIT_INCOMPLETE`다.
- exact cooperative 또는 resistant matrix만 `terminal-complete`다.
- result는 source trace digest와 projection contract digest를 함께 가진다.
- trace 선택 authority와 caller provenance는 계속 외부 책임으로 남긴다.

### 검증

- collecting, missing-each, cooperative complete, resistant complete, residual freeze를 각각 literal result로 검증한다.
- fact-contract-invalid trace는 모두 `TypeError`인지 확인한다.
- result와 source trace의 digest tamper를 거부한다.
- package inclusion, cache poisoning, purity, graph bounds를 검증한다.
- Verify, Risk Proof, Supervise와 isolated committed HEAD 재실행을 통과한다.

## 3. macOS signal primitive 재설계

terminal projector가 완료되기 전에는 실제 TERM/KILL probe를 다시 시작하지 않는다.

### 결정해야 할 권한 경계

- signal 권한은 sentinel의 complete validation과 internal acceptance에만 둔다.
- guardian 생존, pipe publication, ACK 성공은 signal 권한 조건으로 사용하지 않는다.
- guardian이 먼저 종료된 뒤 sentinel이 complete plan을 검증하는 경우를 acceptance와 UAR에 명시한다.
- ACK와 direct frame은 관찰 증거이며 accepted plan을 취소하지 않는다.

### 프로세스 경계

- runner session, outer sacrificial session, target process group을 분리한다.
- sentinel만 `killpg(0, SIGTERM|SIGKILL)`을 호출한다.
- built-in cooperative/resistant fixture만 허용한다.
- outside-session decoy는 정상 retire protocol로 종료하고 direct waitpid한다.
- inherited signal mask와 disposition을 모든 FD 작업 전에 초기화한다.

### 완료 기준

- actual production binary가 real `setsid`, `setpgid`, `killpg`, `waitpid`, `proc_listpgrppids`를 관통한다.
- pre-accept invalid input은 target signal 0회다.
- outside decoy의 TERM count는 0이고 exit0으로 reap된다.
- guardian loss와 evidence loss는 residual이며 quiescent로 승격하지 않는다.
- matching process와 open handle이 test 종료 후 0이다.

## 4. guardian·outer lifecycle composition

fact event contract와 terminal projector를 조합한다.

- guardian, outer, controller가 직접 관찰한 fact만 작성한다.
- wait, census, retire, direct frame, closure를 독립 event로 append한다.
- monolithic `GuardianResult`를 다시 만들지 않는다.
- trace selection digest를 immutable authority record에 결속한다.
- first residual을 유지하고 late cleanup facts를 계속 기록한다.

완료 조건은 exact child reap, stable empty census, trace closure, projection result가 모두 같은 launch와 authority digest에 묶이는 것이다.

## 5. study supervisor 통합

supervisor는 완료된 lifecycle API만 사용해야 한다.

- 실제 supervisor entrypoint를 관통하는 hermetic test를 추가한다.
- provider/network 실행은 0회다.
- predecessor 및 canonical successor runtime root는 byte-identical하게 유지한다.
- timeout, guardian loss, corrupt evidence는 resumable 또는 verified 상태가 될 수 없다.
- current implementation처럼 helper를 직접 호출해 supervisor entrypoint를 우회하는 test는 acceptance evidence로 인정하지 않는다.

## 6. immutable publication과 TerminalSeal

- execution, trace selection, terminal projection, independent verification의 exact digest chain을 만든다.
- terminal payload와 seal의 self-reference를 금지한다.
- crash boundary는 absent, indeterminate, corrupt, blocked, sealed 중 하나로만 수렴한다.
- reconciler는 classification-only다. runtime terminal payload나 seal을 새로 쓰지 않는다.
- consumed root는 재실행하지 않는다.

## 7. canonical study 재개

240-cell study는 기존 root를 재사용하거나 재시도하지 않는다. 새 실행은 다음 조건을 모두 충족해야 한다.

- 1~6번 완료
- 새 virgin canonical root
- exact predecessor authority와 commit 고정
- smoke 2회와 execute 1회
- 비용·시간 상한과 no-retry 계약에 대한 새 human acceptance
- independent verifier와 analyzer가 동일 immutable bytes를 사용한다는 binding

## 재발 방지 규칙

- immutable acceptance를 등록하기 전에 ADR과 exact authority bytes를 먼저 확정한다.
- authority를 수정하면 TASK_REQUEST와 VERIFY_CHECKLIST의 bytes/hash를 같은 변경에서 갱신한다.
- Spec gate가 두 번 FAIL하면 구현하지 않는다. successor는 blocker를 한 단계 더 작은 독립 문제로 분해한다.
- 테스트가 production entrypoint를 우회하면 user-journey evidence로 인정하지 않는다.
- downstream completion evidence를 upstream Risk Proof의 선행조건으로 요구하지 않는다.
- DB-backed `.qe` 문서는 `qe-cat`과 QE writer를 사용하며 destination-first 이동 후 source를 제거한다.

## 근거 위치

- 완료된 fact contract Goal: `.qe/planning/plans/harness-signal-fact-contract-3/`
- 완료 evidence: `.qe/planning/plans/harness-signal-fact-contract-3/evidence/G001.goal-complete.json`
- terminal projection blocker: `.qe/planning/plans/harness-signal-terminal-projection/evidence/G001.blocked.json`
- terminal projection on-hold task: `.qe/tasks/on-hold/TASK_REQUEST_075ae741.md`
- 기존 nonterminal study blocker: `.qe/planning/plans/harness-effectiveness-study-2/evidence/G003.blocker.json`

## 다음 작업

다음 작업은 1번뿐이다. terminal projection 계약을 새 acceptance로 다시 만들고 Spec gate를 PASS시킨다. 실제 projector 구현이나 native signal probe는 그 이후에 시작한다.
