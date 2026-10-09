# 유체 파티클 및 음성 반응 — 2026-10-09

- 구름 전체 호버 영역에서 약 8% 확대, 포인터 주변의 밀어내기와 회전, 감쇠 관성으로 복귀.
- 공유 유체 흐름으로 이웃 입자가 함께 움직임. 회색 호버 배경·그림자 제거, 키보드 focus-visible 유지.
- Web Audio AnalyserNode로 로컬 마이크와 AI 원격 MediaStream을 각각 RMS 측정. 작은 잡음은 억제하고 빠른 증가/느린 감소로 시각 반응을 부드럽게 연결.
- 파티클은 두 음량 중 큰 값으로 팽창·흐름·크기를 변경. 연결 상태만으로 가짜 음량을 만들지 않음.
- 입력 분석 노드는 스피커와 연결하지 않아 로컬 마이크 재생을 추가하지 않음. 기존 AI 오디오 재생 경로 유지.
- 종료·오류·재접속 시 노드 disconnect, AudioContext close, RAF 취소 및 음량 초기화.
- reduced-motion에서는 파티클 정지와 hover 확대 생략.

검증: 최신 빌드·타입 검사 통과, 단위 테스트 49개 통과. 브라우저 오디오 검증은 외부 전송 없는 합성 스트림 사용.

Web Audio 동작 참고: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData
브라우저 13개 통과: hover 투명 배경·확대·복귀, 1440/1280/320 화면, reduced-motion, 음성 경로 흐름. 실제 Chromium Web Audio에 합성 음원 두 스트림을 연결해 각각 측정·감쇠·종료를 검증했다. 실제 사용자 마이크/OpenAI 발화는 이번 자동 검증에 포함하지 않았다.
스크린샷: artifacts/navigation-live/voice-fluid-hover.png
