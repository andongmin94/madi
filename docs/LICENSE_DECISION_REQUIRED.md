# Typie 라이선스 결정 필요사항

## 현재 상태: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION

**이 문서는 법률 자문이 아니다.** 기술 구조와 확인 가능한 license 자료를 바탕으로
제품 책임자가 결정해야 할 선택지를 정리한 의사결정 기록이다. 저작권·오픈소스
전문 변호사가 실제 source, build, 배포 채널, 계약 주체와 관할을 검토하기 전에는
어느 선택지도 최종 승인된 것으로 간주하지 않는다.

현재 결정 상태:

```text
Decision: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Approved option: NONE
Proprietary production distribution authorized: NO
External pilot/customer binary distribution authorized: NO
```

기술검증 성공, unpacked Windows package 생성 또는 `pnpm verify` 통과는 이 결정을
대신하지 않는다. 기술 `GO`와 배포 license `GO`는 서로 독립된 gate다.

## 판단 대상인 현재 결합 구조

현재 madi는 Typie를 독립 실행 파일로 옆에 두기만 한 구조가 아니다.

- Electron renderer가 Typie generated JavaScript binding을 import한다.
- 같은 renderer address space에서 Typie browser WASM을 instantiate한다.
- Typie 전용 message, transaction, snapshot codec, Canvas surface와 IME 계약을
  adapter가 사용한다.
- Typie WASM, generated `.js`/`.d.ts`, ICU와 resource asset을 앱과 함께 묶는다.
- upstream website source에서 adaptation한 IME TypeScript 세 파일을 포함한다.
- Typie runtime이 없으면 현재 편집 기능이 동작하지 않는다.

따라서 WASM을 별도 파일로 두었거나 madi interface로 감쌌다는 사실만으로 현재
renderer를 Typie와 무관한 단순 aggregate라고 가정하지 않는다. GNU License
FAQ도 두 프로그램이 하나의 work인지 여부가 통신 방식뿐 아니라 교환 정보의
의미와 결합 정도에 달린 법적 문제라고 설명한다. 현재 구조의 정확한 결합 범위는
법률 전문가가 판단해야 한다.

Rust `madi-core`는 Typie crate를 link하지 않고 JSON-RPC/SQLite 저장을 담당한다.
그러나 한 제품 package로 배포될 때 이 sidecar와 나머지 madi 코드가 어느 범위까지
별도 저작물로 인정되는지도 이 문서가 단정하지 않는다.

## 확인된 license와 남은 해석

- Typie source: `vendor/typie`
- Exact commit:
  `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- 보존한 원문: `vendor/typie/LICENSE`,
  `packages/typie-runtime/LICENSE`
- Copyright notice: `Copyright (C) 2025 PENXLE COMPANY`
- madi runtime package의 보수적 표기: `AGPL-3.0-only`

확인한 upstream root/Cargo manifest에는 명시적인 SPDX `only`/`or later` field가
없다. GNU AGPL v3 원문 말미의 적용 예시만으로 Typie 저작권자가
`AGPL-3.0-or-later` 선택권을 별도 부여했다고 추정하지 않고, 현재 저장소는
`AGPL-3.0-only`로 보수적으로 관리한다. 이 해석이 실제 배포 license를 확정하는
것은 아니다. 버전 선택권이 필요하면 권리자 또는 법률 전문가에게 서면으로
확인한다.

또한 로컬 데스크톱 앱에 network 기능이 없다는 이유만으로 object code convey,
Corresponding Source, license/notice와 수정 고지 등 AGPL의 다른 조건이 사라진다고
가정하지 않는다. AGPL 제13조의 network 조항은 추가 조건이지, 다른 배포 조건을
대체하는 면제 조항이 아니다.

## 선택지 비교

| 기준 | Option A — AGPL 호환 배포 | Option B — 별도 commercial license | Option C — Typie 제거 후 독립 구현 |
|---|---|---|---|
| 현재 구조에 미치는 영향 | 현재 강결합 renderer를 유지할 수 있으나 covered/combined work 범위를 보수적으로 처리해야 한다. | 현재 구조를 유지할 가능성이 있으나, 실제 권리는 서명된 계약 범위에만 존재한다. | Typie WASM, binding, adapted IME와 Typie 전용 통합을 production에서 제거해야 한다. 이름 변경이나 process 이동만으로는 충분하지 않다. |
| 예상 source 공개 범위 | 최소한 Typie source·수정·adaptation, 이를 재생성하는 preferred source/build 정보가 필요하다. 결합된 madi 전체 범위는 법률 검토가 필요하며, 현재는 넓게 공개하는 계획을 전제로 예산을 잡아야 한다. | 계약이 허용하면 madi source를 비공개로 유지할 수 있다. 계약 밖의 Typie 자료와 다른 제3자 license 의무는 그대로 남는다. | 독립 구현에 선택한 madi license가 적용된다. 제3자 dependency와 font license/notice는 별도로 준수한다. |
| 배포 가능성 | 원칙적으로 가능한 경로지만 현재 compliance package, 정확한 source 제공 절차와 전체 notice가 완성되지 않아 즉시 release할 수 없다. | 권리자와 필요한 범위의 계약이 체결되고 다른 제3자 검토가 끝난 뒤 가능하다. 협상 결과가 불확실하다. | 현재 repository는 Typie 자료를 포함하므로 이 선택지로 배포할 수 없다. 검증 가능한 독립 구현이 완성된 뒤에만 가능하다. |
| 초기/지속 유지비 | source 공개·build 재현·notice·offer/배포 절차와 release별 compliance 검토 비용이 지속된다. | 계약 협상, license fee/royalty, 갱신·감사·종료 조건 관리 비용이 든다. | clean-room 설계·구현·검증 비용이 가장 크다. 이후 엔진 roadmap 통제권은 높아질 수 있다. |
| Typie update 추적 | commit별 source, generated API, WASM/ICU/font hash, IME adaptation, 과거 snapshot과 license/notice를 모두 갱신한다. | 계약이 현재 commit만인지 향후 version도 포함하는지 확인하고, 각 upgrade의 권리와 기술 호환성을 함께 승인한다. | production은 Typie runtime upgrade를 받지 않는다. 공개 동작 specification과 독립 source provenance를 계속 분리·보존한다. |
| 유료 배포 | 유료 판매 자체를 금지한다고 전제하지 않지만, 수령자의 license상 권리와 source 의무를 제한할 수 없다. AGPL만으로 독점 proprietary 배포권이 생기지 않는다. | 계약에 closed-source, 유료 판매, 채널·지역·기간·재허가 권리가 명시된 범위에서 가능하다. | 독립성이 검증되고 다른 제3자 조건을 충족하면 madi가 선택한 상업 정책으로 가능하다. |
| Phase 0.5에서 허용할 수 있는 범위 | 외부에 convey하지 않는 제한된 기술검증은 계속할 수 있다. 공개/고객 package는 compliance 완성 전 보류한다. | 협상과 기술검증은 가능하지만 서명 전 commercial license가 있다고 취급하지 않는다. | 독립 구현 계획과 역할 분리 설계까지만 가능하다. 현재 Typie 통합 binary를 Option C의 production artifact라고 부를 수 없다. |

## Option A — madi를 AGPL 호환 방식으로 배포

이 경로는 현재 Typie 결합을 유지하면서 적용되는 AGPL 의무를 충족하는 방식이다.
“repository를 공개하면 끝”으로 처리하지 않는다.

배포 전에 최소한 다음을 확정한다.

1. 적용되는 정확한 AGPL version과 combined/covered work 범위
2. madi code에 부여할 호환 license와 저작권자 승인
3. Typie source, madi adaptation, generated binding/WASM의 preferred source
4. 정확한 runtime을 재생성하는 script, tool version, build/install 정보
5. license 원문, 저작권·변경·무보증 고지와 Appropriate Legal Notices
6. object code와 Corresponding Source를 함께 제공하거나 유효하게 제공하는 방법
7. 적용되는 경우 Installation Information과 source 제공 기간
8. npm/Rust/Electron/Nanum Gothic을 포함한 전체 third-party notice
9. 외부 기여를 받을 경우의 contributor/license 정책

현재 `wasm-opt`을 포함한 end-to-end Typie runtime 재생성 pipeline은 완성되지
않았다. 체크인된 binary의 hash가 맞는 것과, Corresponding Source 의무를 만족하는
재현·제공 절차가 준비된 것은 다른 문제다.

유료 배포를 선택하더라도 수령자가 license에 따른 source 접근, 수정과 재배포
권리를 행사하지 못하도록 별도 약관으로 제한해서는 안 된다는 전제에서 법률
검토를 받아야 한다.

### Option A 승인 증거

- 적용 license와 scope에 대한 법률 검토서
- root `LICENSE` 및 저작권자 승인 기록
- release와 정확히 대응하는 source archive/repository tag
- 재현 가능한 build/install 절차와 source 제공 방식
- binary에 포함된 전체 notice/license bundle
- release별 compliance checklist와 담당자

## Option B — Typie 권리자에게 별도 commercial license 취득

이 경로는 PENXLE COMPANY 또는 실제 필요한 권리를 가진 주체와 서면 계약으로
현재 사용 범위를 허가받는 방식이다. 구두 동의, issue 답변, 가격 문의 또는 협상
중 상태는 license 취득이 아니다.

계약에서 최소한 다음을 명시한다.

- exact commit과 포함 crate, generated binding, WASM, ICU/resource 산출물
- 세 IME adaptation과 향후 수정 권리
- Electron desktop에서 결합, 수정, 복제와 재배포할 권리
- closed-source 및 madi가 선택한 license로 배포할 권리
- 유료 판매, app store/직접 판매, 지역, 기간과 사용자 수
- 재허가, 계열사·외주·QA·고객 preview 제공 범위
- attribution, notice, source 제공과 수정 고지 의무
- 향후 Typie version, security fix와 snapshot codec 호환 지원 범위
- fee/royalty, audit, indemnity, warranty와 책임 제한
- 계약 종료 후 기존 사용자에게 build, update와 복구를 제공할 권리

계약이 고정 commit만 허가하면 Typie upgrade마다 계약상 권리를 다시 확인한다.
기술적으로 호환된다는 이유로 license 범위가 자동 확장되지 않는다. 반대로 별도
Typie license를 받더라도 Electron, npm/Rust dependency와 Nanum Gothic 등 다른
제3자 조건은 그대로 준수한다.

### Option B 승인 증거

- 서명된 계약과 실제 권리자 확인
- 계약 범위와 현재 `BUILD_INFO.json`/patch inventory의 대응표
- 배포 채널·과금 방식·지역·기간에 대한 내부 승인
- upgrade 및 계약 종료 시 release 차단 절차
- 계약상 notice와 다른 third-party notice를 포함한 package

## Option C — Typie는 연구에만 사용하고 독립 구현

이 경로는 production 제품에서 Typie code와 파생물을 제거하고, 독립적으로 작성한
editor를 사용한다. 다음을 했다는 이유만으로 clean-room이 되지 않는다.

- Typie type, 함수 또는 파일 이름만 바꾸기
- WASM을 worker나 별도 process로 옮기기
- generated binding을 다른 wrapper 뒤에 숨기기
- adapted IME source를 일부 재작성하기
- Typie snapshot codec 또는 schema를 line-by-line 재현하기

독립 구현의 최소 검토 항목:

1. Typie WASM, generated `.js`/`.d.ts`, ICU 산출물과 adapted IME source 제거
2. Typie 전용 message/schema/codec 구현을 그대로 복제하지 않은 독립
   specification
3. 조사자와 구현자의 역할, source 접근과 communication 정책
4. 모든 새 source의 author/provenance 기록과 review trail
5. 독립 dependency 및 font pipeline의 license 검토
6. 기존 Typie snapshot이 든 `.madi`를 읽어야 할 경우 허용 가능한
   interoperability/migration 방법에 대한 별도 법률 검토
7. 과거 문서를 안전하게 plain text로 회수하는 사용자 전환 계획

현재 Phase 0.5 개발자가 Typie source와 adapter를 이미 조사했으므로, 어떤 수준의
인력·자료 분리가 독립성 증거로 충분한지는 내부 판단으로 확정하지 않는다. 법률
전문가가 clean-room protocol을 먼저 승인해야 한다.

Nanum Gothic 자체는 OFL-1.1 자료이지만 현재 압축 resource asset은 Typie pipeline로
생성됐다. Option C에서는 font license뿐 아니라 asset 생성 구현의 독립성과
provenance도 다시 검토한다.

### Option C 승인 증거

- 법률 검토를 받은 clean-room protocol
- 독립 동작 specification과 source 접근 기록
- Typie 자료 제거 inventory와 binary/source scan
- 독립 editor의 build/test/provenance 기록
- 기존 `.madi` migration 또는 plain-text recovery 정책
- 새 dependency 전체 license/notice report

## Phase 0.5에서 지금 허용하는 범위

최종 선택 전 기본 release policy는 가장 좁게 둔다.

허용:

- 지정된 개발 환경에서 로컬 기술검증
- 자동 test, 수동 Windows IME 검증과 동일 조직 내 제한된 평가
- 같은 작업 범위 안에서 unpacked package의 실행·삭제 가능한 smoke
- 권리자 문의, 법률 자문과 Option C clean-room 계획 수립

별도 승인 전 금지:

- public download, app store, package registry 또는 release page 업로드
- 고객·유료 pilot·외부 tester에게 binary나 source 전달
- Typie가 결합된 madi를 proprietary 배포 가능 제품으로 표시
- AGPL source 제공 절차가 없는 object code 배포
- 체결되지 않은 commercial license를 전제로 한 판매·마케팅

회사, 계열사, 외주, 투자자 또는 테스트 사용자에게 전달하는 행위가 언제나
비배포 private use인지 이 문서가 판단하지 않는다. 조직 경계를 넘는 전달은
사전에 법률 검토를 받는다.

사용자가 작성한 일반 원고가 프로그램 output이라는 이유만으로 자동으로 AGPL
대상이 된다고 단정하지 않으며, 현재 제품 정책은 사용자 원고의 권리를 사용자에게
둔다. 다만 output에 covered material이 포함되는 특수한 경우와 `.madi` 내부
구조의 법적 성격은 법률 검토 대상이다.

## 모든 선택지에 공통으로 남는 결정

- madi 자체 code는 현재 `UNLICENSED`이며 최종 root license가 없다.
- Typie 외 npm, Rust, Electron, SQLite와 Nanum Gothic의 license/notice를
  release artifact 기준으로 다시 생성·검토해야 한다.
- `pnpm-lock.yaml`과 `Cargo.lock`의 transitive dependency 전체가 현재
  `THIRD_PARTY_NOTICES.md`의 요약 표만으로 완전히 고지된 것은 아니다.
- code signing, installer EULA, privacy policy와 상표는 open-source license와
  별개의 release 항목이다.
- Typie commit upgrade는 어떤 선택지를 택해도 기술 compatibility와 권리 범위를
  함께 검토해야 한다.

## 사람이 작성해야 하는 최종 결정 기록

다음 기록이 승인되기 전 상태는 계속 **HUMAN DECISION REQUIRED**다.

```text
Selected option: A / B / C
Decision owner:
Legal reviewer:
Review date:
Legal entity and jurisdiction:
Covered products and editions:
Allowed distribution channels:
Allowed monetization:
Source disclosure / contract / clean-room evidence:
Typie versions covered:
Third-party notice owner:
Renewal or re-review date:
Release-blocking conditions:
Approval signatures:
```

선택 결과는 `docs/PHASE_0_5_CLOSURE_RESULT.md`에 기술 판정과 분리해서 기록한다.
“TECHNICAL GO”가 나오더라도 위 결정이 없으면 proprietary production 배포는
승인되지 않는다.

## 참고 자료

- 저장소 내 상세 기술 분석:
  `docs/TYPIE_LICENSE_IMPACT.md`
- 정확한 source/patch 상태:
  `docs/TYPIE_PINNING_AND_PATCHES.md`
- 포함 자료 요약:
  `THIRD_PARTY_NOTICES.md`
- 보존한 license 원문:
  `vendor/typie/LICENSE`, `packages/typie-runtime/LICENSE`
- [GNU Affero General Public License Version 3](https://www.gnu.org/licenses/agpl-3.0.html)
- [GNU Licenses FAQ — aggregate와 결합 프로그램](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)

위 GNU 자료는 license 원문과 FSF의 일반 설명이다. 현재 madi/Typie 구조에 대한
개별 법률 의견이나 권리자의 별도 허가를 제공하지 않는다.
