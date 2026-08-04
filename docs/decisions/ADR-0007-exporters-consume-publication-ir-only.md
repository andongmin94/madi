# ADR-0007: Exporter는 Publication IR만 소비한다

- Status: Accepted for Phase 1G private-local development
- Date: 2026-08-09
- Decision scope: canonical manuscript, publication consumer와 generated artifact ownership

## Context

Typie snapshot은 Madi 편집 원본이며 engine operation graph와 pinned schema를 담는다.
Reader Lab과 exporter가 Typie snapshot/type 또는 renderer DOM을 각각 해석하면 의미 mapping,
unsupported fallback, source identity와 content coverage가 consumer마다 달라진다.

Generated EPUB은 전달용 파생 artifact다. 이를 `.madi` 또는 named snapshot의 canonical
원본처럼 저장하면 source revision과 export option, 외부 파일이 경쟁하는 이중 source가
된다.

## Decision

1. Typie snapshot과 Binder가 canonical 편집 원본이다.
2. `madi-publication`의 private Typie adapter만 snapshot을 해석한다.
3. `PublicationDocument v1`은 Reader Lab과 모든 exporter의 Madi 소유 공통 입력이다.
4. EPUB exporter는 Typie crate/type/snapshot, editor/React/Reader DOM과 SQLite를 직접 읽지
   않는다.
5. Reader Lab과 EPUB은 heading, paragraph, quote, scene break, inline style, unsupported
   fallback과 stable source identity의 같은 의미 모델을 사용한다.
6. Export request는 project/scope/revision과 source Publication hash를 묶고 main/utility가
   각각 확인한다.
7. 모든 source block은 exported, safe fallback 또는 explicitly rejected 중 하나로
   accounting한다. Rejected 또는 character mismatch는 success가 아니다.
8. Generated EPUB, output path, validation cache/report와 last-export time은 `.madi`
   canonical data가 아니다.
9. Generated EPUB은 named snapshot payload에 넣지 않는다. Publication metadata, cover와
   export preset만 payload 5에 넣는다.
10. 새로운 exporter도 Publication IR contract를 소비하고 format별 compiler/validator를
    별도 모듈로 둔다.

## Consequences

### Positive

- Editor engine upgrade가 exporter public contract로 직접 전파되지 않는다.
- Reader와 EPUB 의미 mapping 및 source navigation이 일치한다.
- Headless Rust test와 Electron process boundary를 같은 fixture/hash로 검증할 수 있다.
- Unsupported content와 block/character loss를 정량적으로 차단한다.
- Generated file을 지워도 canonical 작품과 snapshot integrity가 손상되지 않는다.

### Trade-offs

- Publication IR이 아직 표현하지 않는 의미는 exporter가 full fidelity로 만들 수 없다.
- Typie와 Publication IR adapter, IR과 exporter validator를 각각 strict test해야 한다.
- Export 때 canonical snapshot에서 IR을 다시 compile하므로 derived cache보다 비용이 든다.
- Output history/재생성은 source revision과 preset을 사용해야 하며 snapshot에서 EPUB bytes를
  꺼낼 수 없다.

## Rejected alternatives

### Exporter가 Typie snapshot/type을 직접 읽기

Engine-specific schema가 exporter에 결합되고 Reader와 의미 mapping이 갈라지므로 거부한다.

### Renderer DOM 또는 Reader Lab DOM을 serialize

Visible/windowed DOM은 전체 원고가 아니며 UI marker/CSS와 실행 가능한 표면을 출판물로
오인하게 하므로 거부한다.

### `plain_text_recovery`에서 EPUB 생성

Semantic block/inline, stable source ID와 authored empty block을 보존하지 못하므로 거부한다.

### Generated EPUB을 `.madi`/snapshot에 저장

대용량 derived bytes, output/path/cache와 canonical source의 lifecycle을 결합하므로
거부한다.

## Compatibility

Publication IR v1 unknown field/variant는 fallback alias로 받지 않는다. IR 의미를 추가할
때에는 compiler, Reader/export mapping, coverage validator와 fixtures를 함께 version한다.
새 exporter format도 이 의존 방향을 우회할 수 없다.

## Distribution note

이 결정은 비공개 로컬 아키텍처만 승인한다. Typie는 계속
`HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`이며 public/paid/customer distribution은
승인되지 않았다.

## Related documents

- [Publication IR v1](../PUBLICATION_IR_V1.md)
- [EPUB export architecture](../EPUB_EXPORT_ARCHITECTURE.md)
- [Named snapshot format](../NAMED_SNAPSHOT_FORMAT.md)
