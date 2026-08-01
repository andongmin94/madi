# Windows 한국어 IME 수동 체크리스트

## 상태 규칙

자동 테스트는 Typie message/transaction, snapshot과 저장 round-trip을 검증하지만
Windows native IME의 실제 event 순서와 후보창 동작을 대신할 수 없다.

이 문서의 모든 항목은 사람이 실제 packaged 또는 development Electron 창에서
확인해 결과를 기록하기 전까지 `NOT TESTED`다. 현재 상태를 자동 성공으로 바꾸지
않는다.

## 권장 환경 기록

- madi build / app version:
- Typie commit: `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- Windows version:
- Electron version:
- 한국어 IME 이름과 version:
- keyboard layout:
- display scale:
- test date:
- tester:

결과 값은 `PASS`, `FAIL`, `NOT TESTED` 중 하나만 사용한다. 실패 시 재현 절차와
입력 결과를 적되 실제 원고가 아닌 이 문서의 fixture 문장만 사용한다.

## 앱의 IME Test 화면 사용

1. 우측 상단 `한국어 IME 체크`를 열고 `테스트용 빈 문서 생성`을 누른다.
2. 저장 대화상자에서 시험용 `.madi` 경로를 지정한다.
3. `수동 시험 환경`의 Windows/Electron/IME/keyboard/display scale/date/tester
   7개 필드를 실제 시험 환경으로 채운다. app version, Typie commit, editor schema,
   platform과 user agent는 앱이 자동으로 기록한다.
4. 왼쪽의 실제 Typie mount에서 아래 15개 항목을 수행한다.
5. 사람이 확인한 항목만 체크해 `PASS`로 바꾼다. 실패는 해당 행의 `FAIL`
   버튼으로 기록한다.
6. `snapshot 지금 저장` 뒤 Autosave가 `snapshot 저장됨`인지 확인한다.
7. 완전 종료 복원 항목은 Electron 창과 프로세스를 완전히 종료하고 다시
   실행한 뒤 `저장한 .madi 열기`로 같은 파일을 선택한다.
8. `결과 JSON 내보내기` 또는 `결과 Markdown 내보내기`로 기록을 보관한다.

첫 실행의 15개 상태는 모두 `NOT TESTED`다. 이후 사람이 바꾼 상태는 renderer의
local storage에 보존된다. 보존 및 내보내기 대상은 상태, 위 자동·수동 환경
metadata, 마지막 composition event의 종류·문자 수·관찰 시각뿐이다. 입력 문자와
원고 본문은 저장하지 않는다. app version, Typie commit, editor schema, platform
또는 user agent가 이전 기록과 달라지면 과거 결과를 새 환경의 결과로 오인하지
않도록 15개 상태와 수동 환경을 초기화하고 화면에 경고한다.

## 입력과 조합

| 상태 | 항목 | 시험 입력/방법 | 기대 결과 |
|---|---|---|---|
| NOT TESTED | 한글 문장 연속 입력 | `용은 오래된 산맥 위를 날았다.` | 중복·누락·순서 변경 없이 한 번만 입력 |
| NOT TESTED | 초성·중성·종성 조합 | `가 각 간 갇 갈` | 조합 중 preedit와 확정 glyph가 자연스럽게 갱신 |
| NOT TESTED | 복합모음과 겹받침 | `값 닭 앉 왜 웨 의` | 겹받침/복합모음이 분리되거나 중복되지 않음 |
| NOT TESTED | 빠른 입력 시 중복·누락 확인 | fixture 문장을 빠르게 5회 입력 | character 중복 또는 누락 없음 |
| NOT TESTED | 5,000자 이상 한글 원고 입력 또는 붙여넣기 | 5,000자 이상 시험용 원고를 입력하거나 붙여넣기 | 본문 순서·문단·마지막 조합이 보존되고 저장·복원이 완료됨 |

## 조합 경계

| 상태 | 항목 | 시험 방법 | 기대 결과 |
|---|---|---|---|
| NOT TESTED | 조합 직후 Enter | 마지막 음절 조합 중 Enter | 음절은 한 번 확정되고 paragraph가 한 번만 분리 |
| NOT TESTED | 조합 직후 Undo | 마지막 음절 조합 직후 `Ctrl+Z` | 확정/조합 경계가 깨지지 않고 한 단계 되돌림 |
| NOT TESTED | Undo 후 Redo | 위 작업 뒤 `Ctrl+Y`, `Ctrl+Shift+Z` | 동일 결과로 복구, 중복 없음 |
| NOT TESTED | 조합 직후 방향키 이동 | 조합 중/직후 방향키 | 조합이 안전하게 확정되고 cursor가 한 번 이동 |

## Selection과 clipboard

| 상태 | 항목 | 시험 방법 | 기대 결과 |
|---|---|---|---|
| NOT TESTED | 선택 후 삭제 | 한국어 phrase를 선택하고 Delete/Backspace | 선택 범위만 한 번 삭제 |
| NOT TESTED | 한글 문장 복사·붙여넣기 | 한국어 문장을 복사해 다른 위치에 붙여넣기 | 내용과 paragraph break 보존 |
| NOT TESTED | 한글/Word 계열에서 paste | 외부 프로그램의 한국어 문장 붙여넣기 | 가능한 rich text를 적용하고 최소 plain text 보존 |

## 저장, 복원, 의미 노드

| 상태 | 항목 | 시험 방법 | 기대 결과 |
|---|---|---|---|
| NOT TESTED | 장면 구분선 앞뒤에서 입력 | 버튼으로 구분선을 넣고 양쪽에 한국어 입력 | 구분선이 독립 node로 남고 양쪽 입력이 정상 |
| NOT TESTED | 저장 후 앱 완전 종료 | `snapshot 지금 저장` 뒤 Autosave 완료를 확인하고 창과 Electron process를 완전히 종료 | 저장 완료 뒤 비정상 재실행이나 미종료 process가 남지 않음 |
| NOT TESTED | 재실행 후 동일 문서 복원 | madi를 다시 실행하고 `저장한 .madi 열기`로 같은 파일 선택 | 문장, paragraph, 장면 구분선과 마지막 저장 상태가 동일 |

위 표의 항목 수는 입력과 조합 5개, 조합 경계 4개, Selection과 clipboard 3개,
저장·복원·의미 노드 3개로 정확히 15개다.

## 실패 기록

```text
항목:
결과: FAIL
환경:
재현 단계:
기대 결과:
실제 결과:
발생 빈도:
관련 screenshot/video:
비고:
```

## 자동 검증과의 구분

아래는 자동화 대상이다.

- Typie IME adapter의 DOM event → `FlatImeOp` 변환
- 내용 transaction이 없는 composition 취소/종료에서도 조합 상태가 해제되는지
  확인하는 adapter/controller test
- engine transaction과 Undo/Redo
- semantic horizontal-rule changeset snapshot
- SQLite BLOB과 recovery text round-trip
- 별도 process 종료 뒤 snapshot hash 비교

위 자동 테스트가 성공해도 이 문서의 수동 상태는 바뀌지 않는다.
