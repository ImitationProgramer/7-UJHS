# 검증 기록

작업 환경: 2026-10-07~08, macOS arm64, Node 24.14.1, npm 11.11.0, Python 3.9.6.

## 자동 검증

| 검증                                        | 결과                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| TypeScript: dashboard / mobile / protocol   | 통과                                                                                        |
| Vite production build                       | 통과                                                                                        |
| Expo SDK 의존성 검사 / Expo Doctor          | 통과 / 21개 검사 통과 (SDK 57)                                                              |
| Expo iOS production JS/Hermes bundle export | 통과. 실제 네이티브 설치/실행을 대체하지 않음                                               |
| 모바일 controller / 프로토콜 Vitest         | 13개 통과                                                                                   |
| FastAPI pytest                              | 12개 통과                                                                                   |
| Chromium E2E                                | 3개 통과: 실제 별도 FastAPI(8001) 2개, 서버 heartbeat 중단/자동 재연결 transport 테스트 1개 |
| 브라우저 접근성 axe                         | 연결된 desktop / narrow 화면 위반 0                                                         |
| strict UI static audit                      | 위반 0, `premium-audit.json`                                                                |

Prettier 및 Ruff format/check 통과. DESIGN.md 공식 lint는 오류 0이며 보조색 토큰의 컴포넌트 메타데이터 참조 경고 4개가 있다(런타임에서는 사용됨).

자동 테스트에서는 의도적으로 `test-device` 합성값을 사용했다. 운영 포트 8000에 합성 프레임을 보내지 않았다. 동작값 변경, GPS 수치 및 거부/null, 열린 socket의 무전송 timeout, 기기 Stop/close timeout, 다중 dashboard fan-out, 신규 dashboard snapshot, 잘못된 스키마 거부, 두 번째 장치 거부, 클라이언트 시계와 무관한 timeout, 느린 dashboard 큐 상한, 권한 요청 중 취소, 늦게 완료되는 GPS 구독 정리, 소켓 backpressure 중지까지 검증한다.

브라우저는 키보드 주소 입력/에러 포커스, 서버 접근 실패/주소 수정 후 복구, 375px 좁은 화면, reduced motion, 스크롤바 computed style을 확인했다. 실제 스크린리더/VoiceOver 수동 검증은 하지 않았다.

처음 테스트에서 dashboard 종료 중 ASGI cancellation의 자식 task 정리 문제와 `<dd role="status">` 접근성 오류를 발견해 수정했고 재실행을 통과했다.

## 실제 iPhone E2E — 통과

2026-10-08 KST, 사용자의 실제 iPhone과 Expo Go SDK 57을 사용했다. 운영 API 8000에는 합성 프레임을 보내지 않았으며, 사용자가 Start/Stop을 직접 실행했다. 기기 모델/OS는 사용자가 지정한 iPhone 16 Pro/iOS 27 기준이며 시스템 정보 자체를 자동 추출하지는 않았다.

| 요구사항                                                          | 실제 관찰 결과                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| iPhone 움직임 → Accelerometer/Gyroscope → FastAPI → Mac Dashboard | 통과. API에서 실제 벡터 변화, 별도 Chromium 브라우저에서 가속도 X 및 자이로 Z 표시 변화를 확인        |
| 약 50Hz 동작 센서 스트림                                          | 10.027초 동안 492개 고유 프레임, **49.07Hz**. 가속도·자이로 각각 고유 sample timestamp 492개          |
| 위치 권한 허용 → GPS 수신 → Dashboard                             | 통과. 세 센서 모두 ready. 실제 위도·경도·accuracy 표시 확인                                           |
| 사용자 Stop → timeout → DISCONNECTED                              | 통과. 사용자 Stop 실행 확인. 마지막 수신 1791386933996 → disconnected 관찰 1791386937210, **3.214초** |
| 종료 후 오래된 값 처리                                            | 모든 센서 수치는 —로 숨김. 마지막 수신 시각 유지, Dashboard↔API 연결은 유지                           |
| 브라우저 런타임 오류                                              | 0개                                                                                                   |

API는 두 실기기 세션에서 총 7,878개 유효 프레임을 수신했다. 관찰 도구는 최신 프레임 큐를 읽으므로 카운트가 API 전체 수신 수보다 작을 수 있다. 관찰된 GPS 포함 프레임은 3,653개이며 이는 독립 GPS fix 횟수가 아니다.

읽기 전용 관찰 도구:

```bash
services/api/.venv/bin/python scripts/observe_device.py
node scripts/observe_dashboard.mjs
```

좌표 자체를 영구 저장하지 않는 검증 근거:

- `docs/e2e-evidence.json`: 실기기 전송률, 실제 브라우저 표시, 사용자 Stop 후 상태 전환을 정리한 고정 기록.
- `artifacts/device-observation.json`, `artifacts/dashboard-observation.json`: 로컬 관찰 로그. Git 제외.
- `artifacts/real-device-connected.png`: 실제 연결 화면. 위도·경도는 마스킹.
- `artifacts/real-device-stopped.png`: 사용자 Stop 후 DISCONNECTED 화면.

### 실기기 검증에서 발견하여 수정한 문제

1. iOS CoreLocation은 소수점 Unix milliseconds를 반환하는데 정수 스키마가 이를 거부해 GPS가 error가 됐다. fix 시각을 Math.trunc로 정수화하고 회귀 테스트를 추가했다. 좌표를 바꾸거나 현재 시각으로 대체하지 않는다. 수정 후 실제 GPS 표시까지 확인했다.
2. iOS에서 20ms JS interval 전송은 초기 측정에서 5.02초/147프레임, 약 29.3Hz였다. native 센서 콜백마다 전송하고 센서가 없을 때만 100ms 상태 heartbeat를 보내도록 변경했다. 수정 후 실측 49.07Hz와 callback/fallback 회귀 테스트를 통과했다.

## 알려진 제한

- 현재 Mac에는 Xcode 전체 설치가 확인되지 않아 iOS simulator/독립 native build는 실행하지 않았다. 실제 iPhone Expo Go에서 수집·전송·GPS·Stop E2E를 검증했다.
- SDK 57 업그레이드 및 중복 의존성 정리 후 `npm audit` 경고는 22개(7 moderate, 15 high)가 남아 있다. 로컬 프로토타입으로 한정하며 외부 배포 전 의존성 보안 검토가 필요하다.
- 50Hz는 요청 주기이며 OS/네트워크/부하에 따라 달라질 수 있다. 이번 실기기 측정은 49.07Hz였다.

## Expo Go SDK 57 호환성 수정

사용자가 실제 iPhone의 Expo Go가 SDK 57.0.0이며 SDK 54 프로젝트를 거부한다고 보고했다. Metro 로그에서도 동일 오류를 확인했다. `expo`를 57.0.27로 올리고 Expo의 `install --fix` 권장값으로 sensors/location/crypto, React Native 0.86.3, React 19.2.3, safe-area-context를 정렬했다. Dashboard React도 19.2.3으로 맞추고 `npm dedupe`로 React/React Native 중복 설치를 제거했다. SDK 선택은 설치된 실기기 앱의 확인된 버전을 기준으로 수정했다. 실제 센서 E2E 통과 여부는 별도 기록한다.

SDK 57 수정 후 재검증: Expo Doctor 21/21, `expo install --check`, iOS bundle export, TypeScript, Vitest 9개, Vite build, Chromium E2E 3개, Prettier 통과. Metro 캐시를 비우고 재시작했으며 실제 LAN manifest의 `sdkVersion: 57.0.0` 및 iPhone용 bundle URL을 확인했다. 이후 실기기 검증 결과는 위 절에 기록한다.
