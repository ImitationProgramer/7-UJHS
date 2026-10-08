# Goal 4 Dashboard design

한국어로 진행하는 4분 시연을 위한 계측 Dashboard다. 기존 React/TypeScript/Vite, 청회색 바탕·흰 패널·Menlo 수치·Avenir Next 제목, 공통 theme를 유지했다. 재생 기록을 현재 개의 측정으로 표현하지 않는다.

## 구성과 소유권

| 영역   | LIVE SENSOR                                                           | DATASET REPLAY                                                               |
| ------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 상단   | 모드 버튼, Backend 주소                                               | 동일, aria-pressed 토글                                                      |
| 상태   | iPhone CONNECTED/DISCONNECTED, API AVAILABLE/UNAVAILABLE, 센서별 상태 | IDLE/PLAYING/PAUSED/STOPPED/COMPLETED/ERROR, transport UNAVAILABLE           |
| 출처   | iphone_live, human-held, UNVALIDATED                                  | canine_dataset_replay, Recorded Data, Dataset/Dog/Test/split/상대초          |
| 왼쪽   | IMU 6축, GPS/accuracy, Last Received, Sensor Quality                  | 같은 MotionPanel의 recorded variant, 원문 annotation, 실제 magnitude 그래프  |
| 오른쪽 | 기존 센서 화면 유지                                                   | Actual Label / AI Prediction, MATCH/MISMATCH, quality/model/window/분석 횟수 |
| 하단   | 검증되지 않은 iPhone 행동 안내를 생성하지 않음                        | 실제 추론 결과의 User Brooch Output 텍스트                                   |

`App.tsx`는 모드·주소, 기존 `useSensorStream`은 live, `useReplay`는 replay 통신을 소유한다. `MotionPanel`은 두 모드의 공통 센서 표시다. `MotionGraph`는 replay만 소유하며 단위는 UNKNOWN이다. 색상·반경 원천은 `packages/protocol/src/theme.ts` → CSS 변수로 그대로 유지한다. `DESIGN.md`의 기존 그래프 금지 및 placeholder는 이번 명시적 요구에 따라 확장했다.

## 동작 계약

- 모드 버튼은 Tab/Enter/Space와 aria-pressed를 사용한다. Replay→Live 전환 시 replay 컴포넌트를 unmount하고 socket/session을 폐기한다. 다시 Replay로 오면 IDLE이다. iPhone 수신은 계속된다.
- clip 선택은 native select이며 OS popup을 사용한다. 재생/일시정지 중에는 선택을 잠그고 Stop 후 선택한다. clip 변경은 Stop으로 이전 결과를 비운다.
- 서버가 command_id를 확인할 때까지 명령 버튼을 잠근다. 서버 오류·연결 끊김·잘못된 응답은 이전 센서/예측/그래프를 제거한다. 자동 재연결은 IDLE로 돌아오며 자동 재생하지 않는다.
- Pause에서는 화면과 분석이 멈춘다. Resume은 남은 상대 시각부터 진행한다. Stop은 현재값과 예측을 제거한다. Restart는 파일/모델을 다시 검증하고 처음부터 새 실행한다.
- COMPLETED는 현재 센서값을 제거하고 마지막 분석 및 그래프를 **과거 결과**로 남긴다. 다음 Play/Restart에서 즉시 비운다. 기록은 30초/9초이고 마지막 FIR 공개 대기 0.2초 후 완료된다.
- 미주석·전환 Window의 Actual은 `—`와 설명을 표시한다. 개별 sample annotation을 window 정답으로 바꾸지 않는다. 오분류도 그대로 보여준다. 모델 점수/신뢰 확률은 표시하지 않는다.
- User Brooch는 `broochText(prediction)`의 텍스트 projection이다. Actual이 아니라 실행된 Predicted를 사용하며 window 번호와 과거 결과 여부를 표시한다. 이후 음성/설명 adapter를 연결할 수 있지만 현재 TTS·OpenAI·Navigation·Reminder·Health 기능은 미구현이다.

## 성능·접근성

서버는 실제 sample timestamp에 따라 약 100ms마다 도달한 모든 50Hz sample을 순서대로 batch 전송한다. 수신 sample을 버리지 않고 React는 약 10Hz 갱신한다. 그래프는 최근 750개(15초)로 제한하고 memoized SVG에 실제 두 magnitude를 그린다. 각 그래프 축은 독립 자동 범위, 현재 수집 3초는 음영이다. 장식/합성 궤적/3D는 없다.

900px 이하에서 replay 좌우를 세로로 배치하고, 375px에서도 가로 overflow 없이 문서 스크롤한다. 기존 focus/hover/disabled/reduced-motion/forced-colors/전역 scrollbar 스타일을 재사용한다. 연결·분석 상태만 live region이며 50Hz 숫자를 낭독하지 않는다. 색상 외에 MATCH/MISMATCH·상태 텍스트를 함께 제공한다. 전체 WCAG 인증이나 스크린리더 실기기 검증을 주장하지 않는다.
