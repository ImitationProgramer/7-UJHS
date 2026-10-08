# Goal 3 검증 기록

작업일: 2026-10-08 KST. macOS arm64 / Python 3.9.6 / Node 24.14.1. 실제 데이터 성능과 합성 테스트를 구분한다. 원본·집계 증거·모델·replay의 위치는 [실제 결과](goal3-training-results.md)에 있다.

## 실제 실행 증거

| 단계                     | 실제 결과                                                                        | 위치                                                             |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CSV 무결성/재사용        | 기존 v4 SHA256와 일치, 1,985,551,732 bytes                                       | 원본 download-manifest + dataset manifest                        |
| 전체 label/preprocessing | 10,611,068행 / 45 dogs / 62 sessions, invalid session 0                          | `artifacts/goal3/dataset/label-audit.json`                       |
| 후보/선정 window         | 35,398개 후보, clear 8,135개, 6클래스 최종 7,361개                               | dataset features/manifest                                        |
| 고정 개체 분할           | Train 31 dogs/5,206 windows, Validation 7/890, Test 7/1,265                      | dataset/model manifest 및 [분할 목록](goal3-training-results.md) |
| 학습/선택                | Dummy + RF unweighted/balanced 비교, Validation Macro F1로 unweighted 선택       | `artifacts/goal3/model/selection.json`                           |
| 저장/재로드              | 저장 모델과 메모리 모델의 Validation 890개 예측 전체 일치                        | selection.json `reload_predictions_identical=true`               |
| Test 평가                | Accuracy 0.908300, Macro F1 0.885608, Weighted F1 0.907902                       | `test-evaluation.json`, metadata, test-predictions.csv           |
| 실제 원본 추론           | Dog 22/Test 2 [567,570)s: Walking → Walking, VALID                               | CLI infer, replay 첫 window                                      |
| Replay export            | 같은 Test session의 연속 30초, 50Hz 1,500개, 원본 Back 3,000행, 10개 window      | `artifacts/goal3/replay-demo/`                                   |
| 출처/label/시간 검증     | Test 분할·DogID/TestNum, 상대 시간순서, annotation/예측 구별, 파일 hash 검증     | `check-replay` + 실제 integration test                           |
| Goal 2 실제 기록 회귀    | 기존 canine Walking 및 실제 iPhone capture 모두 VALID, 같은 112개 feature schema | `artifacts/goal3/goal2-regression.json`                          |

첫 Test Walking은 DogID/TestNum/start의 사전 정렬로 선택했다. 예측이 맞는 구간을 찾아 고른 것이 아니다. 후속 9개 replay window는 미주석/전환이 있어 실제 window 정답을 null로 보존하며 평가에 포함하지 않았다. Test 성능은 이 demo가 아니라 모든 선정 Test window에서 한 번 계산했다. 최종 평가 후 Test DogID, 모델 및 hyperparameter를 변경하지 않았다.

## 자동 테스트

- Python **67 passed**, 실제 로컬 artifact integration 포함: `GUIDESENSE_REAL_DATA=1 services/api/.venv/bin/python -m pytest -q services/api/tests ml/gait/tests`.
- 기존 37개를 유지하고 Goal 3의 30개를 추가했다. 원본 파일이 없는 환경의 일반 pytest에서는 실제 artifact integration 1개만 명시적으로 skip한다.
- TypeScript 모든 workspace typecheck 통과.
- Vitest **14 passed**: 기존 센서 pairing/프로토콜/표시 검사.
- Vite production build 통과.
- Playwright Chromium **3 passed**: 합성 device → 실제 FastAPI → browser 값/GPS 거부/timeout/reconnect, 키보드/좁은 화면, server heartbeat 단절 복구.
- Ruff lint/format 및 Prettier check 통과. Python 전체 dependency `pip check` 통과.
- `git check-ignore`로 원본 CSV, 파생 features, 모델, replay 센서 파일 및 원본 Back 구간 제외 확인.

최종 실행 stdout/stderr/exit code는 로컬 `artifacts/goal3/validation/`, 공유 가능한 요약은 [goal3-checks.json](goal3-checks.json)에 기록한다.

### 검사하는 결함

- Task와 실제 행동이 서로 다른 fixture에서 Behavior를 사용함. Behavior_3로 옮겨도 같은 정답; 하나라도 다른 동시 행동이 있으면 ambiguity 거부.
- undefined, label 전환, PointEvent, FIR context 다른 행동, 불완전 tail, 세션 혼합/비연속 재등장 거부.
- 원본 NaN/Inf, timestamp 중복/역행/NaN, 누락 sample, 부족 sample 거부. 기존 공통 resampling의 anti-alias/시간 검사 회귀 유지.
- 3초 150개·feature 순서 112개·UNKNOWN unit provenance 및 원본 불변성 확인.
- seed 재현/순서 독립 DogID split, 중복 DogID·세션 누출 및 겹친 window 거부. 모든 학습 후보가 Train만 fit하며 scaler를 호출하지 않음.
- 실제 training 성공, model checksum/재로드, schema/order/units/version/quality/nonfinite 입력 거부, metadata 불일치 거부, 한 실험의 Test 재평가 lock.
- iPhone 입력은 UNVALIDATED, 잘못된 iPhone 단위는 INVALID, 둘 다 모델 추론 금지.
- replay의 실제 label과 예측 분리, 시간 순서, 전처리된 값과 추출한 원본 구간, annotation 추적, Test/Train 표시, 세션 경계·손상 checksum 거부.
- 실제 artifact integration은 전체 feature 파일 checksum·split을 검사하고 Test replay의 첫 window 예측을 해당 실제 feature vector로 저장 모델에서 재계산하여 일치를 확인함.

## 실기기 검증 구분

**이번 Goal에서는 새 iPhone 실기기 테스트를 수행하지 않았다.** Goal 1/2의 기존 실제 iPhone E2E 기록은 [goal2-validation.md](goal2-validation.md)에 보존했다. 저장된 실제 capture `REDACTED_PAIRED_CAPTURE`(공유 문서에서 실제 세션 ID 제거)를 다시 분석해 과거 실제 데이터가 공통 feature 파이프라인을 통과함만 확인했다. 이는 새로운 실시간 연결 측정도, canine 행동 성능 검증도 아니다.

FastAPI, mobile, Dashboard 및 기존 공통 feature 함수는 변경하지 않았다. 자동 E2E는 별도 테스트 포트/합성 frame을 사용하며 실제 iPhone/GPS 수신을 대체하지 않는다. 실제 안내견, 하네스에 부착한 iPhone, 사용자 브로치 하드웨어는 이번에도 미검증이다.

## 미해결 사항과 Goal 4 준비

- 공개 CSV 물리 단위 UNKNOWN. 제조사 export 후보 g/degree/s만 확인했으며 파일에 대한 확정 근거가 없어 변환하지 않았다.
- 단일 holdout의 개체 편차, Lying chest/Sitting 혼동, 희소 Playing, 매우 엄격한 clean-window 선택 편향이 남는다. 자세 방향·feature 제약 등의 원인 후보는 보고했으나 인과를 확인하지 않았다.
- 실제 Dog 22/Test 2 원본에는 ABack_x -16.0/15.999512 및 GBack_y -2000.000122/1999.939087 등의 극값이 있다. 수치 단위나 clipping 여부를 확정하지 않는다. 현재 finite/timing 품질 검사는 센서 saturation의 임상적/물리적 유효성을 보증하지 않는다.
- 모델은 closed-set 6클래스이며 미지 행동/전환·복수 행동에 대한 검증된 rejection model은 없다. 어떠한 건강 상태 문구도 생성하지 않는다.
- Goal 4 연결용 manifest/samples/windows/raw Back extraction, model loader, CLI, timestamp/prediction 공개 시점 계약이 준비되어 있다. UI, 재생 scheduler, source mode 통합은 미구현이며 Goal 4에서 수행한다.

## 완료 기준

| 기준                               | 결과                                                            |
| ---------------------------------- | --------------------------------------------------------------- |
| 실제 공개 canine 데이터            | 검증된 기존 원본 전체 처리                                      |
| 단위 검증 보고                     | 추가 원문·제조사·저자 코드·실측 검토, UNKNOWN 유지              |
| 실제 annotation class 선정         | 복수·전환 구간 제외, 6개 선정 근거/전체 감사 저장               |
| 공통 50Hz/3초/112개 feature        | 기존 pipeline 재사용                                            |
| DogID Train/Validation/Test        | 고정 31/7/7, 동일 개체 session 독립 집합                        |
| unseen-dog 최종 평가               | Test 7마리/1,265개                                              |
| Accuracy/Macro F1/Confusion Matrix | 실제 실행값·클래스별/개체별 수치 문서화                         |
| 저장·재로드                        | 890개 Validation 예측 동일                                      |
| 실제 원본 window 추론              | Test Dog 22/Test 2 Walking 실행                                 |
| Replay 생성·출처·label             | 30초 실제 기록, source/mode/split/원문 annotation 보존          |
| Goal 1/2 회귀                      | 자동 테스트 통과 + 기존 실제 capture 재분석; 새 실기기는 미실행 |
| iPhone 한계                        | UNVALIDATED, 추론 거부 및 문서화                                |
