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

음성 → 경로 → 움직임 데이터 순서로 진행한다. 처음에는 작은 브랜드와 입자 구름 속 마이크만 주요 행동으로 보인다. 출발·도착 입력과 직접 설정은 제공하지 않는다. 음성으로 목적지를 선택하면 설정된 시연 위치 또는 검증된 실제 현재 위치를 출발지로 자동 경로 조회한다. 일반 모드의 위치 확인 실패 시 출발할 장소도 음성으로 물어본다.

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

`voice-stage.css`는 초기·경로 검토 화면, `immersive-stage.css`는 이동 화면의 레이아웃 계약이다. 검토 화면은 흰색 배경과 최대1120px 세로 흐름이다. 초기 음성 제어는 중앙, 경로 조회 후에는 상단으로 모이고 지도→안내→접힌 근거→움직임 데이터를 배치한다. 검토 화면의 760px 이하에서는20px 여백과 세로 그래프를 사용한다. 이동 중에는 전체 화면 지도·가장자리 음성 띠와 하단 1/3의 가로 그래프 두 개로 전환한다.

## Interaction and motion

주요 S커브는 `cubic-bezier(.76, 0, .24, 1)`이다. 음성 영역 높이·여백1100ms, 지도 translateY110px→0/opacity1200ms, 움직임 데이터260ms 지연 후 같은 진입을 사용한다. 실시간 값 변경은 진입을 재시작하지 않는다.

마이크 주위 입자는 깊이가 있는 하나의 유기적인 입자 표면으로 읽혀야 한다. [Recursive Erosion](https://21st.dev/@mengto/components/recursive-erosion)의 미리보기에서 관찰한 문법(느린 회전, 연속적인 표면 변형, 부분 침식과 회복, 표면을 타고 흐르는 밝은 띠)을 독립적인 Canvas 구현으로 번역한다. 원본의 금색·어두운 배경이나 코드는 복제하지 않는다. 흰 배경·파란색, 중심 마이크의 가독성을 유지한다. 포인터는 국소 표면을 변형하고 전체를 약 8% 키운다. 마이크와 AI 원격 음성 스트림의 실제 RMS는 팽창·변형·흐름에 반영한다. 원형 버튼 배경·그림자는 없으며 키보드 포커스는 유지한다. DPR≤2, RAF/이벤트 정리, 비활성 탭 정지, reduced-motion 정적 표면을 적용한다.

경로 응답 전에는 지도·데이터를 마운트하지 않는다. 이후 단계 전환은 지도·데이터·음성 컴포넌트를 유지한다. 네이티브 details·버튼과 키보드 포커스를 유지한다. 오류·재시도는 접근 가능하고 전체 화면에서는 종료 버튼/Escape로 검토 화면에 돌아갈 수 있다. reduced-motion은 단계 애니메이션과 지도 이동도 제거한다.

## States and claims

Initial, loading, search empty/error, API unconfigured, same endpoints, recommended, excluded-only, unverified, no candidates, playing/paused/completed are explicit. Endpoint changes invalidate pending requests and clear old results/playback. Recommended status is facilities-data eligibility, never a claim of verified present-day safety or AI diagnosis. A missing signal or unknown crossing cannot become eligible through a UI action.

## Verification

See `docs/goal5-ui-validation.md`. Scope: standalone entry, legacy isolation, actual API navigation, mobile overflow, keyboard/dialog focus, axe accessibility, and simulation controls.

## Companion layer — current demo contract

휴대폰 실시간 센서가 기본 입력이다. 경로 준비 후 지도 아래에서 실제 수신 상태와 그래프를 확인한다. 휴대폰 센서는 실제 GPS 경로 진행이나 안내견의 건강·행동 판정으로 해석하지 않는다.

공개 Replay를 선택하고 추천 가능한 경로가 있으면 기존 모델의 행동 분류와 가상 지도 위치를 같은 재생 시간축으로 보여준다. 기록 출처·주석 불일치·가상 위치 설명을 유지한다. 경로 변경과 입력 전환은 기존 Replay 프레임과 재조회 맥락을 초기화하며 가상 기록을 시설 추천 점수에 반영하지 않는다.

투명 gs 도로 심벌을 `BrandLogo`로 재사용하고 GuideSense 워드마크는 HTML로 유지한다. 센서 표시를 위해 로고나 별도의 장식용 이미지를 생성하지 않는다.

## Voice entry

시연 모드는 서버의 `NAV_DEMO_MODE=1`로 명시적으로 켠다. 왕십리역을 가상 기본 출발지로 사용하고 위치 권한을 요청하지 않는다. `metadata.demoStart`가 위치의 단일 설정 출처이며, 메타데이터를 읽기 전에는 음성 시작을 비활성화하여 실제 위치로 잘못 진입하지 않는다. 기존 작은 안내 문구와 AI의 첫 인사에 시연 위치임을 밝힌다. 사용자는 음성으로 출발지를 바꿀 수 있고 지도·시설 판단·실제 센서 입력은 기존 계약을 유지한다. 기본 일반 모드에서는 실제 브라우저 위치를 검증해 사용한다.

큰 입자 구름 속 마이크가 시작 제어이다. 연결 시 종료 버튼과 현재 상태를 표시한다. 위치 권한·OpenAI 음성 전송 안내는 작은 텍스트로 남긴다. 장소 후보 확인·선택·정정은 화면 조작 없이 음성으로 완료한다. AI가 최신 후보의 번호·이름·구분되는 주소를 최대 3개씩 읽고 사용자의 음성 답을 기다린다. 구분 근거가 부족하면 추가 단서를 물어보며 임의 선택하지 않는다. 검색 후보·주소는 기본적으로 접힌 ‘장소 상세 보기’ 안에 읽기 전용 목록으로 보관한다. 대화 기록의 기존 네이티브 details 패턴과 색상 토큰을 재사용하며 후보 선택 버튼은 제공하지 않는다. 목적지 확정 후 자동 경로 조회하고 지도·센서는 기존대로 표시한다. 수동 출발·도착 입력은 없다. 명시적인 음성 대화 종료 요청은 마이크와 연결을 정리한다.

## Source of truth

Status: Active. Last refreshed: 2026-10-09. Current surface: `/` demo dashboard. Evidence: `NavigationPanel.tsx`, `LiveCompanion.tsx`, `VoicePlanner.tsx`, `MotionGraph.tsx`, existing `DESIGN.md`, user annotation showing replay/live confusion. The movement-stage contract below supersedes the previous scrolling-only layout during movement.

## Brand

차분한 기술 시연, 검증 가능한 데이터, 명확한 출처. 파란색은 선택·경로·음성, 녹색은 확인된 실시간 연결 상태에만 사용한다. 그림자·가짜 파형·예시 수치로 연결 상태를 꾸미지 않는다.

## Product goals

심사위원이 추가 설명 없이 음성 입력, 시설 기준 경로 비교, 실제 센서 수신을 구분한다. 성공 기준은 첫 화면의 음성 행동이 명확하고 목적지 확정 후 지도와 데이터가 부드럽게 등장하는 것이다. 실제 안내견 행동 검증이나 보행 안전 보장은 이 UI 변경의 목표가 아니다.

## Personas and jobs

발표자는 목적지를 말하고 지도 아래 시연 데이터를 전환한다. 심사위원은 경로와 아래 수신·모델 분류를 순서대로 관찰한다. 휴대폰 사용자는 기존 Expo 앱을 통해 센서를 송신한다.

## Design principles

전체 화면 지도는 하단 그래프 높이만큼 경로를 위로 맞춰 출발·도착과 이동 경로를 읽을 수 있게 한다. 기능의 이름보다 입력→처리→결과가 보이게 한다. 실시간·재생·미연결 상태는 글자로 구분한다. 설명의 상세 내용은 스크롤로 접근하되 중요한 제어와 숫자를 우선 배치한다.

## Components

기존 VoicePlanner, NavigationMap, MotionGraph, LiveCompanion, CompanionJourney, JourneyRecheck를 재사용한다. `navigation.css`의 기존 토큰을 유지하며 발표용 검토 배치는 `voice-stage.css`, 이동 중 전체 화면 배치는 `immersive-stage.css`, 센서의 상태·읽기 쉬운 수치는 `live-demo.css`에서 확장한다. 새로운 UI 라이브러리나 그래프 라이브러리는 추가하지 않는다.

### Canonical UI Map

| Capability     | Canonical owner                                                                | Source of truth                                                    | Allowed variants                                            | Verification                                                   |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Form           | `deviceWebSocketUrl` + 플랫폼 입력 요소                                        | `packages/protocol/src/index.ts`, `docs/design-diagnostics.md`     | 진단 웹 noValidate, 모바일 URL keyboard; 길찾기는 음성 입력 | URL 단위 테스트, `tests/e2e/dashboard.spec.ts`                 |
| Select/Listbox | `ReplayPanel.tsx`, `NavigationPanel.tsx`, `CompanionJourney.tsx` native select | Replay catalog, 본 문서의 Companion layer                          | OS-owned popup; 재생 중 기록 선택 잠금                      | `tests/e2e/live-companion.spec.ts`, `tests/e2e/replay.spec.ts` |
| Scrollbar      | `apps/dashboard/src/styles.css`                                                | `--scroll-thumb`, `--scroll-track` 및 `docs/design-diagnostics.md` | 강제 색상은 시스템 기본, navigation은 기존 thin geometry    | 브라우저 computed style, narrow E2E                            |
| Disclosure     | `VoicePlanner.tsx`와 `NavigationPanel.tsx`의 네이티브 details                  | 본 문서의 Voice entry                                              | 대화·장소 상세·경로 근거, 기본 접힘·사용자만 열기           | `tests/e2e/voice.spec.ts`, `tests/e2e/navigation.spec.ts`      |

## Accessibility

기존 키보드 접근·명시적 레이블·포커스 표시·reduced motion을 유지한다. 데이터 모드는 네이티브 select, 데이터 상태는 색상과 텍스트를 함께 사용한다. 빠르게 바뀌는 센서값을 매 프레임 스크린리더로 알리지 않는다. 대화 내용은 읽을 수 있는 HTML details로 제공한다.

## Responsive behavior

노트북·외부 모니터가 우선이다. 경로 검토 단계의 지도와 데이터는 문서 흐름으로 이어진다. 이동 단계는 화면 전체 지도와 하단 1/3 그래프를 사용한다. 좁은 화면에서도 두 센서 그래프를 나란히 표시하고 SVG 눈금은 실제 표시 크기에 맞춘다. 상세 데이터와 출처·기록 저장은 전체 화면을 나가면 기존 위치에서 접근한다.

## Interaction states

음성 대기/연결 중/대화 중, 휴대폰 서버 연결/기기 대기/실제 수신, Replay 경로 필요/재생/정지/오류 상태를 각각 표시한다. 연결되지 않은 그래프는 빈 축과 ‘—’를 보여준다. 경로 조회 실패 시 기존 잘못된 결과를 남기지 않는다.

현재 위치는 서버의 성동구 행정 경계 검증을 통과한 뒤에만 출발지로 설정한다. 범위 밖이면 목적지는 유지하고 성동구 안의 출발지를 음성으로 요청한다. 최초 경로 조회의 성공·추천 없음·오류·25초 시간 초과는 화면과 동일한 결과를 음성 대화에 전달한다. 말하는 중인 응답은 끝까지 기다린 뒤 최신 결과를 한 번 전달하며, 장소 변경으로 취소된 조회 결과는 말하지 않는다. 오류 후 같은 장소를 다시 확인하는 음성 선택은 재조회로 처리한다.

## Content voice

짧은 한국어 기능 설명. ‘실제 기록’은 수집된 공개 기록임을 명확히 하고, 실시간 휴대폰에는 LIVE·iPHONE과 실제 기기·시각을 표시한다. 휴대폰 그래프에 AI 행동 분류라는 이름을 붙이지 않는다.

## Implementation constraints

React/TypeScript·기존 Leaflet·WebRTC·WebSocket 연결을 유지한다. `/diagnostics`는 독립 유지한다. 단위 테스트·타입 검사·빌드·브라우저 주요 흐름·1440/1280/320px 레이아웃과 axe 검사를 수행한다.

## Open questions

없음. 사용자가 노트북·외부 모니터 중심의 시연 화면으로 지정했다. 실제 휴대폰 데이터 존재 여부는 실행 중 연결 상태에 따라 달라지며 화면이 이를 그대로 표시한다.

## Movement stage — 2026-10-09

사용자의 최신 지시: 이동을 시작하면 지도가 전체 화면을 채우고 음성 구름이 사방 가장자리로 퍼져 띠가 된다. 하단 1/3은 움직임 그래프가 차지한다.

- 추천 가능한 경로의 ‘이동 시작’ 또는 공개 기록의 ‘동행 재생’이 실제 재생 상태로 바뀔 때 진입한다. 일시정지·재생 완료에도 배치를 유지한다. 전체 화면 나가기/Escape는 기존 검토 화면으로 돌아가며 음성·센서·재생 세션을 끊지 않는다. 출발·도착 변경은 기존대로 경로와 이동 화면을 초기화한다.
- 동일한 Canvas의 입자들이 1.25초 smoothstep 곡선으로 원래 구름에서 둥근 화면 둘레로 퍼진다. 띠의 반응은 기존 실제 마이크·AI 출력 레벨을 사용한다. Canvas는 pointer-events:none이며 지도를 조작할 수 있다. reduced motion에서는 바로 정적인 띠를 그린다.
- 지도는 뷰포트 전체에 유지하고 하단 33.333dvh는 선택된 실시간/공개 Replay 그래프를 표시한다. 출처, 미연결·오류, 재생 제어, AI 분류와 주석 불일치는 유지한다. 수신되지 않은 센서값을 만들어 그리지 않는다.
- 작은 음성 종료 버튼과 전체 화면 나가기를 상단에 둔다. 후보·주소·대화·비교 상세는 기본 검토 화면의 접힌 details로 보관한다. 전환 중 컴포넌트를 재생성하지 않는다.
- 검증: `tests/e2e/immersive.spec.ts`에서 데스크톱·320px 지도/그래프 크기, 사방 입자, 음성 세션 유지, 일시정지, 복귀, reduced motion과 axe를 확인한다. `companion.spec.ts`는 복구된 공개 기록의 실제 모델 재분석 및 재생 제어를 확인한다.
