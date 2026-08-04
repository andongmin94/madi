# EPUB Export Architecture

기준일: 2026-08-09

## 1. 소유권과 의존 방향

`madi-publication`은 canonical Typie snapshot과 Binder를 Madi 소유
`PublicationDocument v1`으로 변환한다. `madi-export-epub`은 이 IR과 Madi 소유 export
request만 받는다.

```text
vendor/typie
    ↓ private adapter
crates/madi-publication
    ↓ PublicationDocument v1
crates/madi-core ── compile/revision/canonical state
    ↓ strict Electron main contract
crates/madi-export-epub
```

`madi-export-epub/Cargo.toml`에는 `madi-publication` path dependency가 있지만 Typie crate의
직접 dependency는 없다. Exporter는 `.madi` SQLite, editor DOM, Reader Lab DOM 또는
renderer state를 열지 않는다.

## 2. 계약

Rust request는 project/scope identity, expected revision, Publication IR hash, metadata,
closed-token options, output path, overwrite 선택과 optional validated cover를 포함한다.
Serde는 camelCase와 `deny_unknown_fields`를 사용한다. Utility stdin은 mode,
canonical-lowercase UUID operation ID, document와 request를 담은 JSON 한 개이며 64 MiB를
넘으면 거부한다.

Result에는 output path, byte length, file SHA-256, logical package hash, target profile,
source Publication hash, internal validation report, 단계별 timing과 coverage statistics가
있다. Typed error는 분류된 짧은 메시지만 출력하며 원고 전체와 raw stack을 출력하지
않는다.

## 3. compiler pipeline

1. request/project/scope/revision/hash/metadata/options/IR을 검증한다.
2. Binder/section order를 보존해 CHAPTER 또는 SCENE content unit을 만든다.
3. source ID에서 stable hashed filename suffix, section/block XHTML ID를 만든다.
4. 사용자 문자열을 XML text/attribute로 escape하여 XHTML을 생성한다.
5. nav, OPF, CSS, container와 optional sanitized cover를 만든다.
6. 고정 entry 순서와 timestamp로 ZIP을 생성한다.
7. ZIP을 다시 열어 internal validator와 source expectation을 실행한다.
8. byte hash와 logical package hash를 계산한다.
9. utility-owned create-new temp에 쓰고 fsync/hash 검증 후 지정된 stage에 persist한다.

Progress stage는 `PUBLICATION_IR`, `CONTENT_SPLIT`, `XHTML_GENERATION`,
`PACKAGE_DOCUMENTS`, `ZIP_PACKAGING`, `INTERNAL_VALIDATION`, `WRITE_OUTPUT`, `COMPLETE`다.
`WRITE_OUTPUT`은 utility가 create-new temp를 소유한 뒤에만 시작한다.

## 4. Desktop orchestration

Renderer는 metadata를 먼저 저장하고 current project revision을 얻는다. Main은 다음을
독립적으로 다시 확인한다.

- session과 request의 exact key/shape
- project ID, revision, scope 존재와 Publication IR hash
- canonical metadata/preset/cover와 request 일치
- utility terminal result와 requested operation/profile/path 일치
- internal report `VALID`, fatal/error 0
- source/exported section, block, character, scene-break, ruby와 heading coverage
- staged file의 bounded streamed size/SHA-256

Output picker에서 기존 파일을 고르면 그 시점의 size/SHA-256 identity를 보관한다. Export
완료 전에 identity를 다시 비교하므로 선택 이후 다른 process가 바꾼 파일을 덮어쓰지
않는다. Operation 전용 staging directory는 destination directory 안에 create-new로
만들며 이름 충돌 시 기존 경로를 지우지 않고 실패한다.

새 destination은 stage file을 hard-link하여 no-clobber를 보장한 뒤 owned stage를
정리한다. 사용자 확인을 거친 기존 destination은 동일 디렉터리 rename으로 교체한다.
완료된 operation ID는 tombstone하여 재사용하지 않는다.

## 5. 취소와 종료

Main은 operation을 `PREPARING`, `EXPORTING`, `FINALIZING`으로 추적한다. PREPARING cancel은
utility spawn 전에 표시되고, EXPORTING cancel은 child를 종료한다. Utility client의 run
promise는 child `close`와 temp cleanup이 끝난 뒤에만 settle한다. Timeout은 10분이며
15초 close grace 뒤 강제 종료하고 5초를 더 기다린다.

App quit은 renderer close가 승인된 뒤 `will-quit`에서 모든 EPUB IPC completion,
operation completion과 owned temp cleanup을 기다린다. Cleanup 실패는 조용히 성공으로
바꾸지 않는다.

## 6. UI와 report

EPUB mode는 lazy chunk다. Metadata, scope, profile, split, TOC/title/cover/token options,
preset CRUD, validation, progress/cancel, report 저장, output reveal을 제공한다. Project,
snapshot 또는 mode 전환 전에 dirty metadata와 active auxiliary/export operation을
정리한다. Session/revision/config fingerprint가 달라진 stale validation/export 결과는
표시하지 않는다.

JSON과 Markdown report는 profile, project revision, Publication hash, EPUB hash, file/XHTML,
coverage, cover, validation, timing, 생성 시각, Madi/EPUBCheck version을 담되 원고 본문은
담지 않는다. EPUBCheck field는 build/test-only 전략을 명시한다.

## 7. 보안 경계

- XML은 raw HTML을 받지 않고 문자열 단위로 escape한다.
- CSS는 3×3×3 closed token 조합으로만 생성한다.
- Script, active element/attribute, remote scheme/resource와 외부 font를 허용하지 않는다.
- ZIP path는 relative forward-slash path만 허용하며 duplicate/traversal/drive path를
  거부한다.
- Cover는 main과 core에서 bounded-read하고 core에서 magic/decode/dimension/hash를
  검증하며 exporter가 decode 후 PNG/JPEG로 재인코딩한다.
- Packaged app은 package-owned exporter path만 사용하고 environment override를 무시한다.
- Runtime network, 자동 download와 외부 validation 서버는 없다.

## 관련 문서

- [Publication IR v1](./PUBLICATION_IR_V1.md)
- [Package layout](./EPUB_PACKAGE_LAYOUT.md)
- [Validation strategy](./EPUB_VALIDATION_STRATEGY.md)
- [ADR-0007](./decisions/ADR-0007-exporters-consume-publication-ir-only.md)
