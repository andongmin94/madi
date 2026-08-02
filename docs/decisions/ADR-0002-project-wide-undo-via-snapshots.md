# ADR-0002: 프로젝트 전체 Undo는 safety snapshot 복원으로 제공한다

- 상태: Accepted
- 결정일: 2026-08-02
- 적용 범위: Phase 1B 이후의 다중 장면 일괄 작업

## 배경

단일 장면 편집은 하나의 Typie 문서와 편집 history 안에서 이루어지므로 Typie의
Undo/Redo 의미가 명확하다. 반면 다중 장면 일괄 치환은 여러 독립 문서, SQLite
transaction, 검색 projection과 현재 editor generation을 동시에 바꾼다. 이를 장기간
지속되는 project-wide command log로 표현하면 문서 포맷과 런타임 버전 사이의 복구
계약이 복잡해지고 파일 크기와 장기 호환성 부담이 커진다.

## 결정

- 단일 장면 편집은 Typie Undo/Redo를 사용한다.
- 한 장면 안의 치환은 하나의 Typie transaction과 Undo entry로 기록한다.
- 다중 장면 일괄 작업은 적용 직전에 `AUTO_BEFORE_REPLACE` safety snapshot을 만든다.
- 프로젝트 전체 복원은 named snapshot restore transaction을 사용한다.
- 영구 project-wide command log는 구현하지 않는다.
- 사용자에게는 자동 snapshot을 대상으로 하는 **전체 치환 전 상태로 되돌리기** UI를
  제공한다.
- 실제 사용자 요구와 사용성 증거가 확인될 때만 이 결정을 재검토한다.

이 동작은 임시 fallback이나 기술적 미완료가 아니라 madi의 공식 제품 동작이다.

## 이유

1. 여러 독립 Typie history와 SQLite revision을 하나의 영구 command log로 결합하는
   복잡성을 피한다.
2. command payload가 누적되어 `.madi` 파일 크기가 제한 없이 증가하는 것을 피한다.
3. Typie snapshot/runtime upgrade 뒤에도 과거 command를 재실행해야 하는 장기 호환성
   의무를 만들지 않는다.
4. 실행 명령의 역연산보다 hash가 검증된 전체 logical snapshot restore가 복구 경계를
   단순하고 신뢰성 있게 만든다.

## 결과

- 다중 장면 치환은 적용 전 snapshot 생성과 원자적 DB commit을 필수로 한다.
- 실패 중간 상태는 transaction rollback으로 제거한다.
- commit 후 사용자가 되돌리기를 선택하면 해당 safety snapshot을 복원하며, 복원
  직전에도 `AUTO_BEFORE_RESTORE` snapshot을 만든다.
- 여러 장면을 한 번에 바꾼 작업은 `Ctrl+Z` 한 번으로 되돌리지 않는다.
- Phase 1B의 이 항목은 기술적 조건이 아니므로 판정은
  `TECHNICAL GO — PRIVATE LOCAL`로 확정한다.

## 재검토 조건

실제 사용자 조사에서 snapshot 복원 UX로 해결되지 않는 반복적 project-wide Undo
요구가 확인되고, 파일 크기·호환성·복구 신뢰성에 대한 별도 설계와 migration 계획이
승인될 때만 재검토한다.
