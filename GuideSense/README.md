# GuideSense

iPhone의 실제 가속도·자이로·GPS를 Mac으로 보내는 센서 파이프라인과 공개 canine 데이터 기반 오프라인 행동 분류 프로토타입입니다. 안전·건강 판단을 하지 않으며, 공개 데이터 모델을 실제 iPhone에 적용하지 않습니다. Goal 4에서 LIVE SENSOR와 실제 canine DATASET REPLAY·저장 모델 재추론을 하나의 Dashboard에 통합했습니다.

## 프로젝트 구조

```text
GuideSense/
  apps/
    mobile/          # Expo + React Native + TypeScript, 실제 iOS 센서
    dashboard/       # React + TypeScript + Vite, LIVE SENSOR + DATASET REPLAY
  services/api/      # Python + FastAPI, WebSocket relay, 테스트
  packages/protocol/ # 공유 TypeScript/Zod 모델, 상태/표시 토큰
  ml/gait/           # 공통 112-feature pipeline, canine 학습·추론·replay CLI
  data/external/     # 공개 canine 원본, Git 제외
  data/captures/     # 명시적 iPhone IMU capture, Git 제외
  docs/              # 아키텍처, 프로토콜, 검증 기록
  tests/             # 단위 테스트 및 브라우저 E2E
```

## 준비

- Mac: Node.js 22.12+ 또는 24 LTS, npm, Python 3.9 이상. 테스트 환경은 Node 24 / Python 3.9입니다.
- iPhone 16 Pro: Expo Go, Mac과 동일한 Wi-Fi. 사용자 요청 대상 OS는 iOS 27이며 실제 검증 여부는 [검증 기록](docs/validation.md)에 별도로 기록합니다.
- Expo SDK 57 / React Native 0.86.3 / React 19.2.3을 사용합니다. 실제 iPhone에 설치된 Expo Go의 SDK 57.0.0과 맞췄습니다. SDK 호환성은 설치된 Expo Go의 오류 화면/지원 버전을 기준으로 확인하세요. [공식 SDK 업그레이드 안내](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)처럼 설치된 Expo Go가 다른 SDK를 요구한다면 임의로 React Native만 올리지 말고 Expo SDK와 의존성을 함께 맞추세요.

모든 명령은 별도 설명이 없으면 `GuideSense/`에서 실행합니다.

```bash
cd GuideSense
npm ci
```

## 1. Mac에서 Backend 실행

```bash
cd services/api
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock.txt
uvicorn guidesense_api.main:app --host 0.0.0.0 --port 8000 --ws-max-size 16384
```

다른 터미널에서 `curl http://localhost:8000/health`로 확인합니다. `acceptedFrames`는 검증을 통과한 수신 프레임 수, `lastReceivedAt`은 Mac 수신 시각입니다. 기본 relay는 메모리의 최신 한 개만 보관합니다. 명시적 Capture Start/Stop 구간에서는 IMU만 별도 저장하며 GPS는 저장하지 않습니다.

상태 timeout 기본값은 3초입니다. 필요하면 실행 시 `DEVICE_TIMEOUT_SECONDS=5 uvicorn ...`으로 조정합니다. 상태와 연결을 프로세스 메모리에 보관하므로 **worker 한 개만** 사용합니다. `--workers 2` 등은 지원하지 않습니다.

## 2. Dashboard 실행

새 터미널에서:

```bash
cd GuideSense
npm run dashboard
```

Mac 브라우저에서 <http://localhost:5173>을 엽니다. 기본 Backend는 현재 호스트의 8000번 포트입니다. 화면의 Backend 주소 입력 후 **연결 적용**을 누르면 변경할 수 있습니다. 또는 `apps/dashboard/.env.local`에 `VITE_BACKEND_URL=http://Mac-IP:8000`을 설정한 후 재시작합니다.

## 3. iPhone에서 Expo 실행

```bash
cd GuideSense
npm run mobile
```

1. iPhone에 Expo Go를 설치하고 Mac과 같은 Wi-Fi에 연결합니다.
2. Expo 터미널에 표시되는 QR을 iPhone 카메라로 스캔하여 Expo Go에서 엽니다.
3. 로컬 네트워크 접근 요청을 허용합니다. Expo Go 화면의 **Backend 주소**에 `http://Mac-IP:8000`을 입력합니다.
4. **Start Streaming**을 누르고 동작/위치 권한을 허용합니다. 위치는 “앱을 사용하는 동안”을 선택하고 정확한 위치를 활성화합니다.
5. 앱을 전면에 유지하고 iPhone을 움직입니다. 잠금/백그라운드 이동 시 수집을 중지합니다. 다시 돌아오면 Start를 눌러야 합니다.
6. **Stop Streaming**으로 전송과 센서 구독을 중지합니다.

Backend 주소는 앱에 저장됩니다. 기본값을 미리 넣으려면 `apps/mobile/.env.local`에 `EXPO_PUBLIC_BACKEND_URL=http://Mac-IP:8000`을 작성하고 Expo를 재시작하세요. 이미 저장된 주소가 있다면 앱의 입력값이 우선합니다.

## 같은 네트워크 연결

Mac의 Wi-Fi IP 확인:

```bash
ipconfig getifaddr en0
```

값이 없으면 시스템 설정 → 네트워크 → Wi-Fi → 세부사항 → TCP/IP에서 IPv4 주소를 확인합니다. 예를 들어 `192.168.1.100`이라면 iPhone의 Backend는 `http://192.168.1.100:8000`입니다. **iPhone에서 `localhost`나 `0.0.0.0`을 입력하면 Mac으로 연결되지 않습니다.**

- 먼저 iPhone Safari에서 `http://Mac-IP:8000/health`가 열리는지 확인합니다.
- macOS 방화벽에서 Python/Node의 수신 연결을 허용합니다. 8000(API), 5173(Dashboard), 8081(Expo) 포트를 사용합니다.
- 게스트 Wi-Fi/회사 Wi-Fi의 기기 간 격리, VPN은 통신을 막을 수 있습니다. 동일한 일반 Wi-Fi나 기기 간 통신이 가능한 핫스팟을 사용합니다.
- Expo 터널은 Metro 접근만 해결합니다. Backend의 사설 IP까지 터널링하지 않습니다.
- Expo Go의 권한 문구는 Expo Go 자체 설정을 사용합니다. `app.json`의 로컬 네트워크/동작/위치 설명과 HTTP 개발 허용 설정은 자체 development build에 적용됩니다.
- 이 버전은 신뢰하는 로컬 네트워크에서만 사용합니다. 인증/TLS/다중 기기는 구현하지 않았으므로 인터넷에 포트를 공개하지 마세요.

## 상태와 결측값

- **Device CONNECTED**는 최근 3초 이내 유효 프레임을 수신했다는 뜻입니다. 모든 센서가 정상이라는 뜻은 아닙니다.
- 서버 연결과 기기 연결 상태를 분리합니다. Dashboard↔API가 끊어져도 이전 CONNECTED가 남지 않습니다.
- `ready`인 센서에만 실제 값이 있습니다. 권한 거부/사용 불가/오류/수신 대기/지연/중지는 `null` 및 해당 상태로 전송됩니다. UI는 `—`를 표시합니다. 실제 0은 그대로 0으로 표시합니다.
- 동작 센서는 1초, GPS는 15초 넘게 갱신되지 않으면 `stale` 및 `null`로 전송됩니다. GPS의 `accuracy` 자체가 알려지지 않으면 `null`입니다.
- Accelerometer는 **g, 중력 포함**, Gyroscope는 **rad/s**입니다. 좌표축은 iPhone 기기 기준입니다. GPS는 WGS84 위도/경도, 정확도는 미터입니다.
- 목표는 동작 센서 20ms / 약 50Hz입니다. 새 가속도·자이로 쌍을 완성한 센서 콜백에 맞춰 전송하며 OS 스케줄링에 따라 실제 속도는 달라집니다. 동작 센서 콜백이 없으면 100ms 상태 heartbeat만 보냅니다. 두 동작 센서는 각자의 timestamp를 유지하며 동시 샘플링을 보장하지 않습니다. 한 센서가 지연되면 callback/status heartbeat fallback을 사용합니다. GPS는 더 느린 별도 스트림입니다.
- 대시보드는 최신 상태를 10Hz로 화면에 반영합니다. LIVE 서버/네트워크 수신은 약 50Hz이며 live 그래프/이력은 없습니다. Replay는 시간순 50Hz sample을 약 10Hz batch로 표시하고 최근 15초 magnitude 그래프를 제공합니다.
- iPhone은 연결 실패 시 센서를 정리하고 재시작 안내를 표시합니다. 대시보드는 최대 10초 간격으로 자동 재연결합니다.

## 테스트 절차

자동 검증:

```bash
npm run typecheck
npm test
npm run build
npm run format:check
cd services/api
.venv/bin/python -m pytest -q
.venv/bin/ruff check .
.venv/bin/ruff format --check .
cd ../..
npx playwright install chromium
npm run test:e2e
```

브라우저 E2E는 **별도 포트 8001/5174**에서 테스트용 API/웹 서버를 띄우며, `test-device`의 합성 프레임만 사용합니다. 실기기 수신 환경(8000/5173)과 섞이지 않습니다. 합성 E2E 통과는 실제 iPhone 검증을 대체하지 않습니다.

실기기 E2E:

1. API / Dashboard / Expo를 실행하고 iPhone으로 접속합니다.
2. Start 후 iPhone을 실제로 기울이고 회전합니다. 앱의 X/Y/Z 변화, `/health`의 `acceptedFrames` 증가, Dashboard의 동일 센서값 변화를 확인합니다.
3. 위치 권한 허용 후 GPS 위도/경도/정확도가 앱과 Dashboard에 표시되는지 확인합니다. 실내에서는 수신이 지연될 수 있습니다.
4. Stop 후 약 3초(상태 tick/화면 갱신 포함 최대 약 3.4초)에 DISCONNECTED 및 `—`가 표시되는지 확인합니다. 마지막 수신 시각은 남습니다.
5. Start를 다시 눌러 재연결합니다. Wi-Fi 끊기/API 종료도 확인하고 재시작합니다.
6. 위치 권한을 거부한 후 다시 시작하여 GPS가 “권한 거부”/`—`이고 동작 센서는 계속 수신되는지 확인합니다.

실행 결과와 실기기 증거는 [docs/validation.md](docs/validation.md), 구조/프로토콜은 [docs/architecture.md](docs/architecture.md)를 참고하세요.

## 이번 단계에서 구현하지 않은 항목

실제 안내견/iPhone 행동 모델 전이 검증, 건강 진단, TMAP, OpenAI API, 알람/진동/음성, 실제 브로치 음성 출력, 웨어러블 하드웨어, 백그라운드 수집, GPS 저장/그래프, 인증/인터넷 배포, 다중 기기 라우팅.

## Goal 2: 공개 canine + 실제 iPhone 공통 데이터 계층

공개 데이터 전체 10,611,068행/45 dogs/62 sessions를 검사했다. Back sensor가 기본이며 label은 CSV 원문을 보존한다. 모델/질병 판단은 없다. [감사](docs/dataset-audit.md), [출처·라이선스](docs/data-sources.md), [호환성](docs/sensor-compatibility.md), [실제 검증](docs/goal2-validation.md).

설치·다운로드·전수 감사:

```bash
services/api/.venv/bin/python -m pip install --upgrade pip
services/api/.venv/bin/python -m pip install -e ml/gait
python3 scripts/download_canine.py
services/api/.venv/bin/python -m guidesense_gait.audit
```

기존 relay는 추가 분석 패키지 없이도 실행된다. 분석 의존성은 numpy/pandas/scipy이며 버전은 `ml/gait/pyproject.toml`에 고정했다.

사용자가 iPhone Start Streaming을 누른 뒤 Mac에서 명시적으로 캡처:

```bash
curl -X POST http://localhost:8000/api/capture/start \
  -H 'Content-Type: application/json' -d '{"context":"human_held_phone"}'
curl http://localhost:8000/api/capture/status
# 충분히 수집한 다음 종료 (권장 15–20초)
curl -X POST http://localhost:8000/api/capture/stop
```

응답의 session_id 디렉터리에는 `session.json`과 `imu.jsonl`이 저장된다. GPS는 제외된다. 사람의 손에서 수집했으면 `human_held_phone`을 사용한다. Capture Stop은 iPhone 전송 자체를 끄지 않으므로 iPhone에서 Stop Streaming을 별도로 누른다.

재현 가능한 비교 script (notebook 불필요):

```bash
services/api/.venv/bin/python -m guidesense_gait.compare \
  --dataset data/external/mendeley-v4/DogMoveData.csv \
  --dog 16 --test 1 \
  --capture data/captures/SESSION_ID \
  --output artifacts/comparison.json
```

기본은 첫 연속 Walking annotation 구간 내부의 3초 및 첫 VALID iPhone 3초 window다. `--dog-start 105.39`, `--iphone-start 3`으로 정확한 초를 지정할 수 있다. JSON에는 양쪽 quality/sample count/rate, magnitude 통계, 112개 feature 및 순서가 나온다. INVALID는 features=null 및 exit code 2로 표시된다. UNKNOWN인 공개 데이터 단위 때문에 절대 수치의 물리적 동등성을 주장하지 않는다.

live buffer도 `from_live_buffer(frames)` → `make_window(series, start)` → `extract_features(window)`를 사용한다. dataset도 같은 두 함수를 사용한다. API capture와 분석을 분리하여 계산 부하가 실시간 relay를 막지 않는다.

추가 테스트:

```bash
services/api/.venv/bin/python -m pytest -q services/api/tests ml/gait/tests
services/api/.venv/bin/ruff check services/api ml/gait scripts/download_canine.py
services/api/.venv/bin/ruff format --check services/api ml/gait scripts/download_canine.py
```

Goal 2 실기기 검증 완료: iPhone 양 IMU 49.72Hz / 1,002샘플, 공개 Walking과 동일 112-feature schema 확인. 실제 비교 재현은 `--capture data/captures/SESSION_ID`에서 직접 capture한 SESSION_ID를 사용한다. 기존 캡처와 실제 세션 ID는 Git에 포함하지 않는다.

## Goal 3: Canine Activity Classification & Replay Foundation

실제 공개 데이터 45마리/62세션/10,611,068행을 감사하고, 명확한 단일 행동 **7,361개 non-overlapping 3초 window**를 선정했다. 기존 Back 6축 → 50Hz → 112개 feature를 재사용했다. 원본 CSV 단위는 추가 조사 후에도 UNKNOWN이며 단위 변환을 하지 않았다.

- 31/7/7 DogID의 Train/Validation/Test 고정 분할, window/session 개체 누출 없음.
- 6클래스: Walking, Trotting, Sitting, Lying chest, Sniffing, Playing. Standing은 Validation 샘플 부족으로 제외.
- Validation으로 선택한 RandomForest(300 trees), Test 7마리/1,265개에서 **Accuracy 90.83%, Macro F1 0.8856**. Lying chest F1 0.7361, Sitting 0.7649 등의 한계를 함께 보고한다.
- 모델/metadata: `artifacts/goal3/model/model.joblib`, `metadata.json`. 원본·features·모델·replay는 Git 제외.
- 실제 Test Dog 22/Test 2 [567,597)s의 30초·1,500개 sample replay가 `artifacts/goal3/replay-demo/`에 생성되어 있다.
- iPhone은 UNVALIDATED이며 추론을 거부한다. 기존 iPhone/GPS/WebSocket/Dashboard 기능은 유지했다. 이번 Goal에서 새 실기기 측정은 하지 않았다.

설치 및 기존 로컬 모델 사용:

```bash
services/api/.venv/bin/python -m pip install -e 'ml/gait[model]'
services/api/.venv/bin/python -m guidesense_gait.activity infer --demo
services/api/.venv/bin/python -m guidesense_gait.activity check-replay
# 새 경로에 실제 recorded canine replay 생성
services/api/.venv/bin/python -m guidesense_gait.activity replay --demo \
  --output artifacts/goal3/replay-new
```

원본이 없는 환경에서는 기존 download script를 먼저 실행한다. 새 학습 환경의 순서는 `python -m guidesense_gait.activity prepare`, `train`, `evaluate`다. 이미 존재하는 데이터/모델 디렉터리는 덮어쓰지 않는다. Test를 반복 튜닝에 사용하지 않는다.

검증:

```bash
GUIDESENSE_REAL_DATA=1 services/api/.venv/bin/python -m pytest -q services/api/tests ml/gait/tests
services/api/.venv/bin/ruff check services/api ml/gait scripts
services/api/.venv/bin/ruff format --check services/api ml/gait scripts
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run format:check
```

`GUIDESENSE_REAL_DATA=1`은 로컬 실제 원본으로 생성한 artifact/모델/replay의 추가 integration 검사를 켠다. artifact가 없는 환경의 기본 pytest는 이 검사만 skip한다. 합성 자동 테스트, 과거 실기기 캡처 재분석, 새 실기기 측정을 구분한다.

[모델 설계·단위 근거](docs/goal3-model-design.md) · [실제 성능·분할·혼동행렬](docs/goal3-training-results.md) · [Goal 4 Replay 계약·재현 명령](docs/goal3-replay-contract.md) · [검증 기록](docs/goal3-validation.md).

## Goal 4: Dataset Replay & Integrated Dashboard

Dashboard 상단에서 **LIVE SENSOR / DATASET REPLAY**를 전환합니다. 실제 iPhone은 human-held/UNVALIDATED이며 개 행동을 추론하지 않습니다. Replay는 공개된 실제 개의 과거 기록임을 표시합니다. 3초·150개 IMU sample에서 공통 112개 feature를 다시 계산해 기존 저장 RandomForest를 실행합니다. 사전 예측 문자열을 재생하는 UI가 아닙니다.

- 기본 Test Dog 22/Test 2: 30초·1,500개 sample, Play/Pause/Resume/Stop/Restart, 마지막 분석 포함 COMPLETED.
- 추가 Test Dog 45/Test 1: 연속 30초 Walking→Sitting 전환.
- Test Dog 44/Test 1: 연속 9초, 실제 Lying chest → 예측 Sitting **오분류를 그대로 표시**.
- Actual/Predicted·Window Quality·Model Version 비교, magnitude 그래프, 실제 결과 기반 User Brooch 텍스트.
- 파일/모델/metadata/schema 오류 표시, socket별 독립 재생, live 수신과 분리.

Backend/Dashboard/iPhone 실행은 위의 기존 명령을 그대로 사용합니다. ML 의존성과 준비된 모델이 필요합니다.

```bash
services/api/.venv/bin/python -m pip install -e 'ml/gait[model]'
services/api/.venv/bin/python -m guidesense_gait.activity check-replay
# 원본과 모델이 있고 replay가 아직 없는 환경에서만 생성
services/api/.venv/bin/python -m guidesense_gait.activity replay --demo
# 행사 전 최소 artifact bundle 생성 (기존 출력은 덮어쓰지 않음)
services/api/.venv/bin/python scripts/package_goal4_demo.py
```

원본 2GB CSV 없이 시연하려면 신뢰하는 `guidesense-demo.zip`을 프로젝트 루트에 복원합니다. 기존 모델과 최소 추출 기록·출처·라이선스를 포함하며 iPhone/GPS 기록은 포함하지 않습니다. 모델이 없으면 기존 Goal 3 artifact를 확보해야 하며 이번 Goal에서는 재학습하지 않습니다. 바이너리와 데이터는 계속 Git 제외입니다.

[Dashboard 설계](docs/goal4-dashboard-design.md) · [Replay API/추론/clip 감사/라이선스/bundle](docs/goal4-replay-integration.md) · [자동·실기기 검증과 구현 파일](docs/goal4-validation.md) · [4분 Demo 실행 시나리오](docs/demo-scenario.md).
