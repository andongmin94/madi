# Entity relation 의미 계약

기준일: 2026-08-02

## Canonical relation

`entity_relations`의 한 행이 하나의 canonical relation이다. UI의 outgoing/incoming 또는
inverse 표시는 같은 행의 view이며 별도 역방향 행을 생성하지 않는다.

모든 relation mutation은 다음을 검증한다.

- source와 target entity가 존재하고 같은 project에 속함
- relation type이 같은 project에 속함
- source와 target이 다름
- 동일한 canonical relation이 없음
- 예상 project revision과 일치함

## Directed relation

`directed = true`이면 `(source, type, target)` 순서를 보존한다. Source 상세에서는 relation
type의 `name`으로 outgoing 표시하고 target 상세에서는 `inverse_name`이 있으면 이를,
없으면 원래 이름을 incoming label로 사용한다.

예:

```text
레이아 --소속--> 북부 마법사단
북부 마법사단 <--구성원을 가짐-- 레이아
```

두 표시는 하나의 DB row다. 역방향 relation은 별개의 의미이므로 사용자가 명시적으로
만들 수 있지만, 완전히 같은 source/type/target 중복은 거부한다.

## Undirected relation

`directed = false`이면 endpoint 두 개를 논리적으로 정렬한 canonical key로 비교한다.
따라서 `(A, type, B)`와 `(B, type, A)`는 중복이며 두 번째 생성을 거부한다. 양쪽 entity
상세에서 같은 relation id를 표시하고 어느 쪽에서 삭제해도 canonical row 하나를
삭제한다.

## Built-in relation types

새 project와 schema migration project에 다음 의미의 built-in type을 idempotent하게
seed한다.

- 관련됨 / 관련됨
- 동맹 / 동맹
- 적대 / 적대
- 가족 / 가족
- 소속 / 구성원을 가짐
- 위치함 / 포함함
- 소유함 / 소유됨
- 원인 / 결과
- 암시함 / 암시됨
- 회수함 / 회수됨

Builtin type의 이름과 표현 속성은 수정할 수 있지만 완전 삭제는 제한한다. Custom type은
사용 중이지 않을 때만 삭제할 수 있다. 사용 중인 relation type 삭제는 명시적으로
거부하며 relation을 암묵적으로 다른 type으로 바꾸지 않는다.

## Cascade와 transaction

Entity 삭제 확인에는 연결 relation 수를 포함한다. 확인된 삭제는 relation, alias,
entity-tag link, scene link와 entity note document를 한 transaction에서 정리한다.
본문 원고와 자동 mention 후보는 수정하지 않는다.

Transaction 실패 시 relation의 한쪽 view만 사라지거나 inverse row가 고아로 남는 부분
상태는 허용하지 않는다.

## 확장 경계

Phase 1C에서는 self relation을 허용하지 않는다. Relation type별 self-relation 정책,
유효 시간 범위, 관찰자별 지식 상태, 자동 relation 추론과 그래프 시각화는 후속 단계다.
