# 오프라인 검사·portable 배포 준비 검증 결과

기록일: 2026-10-08. 현재 기본 Mono UI 제품 source: `d96bd0f50e45c9e999cd360a58e2c49d9a6b047c`.
현재 UI·전체 Windows gate·실제 AI 결과는 아래 d96 절을 따른다. 직전03의 회색 구현과 이전 b9 UI·full·AI, f2의 full·ZIP·AI·자연 종료, 문서 source `65936f254be025472db1c3df85a5ac30d3d876db`의 검수는 해당 revision의 근거로 보존한다.
후속 문서 commit은 이 실행 기준과 구분한다. 현재 계획은 [PLANS.md](../PLANS.md)에서만 관리한다.

## 현재 판정

```text
Exact d96 full pinned npm Windows: PASS / exit0 / 4277.253s
Development and fresh-unpacked Basic/D/E/F/G/H: PASS
Offline EPUBCheck/JRE and HWPX: PRIVATE LOCAL TECHNICAL GO
Exact d96 default Mono packaged UI: PASS / harness72.370s / host74.069s / source and whole package joined
Exact d96 actual AI UI: PASS WITH DIAGNOSTIC WARNING / probe23.974s / host33.783s
Current d96 unpacked: VERIFIED / 556 files / whole inventory join PASS
03 grayscale UI: PRIOR REVISION EVIDENCE / DEFAULT MONO REQUIREMENT NOT SATISFIED
b9 UI / full / actual AI: PRIOR REVISION EVIDENCE
f2 portable ZIP / AI / plain close / IME report: PRIOR REVISION EVIDENCE
Binary HWP / Hancom bridge / .NET requirement: REMOVED FROM PRODUCT SCOPE
Native Korean IME15: NOT TESTED
HWPX layout: HUMAN VALIDATION PENDING
Public/paid/customer/installer distribution: NOT APPROVED
```

아래 이전 본문은 각 source·환경에 묶인 역사다. 과거 HWP WITHHELD·환경 blocker·pnpm 명령을 현행 기능이나 TODO로 해석하지 않는다.
현재 HWPX 내보내기는 한컴 설치와 독립적이다. 이전 ZIP·직접 자연 종료·IME report의 근거는 마지막 f2 절을 따른다.
Typie 개발 permission은 owner-confirmed이며 배포 범위는 저장소 밖 exact grant를 따른다.
실증은 이 PC의 개발판·fresh unpacked에 한정하며 다른 깨끗한 PC나 installer 설치 검증은 수행하지 않았다.

## 2026-10-08 exact source d96 원본 기본 Mono와 검증

제품 source는 `d96bd0f50e45c9e999cd360a58e2c49d9a6b047c`다. 아래 install·full·UI·AI와 최종 join은 같은 source의 전후 main/clean에서 수행했다. 후속 문서 commit은 이 제품 source와 구분한다.
소유자의 정정에 따라 일반 grayscale 구현을 `neobrutal-ui` reference `b4da2463fe710a77bf464c65125a1a7f40424722`의 [기본 Mono](https://github.com/andongmin94/neobrutal-ui/blob/b4da2463fe710a77bf464c65125a1a7f40424722/registry/src/data/colors.ts)로 바꿨다.
Primary/선택은 `#27282b`/`#f4f5f7`, neutral 입력/sidebar는 white/black, card/outline은 `#f4f5f7`/black이다. 검정 shadow4px·radius5px·hover 이동3px/shadow1px·active 이동4px/shadow0과 원본 error/destructive 의미색을 적용했다.
폐기한 accent-soft 경로를 제거했다. Pretendard·사용자 작품색·Reader/출판 preset·원고/저장/AI 계약은 유지했고 npm 의존성은 추가하지 않았다. Graph8종의 데이터색을 원본 chart5색에 임의 대응하지 않았다.

Pinned Node24.21.0/npm12.2.0/Rust1.97.1·committed lock의 `npm ci`는 실제 PASS15.912초/exit0이다. Install audit16건(5 moderate·7 high·4 critical)을 보존하며 취약점 해결이나 CI workflow 실행을 주장하지 않는다.
Fast `npm run package:unpacked`는 host PASS11.831초/exit0이고, 이후 전체 `npm run verify`에서도 fresh unpacked를 새로 만들었다.
`full-default-mono-verify-d96bd0f-run1`은 **terminal PASS4277.253초/exit0**다. Desktop102파일/714테스트·별도 bundle1파일/4테스트, repository·format·typecheck·Rust·Typie·integration·build·오프라인 EPUBCheck/JRE와 개발판/fresh-unpacked Basic/D–H를 완료했다. Bundle4는 unique714에 더하지 않는다.
HWPX 장편 각5회 exporter max는 개발판881ms/배포판89ms로15초 target을 통과했다. 이는 native exporter 시간으로 IR 준비·UI wall·사람의 서식 승인이 아니다.
Full은 job3,059 processes/cleanup active0·force0·desktop 제거다. 입력8,427표본 모두 Default/owned inactive·이름 조회 불가0이며 이름/비활성 flag 관측이 완전했다. 이전03의 조회 불가5회는 그 run의 별도 역사로 보존한다.

`ui-review-default-mono-d96bd0f-run1`은 **harness PASS72.370초·host PASS74.069초/exit0**다. Upstream9파일·contract·helper hash를 전후 확인하고, 실제 computed token12개·root paint2개·선택 색상쌍을43회 검증했다. 기존 grayscale checker는 실행하지 않았다.
Binder·mode·panel·Story kind/entity·publication tab·Reader pane tab·active Scrivenings의8종 선택을 실제 관측했다. 주요 버튼 rest/hover/active는 shadow4/1/0px·이동0/3/4px이고 disabled도 shadow4/이동0을 유지한다. Pointer-up은 버튼 밖에서 하고 원래 parking 위치를 복원해 실제 저장/new-project click을 유발하지 않았다.
Computed primary 대비는13 이상이다. 이는 disabled opacity 합성 대비나 모든 component/destructive 버튼의 상태 검증을 뜻하지 않는다. 관측한 저장 phase는 `saved`뿐이며 모든 phase나 작품색/preset 본문을 검사한 것으로 확대하지 않는다.
1440×1000·1180×820·980×720·880×620에서40 layout/40 main-row·폰트10회·57PNG·Graph/Canvas8회·Canvas zoom4회를 기록했다. 작업 패널 닫기·focus·hover·활성 Scrivenings와 선택 복원을 통과했다.
PNG8장을 별도 시각 검수했다. Drawer는 기존330px overlay이고 Reader880은 내부 scroll이 필요하다. Drawer를 연 상태의 모든 콘텐츠 동시 노출이나 임의 node/label의 일반 보증으로 확대하지 않는다.
새 작품·장면2개·한글 집필·Undo/Redo·인물/POV·치환·Reader2pane·EPUB/HWPX ZIP/XML 재열기·앱 재시작·EPUB360/960px overflow0을 확인했다. Read-only SQLite schema와 UI 상태 외19테이블 전체 row가 네 지점에서 일치했다. 물리 `.madi`/`ui_state` hash 불변은 주장하지 않는다.
UI host147표본 모두 Default/owned inactive·이름 미가용0, job79/active0·force0·desktop gone이다. 두 session의 관측 renderer HTTP/WS·main fetch·default-session 외부 요청·page error는0이다.

UI 전과 Full 후의 완전 inventory가556파일/80디렉터리/551,939,563B로 실제 deep equality다. AI 전후 및 최종 현재 package tree도 일치했다. Canonical SHA는 `ec47c66f4bef4313e3acd2decbe7ffb6b832b2e400894106f010fb4514067c3a`다.
최종 join은 **PASS_EXACT_SOURCE_WHOLE_PACKAGE_JOIN**이다. 새 portable ZIP은 만들지 않았다. 이전 ZIP·inventory·RUNNING snapshot을 현재 배포본이나 현재 terminal PASS로 바꾸지 않는다.

`ai-ui-default-mono-d96bd0f-run1`은 **host PASS33.783초/exit0·actual probe23.974초**다. 기존 Qwen3-0.6B-Q8_0/llama CPU를 소유 loopback18143·threads2/batch2·GPU0·context2048로 잠시 실행했다.
제공자·진단·제안·선택 수정4화면×1440/880px의8PNG·geometry8회·버튼52개·폰트4회를 확인했다. 요청별 동의·검토 전 canonical 불변·exact same-block 적용·Undo/Redo·저장·재열기가 통과했다.
실제 제공자 응답이 진단 기대문구 `MADI_OK`와 달라 **PASS_LOOPBACK_ACTUAL_WITH_DIAGNOSTIC_WARNING**/`UNEXPECTED_RESPONSE`를 유지한다. 경고1개·문구61자를 기록하고 응답 원문은 로그에 남기지 않았다.
승인 loopback main fetch3건·재열기0건, 기타 관측 요청/WS·unapproved main fetch·default-session 외부 요청·page error0이다. 관측 범위는 instrumentation부터 pre-close이며 전체 process TCP/UDP 감사·remote HTTPS·인증키·OS clipboard·native IME 검증이 아니다.
두 앱의 ordered product quit·Core 소멸·wrapper exit/close0·force0을 확인했다. `naturalMainProcessExitProven=false`/`nativeExitCodesObserved=false`를 유지한다. 소유 server는 SIGTERM/null exitCode로 종료됐고 임시 directory를 제거했다.
AI host66표본 모두 Default/owned inactive·이름 미가용0, job92/active0·force0·desktop gone이다. AI preparation의 원본16파일·새 boundary literal·실행/보관 helper의 byte/hash를 최종 join에서 연결했다.

첫 `28f96d5d` join은 UTF-16LE BOM `FF FE`의 full log를 UTF-8로 해석해 line95의 Phase1H lookup assertion에서 exit1로 실패했다. 제품·runtime 결과는 바꾸지 않았고 결과 파일 작성 전 멈췄다.
실패 receipt와 helper를 보존했다. 새 `68cc2c66` helper는 BOM·짝수 byte 길이를 확인하고 UTF-16LE로 해석하며 기존 PASS·coverage·source/package/isolation·cleanup 조건을 유지했다. 실제 최종 join만 완료 판정으로 사용한다.

| 원본 근거 | 저장소 상대 경로 / 실제 SHA-256 |
| --- | --- |
| Install host | `.tools/verification/frozen-install-default-mono-d96bd0f-run1/metadata.json`; `4a6026840f25a7f7b45496ef2401be1a5dd7c3fe9efdeed1f3d033ac0e05d12d` |
| Full host / log | `.tools/verification/full-default-mono-verify-d96bd0f-run1/metadata.json`; `148961af689f31bc3c15b5970d294c3301363d056a9657ca558a71d81330aacd`; log `cb5bc0e94564cf2f8d01b03833dad5dc6b2de422b4535fa9b3d59895a90b9675` |
| UI actual / host | `.tools/verification/ui-review-default-mono-d96bd0f-run1/ui-review-evidence.json`; `91ca5af7e5c56325a70b86220cbd48d1d50744f8497846b8650758452f78c1b7`; host `342c93c131a264d2d641e475691b7ea8f757033dcb6a9ce0a858d464b3cd1488` |
| AI actual / orchestrator / host | `.tools/verification/ai-ui-default-mono-d96bd0f-run1/llm-loopback-runs/packaged-5e828e9d-079a-4db1-81de-80560a7b2dc0/actual.json`; `1b4aabdf90532111bfe57d21fd9e573aec74c26029319e0c02428672133610b0`; orchestrator `94e6f24a41d8af0549d0a9c37273c0c1da7b7581b2b6a02594bbc6701d11acf8`; host `420fa4f320eef7b61995c02fa389b24e129ec707b1fcee344309cd7a37da824a` |
| Exact package join | `.tools/verification/full-default-mono-verify-d96bd0f-run1/final-default-mono-package-join.json`; `8318bd5896f9eda3bdde9736c13dea0f7be74792d7296fad79dc5bc43f4e7825` |
| Join parser failure | `.tools/verification/default-mono-join-failure-28f96d5d-1eb63a99-7758-4fb2-872e-f6c50b231156.json`; failed helper SHA `583c3bc12ed395c3e6fc8520d88e7c94463c3b02bf0dede53e5d4df8e59fe0fb`; corrected helper SHA `a8e7db44d246459534e2c7dbceb7cfbda7cbc5aae6757bd59387d8be81e8bf4c` |

## 2026-10-08 exact source03 모노톤 UI와 검증

이 절의 일반 grayscale 구현은 소유자의 기본 Mono 요구를 충족하지 못했다. 아래 기술 검증은03 revision의 실제 결과로 보존하며 현재 디자인 완료 근거로 사용하지 않는다.

제품 source는 `03e44d8e3d2e8c506534d02e17065da4cb39106b`이며 아래 실행은 source 전후 같은03/clean이다. 후속 문서 commit은 이 제품 source와 구분한다.
공통10색상 token·저장 상태dot·AI backdrop와 Graph/Canvas 기본 장식색을 흰색·회색·검정으로 바꿨다.
굵은 테두리·단단한 그림자·Pretendard·기존 배치/동작을 유지한다. 원고·저장·AI 계약을 바꾸거나 npm 의존성을 추가하지 않았다.
Graph8종 기본node·기본edge fallback·선택/인접/텍스트 배경과 Canvas 기본edge/label은 grayscale이다. 사용자 named-token/hex/Canvas1~6 해석과 canonical 색상은 유지한다.
Reader shadow preview의 장식chrome·focus·선택을 neutral/currentColor로 바꿨다. Reader LIGHT/DARK/SEPIA/CUSTOM과 출판 preset의 색상·출력 계약은 유지한다.

Pinned Node24.21.0/npm12.2.0/Rust1.97.1과 committed lock을 사용한다. `npm ci`는 실제 PASS26.208초/exit0,306 packages 설치다.
Install의 npm audit16건(5 moderate·7 high·4 critical)은 보존한다. 취약점 해결이나 CI workflow 실행을 주장하지 않는다.
`full-mono-verify-03e44d8-run1`은 **terminal PASS4181.694초/exit0**다. Desktop102파일/714테스트·별도 bundle1파일/4테스트를 통과했다. Bundle4는 unique714에 더하지 않는다.
`npm run verify`의 repository·format·typecheck·Rust·Typie·integration·build·오프라인 EPUBCheck와 개발판/fresh-unpacked Basic/D–H를 완료했다. `package:unpacked`도 full 안에서 새로 실행했다.
Repository13 artifact pins와 format290파일/whitespace0/invalidJson0을 확인했다. HWPX 장편 각5회 exporter max는 개발판626ms/배포판69ms로15초 target을 통과했다. 이는 native exporter 시간이며 UI wall이나 사람의 layout 승인이 아니다.

Full은 소유 비활성 Win32 desktop·BelowNormal·job에서 실행했다. Job3,251 processes/cleanup active0·강제 job 종료0·handle 정리·desktop 제거를 확인했다.
입력8,224표본의 owned desktop 비활성 flag는 모두 true다. Input name unavailable5회(Win32 error5)도 독립 flag에서 owned inactive5회로 확인했다.
이름 관측은 Default→Screen-saver→Default이며 `inputNameAvailabilityComplete=false`/`inputDefaultEverySample=false`/`allowedActiveInputEverySample=null`을 보존한다. 모든 표본의 이름이 Default였거나 unknown0이라고 표현하지 않는다.

`ui-review-mono-03e44d8-run1`은 **harness PASS65.427초·host PASS67.798초/exit0**다. 1440×1000·1180×820·980×720·880×620의40 layout/40 main-row·폰트10회·54PNG를 기록했다.
실제 computed 공통10 tokens+root text/background2개와 현재 표시된 toolbar·선택chrome·저장dot에서 RGB채널 일치를42회 확인했다.
관측한 저장 phase는 `saved`뿐이다. 모든 save phase를 실증했다고 확대하지 않으며 사용자 Graph/Canvas 색상과 Reader preset 본문은 neutral assertion에서 제외한다.
Graph/Canvas8회 실제 노드 검사와 Canvas zoom4회·작업 패널 닫기·focus·hover를 통과했다. Graph는 RGB[115,115,115]의 최대8연결 component로 body 범위를 추정해 회색 antialias label 오염을 줄인다.
원형 ratio0.85~1.15·fill0.5·전체 bounds/clip·9hit·viewport250×120 조건을 유지했다. 이는 UI fit·선택을 수행한 합성 CHARACTER1개 시험이며 임의 label·다중node·모든 형상의 일반 보증이 아니다.
새 작품·장면2개·한글 집필·Undo/Redo·인물/POV·치환·Reader2pane/본문 이동·EPUB/HWPX ZIP/XML 재열기·앱 재시작과 출력 EPUB360/960px overflow0을 통과했다.
Read-only SQLite schema와 UI 상태 외19테이블 전체 row가 네 시점에서 일치했다. `ui_state`와 물리 `.madi` byte hash는 달라지며 format 계약상 불변 조건이 아니다.
두 session의 renderer HTTP/WS·main fetch·default-session 외부 요청·page error는 instrumentation부터 pre-close 관측 범위에서0이었다. 전체 process TCP/UDP 감사는 아니다.
Ordered product quit·Core 각1개 종료·wrapper 전 owned native0·wrapper exit/close0·force0을 확인했다. `naturalMainProcessExitProven=false`/`nativeExitCodesObserved=false`를 유지한다.
UI host134표본은 Default/owned inactive·이름 미가용0, job79/cleanup active0·host force0·desktop gone이다.

Full 이후 두 번 읽은 fresh package 전체 inventory는556파일/80디렉터리/551,929,597B이며 UI·AI 검수 전후 tree와 실제 deep equality로 연결했다.
Canonical inventory SHA는 `f4ba3085db9115e00dbeaead06ad13031b26b2cabc25a10eca2aa3998aa8e5c1`이다. Exact source/full/UI/AI join은 `PASS_EXACT_SOURCE_WHOLE_PACKAGE_JOIN`이다.
새 portable ZIP은 만들지 않았다. 이전 f2 ZIP이나 b9의 package inventory를03 배포본으로 표현하지 않는다.

`ai-ui-mono-03e44d8-run2`는 **host PASS31.278초/exit0·actual probe22.196초**다. 기존 Qwen3-0.6B-Q8_0/llama CPU를 소유 loopback18143·threads2/batch2·GPU0·context2048로 잠시 실행했다.
제공자 설정·진단·제안·선택 다듬기4화면×1440/880px의8PNG·geometry8회·관측 버튼52개·폰트4회를 통과했다.
요청별 명시 동의·검토 전 canonical 불변·exact same-block 적용·Undo/Redo·저장·재열기를 확인했다. 제공자 설정은 canonical 원고와 분리한다.
`PASS_LOOPBACK_ACTUAL_WITH_DIAGNOSTIC_WARNING`을 유지한다. 실제 provider 응답을 받았지만 진단 기대문구 `MADI_OK`가 아니어 `UNEXPECTED_RESPONSE` 경고1개가 발생했다.
첫 session의 승인 loopback main fetch3건·재열기0건, 그 외 renderer HTTP/WS·default-session 외부 요청·unapproved main fetch·page error0을 instrumentation부터 pre-close까지 관측했다.
Remote HTTPS·인증키·OS clipboard·native IME·AI whole-process TCP 감사는 검증하지 않았다. 두 앱의 ordered quit·Core 종료·wrapper exit/close0·force0은 main 자연 exit/native exit-code 증명이 아니다.
소유 llama server는 SIGTERM/null exitCode로 종료했고 임시 directory를 제거했다. Host62표본은 Default/owned inactive·이름 미가용0, job92/active0·강제 job 종료0·desktop gone이다.

이전 `ai-ui-mono-03e44d8-run1`은 before-model boundary에서 **COMMAND_FAILED1.517초/exit1**이었다. 이전 b9 requiredSource pin에 새03 expectation을 전달해 contract 검사에서 멈췄으며 원본 실패를 보존했다.
새 copy는 `ai-ui-boundary.mjs`의 requiredSource literal만 b9→03으로 바꿨다. 원본 전체 bytes·model/provider/resource pins·source/package/isolation/cleanup guards를 유지했다.
준비 receipt의11 syntax 검사 PASS는 runtime acceptance가 아니다. 실제 runtime 결과는 별도 run2다. 실패 run1도 job11/active0·force0·desktop 제거를 확인했다.

| 원본 근거 | 저장소 상대 경로 / 실제 SHA-256 |
| --- | --- |
| Install host | `.tools/verification/frozen-install-mono-03e44d8-run1/metadata.json`; `0395bf9ef4c9f3a448b01af82094f05914da0fbe240caed2dcd5b0e1e75fcdbb` |
| Full host / log | `.tools/verification/full-mono-verify-03e44d8-run1/metadata.json`; `e90c869c808981363dc826188a693618926e1f7a083bf018e76981d7a77e04bd`; 같은 run의 `command.log`; `554fb4372d79f2dcb0171cf694932422ee51cbcb01b35bea78f5fc4b93c8f34d` |
| UI actual / host | `.tools/verification/ui-review-mono-03e44d8-run1/ui-review-evidence.json`; `e922967f31d6f7addbb8b49fa46f4cc326bb3fbd5d27b9dd586de1b0cd68b11b`; host `5b71de247314dfbcd81730da9bd0c57bc6f7c8d67254780702376e11c9096c82` |
| AI actual / orchestrator / host | `.tools/verification/ai-ui-mono-03e44d8-run2/llm-loopback-runs/packaged-15868649-272a-4e91-9a55-99d0c422aaba/actual.json`; `520a526b8005a6d04e128ccfe04866ce1464a3d8be1207a85746ba4186e31298`; 같은 folder의 orchestrator `71f81d92198b9bbf04365f8074a3bb4d0191c5e377bd469ab41148756fd521f6`; host `28ec6ce25f32ebcc5d37364a4b0adff96bc46c8267bd4ec96c83ab58f6f1b00e` |
| Exact package join | `.tools/verification/full-mono-verify-03e44d8-run1/final-monochrome-package-join.json`; `e2971d6d96cc57dd0da6938902d3cbe1f2fe6ae4b9c7c2c786f735b2c7d73f2b` |
| AI prior failure / preparation | `.tools/verification/ai-ui-mono-03e44d8-run1/metadata.json`; `ebbb99d5ecd2ed00d03133f49cd77613bee6f12f55ada42f90580b0f2d18de29`; `.tools/verification/ai-ui-monochrome-prepared-0229a3cb-6d71-4358-9db0-21b3f2e02ab1/preparation-monochrome-ai-ui-receipt.json`; `1048a7dae78d931fda3b6dd541b26af21028310dcd26d201c39decbda20509b7` |

실행 자료와 합성 문서는 local-only로 보존한다. Windows native IME15항목·사람의 HWPX layout·exact grant에 따른 공개/유료/고객/installer 배포 승인 조건은 그대로 남긴다.

## 2026-10-07 exact source b9 UI 개선과 검증

소유자 요청의 [neobrutal-ui](https://github.com/andongmin94/neobrutal-ui) reference `b4da2463fe710a77bf464c65125a1a7f40424722`를 참고했다.
굵은 검정 테두리·단단한 그림자·라임 강조색·hover/press/focus 상태를 기존 React/CSS 공통 토큰에 반영했다.
집필·설정·그래프·캔버스·Reader·EPUB/HWPX·AI 화면을 통일하고 작업 패널 닫기를 추가했다.
작은 창의 main grid·출판 wrapper·그래프 높이·캔버스 공간을 고쳤다. React Flow Controls overlay를 제거하고 확대·축소를 기존 도구 모음으로 옮겼다.
이전 Binder inline 선택색·obsolete responsive 경로·대체된 Nanum 자산을 제거했으며 npm 의존성을 추가하지 않았다.

### 오프라인 Pretendard

공식 Pretendard v1.3.9/upstream `5c41199ea0024a9e0b2cb31735265056e5472d76`를 사용한다.
기본 UI의 variable WOFF2는2,057,688B/SHA `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4`다.
App protocol의 WOFF2 MIME·GET/HEAD bytes·허용 경로를 실제10테스트로 확인했다. 폰트 CDN이나 런타임 다운로드는 사용하지 않는다.
Canvas 원고도 실제 Pretendard Regular TTF에서 만든 Typie 자산을 사용한다. 원본은2,725,828B/SHA `6d0af5258997aec7354a6e340fc2325ba321c410ca48b3af858c8c3d6e92a324`다.
같은 pinned Typie `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`의 Rust font API로 생성했고14,336 codepoints/한글 완성형11,172자를 확인했다.
생성 receipt SHA는 `871792559f71a5940a99d856fe37ae9139deffcefad0a34fa7fd29d4b50555c7`이다.
이 checkout의 기존 JS 재생성 명령에는 별도 vendor editor-server JS/WASM prerequisite가 필요하므로 standalone 재생성 성공을 주장하지 않는다.
저장 format의 FontFamily/FontWeight 계약은 유지하며 Publication preset의 사용자 선택을 바꾸지 않았다.
OFL·reference MIT와 provenance는 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) 및 bundled notice에 기록했다.

### 최종 전체 Windows gate

`full-ui-verify-b9aa3e7-run1`은 **terminal PASS4192.837초/exit0**다.
07:58:41.3782155→09:08:34.2067443 UTC, source 전후 같은 b9/clean이다.
Pinned Node24.21.0/npm12.2.0/Rust1.97.1과 committed lock을 사용했고 이번 UI 작업에서 `npm ci`를 실제 실행했다.
`npm run verify`의 repository·format·typecheck·build·Rust·Typie·integration·오프라인 EPUBCheck와 개발판/새 unpacked Basic/D–H가 실제 완료했다.
Desktop102파일/714테스트와 별도 bundle1파일/4테스트가 통과했다. Bundle4를 중복 없는 unique 테스트 수에 더하지 않는다.
`npm run package:unpacked`도 full 안에서 새로 실행했다. HWPX 장편 각5회 exporter max는 개발판888ms/배포판83ms이며15초 target을 통과했다.
이는 native exporter 시간이며 전체 UI wall이나 사람의 layout 승인을 뜻하지 않는다.
Host 입력8,193표본은 모두 Default/owned inactive·unknown0이다. Job3262process/cleanup active0·강제 job 종료0·handle 정리·desktop 제거를 확인했다.
기존 Node DEP0190·Rust linker 경고는 로그에 보존하며 경고 없는 실행으로 표현하지 않는다.

Full 이후 전체 package를 두 번 읽어556파일/80디렉터리/551,929,587B를 고정했다.
Canonical inventory SHA는 `34e65c8959632bbb340e54c5765523f6e4a9fd895cf15e406564839cbdde8c8d`다.
UI run7의 pre-full package와 파일별 bytes/SHA·전체 디렉터리 목록을 실제 deep equality로 연결했으며 AI 검수 전후에도 같은 tree가 보존됐다.
이번 UI 작업에서 새 portable ZIP은 만들지 않았다. 이전 f2 ZIP을 현재 UI 배포본으로 부르지 않는다.

### 실제 UI run7

`ui-review-b9aa3e7-run7`은 source 전후 clean에서 **harness PASS67.113초·host PASS69.599초/exit0**이다.
1440×1000·1180×820·980×720·880×620의40화면/40 main-row 검사, 로컬 폰트10회, screenshot54개를 기록했다.
Toolbar17 controls의 접근·경계·hit와 화면 가로 overflow0을 확인했다. Graph 자동배치·Plot 화면 맞춤 후 네 크기 각각에서 실제 노드 전체 경계·clipping·painted hit를 확인했다.
Canvas zoom controls도 네 크기에서 접근 가능했고1440px 실제 축소→확대로 DOM scale1→0.833333→1을 관측했다.
작업 패널 닫기·키보드 focus·hover도 실제 UI에서 확인했다. 880px의 오른쪽 작업 drawer가 일부 내보내기 폼을 덮는 것은 닫기 가능한 현재 구조다.
모든 폼 필드가 동시에 노출되거나 overlay가 전혀 없다는 범위로 확대하지 않는다.

새 작품·장면2개·한글 집필·Undo/Redo·인물/POV·치환·Reader2pane/본문 이동·EPUB/HWPX ZIP/XML 재열기·앱 재시작을 통과했다.
출력 EPUB의 원본 CSS를360/960px에서 렌더했고 가로 overflow0이다.
Read-only SQLite의 schema와 UI 상태 외19테이블 전체 row가 네 시점에서 일치했다. `ui_state` 및 물리 `.madi` byte hash는 바뀌며 format 계약상 불변 조건이 아니다.
폰트는 실제 loaded FontFace·computed family·same-origin CSS URL·package 자산 bytes/SHA로 확인했다.
Custom scheme ResourceTiming0은 **UNAVAILABLE**로 보존하고 실제 요청 성공 근거로 쓰지 않는다.
두 session의 renderer HTTP/WS·main fetch·default-session 외부 요청·page error는 instrumentation부터 pre-close 관측 범위에서0이었다.
두 종료 모두 ordered product quit·captured Core1개 종료·wrapper 전 owned native0·wrapper exit/close0·force0을 확인했다.
`naturalMainProcessExitProven=false`/`nativeExitCodesObserved=false`를 유지한다. Host136 known inactive·job79/active0·host force0·desktop gone이다.

### 실제 AI UI

`ai-ui-b9aa3e7-run1`은 **host PASS34.011초/exit0·actual probe23.790초**다.
실제 기존 Qwen3-0.6B-Q8_0/llama CPU provider를 소유 loopback18143·threads2·GPU0으로 잠시 실행했다.
제공자 설정·진단·제안 검토·선택 다듬기 네 화면을1440/880px에서 검수했고8PNG의 실제 SHA와 기록이 일치했다.
Geometry8회/관측한 버튼52개에서 경계·visible clip·hit·Pretendard를 확인했다. 폰트4회도 실제 loaded FontFace와 고정 자산을 연결했다.
요청별 명시 동의·검토 전 canonical 불변·exact same-block 적용·한 번의 Undo/Redo·저장·재열기를 통과했다.
첫 session의 승인 loopback main fetch3건과 재열기0건을 관측했고 그 외 instrumentation 관측 외부 요청·page error는0이다.
`PASS_LOOPBACK_ACTUAL_WITH_DIAGNOSTIC_WARNING`을 유지한다. 제공자 응답은 실제로 받았으나 진단 기대문구 `MADI_OK`가 아니어 `UNEXPECTED_RESPONSE` 경고가 발생했다.
Remote HTTPS·인증키·OS clipboard·native IME·AI whole-process TCP 감사는 검증하지 않았다.
두 앱의 ordered quit·Core 종료·wrapper exit/close0·force0을 확인했지만 main 자연 exit/native exit-code는 증명하지 않았다.
소유 llama server는 SIGTERM/null exitCode로 종료했으며 정상 exit0로 표현하지 않는다.
Host66표본 모두 Default/owned inactive·job92/active0·강제 job 종료0·desktop 제거를 확인했다.

### 원본 근거와 실패 이력

| 근거 | 저장소 상대 경로 / 실제 SHA-256 |
| --- | --- |
| Full terminal host | `.tools/verification/full-ui-verify-b9aa3e7-run1/metadata.json`; `5cebc5d135ffd3f55f32b5a491d0c18f749f517f153a00346a85b92752912477` |
| Full original log | 같은 run의 `command.log`; `79875489721ceda3b75160c1eff4ac3f9d24c7dd287681a8c091803873f99a23` |
| UI actual / host | `.tools/verification/ui-review-b9aa3e7-run7/ui-review-evidence.json`; `00e50f1fe0da6863fa4c2389ed872d6bfe6a1aeb2d0680a92dfbb75bcf6b9971`; host `caa35f11c4265b94385f49c1301a5469e60ae266cd7207b513903e7b0989656b` |
| Fresh whole inventory | `.tools/verification/ui-package-b9aa3e7-5354916a-9952-4900-954f-37bc61522175/inventory.json`; `adc32c780c97b825af011b660e2978cc2fb7fa9ab3124ff04e823f9f067944b6` |
| Exact source/full/UI/AI join | `.tools/verification/full-ui-verify-b9aa3e7-run1/final-ui-package-join.json`; `281302bb874164fcd7ad2fca68d947662f2935eb25fd09c65fa120e884921e9c` |
| AI host | `.tools/verification/ai-ui-b9aa3e7-run1/metadata.json`; `815ce0159182cf6b8c9110a2ecc310372307be300585e155f50502d230eb059e` |
| AI actual / orchestrator | 같은 run의 `llm-loopback-runs/packaged-e7278328-7bf6-4306-8381-e53ec73b10f3/actual.json`; `b47c69a6d7a65a468258c543cb02eea83d2245e6c021e6d38a2d28c1a3685fed`; orchestrator `23a3f7f774196e8921587c09cedbd5ec4a7e9cc772b75f816bfcb1f76f7d50f6` |

Screenshot·합성 작품·원본 검수 도구는 local-only run에 보존하며 Git에 올리지 않았다. 사용자 작품이나 키를 시험에 사용하지 않았다.
예비 실행도 원본을 덮어쓰거나 최종 PASS로 변경하지 않았다.

| 예비 실행 | 실제 결과와 후속 처리 |
| --- | --- |
| `ui-review-8d943ad-run1` | COMMAND_FAILED12.640초. Custom scheme ResourceTiming을 잘못 요구한 검사; 다음 copy는 실제 FontFace·CSS·asset hash로 확인 |
| `ui-review-02f411f-run2` | host PASS66.206초/harness63.766초. 당시 자동 검사는 노드 노출을 보증하지 못함;880px 캡처의 실제 Graph/Canvas 공간·선택색 수정 |
| `full-ui-verify-1b34564-run1` | 의도적 중단·LAUNCHER_FAILED215.781초/child4294967295. 위 실제 UI 문제 수정 전 gate를 중단했고 사유·owned cleanup receipt 보존; PASS가 아님 |
| `ui-review-0822ed5-run3` | COMMAND_FAILED69.377초. Publication wrapper main-grid 배치 누락으로 닫기 버튼이 화면 밖; wrapper·tabs·독립 scroll 수정 |
| `ui-review-8dd6780-run4` | COMMAND_FAILED29.981초. Status bar 경계6.8px overflow; app-grid minimum width와 footer 축소 수정 |
| `ui-review-d4f3ef7-run5` | COMMAND_FAILED81.424초. 둥근 카드의 투명 모서리에 둔 검사점을 실제 painted 영역으로 보정하되 전체 rect/clipping 조건 유지 |
| `ui-review-d4f3ef7-run6` | COMMAND_FAILED74.316초.980px 실제 카드가 React Flow Controls에 가려짐; product overlay 제거·toolbar zoom 이동 |

최종 b9의 UI run7·full·actual AI는 위 수정 이후 별도 실행이다. 시험은 소유 비활성 desktop에서 실행했으며 사용자 화면·전역 키보드·포커스·OS clipboard·desktop 전환을 바꾸지 않았다.
Windows native IME15항목·사람의 HWPX layout·exact grant에 따른 배포 승인 조건은 그대로 남긴다.

## 2026-10-07 추가 실사용 UI 검수

소유자의 요청으로 `65936f2`까지 원격 `main`에 먼저 푸시한 뒤 새 합성 작품을 실제 앱 UI에서 만들었다.
이 source와 runtime source f2의 차이는 문서7개뿐이며 제품 source diff는 없다.
재빌드 없이 기존 검증 배포본을 사용했고, 검수 전후554파일/80디렉터리/549,229,982B 전체 내용이 고정 inventory와 일치했다.
Canonical inventory SHA는 `4684dd2e03eccb3f0239976ca47ab20c2053afde016ace2567482f3406db172d`다.

최종 `real-use-packaged-65936f2-run4`는 host **PASS46.472초/exit0**, 실제 harness **PASS43.556초**다.
Pinned Node24.21.0/npm12.2.0과 Electron37.10.3/Playwright1.54.2를 사용했다.
파일 선택 dialog만 새 시험 폴더의 경로로 반환했고, 원고·설정·출판 데이터는 page UI에서 작성했다. 실제 native 파일 선택창 조작 시험은 아니다.

| 실제 작업 | 관측 결과 |
| --- | --- |
| 작품·집필 | 새 작품/장면2개, 합성 한글 본문 입력, 추가 편집·Undo/Redo·최종 Undo의 정확한 본문 복원, 저장 |
| 설정·치환 | 인물1개·한 줄 요약·POV 연결1개, 본문1회 선택 치환; 재열기 검색에서 새 문구1회/옛 문구0회 |
| Reader Lab | 두 pane 각각2sections/6blocks 측정 complete·본문 일치·overflow0; 본문 클릭으로 원래 장면 이동, 재열기 유지 |
| 출판 | UI 사전 검사·EPUB/HWPX 파일 생성, ZIP/XML 재열기·parser error0·두 본문 각각1회·옛 문구/U+FFFD0 |
| EPUB 화면 | 출력 원본 CSS·spine 순서로 비활성 desktop의 시험 창에서360/960px 렌더; 본문2개 표시·가로 overflow0 |
| 재열기 | 동일 profile에서 앱을 종료·재시작하고 원본 `.madi` 열기; 작품명·본문·인물·요약·POV·Reader·출판 metadata 일치 |

최종 EPUB은3,033B/SHA `f72333f95b407521b8a241a754e323faed4c048522de2bf2775bf3735f8bcbc3`,
HWPX는4,896B/SHA `011252c0fc1e55b00ac4ee42e0faa692ed4323b90fab3463a8ebd2d63b7c3397`다.
이 작은 작품은 EPUB6entries/spine1/본문 문단2, HWPX9entries/section1이다. 장편 성능·결정성 시험은 기존 full 근거를 따른다.

`.madi` 전체 byte SHA 불변을 원고 불변 조건으로 쓰지 않는다. 현재 format의 `ui_state`는 장면 선택·창 종료 때 별도로 저장된다.
Pinned Node의 `node:sqlite`를 readOnly/query_only transaction으로 열어 `sqlite_schema`와 UI 상태 외19개 table의 모든 row를 비교했다.
첫 종료 전·첫 종료 후·재열기 확인 후·두 번째 종료 후의 content SHA는 모두
`eb537de228cb4b4076397d728e50168203429f3226dbae019fc869d91c038c7f`로 같다.
Schema SHA도 같으며 문서 blob·revision·timestamp·검색 index·snapshot·출판 설정을 비교 범위에 포함한다.
`ui_state`3행의 hash와 물리 파일 hash는 달라졌다. 출력 근거에는 body/row 값을 쓰지 않고 count/hash만 기록했다.

두 앱 session 모두 renderer HTTP/WS·page error·main fetch·default-session external web request 관측0이다.
관측은 instrumentation부터 pre-close까지이며 전체 process TCP/UDP 감사나 native IME 시험을 뜻하지 않는다.
두 종료 모두 product ordered quit·captured Core1개 종료/남은 owned native0을 wrapper 정리 전에 확인했다.
Wrapper exit/close0·force0이며 이 inspector harness의 `naturalMainProcessExitProven=false`/`nativeExitCodesObserved=false`는 보존한다.
Host는 입력91표본/unknown0/owned inactive, job85/cleanup active0·host force0·handles 정리·desktop 제거를 확인했다.
사용자 화면·키보드·clipboard·desktop 전환을 사용하지 않았다. Profile과 합성 문서는 local 검수 자료로 보존했다.

기존 실패도 덮어쓰지 않았다. 모두 같은 제품 배포본을 사용한 별도 검수 스크립트 실행이다.

| 이전 실행 | 실제 실패와 후속 처리 |
| --- | --- |
| run1 | host42.201초/exit1. native select에 대한 exact label 선택자 timeout; 기존 시험과 같은 combobox 접근성 선택자로 별도 copy 수정 |
| run2 | host229.958초/exit1. 추가 hidden EPUB viewer의 screenshot timeout; 원본 결과 보존, 정확한 owned exe/profile에 CDP 연결해 남은 시험 창만 닫음·force0 |
| run3 | host30.959초/exit1. UI·출판·화면·재열기 내용 검증 뒤 잘못된 whole-file SHA 불변 조건 실패. Before logical snapshot이 없어 이 회차의 변경 table 원인은 확정하지 않음 |

run4는 올바른 format 계약에 맞춘 네 시점의 실제 전체 content 비교로 종료했다. 새 제품 수정을 만들거나 과거 FAIL을 PASS로 변경하지 않았다.
시험한 흐름에서 제품 결함은 발견하지 못했다. 원고·Reader·EPUB360/960px screenshot을 직접 확인했으며
이 화면 검수는 전용 e-reader, Windows native IME15항목, HWPX native layout, 공개 배포 승인을 대신하지 않는다.

실제 근거는 [.tools run4](../.tools/verification/real-use-packaged-65936f2-run4/real-use-evidence.json)와
[host metadata](../.tools/verification/real-use-packaged-65936f2-run4/metadata.json)다.
Actual JSON SHA는 `600b07b28138a9887974dd538e6e27f2f736d656fe98a52c77cacbf69cbf2b32`,
host SHA는 `228f4d1070adca03ee07bc3e67eb2c999dff9e454a5b079d826f3c8b23b6e784`다.
Screenshot10개와 합성 `.madi`/EPUB/HWPX는 같은 run의 `artifacts/`에 있고 Git에 포함하지 않았다.

## 구현과 오프라인 bundle

EPUBCheck5.3.0·Temurin21.0.11+10의 고정 오프라인 payload는364파일/187,794,843bytes다.
Manifest는 별도 파일이며 payload digest는 `bcabd009a2a10ec70499c1e239bef6c53df9580253cc2a19448d804cbaabcb0c`다.
Manifest SHA는 `db3326153a8f13eb0354463dc5ef77964c1fcd5333156d5ab294a412b5cbed32`다.
기존 source ZIP pin, 전체 파일 경로·size·hash, JAR/Java와 법적 notice/legal 자료를 유지했다.
Development는 고정 tool-cache runtime, unpacked는 `resources/validation`의 전체 bundle을 사용한다.

앱은 export/preflight에서 전체 bundle hash를 확인하고 Java를 실행한다. 검사 성공과 staged output hash를 확인한 뒤
선택한 출력만 확정한다. Java 실행·취소·앱 종료는 close/stream drain과 소유 임시 파일 정리를 포함한다.
Runtime download·system Java fallback·외부 검사 서버는 사용하지 않는다.
EPUB3.4 Draft는 공통3.3 subset 검사이며 완전한3.4 인증으로 표현하지 않는다.
Publication IR과 Typie adapter 경계, 원고 밖의 report/cache/user-data, 좁은 AI mutation 계약을 유지했다.

## source5151의 실제 Windows 실행

| 실행 | 실제 결과 |
| --- | --- |
| `frozen-install-5151f6a-run1` | PASS/exit0/1.875초; 03:07:50.2616196→03:07:52.1400381 UTC |
| `package-unpacked-5151f6a-run1` | 독립 packaging/cleanup PASS/exit0/21.810초; 후속 전체 실행에서도 새 배포본을 다시 생성 |
| `full-verify-5151f6a-run1` | PASS/exit0/5256.600초; 03:15:31.9089127→04:43:08.5463271 UTC |
| `llm-development-5151f6a-run1` | Host PASS/exit0/40.787초; actual PASS WITH DIAGNOSTIC WARNING |
| `llm-packaged-5151f6a-run1` | Host PASS/exit0/39.158초; actual PASS WITH DIAGNOSTIC WARNING |
| `git diff --check` | 같은 clean source에서 전체 실행 전·artifact 준비 후 실제 exit0 |

Full은 Desktop105파일/705테스트, native publication/EPUB/HWPX/atomic/core·bridge17테스트,
Typie native/WASM·integration·build/bundle과 개발판/새 배포본 basic/D/E/F/G/H를 완료했다.
필수 unpacked·repository·format 명령도 이 full 안에서 실제 실행했으며 별도 elapsed를 만들지 않는다.
CI job을 실행했다고 주장하지 않는다.

Full source 시작/끝은 같은5151 clean이다. 소유 job3533process/cleanup active0, 강제 job 종료 없음,
empty job·process/thread/job handle·desktop 정리와 desktop 제거를 확인했다.
검사 desktop은10285표본 모두 비활성이었고 screen/desktop/focus 전환을 호출하지 않았다.
Input 이름은36회/error5로 판독 불가였으므로 `inputDefaultEverySample=null`, availability complete=false를 보존한다.
Known input 이름은 Default이며 시작/끝도 Default지만 이것을 전체 구간의 Default 증거로 바꾸지 않는다.

Pinned Node26.3.1/pnpm11.9.0/Rust1.97.1/.NET10.0.400과 기존 MSVC/Windows SDK·x86 runtime을 사용했다.
Rust jobs1·Vitest workers2, 비활성 desktop·GPU 비활성화·BelowNormal 환경의 관측값이다.
`CARGO_INCREMENTAL=0`은 full 소유 command process 한정이다. Archive helper 자신의 환경 관측 UNSET과 구분한다.
.NET build/publish/run은 `--disable-build-servers`를 사용하며 사용자 build server나 전역 설정을 변경하지 않았다.

## 같은 실행의 출판 correctness와 성능

개발판/새 배포본 G/H가 같은 full에서 각각 PASS했다. 장편 각5회는450sections/2411blocks/675000characters,
exact coverage·출력 결정성·ZIP/XML 재열기·기존 파일 보호를 유지했다.
G는 실제 Java 시작 후 UI 취소와 추가 unmeasured active-checker 종료·drain·출력 부재를 확인했다.
추가 종료 회차를 성능5회에 포함하지 않았다. H 취소는 PREPARING 경로이며 G Java 취소와 구분한다.
H 장편은1961exported+450ruby fallback, omission/rejected0, VALID/fatal0/error0/warning451이다.
HWPX31867bytes 및 byte/logical/Publication IR/preset hash는 각5회와 양쪽 환경 사이 동일하다.

| 장편5회, median/max ms | 개발판 | 새 unpacked |
| --- | ---: | ---: |
| EPUB native exporter | 653/767 | 62/75 |
| EPUB UI wall | 74911.76/79496.18 | 10047.57/10319.12 |
| HWPX native exporter | 906/1075 | 87/96 |
| HWPX 실제 runtime IR | 66039.96/67153.21 | 3154.39/3467.85 |
| HWPX UI wall | 68127.21/69619.29 | 4088.66/4667.56 |

대표3.3 EPUB 한 번의 Java 검사는 development5350.42ms/fresh5002.34ms다. Java5회 median으로 표현하지 않는다.
G의 Publication IR timing은 fixture 생성 때 저장한 debug reference이며 fresh product IR 측정이 아니다.
Fresh 장편15초 hard gate는 native EXPORTER_TOTAL이며 양쪽 exporter5/5 통과했다. UI wall·Java와 구분한다.
상세 수치와 원본은 [G 결과](PHASE_1G_RESULT.md), [EPUB 성능](EPUB_EXPORT_PERFORMANCE.md),
[H 결과](PHASE_1H_RESULT.md), [HWPX 성능](HWPX_EXPORT_PERFORMANCE.md)에 있다.

G/H 각각 세 lifecycle은 product graceful quit·wrapper 전 native alive0/exit·exact captured exit·descendants0를 확인했다.
선언한 owned process 역할의 TCP 위반/nonloopback·identity/classification/parser·unexpected product/native/wrapper diagnostics는0이다.
Renderer HTTP/WS·page error, 소유 temporary/recovery/claim/symlink 잔존도0이며 packaged override canary가 통과했다.
TCP는 sampled 관측이고 포착한 역할/process 수는 lower bound다. 이를 모든 Windows process나 AI 실증의 whole-TCP 감사로 확대하지 않는다.

## source·raw·package·ZIP 연결

Full 관련 소스63개와 hash 목록을 별도로 보관했다. Source archive의 초기 metadata snapshot과 최종 host metadata는 구분한다.
같은 full stdout의 unpacked receipt를 byte offset/length/hash와 함께 추출했다.
전체 배포본은 Electron 지원 파일·native4·bridge4·validation payload와 manifest를 포함해561파일/81폴더/549,528,995bytes다.
Full 종료 후 새 build 없이 이 tree를 두 번 inventory하고 같은 tree를 ZIP으로 포장했다.

| 근거 | 저장소 상대 경로 또는 SHA-256 |
| --- | --- |
| Full host metadata | `.tools/verification/full-verify-5151f6a-run1/metadata.json`; `31ba4cf8d25783908461b1f5e97374bb8c07dceb24e02048f612c8dfe80fa21c` |
| Raw E/F/G/H + 대표 EPUB2개 | 같은 full의 `phaseefgh-proof-archive/receipt.json`; byte-exact10파일; receipt SHA `6e43c66169f47bbb2e083f47c38afcef654376fe71c353f1c70f67f082aaafea` |
| Unpacked receipt | `.tools/verification/tested-package-receipt-5151f6a-33f8a70a-c2fd-476d-8c04-9243c9aa0509/package-unpacked-receipt.json`; `b86956227e6bf67b83a0e30f370d2233243eae0af089a5836e46962ed2eb05ea` |
| Whole snapshot | `.tools/verification/tested-package-5151f6a-6b86440a-f4c9-4087-a80c-f8a9454dfebe/tested-package-inventory.json` |
| Canonical inventory digest | `6ca42b827431aba14d8e3315b1c3cc3621300e3b86b5b7cfd8fbd5af63b92e7f` |
| ZIP join receipt | `.tools/verification/portable-tested-join-5151f6a-3656a535-96a3-4f26-a058-f43e135e2428/portable-tested-join.json`; `603cd65547a12e6775acd63403035d5b92acf36de386ba6f6a81854fbc42b297` |

Raw archive는 source hash·terminal host·full log·package/runtime entrypoint와 mtime을 연결하고 JSON을 재직렬화하지 않았다.
E/F raw와 screenshot 경로는 local-only이며 전체 raw 자료가 path-free라고 주장하지 않는다. Screenshot을 새 archive에 복사하지 않았다.
H 생성 파일은 privacy-safe summary만 유지한다. G 대표 EPUB의 연결은 harness retained hash comparison+byte-exact copy이며
독립 expected hash가 harness JSON에 저장돼 있었다고 주장하지 않는다.

ZIP·manifest·README·SHA256SUMS 위치는
`output/releases/madi-0.0.1-win32-x64-5151f6a804cf1565a09211ea8f7a11e9f547fd34/`다.
ZIP은227,694,046bytes이며 SHA는 `10aff28693851b8cf921482dcbefb7cedfcd992893bb25a72493f4ed9b13860d`다.
Manifest SHA는 `fda65424f8312248624c1822847f1040fc785b409f4d1e5d3f9d243aada179ac`다.
새 owned 폴더에 압축을 풀어 complete-tree를 비교했고, ZIP entry 전체 내용을 재추출 없이 stream hash해
snapshot·manifest·현재 unpacked tree와 대조했다. 디렉터리와 hidden 파일도 전체 tree 비교에 포함한다.
Packaging HEAD는 compiled-source 독립 증명 자체가 아니며 receipt의 `noInterveningBuildIndependentlyProven=false`를 유지한다.
Archive/join의 acceptance=false는 보관/바이트 연결 도구가 새 runtime verdict를 재계산하지 않는다는 뜻이다.
Byte-exact 보관은 hash와 새 파일 생성에 근거하며 ACL/WORM 잠금을 주장하지 않는다.

ZIP을 새 쓰기 가능한 폴더에 풀고 `madi.exe`를 실행한다. 업데이트는 앱을 닫은 뒤 새 ZIP을 별도 폴더에 푼다.
프로젝트 `.madi`와 통상 `%APPDATA%\madi` user-data는 실행 폴더와 별도다.
Signing·installer·업데이트 서버·공개 게시를 수행하지 않았다.

## 실제 AI와 수동 준비물

동일 source의 실제 AI는 임시 keyless loopback llama.cpp/Qwen 모델로 개발판/배포본 양쪽에서 실행했다.
각각 승인된 main fetch3회·reopen0·무승인0, renderer HTTP/WS/page error0이며
일반 검토/복사 무변이·정확한 단일 블록 적용·Undo/Redo·저장/reopen을 확인했다.
지정 진단 응답 불일치 경고와 non-stage stderr2줄은 보존했다.
Network 관측은 종료 전 main-fetch/renderer 범위이며 G/H의 owned TCP 감사와 다르다.
Clipboard는 interception, 선택은 합성11자 블록 전체다. Remote HTTPS·인증키·OS clipboard·native IME를 실제 검증했다고 주장하지 않는다.
모델 서버와 소유 앱은 종료·정리했으며 설치 서비스나 영구 provider를 남기지 않았다.
원본 actual/orchestrator·hash·한계는 [I 결과](PHASE_1I_RESULT.md)에 있다.

수동 kit는 `output/releases/manual-validation/5151f6a-036f0b13-b04c-45e8-88b6-d153534d7a8e/`다.
합성 한글5000자, IME15항목/환경 미기록 template, Hancom 미검증 template와 기존 절차 문서 등11파일이다.
Manifest SHA는 `588883f4a03bdb726b83bc00fb39c1efb5f0c2d98be3324fca1628a62ce2ebd4`이며
내용10파일의 size/hash와 사용 앱 executable/package metadata가 tested inventory와 일치함을 확인했다.
Kit 준비 자체는 앱·COM·registry·security를 조작하지 않았고 수동 결과를 만들지 않았다. HWP는 disabled다.

## 후속 IME report와 실제 Hancom 진단

Clean ad7fb61에서 source5151 배포본 전체561파일의 size/hash를 기존 inventory와 연결해
IME report 버튼의 JSON1463bytes/Markdown1678bytes 저장과 같은 profile의 앱 재실행 후 JSON1463bytes 보존을 확인했다.
7환경 필드는 DIAGNOSTIC_ONLY,15입력 항목은 NOT TESTED로 유지했으며 native composition 기록은 없다.
Renderer HTTP/WS/page/main warning/error는 관측 범위에서0이었다. 이것은 native IME 입력 성공이나 whole-TCP gate가 아니다.
Actual status는 PASS_REPORT_EXPORT_RESTART_DIAGNOSTIC_ONLY다. 앱 close/quit 이후 Playwright close=false로
exact PID/birth의 소유 CMD wrapper taskkill/T를 사용했으므로 모든 계층의 무강제 자연 종료를 주장하지 않는다.
Outer host38.520초/exit0/job46active0/host force 없음/desktop 정리, 비활성75표본·input Default/unknown0을 기록했다.

| 근거 | SHA-256 |
| --- | --- |
| `.tools/verification/ime-report-packaged-ad7fb61-run1/ime-report-evidence.json` | `1d40ec5f343fe3155c67e0b5b30cd44ce9543d5484bee554fe5bd879fea5fbea` |
| `.tools/verification/ime-report-packaged-ad7fb61-run1/proof-join.json` | `f3b615aa527823b613e786b5621b62c661ce1f6b87607b9d1af25775258cf369` |

동일 clean HEAD에서 사용자 승인으로 unsigned 공식 모듈을 일시 등록·복원하고180000자 합성 입력을 시험했다.
제품 bridge는 UTF-8 요청에서 OPEN_FAILED, 별도 .NET 진단은 Open=false/getters 성공을 관측했다.
독점 시험 instance는 Quit 후 native exit/no-force를 관측했지만 제품 run6은 소유 job 강제 정리가 필요했다.
HWP output/SaveAs/reopen·5회 반복·최종 network/lifecycle gate는 통과하지 않았다.
새 소유권 미확인 Hwp 존재 시 후속 control을 COM·등록 전에 중단했다.
제품·ZIP 재빌드나 수정은 없으며 static docs 검사와 새 실제 runtime 성공을 구분한다.
전체 실패·사전 중단·approval scope와 hash는 [Hancom actual 기록](HANCOM_AUTOMATION_VALIDATION.md#9-2026-10-01-private-local-actual)을 따른다.

재개 후 cleanCCD의 native 진단은 기존 source5151 full·개발판/새 배포본 성공과 별도다.
독립 빈 HWPX의 정확한 FullName·단일 현재 문서·empty/unmodified와 Close BOOL true→Quit→native exit는 통과했다.
마디 원본과 major0→5 단일 변경 시험본은 둘 다15초 readiness에서 정확한 native FullName을 확인하지 못했다.
빈 대조군 PASS는 마디 호환성·본문 coverage·HWP 변환 성공이 아니다. 초기 Path 조건 실패와 소유 강제 정리도 보존했다.
원본 DLL의 별도 load 성공을 RegisterModule acceptance로 이전하지 않는다. 제품·ZIP 변경이나 CCD의 전체 rerun은 하지 않았다.
Inner/outer input과 network UNKNOWN 범위·A/B 원본은 [Hancom 재개 후 기록](HANCOM_AUTOMATION_VALIDATION.md#10-2026-10-01-resumed-native-controls)을 따른다.

## 이번 실행의 실패·수정 기록

- `a54f1e5` full은2359.074초/exit1, G `normal-export-cancel`의 `phase1g-cancel-enabled timed out`로 실패했다.
  Java 시작 전 IR 생성·bundle hash를 포함한 대기에30초를 사용한 문제였다. H/fresh는 실행되지 않았다.
  Raw 실패와 clean source/job cleanup0, input unavailable2/error5를 보존했다.
- `4c47ec4`는 Java 시작 대기에 기존 operation 제한240초를 적용했다. 실제 UI 취소·Java close/drain·출력 부재와
  장편 성능5회 조건은 유지했다. 집중 개발판 G874.752초/exit0, Java 시작31885.86ms를 확인했으며 full PASS로 이전하지 않았다.
- 같은 `4c47ec4` 독립 package 명령은exit0였으나 owned job active2·강제 소유 정리·desktop 잔존으로
  host125/CLEANUP_FAILED였다. 두 process 역할은 기록되지 않았다. 이후 desktop이 사라졌어도 실패 판정을 바꾸지 않았다.
  `5151f6a`의 .NET CLI build-server 사용 차단 뒤 독립 package와 위 full cleanup까지 실제 PASS했다.
- ZIP 생성/새 extraction 대조 뒤 별도 read-only join이 두 번 `ZIP_PAYLOAD_PROOF_FAILED`였다.
  Windows ZIP 도구의542개 backslash entry를 proof helper가 거부했다. 기존 ZIP·앱·tracked source는 바꾸지 않았다.
  Helper에서 경로 구분자를 정규화하고 기존 rooted/traversal/중복·exact tree·hash 조건을 유지했다.
  Synthetic separator/충돌/탈출/hash/directory7검사와 실제561파일 join을 통과했다.
  원본 helper/두 실패 보관은 `.tools/verification/portable-join-original-failure-5151f6a-1d41a725-e851-4334-9786-4429529c2a44/receipt.json`,
  focused 검사는 `.tools/verification/portable-zip-separator-focused-58d27a6c-1a86-406e-9f42-2306d866c8eb/receipt.json`이다.
  최종 proof helper SHA는 `551405e4a5aafa218c991658d0f7a7c31684a3d3dc14d58430f0820083622d41`다.

최종 문서 동기화 뒤 `pnpm check:repository`·`pnpm format:check`·`git diff --check`도 실제 exit0를 확인했다.
후속 문서 commit은 runtime-tested source5151과 구분한다. 제품 코드와 검증한 ZIP을 다시 빌드하거나 수정하지 않았다.

과거 source51/660의 full·개별 성공·WITHHELD 기록은 기존 phase 결과 문서와 Git history에 보존한다.
이번5151 판정은 위 실제 실행과 별도 evidence에만 적용하며 후속 제품 변경의 actual 성공을 추론하지 않는다.

## 2026-10-02 Hancom 좁은 구조 대조 후 제품 수정

clean BBB 진단에서 마디 자체 tiny HWPX에 구역 layout 자식3개만 더한 대조본의 문서 식별과 정상 종료가 통과했다.
기존 source5151의 full5256.600초·ZIP·AI actual과 후속 diagnostic sourceBBB를 분리한다. BBB의 전체 Windows gate나
native 본문/네트워크/HWP conversion 성공을 주장하지 않는다. 대조본은 stdlib 재포장이며 native TEXT는 NOT_READ,
TCP는 UNKNOWN이다. 상세·이전 FAIL·후속 PASS·source/hash/fresh boundary는
[한컴 기록 section11/12](HANCOM_AUTOMATION_VALIDATION.md#12-2026-10-02-minimal-madi-section-profile-control)를 따른다.

writer/validator의 좁은 수정 뒤 새 exact source에서 필수 pinned Windows 명령과 development/fresh actual을 다시 실행한다.
기존 ZIP은 source5151의 보관본이며 새 compiled 제품으로 자동 갱신된 것으로 표현하지 않는다.
HWP는 승인 결과·소유권·cleanup과 실제 conversion/reopen gate 전까지 disabled다. Native IME15항목은 수동 pending이다.

## 2026-10-02 source5347 full 실패와 검증 보완

Clean `534756060e8f56ec2f58c307004013cde592ada3`에서 frozen install은 실제 exit0·2.010초였다.
새 HWPX profile 관련21개 테스트와 compiled tiny ZIP/XML·native TEXT5문단 성공은
[한컴 section13](HANCOM_AUTOMATION_VALIDATION.md#13-2026-10-02-compiled-source5347-tiny-native-text)을 따른다.
전체 Windows gate는 `full-verify-5347560-run1`, UTC15:55:44.8522052Z→17:32:55.0221730Z,
exit1·5830.138초다. 개발판 basic/D/E/F/G/H·package build·fresh basic 뒤 별도의 fresh scale graph
재열기 단계에서 실패했다. Fresh E/F/G/H의 기존 output은 run 밖의 stale 자료로 분류하고 새 성공에 포함하지 않았다.

Cleanup active1의 소유 job을 강제 정리했다. 최종 job empty·process/thread/job handles와 desktop 정리를
기록했지만 무강제 종료로 주장하지 않는다.11382 input 표본은 모두 Default/비활성·unknown0이었다.
원본 full metadata SHA는 `444dcb410f1bef5c1eebd829546c68290ffcc3838586c918c472c931eb404906`이다.
개발판 E/F/G/H raw·source68개 등77파일의 byte-exact 보관 receipt SHA는
`1abfd0cdec6ad86357d7bf2081d6071a9ca7bd7c955ac8e9f558d51240ba0436`이다. 원본/보관77개를 독립 재확인했다.

진단 사본 첫 준비는 import용 넓은 치환이 state/stats 키까지 바꿔 무효였다. 중단 snapshot을 terminal PASS로
바꾸지 않았고 child/madi 부재·desktop 부재를 별도 관측했다. 직접 job accounting/모든handle close 증명은 없다.
수정 사본은 원본과4 hunks를 대조하고 같은 동작·판정·timeout으로5회 실행했다.
Elapsed32.947/33.494/33.300/35.185/33.419초, 모두 exit0/job0/noForce/desktop 제거·Default/unknown0이다.
원본30파일 aggregate SHA는 `a501fb557d7cd691304c0decc372584a4f2a47185fbee7e3acfae7f4059bbc71`다.
5회에서는 원래 실패가 재현되지 않았으며 source5347 full FAIL과 미확정 원인을 유지한다.
기존 실패 문맥의 class selector는 실제 DOM과 달랐다. 다음 후보는 실제 testid와 숫자/closed enum만 기록하며
본문·IDs·private paths·raw 오류를 출력하지 않는다. Readiness 조건이나 동작을 완화하지 않았다.

G/H의 기존 `netstat -ano -p tcp` 수집은IPv4만 관측했다. 실제 local listener와 accepted connection 대조에서
두 수집기 모두IPv4 LISTENING/ESTABLISHED 각1·IPv6 각0이었다. `-ano` 수정 사본은 두 가족의 두 상태를 각각1씩
관측했다. RED1.641초/exit1과GREEN1.612초/exit0, 모두job0/noForce·Default/비활성·unknown0이다.
UDP는TCP parser에 들어가지 않았고 endpoint/body는 기록하지 않았다. 이 검사는 수집기 회귀이며 runtime
network GO가 아니다. 기존 PASS의 관측 범위는IPv4로 한정하고, 수정 후 exact source의 development/fresh 전체
gate 전까지 현행 판정은WITHHELD다. Source5151 ZIP은 기존 보관본이며 현행 새 제품의 release로 자동 갱신하지 않았다.

## 2026-10-02 source1ff 초기화 시험 재현·수정

Source `1ff964cd55d20b7521a68067b7278a711b3eb7c2`의 collector 회귀와 frozen install은 각각1.697/1.473초,
exit0/job0/noForce·Default/비활성·unknown0으로 통과했다. 새 collector 명령은두 IP 가족의 LISTENING/accepted
ESTABLISHED를 각각1씩 관측했고 source byte 불변·socket 정리를 확인했다. Runtime network verdict는 아니다.

이 source의 full은 UTC18:26:43.1890108Z→18:28:37.8587755Z,114.669초/exit1로 끝났다.
Desktop104/105파일·704/705테스트 PASS였고 `ime-test-app`의 dirty document unload 시험은 createProject 호출0에서 실패했다.
전후 source clean·job186/active0·강제 정리 없음·handles/desktop 정리, input223표본 Default/비활성·unknown0이다.
Rust/dev/fresh/package 시작 전 실패했으며 이번 실행의 새 package/inventory는 없다.
Source70·원본 meta/log 등75파일 byte-exact receipt SHA는
`c6de559f65f9f2df8ded3767c5361ceb880d0bb7885082f9ee568543984c371e`이고 원본/보관을 독립 재확인했다.
기존 dev/fresh E/F/G/H raw8개는 run 밖의 자료로 분류했다. PASS 전용 archiver는 실행하지 않았다.

비활성 버튼의 조기 click을 delayed-adapter 대조로 재현했다. 같은 지연과 enabled 대기만 추가한 대조는 통과했다.
기존 create/save/composition/unload assertions와 timeout을 유지한 최소 변경 후 집중8개 PASS를 실제 확인했다.
대조 receipt SHA는 `fa71465be30f239412ee3a914d0a5d0118140d6cac85042727dc5d2d058ec123`이며
diagnostic 당시 clean1ff와 적용 후 dirty 상태를 구분한다. Root 적용본과 후보의 LF-normalized 일치도 확인했다.
전체 gate·native Korean IME·새 package 성공으로 확대하지 않는다. 다음 exact source에서 필수 Windows 경로를 다시 실행한다.

## 2026-10-02 sourcee2cb07e 최종 full·portable·AI·report-only 근거

제품 source `e2cb07e44e73fd0f43db61090374a762ad1103f0`에서 frozen install은 PASS/exit0/1.432초, 최종 pinned full은 PASS/exit0/**6027.338초**였다. Full은 2026-10-01T22:12:47.5958668Z→2026-10-01T23:53:14.9598342Z UTC에 실행했고 source 시작/끝 clean, 소유 job total-process counter3494/cleanup active0, 강제 job 종료 없음, empty job·handles·desktop 정리를 기록했다. 비활성 desktop 표본11787, input 이름 판독 불가0, inputDefaultEverySample=true이며 screen/focus/desktop 전환은 호출하지 않았다. 필수 unpacked/repository/format 경로는 이 full 안에서 실제 실행했다. 이전5151 full과 후속 개별 후보 관측을 현행 e2 PASS로 재해석하지 않는다.

같은 full의 개발판/새 unpacked G/H는 PASS였다. 장편5회는450sections/2411blocks/675000characters의 exact source/block/character coverage, 결정성, ZIP/XML 재열기와 기존 파일 보호를 유지했다. Bundled EPUBCheck5.3.0은 VALID/fatal0/error0, 외부 서버·자동 다운로드 없음이며 EPUB3.3 compatibility 범위다. G/H owned-process TCP 경계와 분류/identity/parser 실패·renderer 외부 HTTP/WS는0이었다. 이는 별도 AI의 main-fetch 관측과 구분한다.

| 장편5회 median/max ms | 개발판 | 새 unpacked |
| --- | ---: | ---: |
| EPUB native exporter | 572/583 | 61/67 |
| EPUB UI wall | 62071.11/62341.61 | 8583.77/8700.65 |
| HWPX native exporter | 712/717 | 74/76 |
| HWPX 실제 runtime IR | 55686.94/55805.85 | 2411.84/2431.93 |
| HWPX UI wall | 57428.42/57493.79 | 3305.95/3355.28 |

이 값은 Rust jobs1/Vitest workers2/BelowNormal/비활성 desktop/GPU 비활성화 환경의 관측값이다. `CARGO_INCREMENTAL=0`은 owned command process에만 적용했다. Source archive80파일은 실행 중 RUNNING 시점의 원래 receipt와 metadata hash를 그대로 보존했고, 별도 terminal full PASS와 연결했다. Raw E/F/G/H 및 대표 EPUB2개의 byte-exact10파일, 전체 bound15파일을 보관했다. Archive/join acceptance=false를 새 runtime 판정으로 바꾸지 않는다.

Whole package는561파일/81디렉터리/549,563,008bytes, canonical inventory digest `03d346b83cecf7f0b28778486b7416aa46fe13a849890368b2efeb4aff342b00`다. ZIP은227,707,817bytes/SHA-256 `29221e7708beddf084794227f0f5e28eb9c250ab56ba59c668c20abc8a382009`이고 manifest/current unpacked/stream-hashed ZIP payload가 이 snapshot과 일치했다. ZIP reference source만으로 새 runtime 시험이나 clean-PC 설치 성공을 주장하지 않는다. Inventory의 freshnessInferredFromInventory=false와 noInterveningBuildIndependentlyProven=false는 보존한다. 실제 package receipt/source/full/archive 연결과 전체 byte equality를 함께 읽어야 한다.

| 근거 | 저장소 상대 경로 | SHA-256 |
| --- | --- | --- |
| Full host | `.tools/verification/full-verify-e2cb07e-run1/metadata.json` | `e11a014aee6b92d1f8efc1eaa8a68cbd0afecc29360a530438ee725c0963c1e9` |
| Source archive80 | `.tools/verification/full-verify-e2cb07e-run1/source-archive-receipt.json` | `859e8887a835942f8d60fafa2b61a26d4f755f2800600a3bbc27871b25f5a40f` |
| Raw/bound archive10/15 | `.tools/verification/full-verify-e2cb07e-run1/phaseefgh-proof-archive/receipt.json` | `f231fee12f5c51d2612c93959803dc3390786a2a4783fe46677106ee010b1f6b` |
| Package receipt | `.tools/verification/tested-package-receipt-e2cb07e-e68bcea3-bc08-45ab-b86a-3c59d2d12e41/package-unpacked-receipt.json` | `f853a450b3da3cac705cfd237648e9901de04eb2ee21488feb80463809ba1e74` |
| Whole package snapshot | `.tools/verification/tested-package-e2cb07e-7fe99ee8-7a5d-4693-92fc-4573a9b454e8/tested-package-inventory.json` | `4783799b309b4f683c5bbe415b7c0f81c1a256235c2939f566b07482249b3cb8` |
| Portable ZIP join | `.tools/verification/portable-tested-join-e2cb07e-4d9fb71c-0acc-4344-a3d2-0994aab77666/portable-tested-join.json` | `7b84d8704dae313f5c21333dee6ff6f4c66a45fda869788f57e09113c74813cc` |
| Manual kit join | `.tools/verification/manual-kit-join-e2cb07e-d508574e-059b-4a9f-a4a7-c1b23c4bbab6/receipt.json` | `c65f69ba356f2d69ac4885fe2382345adc3b84bbf70416cd232cf7bc81447d63` |
| AI final post-join | `.tools/verification/final-ai-source-join-owned-close-prepared-cdb1d801-ca09-4f6e-bbdc-bf9665ec97cb/runs/post-f89056d4-4de4-441c-bc45-1324d1e59ac8/receipt.json` | `f125d37d2a6b913d15ae14f62d206a078693b1e02a8fcb9a78fa751a4d44d5db` |

실제 AI는 development run3/29.923초와 packaged run1/30.400초 모두 PASS WITH DIAGNOSTIC WARNING였다. 지정응답 진단은 providerResponseReceived=true/exactMADI_OK=false로 유지하며 본문은 보관·출력하지 않는다. 좁은 same-block apply·consent·no-mutation-before-acceptance·Undo/Redo·save/reopen guards가 통과했고 first3/reopen0 approved main fetch, unapproved main fetch/renderer HTTP/WS/page error0이었다. Probe 비-stage stderr2줄씩은 미분류 관측으로 남긴다. 이 AI 관측은 전체 owned-process TCP/through-quit stderr audit가 아니다.

두 모드의 총4회 종료는 ordered beforeQuit1→willQuit1→quit1과 exact PID/birth/image owner를 기록했다. CORE를 포함한 captured native instance와 live owned native descendants가 wrapper force 전에0임을 확인한 뒤 inspector CMD wrapper만 정리했다. Taskkill exit0/wrapper exit·close1을 모두 보존하고 자연 종료로 주장하지 않는다. naturalMainProcessExitProven=false/nativeExitCodesObserved=false다. Owned model stop은 SIGTERM/exited=true/exitCode=null이며 정상 exit0으로 확대하지 않는다. Full/source/runtime/cache53파일·별도 debug core·dev dist·whole fresh package pre/post 불변과 actual/source copies는 AI post-join에 연결한다. Debug core와 release sidecar hash의 동일성을 가정하지 않는다. Root는 정확한 fresh 실행환경과 caller restore=true를 별도 invocation에 기록했고, actual helper 자체가 executable path/SHA를 독립 관측하지 않았다는 한계를 유지한다.

최초 DEVrun1은 window close만 있고 ordered product/native pre-wrapper proof가 없는 제한 관측으로 남긴다. DEVrun2의 product/outer PASS31.881초와 첫 invoker exit1/callerEnvironmentRestored=false는 구분한다. .NET으로 absent 변수를 empty로 복원한 첫 invoker를 보존했고, V2가 Remove-Item Env로 원래 absent 상태를 복원한 최소 DEVrun3/최종 fresh pair가 authoritative다. 이전 실패나 제한 actual을 소급 PASS/clean으로 바꾸지 않는다.

수동 kit `output/releases/manual-validation/e2cb07e-68cec668-c8fd-49b7-86e4-baf816261a37`는11파일, hash payload10파일, 복사4·참조4 source가 일치했다. 합성 입력7200 Unicode code points/한글 syllable5000/문단200이며 IME15항목 모두NOT TESTED다. Kit가 복사한 절차 문서는 최종 결과 문서보다 앞선 원래 source 그대로다. 사람의 한글 조합/키보드 시험, Hancom licensing 및 public/paid/customer/installer 배포 승인은 수행되지 않았다.

최종 IME report-only run2는 PASS/exit0/22.681초, source 시작/끝 clean, job total counter62/cleanup active0/no host job termination이었다. 첫 JSON/Markdown과 재시작 JSON 등 실제 export3개를 생성·읽고 저장된 환경/results의 재시작 일치를 확인했으며 각15항목은NOT TESTED, composition summary=null, 원고 본문 없음, owned profile 제거=true다. 이 흐름은 project/canonical RPC를 호출하지 않아 Core lazy launch가 없었다. 두 종료는 ordered quit1, captured native0과 live owned native0을 wrapper force 전에 확인해 absence proof=true/exit proof=false로 기록했다. 실행되지 않은 Core가 종료됐다고 주장하지 않는다. Inspector wrapper taskkill/exit1과 natural main/native exit-code proof=false는 그대로다. 이 결과는 Windows native Korean IME 성공이나 report import 검증이 아니다.

최초 IMErun1은 `FAIL_REPORT_EXPORT_RESTART_DIAGNOSTIC_ONLY`와 `owned-close-pre-close-live-core-required`를 보존한다. JSON/Markdown export2개만 성공했고 restart는 미실행, ownedProfileRemoved=false였다. Report-only 경로에서 불필요한 live CORE 필수조건 때문에 닫기 전에 거부됐다. Outer는 LAUNCHER_FAILED/304.115초, cleanup 당시 active9/강제 job 종료=true/그 뒤 job empty·handles·desktop 제거, input593/unavailable0이었다. PID37384만 PID/birth/current executable/role/argv/run-directory/expected-desktop와 retained process handle을 확인해 종료했으며, stop receipt는 실제 action 뒤 tool chunk665f14를 근거로 기록했다. 이를 launch 시점/사전 승인 receipt나 자연 종료로 바꾸지 않는다.

| Report-only 근거 | 저장소 상대 경로 | SHA-256 |
| --- | --- | --- |
| 최종 IMErun2 actual | `.tools/verification/ime-report-e2cb07e-run2/ime-report-evidence.json` | `8d2ba4176e34cbb75b99aa96092f7697873ea90fc522ab694e48a1bd6e158041` |
| 최종 IMErun2 host | `.tools/verification/ime-report-e2cb07e-run2/metadata.json` | `b184a5c51832fb79a4197b106a1739345a3b7a4f42f71a4c7ae9d4bf470adc82` |
| 최초 IMErun1 실패 actual | `.tools/verification/ime-report-e2cb07e-run1/ime-report-evidence.json` | `dc7f675fe7fd4d55e2ce7a27f16a78b9b90a1682b31055563c795920d87eada5` |
| 최초 IMErun1 실패 host | `.tools/verification/ime-report-e2cb07e-run1/metadata.json` | `96abd3894809ca1faa91fa8468bd6dcfdf51e3445897382e85349d2f3c7f809c` |
| 소유 child stop, action 뒤 기록 | `.tools/verification/ime-report-e2cb07e-run1/owned-child-stop-post-action-receipt.json` | `caa6fb92ee32aeb76062f45258a74359b4e9a2cc069f9ca26f95d187d5870167` |

당시 sourcee2 HWP conversion/reopen은 성공하지 못했고 environment/network-boundary blocker와 disabled/WITHHELD 상태였다. 소유자가 2026-10-02 binary HWP를 제거했으므로 이 기록은 현행 blocker나 TODO가 아니다. HWPX 및 나머지 자동 경로 성공을 HWP actual 성공이나 공개 배포 허가로 확대하지 않는다. Typie 개발 permission은 owner-confirmed이며 배포는 저장소 밖 exact grant의 허용 범위만 따른다. 원본source5151/5347/1ff·이후 diagnostic 역사, licensing과 수동15항목은 이 최신 기술 결과와 분리해 보존했다.


## 2026-10-07 계획 압축을 위한 이전 근거 원문 보존

아래는 source `f2efe6ebf4d02d5f56ec3f6ed5d9e74be6df8276`의 PLANS.md에서 옮길 역사적 기록이다. 해당 source의 원문 SHA-256은 `a84e4bc3731c076737f4fbe2d52f36a693ea2dc60d0079e9f6102f01899eefce`이다. 줄 범위별 원문 bytes·줄끝·표현·판정을 그대로 보존했다. 원문에 있는 “현재”, “최종”, “재개하면”, “자동 재개하지 않는다” 등은 당시 snapshot의 표현이며 현행 작업 지시가 아니다. 현재 목표·다음 작업은 PLANS.md만 따른다.

2026-10-07 이후 정확한 source의 full·ZIP·AI·자연 종료 결과는 이 과거 단락에서 추론하거나 채우지 않는다. Node/npm 부분 성공·source52/e2 성공·cde 중단을 새 Node24 전체 PASS로 합산하지 않는다. Binary HWP는 현행 제품 범위 밖이다. 과거 e2 표의 HWP/C# 수치와 당시 기능 설명은 revision-bound 기록이며 재도입 또는 향후 TODO가 아니다.

<!-- Verbatim PLANS.md 16–33; 2026-10-06 Node24 전환 당시 실행 범위와 미실행 범위; SHA-256 3b207f053aafc2601f411878f935218c2078cd40a28df3217e209f959679700f -->
## 완료한 환경 작업 — Node 24.21.0 LTS 전환

현재 패키지 관리자는 npm `12.2.0`이며 설치는 `npm ci`, 실행은 `npm run <script>`를 사용한다.
2026-10-06 재확인에서 Phase1B/1C/1D/1G/1H 범위 문서의 실행 gate도 npm으로 맞췄다.
과거 결과·성능 문서에 남은 pnpm 명령은 당시 실제 검증 환경의 기록으로 보존한다.

2026-10-06 사용자 요청에 따라 저장소 Node pin과 실행 wrapper를 `24.21.0` LTS로 바꿨다.
`.node-version`·exact toolchain checker·CI의 expected version과 현재 개발 문서를 함께 맞췄다.
저장소 npm `12.2.0`의 지원 범위 `^22.22.2 || ^24.15.0 || >=26.0.0`에 포함되는 버전이다.
제품 의존·lock·Rust·vendor와 이전 source의 실행 증거는 바꾸지 않았다.
이번 확인 범위는 실제 runtime/toolchain·repository·format·typecheck와 desktop JavaScript build다.
실제 Node `v24.21.0`/npm `12.2.0` exact toolchain, Typie exact commit·9개 hash·repository 경계,
290개 파일의 format/JSON, desktop typecheck와 `npm run build --workspace @madi/desktop`를 모두 exit0으로 확인했다.
Workspace build는 JavaScript main/preload/renderer만 실행했다. `package-lock.json` SHA256은
`e101ae75fd0210d7687652d18c2e4ff8d0150bfe93df14b144c2ce781e4e7b10`으로 그대로다.
전체 verify·Rust 재빌드·제품 package/dev smoke는 반복하지 않았다. 이전 Node26.3.1의 제품 실행 증거를
새 Node24의 전체 runtime 결과로 표현하지 않는다.


<!-- Verbatim PLANS.md 34–87; npm 전환 분할 성공과 full run1–6 실패·중단의 원래 기록; SHA-256 06dfacab7b2276ad199ad6109146a64d80c1ed78a0eee44af599c3dc0098b548 -->
## 이전 환경 작업 — npm 전환 완료

2026-10-06 사용자 요청에 따라 pnpm workspace를 npm `12.2.0`으로 전환했다.
Node `26.3.1`·Rust `1.97.1`과 제품 의존 버전을 유지하며, 기존 lock의 버전·integrity를
새 `package-lock.json`과 대조한다. 새 직접 의존이나 영구 overrides는 추가하지 않는다.
설치·빌드·개발/packaged 시험·dev 시작 시험·repository·format·diff의 실제 실행 결과를 이 절에 기록한다.
제품 기능, 과거 실행 증거와 사람의 IME·layout·배포 판정은 이번 전환 범위 밖이다.

전환 준비 검증: 고정 Node `v26.3.1`/npm `12.2.0`의 `npm ci` 실제 exit0, 306개 설치,
Electron `37.10.3` binary integrity 복구를 확인했다. 기존 registry `name@version`
353쌍과 integrity는 추가0·제거0·변경0이며 직접 의존 버전도 모두 유지했다.
고정 npm 실행 wrapper·workspaces·CI·현재 문서와 Electron의 npm hoist 경로를 전환하고,
기존 pnpm lock/workspace·실행 경로를 제거했다. 검증 candidate는 `c65b09a8d77b0f7b90042f6dcc892935fd64ed60`이다.
이 source의 분할 실행에서 다음 범위를 실제 통과했다.

- Full run5의 개발 경로: Desktop102파일/710시험·bundle4시험, Rust/Typie/integration/build와 개발 Electron Basic·D·E·F·G·H.
- `npm run test:package` 단독 실행: pretest의 fixture3종·release/unpacked 빌드와 fresh packaged Basic·D·E·F·G·H, 816.327초/exit0.
- `npm run test:dev` 단독 실행: 22.324초/exit0, 실제 소유 browser1개와 `--disable-gpu` argv 관측.

모든 성공 실행은 같은 clean candidate의 전후 SHA를 확인했다. 패키지 단독 실행의 소유 desktop은1599/1599회 비활성,
입력 이름 unknown0, 종료 전 fresh UOI_IO 비활성 조회1회였고 job empty·handle/desktop close·desktop 소멸을 확인했다.
검증된 `output/madi-win32-x64`의554개 파일/549,229,982byte를 thread work에 보존하고,
각 상대경로의 SHA256·size가 원본과 전부 일치하는 provenance를 기록했다. 이 배포본은 추가 재빌드하지 않는다.
사람의 IME·layout·배포 승인이나 이전 제품 작업의 PRIVATE GO는 이번 근거로 확대하지 않는다.

단일 `npm run verify`의 aggregate PASS는 없다. 사용자가 npm 교체 범위를 다시 명확히 한 뒤
반복 전체 제품 검증을 중단했으며, 같은 source의 위 분할 검증 결과로 이번 관리자 전환을 마친다.
전체 실행의 실패·부분 증거를 성공으로 합산하거나 없는 command-exit/sourceAfter 값을 채우지 않는다.

첫 전환 candidate `fb1a73bf86ceb1d3314f1bcaba8123072517d287`의 부분 실행 기록은 보존했다.
Full run1은789.117초에 OS의 `Screen-saver` 입력 desktop 관측으로 기존 Default-only guard가 종료했다.
소유 desktop은 모든 관측에서 비활성이었다. 소유 desktop 비활성·알 수 없는 입력 실패·소스 동일성·정리 조건을
유지하면서 실제 `Default`/`Screen-saver` 이름을 허용하는 ignored helper로 바꿨다. 실제 Default 관측값과 허용 정책값은 분리한다.
Full run2는124.429초에 Phase1E fixture의 I/O/SQLite class 오류로 exit1이었다. 하위원인은 미확정이며,
같은 clean source의 해당 fixture 단독 재현은26.056초/exit0이었다. 오래된 UUID 임시 파일을 원인으로 단정하거나 제품 구현을 바꾸지 않았다.
Full run3에서는 Phase1E fixture와 Reader fixture16회 RPC가 통과했으나 G/H 외 Electron의 GPU-off 설정 누락을 확인해
1255.094초에 소유 child/job만 안전하게 종료했다. 이 실행도 전체 PASS가 아니다. 없는 command-exit/sourceAfter 값을 성공으로 채우지 않는다.
기존 G/H와 같은 isolated-only `--disable-gpu` 설정을 basic/D·E·F의 공통 smoke와 dev/start 공식 Electron CLI 실행에 적용했고,
실제 Chromium switch 또는 소유 browser argv를 검사했다. 제품 main·의존·lock·기존 검사 threshold는 바꾸지 않았다.
Candidate c65의 Full run4는1017.869초에 기존 helper의 입력 이름 native5 실패로 종료했다.
이름 관측과 별개인 소유 desktop UOI_IO 비활성 근거가 있었으나 이 과거 실행을 PASS로 승격하지 않았다.
현재 ignored helper hash는 `9B8DFA295DE998D52EEB9B3713FBAF1326EB92E3EA1479F89252C872B1ED7CB5`다.
이름 native5일 때에만 같은 회차 live owned handle의 fresh UOI_IO 성공·비활성을 별도로 요구한다.
초기 identity·known unsupported name·다른 native 오류·owned flag 읽기 실패/true·source·exit·GPU·job·정리 요구는 유지한다.
Full run5는2874.782초에 prepackage PhaseD fixture의 Rust bin 재링크 `LNK1105`/Win321224로 exit1이었다.
Mapping 주체/근본원인은 미확정이며 같은 source의 PhaseD 단독 실행은 실제 재링크 후4.513초/exit0이었다.
제품·Rust·lifecycle 설정을 바꾸지 않고 이어진 위 단독 package 전체 실행을 통과했다.
Full run6은1252.694초에 사용자 범위 재확인에 따른 반복 검증 중단으로 소유 child/job만 정리했다.
이름 native5 unavailable9회는 raw Default/allowedName=null·availability=false로 보존했고,
같은 회차 fresh owned proof9회와 primary2449/2449회 비활성, 종료 전 fresh 조회·job empty·desktop 소멸을 확인했다.
Raw launcher 결과는 command-exit가 없는 `LAUNCHER_FAILED`이며 별도 intentional-abort 근거를 보존했다.
이 실행도 전체 PASS가 아니다. 최종 `check:repository`는 Typie exact commit·9개 hash·경계 검사를,
`format:check`는290개 파일의 whitespace/JSON 검사를 실제 통과했다. `git diff --check`도 exit0이다.


<!-- Verbatim PLANS.md 88–107; source52 성공 한계와 cde fix·부분 중단·sourceAfter 미관측 기록; SHA-256 91185172cd9bf402c0d850530ae4aeee9470fab15cf08d1bb4320dce8a1a4f90 -->
## 이전 제품 작업 — 사용자 요청으로 중단

2026-10-02 퇴근을 위한 사용자 요청으로 작업을 중단했다. 소유 시험 job과 비활성 desktop은 정리했고, 자동 재개하지 않는다.
최신 제품 코드 commit은 `cde2145cf7f3b7465939a99ed11a8b5d80a6bea2`다. HWP 제거와 정밀진단 개선은 구현했으며 제품 소스는 기준 e2 대비4,031줄 줄었다.
Source52 전체 Windows 검증4599.511초·로컬 ZIP 대조·실제 AI 연결은 해당 source의 완료 근거다. Source52에는 이후 별도 시험에서 확인한 창 종료 예외가 있으므로 최신 코드의 완료 판정으로 이전하지 않는다.
닫힌 창의 `webContents` 접근 예외를 최소 guard로 수정했다. 회귀시험2개 실제 RED 뒤 종료 관련14개 GREEN, typecheck·repository·format·diff를 통과했다.
Source cde의 전체 시험은 사용자 요청으로2335.000초에 중단했다. Desktop102파일/710시험·bundle4시험과 dev 기본·D/E/F 경로까지 통과하고 장편 EPUB 시험 중이었다. HWPX·새 unpacked·fresh 경로는 이 실행에서 완료하지 않았다. **전체 PASS가 아니며 최신 runtime 판정은 PENDING이다.**
중단 근거는 `.tools/verification/full-verify-cde2145-run2/intentional-abort.json`과 실제 terminal metadata에 보존했다. job1316/cleanup 시 active18은 소유 job 안에서 종료해 empty로 확인했고 handles·desktop을 닫았다. Input4556회 unknown0·소유 desktop inactive=true다. 강제 중단으로 없는 sourceAfter 필드를 성공값으로 채우지 않았다.
재개하면 그때의 정확한 clean main source에서 명시적 command-only `CARGO_INCREMENTAL=0`으로 전체 pinned Windows 검증을 다시 실행한다. 통과한 unpacked를 재빌드 없이 ZIP으로 묶고 전체 byte join, 실제 AI·자연 종료/보고서 재시작 시험, 최종 결과 문서 갱신을 마친다. 준비 helper와 이전 결과는 `.tools/verification/`에 보존했다.

현재 범위는 실제 미사용 소스·잔재와 중복을 추적하고,
동작상 결함이 확인된 구현을 작게 개선해 복잡도를 줄이는 것이다. 의존성을 추가하지 않고 기존 타입·계약·호출·시험을 근거로 판단한다.
HWPX 검증 성공을 근거로 사용자 요청에 따라 binary HWP 기능을 제품 범위에서 제거한다.
HWP 앱·계약·C# sidecar·.NET/CI/배포 경로 제거와 미사용 선언·반사 선택 shim 정리를 구현했다.
문서 전환의 원고/저장 대상 불일치, malformed JSON-RPC, AI 오류 본문 처리,
EPUB 입력 실패·종료/취소 경합·살아 있는 process의 임시 파일 정리 결함을 회귀 시험과 함께 수정했다.
Strict typecheck·repository·format·diff와 담당별 집중 회귀 검사는 통과했다. 현재 통합 source의 전체 Windows 검증·새 배포본 연결이 남는다.
아래 완료 근거는 검증된 source e2의 기준 상태다. 후속 제품 변경은 관련 회귀검사와 필수 Windows 경로를 별도로 실행하기 전까지 runtime GO로 표현하지 않는다.
HWP 변환은 차후 해결 목록에도 남기지 않는다. 과거 실패 근거만 보존하며 추가 한컴 실증은 하지 않는다.


<!-- Verbatim PLANS.md 123–142; 당시 e2 전체 gate·package·AI·report 기준 상태; SHA-256 58de238abe8435d5eaeb724d5006b8d490ca59d4f3dd1b6c3ce0242ad3164f0f -->
## 현재 판정과 진척

**기존 제품 범위의 자동 개발·Windows 검증·로컬 ZIP 준비는 source e2에서 완료했다. 현재 HWP 제거·코드 정리 및 사람의 검증·배포 결정이 남는다.**
실제 검증 제품 source는 `e2cb07e44e73fd0f43db61090374a762ad1103f0`다. 후속 결과 문서 commit을 추가 runtime 검증으로 표현하지 않는다.

| 항목 | 판정과 실제 근거 |
| --- | --- |
| 최종 Windows gate | **PASS**. frozen install1.432초, full6027.338초/exit0. Desktop105파일/719시험·C#25시험, core·exporters·Typie·build·dev/fresh 기본/D/E/F/G/H 및 unpacked/repository/format 포함 |
| 최종 실행 정리 | **PASS**. 소유 job3494/active0, host 강제 종료 없음, handles·desktop 정리. input11787회 Default/비활성, unknown0 |
| EPUB·HWPX | **PRIVATE LOCAL TECHNICAL GO**. exact e2 dev/fresh ZIP/XML·IR 범위·결정성·취소·출력 보호·재열기. TCP 외부 관측0; UDP/연속 packet 관측을 주장하지 않음 |
| EPUBCheck/JRE | **PASS**. ZIP에 고정 오프라인 bundle 포함. 실제 Java 검사·취소·검사 중 종료·출력 보호 확인 |
| 최종 ZIP | **WHOLE PAYLOAD JOIN PASS**. 실제 검증한561파일/81폴더/549,563,008bytes를 재빌드 없이 포장, ZIP과 새 압축 해제본까지 전체 hash 대조 |
| AI | **PASS WITH DIAGNOSTIC WARNING**. exact e2 개발판/배포판 실제 요청·선택 적용·Undo/Redo·저장·재열기와 제품 종료/테스트 실행기 분리 확인. 지정 응답 불일치·stderr 관측 한계 보존 |
| IME report·수동 kit | **보고서 경로 PASS / 수동 준비 완료**. 최종 앱에서 JSON/Markdown3개 내보내기·재시작·설정 유지·프로필 정리 확인. Native IME15항목은 NOT TESTED |
| HWPX native 내용 | **PRIVATE LOCAL TEXT PASS ONLY**. source20e 출력/sourcef464 inspector의 일반324·장편2412 문단 전체 대조, Close·Quit·native exit·job0·등록 부재. e2 native 판독·layout·HWP 변환 성공으로 이전하지 않음 |
| HWP 기능 | **제거 구현 완료 / 제품 범위 제외**. HWPX를 출판 경로로 유지하며 HWP 변환 UI·계약·sidecar·.NET 요구사항을 제거. 이전 변환 실패는 역사적 근거로만 보존 |
| Native IME·HWPX layout·배포 | **사람의 확인 대기**. 자동 성공을 수동 입력·서식·공개 배포 승인으로 바꾸지 않음 |

전체 실행 자료는 `.tools/verification/full-verify-e2cb07e-run1/`에 보관했다. Source80개 archive와 raw E/F/G/H10개는 원본 bytes로 보관하고 실제 package receipt·whole inventory·ZIP join과 연결했다.
Source5347/1ff full FAIL, source20e 기본 PASS, 기존 AI source5151과 첫 e2 AI 종료 증거 부족 실행은 각 revision/실행의 기록으로 보존한다. 서로 다른 실행의 부분 성공을 합쳐 전체 PASS로 만들지 않는다.

<!-- Verbatim PLANS.md 151–164; e2 artifact 경로·native IME/layout·private 배포·AI 관측 범위; SHA-256 da3f8048f8f9e62234eac3d7793abf5c06d422d5305f10eeb8af737ac0a39b6a -->
## 실행 자료와 사람에게 남는 조건

- 최종 private-local ZIP: `output/releases/madi-0.0.1-win32-x64-e2cb07e44e73fd0f43db61090374a762ad1103f0/`.
- 직접 실행할 최종 앱: `output/madi-win32-x64/madi.exe`.
- 최종 수동 kit: `output/releases/manual-validation/e2cb07e-68cec668-c8fd-49b7-86e4-baf816261a37/`. Source e2 문서 사본과15항목 NOT TESTED template·5,000자 합성 한글 입력 자료다. 수동 검증 완료 증거가 아니다.

과거 HWP 등록·합성 시험 승인과 원복·네트워크 실패는 역사적 결과 문서에서 보존한다.
HWP 기능 제거를 추가 Automation 시험·영구 등록·전역 process 종료·전역 네트워크/보안 변경으로 해석하지 않는다.
Native IME는 사람이 체크리스트를 수행한다. 자동 시험은 사용자의 화면·키보드·포커스·clipboard를 바꾸지 않았다.
Typie 개발 permission은 owner-confirmed이며 공개 배포 범위는 저장소 밖 정확한 grant를 소유자가 확인한다.
Private-local ZIP·기술 성공을 signing·installer·자동 update·공개/유료/고객 배포 승인으로 해석하지 않는다.

AI 실증은 keyless loopback·합성 단일 블록 전체 선택·clipboard API interception 범위다. 진단 지정 응답 불일치와 stderr 관측 한계는 보존한다.
Remote HTTPS·인증키·OS clipboard·native IME 또는 AI 실행 전체 process TCP 감사로 확대하지 않는다. 앱의 제품 종료와 Playwright 테스트 실행기의 정리는 별도로 기록한다.


## 2026-10-07 exact sourcef2 최종 npm·Playwright 근거

Node24.21.0 LTS/npm12.2.0/Rust1.97.1/Electron37.10.3에서 `npm ci`는31.244초/exit0, `npm run verify`는4459.669초/exit0이었다. Full 시작/종료는 2026-10-07T04:52:23.5142938Z→2026-10-07T06:06:42.6681148Z, exact source 전후 clean이며 Desktop102파일/710테스트·bundle4·Rust·Typie·integration·build·개발판과 fresh unpacked Basic/D/E/F/G/H를 같은 run에서 통과했다. 필수 `npm run package:unpacked`·repository·format은 full 안에서 실제 실행했다. 다른 revision의 성공이나 부분 실행을 합산하지 않았다.

Full은 소유 비활성 Win32 desktop·BelowNormal·GPU 비활성화, Rust jobs1·Vitest workers2·command-process 한정 CARGO_INCREMENTAL0에서 실행했다. Job total3321/cleanup active0, 강제 job 종료0, process/thread/job handles 및 desktop closed/gone를 확인했다. Owned inactive flag8784회와 pre-close fresh query1을 기록했다. 입력 이름은 Default/Screen-saver가 관측됐고 native5 판독 불가4회는 같은 회차 fresh owned-inactive proof4회와 연결한다. 이름 판독 완전성=false와 allowedActiveInputEverySample=null을 보존하며 모든 표본 Default라고 주장하지 않는다. 화면·키보드·포커스·clipboard·보안 설정을 바꾸지 않았다.

E/F/G/H actual10개는 `.tools/verification/full-verify-f2efe6e-run1/phaseefgh-proof-archive/receipt.json`에 byte-exact 보존했다. 장편450 sections/2411 blocks/675000 characters의 exact coverage·출력 결정성·ZIP/XML 재열기·취소·no-clobber·recovery cleanup 및 관측된 HTTP/WS/owned TCP 검증을 같은 run에 연결했다. HWPX의 fallback450/warning451도 그대로 기록한다. UDP·연속 packet·IME·서식 승인으로 확대하지 않는다. 실제 n5와 개발판의 느린 IR/UI는 [EPUB 성능](EPUB_EXPORT_PERFORMANCE.md#14-exact-sourcef2efe6e-developmentfresh-actual--2026-10-07), [HWPX 성능](HWPX_EXPORT_PERFORMANCE.md#10-exact-sourcef2efe6e-developmentfresh-actual--2026-10-07)을 따른다.

Source archive는 원래 RUNNING snapshot이다:444 sources/7228114B, receipt207144B/SHA-256 `6d9d81fa93a356e7b6a062ceca58669391bdcd895dd02566bc1837514565bd76`. 당시 runtimeGO=false/observedFullStatus=RUNNING을 terminal PASS로 고치지 않았다. Terminal full metadata SHA-256은 `eda4ff9bab7472c846cefddd87cbd8ef8c51d30f9c70320f10ec4c8b02c6c58d`이며 별도 실제 결과다.

## Exact f2 package receipt·canonical inventory·portable join

Source `f2efe6ebf4d02d5f56ec3f6ed5d9e74be6df8276`의 terminal full PASS metadata SHA-256은 `eda4ff9bab7472c846cefddd87cbd8ef8c51d30f9c70320f10ec4c8b02c6c58d`다. 그 command.log에서 추출한 package-unpacked-receipt는2749B/SHA-256 `c94b357fd76ef781b91d711e6da22b881957f4e9e356f21e125f6c131669e4e6`이며 native copy/runtime bundle 결과이지 전체 앱 payload의 digest 자체가 아니다. 같은 receipt hash가 다른 source에 나타나도 source/전체 package가 같다고 추론하지 않는다.

검증한 unpacked tree는554파일/80디렉터리/549229982bytes다. Canonical `JSON.stringify(inventory)` digest(inventorySha256)는 `4684dd2e03eccb3f0239976ca47ab20c2053afde016ace2567482f3406db172d`. Snapshot JSON 파일 자체의 hash는 `47619ffaed14c3465f8c3f9f8c0c6b6e103288cc3467936a1887076e104f5f91`(120393B)이며 두 hash의 뜻을 구분한다. Snapshot·manifest·현재 unpacked tree·ZIP entry payload가 같은 canonical inventory에 연결되고 HWP payload는 없다.

ZIP은227591160B/SHA-256 `5a0df13048683ae615c488477412d44b67e31d2e44f3f2224b5a8d57f649bd42`, 경로 `output/releases/madi-0.0.1-win32-x64-f2efe6ebf4d02d5f56ec3f6ed5d9e74be6df8276/madi-0.0.1-win32-x64-f2efe6ebf4d02d5f56ec3f6ed5d9e74be6df8276.zip`다. Join receipt는3518B/SHA-256 `938a2abc5c263f1117a5e37d1515483060038b22341cc11e81200f8ad31042a1`이고 zipEntryContentsStreamHashedWithoutExtraction=true/newAppTestClaimed=false다. 이 receipt는 ZIP entry를 stream hash로 대조했으며 별도 새 ZIP 압축 해제본을 실행/대조했다고 확대하지 않는다. Fresh unpacked 앱 실증은 앞선 full의 packaged gate이고 ZIP proof와 구분한다.

Snapshot freshnessInferredFromInventory=false, noInterveningBuildIndependentlyProven=false, join noInterveningBuildIndependentlyProven=false를 유지한다. Root의 직접 package-portable 포장 절차와 전체 byte equality를 함께 읽되 inventory만으로 독립 build 부재·clean-PC 설치·공개 배포 승인·실제 AI 성공을 주장하지 않는다.

| 근거 | 저장소 상대 경로 | File SHA-256 |
| --- | --- | --- |
| Package receipt | `.tools/verification/tested-package-receipt-f2efe6e-b690e6f5-a885-4c6a-ab7e-4f1e294f02e9/package-unpacked-receipt.json` | `c94b357fd76ef781b91d711e6da22b881957f4e9e356f21e125f6c131669e4e6` |
| Whole snapshot JSON | `.tools/verification/tested-package-f2efe6e-cb9e7fe6-8269-4ffb-bea9-094675a1fc30/tested-package-inventory.json` | `47619ffaed14c3465f8c3f9f8c0c6b6e103288cc3467936a1887076e104f5f91` |
| Portable join | `.tools/verification/portable-tested-join-f2efe6e-5a636f5a-ac13-4a06-b8ac-fa34b9a31880/portable-tested-join.json` | `938a2abc5c263f1117a5e37d1515483060038b22341cc11e81200f8ad31042a1` |

### 실제 AI와 직접 자연 종료·보고서

개발 AI27.887초·fresh AI26.105초 모두 실제 로컬 제공자 응답을 받았고 선택 apply/Undo/Redo·저장·재열기가 통과했다. 고정 진단의 exact MADI_OK=false 경고를 남겼다. 네 종료 모두 CORE1·before-wrapper captured native0/live owned native0·ordered quit과 wrapper exit/close0, force0이었다. AI inspector harness 자체의 naturalMainProcessExitProven=false/nativeExitCodesObserved=false는 유지한다. PRE/POST source·runtime·dev-dist·whole-package identities가 일치하고 호출자 환경도 복원됐다. 실제 AI의 자세한 관측 범위와 receipt는 [Phase1I](PHASE_1I_RESULT.md#2026-10-07-exact-sourcef2efe6e-npm--node-24-actual-loopback)를 따른다.

별도 plain run1은36.015초/exit0으로 실제 소유 HWND에 WM_CLOSE를 보내 main exit/close0·owned tree0·force0·profile 제거를 확인했다. Report run3은40.068초/exit0, same profile의 JSON/Markdown/재시작 JSON3개·manual7 exact·15 NOT TESTED·composition null·원고 본문 없음·profile 제거를 확인했다. 두 main의 child exit/close는 각각0, signal null, force0, owned tree0이었다. Playwright 연결을 먼저 정상 disconnect한 뒤 PID/birth/image/argv/owned HWND를 검증해 닫았으며 main-process 평가·Node inspector·DOM storage 주입/flush·전역 입력은 사용하지 않았다. Report-only Core는 실행되지 않았으므로 native absence proof와 실행된 Core의 exit proof를 구분한다. 실제 IME나 report import 성공을 주장하지 않는다.

Plain/report의 outer job total85/122, input70/78 unavailable0/0·owned inactive, cleanup active0/no host force·desktop closed/gone를 확인했다. 보고서의 public Download.failure()===null 완료·동일 페이지 blob·파일명·단일 고유 출력·stable double-read bytes/SHA를 검사했고 actual native 자연 종료를 별도로 확인했다. 이는 file 존재만으로 내린 판정이 아니다.

Report run1은110.832초/exit1로 REPORT_DOWNLOAD_NOT_COMPLETED에서 실패했다. 생성된 첫 JSON1463B는 schema 유효였지만 Markdown·재시작·자연 종료를 통과하지 못했다. Run2는public 완료 관측으로 첫 JSON/Markdown과 첫 자연 종료0을 확인했으나 direct-relaunch 단계 TimeoutError로130.432초/exit1이었다. 위치·원인은 미확정이며 첫 성공을 전체 성공으로 승격하지 않는다. 실패 raw와 cleanup/force 관측을 각각 보존했다. Run3은run2에 단계 태그·제한된 진단만 추가한 동일 동작·timeout·criteria의 실제 전체 성공이며, 이 성공을 run2 실패 원인의 확정으로 해석하지 않는다. Product source 변경 없이 helper 수정만 수행했다.

| 근거 | 저장소 상대 경로 | SHA-256 |
| --- | --- | --- |
| Terminal full | `.tools/verification/full-verify-f2efe6e-run1/metadata.json` | `eda4ff9bab7472c846cefddd87cbd8ef8c51d30f9c70320f10ec4c8b02c6c58d` |
| AI POST join | `.tools/verification/ai-playwright-f2efe6e-prepared-66b46329-9353-4e5a-9087-aa59e4e9a4e2/runs/post-84e74739-8394-4677-a970-41ef159b7b20/receipt.json` | `0cf47b5988f6c2f849a717947ad4d04311b2c3772bc0a2117bb1fb183d89dd3e` |
| Plain native close | `.tools/verification/ime-plain-native-close-control-f2efe6e-run1/plain-native-close-control-evidence.json` | `9cff7022dfd4ece218cc9c8404c7532280f0efa80222c79c9b95db96175e6e43` |
| Report run3 actual | `.tools/verification/ime-report-direct-cdp-natural-f2efe6e-run3/ime-direct-report-evidence.json` | `5b5b4cb00e00d590f70b4aaa6bbacbd242185621446dc07645a59a85afee6ec0` |
| Report run3 host | `.tools/verification/ime-report-direct-cdp-natural-f2efe6e-run3/metadata.json` | `0ff5e4e1967eb85609ac530711858887fc78c78cc7bd7a9c19bc696783e89c42` |
| Report run1 failure | `.tools/verification/ime-report-direct-cdp-natural-f2efe6e-run1/ime-direct-report-evidence.json` | `d08fac13711413ce29b76fc387d73de876ae59dd680223e1ad4a3f59975a329d` |
| Report run2 failure | `.tools/verification/ime-report-direct-cdp-natural-f2efe6e-run2/ime-direct-report-evidence.json` | `55901630a845ffae14ed8cffaf559a338969e8bf4e2d62ad09ec735280929344` |

수동 kit `output/releases/manual-validation/f2efe6e-8622e739-d125-4ec1-9315-30ebf218200c`는7파일/한글5000자로 준비했다. App launched=false/validationPerformed=false/IME15 NOT TESTED를 유지했다. 소유자가 실제 IME·HWPX layout과 공개/유료/고객/installer 배포 조건을 확인하기 전까지 private-local 기술 결과와 구분한다. Binary HWP·Hancom Automation·.NET runtime은 현행 제품과 차후 TODO에서 제거됐다.
