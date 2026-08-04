# Phase 1G — EPUB Export & Validation 범위

기준일: 2026-08-09

```text
Phase 1F entry verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Phase 1G development boundary: PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 Phase 1G의 제품·기술 경계를 고정한다. 실행하지 않은 test, package 또는
Electron 절차는 완료 증거로 취급하지 않는다. 최종 actual과 판정은
[Phase 1G result](./PHASE_1G_RESULT.md)에만 기록한다.

## 1. 목적

Phase 1G는 저장된 Typie 원고와 Binder 구조를 `PublicationDocument v1`으로 compile한 뒤,
그 IR만 소비해 reflowable `.epub` 한 파일을 생성하고 내부 검증한다. Reader Lab의 장편
설정 반영은 화면 우선 반영과 전체 측정 분리로 최적화하되 EPUB 구현의 중단 조건으로
사용하지 않는다.

```text
Typie snapshot + Binder
        ↓  madi-publication / madi-core
Publication IR v1
        ↓  strict JSON process contract
madi-export-epub
        ↓
internal validation → staged file → main-process commit
```

EPUB exporter는 Typie crate, Typie snapshot/type, React DOM, Reader Lab DOM을 직접 읽지
않는다. 생성 EPUB, output path, validation cache, report와 last-export time은 `.madi`의
canonical 원본이 아니다.

## 2. 지원 범위

- `EPUB_3_4_DRAFT_2026_08`: W3C EPUB 3.4 Candidate Recommendation Draft 대상
- `EPUB_3_3_COMPATIBILITY`: W3C EPUB 3.3 안정 호환 대상
- 두 profile에서 유효한 EPUB 3 공통 부분집합 우선
- `CHAPTER` 기본 분할, chapter가 없는 구조의 `SCENE` fallback, 명시적 `SCENE` 분할
- WORK, VOLUME, CHAPTER, SCENE scope
- UTF-8 한국어와 XML 특수문자
- heading, paragraph, blockquote, scene break, strong, emphasis, underline, strike, ruby
- unsupported block의 표시된 plain-text fallback과 warning
- `nav.xhtml`, `package.opf`, manifest, spine, 고정 내장 CSS
- optional PNG/JPEG cover
- publication metadata와 generic EPUB export preset
- schema 7, logical format 1, named snapshot payload 5
- 내부 validator와 build/test 단계 EPUBCheck 5.3.0
- 개발 및 Windows unpacked Electron 검증

## 3. profile 표시와 주장 경계

3.4 profile의 사용자 표시는 `EPUB 3.4 Draft`이며 최종 Recommendation이라고 쓰지 않는다.
현재 compiler는 두 profile에 공통인 OPF `version="3.0"` package subset을 생성하고 3.4
전용 기능을 사용하지 않는다. 3.4 선택은 profile identity, UI 경고, report와 검증 전략을
고정하지만 불필요한 전용 markup을 추가하지 않는다.

3.3 profile은 `EPUB 3.3 호환`으로 표시하고 EPUBCheck 5.3.0의 fatal/error 0을 build/test
gate로 사용한다. EPUBCheck 5.3.0 결과를 완전한 3.4 검증으로 표현하지 않는다.

## 4. process와 저장 경계

- Renderer는 metadata/options와 operation ID를 preload의 좁은 IPC 계약으로 보낸다.
- Electron main은 session, revision, scope, 저장 metadata/preset/cover, output 선택을 다시
  확인한다.
- Rust utility process가 split, XHTML/OPF/nav/CSS, ZIP과 internal validation을 수행한다.
- Main은 destination과 같은 디렉터리의 operation-owned staging directory를 만들고,
  utility 결과의 size/hash/coverage를 독립 검증한 뒤 commit한다.
- 새 destination은 hard-link 기반 no-clobber, 확인된 기존 destination은 rename/replace를
  사용한다. 선택 뒤 destination identity가 바뀌면 실패한다.
- cancel, timeout, renderer 종료와 app quit은 child close 및 owned temp 정리까지 기다린다.
- progress/result/report에는 원고 본문을 넣지 않는다.

## 5. 안전 한계

- Cover: PNG/JPEG, 최대 10 MiB, 각 변 최대 10,000 px, 최대 40,000,000 pixel
- Utility stdin: 최대 64 MiB
- Internal validator: entry 최대 30,000개, entry당 64 MiB, 총 uncompressed 512 MiB,
  message 최대 1,000개
- Desktop output: 최대 512 MiB, report 최대 8 MiB
- Export utility timeout: 10분, 정상 close grace 15초, force-close grace 5초
- raw HTML/CSS, remote URL/font, script/event handler, iframe/object/embed 금지
- ZIP absolute/traversal/duplicate path 금지
- output 무단 overwrite와 외부 validation server 금지

## 6. snapshot과 migration

Schema 6에서 7로 migration하며 `publication_assets`, `publication_metadata`,
`export_presets`를 추가한다. Logical file format은 1이다. 신규 project는 project title,
author name, `ko-KR`, project ID 기반 stable identifier로 metadata row를 seed한다.

Snapshot payload 5에는 publication metadata, 하나 이하의 COVER asset과 EPUB export preset을
넣는다. Payload 1~4에는 이 필드가 없어야 하며 restore 시 현재 project 기본 metadata와
빈 export state로 재구성한다. Generated EPUB, report, path, cache와 temp는 포함하지 않는다.

## 7. 완료 gate

다음은 별개 gate이며 하나의 unit test로 대체하지 않는다.

- Rust core/publication/exporter test
- TypeScript strict typecheck와 React/main/preload/process test
- 실제 EPUB reopen과 block/character coverage
- 3.3 CHAPTER/SCENE output의 EPUBCheck 5.3.0
- metadata/preset/cover와 snapshot 5 close/reopen/restore
- 일반·675,000자 장편 actual과 cancel/no-clobber
- development 및 fresh unpacked Electron actual
- `pnpm verify`, package, bundle, repository와 format gate

## 8. 제외 범위

EPUB import/edit, HWP/HWPX/DOCX/PDF, DRM, fixed/roll layout, vertical writing, embedded
font, arbitrary CSS, JavaScript, audio/video, media overlay, 외부 계정·업로드·validator,
installer, auto-update, cloud/server, mobile/web app은 Phase 1G에 포함하지 않는다.

## 관련 문서

- [EPUB export architecture](./EPUB_EXPORT_ARCHITECTURE.md)
- [EPUB package layout](./EPUB_PACKAGE_LAYOUT.md)
- [EPUB validation strategy](./EPUB_VALIDATION_STRATEGY.md)
- [Export preset format v1](./EXPORT_PRESET_FORMAT_V1.md)
- [ADR-0007](./decisions/ADR-0007-exporters-consume-publication-ir-only.md)
- [ADR-0008](./decisions/ADR-0008-epub-34-draft-and-33-compatibility-dual-profile.md)
