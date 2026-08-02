# 검색·선택 치환 의미론

기준일: 2026-08-02  
구현 상태: Phase 1B working tree

## 1. 검색 source of truth

본문 검색의 source of truth는 마지막 성공 save의 `documents.plain_text_recovery`다.
schema 3의 `search_documents`는 이 값을 검색하기 편한 형태로 복제한 projection이며
다음 trigger가 transaction 안에서 동기화한다.

- document insert → projection insert/upsert
- `project_id`, `plain_text_recovery`, `updated_at` update → projection upsert
- document delete → projection delete

schema 2 → 3 migration은 기존 모든 document를 projection에 backfill한다. FTS5와
trigram tokenizer는 사용하지 않는다. 현재 저장소가 실행한 정확 부분 문자열 순회는
성능보다 누락 없는 결과를 우선한다.

## 2. scope와 target

`search_project`는 지정 node의 ordered subtree를 검색한다. scope가 없으면 WORK를
사용한다.

- `TITLES`: scope에 포함된 WORK/VOLUME/CHAPTER/SCENE title
- `BODIES`: scope에 포함된 SCENE의 `search_documents.plain_text`
- `ALL`: 두 영역 모두

결과는 Binder DFS 순서, 한 text 안에서는 앞에서 뒤 순서다. 한 결과는 node/title,
field, SCENE/document ID, matched text, 앞뒤 최대 32 Unicode scalar 문맥을 가진다.
BODY 결과에는 source text의 SHA-256가 포함된다.

CURRENT scope의 UI identity는 label이 아니라 실제 `currentScopeId`를 포함한다. query,
case, target, CURRENT/ALL 값이 같아도 selected Binder node ID가 바뀌면 기존 result와
선택 치환 preview는 즉시 stale이며 debounce 검색을 다시 실행한다.

## 3. 일치 규칙

- 빈 query는 거부한다.
- 일치는 non-overlapping exact substring이다.
- `case_sensitive = true`이면 UTF-8 문자열의 literal 일치를 사용한다.
- 대소문자 비구분은 Unicode scalar별 lowercase expansion을 비교한다.
- 한국어처럼 case-invariant query는 literal fast path를 사용한다.
- 결과 `start_char`, `end_char`는 byte나 UTF-16 offset이 아닌 Unicode scalar offset이다.
- Unicode normalization(NFC/NFD), 폭, 호환 문자, locale별 조사/형태소 변형은 하지
  않는다. 코드포인트 열이 다른 문자열은 다른 문자열이다.

예를 들어 `문문문`에서 `문문`은 `(0, 2)` 한 건이며 overlapping `(1, 3)`은 별도
결과가 아니다. Korean/emoji 혼합 범위도 같은 scalar 기준을 사용한다.

core 기본 page는 1,000건, 최대는 5,000건이다. renderer는 200건씩 page를 모으고
모든 page의 query/scope/revision과 occurrence ID를 검증한다. 중간에 revision이
바뀌면 결과를 합치지 않는다. core는 page와 별개로 정확한 `total_matches`와
`scene_count`를 계산한다.

## 4. UI 검색 계약

- query 변경은 약 320ms debounce 후 갱신한다.
- 사용자는 제목/본문/전체, case, 현재 범위/작품 전체를 고른다.
- 결과는 node/장면별로 묶고 문맥 안의 matched text를 표시한다.
- TITLE 결과는 Binder 범위로 이동한다.
- BODY 결과는 기존 단일 editor로 SCENE을 열고 scalar range를 reveal한다.
- 현재 live SCENE에 BODY result가 있으면 첫 range를 selection으로 자동 표시하지만
  input/editor focus는 빼앗지 않는다.
- Scrivenings read-only text와 title에도 현재 query를 literal highlight한다.
- 결과가 없으면 빈 결과 요약을 명시한다.

검색 직전 현재 dirty scene을 flush한다. 따라서 search projection은 성공한 save를
기준으로 갱신된다. save가 실패하면 새 검색을 실행하지 않는다.

## 5. 선택 치환 preview

치환 가능한 것은 BODY hit뿐이다. TITLE hit는 checkbox를 갖지 않는다. UI는 선택된
occurrence를 SCENE별로 묶고 다음을 적용 전에 고정한다.

- query와 replacement
- case option과 scope
- preview project revision
- occurrence ID
- scene/document ID
- scalar start/end와 expected matched text
- BODY source SHA-256
- CURRENT scope일 때 실제 selected Binder node ID

중복 occurrence, 겹치는 범위, 잘못된 offset, 서로 다른 document/hash가 섞인 같은
SCENE은 renderer에서 거부한다. replacement에 `\r` 또는 `\n`이 있으면 적용 버튼을
비활성화한다. query와 replacement가 같으면 core가 거부한다.

## 6. Typie 의미 변환

controller는 현재 dirty scene을 먼저 저장하고 preview revision이 그대로인지 확인한
뒤 대상 SCENE을 한 개씩 같은 headless/shared Typie adapter로 연다. 각 SCENE은
`replace_many_from_prose_annotated` 한 transaction을 사용한다.

변환 시작 시 controller가 exclusive editor lock을 잡고 adapter의 interaction을 끈다.
Typie hidden input은 blur/disabled, surface는 inert/aria-busy가 된다. lock 동안
`Ctrl+S`, Undo/Redo, scene break, focus/reveal과 scene switch는 fail-closed이며 temporary
target graph를 일반 save path로 보낼 수 없다. controller가 의도적으로 suppress하지
않은 content change를 감지하면 unexpected mutation으로 표시하고 core commit 전에
batch를 중단한 뒤 원래 SCENE을 reload한다.

Typie extension과 adapter의 precondition은 다음과 같다.

1. 현재 annotated prose 전체가 preview의 expected source와 같아야 한다.
2. range는 고유하고 유효한 scalar boundary이며 겹치지 않아야 한다.
3. 각 range text가 `expected_text`와 같아야 한다.
4. 줄바꿈을 삽입하지 않는다.
5. range가 한 paragraph의 text leaf들에 안전하게 mapping돼야 한다.
6. scene break/atom, block 경계 또는 혼합 inline modifier ownership을 가로지르지 않는다.

변환은 pending modifiers와 selection을 보존하고 한 SCENE에서 한 undo entry를 만든다.
실패는 nonfatal invalid outcome이며 해당 graph heads/history를 바꾸지 않는다.

adapter는 변환 뒤 다음 postcondition을 다시 확인한다.

- annotated plain text가 preview로 계산한 정확한 결과와 같음
- semantic scene break 수가 같음
- non-text document structure fingerprint가 같음
- snapshot export가 성공함

postcondition 또는 snapshot export가 실패하면 원본 snapshot을 다시 연다. paragraph,
scene break, semantic atom과 inline modifier를 보존하지 못할 수 있는 범위를 text
재작성으로 우회하지 않는다.

## 7. project-wide commit

모든 대상 SCENE의 transformed snapshot/recovery를 memory에서 준비한 뒤 Rust/core의
`apply_replacement_batch` 한 번으로 보낸다. core는 write 전에 다음을 전부 검증한다.

- project `expected_revision`
- SCENE ↔ document identity와 project 소속
- editor engine/commit/schema identity 불변
- 현재 body SHA-256와 preview hash
- snapshot이 원본과 실제로 다름
- plain text가 실제로 달라짐
- query/replacement/selected occurrence count로만 만들 수 있는 deterministic
  transduction과 character delta

그 다음 하나의 `BEGIN IMMEDIATE` transaction에서:

1. 현재 logical project payload를 `AUTO_BEFORE_REPLACE` snapshot으로 저장한다.
2. 준비한 모든 document의 Typie snapshot과 recovery를 update한다.
3. trigger가 search projection을 갱신한다.
4. project revision을 한 번 올린다.
5. commit한다.

중간 document update가 실패하면 앞선 update, search projection, safety snapshot과
revision bump가 함께 rollback된다. 성공 뒤 controller는 원래 열려 있던 SCENE을 DB의
새 snapshot에서 reload해 이전 generation/save 응답이 치환 결과를 되돌릴 수 없게
한다.

commit 뒤 원래 SCENE reload까지 성공해야 interaction lock을 해제한다. DB commit은
성공했는데 reload가 실패하면 저장된 canonical 결과를 임시 headless graph로 덮지 않게
fatal lock을 유지한다. 이 상태에서 save/edit/switch는 금지되고 close는 허용된다.
재시작하면 DB에 commit된 project를 다시 연다.

## 8. Undo와 rollback의 정확한 경계

한 SCENE의 Typie 변환은 한 transaction/한 undo entry이며 Rust extension probe에서
Undo/Redo round-trip을 검증한다. 그러나 project-wide 적용은 여러 SCENE snapshot을
DB에 commit한 뒤 현재 editor를 저장 snapshot에서 다시 연다. Typie graph snapshot은
runtime undo stack을 영속화하지 않으므로 전체 작업을 한 번의 사용자 `Ctrl+Z`로
되돌리는 기능은 제공하지 않는다.

cross-scene user-visible rollback은 `AUTO_BEFORE_REPLACE` named snapshot을 선택하고
**전체 치환 전 상태로 되돌리기**를 실행해 restore하는 방식이다. 이는 임시 한계가
아니라 ADR-0002에서 확정한 공식 제품 동작이다. 영구 project-wide command log는
구현하지 않으며 이 결정에 따라 Phase 1B 판정은
`TECHNICAL GO — PRIVATE LOCAL`이다.

## 9. 확인된 검증과 성능 한계

집중 검증은 Korean+emoji scalar offset, 선택 occurrence만 변환, one-scene atomic
Undo/Redo, pending modifier 보존/no-bleed, scene break target과 mixed modifier 범위
거부, 거부 뒤 editor 사용 가능, source hash conflict와 다중 document transaction
rollback, exclusive interaction lock, `Ctrl+S`/Undo fail-closed, unexpected mutation
abort와 post-commit reload fatal lock을 다룬다.

검색은 scope의 text를 선형 순회한다. 정확하지만 대형 project에서 query마다 전체
본문을 읽고 lowercase 비교할 수 있다. normalization, 정규식, 형태소 검색, fuzzy
search, replace-all streaming 및 장면별 상세 diff는 Phase 1B 범위가 아니다.
