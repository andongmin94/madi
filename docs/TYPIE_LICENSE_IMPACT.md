# Typie 라이선스 영향

## 주의

이 문서는 Phase 0 구현에 포함된 코드와 binary의 기술적 관계를 바탕으로 위험을
정리한 것이며 **법률 자문이 아니다**. 실제 배포, source 제공 범위, 저작물 결합
여부와 사용자 파일의 법적 성격은 관할 법률과 구체적인 배포 방식에 따라 달라질 수
있다. 제품 배포 전 저작권·오픈소스 전문 법률가와 원저작자의 확인이 필요하다.

## 현재 포함된 Typie 자료

기준 source:

- Repository: `https://github.com/penxle/typie`
- Commit: `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- Submodule: `vendor/typie`

현재 시제품은 Typie를 단순히 조사만 한 독립 구현이 아니다.

- `packages/typie-runtime`에 위 commit에서 만든 generated JavaScript binding,
  browser WASM과 ICU data가 있다.
- Electron renderer가 generated binding을 직접 import하고 WASM을 로드한다.
- renderer는 Typie `EditorHost`/`Editor`에 message를 보내고, Canvas surface,
  snapshot과 복원을 직접 사용한다.
- `apps/desktop/src/renderer/editor/typie/input`의 세 파일은 upstream website의
  IME TypeScript에서 adaptation했으며 원본 경로, commit과 SPDX header를 표시한다.

따라서 현재 구조를 “Typie 코드와 무관한 별도 프로그램”이라고 전제해서는 안 된다.

## 버전 표기의 불명확성

`packages/typie-runtime/package.json`과 `BUILD_INFO.json`은 보수적으로
`AGPL-3.0-only`로 고정했다. 함께 보존한 `packages/typie-runtime/LICENSE`와
`vendor/typie/LICENSE`는 GNU Affero General Public License Version 3 전문이다.

다만 upstream root package와 Cargo workspace manifest에는 확인한 범위에서 별도의
SPDX license field 또는 “only”/“or later” 선언이 없다. `LICENSE` 말미의 GNU 표준
“How to Apply These Terms” 예시에는 “version 3 or any later version” 문구가 있지만,
그 예시 자체가 Typie 프로젝트에 `-or-later` 선택권을 명시적으로 부여하는
저작권자의 별도 선언인지 분명하지 않다.

따라서 이 시제품은 더 넓은 권리를 추정하지 않고 `AGPL-3.0-only`로 취급한다.
정확한 버전 선택권이 배포에 중요하다면 PENXLE COMPANY 또는 해당 저작권자에게
서면으로 확인해야 한다.

## Electron renderer와 WASM 결합 위험

기술적으로 renderer bundle과 Typie runtime의 결합은 강하다.

1. renderer가 generated Typie JavaScript API를 정적으로 import한다.
2. 같은 renderer context에서 Typie WASM을 instantiate한다.
3. `Message`, transaction, Canvas, IME, snapshot binary format을 전용 API로
   주고받는다.
4. Typie runtime 없이는 현재 editor 기능이 동작하지 않는다.
5. 배포 package는 renderer code, generated binding과 WASM을 함께 전달하게 된다.

WASM이 별도 파일이라는 사실, TypeScript adapter interface가 있다는 사실 또는
Electron process 안에서 sandbox가 켜졌다는 사실만으로 법적으로 독립된 aggregate가
된다고 단정할 수 없다. 현재 구조는 하나의 결합 저작물 또는 Typie 기반 저작물로
평가될 위험이 높다고 보고 배포 정책을 정해야 한다.

Rust `madi-core` sidecar는 Typie crate를 link하지 않고 JSON-RPC/SQLite만
담당하지만, 제품 전체를 함께 배포할 때 sidecar가 항상 별도 독립 저작물로
취급되는지까지 이 문서가 결론 내리지는 않는다.

AGPL의 network 조항은 중요한 추가 의무지만, 로컬 데스크톱 앱이고 server가 없다는
이유만으로 object code 배포, Corresponding Source, notice 등 다른 AGPL 조건이
사라진다고 보아서는 안 된다.

## 가능한 배포 경로

### 1. madi를 AGPL 호환 방식으로 배포

현재 Typie 결합을 유지하면서 madi를 AGPL로 배포하는 경로다.

검토할 항목:

- 결합된 covered work 전체에 적용할 정확한 AGPL version과 호환성
- madi와 Typie 수정·adaptation source의 제공
- generated binding, WASM을 재생성하는 데 필요한 preferred source
- build/install script, interface definition과 필요한 asset 생성 절차
- 저작권·license·무보증 고지 및 수정 사실/날짜 표시
- object code와 Corresponding Source 제공 방식 및 제공 기간
- 적용되는 경우 Installation Information과 Appropriate Legal Notices
- Electron/npm/Rust/font 등 다른 의존성의 license compatibility와 notice

현재 저장소에는 source와 일부 build 정보가 있지만, `wasm-opt`을 포함한 Typie
runtime 전체 재현 pipeline이 단일 clean-build script로 완성돼 있지 않다.
AGPL 배포를 선택하면 “현재 파일을 공개한다”는 것만으로 충분하다고 가정하지 말고,
실제로 Corresponding Source 요구를 만족하는 재현·제공 절차를 별도로 검증해야 한다.

### 2. 원저작자에게 별도 상업 라이선스 취득

PENXLE COMPANY 또는 필요한 권리를 가진 저작권자에게 현재 사용 범위를 포괄하는
별도 서면 라이선스를 받는 경로다.

계약에서 최소한 다음을 명확히 해야 한다.

- 고정 commit과 포함되는 crate/generated binding/WASM/IME adaptation의 범위
- Electron desktop에서 결합·수정·재배포할 권리
- closed-source 또는 다른 madi license로 배포할 수 있는지
- source 제공, attribution, notice, 상표와 변경 고지 조건
- 향후 Typie update와 codec/snapshot compatibility에 대한 권리
- 재허가, 배포 채널, 지역, 기간, 종료 후 기존 사용자 지원 조건

별도 라이선스는 Typie에 관한 권리만 해결한다. Nanum Gothic, Electron, npm/Rust
dependency 등 다른 제3자 조건은 계속 준수해야 한다.

### 3. Typie는 연구에만 사용하고 clean-room 독립 구현

배포 제품에서 Typie 코드와 파생물을 제거하고 독립 editor를 구현하는 경로다.

진정한 독립 구현을 주장하려면 적어도 다음이 필요하다.

- Typie WASM, generated JavaScript/d.ts, ICU 산출물과 adapted IME source 제거
- Typie 전용 message, schema, codec source를 line-by-line 복제하지 않음
- 공개된 동작 요구사항과 madi가 독자적으로 작성한 specification 분리
- Typie source를 본 조사자와 구현자 사이의 역할·자료 접근 정책 검토
- 설계 기록, source provenance와 독립 작성 증거 보존
- `.madi`의 과거 Typie snapshot을 migration할 필요가 있다면 허용 가능한
  interoperability 방법을 별도 검토
- 독립 구현 자체의 제3자 dependency license 검토

단순히 type이나 함수 이름을 바꾸거나 WASM을 다른 process로 옮기는 것은
clean-room 구현이 아니다. 어느 수준의 분리가 필요한지는 법률 전문가의 판단이
필요하다.

## 비배포 연구 사용

AGPL 전문은 일반적으로 covered work를 타인에게 convey하지 않는 private
modification/run과 배포를 구분한다. 하지만 회사·외주·계열사·테스트 사용자에게
binary/source를 전달하는 행위가 항상 “private”인지 이 문서에서 판단할 수 없다.
연구용이라는 이름만으로 모든 의무가 면제된다고 가정하지 않는다.

## 사용자 원고와 `.madi` 파일

AGPL v3 제2조는 프로그램 실행의 output이 그 내용상 covered work를 구성하는 경우에만
그 output이 license 대상이 된다는 취지의 문구를 포함한다.

따라서 사용자가 자기 창작 문장을 입력해 만든 일반 원고는 Typie/madi를 사용해
생성했다는 이유만으로 보통 AGPL에 따라 재라이선스되는 것으로 보이지 않는다.
사용자 원고의 저작권과 소유권은 원칙적으로 사용자에게 있다는 제품 정책과도
일치한다.

다만 이는 확정적인 법률 결론이 아니다.

- output에 covered source나 substantial licensed material이 포함되는 경우
- template, sample 또는 제3자 저작물이 원고에 포함되는 경우
- `.madi`의 Typie changeset/metadata 구조가 단순 사용자 data 이상의 저작물로
  평가되는 특수한 경우
- 관할 법률이 output과 database 권리를 다르게 보는 경우

에는 분석이 달라질 수 있다. 현재 기술 구현은 사용자 원고에 AGPL 표기를 강제로
추가하지 않으며, 원고 본문을 network로 전송하지 않는다.

## 배포 전 결정 게이트

production 배포 전에 다음 중 하나를 명시적으로 승인해야 한다.

1. AGPL 호환 배포와 완전한 Corresponding Source/notice 절차
2. 필요한 범위를 포괄하는 별도 상업 라이선스
3. Typie 파생물을 제거한 검증 가능한 독립 구현

그 전까지 현재 산출물은 Phase 0 기술검증 시제품이며, proprietary production
배포가 허용된다고 해석하지 않는다.

## 참고한 1차 자료

- GNU Affero General Public License Version 3:
  <https://www.gnu.org/licenses/agpl-3.0.html>
- GNU Licenses FAQ — 결합 저작물과 프로그램 output:
  <https://www.gnu.org/licenses/gpl-faq.html>
- 이 저장소에 보존한 원문:
  `vendor/typie/LICENSE`, `packages/typie-runtime/LICENSE`
