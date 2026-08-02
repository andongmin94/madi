# Scrivenings 아키텍처

기준일: 2026-08-02  
구현 상태: Phase 1B working tree

## 1. 핵심 모델

Scrivenings는 여러 SCENE을 하나의 Typie graph로 합친 문서가 아니다. Binder에서
선택한 container의 독립 SCENE document를 연속 배치하는 renderer-owned workspace다.

```text
Binder selection: WORK | VOLUME | CHAPTER
        │
        ├─ ordered descendant SCENE metadata + plain-text preview
        │    ├─ read-only block
        │    ├─ read-only block
        │    └─ active block ── one shared Typie editor instance
        │
        └─ active/highlighted SCENE id (Binder selection과 별도)
```

SCENE을 Binder에서 직접 선택하면 기존 단일 장면 workspace를 사용한다. WORK,
VOLUME, CHAPTER를 선택하면 `ScriveningsView`를 사용한다.

## 2. 데이터 경계

Rust `list_descendant_scenes`는 선택 node를 포함하는 ordered subtree를 DFS로 순회하고
SCENE만 반환한다. sibling 순서는 `(order_key, id)`다. 각 preview는 다음 일반 madi
값만 가진다.

- SCENE/document ID와 title
- UTF-8 `plain_text_recovery`
- plain text SHA-256 `source_content_hash`
- document `updated_at`

Typie snapshot과 Typie 내부 node는 preview 응답에 포함하지 않는다. core page limit는
1..1,000이고 한 응답의 encoded text는 최대 64 MiB다. renderer는 200 SCENE씩 읽어
모든 page의 revision, scope, offset, total과 중복 ID를 검사한다. 읽는 중 revision이
바뀌면 섞인 preview를 사용하지 않고 다시 시도하라는 오류를 낸다.

현재 구현은 선택 subtree의 모든 plain text를 renderer memory에 적재한다. 이것은
Typie graph/editor를 전부 만드는 것과는 다르지만 매우 긴 원고에서 memory 비용이
선형으로 증가하는 한계가 있다.

## 3. 한 개의 live editor

`DocumentSessionController`는 project session당 하나의 `MadiEditorAdapter`를 소유한다.
`relocateEditor()`가 같은 adapter의 DOM surface를 다음 mount 사이에서 이동한다.

- 숨겨진 안전 mount
- 단일 SCENE workspace mount
- 현재 Scrivenings active SCENE block mount

장면 수만큼 Typie editor instance를 만들지 않는다. active block 이외에는
`plain_text_recovery`를 read-only HTML로 출력한다. active 장면이 범위 밖으로
사라지거나 SCENE mode로 전환될 때 editor surface는 안전 mount 또는 단일 장면
mount로 이동한다.

### project-wide exclusive operation

선택 치환과 named snapshot restore는 이 한 개의 live editor를 headless 변환/reload에
잠시 사용한다. 시작 전에 현재 장면을 flush한 뒤 controller exclusive lock을 잡고
Typie hidden input을 blur/disabled, surface를 inert로 바꾼다. lock 동안 `Ctrl+S`,
Undo/Redo, scene break, focus/reveal, Binder/내부 장면 전환은 실행하지 않는다.

controller가 suppress하지 않은 editor change를 하나라도 받으면 unexpected mutation으로
표시하고 storage commit 전 작업을 중단한다. 성공 또는 안전한 pre-commit 실패 뒤에는
canonical SCENE을 reload한 다음에만 interaction을 다시 연다. storage commit은 성공했지만
post-commit reload가 실패하면 임시 graph가 user save 경로로 흘러가지 않도록 fatal
lock을 유지한다. 모든 user change는 시작 전에 flush됐으므로 이 상태는 저장/UI-state
write를 건너뛴 window close만 허용하고 앱 재시작으로 복구한다.

## 4. 장면 활성화 순서

read-only 본문 또는 제목을 활성화하면 다음 순서를 따른다.

1. 중복 activation 요청을 막는다.
2. 현재 장면의 IME composition guard를 확인한다.
3. dirty 장면에서 snapshot과 annotated plain text를 추출한다.
4. scene/document/generation/saveSequence를 포함한 기존 save 경로를 실행한다.
5. save 응답이 현재 request token과 일치하는지 확인한다.
6. 성공한 경우에만 대상 SCENE document를 load하고 adapter로 연다.
7. shared editor surface를 대상 block으로 옮기고 active/highlight ID를 갱신한다.

composition 중이거나 저장/load가 실패하면 기존 editor와 active scene을 유지하고
오류를 표시한다. `DocumentSessionController.selectScene()`의 queue/session token과
generation 보호를 그대로 사용하므로 빠른 A → B → C 요청이나 오래된 save가 다른
장면을 덮어쓰지 않는다.

## 5. container 선택과 내부 장면 상태

상태는 의도적으로 두 축이다.

| 상태 | 의미 |
|---|---|
| `selectedNodeId` | Binder에서 선택한 WORK/VOLUME/CHAPTER 범위 |
| `scriveningsLiveSceneId` | shared Typie editor를 가진 장면 |
| `scriveningsHighlightedSceneId` | Binder에서 별도로 강조할 내부 장면 |
| controller `activeSceneId` | 실제 load된 SCENE document |

장면 제목 click은 container selection을 SCENE으로 바꾸지 않고 highlighted ID를
갱신한 뒤 save-before-switch activation도 요청한다. 본문 click도 같은 안전 전환을
수행한다. 이 분리 덕분에 VOLUME 범위를 유지한 채 그 안의 장면을 편집할 수 있다.

## 6. 긴 원고 rendering

각 SCENE wrapper와 제목은 순서를 유지하며 DOM에 남는다. 본문은 다음 기준으로
heavy/light 상태를 나눈다.

- `IntersectionObserver` viewport root와 `rootMargin: 800px 0px`
- 관측되는 장면 앞뒤 기본 2개 block overscan
- observer anchor가 없을 때 최초 6개 장면
- active/pending 장면은 항상 heavy
- 먼 장면은 최소 높이 150px의 lightweight placeholder

따라서 전체 원고를 하나의 Typie graph나 N개의 editor로 만들지 않는다. 다만 완전한
list virtualization처럼 wrapper DOM까지 제거하지는 않으며 preview text도 전체를
memory에 둔다. 장편 benchmark 결과에 따라 다음 단계에서 page cache와 측정 높이 기반
virtual list로 교체할 수 있다.

## 7. read-only 표현과 검색 강조

현재 일반 경로는 annotated `plain_text_recovery`를 `white-space: pre-wrap`으로
출력한다. optional renderer block이 있으면 paragraph와 `SCENE_BREAK`를 구분해
`* * *` separator로 표시할 수 있다. 검색 강조는 renderer-owned exact literal
segment로 만들며 HTML을 삽입하지 않는다.

검색 결과를 click하면 SCENE mode로 열고 adapter의 `revealTextRange(start, end)`를
사용한다. 현재 live SCENE의 첫 BODY hit는 검색 결과가 갱신될 때 selection만 자동
설정하고 focus는 이동하지 않는다. offset은 Rust/core와 Typie adapter 모두 Unicode
scalar 기준이다.

## 8. 글자 수

Scrivenings header의 빠른 표시와 status bar의 canonical 통계를 구분한다.

- renderer preview 통계: loaded `plain_text_recovery`의 Unicode scalar 수
- core 통계: 선택 subtree의 search projection을 읽은 공백 포함/제외 수와 SCENE 수

공백 제외는 Unicode `is_whitespace`/JavaScript `\s` 기준이며 출판사별 원고지 계산,
grapheme cluster, byte 수 또는 UTF-16 code unit 수가 아니다.

## 9. 확인된 test 경계

React test는 WORK/VOLUME/CHAPTER traversal, 단 하나의 live mount, 저장 성공 뒤 전환,
저장 실패 시 현재 editor 유지, 한국어 highlight, 글자 수와 distant placeholder를
검증한다. App integration test는 Scrivenings 안에서 shared editor가 이동했다가
SCENE mode로 돌아오는 경로를 검증한다.

development와 unpacked packaged Electron test는 각각 SCENE 11개에서 WORK
Scrivenings 11개, live editor 1개/read-only-light 10개, 검색 7건과 process reopen을
검증했다. 전체 명령 결과는 [`PHASE_1B_RESULT.md`](PHASE_1B_RESULT.md)의 gate 표를
따른다.

## 10. 알려진 한계

- preview payload는 rich read-only materialization이 아니라 plain-text recovery다.
- 선택 범위 전체 preview를 renderer memory에 둔다.
- wrapper DOM까지 제거하는 완전한 virtualization은 아니다.
- scroll anchor를 별도 측정/복원하는 알고리즘은 없다. 같은 wrapper 안에서
  read-only/live body를 교체해 layout jump를 줄이는 수준이다.
- native IME 후보창 위치와 장시간 composition은 `MANUAL VALIDATION PENDING`이다.
