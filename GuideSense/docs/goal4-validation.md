# Goal 4 validation

검증일: **2026-10-08 KST**, Mac / Python 3.9.6 / Node 24.14.1 / Chromium. 기존 모델·분할·Test 평가·모바일 센서 구현을 유지했으며 재학습하지 않았다. 공유 가능한 실행 요약은 [goal4-results.json](goal4-results.json), 로컬 세부 증거는 `artifacts/goal4/`다.

## 실제 Replay / ML 결과

| 기록                                   | 실행 결과                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Test Dog 22/Test 2, 30초·1,500 samples | 1× 실제 브라우저 재생, 10개 window 추론, COMPLETED. 첫 Actual Walking / Predicted Walking. 이후 Actual null 9개도 그대로 표시 |
| Test Dog 45/Test 1, 30초·1,500 samples | 1× 실제 브라우저 재생, 10개 window, Walking→Sitting 전환 및 COMPLETED                                                         |
| Test Dog 44/Test 1, 9초·450 samples    | 실제 모델에서 3개 모두 Actual Lying chest / Predicted Sitting. 브라우저에서 첫 결과 MISMATCH 및 Sitting 기반 Brooch 확인      |
| 재추론 비교                            | 23/23 window의 실행 예측이 Goal 3 export의 saved prediction과 일치                                                            |
| 원본 없는 시연                         | 새 임시 폴더에 **1,988,342 bytes** bundle을 풀어 23개 window 재추론 성공. 원본 2GB CSV 없이 동작                              |
| 모델 불변성                            | SHA256 `794d7cec8accee97ada65a45237de417ce8b7879a9531f73c6ede3add1ff7ebb`; Goal 3 모델 유지                                   |

Clip 선택과 실제 sample annotation 감사는 [integration](goal4-replay-integration.md)에 기록했다. 원본 Dog 22에는 Walking/undefined 외 Pacing 55개 sample도 있었다. window actual null은 정답을 숨긴 것이 아니라 기존 strict label 정책의 결과다. 데모에서 새 accuracy/F1를 산출하거나 모델을 튜닝하지 않았다.

## 자동 검사

| 검사                 | 결과                                              | 검증 내용                                                                                     |
| -------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Python pytest        | **84 passed**                                     | 기존 Goal 1~3 67개 유지 + Goal 4 17개. 실제 artifact 테스트 포함                              |
| Vitest               | **17 passed**                                     | 기존 14개 + source/schema·brooch 실제 prediction·URL 분리 3개                                 |
| Playwright Chromium  | **7 passed**, 최종 전체 1.6분                     | 기존 live 3개, 실제 recorded replay 3개, 실제 파일/API 실패 복구 1개                          |
| TypeScript           | 모든 workspace 통과                               | Dashboard/Mobile/Protocol                                                                     |
| Vite build           | 통과                                              | 실제 production bundle 생성                                                                   |
| Ruff lint / format   | 통과                                              | services/api, ml/gait, scripts 전체                                                           |
| Prettier             | 통과                                              | 프로젝트 전체                                                                                 |
| pip check            | 통과                                              | dependency 충돌 없음                                                                          |
| DESIGN.md lint       | 오류 0, 경고 1                                    | border token은 CSS에서 사용하지만 문서 component sub-token에서 직접 참조하지 않는 orphan 경고 |
| Premium strict audit | 0 findings                                        | source ownership/기본 UI 계약 정적 감사                                                       |
| 접근성               | 검사한 live/replay desktop/narrow axe violation 0 | 키보드 모드 제어, native select 열림, 375px/reduced-motion/scrollbar 포함                     |

Python에서 timestamp 역행·elapsed 불일치·추가 센서축·출처 변경·model hash/전처리/split/quality 불일치를 거부한다. 3.19초에는 추론하지 않고 3.2초에 처음 실행한다. Pause 동안 추론 횟수와 시각이 고정되고 Resume/Stop/Restart/완료가 검증됐다. Actual을 바꿔도 모델 예측은 그대로이며 INVALID_WINDOW는 모델 호출을 차단한다. 모델/metadata 누락·불일치와 ML 의존성이 없는 경우도 replay 오류와 live 가용성을 검사한다. 두 Dashboard 세션은 서로의 상태를 제어하지 않는다.

브라우저 실패 테스트는 **별도 8002 서버와 임시 replay 복사본**을 사용했다. 파일 없음 → 정상 복원 → 실제 추론 → sensor schema 손상(파일 checksum도 갱신해 schema 검사까지 도달) → ERROR/이전 결과 제거 → 정상 복구를 검증했다. 재생 중 API 프로세스를 실제 종료하고 UNAVAILABLE/값 제거, 재시작 후 IDLE/새 Play 추론까지 확인했다. 행사 artifact를 삭제하거나 변형하지 않았다.

자동 live E2E는 기존 합성 `test-device`를 테스트 포트 8001에 주입한다. 이것과 아래의 실제 iPhone 검증을 구분한다. 실제 artifact가 없는 환경은 해당 로컬 데이터 integration/browser 검사만 명시적으로 skip한다.

```bash
GUIDESENSE_REAL_DATA=1 services/api/.venv/bin/python -m pytest -q services/api/tests ml/gait/tests
services/api/.venv/bin/ruff check services/api ml/gait scripts
services/api/.venv/bin/ruff format --check services/api ml/gait scripts
services/api/.venv/bin/python -m pip check
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run format:check
```

## 실제 iPhone E2E — 이번 Goal에서 수행

사용자가 iPhone의 Start/Stop을 직접 조작했고, 브라우저 자동화는 **합성 device를 생성하지 않고** 실제 API/화면을 관찰했다. 최종 성공 구간은 **2026-10-08 15:00:59–15:01:53 KST**다. 실제 보고서 `artifacts/goal4/iphone-validation.json`의 모든 검증 flag가 true다.

- 실제 iPhone CONNECTED, 가속도 수치 변화, 자이로 값 표시, GPS 위도·경도/Accuracy, Last Received 표시.
- Replay 실행 직전 실제 acceptedFrames=751. Replay가 실제 Walking을 추론하는 동안에도 iPhone 프레임 수가 증가하고 deviceStatus=connected였다.
- LIVE→REPLAY→LIVE 전환 후 실제 iPhone 연결/값 유지. Replay가 iPhone 연결로 위장되지 않았다.
- 사용자 Stop 후 DISCONNECTED 및 가속도·자이로·GPS `—` 확인. Last Received는 이력으로 유지.

첫 시도는 Backend 최종본 재시작과 겹쳐 중단됐다. 이를 성공으로 계산하지 않고 `iphone-validation-interrupted.json`에 남겼으며 사용자에게 다시 Start를 요청해 위 최종 구간을 완료했다. GPS 실제 수치는 문서/공유 JSON에 저장하지 않는다. 이는 human-held iPhone 실시간 E2E 검증이며 개 하네스 전이/행동 정확도 검증이 아니다.

## 발견 사항과 수정

1. 기본 30초 clip의 9/10 window에는 단일 정답이 없었다. 정답을 만들어 넣지 않고 null 이유를 표시하며 annotation 기준의 추가 전환 clip을 생성했다.
2. Dog 44 자세 기록의 실제 Lying chest→Sitting 오분류를 숨기지 않고 MISMATCH 및 예측 기반 Brooch로 확인했다.
3. Python 3.9에서 종료된 이벤트 루프 뒤 `create_app`을 호출할 때 capture Lock 초기화가 실패했다. Lock을 FastAPI lifespan에서 생성하도록 수정했고 기존 capture 회귀가 통과했다.
4. 제어 명령 직전의 heartbeat가 버튼 busy를 조기에 해제하지 않도록 command_id 응답 확인을 추가했다.
5. Replay pause/완료의 이전 분석을 새 결과로 오해하지 않도록 window 구간·분석 횟수·과거 결과 문구를 표시한다. Stop/오류/연결 끊김은 prediction과 현재값을 제거한다.
6. WebSocket interception을 사용한 초기 실패 테스트에서 테스트 프록시의 closing-socket 오류가 발생했다. 이를 실제 임시 API 프로세스/파일을 사용하는 테스트로 대체했고 최종 전체 E2E에서 해당 오류가 없다.

## 구현 파일

| 구분          | 추가 / 변경 파일                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend       | `services/api/guidesense_api/replay.py` 추가, `main.py`, `models.py` 수정                                                                                                                                  |
| Dashboard     | `App.tsx`, `styles.css` 수정; `MotionPanel.tsx`, `ReplayPanel.tsx`, `MotionGraph.tsx`, `useReplay.ts`, `replayContract.ts` 추가                                                                            |
| 공통 protocol | `packages/protocol/src/index.ts` live source 추가                                                                                                                                                          |
| 테스트        | `services/api/tests/test_replay.py`, `tests/replay.test.ts`, `tests/e2e/replay.spec.ts`, `tests/e2e/replay-failure.spec.ts` 추가                                                                           |
| 행사 준비     | `scripts/package_goal4_demo.py` 추가                                                                                                                                                                       |
| 문서/디자인   | `README.md`, `DESIGN.md`, `premium-ui.json`, `docs/architecture.md` 수정; `goal4-dashboard-design.md`, `goal4-replay-integration.md`, `goal4-validation.md`, `goal4-results.json`, `demo-scenario.md` 추가 |
| 로컬 artifact | Goal 4 transition/posture clip, demo zip, 실행 JSON/log, desktop/narrow/mismatch/error/select screenshots. 모두 Git 제외                                                                                   |

`apps/mobile`, 기존 `useSensorStream`, 공통 `ml/gait` 전처리·학습·모델 코드는 변경하지 않았다. 원본/모델/추출 데이터/bundle의 Git 제외를 확인했다. 외부에 게시하거나 업로드하지 않았다.

## 완료 기준과 남은 한계

요청한 13개 완료 기준을 검증했다: 실제 LIVE, 실제 30초 Replay, 시간순 IMU, 저장 모델 실행, Actual/Predicted 및 오분류 표시, Brooch, 모드 분리, 종료/오류, Goal 1~3 회귀, 실제 브라우저, 재현 문서.

Goal 5 연결 지점(source별 stream, 실행 prediction, Brooch text adapter)은 준비됐다. CSV 단위 UNKNOWN, human-held iPhone UNVALIDATED, 6클래스 closed-set 한계, 단일 worker/로컬 네트워크 경계는 유지한다. 실제 안내견/하네스, 질병·건강/심박 판단, TMAP, 알람, OpenAI/TTS, 브로치 하드웨어는 구현·검증하지 않았다. 전체 WCAG 인증, 실제 스크린리더·터치 기기 UI와 8세션 부하 성능은 이번 검증 범위가 아니다.

실행 명령과 4분 발표 순서는 [demo-scenario.md](demo-scenario.md)를 따른다.
