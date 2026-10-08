# Sensor compatibility

실제 CSV header와 `apps/mobile/src/stream.ts`, API Pydantic schema, 실기기 캡처를 비교한다. 같은 feature 이름이 같은 물리 분포나 모델 전이 성능을 보장하지 않는다.

| 항목          | Public canine CSV                                       | GuideSense iPhone                                                |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| 센서          | ActiGraph GT9X Link (metadata)                          | iPhone 16 Pro, Expo Accelerometer/Gyroscope                      |
| 가속도        | ABack_x/y/z (기본), ANeck_x/y/z                         | accelerometer.x/y/z                                              |
| 자이로        | GBack_x/y/z (기본), GNeck_x/y/z                         | gyroscope.x/y/z                                                  |
| 원본 sampling | 모든 세션 dt=0.01s, 실측 100Hz                          | nominal 50Hz, Goal 1 관측 49.07Hz; Goal 2 실측은 validation 문서 |
| 가속도 단위   | **UNKNOWN**: CSV/header/다운로드 설명에 명시 없음       | g, 중력 포함                                                     |
| 자이로 단위   | **UNKNOWN**: CSV/header/다운로드 설명에 명시 없음       | rad/s                                                            |
| 좌표축        | 각 장치의 x/y/z; canine 해부학 축 mapping 확정 안 됨    | iPhone 기기 축; canine 축과 정렬되지 않음                        |
| 장착 위치     | harness back 및 neck collar 동시 기록                   | 사람이 든 prototype; 최종 하네스 장착 아님                       |
| orientation   | raw axes 보존, 회전 보정 없음                           | 사람의 손/기기 방향에 따라 달라짐, 보정 없음                     |
| timestamp     | t_sec: test 시작 이후 상대 초, 세션마다 reset           | 각 sensor callback Date.now() Unix 정수 ms, hardware clock 아님  |
| 동기화        | 한 t_sec에 두 센서 위치의 12축                          | accel/gyro 비동기 callback, 개별 timestamp 유지                  |
| 채널          | 두 위치 각각 accel3 + gyro3                             | accel3 + gyro3; GPS는 별도 표시 경로                             |
| annotation    | Task, Behavior_1/2/3, PointEvent                        | 자동 행동 label 없음; capture context만 있음                     |
| 전처리        | 확인된 100Hz → 50Hz time interpolation + anti-alias FIR | 강제 resampling 없음, timestamp로 completeness 검사              |

공개 데이터의 단위를 UNKNOWN으로 유지하므로 accel/gyro 수치의 절대 크기를 iPhone과 직접 비교하거나 합쳐 모델을 학습할 준비는 아직 되지 않았다. 특히 자이로 값이 커 보인다는 이유로 deg/s → rad/s 변환하지 않는다. 제조사 일반 사양만으로 이 파일의 export 단위까지 확정하지 않는다.

Magnitude는 각 장치 내부의 직교 축 회전에 불변이지만, 장착 위치·부착 강성·단위·중력·센서 성능 차이를 제거하지 않는다. 중력 제거와 high-pass는 이번에 적용하지 않는다. mean/variance 특징과 원본 axes를 함께 유지하여 후속 실험에서 필요성을 판단한다.

## 실제 발견한 전송 문제

Goal 1의 최신 gyro를 accel callback마다 묶던 방식은 gyro가 아직 새로 도착하지 않은 경우 같은 timestamp를 재사용했다. 첫 Goal 2 캡처 3,278 frame 중 gyro 재사용 243회, accel 49.7163Hz / 고유 gyro 46.0227Hz였다. 프레임 rate만 측정하면 숨겨지는 차이다. 엄격한 품질 검사는 이 캡처의 모든 3초 window를 INVALID_WINDOW로 처리했다.

모바일 전송은 양쪽 새 reading이 갖춰진 callback에서 pair를 전송하도록 보완했다. gyro가 없거나 40ms 이상 갱신되지 않은 경우 accel callback 전송, accel이 없거나 1초 지연된 경우 gyro fallback, 100ms 상태 heartbeat는 유지한다. 이 방식도 hardware 동시 샘플링을 보장하지 않으므로 원래 timestamp와 skew/repeat/gap 검사로 결과를 판정한다.

[전체 감사](dataset-audit.md), [실제 검증 결과](goal2-validation.md), [출처](data-sources.md).

논문 본문(2026-10-08, Europe PMC의 PMC8777071 full-text XML 확인)은 센서를 하네스 등 벨트와 목 아래쪽 collar에 부착하고 실험 중 방향을 유지했다고 설명한다. CSV의 물리 단위나 iPhone 축으로의 회전 행렬은 제공하지 않아 확정하지 않는다. 100Hz는 CSV에 표현된 균일 timeline의 실측이며 hardware jitter/원본 기기의 누락이 전혀 없었다는 증명은 아니다.

수정 후 실기기 재검증: 양 센서 1,002개 고유 sample, 각각 49.7194Hz, timestamp 재사용 0회. 실제 3초 VALID window 5개에서 공통 pipeline을 사용할 수 있었으며 gap 및 incomplete window 2개는 거부했다. 원본 상세 결과는 [Goal 2 검증](goal2-validation.md)에 기록했다.

## Goal 3 모델 호환성

제조사 IMU export 문서, 데이터 논문, 저자 분석 코드와 실제 수치까지 추가 조사했으나 CSV 저장 단위를 확정하지 못했다. 가속도/자이로 UNKNOWN을 유지하며 변환하지 않았다. 공개 v4 native unit space의 입력만 SUPPORTED다. 올바른 iPhone g/rad/s 입력은 UNVALIDATED, 잘못된 schema/단위/quality는 INVALID이며 둘 다 추론을 거부한다. 상세 [단위 근거·모델 설계](goal3-model-design.md), 실제 결과 [Goal 3 검증](goal3-validation.md). 기존 실기기 캡처의 112-feature 회귀는 재검사했으나 이번 Goal에서 새 실기기 측정은 하지 않았다.
