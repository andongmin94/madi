# 오프라인 검사·portable 배포 준비 검증 결과

기록일: 2026-10-01. 실제 검증 제품 source: `5151f6a804cf1565a09211ea8f7a11e9f547fd34`.
현재 목표와 다음 작업은 [PLANS.md](../PLANS.md)에서 관리한다. 후속 문서 갱신 커밋은 실제 검증 source와 구분한다.

## 판정

```text
Full pinned Windows source5151: PASS / exit0 / 5256.600s
Offline bundled EPUBCheck: DEVELOPMENT PASS / FRESH-UNPACKED PASS
HWPX: PRIVATE LOCAL TECHNICAL GO
Actual AI: DEVELOPMENT/PACKAGED PASS WITH DIAGNOSTIC WARNING
Portable ZIP: CREATED / FRESH EXTRACTION MATCH / WHOLE TESTED-PAYLOAD JOIN PASS
Manual kit: PREPARED / NOT TESTED
Native Korean IME: MANUAL VALIDATION PENDING
Actual Hancom HWP conversion: OPEN_FAILED / NO OUTPUT / DISABLED
Public/paid/customer/installer distribution: NOT APPROVED
```

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
