# Goal 2 검증 기록

작업일: 2026-10-08 KST, macOS arm64 / Python 3.9.6 / Node 24.14.1. 공개 원본과 실제 iPhone 데이터를 사용했다. 합성 단위/E2E 테스트는 별도 테스트 데이터이며 실제 dog gait로 취급하지 않는다.

## 공개 canine 데이터 — 검증 완료

- CSV ZIP 440,933,845 bytes, CSV 1,985,551,732 bytes. 다운로드한 3파일 모두 게시자 SHA256와 일치.
- 전체 10,611,068행 / 20열 / 45 DogID / 62 DogID-TestNum 세션 전수 감사. 빈 값/숫자 nonfinite/중복 식별키 0. 세션 내 dt=0.01s(부동소수 오차 tolerance 1e-8s).
- 실제 Back columns: ABack_x/y/z 및 GBack_x/y/z. Neck도 별도 읽기 가능.
- Task: Task play, Task walk, Task stand, Task sit, Task trot, Task treat-search, Task lie down 및 `<undefined>`.
- Behavior: Playing, Sitting, Walking, Lying chest, Trotting, Sniffing, Standing, Panting, Eating, Shaking, Synchronization, Pacing, Drinking, Carrying object, Galloping, Extra_Synchronization, Tugging, Jumping, Bowing 및 `<undefined>`. PointEvent: Bark, `<undefined>`.
- feature 검증 범위: Dog 16 / Test 1의 164,004행을 읽고 연속 Walking 639행(t=104.89–111.27s)을 선택. 원본 3초 [105.39,108.39)는 300행, 처리 후 150샘플, 50Hz, VALID, 112개 feature 생성.
- 처리: t_sec 기반 보간 + Kaiser β=5 polyphase anti-alias FIR, 100→50Hz. raw axes 보존 및 두 magnitude 추가. 전체 원본에 대해 feature를 저장하거나 모델을 학습하지는 않았다.
- 분포/세션별 수치: [전체 감사](dataset-audit.md), 집계 [JSON](dataset-audit.json).

## 실제 iPhone 첫 캡처 — 결함 발견 및 정상적인 거부

사용자가 직접 Start Streaming을 실행했다. context는 `human_held_phone`이며 개의 보행 데이터가 아니다.

- session: `REDACTED_INITIAL_CAPTURE` (공유 문서에서 실제 세션 ID 제거)
- 3,278개 raw frame, accel 고유 sample 3,278 / 49.7163Hz, gyro 고유 sample 3,035 / 46.0227Hz.
- 65.914초의 실제 accel sampling span. Capture Start 후 연결 대기 시간은 sensor rate 계산에 포함하지 않는다.
- gyro 재사용 timestamp 243회. 저장 queue drop 0, GPS 저장 0.
- 기본 3초 windows 22개 전부 INVALID. 모든 sample 시작점에서 검사해도 유효 3초 window가 없었다. 따라서 이 캡처의 feature vector를 생성하지 않았다.
- 원인: accel callback 즉시 전송이 이전 gyro reading을 재사용하며 중간 gyro reading을 놓침. 수정: 양쪽 새 timestamp가 준비된 callback에서 pair 전송. 센서 부재/지연 fallback은 유지.
- 수정 전 공개/iPhone 비교 결과는 `artifacts/goal2-comparison.json`; `same_feature_schema=true`, `both_valid=false`, iPhone features=null, CLI exit 2.

## 수정 후 실제 iPhone 재캡처 — 통과

사용자가 앱 Reload 후 Start Streaming을 실행하여 수정된 callback pairing으로 재검증했다.

- session: `REDACTED_PAIRED_CAPTURE` (공유 문서에서 실제 세션 ID 제거), context `human_held_phone`.
- 명시적 캡처 약 20초, raw frame **1,002개**. accel/gyro 각각 고유 sample **1,002개**, 관측 rate 각각 **49.7194Hz**. timestamp 재사용/역행 0, 저장 queue drop 0.
- 기본 3초 window 7개: **VALID 5개**, gap으로 INVALID 1개([9,12)s), 마지막 incomplete INVALID 1개([18,21)s, 107샘플). 품질 기준을 완화하지 않았다.
- 비교 대상 iPhone [0,3)s: **150샘플, 49.7330Hz**, observed span 2.996s, gap 0, VALID. 원래 timestamp 유지, resampling 미적용.
- 공개 Walking [105.39,108.39)s: 원본 300 → 150샘플, 50Hz, VALID.
- 양쪽 실제 입력에서 **동일한 112개 feature 이름 및 순서**를 검증했다. 각 vector의 값은 당연히 서로 다르며 동일 물리 운동/동일 단위라는 뜻이 아니다.
- 새 비교 결과: `artifacts/goal2-comparison-paired.json`, `both_valid=true`, `same_feature_schema=true`, CLI exit 0.
- 원본 JSONL 1,002행 모두를 검사하여 timestamp, accelerometer, gyroscope만 존재하고 각 센서는 x/y/z/timestamp만 포함함을 확인했다. 위치정보와 기기 ID는 없다.

| 비교 항목            | Public canine Back Walking | 실제 iPhone (human-held) |
| -------------------- | -------------------------: | -----------------------: |
| Window samples       |                        150 |                      150 |
| Effective rate Hz    |                    50.0000 |                  49.7330 |
| Accel magnitude mean |    1.022147 (UNKNOWN unit) |               0.996378 g |
| Accel magnitude std  |    0.185007 (UNKNOWN unit) |               0.001291 g |
| Gyro magnitude mean  |   76.885516 (UNKNOWN unit) |           0.007210 rad/s |
| Gyro magnitude std   |   36.860896 (UNKNOWN unit) |           0.000825 rad/s |

위 수치는 파이프라인 출력 확인용이며 단위 미확인 상태에서 크기 비율이나 보행 유사성을 해석하지 않는다. 전체 feature vector는 Git 제외 artifact에 있다.

## Goal 1 실제 E2E 회귀 — 통과

수정된 앱의 실제 iPhone → FastAPI(8000) → 실제 Chromium Dashboard(5173)를 관찰했다. 가속도/자이로 화면 값 변화, GPS/accuracy 표시, 사용자가 Stop Streaming을 누른 후 DISCONNECTED 전환 및 모든 이전 센서값 숨김을 확인했다. 브라우저 runtime error는 0개다. 좌표 자체를 파일에 기록하지 않았다. 집계 증거는 [goal2-evidence.json](goal2-evidence.json)에 보존했다.

## 자동 검증

- Python 37개 통과: 기존 FastAPI 12개 + capture 6개 + 공통 gait 19개.
- Vitest 14개 통과: 기존 13개 + callback 순서 변경/새 gyro pair 회귀 1개.
- TypeScript 전체 workspace typecheck 통과.
- Vite production build 통과.
- Chromium Goal 1 E2E 3개 통과: 값/GPS 거부/timeout/reconnect, narrow/keyboard/접근성, heartbeat 중단 복구.
- Ruff lint/format, Prettier check 통과.
- 데이터/캡처 실제 경로는 `git check-ignore`로 제외 확인. raw 및 위치정보를 Git에 추가하지 않았다.

Python은 timestamp half-open 경계, 49Hz jitter, 누락/불완전 tail, NaN/Inf/overflow, 중복/역행, gyro gap/skew, anti-alias attenuation, magnitude 회전 불변성, 통계값/고정 feature 순서, dataset/live 동일 수치 입력의 동일 feature, label/session 경계, capture lifecycle/privacy/rate, writer I/O 오류/queue overflow를 검증한다.

## 제한과 다음 Goal 준비 상태

- 분류/질병 판단/모델 API는 구현하지 않았다. UI 판단 label도 없다.
- 공개 단위 UNKNOWN이므로 iPhone의 g/rad/s와 물리적 정규화가 미해결이다. 단위 provenance 확인 전 두 source를 무조건 합쳐 학습하지 않는다.
- iPhone timestamp는 JS callback 수신 시각이며 hardware clock이나 동시 sampling이 아니다.
- 하네스에 실제 장착한 dog iPhone 데이터, 안내견 대상 labeling/calibration/개체 분리 검증은 없다. 사람이 든 스마트폰의 성공만으로 dog gait 모델이 검증되지 않는다.
- 공통 데이터 계층과 실제 양쪽 입력의 특징 생성 검증은 완료했다. 다음 Goal에서 공개 데이터 기반 classifier 연구를 시작할 기반은 준비되었다. iPhone 전이/통합 학습 전에는 공개 단위 확인, 장착 방향·위치 검증, 실제 dog labeling 및 DogID 단위 평가 분리를 확정해야 한다.

## 완료 기준별 확인

| 기준                              | 결과 | 근거                                                          |
| --------------------------------- | ---- | ------------------------------------------------------------- |
| 1. 실제 공개 데이터 다운로드/검사 | 통과 | ZIP 및 CSV SHA256 재검증, 전수 audit                          |
| 2. 실제 metadata/columns/labels   | 통과 | dataset-audit.md/json, data-sources.md                        |
| 3. Back sensor 읽기               | 통과 | Dog 16/Test 1 실제 6축 adapter                                |
| 4. 공개 데이터 공통 3초 pipeline  | 통과 | 실제 Walking 150샘플/112-feature vector                       |
| 5. 실제 iPhone 동일 pipeline      | 통과 | 새 실제 capture VALID window/112-feature vector               |
| 6. 동일 feature schema            | 통과 | 실제 양쪽 vector key 목록과 순서 일치                         |
| 7. 실제 capture rate 측정         | 통과 | 양 센서 고유 timestamp 기준 49.7194Hz                         |
| 8. invalid/incomplete 거부        | 통과 | 첫 캡처 전체 거부, 새 캡처 gap/tail 거부 및 자동 테스트       |
| 9. 관련 자동 테스트               | 통과 | Python 37, Vitest 14 및 lint/typecheck/build                  |
| 10. 기존 Goal 1 회귀 없음         | 통과 | 자동 Chromium E2E 3 + 수정 후 실제 iPhone/Dashboard/Stop 관찰 |
