# madi

`madi`는 한국어 장편소설 작가를 위한 local-first Windows desktop 저작도구다.
현재 작업트리는 Phase 1C Story Bible Foundation 위에 Phase 1D World Graph의
파생 read model과 읽기 전용 Cytoscape 탐색 화면을 구현한다.

```text
Phase 0.5 baseline: CONDITIONAL TECHNICAL GO
Private local Phase 1A development: AUTHORIZED
Phase 1A technical verdict: TECHNICAL GO — PRIVATE LOCAL
Phase 1B implementation: COMPLETE IN WORKING TREE
Phase 1B focused verification: PASS
Phase 1B integration/development/packaged Electron acceptance: PASS
Phase 1B final pnpm verify gate: PASS
Phase 1B verdict: TECHNICAL GO — PRIVATE LOCAL
Phase 1C implementation: COMPLETE IN WORKING TREE
Phase 1C focused/integration/development/packaged Electron acceptance: PASS
Phase 1C final pnpm verify gate: PASS
Phase 1C verdict: TECHNICAL GO — PRIVATE LOCAL
Phase 1D implementation: COMPLETE IN WORKING TREE
Phase 1D focused read-model/renderer verification: PASS
Phase 1D development/unpacked Electron hard gates: PASS
Phase 1D verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

Phase 1D는 기존 Story Bible의 canonical entity/relation을 Rust가 revision-tagged DTO로
파생하고, renderer가 전체 또는 특정 entity 중심 1~3 hop 그래프로 표시한다. Graph는
canonical 관계를 쓰지 않으며 node 위치·viewport·filter만 작품별 `world-graph.v1`
UI state로 저장한다. 구현·성능·실제 Electron 근거는
[`docs/PHASE_1D_RESULT.md`](docs/PHASE_1D_RESULT.md)와
[`docs/WORLD_GRAPH_PERFORMANCE.md`](docs/WORLD_GRAPH_PERFORMANCE.md)를 따른다. Phase 1C의
확정 결과는 [`docs/PHASE_1C_RESULT.md`](docs/PHASE_1C_RESULT.md), Phase 1B의 snapshot
기반 project-wide rollback 결정은
[`docs/PHASE_1B_RESULT.md`](docs/PHASE_1B_RESULT.md)와
[`ADR-0002`](docs/decisions/ADR-0002-project-wide-undo-via-snapshots.md)에 남아 있다.

## 현재 할 수 있는 일

- 하나의 `.madi` SQLite 파일에 작품 구조와 장면별 Typie 문서를 함께 저장
- `WORK → VOLUME → CHAPTER → SCENE` Binder
- WORK 바로 아래 CHAPTER도 허용
- 권·화·장면 추가, 모든 node 이름 변경, 확인 후 subtree 삭제
- 같은 부모 안에서 위·아래 순서 변경
- SCENE을 선택했을 때만 Typie editor 활성화
- 장면별 한국어 본문, Undo/Redo 및 `madi.scene-break.v1`
- 약 550ms debounce 자동저장, `Ctrl+S`, 장면 전환 전 저장, 종료 전 저장
- 마지막 선택 node, Binder 펼침 상태 및 폭을 `.madi`에 저장·복원
- 앱 종료 후 같은 `.madi`를 열어 구조와 각 장면 document 복원
- WORK/VOLUME/CHAPTER 선택 범위의 연속 원고(Scrivener식 Scrivenings)
- active SCENE 한 개만 shared Typie editor로 편집하고 나머지는 read-only 표시
- 제목/본문, 현재 subtree/작품 전체의 한국어 exact substring 검색
- 결과 문맥, 장면별 그룹, 위치 이동과 단일 장면/Scrivenings 강조
- BODY 결과별 선택적 의미 치환과 치환 전 자동 logical snapshot
- 이름 있는 snapshot 생성·목록·이름 변경·삭제·요약 diff·안전 복원
- 현재 SCENE과 선택 subtree의 공백 포함/제외 Unicode scalar 글자 수
- Electron 없이 UTF-8 plain-text recovery를 꺼내는 Rust CLI
- `원고`, `설정`, `그래프` 작업 모드 전환
- 등장인물·장소·조직·물건·사건·세계관 규칙·복선·기타 설정 CRUD
- 설정별 별칭, 태그, 상태, 요약, 색상 토큰, 아이콘 키와 확장 JSON 속성
- 설정별 독립 Typie 상세 노트와 장면과 같은 저장 안전성
- 프로젝트별 built-in/custom 관계 타입과 directed/undirected/inverse 관계 CRUD
- SCENE과 설정의 `APPEARS`, `POV`, `MENTIONED`, `RELATED` 명시적 연결
- 이름·별칭 exact substring 기반의 본문 언급 후보와 명시적 연결 승격
- Story Bible 전체와 entity note를 포함하는 named snapshot v2 및 v1 복원 호환
- Story Bible canonical data에서 파생한 읽기 전용 World Graph
- 8종 entity kind shape/color, directed arrow, undirected 단일 edge와 inverse detail label
- kind/status/tag ANY·ALL/relation type/direction/고립 node/label filter
- 전체 graph 및 선택 entity 중심 1·2·3 hop BFS 탐색
- 이름·별칭·태그·요약 검색, node/edge 선택, 이웃 강조와 통계
- 선택 entity의 관계·명시적 장면·lazy 본문 언급 후보 확인
- 그래프에서 기존 Story Bible entity/관계와 원고 SCENE으로 이동
- 작품별 node 위치·viewport·filter·focus mode 저장과 종료 후 복원

그래프 관계 편집, plot Canvas, docking workspace, 시간축/지식 시점 graph, Reader Lab,
EPUB, HWP/HWPX, LLM 추출, cloud/sync, collaboration, mobile/web, 장면별 상세 diff와
플랫폼별 출판 글자 수는 Phase 1D 범위가 아니다.

## 실제 사용 흐름

### 1. 앱 실행

```powershell
pnpm dev
```

Typie WASM이 준비되면 상단에서 `새 프로젝트` 또는 `.madi 열기`를 사용할 수 있다.

### 2. 새 작품 만들기

1. `새 프로젝트`를 누른다.
2. 저장 대화상자의 기본 이름 `드래곤을죽이다.madi`를 확인하고 저장한다.
3. 새 파일에는 WORK, 기본 CHAPTER, 기본 SCENE과 연결 document가 함께 생긴다.
4. 필요하면 Binder의 WORK에서 `이름 변경`을 눌러 작품명을 정한다.

기존 경로를 덮어쓰지 않는다. 새 project의 첫 SCENE은 Typie가 최초 graph를 만들기
전까지 0-byte placeholder이며, editor가 연 뒤 dirty 상태가 되어 첫 자동저장에서
실제 snapshot으로 교체된다.

### 3. Binder 구성

- WORK의 `권 추가`를 두 번 눌러 권 2개를 만든다.
- 각 VOLUME의 `화 추가` 또는 WORK의 `화 추가`로 CHAPTER를 만든다.
- CHAPTER의 `장면 추가`로 SCENE을 만든다.
- 빈 입력 이름은 UI에서 `새 작품`, `새 권`, `새 화`, `새 장면` 기본값으로
  정규화한다.
- `위로`와 `아래로`는 같은 parent의 sibling 순서만 바꾼다.
- parent 이동은 Rust/core API에 있지만 현재 Binder에는 drag-and-drop이나 parent
  이동 UI가 없다.
- 삭제는 확인 dialog 뒤 명시적인 recursive delete로 실행된다. WORK는 삭제할 수
  없다.

### 4. 단일 장면과 Scrivenings 편집

1. SCENE을 선택하면 기존 단일 장면 editor가 열린다.
2. 장면별 한국어 본문을 입력한다.
3. 필요하면 상단 `장면 구분선`으로 `madi.scene-break.v1`을 넣는다.
4. 저장 badge에서 `dirty → saving → saved` 상태를 확인한다.
5. 즉시 저장하려면 `Ctrl+S` 또는 상단 `저장`을 누른다.

WORK, VOLUME 또는 CHAPTER를 선택하면 하위 장면을 Binder 순서로 보여주는
Scrivenings가 열린다. 장면 문서는 합치지 않는다. 비활성 장면은 read-only preview이고
본문을 누른 한 장면만 기존 shared Typie editor를 사용한다. 먼 장면은 lightweight
placeholder로 남겨 한 번에 여러 Typie instance를 만들지 않는다.

SCENE A에서 B로 이동할 때 A의 snapshot과 plain-text recovery 저장이 성공한 뒤 B를
load한다. 한글 IME composition 중에는 저장·전환·종료를 거부하고 현재 장면을
유지한다. A 저장이 실패해도 A editor를 버리거나 B를 먼저 열지 않는다. 빠른
A → B → C 요청은 queue와 request/session token으로 오래된 장면 load가 화면에
적용되지 않게 한다. save 응답도 scene/document/generation/saveSequence가 원래
요청과 모두 일치할 때만 현재 저장 상태에 적용한다.

저장 중 추가 편집은 새 generation으로 dirty 상태에 남아 다음 자동저장을 예약한다.
저장 오류 뒤에는 현재 editor를 유지한 채 `저장` 또는 `Ctrl+S`로 재시도할 수 있다.
dirty event가 있었더라도 snapshot bytes와 plain-text recovery의 signature가 마지막
성공 값과 같으면 DB write를 반복하지 않고 saved로 돌아간다.

### 5. 작품 검색과 선택 치환

상단 `검색 · 치환` panel에서 query, 제목/본문/전체, case, 현재 선택 범위/작품 전체를
정한다. 검색은 저장된 recovery의 non-overlapping exact substring이며 결과는 장면별
문맥과 Unicode scalar range를 제공한다. FTS5는 사용하지 않는다.

BODY 결과만 checkbox로 선택해 치환할 수 있다. 적용 전에 현재 장면을 저장하고
preview revision, SCENE/document identity와 source SHA-256를 확인한다. 각 장면은
Typie semantic transaction으로 변환되고 모든 결과는 `AUTO_BEFORE_REPLACE` snapshot과
함께 한 SQLite transaction으로 commit된다. newline, scene break/atom 또는 block을
가로지르는 범위와 mixed inline modifier 범위는 거부한다.

project-wide 치환과 snapshot restore가 shared editor를 임시 사용하면 controller가
exclusive lock을 잡고 Typie surface/input을 inert/disabled로 만든다. 그동안 `Ctrl+S`,
Undo/Redo, scene break, focus와 장면 전환은 fail-closed다. 예상하지 못한 editor mutation은
commit 전에 작업을 중단한다. DB commit 뒤 저장된 장면 reload가 실패하면 임시 graph를
저장하지 못하도록 fatal lock을 유지하며 창 닫기만 허용한다.

project 전체 작업은 하나의 지속 가능한 `Ctrl+Z` entry가 아니다. 여러 장면을
되돌릴 때는 자동 생성된 snapshot을 복원하며 이는 공식 제품 동작이다. 정확한 의미론은
[`docs/SEARCH_REPLACE_SEMANTICS.md`](docs/SEARCH_REPLACE_SEMANTICS.md)를 따른다.

### 6. Named snapshot

`Named snapshot` panel에서 이름과 선택 메모로 현재 logical project를 저장하고 목록,
이름 변경, 삭제와 현재 상태 대비 요약 diff를 사용할 수 있다. restore 확인 뒤 core는
현재 상태를 같은 transaction의 `AUTO_BEFORE_RESTORE` snapshot으로 먼저 보존한다.
payload는 SQLite 복사본이 아니라 hash가 붙은 `MADI_LOGICAL_JSON` v2다. v2에는 설정,
별칭, 태그, 관계 타입, 관계, 장면 연결과 entity note document가 포함된다. 기존 v1
snapshot은 계속 읽으며 복원 뒤 사용자 Story Bible은 빈 상태가 되고 built-in 관계
타입만 다시 seed된다.

복원 확인 순간에는 fresh diff를 다시 요청해 preview revision과 summary를 대조한다.
달라졌으면 복원을 실행하지 않고 갱신된 차이를 다시 확인하게 한다. CURRENT 검색은
선택 Binder node ID까지 preview identity에 넣으므로 같은 표시 label이어도 실제 scope
node가 바뀌는 즉시 치환 preview가 무효화된다. 현재 live SCENE의 첫 BODY hit는
editor focus를 빼앗지 않고 Typie selection으로 강조한다.

### 7. Story Bible

상단의 `설정`을 선택하면 설정 목록, 설정 상세, 관계·등장 위치의 3열 workspace가
열린다. 설정을 만들고 이름·타입·상태·요약·별칭·태그를 편집할 수 있으며 가운데의
Typie editor는 선택한 entity의 독립 상세 note document를 편집한다. 장면과 entity가
같은 editor adapter를 공유하지만 controller는 `ownerKind`, `ownerId`, `documentId`,
`generation`, `saveSequence`를 모두 확인해 서로의 오래된 저장 응답을 차단한다.

오른쪽 열에서는 outgoing/incoming 관계, inverse label, 연결된 장면과 **본문에서 찾은
후보**를 확인한다. 후보는 저장된 장면 recovery에서 entity 이름과 별칭을 exact
substring으로 찾은 참고 결과이며 자동으로 canonical relation이나 scene link가 되지
않는다. 사용자가 role을 고르고 승격한 결과만 `scene_entity_links`에 저장된다.

원고 mode에서 `설정 연결` panel을 열면 현재 SCENE의 명시적 link를 추가·해제하고
관련 설정으로 이동할 수 있다. 설정 mode의 장면/후보를 선택하면 원고 mode로 돌아가
해당 장면과 첫 일치 범위를 연다.

### 8. World Graph

상단 `그래프`를 누르면 Story Bible canonical data를 수정하지 않는 탐색 화면으로
전환한다. 기본 status filter는 `ACTIVE + DRAFT`이고 `ARCHIVED`는 사용자가 명시적으로
포함할 수 있다.

1. 검색에서 이름·별칭·태그·요약으로 설정을 찾는다.
2. 전체 graph 또는 중심 entity와 depth 1·2·3을 선택한다.
3. 종류·상태·태그 ANY/ALL·관계 type·directed/undirected·고립 node·label을 조합한다.
4. node를 선택해 관계, 명시적 SCENE link와 lazy mention 후보 수를 본다.
5. edge를 선택해 forward/inverse label, 방향과 note를 확인한다.
6. `설정 상세에서 열기`, `관계 편집에서 열기` 또는 SCENE 버튼으로 기존 화면으로
   이동한다.

Node drag는 배치 좌표만 바꾸며 relation을 생성하지 않는다. `자동 배치 다시 실행`은
Cytoscape.js 내장 `cose`를 다시 실행하고 `레이아웃 초기화`는 저장 좌표와 viewport를
비운다. Canvas를 쓰기 어려운 경우 같은 node/edge를 키보드 버튼 목록에서 선택할 수
있다. Canonical 생성·수정·삭제는 계속 `설정` 화면에서만 수행한다.

### 9. 종료와 재열기

1. 현재 IME 조합을 끝낸다.
2. 창을 닫는다.
3. renderer는 현재 dirty 장면 또는 entity note와 `workspace.v1`, `world-graph.v1` UI
   state 저장을 먼저 요청한다.
4. main process는 renderer가 저장 성공을 승인하기 전 창을 파괴하지 않는다.
5. Electron process가 완전히 끝난 뒤 앱을 다시 실행한다.
6. `.madi 열기`로 같은 파일을 선택한다.

open 시 tree와 UI state를 읽는다. 저장된 selected ID가 없으면 최초 유효 SCENE,
SCENE이 없으면 WORK로 fallback해 Binder-only mode로 연다. 손상된 `workspace.v1`은
tree 복원을 막지 않고 기본 선택·펼침·폭으로 격리한다. Binder 폭은 220..640
범위로 복원한다.

## `.madi` v1 요약

- `PRAGMA application_id = 0x4D414449`
- `app_meta.format_version = 1`
- `app_meta.schema_version = 4`
- `PRAGMA user_version = 4`
- 기존 table: `app_meta`, `documents`, `schema_migrations`
- Phase 1A table: `projects`, `tree_nodes`, `ui_state`
- Phase 1B table: `search_documents`, `named_snapshots`
- Phase 1C table: `entities`, `entity_aliases`, `tags`, `entity_tags`,
  `relation_types`, `entity_relations`, `scene_entity_links`

정규 hierarchy:

```text
WORK
├─ VOLUME
│  └─ CHAPTER
│     └─ SCENE → documents.id
└─ CHAPTER
   └─ SCENE → documents.id
```

project마다 WORK는 정확히 하나다. SCENE은 `tree_nodes.document_id`, entity는
`entities.document_id`로 각각 독립 document를 정확히 하나 소유한다. 같은 document를
SCENE과 entity가 공유할 수 없다. 생성·이름 변경·저장·삭제는 owner와 연결 document를
같은 transaction에서 처리한다. 구조, 장면과 Story Bible 저장은 project-wide
optimistic `revision`을 사용하고 pre-save backup을 회전한다. UI state 저장은
manuscript revision을 올리지 않는다.

`search_documents`는 `documents.plain_text_recovery`의 exact-search projection이며
insert/update/delete trigger가 같은 transaction에서 갱신한다. `named_snapshots`는
`MANUAL`, `AUTO_BEFORE_REPLACE`, `AUTO_BEFORE_RESTORE` logical payload와 SHA-256를
저장한다. schema 2 file을 열면 기존 document를 잃지 않고 migration 3에서 projection을
backfill한 뒤 migration 4가 Story Bible table과 built-in 관계 타입을 만든다.
`format_version`은 계속 1이다. Phase 1D World Graph는 schema/table을 추가하지 않는다.

sibling 순서는 `REAL order_key`를 `1024.0` 간격으로 배정한다. 중간 삽입은
midpoint를 사용하고 간격이 `0.000001` 이하이면 해당 sibling만 rebalance한다.
읽기 tie-break는 `(order_key, id)`다.

UI state는 `ui_state.key = 'workspace.v1'`에 다음 snake_case JSON을 저장한다.

```json
{
  "selected_node_id": null,
  "expanded_node_ids": [],
  "binder_width": 300
}
```

World Graph 상태는 별도 `ui_state.key = 'world-graph.v1'`에 full/focused mode, 중심 ID,
depth, filter, layout, viewport, 최대 500개 node position과 마지막 선택 entity ID를
snake_case JSON으로 저장한다. 이 값은 project revision을 올리지 않고 named snapshot
payload에도 포함되지 않으므로 snapshot restore 뒤 현재 사용자 배치를 유지한다.

전체 계약과 migration 규칙은
[`docs/MADI_FILE_FORMAT_V1_DRAFT.md`](docs/MADI_FILE_FORMAT_V1_DRAFT.md)를 따른다.

## 기술 구조와 보안 경계

- Electron main / sandboxed preload / React renderer
- TypeScript strict mode
- Rust `madi-core` persistent JSON-RPC sidecar
- SQLite `.madi`
- Cytoscape.js `3.34.0` renderer와 내장 `cose` layout
- Typie browser WASM, ICU 및 한국어 font를 local asset으로 사용
- `MadiEditorAdapter` / `TypieEditorAdapter` 경계
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- production external network 차단과 local `madi://app` protocol

일반 madi code와 Rust core는 Typie 내부 type을 직접 import하지 않는다. renderer에는
generic IPC, filesystem path, process, shell 또는 임의 RPC method를 노출하지 않는다.
main이 dialog path를 session capability에 연결하고, preload는 다음 고정 API만
노출한다.

```text
createProject, openProject, saveDocument, loadDocument, recoverPlainText,
getProjectTree, createNode, renameNode, moveNode, reorderNode, deleteNode,
loadSceneDocument, saveSceneDocument, saveUiState, loadUiState,
listDescendantScenes, searchProject, getTextStatistics, applyReplacementBatch,
createNamedSnapshot, listNamedSnapshots, renameNamedSnapshot,
deleteNamedSnapshot, diffNamedSnapshot, restoreNamedSnapshot,
listEntities, searchEntities, createEntity, updateEntity,
getEntityDeleteImpact, deleteEntity, loadEntityNote, saveEntityNote,
listEntityAliases, createEntityAlias, deleteEntityAlias,
listTags, createTag, updateTag, deleteTag, listEntityTags, setEntityTags,
listRelationTypes, createRelationType, updateRelationType, deleteRelationType,
listEntityRelations, createEntityRelation, updateEntityRelation,
deleteEntityRelation, listSceneEntityLinks, createSceneEntityLink,
deleteSceneEntityLink, discoverEntityMentions, promoteEntityMention,
getWorldGraph, getWorldGraphStats, getEntityGraphDetail,
getEntitySceneContext, saveWorldGraphUiState, loadWorldGraphUiState,
getAppVersion, onCloseRequested, completeCloseRequest
```

World Graph DTO는 madi가 소유하며 Cytoscape type은 renderer 변환 계층 밖으로 누출되지
않는다. Label·summary·relation note는 text/data로만 전달하고 `innerHTML`을 사용하지
않는다. Core/main/preload 오류에는 snapshot과 원고 본문을 출력하지 않는다.

## 고정된 Typie 기준

- Repository: `https://github.com/penxle/typie`
- Commit: `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- Local source: `vendor/typie`
- Runtime metadata: `packages/typie-runtime/BUILD_INFO.json`
- Runtime package license 표기: `AGPL-3.0-only`

현재 baseline commit에는 `vendor/typie`가 mode `160000` gitlink로 기록돼 있다.
remote가 없으므로 새 경로의 실제 `git clone --recurse-submodules` 재현은 아직
`DEFERRED TO PRE-RELEASE`다.

checkout 확인:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\bootstrap-typie.ps1
git -C .\vendor\typie rev-parse HEAD
git -C .\vendor\typie status --short
```

일반 앱 build는 고정된 runtime artifact를 사용한다. `wasm-opt`을 포함하는 Typie
runtime에 Phase 1B semantic replacement patch를 적용한 재현 build script는 다음이다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-typie-phase1b-runtime.ps1
```

script는 clean/pinned submodule을 확인하고
`patches/typie/phase1b-semantic-replace.patch`를 임시 적용해 WASM/bindings를 만든 뒤
`BUILD_INFO.json`의 SHA-256를 검증하고 submodule을 clean 상태로 되돌린다. 최종 gate에서
이 script의 독립 재실행 여부와 결과를 별도로 기록해야 한다.

## Windows 개발 요구사항

- Windows 10/11 x64
- Git
- Node.js `26.3.1` (`.node-version`)
- pnpm `11.9.0` (`package.json#packageManager`)
- Rust `1.97.1` MSVC (`rust-toolchain.toml`)
- Rust targets `x86_64-pc-windows-msvc`, `wasm32-unknown-unknown`
- Visual Studio 2022 Build Tools의 C++ desktop workload와 Windows SDK

Windows에서 pnpm CLI를 한 번만 준비한다. 이 명령은 전역 CLI 설치에만 npm을
사용하며, 저장소 설치·build·test·package는 계속 pnpm만 사용한다.

```powershell
npm install --global pnpm@11.9.0
```

설치:

```powershell
node --version
pnpm --version
rustc +1.97.1-x86_64-pc-windows-msvc --version

powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\bootstrap-typie.ps1
pnpm install --frozen-lockfile
```

의존성 최초 설치와 Typie checkout에는 network 또는 cache가 필요할 수 있다. 설치
뒤 production runtime은 Typie/madi server, account, API, cloud 또는 sync에
의존하지 않는다.

## build, test와 package 명령

```powershell
# 대화형 개발 실행
pnpm dev

# build
pnpm build

# 집중 검증
pnpm run test:core
pnpm run typecheck
pnpm run test:desktop
pnpm run test:phase1a
pnpm run test:phase1b
pnpm run test:phase1c
pnpm run test:phase1d
pnpm run test:integration

# 최종 gate
pnpm verify
pnpm package:unpacked
pnpm test:electron
pnpm test:package
pnpm check:repository
pnpm format:check

# 대화형 개발 실행은 최종 gate와 별도
pnpm test:dev
```

`pnpm verify`는 toolchain/repository/format/typecheck, renderer/Rust test, 실제 Typie
probe, Phase 0.5/1A/1B/1C/1D `.madi` integration, production build, 일반 Electron smoke와
unpacked packaged smoke를 순서대로 실행한다. `pnpm test:dev`는 interactive
Vite/Electron startup 성격 때문에 별도다.

unpacked 출력:

```text
output/madi-win32-x64/madi.exe
output/madi-win32-x64/resources/app/dist/
output/madi-win32-x64/resources/bin/madi-core.exe
output/madi-win32-x64/resources/licenses/
```

이 폴더는 installer, code signing 또는 자동 update가 아니다.

### 현재 검증 상태

| 항목 | 현재 기록 |
|---|---|
| Rust 전체 test | `33 / 33 PASS` |
| renderer 전체 test | `27 files / 136 tests PASS` |
| desktop typecheck | `PASS` |
| Typie semantic replacement probe | `PASS` |
| Phase 1D 19 entity/16 relation/two-process sidecar | `PASS` — directed 12/undirected 4, final revision 94 |
| Phase 1D 500/1,500/2,000/2,000 성능 | `CONDITIONAL PASS` — 무누락/no-crash/layout hard gate PASS, interaction 일부 250 ms 초과 |
| Phase 1D 실제 development Electron acceptance | `PASS (hard gates)` — IPC 110.6 ms, layout 5회 max 973.9 ms, drag/reopen/network 0 PASS |
| Phase 1D 실제 unpacked Electron acceptance | `PASS (hard gates)` — IPC 64.5 ms, layout 5회 max 930.3 ms, drag/reopen/network 0 PASS |
| 최종 `pnpm verify` | `PASS` — exit code 0, 145.2초 |
| 독립 `pnpm package:unpacked` | `PASS` — `output/madi-win32-x64/madi.exe`, release sidecar와 Cytoscape license 포함 |
| 독립 `pnpm test:electron` / `pnpm test:package` | `PASS / PASS` — exit code 0, small+500/2,000 two-process actual windows |
| 독립 `pnpm check:repository` / `pnpm format:check` | `PASS / PASS` — boundary PASS, 103 files/issues 0 |

## Rust CLI와 JSON-RPC

core build와 help:

```powershell
pnpm run build:core
$core = ".\crates\madi-core\target\debug\madi-core.exe"
& $core --help
& $core create-tree-node --help
& $core save-scene --help
```

Phase 1A CLI subcommand:

```text
create-project, open-project, inspect-project,
load-project-tree, create-tree-node, rename-tree-node,
move-tree-node, reorder-tree-node, delete-tree-node,
load-scene, save-scene, save-ui-state, load-ui-state,
save-document, load-document, recover-plain-text, serve
```

Electron main이 사용하는 JSON-RPC method는 snake_case다.

```text
create_project, open_project, inspect_project,
load_project_tree, create_tree_node, rename_tree_node,
move_tree_node, reorder_tree_node, delete_tree_node,
load_scene, save_scene, save_ui_state, load_ui_state,
list_descendant_scenes, search_project, get_text_statistics,
apply_replacement_batch, create_named_snapshot, list_named_snapshots,
rename_named_snapshot, delete_named_snapshot, diff_named_snapshot,
restore_named_snapshot,
list_entities, search_entities, create_entity, update_entity,
get_entity_delete_impact, delete_entity, load_entity_note, save_entity_note,
list_entity_aliases, create_entity_alias, delete_entity_alias,
list_tags, create_tag, update_tag, delete_tag, list_entity_tags, set_entity_tags,
list_relation_types, create_relation_type, update_relation_type,
delete_relation_type, list_entity_relations, create_entity_relation,
update_entity_relation, delete_entity_relation, list_scene_entity_links,
create_scene_entity_link, delete_scene_entity_link, discover_entity_mentions,
promote_entity_mention,
get_world_graph, get_world_graph_stats, get_entity_graph_detail,
get_entity_scene_context,
save_document, load_document, recover_plain_text
```

plain-text 긴급 복구 예:

```powershell
& $core recover-plain-text `
  --file-path ".\드래곤을죽이다.madi" `
  --output ".\recovered.txt"
```

`--output`은 새 file만 만들고 기존 file을 덮어쓰지 않는다. terminal에 원고를
출력하지 않으려면 output 경로를 사용한다.

## 수동 IME와 배포 금지 경계

Windows native 한국어 IME 15항목은 계속
`MANUAL VALIDATION PENDING (15 / 15 NOT TESTED)`이다. Vitest, Playwright와
programmatic 한글 입력은 이 상태를 `PASS`로 바꾸지 않는다. 실제 절차는
[`docs/MANUAL_KOREAN_IME_CHECKLIST.md`](docs/MANUAL_KOREAN_IME_CHECKLIST.md)를
따른다.

Typie runtime의 `AGPL-3.0-only` 표기와 현재 결합 구조 때문에 배포 정책은
`HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`이다. 현재 허용 범위는 비공개 로컬
개발과 제한된 내부 기술검증이다. 다음은 허용되지 않는다.

- public download
- 유료 또는 고객 pilot
- installer 외부 전달
- app store/package registry 배포
- proprietary production 배포의 승인 근거로 사용

AGPL 호환 공개, Typie 권리자와 별도 license 또는 production editor 독립 구현 중
하나를 제품 책임자와 법률 전문가가 서면 결정해야 이 경계를 바꿀 수 있다.
[`docs/LICENSE_DECISION_REQUIRED.md`](docs/LICENSE_DECISION_REQUIRED.md)는 법률
자문이 아니라 결정 입력 문서다.

## 후속 단계로 미룬 항목

다음은 Phase 1D 완료로 해소한 항목이 아니라 후속 지원·배포·hardening gate로 유지한다.

- Windows native 한국어 IME 수동검증
- installer/installed-state lifecycle
- 장편·장시간·DPI·다중 monitor 성능과 memory 기준
- 저장 중 crash/power-loss fault injection
- screen reader·keyboard-only 접근성 및 native 후보창 위치
- 실제 후보 Typie commit upgrade rehearsal
- remote recursive clean clone: `DEFERRED TO PRE-RELEASE`
- 대형 원고 preview page cache와 완전한 virtual list
- exact search 성능 benchmark/index 전략
- named snapshot retention, compression과 quota
- 장면별 상세 diff와 부분 restore
- 500/2,000을 넘는 graph 규모, 비동기/worker layout과 layout 중 취소
- graph 관계 편집, 시간축과 인물별 지식 시점 필터
- 형태소/fuzzy mention 탐색과 자동 relation 추론

## 문서

- [Phase 1D 범위와 완료 계약](docs/PHASE_1D_SCOPE.md)
- [Phase 1D 저장소 결과](docs/PHASE_1D_RESULT.md)
- [World Graph read model](docs/WORLD_GRAPH_READ_MODEL.md)
- [World Graph 시각 의미](docs/WORLD_GRAPH_VISUAL_SEMANTICS.md)
- [World Graph 성능](docs/WORLD_GRAPH_PERFORMANCE.md)
- [ADR-0003: World Graph derived read model](docs/decisions/ADR-0003-world-graph-is-derived-read-model.md)
- [Phase 1C 범위와 완료 계약](docs/PHASE_1C_SCOPE.md)
- [Phase 1C 저장소 결과](docs/PHASE_1C_RESULT.md)
- [Story Bible 데이터 모델](docs/STORY_BIBLE_DATA_MODEL.md)
- [Entity relation 의미 계약](docs/ENTITY_RELATION_SEMANTICS.md)
- [Entity 본문 언급 후보 탐색](docs/ENTITY_MENTION_DISCOVERY.md)
- [Phase 1B 범위와 완료 계약](docs/PHASE_1B_SCOPE.md)
- [Phase 1B 저장소 결과](docs/PHASE_1B_RESULT.md)
- [ADR-0002: project-wide Undo via snapshots](docs/decisions/ADR-0002-project-wide-undo-via-snapshots.md)
- [Scrivenings 아키텍처](docs/SCRIVENINGS_ARCHITECTURE.md)
- [검색·선택 치환 의미론](docs/SEARCH_REPLACE_SEMANTICS.md)
- [Named snapshot logical payload](docs/NAMED_SNAPSHOT_FORMAT.md)
- [`.madi` v1 format 초안](docs/MADI_FILE_FORMAT_V1_DRAFT.md)
- [Phase 1A 저장소 결과](docs/PHASE_1A_RESULT.md)
- [Phase 0.5 폐쇄 결과](docs/PHASE_0_5_CLOSURE_RESULT.md)
- [Typie pin과 patch 정책](docs/TYPIE_PINNING_AND_PATCHES.md)
- [라이선스 결정 필요](docs/LICENSE_DECISION_REQUIRED.md)
- [수동 한국어 IME checklist](docs/MANUAL_KOREAN_IME_CHECKLIST.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
