# Plot Canvas 성능 검증

기준일: 2026-08-08

## 검증 환경과 해석 범위

- Windows x64, Node.js `26.3.1`, pnpm `11.9.0`, Rust `1.97.1` MSVC
- `@xyflow/react` `12.11.2`, JSON Canvas document version `1.0`
- development Electron과 fresh unpacked package를 각각 실제 창에서 실행
- 5회 표는 정렬된 세 번째 값을 median, 가장 큰 값을 maximum으로 기록
- 단일 복합 workflow는 1회 관측이며 분포나 안정성의 median으로 해석하지 않음
- Playwright pointer/keyboard 동작과 상태 확인 round trip을 포함한 end-to-end 관측값은
  React/adapter 내부 계산 시간과 구분함

수치는 이 PC와 당시 process 부하의 관측값이다. 성능을 맞추기 위해 canonical node나
edge를 자르지 않았고 모든 scale 반복에서 canonical/renderer count를 함께 검증했다.

## Fixture

`scripts/create-phase1e-scale-fixture.mjs`가 실제 Rust sidecar와 SQLite로 다음 fixture를
결정론적으로 생성했다.

| 항목 | 값 |
|---|---:|
| `.madi` bytes | 1,503,232 |
| schema / logical format | 5 / 1 |
| Canvas | 11 |
| 일반 Canvas | 10 × 100 node / 200 edge |
| 대형 Canvas | 500 node / 1,000 edge |
| 대형 reference | Entity 200 / Scene 200 |
| 전체 | 1,500 node / 3,000 edge |
| final project revision | 411 |
| document-set SHA-256 | `a25382ce651fb1a9c82c0c09ff86c5b2a6341ad46b5c414468e31c201bd2b824` |

대형 Canvas의 `load_canvas`를 새 Rust/SQLite sidecar process에서 5회 실행한 결과는
`46.05, 46.18, 45.61, 45.96, 45.87 ms`, median `45.96 ms`, maximum
`46.18 ms`였다. 매번 500/1,000을 다시 assert했다.

## Renderer 변환 micro-benchmark

`apps/desktop/tests/plot-canvas-performance.test.ts`의 독립 5회 측정 결과다.

| 항목 | median | maximum |
|---|---:|---:|
| JSON validation + parse | 3.317 ms | 7.967 ms |
| React Flow DTO 변환 | 3.678 ms | 15.303 ms |
| node 검색 | 0.119 ms | 0.894 ms |
| 100-node drag DTO 갱신 | 0.345 ms | 1.863 ms |
| canonical serialization | 3.506 ms | 6.737 ms |

직렬화된 대형 document는 382,023 bytes였고 500 node/1,000 edge, Entity reference 200,
Scene reference 200을 잃지 않았다. 이 값은 Electron IPC, React commit, 실제 pointer
gesture나 500ms autosave debounce를 포함하지 않는다.

## 실제 Electron 5회 측정

| end-to-end 항목 | Development median / max | Packaged median / max |
|---|---:|---:|
| Canvas 전환 후 500/1,000 render | 414.73 / 457.75 ms | 388.85 / 416.02 ms |
| fit view | 310.22 / 528.78 ms | 309.83 / 560.14 ms |
| `Ctrl+K` 검색·focus | 518.40 / 621.96 ms | 520.72 / 642.24 ms |
| 실제 두 node multi-select | 274.29 / 281.82 ms | 278.35 / 330.42 ms |
| grouped child 실제 pointer drag | 688.35 / 742.89 ms | 775.79 / 923.00 ms |
| drag 뒤 debounced autosave 완료 | 981.90 / 1,013.26 ms | 1,024.66 / 1,029.79 ms |

각 drag는 선택된 grouped child를 실제 pointer로 이동하고 canonical 위치를 확인한다.
5회 누적 이동 `0,0 → 100,75`가 첫 process 저장 전과 새 process 재실행 뒤 정확히
일치했다. `rendererErrorDiagnostics`, `pageErrors`, 외부 runtime request는 두 모드 모두
정확히 `0`이었다.

`Ctrl+K`와 pointer gesture 수치는 내부 검색/DTO 계산보다 Playwright action 및 React
commit 확인 비용이 지배한다. 특히 검색·focus median은 500ms 목표를 조금 넘고 maximum은
약 0.64초다. 이는 기능·무누락 gate를 막지는 않지만 후속 interaction profiler 대상이다.
Autosave 관측에는 의도한 약 500ms debounce와 disk round trip이 들어가며, canonical
serialization 자체는 위 표처럼 maximum 6.737ms였다.

## 단일 복합 workflow 관측

다음은 각 실제 창에서 한 번 실행한 복합 동작이다. 한 sample이므로 median/max로
일반화하지 않는다.

| workflow | Development | Packaged |
|---|---:|---:|
| text 추가 + autosave | 913.21 ms | 937.02 ms |
| width/height resize + Undo×2/Redo×2 | 4,380.84 ms | 4,420.04 ms |
| pointer edge 200→201→200 | 1,960.19 ms | 1,989.59 ms |
| Canvas 전환 전 flush | 469.03 ms | 673.33 ms |
| named snapshot v3 생성 | 299.14 ms | 216.61 ms |
| Canvas diff + safety restore | 2,233.64 ms | 960.34 ms |

Resize workflow는 `280×160 → 312×184`, 높이/전체 Undo와 폭/전체 Redo를 실제
inspector와 DOM 크기로 확인했다. Edge workflow는 source/target handle pointer 연결로
201개가 된 뒤 선택 edge를 삭제해 200개로 복구했다. Export는 60,202-byte `.canvas`를
만들고 preview 뒤 새 Canvas로 101 node/200 edge를 import했다.

## 재실행·snapshot·보안

- Canvas count `11 → 12 → 새 process 12`
- 대형 Canvas canonical/DOM `500/1,000` exact
- 수정 일반 Canvas와 imported Canvas 모두 `101/200` 재복원
- snapshot payload v3, diff `changed canvas 1`, `node delta +1`, `edge delta 0`
- restore 전 `AUTO_BEFORE_RESTORE` 생성과 원상 복원 PASS
- offline reload PASS, 임의 local-file read 2회 차단
- external runtime request `0`, page error `0`, renderer diagnostic `0`

증거는 `output/playwright/madi-electron-phase1e-evidence.json`과
`madi-packaged-phase1e-evidence.json`, 각 first-run/reopened screenshot에 있다. JSON은
원고·Entity note·relation note를 기록하지 않고 구조·수치만 보존한다.

## Bundle 분리

최종 production build의 raw/gzip bytes는 다음과 같다.

| lazy boundary | 파일 | raw | gzip |
|---|---|---:|---:|
| manuscript shell | `index-BWI-Lh7S.js` | 411,058 | 116,548 |
| Plot Canvas / React Flow | `PlotCanvasMode-f0f_jqc_.js` | 249,549 | 79,557 |
| World Graph / Cytoscape | `WorldGraphWorkspace-ChJKQQFz.js` | 478,653 | 153,125 |

`index.html`은 main entry만 참조한다. `pnpm test:bundle`은 production build 뒤 Plot
Canvas와 World Graph가 서로 다른 dynamic chunk이고 main source에서 eager runtime import가
없음을 검사했다.

## 판정과 남은 비용

500/1,000에서 crash, canonical/DOM 누락, 저장·재실행 손실, observer warning과 외부
요청은 없다. Rust load, validation, 변환과 serialization은 충분히 작고 실제 Canvas
전환도 0.5초 안팎이다. 따라서 scale hard gate는 PASS다.

남은 비용은 cold `Ctrl+K`, 실제 pointer gesture와 500ms autosave debounce가 합쳐진
end-to-end latency다. 더 큰 Canvas, 장시간 편집 heap, DPI/다중 monitor, persistent Undo와
worker 기반 처리 여부는 Phase 1F hardening에서 별도로 검증한다.
