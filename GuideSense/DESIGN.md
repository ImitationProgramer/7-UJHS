# GuideSense — Demo dashboard

## Purpose and source

심사위원이 음성에서 경로와 움직임으로 이어지는 흐름을 보는 시연 대시보드이다. 핵심 화면은 `/`, 기존 센서·Replay 진단은 독립된 `/diagnostics`에 유지한다. 진단 화면의 기존 디자인 계약은 `docs/design-diagnostics.md`에 보존한다.

2026-10-09 사용자 첨부 `Downloads/DESIGN.md`의 Apple 웹 분석을 기능형 지도 앱에 적용했다. `Downloads/design-wordforms/SKILL.md`와 두 reference 문서에서는 **대상의 작동 원리를 구조로 번역하고, 모티프를 장식으로 붙이지 않는다**는 방법을 가져왔다. 이번 산출물은 실행 가능한 웹 UI이며 이미지 생성·폰트 제작은 포함하지 않는다.

## Concept

**함께 걷는 길의 연속성을, 선택과 이동의 연속성으로.**

핵심 인상: 차분함, 동행, 방향, 확인 가능함.

세 가지 구조 후보를 비교했다: 노선도의 전체 가지를 펼치는 방식 / 발걸음의 반복을 카드 리듬으로 만드는 방식 / 여정의 진행에 맞춰 정보가 나타나는 방식. 지도와 사용자 선택이 중심이 되는 세 번째 방식을 채택했다. 출발·도착의 원/사각 점 → 경로 선 → 이동 점으로 동일한 방향 체계를 연결한다. 작은 브랜드 선형은 두 굴곡이 이어지는 동행을 표현하며 본문 가독성을 해치지 않는다.

피할 것: AI 이미지, 스파클, 장식용 그라디언트, 유리 카드, 반복되는 마케팅 섹션, 무관한 장식 애니메이션.

## Information architecture

음성 → 경로 → 움직임 데이터 순서로 진행한다. 처음에는 작은 브랜드와 입자 구름 속 마이크만 주요 행동으로 보인다. 출발·도착 입력과 직접 설정은 제공하지 않는다. 음성으로 목적지를 선택하면 현재 위치를 출발지로 자동 경로 조회한다. 위치 확인 실패 시 출발할 장소도 음성으로 물어본다.

경로 응답 후 지도가 아래에서 올라오고 그 아래에 움직임 데이터가 나타난다. 후보별 근거와 대화 기록은 details에 담는다. VoicePlanner는 단계 전환에도 유지하여 연결이 끊기지 않는다. 실시간 휴대폰 데이터와 공개 Replay 출처는 결과 단계에서 구분한다.

## Visual tokens

Navigation tokens are scoped to `.navigation` in `apps/dashboard/src/navigation/navigation.css`; protocol/mobile colors remain unchanged.

| Role                      | Token          | Value     |
| ------------------------- | -------------- | --------- |
| Content                   | `--ink`        | `#1d1d1f` |
| Supporting text           | `--muted`      | `#656568` |
| Action and selected route | `--primary`    | `#0066cc` |
| Surface                   | `--surface`    | `#fff`    |
| Recessed input            | `--background` | `#f5f5f7` |
| Selected wash             | `--blue-wash`  | `#edf5ff` |
| Divider                   | `--border`     | `#e5e5e8` |
| Exclusion/error           | `--danger`     | `#b42332` |
| Focus                     | `--focus`      | `#0071e3` |

System sans serif, Korean Apple SD Gothic Neo fallback. Weights 400/600. Main heading 34px desktop / 27px mobile, selected duration 28px, instruction 17px, body 14px, supporting 12px. Remote fonts are not required. Text remains selectable HTML.

Inputs 12px radius; route rows 14px; preview 18px; actions pill. No shadows on application chrome. Distinction comes from whitespace, one-pixel borders, selected blue, and map contrast. Public map colors are muted via tile-only saturation; route overlays retain contrast.

## Layout and responsive behavior

`voice-stage.css`가 최종 레이아웃 계약이다. 흰색 전체 화면, 최대1120px 세로 흐름이다. 초기 음성 제어는 중앙, 경로 조회 후에는 상단으로 모이고 지도→안내→접힌 근거→움직임 데이터를 배치한다. 760px 이하에서는20px 여백과 세로 그래프를 사용한다.

## Interaction and motion

주요 S커브는 `cubic-bezier(.76, 0, .24, 1)`이다. 음성 영역 높이·여백1100ms, 지도 translateY110px→0/opacity1200ms, 움직임 데이터260ms 지연 후 같은 진입을 사용한다. 실시간 값 변경은 진입을 재시작하지 않는다.

마이크 주위 입자는 깊이가 있는 하나의 유기적인 입자 표면으로 읽혀야 한다. [Recursive Erosion](https://21st.dev/@mengto/components/recursive-erosion)의 미리보기에서 관찰한 문법(느린 회전, 연속적인 표면 변형, 부분 침식과 회복, 표면을 타고 흐르는 밝은 띠)을 독립적인 Canvas 구현으로 번역한다. 원본의 금색·어두운 배경이나 코드는 복제하지 않는다. 흰 배경·파란색, 중심 마이크의 가독성을 유지한다. 포인터는 국소 표면을 변형하고 전체를 약 8% 키운다. 마이크와 AI 원격 음성 스트림의 실제 RMS는 팽창·변형·흐름에 반영한다. 원형 버튼 배경·그림자는 없으며 키보드 포커스는 유지한다. DPR≤2, RAF/이벤트 정리, 비활성 탭 정지, reduced-motion 정적 표면을 적용한다.

숨긴 지도·데이터는 DOM에서 제외한다. 네이티브 details·버튼·명시적 h1과 키보드 포커스를 유지한다. 오류·재시도는 항상 접근 가능하다. reduced-motion은 단계 애니메이션과 지도 이동도 제거한다.

## States and claims

Initial, loading, search empty/error, API unconfigured, same endpoints, recommended, excluded-only, unverified, no candidates, playing/paused/completed are explicit. Endpoint changes invalidate pending requests and clear old results/playback. Recommended status is facilities-data eligibility, never a claim of verified present-day safety or AI diagnosis. A missing signal or unknown crossing cannot become eligible through a UI action.

## Verification

See `docs/goal5-ui-validation.md`. Scope: standalone entry, legacy isolation, actual API navigation, mobile overflow, keyboard/dialog focus, axe accessibility, and simulation controls.

## Companion layer — current demo contract

휴대폰 실시간 센서가 기본 입력이다. 경로 준비 후 지도 아래에서 실제 수신 상태와 그래프를 확인한다. 휴대폰 센서는 실제 GPS 경로 진행이나 안내견의 건강·행동 판정으로 해석하지 않는다.

공개 Replay를 선택하고 추천 가능한 경로가 있으면 기존 모델의 행동 분류와 가상 지도 위치를 같은 재생 시간축으로 보여준다. 기록 출처·주석 불일치·가상 위치 설명을 유지한다. 경로 변경과 입력 전환은 기존 Replay 프레임과 재조회 맥락을 초기화하며 가상 기록을 시설 추천 점수에 반영하지 않는다.

투명 gs 도로 심벌을 `BrandLogo`로 재사용하고 GuideSense 워드마크는 HTML로 유지한다. 센서 표시를 위해 로고나 별도의 장식용 이미지를 생성하지 않는다.

## Voice entry

큰 입자 구름 속 마이크가 시작 제어이다. 연결 시 종료 버튼과 현재 상태를 표시한다. 위치 권한·OpenAI 음성 전송 안내는 작은 텍스트로 남긴다. 검색 후보는 필요한 때만 표시한다. 목적지 확정 후 자동 경로 조회한다. 수동 출발·도착 입력은 없다.

## Source of truth

Status: Active. Last refreshed: 2026-10-09. Current surface: `/` demo dashboard. Evidence: `NavigationPanel.tsx`, `LiveCompanion.tsx`, `VoicePlanner.tsx`, `MotionGraph.tsx`, existing `DESIGN.md`, user annotation showing replay/live confusion. The current demo contract supersedes previous map-overlay layouts.

## Brand

차분한 기술 시연, 검증 가능한 데이터, 명확한 출처. 파란색은 선택·경로·음성, 녹색은 확인된 실시간 연결 상태에만 사용한다. 그림자·가짜 파형·예시 수치로 연결 상태를 꾸미지 않는다.

## Product goals

심사위원이 추가 설명 없이 음성 입력, 시설 기준 경로 비교, 실제 센서 수신을 구분한다. 성공 기준은 첫 화면의 음성 행동이 명확하고 목적지 확정 후 지도와 데이터가 부드럽게 등장하는 것이다. 실제 안내견 행동 검증이나 보행 안전 보장은 이 UI 변경의 목표가 아니다.

## Personas and jobs

발표자는 목적지를 말하고 지도 아래 시연 데이터를 전환한다. 심사위원은 경로와 아래 수신·모델 분류를 순서대로 관찰한다. 휴대폰 사용자는 기존 Expo 앱을 통해 센서를 송신한다.

## Design principles

지도와 센서가 서로 가리지 않는다. 기능의 이름보다 입력→처리→결과가 보이게 한다. 실시간·재생·미연결 상태는 글자로 구분한다. 설명의 상세 내용은 스크롤로 접근하되 중요한 제어와 숫자를 우선 배치한다.

## Components

기존 VoicePlanner, NavigationMap, MotionGraph, LiveCompanion, CompanionJourney, JourneyRecheck를 재사용한다. `navigation.css`의 기존 토큰을 유지하며 발표용 최종 배치는 `voice-stage.css`, 센서의 상태·읽기 쉬운 수치는 `live-demo.css`에서 확장한다. 새로운 UI 라이브러리나 그래프 라이브러리는 추가하지 않는다.

## Accessibility

기존 키보드 접근·명시적 레이블·포커스 표시·reduced motion을 유지한다. 데이터 모드는 네이티브 select, 데이터 상태는 색상과 텍스트를 함께 사용한다. 빠르게 바뀌는 센서값을 매 프레임 스크린리더로 알리지 않는다. 대화 내용은 읽을 수 있는 HTML details로 제공한다.

## Responsive behavior

노트북·외부 모니터가 우선이다. 지도와 데이터는 독립 스크롤 열 대신 문서 흐름으로 이어진다. 좁은 화면의 상세 내용은 문서 흐름으로 옮기며 원본 데이터와 제어를 숨기지 않는다.

## Interaction states

음성 대기/연결 중/대화 중, 휴대폰 서버 연결/기기 대기/실제 수신, Replay 경로 필요/재생/정지/오류 상태를 각각 표시한다. 연결되지 않은 그래프는 빈 축과 ‘—’를 보여준다. 경로 조회 실패 시 기존 잘못된 결과를 남기지 않는다.

## Content voice

짧은 한국어 기능 설명. ‘실제 기록’은 수집된 공개 기록임을 명확히 하고, 실시간 휴대폰에는 LIVE·iPHONE과 실제 기기·시각을 표시한다. 휴대폰 그래프에 AI 행동 분류라는 이름을 붙이지 않는다.

## Implementation constraints

React/TypeScript·기존 Leaflet·WebRTC·WebSocket 연결을 유지한다. `/diagnostics`는 독립 유지한다. 단위 테스트·타입 검사·빌드·브라우저 주요 흐름·1440/1280/320px 레이아웃과 axe 검사를 수행한다.

## Open questions

없음. 사용자가 노트북·외부 모니터 중심의 시연 화면으로 지정했다. 실제 휴대폰 데이터 존재 여부는 실행 중 연결 상태에 따라 달라지며 화면이 이를 그대로 표시한다.
