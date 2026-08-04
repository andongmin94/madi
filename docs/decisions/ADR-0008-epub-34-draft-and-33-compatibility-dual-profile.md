# ADR-0008: EPUB 3.4 Draft와 3.3 compatibility를 이중 profile로 제공한다

- Status: Accepted for Phase 1G private-local development
- Date: 2026-08-09
- Decision scope: EPUB target identity, markup subset, validator와 future migration

## Context

2026년 8월 기준 EPUB 3.4는 W3C Candidate Recommendation Draft target이고 EPUB 3.3은
안정 compatibility target이다. EPUBCheck 5.3.0은 production 3.3 validator지만 완전한
3.4 validator로 취급할 수 없다. 하나의 “최신 EPUB” label은 draft/validator 경계를
숨기며, 3.4 이름만 위해 전용 feature를 넣으면 출판사/reading-system 호환성을 줄인다.

## Decision

1. `EPUB_3_4_DRAFT_2026_08`과 `EPUB_3_3_COMPATIBILITY` 두 stable profile ID를 둔다.
2. 3.4 UI에는 `EPUB 3.4 Draft`와 Candidate Recommendation Draft 경고를 표시한다.
3. 3.3 UI에는 `EPUB 3.3 호환`과 stable spec/production validator 설명을 표시한다.
4. Compiler는 두 profile에 유효한 reflowable EPUB 3 공통 subset을 우선한다.
5. Phase 1G에는 3.4 전용 feature를 사용하지 않는다. Package `version="3.0"`을 쓰고
   script/font/fixed-layout 등 비필수 feature를 배제한다.
6. EPUBCheck 5.3.0은 3.3 build/test validation에 사용한다.
7. 3.4는 Madi internal validator가 success gate이며 EPUBCheck 5.3.0은 공통 subset의 보조
   compatibility 검사로만 표시한다.
8. EPUBCheck/JRE는 exact pinned build/test tool이고 앱 runtime/package에는 넣지 않는다.
9. EPUB 3.4를 최종 Recommendation 또는 EPUBCheck 완전 지원으로 오인시키는 문구를
   금지한다.
10. 향후 3.4 final과 validator 지원 시 기존 draft ID의 의미를 바꾸지 않고 새 profile,
    preset migration과 actual gate를 추가한다.

## Consequences

### Positive

- 사용자가 draft target과 안정 compatibility target을 명시적으로 선택한다.
- 공통 subset으로 reading-system 호환성과 test surface를 단순하게 유지한다.
- Validator가 실제 지원하는 범위를 UI/report가 과장하지 않는다.
- Profile ID에 기준 시점이 있어 향후 spec 변경을 추적할 수 있다.

### Trade-offs

- 현재 두 profile의 package bytes는 동일 option/metadata에서 공통 subset으로 같을 수 있다.
- 3.4 전용 capability를 원하는 사용자는 Phase 1G에서 얻지 못한다.
- Runtime에서 EPUBCheck를 바로 실행하지 않으며 build/test 증거와 app internal report를
  구분해야 한다.
- 출판사별 acceptance는 별도 확인이 필요하다.

## Rejected alternatives

### 3.4 하나만 제공

Draft 상태와 3.3 production validator/유통 호환 요구를 숨기므로 거부한다.

### 3.3 하나만 제공

명시적으로 승인된 3.4 draft target의 추적과 미래 migration 경로를 제공하지 못하므로
거부한다.

### EPUBCheck 5.3.0을 3.4 완전 validator로 표시

지원 범위를 과장하므로 거부한다.

### Profile 이름을 위해 3.4 전용 markup 추가

현재 제품 요구가 없고 3.3/reading-system 호환성 비용만 늘리므로 거부한다.

### Java/JAR를 즉시 runtime bundle

Package 크기, JRE security update와 transitive license/lifecycle 부담을 private-local 단계에
도입하므로 거부한다. 향후 별도 packaging 결정으로 재평가할 수 있다.

## Compatibility와 migration

Preset v1은 exact profile ID를 저장한다. EPUB 3.4 final은 draft ID를 같은 이름으로
재해석하지 않는다. 새 profile을 추가하면 preset validator/UI/report, compiler expectation,
internal/EPUBCheck strategy와 snapshot fixtures를 함께 갱신한다.

## Distribution note

Dual profile은 배포 승인이 아니다. Windows native IME는 `MANUAL VALIDATION PENDING`, Typie는
`HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`, public/paid/customer distribution은
`NOT AUTHORIZED`다.

## Related documents

- [EPUB 3.4 Draft profile](../EPUB_34_DRAFT_PROFILE.md)
- [EPUB 3.3 compatibility profile](../EPUB_33_COMPATIBILITY_PROFILE.md)
- [EPUB validation strategy](../EPUB_VALIDATION_STRATEGY.md)
