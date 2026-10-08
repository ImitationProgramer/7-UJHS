# Goal 3 → Goal 4 Dataset Replay contract

## 모드와 출처

Goal 3는 replay **파일/추론 인터페이스**까지 제공한다. 실제 재생 scheduler, Dashboard 모드 전환/그래프 UI, WebSocket replay endpoint는 Goal 4 범위다. 기존 `/ws/device` 및 `/ws/dashboard` 프로토콜은 변경하지 않았다.

LIVE SENSOR는 실제 iPhone의 g/rad/s IMU/GPS다. DATASET REPLAY는 공개된 실제 개의 과거 기록으로, `source=public_canine_dataset`, `recording_mode=DATASET_REPLAY`, `is_live=false`를 보존한다. t_sec를 Unix 시각 또는 실시간 수신 시각으로 표시하지 않는다. replay는 GPS가 없으며 iPhone GPS로 채우지 않는다.

## 설치·학습·평가 재현

모든 명령은 `GuideSense/`에서 실행한다. 원본이 없으면 먼저 기존 `python3 scripts/download_canine.py`로 동일 v4를 내려받는다.

```bash
services/api/.venv/bin/python -m pip install -e 'ml/gait[model]'
services/api/.venv/bin/python -m guidesense_gait.activity prepare
services/api/.venv/bin/python -m guidesense_gait.activity train
services/api/.venv/bin/python -m guidesense_gait.activity evaluate
```

기본 경로는 `artifacts/goal3/dataset`, `artifacts/goal3/model`이다. 이미 생성된 실험 디렉터리는 덮어쓰지 않는다. 이 저장소의 로컬 환경에는 완성 artifact가 있으므로 위 명령을 반복할 필요가 없다. 별도 재현 환경/디렉터리는 각 명령의 `--dataset`, `--model`로 지정한다. Test를 재분할하거나 결과에 맞춰 튜닝하지 않는다. `evaluate`의 `test-evaluation.started`/결과 파일은 실험 이력으로 보존한다.

## 샘플 생성 및 검사

```bash
# 테스트 집합 첫 Walking을 예측 성공 여부와 무관하게 선택, 기본 30초
services/api/.venv/bin/python -m guidesense_gait.activity replay --demo

# 특정 DogID/TestNum/구간 선택 (출력 경로는 새 디렉터리)
services/api/.venv/bin/python -m guidesense_gait.activity replay \
  --dog 22 --test 2 --start 567 --seconds 30 \
  --output artifacts/goal3/replay-dog22

# 기존 파일 검증
services/api/.venv/bin/python -m guidesense_gait.activity check-replay \
  --output artifacts/goal3/replay-demo

# 원본 public window -> 공통 전처리 -> 저장 모델의 실제 추론
services/api/.venv/bin/python -m guidesense_gait.activity infer \
  --dog 22 --test 2 --start 567
```

`--seconds`는 양의 3초 배수, 최대 300초다. start는 50Hz grid에 맞고 전후 0.2초 FIR context를 포함해 한 세션 안에 있어야 한다. session 경계/품질 오류는 조용히 메우지 않는다. CLI는 원본 전체 SHA256를 검증한 후 세션을 chunk로 읽는다.

기본 실제 샘플은 Dog 22 / TestNum 2 / [567,597)s, **Test split**, 50Hz 1,500개 sample, 원본 100Hz 3,000행, 10개 window다. 첫 [567,570)s는 실제 Walking, 예측 Walking. 후속 9개 window에는 미주석/전환이 있어 window 정답은 null이며 평가 대상이 아니다. 이들의 원래 행별 Walking/undefined annotation은 보존한다. 성공 예측만 모은 montage가 아니라 연속 원본 구간이다.

## 파일 구조

```text
replay-demo/
  manifest.json     # 출처, 버전, 단위, split, 파일 checksum, attribution
  samples.jsonl     # 시간순 50Hz, filter 처리된 실제 Back 6축 및 원문 annotation
  windows.jsonl     # 3초별 품질/실제 label/예측, 사용 가능한 시점
  raw-back.csv      # 선택 구간의 원본 100Hz Back 값, t_sec/labels/Task/PointEvent
```

raw-back.csv는 원본 전체 복사가 아니라 선택 구간의 Back 열과 annotation만 추출한 로컬 파생 파일이다. samples는 합성값이 아니라 원본을 공통 FIR로 처리한 값이다. filter에 사용된 ±0.2초 context는 원본 CSV에서 얻으며 raw-back.csv의 선택 범위 밖 context는 포함하지 않는다. 선택 구간을 같은 방법으로 완전히 재생성하려면 원본 CSV를 사용한다.

### Manifest (`guidesense-recorded-canine-replay-v1`)

| 필드                                             | 의미                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- |
| source / recording_mode / is_live                | public_canine_dataset / DATASET_REPLAY / false                 |
| dataset_source / dataset_version / source_sha256 | 원본 URL / mendeley-vxhx934tbn-v4 / 검증 CSV hash              |
| dog_id / test_num / session_id                   | 개체 / 반복 실험 / `dog-22-test-2`처럼 추적 가능한 키          |
| timestamp_basis                                  | seconds_since_test_start; not Unix/live time                   |
| split / is_training_data                         | train, validation, test, external / Train 여부                 |
| start / end / sampling_rate / samples / windows  | 상대초 구간 / 50 / 행 수 / window 수                           |
| units / unit_space                               | acceleration UNKNOWN, gyroscope UNKNOWN / v4 native-unverified |
| preprocessing_version / signal_representation    | 공통 전처리 버전과 실제 신호 처리 설명                         |
| model_version / model_sha256                     | goal3-v1 / 저장 모델 hash                                      |
| attribution / license / license_url / changes    | 저자·출처·CC BY 4.0·수정사항                                   |
| files                                            | samples.jsonl/windows.jsonl/raw-back.csv의 SHA256              |

### samples.jsonl

각 행에는 manifest의 source/mode/dataset URL/version/dog/session/split/model version을 반복 보존한다.

| 필드                       | 형식·의미                                                       |
| -------------------------- | --------------------------------------------------------------- |
| timestamp                  | float, 세션 상대초, 엄격 증가, 0.02초 간격                      |
| elapsed_seconds            | float, 선택 구간 시작 이후 초                                   |
| accelerometer / gyroscope  | `{x: number, y: number, z: number}`, finite, UNKNOWN 단위       |
| label                      | array of strings; 동시 원문 행동 집합, 미주석이면 `[]`          |
| behavior_annotations       | Behavior_1~3의 원문, `<undefined>`도 보존                       |
| task / point_event         | 원문 별도 보존, 예측 정답으로 사용하지 않음                     |
| window_id / window_quality | window 참조 / VALID 또는 INVALID_WINDOW                         |
| model_prediction           | `{predicted_activity, available_at, offline_precomputed: true}` |

50Hz annotation은 동일 시각의 원본 100Hz 행을 찾는다. label 보간/다수결을 하지 않는다. `label`은 센서 시점 관찰이고 `model_prediction.predicted_activity`는 해당 3초 창의 추정으로 의미가 다르다.

### windows.jsonl / 모델 추론

각 window는 `[window_start, window_end)`이며 다음을 가진다.

- `actual_activity`: strict label 정책을 통과한 정답 또는 null.
- `label_quality`: actual_activity, reasons, purity_required=1.0, raw_sample_count.
- `evaluation_eligible`: 실제 label이 최종 모델 클래스에 속하는가.
- `window_quality`, `quality_details`: 센서 품질 및 거부 사유. label ambiguity와 센서 품질은 별개다.
- `predicted_activity`: 모델 예측 또는 invalid이면 null. 정답을 덮어쓰지 않는다.
- `model_prediction`: predict_window의 결과. source/mode/model version/dog/test/split/compatibility/window start/end 포함.
- `prediction_available_at`: window_end + 0.2초. `offline_precomputed=true`.

실제 CLI 출력의 핵심 필드:

```json
{
  "source": "public_canine_dataset",
  "recording_mode": "DATASET_REPLAY",
  "model_version": "goal3-v1",
  "dog_id": 22,
  "test_num": 2,
  "split": "test",
  "actual_activity": "Walking",
  "predicted_activity": "Walking",
  "window_quality": "VALID",
  "compatibility": "SUPPORTED",
  "window_start": 567.0,
  "window_end": 570.0
}
```

이 값은 실제 저장 모델 실행 결과이며 예시용 가상 추정값이 아니다. 점수/확률/건강 진단 문구는 출력하지 않는다.

## Goal 4 소비 방식

1. manifest/version/checksum을 검사하고 화면에 **DATASET REPLAY / recorded canine IMU / DogID / TestNum / split**을 명시한다. 단위는 UNKNOWN으로 표시한다.
2. 단조 재생 clock을 사용해 `elapsed_seconds`에 도달한 sample을 순서대로 전달한다. native 1× 속도는 20ms 상당이며 화면 렌더링은 별도로 낮은 빈도를 사용할 수 있다.
3. 각 prediction은 미리 계산되어 있어도 재생 시간이 `prediction_available_at`에 도달한 후 공개한다. 공통 FIR가 비인과이므로 3초 window 뒤 0.2초의 context가 필요하다. 마지막 결과까지 clock을 추가 0.2초 진행하거나 offline 완결 결과로 별도 표시한다.
4. 실제 annotation과 예측을 별도 필드로 표시한다. `actual_activity=null`은 잘못 예측했다는 뜻이 아니라 single-label 평가 정답이 없다는 뜻이다.
5. train/validation/test 출처를 항상 보존한다. Train 샘플의 성공을 unseen-dog 평가 결과로 사용하지 않는다.
6. replay는 기존 실시간 connection/timeout 수신 상태를 덮어쓰지 않는다. 실시간 입력과 별도 source 상태로 연결한다.

파이썬 소비자는 `ActivityModel(folder).predict_window(window)`, `compatibility(window)`, `validate_replay(folder)`를 사용할 수 있다. 모델은 UNVALIDATED iPhone 입력을 거부한다. replay 생성은 사용자 iPhone 스트리밍 상태와 독립적이다.

## 라이선스·배포

[Mendeley v4](https://data.mendeley.com/datasets/vxhx934tbn/4)는 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)이다. 파생 replay를 외부에 제공할 때도 manifest의 저자/출처/라이선스 링크 및 Back 선택·resampling·예측 추가라는 변경사항을 함께 유지한다. 저자의 GuideSense 보증으로 표시하지 않는다. 데이터 저자가 요청한 Vehkaoja et al. (2022), Kumpulainen et al. (2021) 인용은 [data-sources.md](data-sources.md)에 유지한다.

원본, raw-back.csv, samples, features, 모델 binary는 `data/external/` 또는 `artifacts/`의 Git 제외 경로에 둔다. 이번 작업은 외부 배포하지 않았다. Git으로 공유되는 생성 코드·계약·집계 결과와 로컬 센서 파일을 구분한다.
