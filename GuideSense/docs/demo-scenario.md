# GuideSense 4분 시연

## 행사 전 준비

프로젝트 루트 `GuideSense/`에서 `npm ci`, API venv/requirements, `pip install -e 'ml/gait[model]'`를 준비한다. 모델과 replay가 없으면 신뢰하는 `guidesense-demo.zip`을 프로젝트 루트에 `unzip -n`으로 복원한다. bundle 생성·라이선스는 [Replay integration](goal4-replay-integration.md). 원본 2GB CSV 다운로드와 재학습은 행사 당일 필요 없다. 인터넷 없는 장소는 npm/pip 설치와 Expo Go 준비도 미리 끝낸다.

서로 다른 터미널:

```bash
# 1. Backend (한 worker)
services/api/.venv/bin/uvicorn guidesense_api.main:app --app-dir services/api \
  --host 0.0.0.0 --port 8000 --ws-max-size 16384
# 2. Dashboard
npm run dashboard
# 3. iPhone Expo
npm run mobile
```

Mac에서 <http://localhost:5173>, 상태 <http://localhost:8000/health>, replay 목록 <http://localhost:8000/api/replays>. Mac IP는 `ipconfig getifaddr en0`. iPhone은 같은 Wi-Fi의 Expo Go에서 QR을 스캔하고 Backend `http://Mac-IP:8000`을 설정한다. 행사 환경의 실제 Mac IP를 사용한다. 위치/동작/로컬 네트워크 권한을 허용하고 앱을 전면에 둔다.

## A — LIVE SENSOR (약 60초)

1. LIVE SENSOR 선택. “실제 iPhone 센서 연결 모드…개 행동 분류 정확도는 검증되지 않았습니다” 및 UNVALIDATED 설명.
2. iPhone Start Streaming, 기기를 기울여 두 IMU의 X/Y/Z 변화를 보여준다.
3. GPS 좌표/Accuracy 및 Last Received 확인. GPS가 아직 없으면 수신 상태를 설명하고 임의 값을 넣지 않는다.
4. Stop Streaming. 기본 3초 timeout 후 DISCONNECTED, IMU/GPS `—`. 이 화면은 개 행동 검증이나 안전 판정이 아니다.

## B — DATASET REPLAY (약 100초)

1. DATASET REPLAY, Dog 22/Test 2 기본 30초 clip에서 Play.
2. Recorded Data, Test split, UNKNOWN 단위, 실험 시작 기준 상대초와 현재 진행률을 설명한다.
3. 약 3.2초 후 Actual Walking / Predicted Walking, 112-feature RandomForest 실제 실행 및 Brooch 문구 확인.
4. Pause에서 시각·분석 횟수가 멈추고 Resume에서 계속됨을 보여준다. 완료까지 재생하여 10개 분석/COMPLETED/현재 센서값 제거 확인. 후반 Actual은 미주석·전환이므로 `—`이다.
5. Stop 후 Dog 45/Test 1 30초 전환 clip 선택, Play. 마지막 Actual Sitting / Predicted Sitting을 보여준다. 두 clip이 각각 독립된 기록임을 설명한다.
6. 선택적으로 Dog 44/Test 1 9초 자세 clip: Actual Lying chest / Predicted Sitting의 **실제 오분류**와 MISMATCH가 숨겨지지 않음을 보여준다. Brooch도 모델의 Sitting 예측을 말한다.

## C — FAILURE (약 40초)

행사 중 안전한 방법: Backend 주소를 `http://127.0.0.1:65530`으로 변경해 UNAVAILABLE과 값 제거를 보여준다. 정상 주소로 복원하면 IDLE이다. Play로 새 실행한다. 서버를 종료해도 같은 방식이며 자동으로 이전 재생을 재개하지 않는다.

파일 누락·잘못된 sensor schema의 실제 실패/복구는 별도 임시 파일/8002 서버를 사용하는 `tests/e2e/replay-failure.spec.ts`로 검증한다. 행사 원본 artifact를 삭제하거나 모델을 수정할 필요 없다.

## 마무리 (약 40초)

공개 canine 기록의 실제 추론과 iPhone 센서 E2E가 통합됐음을 설명한다. Test Accuracy 90.83%, Macro F1 0.8856은 기존 전체 Test 평가이며 demo clip 정확도가 아니다. iPhone 개 하네스 전이, CSV 물리 단위, 실제 브로치/음성/길찾기/알림/건강 모니터링은 미검증·미구현 상태다.

현재 구현은 모델 재학습·새 클래스·질병 판정·OpenAI/TTS를 포함하지 않는다. Goal 5는 replay/live 출처 계약과 Brooch adapter를 바탕으로 별도 범위를 정할 수 있다.
