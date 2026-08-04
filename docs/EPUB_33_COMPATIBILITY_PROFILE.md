# EPUB 3.3 compatibility profile

기준일: 2026-08-09

Profile ID: `EPUB_3_3_COMPATIBILITY`

참조: <https://www.w3.org/TR/epub-33/>

## 상태와 UI 문구

```text
EPUB 3.3 호환
현재 안정 규격과 EPUBCheck production validator를 기준으로 생성합니다.
```

Validation 표시는 `EPUBCheck 5.3.0 검증`이다. 이 문구는 Phase 1G의 pinned build/test
validator 결과를 뜻하며 앱 runtime에서 Java를 실행한다는 뜻이 아니다.

## 생성 contract

3.3 profile은 3.4 profile과 같은 보수적 공통 EPUB 3 subset을 사용한다.

- OPF package `version="3.0"`, stable unique identifier
- UTF-8 XHTML, `xml:lang`과 `lang`
- `nav.xhtml`의 `epub:type="toc"`
- manifest의 nav/CSS/content와 optional PNG/JPEG `cover-image`
- Binder logical order와 일치하는 spine와 TOC
- local built-in CSS, relative resource path, script/remote resource 없음

CHAPTER split이 기본이며, 선택 scope에 chapter heading이 없으면 scene별 파일로 fallback한다.
명시적 SCENE split은 항상 scene별 content document를 만든다. Filename은 title이 아니라
logical order와 stable key의 SHA-256 12자리 suffix로 만든다.

## validation gate

Export success 자체는 Madi internal validator의 PASS와 block/character completeness를
요구한다. 별도 `pnpm test:epubcheck`는 exact EPUBCheck 5.3.0 distribution과 exact Temurin
JRE 21.0.11+10의 size/SHA-256을 먼저 확인한 뒤, CHAPTER와 SCENE fixture를 각각 실제
`.epub`으로 생성해 EPUBCheck JSON report의 fatal/error 0을 확인한다.

EPUBCheck 결과가 warning/info를 포함할 때는 count와 구조화 message를 보존한다. Java
exception, unbounded stdout/stderr 또는 원고 본문을 제품 UI에 전달하지 않는다.

## 호환성 우선순위

Phase 1G는 AVIF, scripting, remote/embedded font, fixed layout, media overlay와 3.4 전용
markup을 넣지 않는다. EPUBCheck PASS가 모든 reading system이나 출판사 acceptance를
보장하지 않으므로 target 유통처의 별도 요구사항은 export 전에 확인해야 한다.

## 관련 문서

- [EPUB 3.4 Draft profile](./EPUB_34_DRAFT_PROFILE.md)
- [Validation strategy](./EPUB_VALIDATION_STRATEGY.md)
- [Package layout](./EPUB_PACKAGE_LAYOUT.md)
