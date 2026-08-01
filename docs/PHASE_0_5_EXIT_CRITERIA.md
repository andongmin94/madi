# Phase 0.5 종료 조건

## 목적과 판정 규칙

이 문서는 Phase 0의 **CONDITIONAL GO**를 Phase 0.5에서 닫기 위한 기준표다.
기준 시점은 2026-08-01이며, Phase 0 문서에 이미 남은 자동 증거와 Phase 0.5에서
새로 요구한 검증을 구분한다.

- `PASS`: Phase 0 또는 Phase 0.5의 실행 결과와 자동 증거로 해당 범위가 닫혔다.
- `TODO`: 실패를 뜻하지 않는다. 구현·새 검증·사람 수동검증 또는 VCS 조치가
  아직 남았다.
- `FAIL`: 요구한 검증을 실행했고 합격 기준을 충족하지 못했다.
- `HUMAN DECISION REQUIRED`: 코드나 자동 테스트로 대신할 수 없는 제품·법률 결정이다.

Phase 0의 “`GO`로 올리기 위한 최소 조건” 문장은 아래에 가능한 한 그대로
인용했다. 한 조건이 여러 성격을 갖더라도 중복 집계를 피하기 위해 주된 분류 한
곳에 배치했다. `.madi` 20회 반복, adapter 정적 경계, 복구 안전성처럼 Phase 0.5
요구가 기존 증거보다 엄격한 경우에는 기존 최소 증거를 `PASS`, 강화된 종료 조건을
별도 `TODO`로 기록한다.

완전한 `TECHNICAL GO`를 내리려면 코드·빌드환경·upstream 종속·증거 부족 분류의
`TODO`와 `FAIL`이 모두 없어야 한다. 현재 자동 기술검증에서 실행한 항목의
`FAIL`은 없지만, 아직 실행하지 못한 범위는 정직하게 `TODO`로 남긴다. 수동 IME는
실제 사람이 수행하기 전까지 `TODO`를 유지하며, 라이선스는 명시적 제품 결정과
전문가 검토 전까지 `HUMAN DECISION REQUIRED`를 유지한다.

## 1. 코드로 해결 가능한 조건

### C-01. Typie 결합도를 madi 소유 adapter 경계로 제한

- **조건:** Electron UI, 저장 상태 UI, `.madi` 파일 처리, Rust SQLite 코어,
  preload API 및 일반 문서 metadata가 Typie 내부 crate·타입·함수·codec 구조를
  직접 참조하지 않고 `MadiEditorAdapter` / `TypieEditorAdapter` 뒤에 있어야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md`의
  “Electron/React 통합 방식”; `docs/TYPIE_FEASIBILITY_RESULT.md:438-439`
  (“commit pin은 필수이고, upgrade는 일반 dependency bump가 아니라
  API/codec/IME/render compatibility 작업으로 취급해야 한다.”).
- **해결 방법:** 허용된 Typie 구현 디렉터리를 명시하고, 그 밖의 source에서 Typie
  package·generated binding·내부 symbol import를 금지하는 정적 검사와 adapter
  contract test를 추가한다.
- **검증 방법:** 전체 source 정적 검색을 자동 테스트로 실행한다. 의도적으로 허용
  디렉터리 밖에 금지 import fixture를 둔 음성 테스트도 실패하는지 확인한다.
- **현재 상태:** **PASS** — `scripts/check-repository.mjs`가 허용된
  `renderer/editor/typie/**` 밖의 runtime import·generated binding·Typie/FFI
  type과 Rust core 직접 참조를 검사한다. 금지 package import와 FFI type을 넣은
  음성 fixture가 실제 gate에 걸리는지도 확인했고 최종 `pnpm verify`에서
  통과했다.
- **미통과 영향:** Typie 교체·upgrade가 앱 전체 변경으로 번지므로 생산 적용의
  유지보수 경계가 성립하지 않는다.

### C-02. page 0 이외 표시와 page-aware 입력 경계

- **조건:** “page 0 이외의 문서 표시와 긴 장편/DPI 성능을 검증한다.”
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:491`,
  “`GO`로 올리기 위한 최소 조건” 2번; `docs/ARCHITECTURE_PHASE0.md:113-115`,
  `205-211`.
- **해결 방법:** 필요한 모든 Canvas surface의 생성·해제, 스크롤/viewport,
  page-aware pointer 좌표와 IME caret 위치를 구현한다. 성능 검증 자체는 E-01에서
  별도로 다룬다.
- **검증 방법:** 두 페이지 이상 fixture에서 page 0 이후 text와 scene break가
  보이고 선택·입력·포인터 hit test가 올바른 page에 적용되는 자동 Electron
  테스트를 실행한다.
- **현재 상태:** **PASS** — 비패키지 production과 Windows unpacked packaged
  offline smoke에서 5,445자 fixture가 4개 Canvas surface로 표시되고, 완전 종료
  뒤에도 복원됐다. 두 번째 page pointer hit가 `cursorPage = 1`로 확인됐다.
  현실적인 장편·장시간·DPI·다중 monitor 성능은 이 기능 경계와 분리해 E-01에
  `TODO`로 남긴다.
- **미통과 영향:** 긴 원고의 page 0 이후 내용을 편집할 수 없어 장편 저작도구의
  생산 적용이 불가능하다.

### C-03. 신뢰 가능한 Undo/Redo 가능 상태

- **조건:** “undo/redo 가능 표시를 engine의 신뢰 가능한 history 상태에 연결하거나,
  추정임을 UI contract로 명확히 제한한다.”
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:492-493`,
  “`GO`로 올리기 위한 최소 조건” 3번; `docs/ARCHITECTURE_PHASE0.md:209-211`.
- **해결 방법:** Typie가 신뢰 가능한 history 상태를 제공하면 adapter를 통해
  노출한다. 제공하지 않으면 UI 표시를 제거하거나 “최근 command 기반 추정”이라는
  제한을 명시하고 생산 기능 계약에서 정확한 상태로 취급하지 않는다.
- **검증 방법:** 빈 문서, 입력, 여러 단계 Undo/Redo, 새 입력에 의한 redo branch
  폐기, reopen 순서를 실행해 버튼 상태와 실제 명령 성공 여부가 계약과 일치하는지
  테스트한다.
- **현재 상태:** **PASS** — Typie가 authoritative history-stack query를
  제공하지 않는 한계를 UI의 `최근 명령 기반 추정` 문구와 IME Test 결과에
  명시했다. adapter 상태를 정확한 엔진 history로 약속하지 않는 제한 계약과
  Undo/Redo 동작 테스트가 최종 gate에서 통과했다.
- **미통과 영향:** UI가 실행 불가능한 Undo/Redo를 약속하거나 가능한 작업을 막아
  원고 편집 신뢰성을 훼손한다.

### C-04. `.madi` 기본 저장·별도 프로세스 복원

- **조건:** 실제 Typie snapshot BLOB과 annotated recovery text를 SQLite에 저장하고,
  앱 종료 뒤 별도 프로세스에서 동일 snapshot·plain text·scene break를 복원한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:270-323`,
  “`.madi` 저장/복원 결과”; `docs/MADI_FILE_FORMAT_V0.md:1-111`.
- **해결 방법:** 현재 transaction, revision, metadata와 snapshot compatibility
  검사를 유지한다.
- **검증 방법:** 기존 process-restart integration과 production Electron smoke에서
  저장 전후 snapshot hash, recovery text, SQLite `application_id`,
  `quick_check`, scene break 및 Canvas pixel을 비교한다.
- **현재 상태:** **PASS** — Phase 0의 별도 core/Electron process 증거에 더해
  Phase 0.5의 비패키지·packaged offline 두-process smoke와 20회 endurance에서
  snapshot, recovery, metadata, scene node와 Canvas 복원을 재확인했다. dirty
  입력 직후 창 닫기도 renderer/main handshake가 저장 완료를 기다린 뒤 종료하며,
  재실행에서 revision 증가와 마지막 12자를 확인했다. 새 프로젝트/열기도 현재
  dirty 문서의 저장 성공 전에는 기존 editor를 교체하지 않는다. DOM composition
  guard는 첫 Typie transaction 전의 조합도 종료·교체·저장에서 차단한다. preload
  조기 close buffer, main의 15초 응답 timeout과 renderer-gone 처리가 listener
  등록 전 요청 또는 renderer 실패를 영구 close deadlock으로 만들지 않는다.
  승인 직전 renderer를 동기 `inert`로 동결하고 main의 boolean ACK가 실패하면
  되돌린다. 승인 IPC 응답 뒤 100ms grace와 scheduled-close gate는 IPC handler
  안에서 renderer를 파괴하거나 중복 닫기·새 입력이 마지막 flush를 건너뛰는 일을
  막는다. 내용 transaction이 없는 composition 취소/종료도 별도
  `composition-state` event로 controller에 전달해 guard를 해제하되, 이 event만으로
  generation이나 dirty 상태를 바꾸지 않는다.
- **미통과 영향:** `.madi`를 원고 정본으로 사용할 수 없으므로 즉시 기술
  `NO-GO`다.

### C-05. `.madi` 20회 연속 round-trip 안정성

- **조건:** 같은 fixture에 대해 `open → modify → save → close → reopen →
  compare`를 최소 20회 반복하고 snapshot/plain text, scene break, 문서 순서,
  schema metadata와 단조 증가 revision을 매 회차 확인한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:270-307`에는 한 번의
  process-restart round-trip 증거만 있다. 강화 기준은 Phase 0.5 요청
  “`.madi` 저장·복원 안정성”이다.
- **해결 방법:** 실제 Typie fixture와 별도 `madi-core` process를 매 회차 사용하며,
  snapshot이 비결정적이면 canonical semantic comparison을 정의하고 이유를
  기록한다.
- **검증 방법:** 20개 회차별 revision, snapshot 또는 canonical fingerprint,
  recovery text, semantic scene break 수, document order, `quick_check`,
  `application_id`, schema migration row를 assert하고 결과를 보존한다.
- **현재 상태:** **PASS** — `scripts/test-madi-endurance.mjs`가 fresh core
  process와 fresh Typie host를 사용해 20회 반복했다. revision `2`부터 `21`까지
  단조 증가, 매 회차 저장/재열기 snapshot exact hash, canonical annotated text,
  scene node 1개, 회차 token 순서, `quick_check`, `application_id`, schema와
  migration row가 모두 유지됐다.
- **미통과 영향:** 반복 저장 중 조용한 원고 손상이나 revision 회귀 가능성을
  배제할 수 없어 생산 정본으로 채택할 수 없다.

### C-06. 장면 구분선의 기본 의미 보존

- **조건:** scene break는 단순 `* * *` 문자열이 아니라 Typie의 독립 의미 node로
  삽입되고, snapshot 저장·복원 뒤 node 의미와 plain-text recovery marker가
  유지돼야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:230-263`,
  “장면 구분선 결과”; `docs/ARCHITECTURE_PHASE0.md:150-170`.
- **해결 방법:** 기존 `horizontal_rule/three_diamonds` adapter mapping과
  `prose_text_annotated()` recovery를 유지한다.
- **검증 방법:** Typie probe와 Electron smoke에서 독립 node 삽입, Undo/Redo,
  snapshot 복원, `semanticSceneBreaks = 1`, `***` recovery marker를 확인한다.
- **현재 상태:** **PASS** — Phase 0 자동 probe와 Electron process-restart smoke
  증거가 있다.
- **미통과 영향:** 향후 Publication IR로 장면 경계를 신뢰성 있게 변환할 수 없고
  구조적 원고 데이터가 손실된다.

### C-07. 장면 구분선의 편집·clipboard 계약과 영구 식별자

- **조건:** scene break 앞뒤 입력·삭제·Undo·Redo가 동작하고, 복사·붙여넣기
  동작이 문서화되며, 일반 horizontal rule과 함께 제공해도 Publication IR로
  변환 가능한 안정적인 식별자가 있어야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:265-268` 및
  `471-483`의 “generic horizontal rule과 madi scene break의 영구 구분”;
  `docs/ARCHITECTURE_PHASE0.md:167-170`.
- **해결 방법:** adapter invariant와 clipboard 정책을 명시하고, 일반 가로선이
  제품 범위에 들어오기 전에 schema fork 없이 유지 가능한 madi metadata overlay
  또는 동등한 안정 식별 방식을 결정한다.
- **검증 방법:** scene break 전후 편집·삭제·Undo/Redo·copy/paste·snapshot
  round-trip 테스트와 일반 horizontal rule 대조 fixture를 실행한다.
- **현재 상태:** **PASS** — `madi.scene-break.v1`을 madi 소유의 안정 ID로 두고
  Typie `horizontal_rule/three_diamonds`를 이 단계에서 전용 예약했다.
  `scripts/test-scene-break.mjs`가 앞뒤 입력, node 선택 삭제, Undo/Redo, rich
  `data-slice-v2` clipboard, 새 editor paste와 snapshot 복원을 확인했다.
  plain-text clipboard가 의미 node를 보장하지 않는 제한과, 장식용 일반 가로선을
  추가하기 전 durable metadata가 필요하다는 규칙도 문서화했다.
- **미통과 영향:** 장면과 장식용 가로선을 구별할 수 없어 이후 구조 변환에서
  장면 경계가 오인된다.

### C-08. Electron 없는 plain-text 긴급 복구

- **조건:** UI 없이 `recover-plain-text` CLI로 정상 `.madi`의 recovery text를
  복구할 수 있어야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:300-307`;
  `docs/ARCHITECTURE_PHASE0.md:215-223`; `README.md`의 “Rust CLI”.
- **해결 방법:** Rust `madi-core` CLI 경로를 Electron과 독립적으로 유지한다.
- **검증 방법:** 별도 core process에서 CLI를 실행해 stdout 또는 새 output file과
  저장된 annotated recovery text를 비교한다.
- **현재 상태:** **PASS** — `scripts/test-recovery-cli.mjs`가 Electron/React/
  Typie WASM process를 시작하지 않고 Rust `madi-core` binary만 호출해 저장된
  recovery text와 새 output 파일을 비교했다.
- **미통과 영향:** editor snapshot codec 장애 시 사용자가 원고를 꺼낼 독립적인
  비상 경로가 사라진다.

### C-09. plain-text 복구의 UTF-8·오류 안전성

- **조건:** 한글 UTF-8과 scene break 표현을 보존하고, 오류 시 원고 전체를
  stdout/stderr 또는 로그에 출력하지 않으며 기존 output 파일을 덮어쓰지 않는다.
- **Phase 0 근거 위치:** `docs/PRODUCT_SCOPE_PHASE0.md:55-59`;
  `docs/MADI_FILE_FORMAT_V0.md:109-111`; Phase 0.5 요청 “plain-text 긴급 복구”.
- **해결 방법:** 한글/scene break fixture, no-clobber output, 오류 redaction을
  CLI contract와 테스트에 고정한다.
- **검증 방법:** 정상 한글 복구, 기존 output 파일, 손상된 DB, 없는 document,
  잘못된 metadata를 각각 실행해 bytes와 stdout/stderr 비노출을 assert한다.
- **현재 상태:** **PASS** — `scripts/test-recovery-cli.mjs`가 한글 UTF-8과
  `\n\n***\n\n` marker, 새 output 생성을 확인했다. 기존 output no-clobber,
  missing document와 corrupt database를 포함한 오류 경로에서 원고 전체가
  stdout/stderr에 나오지 않고 기존 output도 바뀌지 않았다.
- **미통과 영향:** 비상 복구가 원고 유출 또는 기존 복구본 손상을 일으킬 수 있다.

### C-10. 인간 검증용 IME Test 화면

- **조건:** 빈 문서, 자동저장·Undo/Redo·composition 상태, snapshot 저장과 재실행
  복원 안내, 15개 수동 항목 체크박스, JSON 또는 Markdown 결과 export를 한 화면에서
  제공하고 사람이 체크한 결과만 `PASS`로 저장한다.
- **Phase 0 근거 위치:** `docs/MANUAL_KOREAN_IME_CHECKLIST.md:1-84`와
  `apps/desktop/src/renderer/components/ImeChecklist.tsx`에는 문서 및 13항목
  인앱 panel이 있었지만, 상태는 메모리에만 있었고 composition boolean 외의
  검증 metadata·autosave·export는 없었다. 강화 기준은 Phase 0.5 요청
  “한글 IME 수동검증용 빌드”다.
- **해결 방법:** production 기능을 확장하지 않는 개발용 `IME Test` 화면과 결과
  schema/export를 구현하고 모든 초기값을 `NOT TESTED`로 둔다.
- **검증 방법:** 앱에서 15개 항목과 환경 metadata를 표시하고, unchecked 항목이
  자동으로 `PASS`가 되지 않으며 JSON/Markdown export가 원고 없이 같은 상태와
  redacted metadata를 담는지 자동 UI 테스트한다.
- **현재 상태:** **PASS** — 빈 `.madi`, 실제 snapshot autosave, Undo/Redo 추정
  표시, 원문 없는 마지막 composition event, 즉시 snapshot 저장, 재실행 안내/열기,
  정확히 15개 checkbox와 별도 FAIL, 수동 환경 7개 필드, runtime-bound
  localStorage, JSON/Markdown export를 구현하고 Vitest 및 Electron GUI에서
  확인했다. app/Typie/schema/platform/user-agent 정체성이 바뀌면 과거 결과를
  전부 `NOT TESTED`로 초기화한다. 이 PASS는 화면 준비 상태만 의미하며 실제
  native IME 15개 결과는 M-01과 같이 모두 `NOT TESTED`다.
- **미통과 영향:** 실제 사용자 검증을 재현 가능하게 수집할 수 없어 IME 조건을
  정직하게 닫을 수 없다.

## 2. 빌드·개발환경 조건

### B-01. Typie 정확한 commit 고정

- **조건:** “따라서 commit pin은 필수”이며 floating branch나 `latest`에 의존하지
  않아야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:25-35` 및
  `436-437`; `README.md`의 “고정된 Typie 기준”.
- **해결 방법:** submodule `vendor/typie`,
  `packages/typie-runtime/BUILD_INFO.json`과 runtime hash의 단일 pin을 유지한다.
- **검증 방법:** superproject가 가리키는 submodule HEAD, BUILD_INFO commit,
  generated artifact hash를 기대값
  `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`과 비교한다.
- **현재 상태:** **TODO — HUMAN VCS ACTION PENDING** — 현재 nested
  `vendor/typie` HEAD는 정확한 40자 commit에서 clean하고,
  `BUILD_INFO.json`과 7개 runtime SHA-256도 모두 일치한다. 이 작업트리의 pin
  검증은 PASS다. 그러나 superproject는 아직 최초 commit이 없어 mode `160000`
  tracked gitlink가 없다. 사람이 최초 commit에 `.gitmodules`와 정확한 gitlink를
  기록하기 전에는 향후 clone이 복원할 durable submodule pin 조건 전체를
  `PASS`로 올리지 않는다.
- **미통과 영향:** 같은 source와 snapshot 계약을 재현할 수 없어 모든 엔진 검증이
  무효가 된다.

### B-02. Typie 참조 방식과 patch 목록의 명시

- **조건:** submodule, subtree, vendoring, patch 중 현재 방식을 명확히 하고, Typie
  내부 수정이 있다면 별도 patch 목록으로 분리한다.
- **Phase 0 근거 위치:** `docs/TYPIE_LICENSE_IMPACT.md:10-28`은
  `vendor/typie` submodule과 adaptation 범위를 기록하지만 별도 patch inventory는
  없다. 강화 기준은 Phase 0.5 요청 “Typie 버전 고정”이다.
- **해결 방법:** `docs/TYPIE_PINNING_AND_PATCHES.md`에 submodule 선택 이유,
  update 절차, clean/dirty 확인, upstream 내부 patch 및 외부 adaptation 목록을
  기록한다.
- **검증 방법:** 현재는 nested HEAD/status와 문서 목록을 비교하고, B-01의
  gitlink가 생긴 뒤에는 `git submodule status`, nested worktree diff와 문서
  목록을 함께 비교해 미기록 patch가 없음을 검사한다.
- **현재 상태:** **PASS** — submodule 방식과 이유, exact checkout,
  `BUILD_INFO.json`/7개 runtime hash, upstream 내부 patch 없음, generated
  산출물, 세 IME adaptation, madi adapter inventory와 upgrade 절차를
  `docs/TYPIE_PINNING_AND_PATCHES.md`에 기록했다. nested checkout clean 상태와
  문서에 적힌 hash는 repository gate에서 검증된다.
- **미통과 영향:** 빌드 결과의 출처와 upstream 변경량을 추적할 수 없어 재현성,
  upgrade 및 라이선스 검토가 불가능해진다.

### B-03. clean checkout 빌드 재현

- **조건:** 필요한 Node, pnpm, Rust, wasm target과 시스템 의존성을 고정·문서화하고,
  생성물과 cache가 없는 clean checkout에서 `pnpm install`, `pnpm build`,
  `pnpm test`, `pnpm dev`가 재현돼야 한다.
- **Phase 0 근거 위치:** `README.md`의 “Windows 요구사항”과
  “Clean checkout에서 빌드”; `docs/TYPIE_FEASIBILITY_RESULT.md:138-140`은
  release recipe 완전 재현이 아님을 기록한다.
- **해결 방법:** tool version·bootstrap 명령을 고정하고 throwaway checkout에서
  lockfile 기반 install, build, test와 development launch를 수행한다.
- **검증 방법:** 기존 `node_modules`, target, dist와 cache를 공유하지 않는 경로에서
  각 명령, exit code, stderr와 artifact hash를 기록한다.
- **현재 상태:** **TODO** — 기존 `node_modules`, Rust `target`, Electron
  `dist`, package output과 cache를 제거한 현재 작업트리에서 frozen install,
  최종 `pnpm verify`와 package build는 통과했다. 그러나 root에 최초 commit,
  mode `160000` gitlink와 remote가 없어 새 경로의
  `git clone --recurse-submodules` 전체 재현은 아직 할 수 없다. B-01의 사람 VCS
  조치 뒤 진짜 clean clone에서 다시 실행해야 한다.
- **미통과 영향:** 현재 개발자 PC에서만 우연히 작동하는 산출물이 되어 유지·배포할
  수 없다.

### B-04. `wasm-opt` 포함 재현 가능한 runtime build

- **조건:** “`wasm-opt`을 포함한 고정/reproducible runtime build를 CI 또는 release
  script로 만든다.”
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:494-495`,
  “`GO`로 올리기 위한 최소 조건” 4번; 생략 사실은 `136-138`.
- **해결 방법:** Rust/wasm target, `wasm-bindgen`, editor-bindgen, ICU/font 생성,
  Binaryen `wasm-opt` version과 명령을 한 release pipeline에 고정한다.
- **검증 방법:** clean source에서 두 번 생성한 runtime의 hash 또는 설명 가능한
  reproducibility manifest를 비교하고 실제 probe·Electron smoke를 반복한다.
- **현재 상태:** **TODO** — 체크인된 runtime을 소비하는 앱 build는 통과했지만
  exact Binaryen version, 최종 `wasm-opt -Os --all-features`, end-to-end
  재생성 script와 두 clean build의 비교가 없다. 현재 runtime이 이 단계를
  거쳤다고 주장하지 않는다.
- **미통과 영향:** 배포 artifact의 source 대응 관계, 크기·성능 recipe와
  Corresponding Source 절차를 재현할 수 없다.

### B-05a. Windows unpacked packaged-layout 검증

- **조건:** Phase 0.5의 최소 package 증거로 Windows unpacked layout에서 실제
  `app.isPackaged === true` 실행과 동일한 offline 저장·복원 smoke가 통과해야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:496`,
  “`GO`로 올리기 위한 최소 조건” 5번의 package 부분;
  `docs/ARCHITECTURE_PHASE0.md:200-205`. Phase 0.5 요청은 Windows package 또는
  unpacked build까지 가능한 범위에서 검증하도록 요구한다.
- **해결 방법:** Windows unpacked package를 만들고 sidecar, WASM, ICU/font와
  custom protocol 경로를 packaged layout에서 해석하도록 한다.
- **검증 방법:** unpacked 경로에서 입력, 저장, 완전 종료, 재실행, 복원,
  controlled offline reload 이후 외부 request 0건과 arbitrary local-file 차단을
  기존 smoke와 동일하게 확인한다.
- **현재 상태:** **PASS** — Windows unpacked layout
  `output/madi-win32-x64/madi.exe`에서 실제 Electron을 두 번 실행했다. release
  sidecar, 4-page Canvas, 저장·완전 종료·복원, controlled reload 이후 외부 요청
  0건과 arbitrary `file://` 차단이 통과했다.
- **미통과 영향:** 개발 경로에서는 성공해도 packaged layout에서 sidecar 또는
  asset을 찾지 못할 수 있다.

### B-05b. 실제 installer와 installed-state smoke

- **조건:** Phase 0 원문 “Windows 패키지/설치본을 만들고 설치 상태에서 같은
  smoke를 반복한다.” 중 실제 설치 상태를 검증해야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:496`,
  “`GO`로 올리기 위한 최소 조건” 5번; `docs/ARCHITECTURE_PHASE0.md:200-205`.
- **해결 방법:** 지원할 installer 형식과 설치 범위를 결정해 깨끗한 Windows 사용자
  환경에 설치하고, 설치 경로의 executable·sidecar·asset·license bundle을 검증한다.
  code signing과 자동 업데이트는 별도 제품화·배포 결정이며 이 조건의 PASS로
  간주하지 않는다.
- **검증 방법:** 설치 전 상태에서 installer를 실행하고 설치 경로의 앱을 두 번
  구동해 B-05a와 같은 입력·저장·완전 종료·재실행·복원·offline smoke를 반복한다.
  설치 경로 권한과 제거 후 사용자 `.madi` 보존 여부도 기록한다.
- **현재 상태:** **TODO** — unpacked packaged-layout은 통과했지만 installer를
  만들거나 실제 installed-state lifecycle을 실행한 증거는 없다.
  `app.isPackaged === true`는 설치 상태를 뜻하지 않는다.
- **미통과 영향:** 실제 설치 위치의 권한, sidecar/asset 탐색, notice 배치와
  설치·제거 lifecycle 문제를 배제할 수 없다.

### B-06. 단일 `pnpm verify` 검증 gate

- **조건:** `pnpm verify`가 format/lint check, TypeScript typecheck, frontend
  tests, Rust tests, integration tests와 production build를 순서대로 실행해야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:328-345`에는 기존
  `pnpm test` 성공 증거가 있다. 강화 기준은 Phase 0.5 요청 “테스트와 검증”이다.
- **해결 방법:** 중복 없이 전체 필수 단계와 새 20회 round-trip, recovery,
  scene-break, package/offline 검증을 orchestration하는 script를 추가한다.
- **검증 방법:** clean 환경에서 `pnpm verify` 한 번을 실행하고 모든 하위 명령의
  순서, exit code와 실패 전파를 확인한다.
- **현재 상태:** **PASS** — 최종 작업트리에서 `pnpm verify`가 exit code 0으로
  완료됐다. repository/hash/adapter 음성 gate, format, typecheck, frontend와
  Rust tests, Typie probe, 20회·scene·recovery integration, production build,
  비패키지 및 Windows unpacked packaged Electron offline smoke가 모두 실패를
  올바르게 전파하는 한 명령에 포함된다.
- **미통과 영향:** 필수 검사가 누락된 artifact가 배포 후보가 될 수 있다.

### B-07. 설치·checkout 이후 Typie 서비스 비의존성

- **조건:** 의존성 설치와 Git checkout 이후 편집, 입력, 저장, 종료, 재실행과
  복원에 Typie 계정/API/cloud/sync, madi server 또는 인터넷 연결이 없어야 한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:142-160`,
  `368-419`; production Electron 외부 request 0건은 `320-321`.
- **해결 방법:** 모든 runtime 자산을 로컬 package로 유지하고 main process network
  guard와 updater 비활성 상태를 유지한다.
- **검증 방법:** production Electron의 main network guard가 최초 page load 전에
  설치되는지 확인하고, 두 process의 controlled offline reload 이후 lifecycle에서
  요청 URL을 수집해 외부 요청 0건, 로컬 `madi://app` asset만 사용함을 assert한다.
- **현재 상태:** **PASS** — 비패키지 production과 Windows unpacked packaged
  lifecycle을 Chromium offline 상태에서 각각 두 process로 실행했다. 두 경로
  모두 controlled reload 이후 external runtime request가 0건이고 local
  `madi://app` asset만 사용해 4-page 문서를 저장·종료·재실행·복원했다. 최초
  window를 얻기 전 요청은 counter에 포함되지 않지만 main allowlist guard가
  renderer load 전에 설치된다.
- **미통과 영향:** 로컬 퍼스트 전제가 깨지므로 생산 채택은 즉시 기술
  `NO-GO`다.

## 3. 실제 사용자 수동검증이 필요한 조건

### M-01. Windows native 한국어 IME와 외부 clipboard

- **조건:** “한국어 IME와 외부 한글/Word clipboard checklist를 사람이 수행하고 각
  환경/결과를 기록한다.”
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:489-490`,
  “`GO`로 올리기 위한 최소 조건” 1번; 미검증 목록은 `345-366`;
  `docs/MANUAL_KOREAN_IME_CHECKLIST.md:1-84`.
- **해결 방법:** C-10의 IME Test 화면에서 사람이 실제 Windows native IME와
  한글/Word 계열 앱을 사용해 15개 항목을 수행하고 OS, Electron, IME, keyboard,
  display scale, 날짜와 tester를 기록한다.
- **검증 방법:** 연속 입력, 자모 조합, 복합모음/겹받침, Enter/Undo/Redo/방향키
  조합 경계, 선택 삭제, 내부·외부 paste, scene break 전후 입력, 빠른 입력,
  완전 종료 복원, 5,000자 이상 원고를 실제로 확인하고 export 결과를 보존한다.
- **현재 상태:** **TODO — MANUAL VALIDATION PENDING** — IME Test 화면은
  준비됐지만 Windows native 한국어 IME 15개 항목은 **15 / 15 `NOT TESTED`**이고
  사람이 확인한 PASS는 0개다. 자동 `fill`, `pressSequentially`, composition
  unit test를 native IME PASS로 간주하지 않는다.
- **미통과 영향:** 한국어 원고 입력의 중복·누락·조합 손상 위험을 배제할 수 없어
  한국어 저작도구로 생산 적용할 수 없다.

## 4. 사람이 결정해야 하는 조건

### H-01. Typie 라이선스와 배포 정책 결정

- **조건:** “AGPL 배포, 별도 commercial license, 또는 독립 구현 중 하나를 제품
  정책으로 결정하고 법률 전문가의 검토를 받는다.”
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:498-499`,
  “`GO`로 올리기 위한 최소 조건” 7번;
  `docs/TYPIE_LICENSE_IMPACT.md:156-165`, “배포 전 결정 게이트”.
- **해결 방법:** 다음 중 하나를 제품 책임자가 서면 승인하고 오픈소스·저작권
  전문가에게 실제 배포 구조를 검토받는다.
  1. madi 전체를 AGPL 호환 방식으로 배포
  2. Typie 원저작자와 필요한 범위의 별도 라이선스 체결
  3. 현재 통합은 기술검증에만 사용하고 생산 editor를 독립 구현 또는 다른 엔진으로
     교체
- **검증 방법:** 승인된 결정 기록, 적용 범위, source/notice 또는 계약 증빙,
  제3자 notice 검토와 배포 허용 범위를 release gate에서 확인한다.
- **현재 상태:** **HUMAN DECISION REQUIRED**
- **미통과 영향:** 기술 테스트가 성공해도 현재 결합 구조를 proprietary production
  제품으로 배포할 수 있다고 판단할 근거가 없다.

## 5. Typie upstream 변화에 종속된 조건

### U-01. 과거 snapshot fixture를 포함한 commit upgrade gate

- **조건:** “과거 snapshot fixture를 포함한 commit upgrade gate를 정의한다.”
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:497`,
  “`GO`로 올리기 위한 최소 조건” 6번; 현재 guard가 migration은 아니라는 설명은
  `217-226`; `docs/MADI_FILE_FORMAT_V0.md:108-109`.
- **해결 방법:** 고정 commit별 `.madi`/snapshot corpus, generated API diff,
  codec decode, semantic scene break, recovery와 IME/render regression을 묶은
  upgrade 절차를 정의한다.
- **검증 방법:** 문서화된 gate가 exact candidate, 현재 fixture corpus,
  generated API diff, canonical 의미 비교, 안전한 거부/recovery, 수동 IME,
  artifact/notice 갱신과 rollback을 한 승인 단위로 요구하는지 검토한다. 실제
  candidate rehearsal은 U-02에서 별도로 추적한다.
- **현재 상태:** **PASS** — `docs/TYPIE_PINNING_AND_PATCHES.md`가 과거
  `.madi`/snapshot corpus, generated API·codec·IME·render diff, scene invariant,
  20회 round-trip, recovery, package smoke, 수동 IME와 rollback을 포함하는
  commit upgrade gate를 정의한다.
- **미통과 영향:** Typie 보안·버그 수정으로 commit을 올릴 때 기존 사용자 원고를
  열지 못하거나 조용히 손상시킬 수 있다.

### U-02. private `0.0.1` API/codec/IME/render 변화 관리의 실제 rehearsal

- **조건:** Typie upgrade를 일반 dependency bump가 아니라
  “API/codec/IME/render compatibility 작업”으로 취급하고, 실제 candidate
  commit을 채택하기 전에 정의한 gate를 rehearsal한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:423-453`,
  “API 안정성”과 “예상 유지보수 부담”.
- **해결 방법:** commit별 source/WASM/ICU/font hash, generated `.d.ts` diff,
  adapter contract, upstream IME adaptation provenance와 scene-break invariant를
  upgrade checklist에 고정한다.
- **검증 방법:** 의도적인 candidate commit을 사용한 dry-run에서 각 diff와
  compatibility test가 누락 없이 gate를 막거나 승인하는지 확인한다.
- **현재 상태:** **TODO** — upgrade gate와 provenance/hash 절차는 정의했지만
  실제 candidate commit을 선택해 과거 snapshot을 열고 호환 또는 안전한 거부를
  증명한 rehearsal은 없다. 현재 exact pin은 이 검증 전까지 유지한다.
- **미통과 영향:** private API 변경이 compile 성공 뒤 runtime 입력·render·codec
  회귀로 나타날 수 있어 안정적인 유지보수가 불가능하다.

## 6. 현재 증거가 부족해 미확인인 조건

### E-01. 긴 장편·다중 page·DPI·다중 monitor 성능과 메모리

- **조건:** “긴 장편, 다중 page, 높은 DPI에서 성능/메모리”를 확인한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:367-368`,
  `471-478`; `README.md`의 “Phase 0 한계”.
- **해결 방법:** C-02 구현 뒤 5,000자 이상과 현실적인 장편 규모 fixture,
  다양한 display scale·monitor 구성과 장시간 편집 시나리오를 정의한다.
- **검증 방법:** render/input latency, peak·steady-state memory, page 전환,
  저장시간과 누적 resource 증가를 반복 측정하고 허용 기준을 문서화한다.
- **현재 상태:** **TODO** — 5,445자/4-page fixture의 normal·packaged 기능
  smoke는 통과했지만 현실적인 장편, 장시간 편집, DPI·다중 monitor별
  latency/memory 허용 기준과 측정 증거는 없다.
- **미통과 영향:** 기능적으로 열리더라도 실제 장편에서 응답 불능, 메모리 고갈 또는
  입력 손실이 발생할 수 있다.

### E-02. 저장 중 crash와 backup 복구 fault injection

- **조건:** “crash 중 저장/backup 복구의 실제 fault injection”을 확인한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:482`;
  backup 설계는 `docs/ARCHITECTURE_PHASE0.md:215-223` 및
  `docs/MADI_FILE_FORMAT_V0.md`의 “저장”.
- **해결 방법:** backup 생성, rotation, transaction 시작·commit, fsync 경계에
  통제된 강제 종료 지점을 추가한 test harness를 만든다.
- **검증 방법:** 각 지점에서 process를 종료한 뒤 원본/`.bak`/`.bak.previous`의
  `quick_check`, revision, snapshot와 recovery text를 검사하고 문서화된 복구
  순서로 원고를 회수한다.
- **현재 상태:** **TODO** — SQLite transaction, revision과 backup 단위 test는
  통과했지만 저장 단계별 실제 process kill/power-loss fault injection은 없다.
- **미통과 영향:** 정상 round-trip이 통과해도 전원 장애나 crash에서 최신 원고와
  backup을 함께 잃을 수 있다.

### E-03. 접근성·screen reader·native candidate window 위치

- **조건:** “접근성, screen reader, native candidate window 위치의 실제 동작”을
  확인한다.
- **Phase 0 근거 위치:** `docs/TYPIE_FEASIBILITY_RESULT.md:485`.
- **해결 방법:** hidden textarea/Canvas의 caret geometry와 접근성 노출 범위를
  명시하고, 지원할 최소 Windows 접근성 계약을 정한다.
- **검증 방법:** 실제 한국어 IME 후보창 위치, keyboard-only 조작과 선정한 Windows
  screen reader를 사람이 확인해 환경·결과를 기록한다.
- **현재 상태:** **TODO** — 다중 page caret/pointer 기능은 자동 확인됐지만 실제
  screen reader, keyboard-only 계약과 Windows native IME candidate window 위치는
  사람이 확인하지 않았다.
- **미통과 영향:** 후보창이 caret와 분리되거나 보조기술 사용자가 본문을 인지·조작할
  수 없어 지원 대상 사용자에게 생산 적용할 수 없다.

## 종료 판정 요약

| 분류 | PASS | TODO | FAIL | HUMAN DECISION REQUIRED |
|---|---:|---:|---:|---:|
| 코드 | 10 | 0 | 0 | 0 |
| 빌드·개발환경 | 4 | 4 | 0 | 0 |
| 실제 사용자 수동검증 | 0 | 1 | 0 | 0 |
| 인간 결정 | 0 | 0 | 0 | 1 |
| Typie upstream 종속 | 1 | 1 | 0 | 0 |
| 증거 부족 | 0 | 3 | 0 | 0 |
| **합계** | **15** | **9** | **0** | **1** |

이 표는 Phase 0.5 최종 구현·자동검증 뒤의 상태다. 세부 실행 증거는
`docs/PHASE_0_5_CLOSURE_RESULT.md`에 기록한다. 자동으로 해결 가능한 원고 안전과
runtime 조건에서 실행 후 실패한 항목은 없지만, durable VCS/clean clone,
`wasm-opt` 재현 build, 실제 installer/installed-state smoke, 실제 candidate
upgrade, 현실 규모·crash·접근성과 수동 IME는 아직 닫히지 않았다. 사람이 수행하지
않은 IME 항목과 결정되지 않은 라이선스를 자동 완료로 처리하지 않는다.
