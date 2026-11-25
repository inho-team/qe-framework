# 인터뷰 인계 검수 후속 작업 검증

- 결과: 충족
- 검증일: 2026-11-24
- 승인받은 직접 실행 방식에 따라 작업자가 테스트, 모델 응답, 평가 작업 폴더의 파일을 대조했다.

| 완료 기준 | 확인 결과 |
|---|---|
| 버그 인터뷰를 끝낸 창은 수정하지 않고 인계한다 | 인터뷰 종료, 같은 창의 compact, 인터뷰 창이 위임받은 작업자에게 승인을 전달하는 상황을 각각 확인했다. 새 작업자는 오래된 인계의 B 대신 확정 기준 A로 원인을 조사한 뒤 승인받겠다고 답했다. 처음부터 기대 동작이 명확한 작은 버그는 현 작업자가 조사했다. |
| 재개한 창의 역할을 보존한다 | 초기 실행에서 clear로 ID가 바뀌었다는 이유로 모델이 직접 조사하겠다고 답했다. 시작 안내 수정 후 같은 창의 clear 3/3은 인계했고, 역할 근거가 사라진 사례 3/3은 역할을 물었다. [clear 결과](../../../evals/results/interview-review-probes/clear-final/aggregate-result.json) · [역할 확인](../../../evals/results/interview-review-probes/ambiguous-final/aggregate-result.json) · [승인 전달](../../../evals/results/interview-review-probes/approved/aggregate-result.json) |
| 빈 문서와 기존 작업을 구분한다 | 변경 전 회귀 사례 2건 실패, 수정 후 훅 테스트 17/17 통과. 빈 파일·공백/BOM·오래된 인계, 양식이 다른 기존 문서, 계획만 있는 작업을 확인했다. |
| 수치 단서 없이 역질문하고 반례 답변으로 기준을 고친다 | 스킬 예시와 다른 도서관 반납 기한 사례에서 역질문 3/3, 롤백 사례에서 실행 버전으로 완료 기준을 수정하고 재확인 3/3. 두 사례 모두 파일 변경 0회였다. |
| 인계 내용과 범위를 검증한다 | 실제 인계 3/3에서 합의한 이유·완료 기준·제외 범위가 담긴 파일을 확인했다. 고의 위반 3건(0바이트 intent, 같은 창의 계획 작성, 조기 구현)을 각각 판별했다. 확정 전 사례에 계획 또는 구현을 끼워 넣은 대조 2건도 실제 Write 호출로 잡았다. [인계 대조](../../../evals/results/interview-review-probes/controls/aggregate-result.json) · [확정 전 대조](../../../evals/results/interview-review-probes/premature-final/aggregate-result.json) |

## 실행 결과

- `npm test` 31/31 통과. `git diff --check` 종료 코드 0.
- `npm run eval:gate -- --case 'gate-interview-*' --keep-temp --output-dir evals/results/interview-review-probes/release-command` 종료 코드 0. Claude Code 2.1.331에서 플러그인 적용 9/9 실행이 모든 조건을 함께 충족했다. 미적용 대조에서는 역질문 0/3, 반례 반영과 인계 각 3/3이었다. [최종 실행 기록](../../../evals/results/interview-review-probes/release-command/aggregate-result.json)
- 역할 검증은 재개 상황을 입력으로 제시한 실제 모델 응답 평가다. 같은 터미널에서 대화형 clear를 실행해 세션 ID 변경을 측정한 실험은 범위에 포함하지 않았다.

## 실행 중 내린 판단과 최종 리뷰

개별 grader를 단순 평균하면 0바이트 intent도 0.83으로 통과했다. 인터뷰 사례에 한해 동일 실행에서 필요한 모든 grader가 존재하고 채점·통과했는지 세도록 평가 명령을 보완했다. 일부 조건만 통과한 실행, 누락된 결과, 건너뛴 채점, 실행 횟수 재지정도 단위 테스트로 검증했다. 실제 빈 문서 대조에서 기본 CLI가 0.83으로 합격을 표시한 뒤 보완한 평가 명령은 종료 코드 1을 반환했다.

확정 전 쓰기 여부는 실제 Write·Edit 호출 기록으로 채점한다. 모델 채점기가 쓰기가 없었던 실행을 실패로 판정한 사례가 있었기 때문이다. 확정 후 인계의 내용 검사는 설치본이 지원하는 파일 본문 판독을 이용한다.

최종 검토에서 남은 치명·중요 지적은 없다. 전체 릴리스 평가는 이번 범위에서 제외했다.
