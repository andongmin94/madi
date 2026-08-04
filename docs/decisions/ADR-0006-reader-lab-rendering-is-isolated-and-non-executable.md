# ADR-0006: Reader Lab rendering은 isolated, non-executable이다

- Status: Accepted for Phase 1F private-local development
- Date: 2026-08-09
- Decision scope: Publication IR, Reader preview isolation, profile input, virtualization과 source navigation

## Context

Reader Lab은 작가 원고를 여러 device/profile로 비교해야 한다. 원고에는 사용자 문자열,
지원하지 않는 semantic node와 큰 scope가 들어올 수 있고, platform-like profile도 외부
앱의 executable HTML/CSS를 가져와서는 안 된다.

Editor DOM을 복제하거나 arbitrary HTML/CSS를 preset으로 받으면 다음 문제가 생긴다.

- 원고 문자열이나 import payload가 script, URL 또는 style injection 경로가 된다.
- App/editor CSS와 preview CSS가 서로 영향을 준다.
- Renderer library와 Typie runtime이 core/IPC 저장 계약에 결합된다.
- 큰 작품의 전체 DOM mount가 첫 화면과 keyboard navigation을 불안정하게 만든다.
- 외부 font/network 상태가 offline private-local 동작과 재현성을 깨뜨린다.
- 예상치만으로 전체 scope layout 문제를 실제 측정처럼 표시하게 된다.

## Decision

1. Core는 저장된 pinned Typie semantic snapshot을 `PublicationDocument v1`의 닫힌
   block/inline union으로 compile한다.
2. Renderer는 `PublicationDocument`를 read-only로 소비하며 editor DOM, Typie runtime
   object나 HTML fragment를 받지 않는다.
3. 원고 문자열은 React text node로만 렌더한다. `innerHTML`과
   `dangerouslySetInnerHTML`을 사용하지 않는다.
4. URL, anchor, script, iframe, webview, external stylesheet와 executable event field를
   Publication/profile 계약에 두지 않는다.
5. 각 pane은 고정 internal CSS를 가진 Shadow root에서 렌더한다. Shadow DOM은 CSS
   isolation이며 security sandbox 자체로 간주하지 않는다.
6. Profile은 exact versioned JSON과 enum/number/color token만 받는다. Font는 renderer가
   소유한 local/system stack token으로만 해석하고 font URL이나 CSS string을 받지
   않는다.
7. 지원하지 않는 node와 image는 실행하거나 임의 복원하지 않고 `UNSUPPORTED`
   plain-text fallback과 code diagnostic으로 내린다.
8. 큰 scope visible render는 section windowing을 사용한다. Full-scope render 통계는
   같은 Shadow CSS에서 section 하나씩 incremental 측정하며 전체 DOM을 동시에 mount하지
   않는다.
9. 1/2/3 pane은 하나의 immutable Publication IR을 공유하되 config, window, measurement와
   scroll progress를 독립 소유한다.
10. Scroll sync는 guarded normalized progress 동기화다. 서로 다른 layout 사이의 exact
    semantic/page alignment를 약속하지 않는다.
11. Source navigation은 compiler가 제공하고 validator가 확인한 source reference만
    사용한다. Verified range는 exact 위치, unverified range는 compiler target scene
    fallback으로 처리하며 source를 추측하지 않는다.
12. Core diagnostic은 code/severity/identity만 UI에 전달하고 renderer는 고정 문구로
    표현한다. Raw IPC message와 manuscript text를 diagnostic label로 사용하지 않는다.
13. Canonical preset은 named snapshot에 포함하지만 `reader-lab.v1` pane/layout/selection
    UI state는 포함하지 않는다.
14. Scope/preset/pane/source/diagnostic은 native control 또는 roving keyboard pattern을
    사용하고 hidden measurement DOM은 accessibility tree와 tab order에서 제외한다.
15. Packaged app은 renderer와 core sidecar를 package-owned path에서만 읽는다. 개발용
    renderer/core environment override는 무시하고 production CSP는 development WebSocket
    origin을 포함하지 않는다.

## Consequences

### Positive

- 원고와 preset 문자열이 executable DOM/CSS/network 입력이 되지 않는다.
- Preview CSS가 App/editor에 누출되지 않고 App CSS도 preview layout을 바꾸지 않는다.
- Core, main과 renderer가 같은 폐쇄형 DTO를 독립적으로 검증할 수 있다.
- Publication compile과 profile 비교가 분리되어 pane 설정 변경에 IR recompile이 필요하지
  않다.
- 큰 scope에서도 visible DOM과 measurement DOM의 크기가 section 단위로 제한된다.
- Full-scope line, height와 overflow를 estimator와 구분해 점진적으로 얻을 수 있다.
- Diagnostic 선택이 검증된 source identity를 통해 preview와 editor를 연결한다.
- Launch environment가 packaged renderer 또는 core 실행 source를 바꾸지 못한다.

### Trade-offs

- Shadow DOM만으로 격리가 완성되는 것은 아니므로 strict DTO와 semantic render 규칙을
  함께 유지해야 한다.
- 현재 union 밖의 semantic 표현과 image는 fidelity를 잃고 plain-text fallback이 된다.
- Local/system font metric 차이로 다른 OS에서 줄 수와 높이가 달라질 수 있다.
- Full-scope 측정은 첫 화면 뒤 점진적으로 완료되며 그 전에는 추정 상태를 명시해야 한다.
- Scroll sync는 서로 다른 device/config에서 같은 문장을 정확히 맞추지 않는다.
- 외부 플랫폼 UI/font를 직접 가져오지 않으므로 platform-like profile은 미검증
  simulation으로만 표시된다.

## Rejected alternatives

### Editor DOM 또는 Typie view를 preview에 복제

편집 상태와 renderer가 결합되고 editor-only scaffold, selection과 CSS가 출판 view로
누출되므로 거부한다.

### Sanitized arbitrary HTML을 저장하거나 IPC로 전달

Sanitizer policy가 저장 format의 일부가 되고 URL/style/unknown element 경계가 계속
확장된다. 현재 필요한 semantic union보다 복잡하고 실행 표면이 커지므로 거부한다.

### iframe/webview로 외부 reader page를 표시

Network, remote script, 계정/session과 외부 서비스 변경을 private-local preview에
도입한다. 공식 재현이라는 잘못된 인상도 만들기 때문에 거부한다.

### External CSS/font URL을 profile에 저장

Offline 동작, canonical hash, security와 layout 재현성을 모두 외부 resource에 의존하게
하므로 거부한다.

### 전체 scope DOM을 한 번에 mount

Visible preview와 통계 측정을 단순화하지만 큰 작품에서 DOM 크기, focus와 첫 화면
준비를 scope 전체에 비례시킨다. Section windowing과 bounded incremental measurement를
사용한다.

### Estimator만 사용하고 actual measurement를 생략

Font shaping, wrapping과 overflow를 정확히 관측할 수 없으면서 실제 결과처럼 보일 수
있으므로 거부한다. 추정은 첫 화면용 초기 상태로만 사용한다.

## Compatibility

Publication document와 Reader preset은 version 1 exact 계약으로 시작한다. Unknown
version/field/token은 alias나 fallback으로 수용하지 않는다. 새 semantic 표현이나 profile
token은 명시적인 format 결정과 validator/render 구현을 함께 추가해야 한다.

Named snapshot의 canonical preset restore와 Reader UI state 제외는 서로 다른 소유권
경계다. Restore 후 preset을 다시 검증하되 snapshot에 없던 Reader pane 배치를 합성하거나
덮어쓰지 않는다.

## Distribution note

이 ADR은 비공개 로컬 Reader rendering 경계만 결정하며 배포 또는 외부 플랫폼 정확성
주장을 승인하지 않는다. 배포 전 결정은
[license decision record](../LICENSE_DECISION_REQUIRED.md)를 따른다.

## Related documents

- [Phase 1F result](../PHASE_1F_RESULT.md)
- [Reader Lab performance](../READER_LAB_PERFORMANCE.md)
- [Reader Lab architecture](../READER_LAB_ARCHITECTURE.md)
- [Reader profile format v1](../READER_PROFILE_FORMAT_V1.md)
- [Reader Lab visual diagnostics](../READER_LAB_VISUAL_DIAGNOSTICS.md)
