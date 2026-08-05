# HWPX Export Architecture

기준일: 2026-08-13

## 1. 소유권 경계

`crates/madi-export-hwpx`의 원고 입력은 `madi_publication::PublicationDocument v1`뿐이다.
Rust crate는 `.madi` 파일, Typie snapshot/type, renderer DOM이나 Reader Lab을 열지 않는다.
Electron main이 현재 session/revision/scope, metadata와 preset identity를 다시 검증하고
core에서 compile한 IR을 strict JSONL request로 utility에 전달한다.

```text
renderer (untrusted request)
  → preload exact contract
  → Electron main: session/revision/preset/output revalidation
  → madi-core: Publication IR compile
  → madi-export-hwpx: map/style/package/validate
  → main: report/coverage/hash/destination revalidation
  → same-directory staged replacement with persistent compensation journal
```

Generated HWPX/HWP는 derived delivery artifact다. `.madi` 또는 named snapshot에는 closed
HWPX preset만 canonical data로 들어간다.

## 2. Rust compiler 층

Compiler는 다음 순서로 동작한다.

1. Request와 Publication IR identity/hash/limits 검증
2. Binder heading과 body block을 deterministic paragraph/run model로 mapping
3. font/char/paragraph/style table 생성
4. section별 `sectionN.xml` 생성
5. version/header/settings/HPF/container/RDF/manifest 생성
6. 고정 순서·timestamp·permission의 ZIP 생성
7. ZIP reopen
8. package와 source-coverage internal validation
9. file SHA-256와 logical package hash 반환
10. EXPORT mode에서 operation-owned temporary path를 거쳐 output 생성

`VALIDATE_ONLY`는 동일한 compile/package/validator를 실행하지만 destination file을 만들지
않는다. Utility progress stage는 Publication IR, style table, section XML, package documents,
ZIP, validation, write, complete다.

## 3. Process contract

Stdin은 한 줄의 UTF-8 JSON이며 unknown field를 거부한다. Request는 operation/mode,
Publication IR, project/scope/revision/source hash, preset ID/hash, metadata, closed options와
absolute output path를 포함한다. Stdout은 `PROGRESS`, terminal `RESULT` 또는 typed `ERROR`
JSONL뿐이다. Stderr는 diagnostic transport로 신뢰하지 않는다.

Main client는 stdout line/total byte, enum, path, integer, hash, validation count와 terminal
identity를 다시 검증한다. Child timeout/cancel/dispose는 process close와 owned temporary
cleanup이 끝난 뒤 settle한다.

## 4. Electron trust boundary

- Renderer는 absolute path나 executable path를 받지 않는다.
- Output picker가 opaque selection ID와 filename/output type만 반환한다.
- Main은 selection 당시 destination의 존재/size/hash와 commit 직전 identity를 비교한다.
- Packaged app은 `resources/bin/madi-export-hwpx.exe`를 고정 사용하고 development env
  override를 무시한다.
- HWP 요청은 HWPX validation/commit 이후 별도 bridge capability로 진행한다.
- Report에는 one-shot contact와 원고 본문을 넣지 않는다.

## 5. Atomic output

Rust utility와 Electron main의 temporary ownership을 구분한다. Utility는 지정한 staging
`.hwpx`만 만들고 main이 final destination을 commit한다. 신규 destination은 no-clobber,
기존 destination은 picker에서 확인한 동일 file일 때만 replace한다. Collision이나 identity
변경은 typed failure이고 foreign path를 삭제하지 않는다.

Overwrite는 handle에서 얻은 volume serial, 128-bit file ID, byte length와 SHA-256을 picker
identity로 기록한다. Main은 same-directory staging에 immutable PREPARED intent를 exclusive
create하고 flush한 뒤 `madi-atomic-output`의 flags=0 `ReplaceFileW` 한 번을 호출한다.
ReplaceFileW는 문서화된 여러 내부 단계를 결합한 OS 호출이며 strict linearizable CAS,
name visibility gap 부재 또는 power-loss durability를 보장한다고 주장하지 않는다. 실제
Windows observer에서도 호출 중 transient name absence가 관측됐다.

대신 helper는 destination/staged/private backup/private rollback의 handle identity를 같은
상태표로 reconcile한다. 선택 전 foreign B 치환은 backup B를 destination으로 되돌리고 S를
전용 rollback path에 보존한다. 호출 뒤 foreign C claim은 C를 덮지 않으며 A/B/S 중 보존할
artifact를 random no-clobber recovery sibling으로 복사·flush·재검증한다. 1175/1176/1177
실패 배치와 startup crash recovery도 동일 상태표를 쓰며 unknown/corrupt state는 registry와
staging cleanup을 금지한다.

HWP 변환은 이미 검증된 HWPX를 input으로 별도 operation-owned `.hwp` temporary file에
저장한 뒤 commit한다. 변환/재열기 실패는 HWPX를 rollback하거나 삭제하지 않는다.

## 6. Determinism

Deterministic input은 Publication hash, canonical preset hash와 metadata다. Entry order,
path, XML element/attribute generation order, source-derived IDs, ZIP timestamp, compression
method와 permission을 고정한다. `sha256`은 실제 ZIP bytes, `logicalPackageHash`는
`madi-hwpx-logical-package-v1` domain separator와 ordered `(path,length,bytes)`의 SHA-256다.

Hancom이 HWPX를 다시 저장하거나 HWP로 변환하면 producer metadata/compression/binary
layout이 달라질 수 있으므로 그 결과에 Madi ZIP byte determinism을 주장하지 않는다.

## 7. 관련 결정

- [Official profile 1.31](./HWPX_OFFICIAL_PROFILE_1_31.md)
- [Package layout](./HWPX_PACKAGE_LAYOUT.md)
- [Validation strategy](./HWPX_VALIDATION_STRATEGY.md)
- [ADR-0009](./decisions/ADR-0009-hwpx-exporter-consumes-publication-ir-only.md)
- [ADR-0010](./decisions/ADR-0010-hwp-output-uses-local-hancom-conversion.md)
