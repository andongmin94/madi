# Phase 1H — HWPX Export & Optional Local HWP Bridge 범위

기준일: 2026-08-13

```text
Phase 1G verdict: CONDITIONAL TECHNICAL GO — RUNTIME EPUBCHECK PACKAGING PENDING
Phase 1H development boundary: PRIVATE LOCAL
Phase 1H result while actual gates are running: WITHHELD
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Hancom Automation: LICENSE REVIEW REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 Phase 1H의 제품·기술 경계를 고정한다. 완료 판정과 수치는 실제 실행 로그가
있는 [Phase 1H result](./PHASE_1H_RESULT.md)에서만 갱신한다.

## 1. 목적

저장된 Typie 원고와 Binder를 `PublicationDocument v1`으로 compile한 뒤 같은 IR만
소비해 편집 가능한 `.hwpx`를 생성한다. 선택한 PC에 한컴오피스와 안전한 Automation
환경이 모두 있을 때만 검증된 HWPX를 `.hwp`로 변환한다.

```text
Typie snapshot + Binder
        ↓  madi-publication / madi-core
Publication IR v1
        ↓  strict JSONL process contract
madi-export-hwpx
        ↓
internal validation → staged HWPX → main-process commit
        ↓ optional, installed Hancom only
madi-hwp-bridge → HWP conversion → reopen verification
```

HWPX exporter는 Typie snapshot/type, `.madi` SQLite, React/Reader DOM을 직접 읽지 않는다.
HWPX/HWP, output path, report, validation cache와 conversion result는 canonical 원본이나
snapshot payload가 아니다.

## 2. 직접 HWPX 지원 범위

- `HANCOM_OFFICIAL_MODEL_1_31` 상호운용 profile
- SCENE/CHAPTER/VOLUME/WORK scope와 Binder 순서
- single section 및 VOLUME heading 기준 section split
- WORK/VOLUME/CHAPTER/SCENE 제목의 선택적 포함
- paragraph, blockquote, scene break
- strong, emphasis, underline, strike
- ruby 기본문자와 주석을 표시하는 plain-text fallback 및 warning
- unsupported block의 non-empty plain-text fallback 및 warning
- `include* = false`인 hierarchy heading의 explicit configured-omission accounting
- empty unsupported fail-closed; Publication IR v1에 없는 authored image를 합성하지 않음
- A4/Letter/custom page, portrait/landscape, 여백과 gutter
- 본문/제목 font family, size, line spacing, indent, 문단 앞뒤 간격과 정렬
- chapter/page break, bottom page number, optional header/footer/title page
- deterministic ZIP/XML/ID/order와 file/logical package hash
- 내부 ZIP/XML/reference/source-coverage validator
- 원자적 no-clobber/confirmed replace, progress/cancel/report/reveal
- schema 8 HWPX preset과 named snapshot payload v5 보존
- development 및 Windows fresh-unpacked Electron actual

이 profile은 KS X 6101:2024 전체 적합성 선언이 아니다. Legacy 2011 namespace의 model
1.31 세대와 2024 namespace를 섞지 않는다. 자세한 근거는
[HWPX official model 1.31 profile](./HWPX_OFFICIAL_PROFILE_1_31.md)을 따른다.

## 3. 선택적 HWP bridge 범위

- 고정 ProgID `HWPFrame.HwpObject.2`
- `probe`, `convert`, `reopen-verify`, targeted `cancel`만 제공하는 x86 sidecar
- `Open(path, "HWPX", "")` 뒤 `SaveAs(path, "HWP", "")`
- absolute `.hwpx` input와 `.hwp` output만 허용
- no-clobber, operation-owned temporary output, timeout/cancel cleanup
- 변환 실패 때 검증된 HWPX 보존
- bridge가 소유한 document/window/object만 close

한컴오피스, HwpObject DLL/type library와 file-path security module은 Madi에 번들하지 않는다.
Automation을 안전하게 사용할 수 없으면 HWP UI를 비활성화하고 HWPX만 제공한다.

## 4. 저장·snapshot 경계

Schema 8은 기존 generic `export_presets` table의 `kind` 허용값을 `EPUB | HWPX`로
확장한다. HWPX preset은 `MADI_EXPORT_PRESET`, version 1 envelope와 closed config를
사용한다. Built-in 3종은 renderer 상수이며 복사해 저장하기 전에는 SQLite row가 아니다.

Named snapshot payload version은 계속 5다. V5 `export_presets` 배열이 EPUB/HWPX kind를
함께 보존한다. Generated HWPX/HWP, contact one-shot input, path, report, hash cache, progress와
last export state는 포함하지 않는다.

## 5. 안전 한계

- utility stdin 최대 64 MiB, strict exact-key JSON
- ZIP entry 최대 30,000개, entry당 128 MiB, 총 uncompressed 512 MiB
- validation message 최대 1,000개
- package absolute/traversal/backslash/drive/duplicate path 금지
- XML 1.0에서 허용되지 않는 control character 금지
- arbitrary XML/CSS/script/macro/resource path/remote font 금지
- output 무단 overwrite, foreign temp 삭제, broad `Hwp.exe` process kill 금지
- 원고 본문, contact와 local source path를 report/log에 넣지 않음

## 6. 완료 gate

다음은 서로 독립된 gate다.

- Rust publication/core/HWPX exporter test와 deterministic/reopen/coverage fixture
- C# protocol/path/no-clobber/timeout/cancel/mock conversion/reopen test
- TypeScript strict typecheck와 renderer/preload/main/process test
- schema 7→8 migration, mixed EPUB/HWPX CRUD, snapshot v5 restore/reopen
- 일반 원고와 675,000자 장편 block/character/scene-break loss 0
- development 및 fresh-unpacked Electron actual
- package resource boundary와 외부 runtime request 0
- 최종 7개 pnpm command exit 0

한컴 변환은 한컴 미설치 환경의 HWPX 완료 gate가 아니다. 한컴이 설치돼도 security module,
실제 COM activation, HWPX open/HWP save/reopen이 모두 검증되지 않으면 HWP는
`MANUAL VALIDATION PENDING`이다.

## 7. 제외 범위

바이너리 HWP 직접 생성, HWP/HWPX import, DOCX/PDF, 수정 병합/변경 추적 round-trip,
표/수식/복잡한 각주/다단/세로쓰기/font embed, macro/script/DRM, 플랫폼 업로드,
account/cloud/server/collaboration/mobile/web/LLM/plugin marketplace는 포함하지 않는다.

## 관련 문서

- [HWPX export architecture](./HWPX_EXPORT_ARCHITECTURE.md)
- [HWPX package layout](./HWPX_PACKAGE_LAYOUT.md)
- [HWPX semantic mapping](./HWPX_SEMANTIC_MAPPING.md)
- [HWPX validation strategy](./HWPX_VALIDATION_STRATEGY.md)
- [HWP local bridge](./HWP_LOCAL_BRIDGE.md)
- [ADR-0009](./decisions/ADR-0009-hwpx-exporter-consumes-publication-ir-only.md)
- [ADR-0010](./decisions/ADR-0010-hwp-output-uses-local-hancom-conversion.md)
