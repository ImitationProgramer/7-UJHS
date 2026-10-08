---
version: alpha
name: GuideSense
description: iPhone 실시간 수신과 공개 canine 기록·추론을 구분하는 현장 계측 화면
colors:
  background: '#eff4f8'
  surface: '#ffffff'
  ink: '#172d43'
  muted: '#52667b'
  primary: '#1c577b'
  success: '#196448'
  danger: '#a32d3c'
  border: '#bac9d5'
typography:
  display:
    fontFamily: 'Avenir Next, -apple-system, sans-serif'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, sans-serif'
  data:
    fontFamily: 'Menlo, monospace'
rounded:
  panel: '12px'
spacing:
  panel: '22px'
  gap: '18px'
components:
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
  mutedText:
    textColor: '{colors.muted}'
  connectedStatus:
    textColor: '{colors.success}'
  errorText:
    textColor: '{colors.danger}'
  button:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
---

# GuideSense design

## Overview

사용자가 지정한 실시간 센서 검증 도구. 관객은 Mac에서 수신을 점검하는 개발자와 iPhone을 사용하는 테스트 참가자이다. 한국어 UI를 기본으로 사용자가 요청한 센서/버튼/연결 상태 명칭은 영어로 유지한다. 일본 시장 기능은 범위에 없다.

현장 계측기의 읽기 쉬운 수치 패널을 참고한다. 옅은 청회색 바탕, 흰 표면, 바다색 텍스트. 연결 패널의 왼쪽 수직선 하나로 센서 흐름의 출발점을 강조한다. Goal 4 요청에 따라 replay에서만 실제 magnitude 그래프를 추가한다. 장식 이미지·3D 애니메이션·마케팅 영역은 추가하지 않는다. 비교 결과의 큰 Actual/Predicted 두 행이 이 화면의 시각적 중심이다. 검정 네온 제어실이나 의료 안전 판정 화면처럼 보이면 안 된다.

빈 저장소에서 시작했으므로 기존 sibling 화면은 없다. 모바일과 웹은 동일 상태 라벨/색상 원천을 사용한다. 차이는 기기 제어 화면과 수신·recorded replay 제어 화면이라는 역할에서 나온다.

## Colors

`packages/protocol/src/theme.ts`가 공통 런타임 원천이다. 이 문서는 해당 값의 의도를 기록한다. `colors.*` → Dashboard `main.tsx`의 `--*` CSS 변수 → `styles.css`; 동일 `colors.*` → Mobile `StyleSheet`. `radius` → 웹 `--radius`, 모바일 `borderRadius`. 모바일/웹에 색상값을 독립 복사하지 않는다.

success는 데이터 연결에만 사용하며 정상 보행을 뜻하지 않는다. 위험/입력 오류는 danger와 설명 텍스트로 표시한다. 현재 light theme 하나. 강제 색상 모드에서는 시스템 스크롤바를 유지한다.

## Typography

디바이스 상태는 Avenir Next, 본문은 OS 시스템 글꼴과 한국어 fallback, 센서 수치는 Menlo. 원격 글꼴을 내려받지 않는다. 숫자는 고정폭이며 빈 값과 수신값의 표시 공간이 동일하다. 50Hz 수치 자체에는 live region을 붙이지 않는다.

## Layout

웹 폭 1080px, 바깥 여백 32px. 공통 상단은 모드 버튼 → Backend 주소다. LIVE는 연결 상태 → 동작 센서 2열 → GPS → 미검증 안내 순서다. REPLAY는 출처·제어 → 좌측 센서·그래프 / 우측 Actual·Predicted 비교 → 브로치 텍스트 순서다. Replay 2열은 900px 이하에서 세로로 흐른다. 760px 이하에서는 1열, 여백 18px. 문서 스크롤을 유지한다. 모바일 safe area 및 세로 스크롤, 입력/버튼 높이 48px 이상. 에러 도움말과 연결 상태 영역은 일정 공간을 확보한다.

## Elevation & Depth

그림자 없이 표면과 테두리로 구분한다. 팝업이나 떠 있는 액션은 없다.

## Shapes

센서 패널 12px 반경. 연결 상태 점은 원형이며 상태 텍스트와 함께 표시한다. 버튼/입력은 웹 7px, 모바일 8px의 플랫폼별 제어 요소 변형이다.

## Components

| Capability     | Canonical owner                                   | Source of truth                  | Allowed variants                   | Verification             |
| -------------- | ------------------------------------------------- | -------------------------------- | ---------------------------------- | ------------------------ |
| Form           | `deviceWebSocketUrl` + 플랫폼 입력 요소           | `packages/protocol/src/index.ts` | 웹 noValidate, 모바일 URL keyboard | URL 단위/브라우저 테스트 |
| Select/Listbox | `ReplayPanel.tsx` native select                   | Goal 4 replay catalog            | OS-owned popup, 재생 중 선택 잠금  | 키보드/narrow E2E        |
| Scrollbar      | `apps/dashboard/src/styles.css`                   | 본 문서                          | 강제 색상은 시스템 기본            | computed style 테스트    |
| Status         | `statusLabels`, `useSensorStream`, `SensorStream` | 프로토콜 및 architecture         | 웹 수신/모바일 송신                | 단위, API, 브라우저 E2E  |

Replay clip 선택은 OS popup을 허용하는 native select (`ReplayPanel.tsx`)를 사용한다. date, toast, CRUD, table selection은 없다. 한 화면씩이며 별도 UX-CONTRACT는 만들지 않는다. 단순 목록이나 입력을 위해 컴포넌트 라이브러리를 추가하지 않는다.

기본 버튼은 primary/surface, hover는 ink, focus는 외곽선, pressed는 작은 피드백, disabled는 불투명도와 실제 disabled 속성을 함께 사용한다. 입력 오류는 필드 연결 설명과 포커스로 안내한다. 연결 중은 텍스트, 정상 수신은 CONNECTED, 누락 수치는 —. 연결이 끊기면 이전 값을 현재 값처럼 보이지 않게 숨긴다. 움직임 효과는 없으며 reduced motion 설정을 존중한다.

## Do's and Don'ts

- 결측값·권한 거부·센서 없음·연결 끊김을 텍스트로 구분한다.
- 실제 0과 미수신 `null`을 구분한다.
- 색상만으로 상태를 전달하지 않는다.
- CONNECTED로 안전·정상 보행을 추정하지 않는다.
- 숫자 변화를 스크린리더에 50Hz로 읽히지 않는다.

## Goal 4 behavior and reconciliation

- 근거: 사용자 Goal 4, `docs/goal3-replay-contract.md`, `docs/goal4-replay-integration.md`. Live hook와 replay hook는 별도 source·transport·state를 소유한다. 모드 버튼은 aria-pressed 토글이며 Tab/Enter로 조작한다. 모드 전환은 replay socket을 닫아 해당 세션을 폐기한다.
- 실제 센서 패널은 `MotionPanel.tsx`를 공유한다. live는 g/rad/s, replay variant는 UNKNOWN/기록값이라는 명시적 의미 차이다.
- Replay 오류는 고정 위치 status 텍스트, retry는 Play/Restart. 자동 socket 재연결 후 IDLE이며 자동 재생하지 않는다. PAUSED는 정지 시점, COMPLETED는 마지막 분석 기록, STOPPED/ERROR는 결과 제거다.
- `broochText`는 실제 실행 prediction만 텍스트로 투영한다. 건강·안전·TTS 기능이 아니다.
- 기존 runtime color/radius 원천은 변경하지 않았다. 기존 그래프 금지/placeholder는 Goal 4 명시 요청에 따라 실제 데이터 그래프/텍스트 출력으로 확장했다. 다른 visual token drift는 없다.
