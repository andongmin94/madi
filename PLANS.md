# madi 개발 계획

갱신일: 2026-10-01
작업 위치: `main`. 실제 검증 대상은 각 실행에 기록된 exact source SHA를 따른다.
현재 작업: World Graph의 반복 VIEWPORT 적용 경합을 수정한 새 후보에서 development·fresh D와 전체 Windows 검증을 종료한다.

이 문서는 현재 목표, 작업 순서와 완료 조건을 관리하는 유일한 실행 계획이다.
목표는 기존 제품 범위를 완성하고 동일 후보의 Windows 실제 검증을 종료하는 것이다.
구현, 자동 검증, 사람의 수동 검증과 배포 승인은 각각 구분한다.

## 현재 제품 범위

madi는 한국어 장편소설의 기획·집필·설정 관리·읽기 검토·출판을 위한 로컬 Windows 작업실이다.
작품의 canonical manuscript는 하나의 `.madi` 파일에 저장한다.

| 영역 | 현재 구현 범위 |
| --- | --- |
| 집필 | 작품·권·화·장면 Binder, 장면 편집, 연속 원고, 검색·치환 |
| 저장·복구 | 자동저장, revision 검사, 일관된 백업, named snapshot, 독립 텍스트 추출 |
| 설정 관리 | Story Bible, 명시적 관계·장면 연결, 본문 언급 후보 |
| 기획 | 설정 관계에서 파생하는 읽기 전용 World Graph, 독립 Plot Canvas |
| 읽기 검토 | Publication IR 기반 Reader Lab, 독서 설정 비교, 원고 위치 이동 |
| 출판 | Publication IR 기반 EPUB·HWPX, 수동 승인 조건이 있는 선택적 HWP bridge |
| AI 보조 | 사용자 제공자·키와 요청별 범위 동의, 일반 제안 검토·복사, exact same-block selection 수정 |

Publication IR을 Reader Lab과 출판 exporter의 유일한 원고 입력으로 유지한다.
Typie 타입은 Madi 소유 editor adapter 안에 두며 생성 파일·report·cache·UI 상태는 원고와 분리한다.
AI mutation은 정확한 단일 블록 선택 범위만 허용한다. 일반 보조의 검토·복사는 원고를 바꾸지 않는다.
현재 원래 범위의 완료에 집중하며 새 기능이나 큰 구조 변경을 추가하지 않는다.

## 현재 후보와 검증 상태

초기 프로젝트 생성 시 editor 잠금 계약, footer AI action 배치,
일반 AI 안내 정정과 Chromium spellcheck dictionary 다운로드 억제가 반영되어 있다.
`8b55788`은 종료 승인 뒤 추가 자동 저장을 차단하고 진행 중인 UI 저장을 기다린다.
`80225d3`은 제품 종료부터 wrapper 정리까지 진단 0건을 검사하며,
PID와 생성 시각으로 마디 프로세스의 종료를 증명한다.
후속 구현과 단위 성공만으로 Phase 1H의 실제 offline/network 판정을 해소하지 않는다.

최근 실제 검증 source는 `51c1e6cdc10107d76e30103fbe1d6f4d035218e3`다.
이 source의 development 전체와 후속 standalone fresh E/F/G/H·AI 양쪽은 통과했지만,
full run2는 fresh D의 World Graph에서 실패했다. `36cbf72e51667e06f0124651396f448d5a3d73db`는
viewport 수정을 구현하고 회귀 RED→GREEN2·관련21테스트·typecheck를 통과했지만 수정 후 actual은 미실행이다.

| 검증 | 현재 관측과 판정 |
| --- | --- |
| 고정 원본 | Typie exact pin 복구 및 repository hash 검증 경로 유지 |
| 종료 저장 경합 | 기존 코드의 추가 저장 1회 재현 후 수정. 관련 4파일·28테스트와 typecheck PASS |
| G development actual | `80225d3`·`b21827a`·`51c1e6c` **PASS**. 일반 180,000자·장편 675,000자 5회 exact coverage, ZIP reopen·결정성, 종료 진단·잔여 프로세스 0 |
| H development actual | `55d1d45`·`b21827a`·`51c1e6c` **PASS**. 일반 원고와 장편 5회, preset·snapshot·ZIP/XML reopen·결정성·취소·no-clobber·정상 종료. 과거 실패는 결과 문서에 보존 |
| HWPX 상태 조회 경합 | `7c87e83`: 부모 callback 변경 시 불필요한 재조회를 재현 후 기존 EPUB 방식으로 수정. 관련 14테스트·typecheck PASS. 후속 actual 실패의 오류 표시를 확인 |
| 저장 HWPX 프리셋 해시 | `451e085` native 재현 후 `bf357ca`에서 중복 JS 재해시만 제거. 정상 수락 2건 RED→GREEN·잘못된 hash/config 거부, 관련 34테스트·typecheck PASS. `51c1e6c` development·standalone fresh H PASS; 최종 aggregate 대기 |
| 과거 `pnpm verify` 전체 | `31adb1d` run2 **FAIL**, 약 48.72분 후 G orphan 검사에서 종료. 선행 Desktop 666테스트·native·integration·build·basic/D/E/F 통과, H와 package 미도달 |
| 후속 `pnpm verify` 전체 | `b21827a` run1 **FAIL**, 4021.131초. Desktop 678테스트·native·integration·build·development basic/D/E/F/G/H 통과 후 package 준비의 E fixture `create_tree_node -32000` 실패. Fresh package 미도달 |
| 저장 오류 재현·수정 | `4463d7a`는 백업 파일 작업의 I/O32/33만 20ms 간격·500ms budget으로 재시도. 실제 잠금 RED→GREEN·저장 7테스트·오류 분류 2테스트 PASS. 원본 E generator 두 번/각422 requests PASS, `51c1e6c` full run2의 prepackage E도 PASS |
| `51c1e6c` full run1 | **FAIL**, exit1/1539.756초. Desktop678·core63·native·WASM·CLI·build·basic PASS 후 development D에서 Error messageLength71. 실제 실패 조건·인과 미확정 |
| `51c1e6c` full run2 | **FAIL**, exit1/5133.172초. Desktop103파일/678테스트·native·CLI·build·development basic/D/E/F/G/H·prepackage D/E/F·package build·fresh basic PASS 후 fresh D pointer-center wait 실패(messageLength88). 이 full의 fresh E/F/G/H는 미도달 |
| `51c1e6c` standalone fresh | E/F/G/H 공식 workflow 각각 **PASS**. G/H 장편5회 coverage·ZIP/XML reopen·결정성·종료 증명 통과, exporter max G65/H77ms. Full run2의 도달 범위와 구분 |
| Fresh D World Graph viewport 경합 | 원본88조건과 V4 center 덮임을 진단으로 확인(acceptance=false). `36cbf72`의 좁은 수정·회귀 RED→GREEN2/관련21테스트/typecheck **PASS**. 수정 후 development/fresh actual·새 exact full **PENDING** |
| 현재 후보 unpacked package | `51c1e6c` full run2의 중첩 `package:unpacked` **PASS**. Same-run receipt·source join과 선택 파일 inventory101개/233244993bytes를 보존. 후속 standalone fresh PASS가 full FAIL을 바꾸지 않음 |
| 사용자 소유 AI 실제 검증 | `51c1e6c` development·packaged 양쪽 **PASS_LOOPBACK_ACTUAL_WITH_DIAGNOSTIC_WARNING**. General-copy 무변이·exact selection apply·Undo/Redo·save/reopen 통과. Exact `MADI_OK` false, keyless/clipboard interception/loopback 범위 유지 |
| 수정 후 최종 Windows gate | **PENDING**. 새 viewport 후보의 같은 exact source에서 필수 6명령·development/fresh actual과 AI 경로를 검증해야 함 |
| Phase 1H / Phase 1I | H 최종 **WITHHELD**, I aggregate Windows **PENDING**. Source51의 개별 development/fresh·AI 성공과 전체 실패를 함께 기록 |

run1은 Desktop 663 PASS·3 FAIL로 종료했다. 두 timeout과 COSE 5초 초과를 실제 실패로 보존한다.
run2의 Desktop 666 PASS와 development basic·D·E·F PASS는 전체 `verify` 성공을 뜻하지 않는다.
G의 product quit lifecycle 관측과 모든 export 완료는 orphan 종료 proof나 G 전체 성공을 대신하지 않는다.
기존 G orphan timeout의 PID 재사용 인과와 종료 진단 7건의 직접 원인은 미확정이다.
새 G actual 성공은 해당 커밋의 증거이며 과거 실패를 지우지 않는다.
`b21827a`의 G/H 개별 PASS는 full verify PASS를 뜻하지 않는다. 이 실행의 Desktop 103파일·678테스트와
development 전체 성공은 보존하되 package 준비 실패와 fresh 미도달을 함께 기록한다.
재현된 Windows sharing violation은 별도 native 진단의 결과다. 최초 full 실패의 구체 파일 작업이나
PID 재사용 인과를 이 결과로 확정하지 않는다. 전체 mutation의 무조건 재시도는 하지 않는다.
`4463d7a` 수정 worktree의 잠금 해제·영구 previous-backup 잠금 테스트를 실제 Windows에서 실행했다.
영구 잠금 시 canonical bytes·revision·두 백업 불변과 잠금 해제 뒤 같은 revision 저장을 확인했다.
최종 오류 분류 테스트는 컴파일러 object 삭제 I/O32로 두 번 미도달한 뒤, 명령 process의
`CARGO_INCREMENTAL=0` 환경에서 2개 모두 통과했다. 이 설정은 증분 컴파일 cache만 끄며
새 후보의 native 검사도 같은 환경을 명시해 실행한다. 원인이나 시스템 보안 설정은 추정·변경하지 않는다.
HWPX 반복 조회 수정은 오류 표시를 보존했다. 별도 narrow 진단은 custom preset stale 오류의
고정 throw 위치에 매칭했으며 acceptance는 false다. 후속 native 재현은 같은 설정의
Core `f64` JSON 표기와 JS 숫자 재직렬화의 hash 차이를 확인했다.
저장 형식과 Core hash 검증을 유지하고 main의 중복 JS 재해시만 정정한다.
Native 재현은 실제 전체 H gate나 수정 후 성공의 근거로 확대하지 않는다.
`76f7daf`의 후속 실패는 제품이 출력하는 scope·node ID·revision을 함께 검사하지 못한
Markdown harness 기대값 불일치다. 전체 줄의 exact 검사로 정정하며 다른 gate 조건은 유지한다.
`66e9c2d`에서 scope·node ID·revision 전체 줄 검사를 반영했다. 관련 service 20테스트,
smoke 구문·format·diff 검사 PASS이며 `55d1d45` 후속 development actual은 통과했다.
spellcheck window preference는 constructor 단위 증거로 구분하고, 실제 session 상태와 network 관측은 runtime evidence로 판정한다.

`51c1e6c` run1 뒤 readiness diagnostic은 33.411초/acceptance=false였고, 원본 stock D 두 번은
34.231/34.988초에 통과했다. 이 성공으로 run1의 messageLength71 실패를 성능 기준 실패나
특정 timeout으로 단정하지 않는다. Run2의 messageLength88은 별도 V3에서 실제 selected canvas
위치가 height503 밖인 상태로 재현했다. V4는 ANIMATE14/VIEWPORT332와 center 목표로 이동한 뒤
반복 viewport 적용에 의해 되돌아가는 journal을 보존했다. V4의 실패 화면은 alpha0으로,
그 실행의 alpha false-negative 인과는 지지하지 않는다. 진단은 모두 NOT_GATE이며 수정 후 actual 효과는 미검증이다.

Full run2 host는 같은 clean source, job2156/cleanup active1, owned-job 강제 종료 후
job empty·handle/desktop 정리, Input Default10011 samples를 기록했다. 후속 standalone E/F/G/H와
AI host는 active0/no forced job termination이었다. 개별 제품 종료 proof와 host 정리를 구분한다.
Source51 package build receipt의 sidecar4·bridge4 SHA/bytes가 inventory와 일치했다.
Inventory 자체는 acceptance=false/freshness 추정false이며 actual workflow 증거를 대체하지 않는다.

고정 도구는 Node `26.3.1`, pnpm `11.9.0`, Rust `1.97.1`, .NET SDK `10.0.400`을 사용한다.
Windows MSVC·SDK와 x86 .NET runtime을 갖추고 `.tools/run-pinned.ps1`로 실행한다.
현재 Rust build는 1개로 제한하고 Desktop Vitest worker는 2개로 제한한다.
Actual은 소유한 비활성 Win32 desktop에서 실행하며 화면 전환 없이 `UOI_IO=false`를 확인한다.
Input desktop 관측에는 `Default`와 unknown이 있으므로 모든 관측이 `Default`였다고 표현하지 않는다.
실행별 격리·입력 관측·cleanup을 개인정보 없는 evidence에 그대로 보존한다.

## 남은 작업과 완료 조건

| 순서 | 작업 | 완료 조건 |
| --- | --- | --- |
| 1 | World Graph 수정 후보의 actual과 full Windows gate | 구현·focused 회귀 성공을 새 exact 후보의 D actual에서 확인하고 필수 6명령·동일 source의 development/fresh actual 통과 |
| 2 | 새 후보 사용자 소유 AI 실제 경로 확인 | Source51 양쪽 성공을 새 후보로 이전하지 않고 승인한 provider/range에서 development·fresh 양쪽 검증; warning·전송 경계 기록 |
| 3 | 결과와 계획의 최종 동기화 | 명령별 commit·환경·exit, 실제 coverage·hash·network·cleanup·성능을 기존 결과 문서에 기록하고 이 계획의 상태를 갱신 |

실패가 재현되어 좁은 수정이 필요하면 main의 작은 commit으로 처리하고 새 후보의 필수 gate를 다시 실행한다.
명령과 build의 source SHA를 일치시키며 과거 후보의 PASS를 새 후보의 PASS로 옮기지 않는다.
진행 중·중단·부분 성공을 전체 성공으로 합치지 않는다. 실제 evidence가 확보될 때만 판정을 갱신한다.

### 필수 명령

AGENTS.md의 필수 경로는 다음과 같다. 각각 실제 exit와 대상 commit을 기록한다.

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm package:unpacked
pnpm check:repository
pnpm format:check
git diff --check
```

### 실제 제품 gate

- 일반·675,000자 원고의 development 및 fresh-unpacked Electron workflow를 완료한다.
- exact source·block·Unicode character coverage, ZIP/XML reopen과 deterministic hash를 확인한다.
- cancel·실패·종료 cleanup, no-clobber recovery와 실제 성능 조건을 확인한다.
- 명시적으로 호출한 사용자 소유 LLM 요청 외 external runtime request는 0이어야 한다.
- runtime session spellcheck disabled·language 0과 network 관측을 실제 evidence로 확인한다.
- AI 검토·복사의 무변이, 정확한 단일 블록 선택 수정·Undo를 실제 연결에서 확인한다.
- stale·Unicode·IME 보호의 단위/WASM 증거와 실제 연결에서 수행한 범위를 구분해 기록한다.

## 결과 문서와 과거 기록

[AGENTS.md](AGENTS.md)는 작업·검증 규칙, 이 문서는 현재 작업 순서,
scope·architecture·format·ADR 문서는 상세 계약, RESULT·성능·감사 문서는 해당 시점의 근거를 관리한다.
과거 실행과 수정의 상세 이력은 기존 결과 문서 및 삭제하지 않은 Git history에 보존한다.

- 집필·복구·설정: [Phase 1A](docs/PHASE_1A_RESULT.md), [1B](docs/PHASE_1B_RESULT.md), [1C](docs/PHASE_1C_RESULT.md).
- 기획·읽기·EPUB: [Phase 1D](docs/PHASE_1D_RESULT.md), [1E](docs/PHASE_1E_RESULT.md), [1F](docs/PHASE_1F_RESULT.md), [1G](docs/PHASE_1G_RESULT.md).
- HWPX·HWP와 실제 성능: [Phase 1H](docs/PHASE_1H_RESULT.md), [HWPX 성능](docs/HWPX_EXPORT_PERFORMANCE.md).
- 좁은 사용자 소유 AI: [Phase 1I](docs/PHASE_1I_RESULT.md), [현행 범위](docs/PHASE_1I_SCOPE.md).
- Typie 고정 원본: [pin·patch 문서](docs/TYPIE_PINNING_AND_PATCHES.md), [license 상태](docs/TYPIE_LICENSE_STATUS.md).

Typie upstream 404와 초기 도구·원본 부재는 당시 실패로 유지한다.
복구한 원본은 `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`,
tree `961dd937e8cc64514afab75c54501195394caeef`이며 기존 runtime·patch hash를 유지한다.
`5cd2b3c`의 복구 후 단위/build, `27054e8`의 CLI integration,
`102f810`의 package, `818dbf0`의 Desktop 성공 등은 각 실행의 대상 SHA에 한정한다.
초기 부분 baseline과 이후 실제 실행을 현재 후보 전체 성공으로 재분류하지 않는다.

## 사람의 수동 검증과 배포 경계

Windows native Korean IME는 사람이 [체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md)를 완료하기 전까지 **MANUAL VALIDATION PENDING**이다.
Hancom security module·Automation 이용조건과 실제 HWP 변환·reopen은 사람의 승인·검증이 필요하며 그 전까지 변환은 비활성으로 유지한다.
Typie 개발 permission은 owner-confirmed다. Release는 저장소 밖의 실제 grant 범위를 확인하며 권한을 추정하지 않는다.
Runtime EPUBCheck/JRE packaging과 installer·signing·update 등 distribution 작업은 별도 release gate다.
Private-local 기술 검증의 성공은 공개·유료·고객·installer 배포 승인으로 표현하지 않는다.

## 계획 갱신 규칙

작업 전 현재 후보와 완료 조건을 읽고, 종료 후 실제 실행 결과와 남은 실패를 이 문서에 반영한다.
원고·prompt·응답·키·private path를 로그나 공개 evidence에 남기지 않는다.
상세 근거는 기존 결과 문서에 연결하고 별도의 phase roadmap이나 경쟁 실행 계획을 만들지 않는다.
