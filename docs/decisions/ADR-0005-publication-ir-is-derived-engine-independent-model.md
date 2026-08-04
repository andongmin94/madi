# ADR-0005: Publication IR은 파생된 engine-independent model이다

- Status: Accepted for Phase 1F private-local development
- Date: 2026-08-09
- Decision scope: canonical manuscript source, Typie adapter boundary, Publication IR persistence와 consumer contract

## Context

Madi 원고의 canonical 본문은 pinned Typie changeset snapshot이다. Reader Lab과 향후
exporter는 paragraph, scene break, quote, inline style와 source navigation이 필요하지만
Typie `Dot`, changeset, `DocView`, modifier와 editor DOM은 출판 소비자 계약으로 적합하지
않다.

Typie runtime type을 renderer/IPC/exporter에 직접 노출하면 다음 문제가 생긴다.

- Editor engine commit/schema 변경이 모든 consumer와 file format에 전파된다.
- Synthetic scaffold, insertion carry와 projection repair 상태가 authored semantics로
  오인될 수 있다.
- Plain-text recovery나 renderer state가 canonical manuscript와 경쟁한다.
- Source range를 text search로 추측해 잘못된 block으로 이동할 수 있다.
- 지원하지 않는 node/modifier가 consumer마다 다르게 누락될 수 있다.
- Reader preset/layout 변경이 manuscript compile과 결합된다.

## Decision

1. Canonical manuscript source는 `documents.snapshot_blob`의 pinned Typie changeset
   snapshot이다. `plain_text_recovery`, search projection과 editor DOM을 compile source로
   사용하지 않는다.
2. Typie-dependent decode/projection 구현은 `madi-publication`의 private adapter module에
   격리한다. Public boundary는 opaque bytes와 Madi-owned semantic/Publication DTO만
   노출한다.
3. Adapter는 lossless decode, unresolved changeset 없음, non-degraded projection을
   요구한다. 조건을 만족하지 못하면 compile을 실패시킨다.
4. Supported body subset은 Paragraph, ThreeDiamonds SceneBreak와 paragraph-based Quote다.
   Supported inline subset은 Text, Strong, Emphasis, Underline, Strike와 Ruby다.
5. Unsupported block은 source identity와 plain-text fallback을 가진 `UNSUPPORTED` block과
   diagnostic으로 남긴다. Unsupported modifier는 text/지원 style을 보존하고 diagnostic을
   남긴다. 조용히 삭제하지 않는다.
6. Synthetic un-authored scaffold만 제외한다. Synthetic node 아래 authored content는
   degraded projection으로 실패하며 authored empty paragraph는 zero-length caret range로
   보존한다.
7. Raw Typie `Dot`은 공개하지 않는다. Document ID, dot과 versioned namespace로 public
   source block hash ID를 만들고, final block/section도 versioned length-prefixed hash
   identity를 쓴다.
8. Source range는 independent annotated-prose reconstruction이 Typie 결과와 exact match할
   때만 verified다. Verified `start == end`는 authored caret boundary로 유효하다. Heading과
   unverified source는 null range와 compiler-selected scene fallback을 쓴다.
9. Binder hierarchy는 level 1~4 heading으로 파생한다. Heading의 `sourceNodeId`는 actual
   WORK/VOLUME/CHAPTER/SCENE node이고 target scene/document는 first descendant mapping이다.
10. Scope는 Binder의 `SCENE`, `CHAPTER`, `VOLUME`, `WORK`만 허용하고 tree order의 scene
    descendant만 compile한다.
11. Publication IR은 저장하지 않는다. 원고/scope revision마다 canonical snapshot에서
    다시 만들며 Reader preset, UI state와 named snapshot payload에 넣지 않는다.
12. Canonical JSON은 object key를 재귀 정렬하고 array order를 보존한다. Exact UTF-8
    bytes의 SHA-256을 전체 IR `contentHash`로 쓴다.
13. Story Bible/Entity note, Canvas, World Graph, search projection과 외부 resource는
    Publication scope에 자동 결합하지 않는다.
14. Rust core, Electron main과 renderer는 version/union/key/range/stat/safety budget을
    각각 strict-validate한다.

## Consequences

### Positive

- Reader와 exporter는 Typie internals 없이 동일한 semantic document를 소비할 수 있다.
- Canonical editor snapshot과 recovery/UI projection의 소유권이 분명해진다.
- Stable public IDs와 verified range로 preview, diagnostic과 source navigation을 연결할 수
  있다.
- Unsupported 의미가 fallback과 diagnostic으로 관찰되며 silent content loss를 막는다.
- Reader profile 변경은 같은 IR에 독립적으로 적용되어 manuscript recompile을 요구하지
  않는다.
- IR을 저장하지 않아 canonical source와 derived cache가 불일치하는 복구 문제가 없다.

### Trade-offs

- Supported semantic subset 밖의 node/format은 full-fidelity render 대신 fallback이 된다.
- Typie commit/schema가 바뀌면 private adapter와 fixture를 명시적으로 갱신해야 한다.
- Exact range 검증 실패는 일부 위치를 추측해 보여 주는 대신 compile 전체를 실패시킨다.
- IR hash는 project revision을 포함하므로 body text만의 fingerprint가 아니다.
- Story Bible note, Canvas와 planning data는 출판 문맥에 자동으로 나타나지 않는다.

## Rejected alternatives

### Typie snapshot/type을 Publication 공개 계약으로 사용

Engine-specific operation graph와 view type이 desktop IPC, renderer와 exporter에 전파되고
engine upgrade가 file/consumer format upgrade가 되므로 거부한다.

### `plain_text_recovery`에서 paragraph를 재구성

Recovery text는 emergency/search projection이며 semantic block, modifier, authored empty
paragraph와 stable identity를 보존하지 않는다. Canonical snapshot 대신 사용할 수 없다.

### Renderer에서 열린 editor instance를 export

Closed scene/entity owner, dirty flush, background compile과 future headless exporter를
지원할 수 없고 transient DOM/selection을 canonical semantics로 오인하므로 거부한다.

### Text search로 source range를 추측

동일 문장, empty block과 scene-break boundary에서 잘못된 occurrence를 가리킬 수 있다.
Annotated prose round-trip으로 검증한 exact/caret range 또는 scene fallback만 사용한다.

### Unsupported node를 건너뛰기

Consumer 화면에서 내용이 이유 없이 사라지고 통계/hash도 source 의미와 달라지므로
거부한다. Fallback block과 diagnostic을 함께 남긴다.

### Publication IR을 SQLite/snapshot에 저장

Canonical snapshot과 derived JSON의 이중 source, invalidation과 migration 부담을 만들기
때문에 거부한다. IR은 deterministic하게 다시 compile한다.

### Story Bible/Canvas/Graph를 작품 전체 scope에 자동 포함

설정 note와 planning edge/layout은 manuscript가 아니며 작가가 승인하지 않은 출판
내용이 될 수 있다. 명시적인 미래 출판 모델 결정 없이 결합하지 않는다.

## Compatibility

Publication IR은 version 1 exact 계약으로 시작한다. Unknown field, block/inline variant,
scope kind와 version은 compatibility alias나 fallback으로 받지 않는다. 새 engine adapter,
semantic block 또는 source 규칙은 versioned contract와 validator/consumer를 함께 바꾸는
별도 결정이 필요하다.

IR은 persisted row가 아니므로 legacy derived document migration을 제공하지 않는다.
Canonical manuscript snapshot의 기존 migration/engine pinning은 별도 저장 계약을 따른다.

## Distribution note

이 ADR은 비공개 로컬 publication boundary를 결정하며 배포나 exporter 제공을 승인하지
않는다. 배포 전 결정은
[license decision record](../LICENSE_DECISION_REQUIRED.md)를 따른다.

## Related documents

- [Publication IR v1](../PUBLICATION_IR_V1.md)
- [Phase 1F scope](../PHASE_1F_SCOPE.md)
- [Reader Lab architecture](../READER_LAB_ARCHITECTURE.md)
- [ADR-0006: isolated non-executable rendering](./ADR-0006-reader-lab-rendering-is-isolated-and-non-executable.md)
