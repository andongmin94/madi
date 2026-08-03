# Entity 본문 언급 후보 탐색

기준일: 2026-08-02

## 목적

언급 탐색은 entity 이름과 별칭이 장면 본문에 나타나는 위치를 찾는 보조 기능이다.
결과는 관계나 실제 등장 사실을 뜻하지 않으며 canonical Story Bible data로 자동
저장하지 않는다.

UI에서는 결과를 **본문에서 찾은 후보**로 표시한다.

## 입력

선택 entity의 다음 문자열을 사용한다.

1. entity name
2. 모든 alias 원문

빈 문자열은 허용하지 않고 같은 문자열은 중복 제거한다. Alias의 normalized 값은
중복 constraint용이며 실제 검색과 사용자 표시는 보존된 원문을 사용한다.

## 검색 의미

Phase 1B의 검증된 exact substring 검색을 재사용한다.

- 저장 완료된 `documents.plain_text_recovery`/`search_documents` 기준
- SCENE document 본문만 대상
- Unicode scalar offset
- non-overlapping occurrence
- 일치 전후 문맥
- 일치한 name/alias 원문 표시
- 장면별 deduplication

한 장면에서 여러 alias 또는 여러 occurrence가 발견되면 `(start, end, 검색어 순서)`로
가장 이른 match 하나를 대표 후보로 반환한다. 따라서 장면별 candidate는 최대 하나이고
`matched_alias`에는 실제 대표 name/alias가 들어간다. 결과 클릭은 해당 SCENE으로
이동해 그 정확한 첫 범위를 선택한다.

## 명시적 link와 분리

자동 후보는 `scene_entity_links`에 insert하지 않는다. Canonical 연결은 사용자가 후보의
**명시적 연결로 승격** 동작을 선택하고 role을 확정한 뒤에만 만들어진다.

승격은 다음을 다시 검증한다.

- scene node가 실제 SCENE임
- scene과 entity의 project가 같음
- role이 `APPEARS`, `POV`, `MENTIONED`, `RELATED` 중 하나임
- 동일 scene/entity/role link가 아직 없음

승격 뒤에도 원래 자동 후보는 본문에서 계산된 검색 결과로 남을 수 있다. 두 데이터의
출처는 UI와 API에서 계속 구분한다.

## Alias 변경

Alias CRUD는 project revision을 증가시킨다. 이후 mention request는 현재 entity name과
alias 목록을 다시 읽으므로 삭제한 alias 결과는 사라지고 추가한 alias 결과는 즉시
반영된다. 별도 canonical mention index나 relation을 만들지 않는다.

## False positive

한국어는 조사 결합과 불완전한 word boundary가 있고 짧은 이름은 다른 단어의 일부일 수
있다. Exact substring 검색은 누락 방지를 우선하므로 false positive가 가능하다.

예를 들어 entity 이름 `강`은 지명, 성씨, 일반 명사의 일부를 모두 찾을 수 있다. UI는
이를 사실이나 등장 횟수로 단정하지 않고 후보임을 짧게 알린다.

## 성능과 제한

현재 검색은 entity 하나의 name/alias 집합을 scope 전체 scene recovery에 대해 선형
탐색한다. 결과 크기와 context 길이는 core에서 제한한다. 형태소 분석, word-boundary
추론, 오탈자/활용형 검색, fuzzy search, 자동 관계 추론과 LLM 추출은 Phase 1C 범위가
아니다.
