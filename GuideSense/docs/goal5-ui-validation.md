# 길찾기 전용 UI 검증

2026-10-09. 사용자 첨부 DESIGN.md / design-wordforms 철학을 적용한 프런트엔드 개편.

## 변경

- `/`는 길찾기 전용 진입점. 센서·Replay·Backend 입력은 `/diagnostics`로 분리하고 lazy import로 스타일과 연결 코드를 격리.
- 데스크톱: 좌측 검색/비교와 우측 지도. 추천 후보 우선 배치, 선택 후보의 시설 근거 공개.
- 모바일: 검색 → 지도와 이동 미리보기 → 경로 비교. 320px까지 가로 넘침 없음.
- 안내 기준은 키보드 사용 가능한 native dialog로 이동. 출발점 선택 후 지도 대상은 자동으로 도착점으로 전환.
- 선택 변화에 맞춘 지도 이동, 결과 등장, 재생/일시정지/다시 시작. reduced-motion에서는 CSS 전환과 지도 fit 애니메이션 해제.

## 자동 검증

- Production build 및 Dashboard TypeScript 통과.
- 전체 브라우저: 7 passed, 4 skipped. 기존 live 3개, navigation 4개. Replay 4개는 기존 모델 아티팩트 부재로 skip.
- 마지막 지도 리사이즈 수정 이후 navigation 4개 재실행 통과. 320px에서 출발·도착 마커 두 개가 지도 안에 있고 미리보기 패널 위에 노출되는지 검사.
- API 합성 fixtures로 검색 → 후보 비교 → 재생/일시정지 → 입력 변경 시 초기화 검증.
- 제외 후보만 있는 경우 재생 불가, 경로 오류 후 이전 결과 제거, 앱키 부재 시 지도 선택/교환은 가능하되 조회 불가.
- 320px overflow 검사와 axe 위반 0개. 안내 dialog Escape 닫기와 트리거 포커스 복원 확인.
- git diff --check 통과.

## 실제 API 화면 검증

실제 TMAP 검색에서 왕십리역[수도권2호선]과 한양대학교병원을 선택했다. 4개 후보 중 경로 4(896m, 13분)가 추천되어 맨 위에 나타났다. 기존 시설 판정과 API 계약은 변경하지 않았다. 지도 경로 표시와 시뮬레이션 100% 완료를 브라우저에서 확인했다.

`artifacts/navigation-live/ui-desktop.jpg`는 실제 API 결과 화면, `ui-mobile.jpg`는 모바일 배치 확인용이다. 자동화 스크린샷 `artifacts/navigation-320.png`는 명시적 합성 fixtures를 사용한다.

시설 기준일은 2022-12-15이며 현장 정확성 검증은 이번 UI 작업 범위에 포함되지 않는다. 실제 GPS/안내견 센서 연결이 아닌 이동 시뮬레이션이다.
