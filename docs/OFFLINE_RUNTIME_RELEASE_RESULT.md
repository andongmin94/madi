# 오프라인 검사·portable 배포 준비 검증 결과

기록일: 2026-10-02. 최신 실제 full·portable·AI 검증 제품 source: `e2cb07e44e73fd0f43db61090374a762ad1103f0`.
현재 목표와 다음 작업은 [PLANS.md](../PLANS.md)에서 관리한다. 후속 문서 갱신 커밋은 실제 검증 source와 구분한다.

## 판정

```text
Full pinned Windows sourcee2cb07e: PASS / exit0 / 6027.338s
Offline bundled EPUBCheck: DEVELOPMENT PASS / FRESH-UNPACKED PASS
HWPX: PRIVATE LOCAL TECHNICAL GO
Actual AI sourcee2cb07e: DEVELOPMENT RUN3/PACKAGED RUN1 PASS WITH DIAGNOSTIC WARNING
Portable ZIP: CREATED / FRESH EXTRACTION MATCH / WHOLE TESTED-PAYLOAD JOIN PASS
Manual kit sourcee2cb07e: PREPARED / NOT TESTED
IME report-only export/restart sourcee2cb07e: PASS / ZERO-CORE ABSENCE PROOF; MANUAL ITEMS NOT TESTED
Native Korean IME: MANUAL VALIDATION PENDING
Actual Hancom HWP conversion: WITHHELD / ENVIRONMENT BLOCKED / DISABLED
Public/paid/customer/installer distribution: NOT APPROVED
```

아래 기존 본문과 source5151/5347/1ff 후속 기록은 각각의 source·환경에 묶인 역사다. 최신 sourcee2cb07e 근거와 실패 보존 범위는 마지막 절을 따른다.

사용자가 요청한 기존 제품 범위의 자동 검증과 로컬 배포 준비를 마쳤다.
수동 IME는 사람의 확인이 필요하다. 후속 승인된 임시 모듈·합성 한컴 시험에서 실제 Open=false를 확인했으며
HWP conversion/reopen은 아직 성공하지 못했다. HWP는 disabled이며 최종 문서/layout·배포 승인은 없다.
Typie 개발 permission은 owner-confirmed이고 공개 배포 범위는 저장소 밖 실제 grant를 따른다.
이 기록은 현재 컴퓨터의 개발판/새 unpacked 앱 실증이다. 다른 깨끗한 PC나 installer 설치 성공으로 확대하지 않는다.

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

HWP conversion/reopen은 성공한 근거가 없으며 현재 environment/network-boundary blocker와 private-local/Hancom 결정을 유지한다. HWP는 disabled/WITHHELD다. HWPX 및 나머지 자동 경로 성공을 HWP actual 성공이나 공개 배포 허가로 확대하지 않는다. Typie 개발 permission은 owner-confirmed이며 배포는 저장소 밖 exact grant의 허용 범위만 따른다. 원본source5151/5347/1ff·이후 diagnostic 역사, licensing과 수동15항목은 이 최신 기술 결과와 분리해 보존했다.
