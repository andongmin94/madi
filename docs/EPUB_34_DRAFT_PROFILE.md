# EPUB 3.4 Draft profile

기준일: 2026-08-09

Profile ID: `EPUB_3_4_DRAFT_2026_08`

참조: <https://www.w3.org/TR/epub-34/>

## 상태와 UI 문구

이 profile은 2026년 8월의 W3C EPUB 3.4 Candidate Recommendation Draft를 대상으로 한다.
EPUB 3.4를 최종 W3C Recommendation이라고 주장하지 않는다.

```text
EPUB 3.4 Draft
현재 W3C Candidate Recommendation Draft를 기준으로 생성합니다.
출판사와 유통처가 요구하는 버전을 먼저 확인하세요.
```

Validation 표시는 다음과 같다.

```text
madi EPUB 3.4 Draft 내부 검증
EPUBCheck 5.3.0 보조 호환성 검사
```

EPUBCheck 5.3.0은 3.4 전체 검증기가 아니다. 현재 앱 runtime에는 EPUBCheck를 넣지
않았으므로 app report는 `NOT_RUN` 또는 `UNAVAILABLE`과 `보조 호환성 검사` 경계를
표시한다. 필수 `pnpm test:epubcheck` actual은 3.3 CHAPTER/SCENE output을 검증하며 3.4
profile output에 대한 EPUBCheck 실행을 PASS로 주장하지 않는다.

## 생성 subset

Phase 1G compiler는 3.3과 3.4에서 함께 유효한 reflowable EPUB 3 subset을 우선한다.
Package document의 `version`은 EPUB 3 package contract의 `3.0`이며, profile ID를 OPF에
임의의 `3.4` 문자열로 쓰지 않는다.

공통 subset은 다음으로 제한한다.

- container rootfile 한 개: `EPUB/package.opf`
- XHTML content document와 EPUB navigation document
- Dublin Core identifier/title/creator/language, `dcterms:modified`
- optional publisher/description/rights/subject
- linear spine, local CSS, optional PNG/JPEG `cover-image`
- script 없는 reflowable content
- remote/embedded font, media overlay, fixed/roll layout 없음

Phase 1G는 3.4 전용 feature를 하나도 사용하지 않는다. 따라서 “3.4” 이름을 위해 3.3
호환성을 줄이는 element/property를 추가하지 않는다.

## deterministic 규칙

`dcterms:modified`는 project revision을 2000-01-01T00:00:00Z 기준 초 offset으로 변환한다.
ZIP entry timestamp, entry/XML order, filename과 source ID가 고정되므로 동일 revision,
metadata, preset, IR과 cover bytes는 byte-identical output을 만든다. File SHA-256과 별도로
path+uncompressed bytes 기반 `logicalPackageHash`도 기록한다.

## 검증과 migration

Madi internal validator는 container/package/nav/XHTML/assets/coverage의 공통 subset을
검사하며 선택 profile identity를 report에 보존한다. 향후 EPUB 3.4 final Recommendation
또는 이를 완전 지원하는 EPUBCheck release를 도입할 때에는 기존 profile ID의 의미를
조용히 바꾸지 않고 새 profile/version, preset migration과 regression EPUB을 함께
추가한다.

## 알려진 한계

- 3.4 전용 feature conformance를 주장하지 않는다.
- Publisher/유통처별 acceptance policy를 검사하지 않는다.
- Runtime EPUBCheck와 bundled Java는 없다.
- Imported EPUB, fixed layout, vertical writing, embedded font와 scripting은 지원하지 않는다.

## 관련 문서

- [EPUB 3.3 compatibility profile](./EPUB_33_COMPATIBILITY_PROFILE.md)
- [Validation strategy](./EPUB_VALIDATION_STRATEGY.md)
- [ADR-0008](./decisions/ADR-0008-epub-34-draft-and-33-compatibility-dual-profile.md)
