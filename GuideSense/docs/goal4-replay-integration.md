# Goal 4 Replay integration

기존 FastAPI 단일 worker에 socket별 `ReplaySession`을 추가했다. `/ws/device`, `/ws/dashboard`, capture와 timeout은 그대로 사용한다. live snapshot에는 `source=iphone_live`를 추가했으며 TS schema는 기존 fixture를 위해 이 값을 기본값으로 허용한다. 실제 서버는 항상 source를 보낸다.

## API와 상태

- `GET /api/replays`: 고정 allowlist의 clip ID/존재 여부. 파일 존재가 검증 성공을 뜻하지 않는다.
- `WS /ws/replay`: 해당 연결만 소유하는 독립 세션. 메시지는 `{action, clip_id?, command_id?}`. action은 `play`, `pause`, `resume`, `stop`, `restart`, `status`. HTTP로 파일 경로를 받거나 임의 파일을 실행하지 않는다.
- 서버 응답 `type=replay_snapshot`, `source=canine_dataset_replay`, `is_live=false`, state/run_id/command_id/clip_id/manifest/elapsed_seconds/duration_seconds/progress/sample_count/analysis_count/sample/samples/prediction/error/speed.
- `samples`는 해당 tick까지 도달한 시간순 50Hz 원본 파생 sample batch다. saved model_prediction은 전송하지 않는다. `sample`은 현재 마지막 sample이며 완료/중지/오류에는 null이다. `prediction`은 실제 실행된 마지막 window 결과다.
- `IDLE → PLAYING ↔ PAUSED → COMPLETED`. Stop은 STOPPED, 검증/추론 오류는 ERROR. Play/Restart는 다시 파일을 검사한다. COMPLETED prediction은 과거 분석이며 재생 중·일시정지 때도 마지막 완성 window의 결과임을 표시한다.
- 최대 8개 replay socket. 각 client는 별도 clock/model/cursor를 가진다. 다른 Dashboard의 Stop이 다른 세션을 중지하지 않는다. socket close/모드 전환 시 세션 폐기. 단일 worker만 지원한다.
- Python monotonic clock, 1× 고정. Pause 시간을 차감하고 Resume anchor를 조정한다. 수신·재생·추론은 live SensorHub와 분리하고 파일 읽기/feature/model 실행을 `asyncio.to_thread`로 넘긴다. snapshot은 100ms 주기이며 느린 socket send는 2초 timeout으로 종료한다. 연결 heartbeat가 5초 없으면 UI를 비우고 최대 10초 backoff로 다시 연결한다.
- 앱 초기화의 capture Lock을 lifespan 내부로 이동해 Python 3.9에서 이미 종료된 이벤트 루프 뒤 앱을 새로 만드는 경우도 처리했다. capture 계약은 변경하지 않았다.

## 실제 ML 경로

`RecordedClip`은 Goal 3 `validate_replay`, `ActivityModel`, Goal 2 `IMUSeries → make_window → extract_features`를 재사용한다. 학습/튜닝 코드 호출은 없다.

1. manifest/version/checksum, source/hash/units/전처리/model hash, 고정 DogID split, 50Hz timestamp·elapsed 시간, 정확한 xyz finite sensor schema, window quality/available_at을 검사한다.
2. 저장 모델 metadata는 기존 loader에서 112개 feature 순서, version, sampling/window, scikit-learn 버전, class, estimator type/hyperparameters, model checksum을 검사한다.
3. `samples.jsonl`은 Goal 2 공통 FIR를 이미 적용한 50Hz 값이다. 원본을 다시 downsample하거나 이중 FIR를 적용하지 않는다. raw-back.csv에는 외부 ±0.2초 context가 없으므로 raw 파일만으로 FIR를 다시 계산하는 것은 원래 모델 입력을 재현하지 못한다.
4. 출처를 보존한 6축 sensor-only IMUSeries를 구성한다. label, Task, PointEvent, 사전 예측은 feature 입력에서 제외한다.
5. 재생 clock이 window_end + 0.2초에 도달해야 150개 sample window를 만들고 품질을 재검사한다. INVALID_WINDOW는 모델을 호출하지 않는다. 유효하면 기존 공통 112 feature → 저장 RandomForest 실행.
6. 결과에 actual_activity, predicted_activity, quality/reasons, model/version, feature_count=112, inference_executed, offline_precomputed=false, matches_actual, matches_saved를 분리한다. saved prediction은 실행 후 비교용으로만 쓴다.

모델 `goal3-v1`, SHA256 `794d7cec8accee97ada65a45237de417ce8b7879a9531f73c6ede3add1ff7ebb`를 보존했다. 기존 Accuracy 90.83%, Macro F1 0.8856을 재평가·갱신하거나 데모 정확도로 대체하지 않는다. iPhone UNVALIDATED 및 CSV 단위 UNKNOWN을 유지한다.

## 실제 clip 감사와 선택

| ID               | 기록                                      | Sample / Window | Actual 및 실제 재추론                                             |
| ---------------- | ----------------------------------------- | --------------- | ----------------------------------------------------------------- |
| dog22-demo       | Test Dog 22/Test 2, [567,597)s, 연속 30초 | 1,500 / 10      | 첫 Walking→Walking. 나머지 9개 Actual null, Predicted Walking     |
| dog45-transition | Test Dog 45/Test 1, [402,432)s, 연속 30초 | 1,500 / 10      | Walking 5개, null 4개, Sitting 1개. 예측 Walking 9개, Sitting 1개 |
| dog44-posture    | Test Dog 44/Test 1, [513,522)s, 연속 9초  | 450 / 3         | 실제 Lying chest 3개 모두 Sitting으로 오분류                      |

Dog 22의 sample label은 Walking 824개, 미주석 621개, **Pacing 55개**다. Pacing은 모델 클래스가 아니며 단일 정답 검증 대상이 아니다. Goal 3 계약 문서의 Walking/undefined 설명만으로는 이 부분을 놓칠 수 있어 실제 artifact를 다시 감사했다.

Dog 45는 기존 Test features를 dog/test/start 순 정렬하고 30초 내 두 종류의 eligible Actual을 포함하는 첫 구간으로 선택했다. Dog 44는 해당 Test dog의 첫 Lying chest window부터 9초를 선택했다. 두 선택 모두 모델 예측을 조회하기 전에 annotation으로 결정했으며, 결과에 맞춰 다시 선택하거나 모델을 조정하지 않았다. 세 clip은 연결한 montage가 아니라 각각 독립된 연속 기록이다.

## 파일·의존성이 없는 환경과 행사 bundle

기존 준비된 모델을 신뢰할 수 있는 경로에서 복사한다. **Goal 4에서는 학습하지 않는다.** 모델이 없으면 ERROR이며 기존 Goal 3 artifact를 확보해야 한다. `pip install -e 'ml/gait[model]'`로 고정된 분석 의존성을 설치한다. ML 의존성이 없어도 기존 LIVE API는 실행 가능하고 replay만 명시적으로 실패한다.

원본이 있는 환경의 추가 clip 생성:

```bash
services/api/.venv/bin/python -m guidesense_gait.activity replay --demo
services/api/.venv/bin/python -m guidesense_gait.activity replay \
  --dog 45 --test 1 --start 402 --seconds 30 --output artifacts/goal4/replay-transition
services/api/.venv/bin/python -m guidesense_gait.activity replay \
  --dog 44 --test 1 --start 513 --seconds 9 --output artifacts/goal4/replay-posture
```

이미 있는 경로는 덮어쓰지 않는다. 새로 만드는 환경에서만 실행한다. 원본이 없다면 `python3 scripts/download_canine.py` 후 생성할 수 있지만 행사 당일에는 다음 bundle을 사용한다.

```bash
services/api/.venv/bin/python scripts/package_goal4_demo.py
# 새 Mac의 GuideSense 프로젝트 루트에서, 신뢰하는 bundle을 받은 뒤
unzip -n /path/to/guidesense-demo.zip
services/api/.venv/bin/python -m guidesense_gait.activity check-replay
```

bundle은 model.joblib/metadata + 세 clip의 manifest/samples/windows/raw-back 최소 추출 + 출처/시연 문서 + 검증 결과를 포함한다. 2GB 원본, training features, iPhone capture/GPS, credentials는 제외한다. loader는 원본 CSV 없이 이 bundle만으로 23개 window를 추론할 수 있다. bundle은 `artifacts/`의 Git 제외 경로에 생성하며 외부 업로드/배포는 하지 않는다. joblib은 코드 실행 가능한 serialization이므로 신뢰하는 모델만 사용한다.

공식 [Mendeley v4](https://data.mendeley.com/datasets/vxhx934tbn/4)는 CC BY 4.0으로 표시되어 있고, [CC BY 4.0 조건](https://creativecommons.org/licenses/by/4.0/)은 저작자·출처·라이선스 링크·변경사항 표시를 요구한다(2026-10-08 확인). 최소 파생 clip을 전달할 때도 manifest의 attribution 및 변경 기록을 유지하며 저자의 보증으로 표현하지 않는다. 논문 인용은 [data-sources.md](data-sources.md)를 함께 제공한다.

인증/TLS/인터넷 공개는 여전히 범위 밖이며 신뢰하는 로컬 네트워크에서만 시연한다. 모델/clip 경로는 서버의 고정 목록이다. 미래 음성 출력은 현재 Brooch의 실행 결과 projection을 adapter로 확장할 수 있다.
