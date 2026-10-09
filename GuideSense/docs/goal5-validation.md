# Goal 5 검증 기록

2026-10-09. 기존 코드 기준 커밋 `6831129205fe5f18938b349a5231f211007ac8e3`에서 구현.

## 구현 결과

지도·검색으로 출발/도착 지정, TMAP 후보 생성, 횡단 시설 매칭, 제외/미확인/평가 가능 판정, 시설·거리 비용 추천, 지도 후보 비교, 시뮬레이션과 브로치 텍스트를 추가했다. 무작위 장소 생성이나 고정 경로 fallback은 없다.

## 자동 검증

- Python 전체: **106 passed, 13 skipped**. 새 navigation 테스트 35개 포함.
- Vitest: **23 passed**. 새 geometry/schema 테스트 6개 포함.
- 전체 workspace TypeScript 및 Dashboard production build 통과.
- 브라우저 전체: **6 passed, 4 skipped**. 기존 live E2E 3개 및 새 navigation E2E 3개 통과.
- 새 브라우저 테스트: 검색/선택→제외 후보·추천 비교→시뮬레이션, 입력 변경 시 초기화, 320px 가로 넘침 없음, axe 접근성 위반 없음, 전부 제외·API 오류·키 누락·지도 클릭·출발/도착 교환.
- 외부 지도 타일은 자동 테스트에서 차단 후 작은 테스트 이미지로 대체한다. 공개 타일 서버를 테스트 트래픽으로 반복 조회하지 않는다.

경로·검색 브라우저 테스트는 명시적인 합성 API fixtures를 사용했다. 실제 TMAP 성공 검증으로 해석하지 않는다. 스크린샷은 `artifacts/navigation-comparison.png`, `navigation-320.png`, `navigation-key-missing.png`이며 합성 경로임을 테스트 fixtures에 기록했다.

## 실제 로컬 화면

로컬 API·Dashboard 실행과 987행 시설 metadata 로드를 확인했다. Codex 브라우저에서 실제 OSM 배경지도와 성동구 경계, 키 미설정 상태를 확인했다.

## 데이터 감사

CSV 987행 모두 좌표 파싱 가능, 신호등 yes 272/no 715, 기준일 2022-12-15. 중복 좌표 또는 ID 관련 행은 2개이며 이들은 단일 확정 시설로 사용하지 않는다. 경계는 JUSO 2015 원본에서 성동구 Polygon을 추출했다.

## 남은 검증

**실제 TMAP API 및 브라우저 연동 확인 완료(2026-10-09 후속 검증)**. 사용자 제공 앱키로 장소 검색과 5개 출발·도착 쌍에 각각 옵션 0/4/10/30을 요청했다. HTTP/API 오류는 없었다. 시설 공간 연결의 현장 정확성은 별도 미검증이다.

횡단 선형은 facilityType=15, 횡단 안내는 turnType=211~217을 사용한다. API가 제공하지 않거나 문서에 정의되지 않은 facilityType=0/-1은 미확인으로 처리한다. 이로 인해 실제 후보들이 추천 불가가 될 수 있으며 실제 응답 검증 없이 조건을 완화하지 않는다.

시설 매칭 8m corridor / 3m 끝점 모호성은 시제품 기본값이다. 실제 건너는 횡단보도와 인접 횡단보도를 구별하는 추가 검증이 필요하다. 이 수치는 보행 안전 임계값이 아니다.

모델·실제 canine replay artifact가 저장소에 없어 Python 13개와 browser 4개가 skip됐다. 기존 코드의 합성 센서 경로는 통과했지만 실제 iPhone 재측정 및 실제 모델 Replay 검증은 이번 환경에서 수행하지 못했다.

## 실행 명령

```sh
services/api/.venv/bin/python -m pytest -q services/api/tests ml/gait/tests
services/api/.venv/bin/ruff check services/api ml/gait
services/api/.venv/bin/ruff format --check services/api ml/gait
npm test
npm run typecheck
npm run build
npm run format:check
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/guidesense-playwright npx playwright test
```

이번 세션은 설치된 Playwright 1.63.0에 맞는 Chromium 1243을 임시 경로에 설치했다. 다른 환경에서는 `npx playwright install chromium` 후 기본 캐시를 사용할 수 있다.

## 앱키 적용 후 실제 호출 결과

| 출발 → 도착               | 중복 제거 후보 수 | 결과                                         |
| ------------------------- | ----------------: | -------------------------------------------- |
| 성동구청 → 왕십리역       |                 1 | 횡단 시설 기록 미연결로 추천 보류            |
| 서울숲역 → 뚝섬역         |                 2 | 추천 618m, API 시설 분류상 횡단보도 없음     |
| 뚝섬역 → 성수역           |                 1 | 횡단 시설 기록 미연결로 추천 보류            |
| 왕십리역 → 한양대학교병원 |                 4 | 옵션30 경로 896m·755초 추천, 시설 294번 연결 |
| 성동구청 → 서울숲역       |                 2 | 10~11곳 횡단의 시설 미연결로 추천 보류       |

성동구청→왕십리역의 횡단 선형은 가장 가까운 CSV 좌표에서도 약108m 떨어져 있다. 단순히 연결 반경을 넓혀 확정하지 않았다. CSV는 성동구 전체 횡단 시설을 빠짐없이 제공하는 자료로 간주할 수 없다.

왕십리역→병원의 일반 옵션 응답에는 시설 코드17이 있다. 공식 문서의 현재 코드 표와 예시/주석의 설명이 일치하지 않으므로 이 구간은 미확인으로 유지했다. 옵션30 응답은 알려진 시설 코드로 구성됐다. 이 실제 결과에서 시설 가중치가 대안 선택을 개선했다고 입증한 것은 아니며 가중치 선택 변화는 합성 테스트에서 검증했다.

Codex 브라우저에서 실제 장소 검색·선택→4개 후보 표시→896m 경로 추천→시뮬레이션 진행·일시정지를 확인했다. 시설294번은 signal/audibleSignal/curbRamp/tactilePaving 모두 yes다. 실제 지도 배경과 결과 화면은 `artifacts/navigation-live/browser-live.jpg`, API 응답과 요약은 같은 폴더에 로컬 저장했다. 키는 포함하지 않는다.

실제 POI 응답에서 같은 upstream ID를 가진 본관/정문 항목이 발견돼 좌표·이름을 포함한 결과 식별자로 수정했다. 관련 회귀 테스트를 추가해 navigation 단위 테스트 **36개 통과**.
