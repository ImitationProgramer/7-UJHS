import { useEffect, useMemo, useRef, useState } from 'react';
import { NavigationMap } from './NavigationMap';
import {
  MetadataSchema,
  RoutesSchema,
  cumulativeDistances,
  decisionLabels,
  errorText,
  eventDistance,
  fieldLabels,
  flagLabels,
  interpolate,
  navigationUrl,
  readResponse,
  type Candidate,
  type Metadata,
  type Point,
  type Routes,
} from './contract';
import { RouteIcon } from './RouteIcon';
import { BrandLogo } from './BrandLogo';
import { VoicePlanner } from './VoicePlanner';
import { JourneyRecheck, type JourneyContext } from './JourneyRecheck';
import { LiveCompanion } from './LiveCompanion';
import {
  CompanionJourney,
  CompanionLog,
  type CompanionFrame,
} from './CompanionJourney';
import './navigation.css';
import './demo-dashboard.css';
import './voice-stage.css';
import './immersive-stage.css';

const EMPTY_CANDIDATES: Candidate[] = [];
const formatDistance = (meters: number) =>
  meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`;
const formatDuration = (seconds: number) =>
  `${Math.max(1, Math.round(seconds / 60))}분`;
type Endpoint = 'start' | 'end';

export function NavigationPanel({ address }: { address: string }) {
  const voiceRouteIntent = useRef(false);
  const infoDialog = useRef<HTMLDialogElement>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [metadataError, setMetadataError] = useState('');
  const [retry, setRetry] = useState(0);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [journeyContext, setJourneyContext] = useState<JourneyContext | null>(
    null,
  );
  const [routeContext, setRouteContext] = useState<JourneyContext | null>(null);
  const [routes, setRoutes] = useState<Routes | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const immersiveDismissed = useRef(false);
  function leaveImmersive() {
    immersiveDismissed.current = true;
    setImmersive(false);
  }
  const [previewMeters, setMeters] = useState(0);
  const [companionEnabled, setCompanionEnabled] = useState(true);
  const [companionSource, setCompanionSource] = useState<'live' | 'replay'>(
    'live',
  );
  const [companionFrame, setCompanionFrame] = useState<CompanionFrame | null>(
    null,
  );
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  function clearRoutes() {
    immersiveDismissed.current = false;
    setImmersive(false);
    setRouteContext(null);
    setJourneyContext(null);
    setCompanionFrame(null);
    generation.current++;
    request.current?.abort();
    setPending(false);
    setRoutes(null);
    setSelectedId(null);
    setError('');
    setPlaying(false);
    setMeters(0);
  }
  function choose(which: Endpoint, point: Point | null) {
    voiceRouteIntent.current = false;
    clearRoutes();
    const normalized = point
      ? { lat: point.lat, lon: point.lon, name: point.name }
      : null;
    if (which === 'start') {
      setStart(normalized);
    } else setEnd(normalized);
  }
  useEffect(() => {
    clearRoutes();
    setStart(null);
    setEnd(null);
    setMetadata(null);
    setMetadataError('');
    const abort = new AbortController();
    (async () => {
      try {
        const data = MetadataSchema.parse(
          await readResponse(
            await fetch(navigationUrl(address, 'metadata'), {
              signal: abort.signal,
            }),
          ),
        );
        if (!abort.signal.aborted) setMetadata(data);
      } catch (cause) {
        if (!abort.signal.aborted) setMetadataError(errorText(cause));
      }
    })();
    return () => {
      abort.abort();
      generation.current++;
      request.current?.abort();
    };
  }, [address, retry]);
  const selected =
    routes?.candidates.find((candidate) => candidate.id === selectedId) ?? null;
  const distances = useMemo(
    () => (selected ? cumulativeDistances(selected.geometry) : []),
    [selected],
  );
  const total = distances.at(-1) ?? 0;
  const replayActive = companionEnabled && companionSource === 'replay';
  const meters = replayActive
    ? (companionFrame?.progress ?? 0) * total
    : previewMeters;
  const eligible = selected?.decision === 'eligible';
  const movementRunning =
    eligible && (replayActive ? companionFrame?.state === 'PLAYING' : playing);
  useEffect(() => {
    if (movementRunning && !immersiveDismissed.current) setImmersive(true);
  }, [movementRunning]);
  useEffect(() => {
    if (!immersive) return;
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') leaveImmersive();
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [immersive]);
  const position =
    selected && eligible
      ? interpolate(selected.geometry, distances, meters)
      : null;
  useEffect(() => {
    if (replayActive || !playing || !eligible || total <= 0) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const step = Math.min((now - previous) / 1000, 1) * 20;
      previous = now;
      setMeters((current) => Math.min(total, current + step));
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, eligible, total, replayActive]);
  useEffect(() => {
    if (total > 0 && meters >= total) setPlaying(false);
  }, [meters, total]);
  const events = useMemo(() => {
    if (!selected) return [];
    return [
      ...selected.instructions.map((instruction) => ({
        id: instruction.id,
        at: eventDistance(selected.geometry, distances, instruction.coordinate),
        text: instruction.text,
      })),
      ...selected.crossings.map((crossing) => ({
        id: crossing.id,
        at: eventDistance(selected.geometry, distances, crossing.coordinate),
        text: crossing.facility
          ? `횡단보도 · 보행자신호등 ${flagLabels[crossing.facility.signal]}, 음향신호기 ${flagLabels[crossing.facility.audibleSignal]}, 보도턱 낮춤 ${flagLabels[crossing.facility.curbRamp]}, 점자블록 ${flagLabels[crossing.facility.tactilePaving]}.`
          : crossing.reason,
      })),
    ].sort((a, b) => a.at - b.at);
  }, [selected, distances]);
  const lastEvent = events.filter((event) => event.at <= meters + 2).at(-1);
  const nextEvent = events.find((event) => event.at > meters + 2);
  const output =
    !selected || !eligible
      ? '추천 가능한 경로를 선택하면 구간 안내를 확인할 수 있어요.'
      : meters >= total && total > 0
        ? '이동 시뮬레이션이 끝났어요. 목적지에 도달한 것으로 표시합니다.'
        : lastEvent?.text ||
          `선택한 경로는 ${formatDistance(selected.distanceM)}, 약 ${formatDuration(selected.durationS)}입니다. 이동 시뮬레이션을 시작해 보세요.`;
  async function findRoutes() {
    if (!start || !end || !metadata?.keyConfigured) return;
    clearRoutes();
    const run = generation.current;
    const abort = new AbortController();
    request.current = abort;
    setPending(true);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 25_000);
    try {
      const result = RoutesSchema.parse(
        await readResponse(
          await fetch(navigationUrl(address, 'routes'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start, end }),
            signal: abort.signal,
          }),
        ),
      );
      if (run !== generation.current || abort.signal.aborted) return;
      setRoutes(result);
      setSelectedId(result.recommendedId ?? result.candidates[0]?.id ?? null);
      const recommended = result.candidates.find(
        (candidate) => candidate.id === result.recommendedId,
      );
      const detail = recommended
        ? `시설 데이터 기준 추천 경로는 ${formatDistance(recommended.distanceM)}, 약 ${formatDuration(recommended.durationS)}입니다. ${recommended.reason}`
        : result.status === 'no_candidates'
          ? '조회된 경로가 없습니다. 잠시 후 다시 요청하거나 다른 출발지 또는 목적지를 말해 주세요.'
          : '후보는 조회했지만 시설 조건을 확인한 추천 경로가 없습니다. 다른 출발지 또는 목적지를 말해 주세요.';
      setRouteContext({
        id: `route-${run}-result`,
        text: `${start.name}에서 ${end.name}까지 경로 조회가 끝났습니다. ${detail} 실제 이동이나 도착을 감지한 결과는 아닙니다.`,
      });
    } catch (cause) {
      if (run === generation.current && (!abort.signal.aborted || timedOut)) {
        const message = timedOut
          ? '경로 조회 시간이 초과됐어요. 잠시 후 목적지를 다시 말해 주세요.'
          : errorText(cause);
        setError(message);
        setRouteContext({
          id: `route-${run}-error`,
          text: `경로 조회 실패: ${message} 출발지는 ${start.name}, 도착지는 ${end.name}입니다. 목적지를 임의로 변경하지 마세요.`,
        });
      }
    } finally {
      clearTimeout(timeout);
      if (run === generation.current) setPending(false);
    }
  }
  function chooseFromVoice(which: Endpoint, point: Point) {
    const previous = which === 'start' ? start : end;
    if (
      previous &&
      previous.lat === point.lat &&
      previous.lon === point.lon &&
      previous.name === point.name
    ) {
      // Reconfirming the same place is also a voice-only retry after failure.
      if (error && !pending && start && end) void findRoutes();
      return;
    }
    choose(which, point);
    voiceRouteIntent.current = true;
  }
  useEffect(() => {
    if (!voiceRouteIntent.current || !start || !end || !metadata?.keyConfigured)
      return;
    voiceRouteIntent.current = false;
    if (
      Math.abs(start.lat - end.lat) < 0.000001 &&
      Math.abs(start.lon - end.lon) < 0.000001
    ) {
      setError('출발지와 도착지를 서로 다른 위치로 지정해 주세요.');
      setRouteContext({
        id: `route-${generation.current}-same`,
        text: '출발지와 도착지가 같아서 경로를 조회하지 않았습니다. 다른 출발지나 목적지를 말해 주세요.',
      });
      return;
    }
    void findRoutes();
  }, [start, end, metadata]);
  const samePoint =
    start &&
    end &&
    Math.abs(start.lat - end.lat) < 0.000001 &&
    Math.abs(start.lon - end.lon) < 0.000001;
  const selectCandidate = (candidate: Candidate) => {
    if (candidate.id === selectedId) return;
    setCompanionFrame(null);
    setPlaying(false);
    setMeters(0);
    setSelectedId(candidate.id);
  };
  return (
    <main
      className={`navigation demo-dashboard voice-stage ${routes ? 'has-journey' : 'is-awaiting'} ${immersive ? 'is-immersive' : ''}`}
      data-testid="navigation-panel"
      aria-label="성동구 시설 기반 길찾기"
    >
      <a className="navigation-skip" href="#route-planner">
        경로 검색으로 이동
      </a>
      {immersive && (
        <button className="navigation-exit-immersive" onClick={leaveImmersive}>
          <RouteIcon name="close" /> 전체 화면 나가기
        </button>
      )}
      <header className="navigation-header">
        <a
          className="navigation-brand"
          href="/"
          aria-label="GuideSense 길찾기 홈"
        >
          <BrandLogo />
          <span>
            GuideSense<span className="brand-period">.</span>
          </span>
        </a>
        <span className="navigation-header-label">
          낯선 길의 정보와 동행의 움직임, 한눈에.
        </span>
        <span className="demo-badge">LIVE DEMO</span>
        <button
          className="navigation-info-button"
          onClick={() => infoDialog.current?.showModal()}
        >
          <RouteIcon name="info" /> <span>안내 기준</span>
        </button>
      </header>
      <div className={`navigation-workspace ${routes ? 'has-routes' : ''}`}>
        <aside
          className="navigation-sidebar"
          aria-label="출발지와 도착지 선택"
          id="route-planner"
        >
          <div className="navigation-planner">
            <VoicePlanner
              immersive={immersive}
              address={address}
              locationReady={metadata !== null}
              demoStart={metadata?.demoStart ?? null}
              start={start}
              end={end}
              onSelect={chooseFromVoice}
              journeyContext={journeyContext ?? routeContext ?? undefined}
            />
            <div className="navigation-service-state" role="status">
              {!metadata && !metadataError && (
                <p>성동구 시설 정보를 불러오고 있어요.</p>
              )}
              {metadataError && (
                <>
                  <p className="field-error">{metadataError}</p>
                  <button
                    className="navigation-secondary"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    다시 연결
                  </button>
                </>
              )}
              {metadata && !metadata.keyConfigured && (
                <>
                  <strong>TMAP 연결이 필요해요</strong>
                  <p>장소 검색과 길찾기는 서비스 연결 후 사용할 수 있어요.</p>
                  <button
                    className="navigation-secondary"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    연결 다시 확인
                  </button>
                </>
              )}
              {error && (
                <>
                  <p className="field-error">{error}</p>
                  <button
                    className="navigation-secondary"
                    disabled={!start || !end || !!samePoint || pending}
                    onClick={findRoutes}
                  >
                    경로 다시 찾기
                  </button>
                </>
              )}
            </div>
          </div>
          {pending && (
            <div className="navigation-loading" role="status">
              <div />
              <p>
                보행 경로를 찾고,
                <br />
                횡단 시설과 연결하고 있어요.
              </p>
            </div>
          )}
        </aside>
        {routes && (
          <section className="demo-route-column" aria-label="경로 지도와 비교">
            <div className="voice-route-heading">
              <span className="demo-section-label">성동구 · 경로 미리보기</span>
              {selected && (
                <p>
                  <strong>{formatDuration(selected.durationS)}</strong>
                  <span>{formatDistance(selected.distanceM)}</span>
                </p>
              )}
            </div>
            <div className="navigation-map-stage">
              <NavigationMap
                metadata={metadata}
                start={start}
                end={end}
                candidates={routes?.candidates ?? EMPTY_CANDIDATES}
                selectedId={selectedId}
                position={position}
                companionEvents={companionFrame?.observations}
                previewPadding={40}
                bottomFraction={immersive ? 1 / 3 : 0}
              />
              <div className="navigation-map-location">
                <span>지금 살펴보는 지역</span>
                <strong>
                  성동구 <small>Seongdong-gu</small>
                </strong>
              </div>
            </div>
            {selected && (
              <section
                className={`navigation-simulation ${playing ? 'is-playing' : ''}`}
                aria-label="이동 시뮬레이션"
              >
                <div className="navigation-simulation-top">
                  <p className="navigation-kicker">
                    <span />{' '}
                    {companionEnabled
                      ? 'WALK TOGETHER'
                      : playing
                        ? '이동 미리보는 중'
                        : 'ROUTE PREVIEW'}
                  </p>
                  <span>시뮬레이션 · 실제 위치 아님</span>
                </div>
                <p
                  className="navigation-guidance"
                  data-testid="navigation-brooch-output"
                  aria-live="polite"
                >
                  {output}
                </p>
                {eligible && nextEvent && (
                  <p className="navigation-next">
                    다음 안내까지 약{' '}
                    {formatDistance(Math.max(0, nextEvent.at - meters))}
                  </p>
                )}
                {replayActive && eligible ? (
                  <p className="demo-replay-link">
                    아래 공개 기록의 재생 시간에 맞춰 지도 위치가 이동합니다.
                  </p>
                ) : (
                  <div className="navigation-playback">
                    <div className="navigation-buttons">
                      {playing ? (
                        <button
                          className="navigation-play"
                          onClick={() => setPlaying(false)}
                        >
                          <RouteIcon name="pause" />
                          일시정지
                        </button>
                      ) : (
                        <button
                          className="navigation-play"
                          disabled={!eligible || total <= 0 || meters >= total}
                          onClick={() => {
                            immersiveDismissed.current = false;
                            setPlaying(true);
                          }}
                        >
                          <RouteIcon name="play" />
                          {meters > 0 ? '계속' : '이동 시작'}
                        </button>
                      )}
                      <button
                        className="navigation-restart"
                        aria-label="다시 시작"
                        title="다시 시작"
                        disabled={!eligible}
                        onClick={() => {
                          setPlaying(false);
                          setMeters(0);
                        }}
                      >
                        <RouteIcon name="restart" />
                      </button>
                    </div>
                    <div className="navigation-progress-group">
                      <label htmlFor="navigation-progress">
                        이동 경로{' '}
                        <span>
                          {total > 0 ? Math.round((meters / total) * 100) : 0}%
                        </span>
                      </label>
                      <progress
                        id="navigation-progress"
                        value={meters}
                        max={total || 1}
                      />
                    </div>
                  </div>
                )}
              </section>
            )}
            {routes ? (
              <details className="voice-route-evidence">
                <summary>
                  경로 비교 · 추천 근거{' '}
                  {routes.status !== 'recommended' && '— 추천 가능한 경로 없음'}
                </summary>
                <section
                  className="navigation-results"
                  aria-label="경로 비교 결과"
                >
                  <div className="navigation-result-heading">
                    <p className="navigation-kicker">
                      YOUR ROUTES <span>{routes.candidates.length}개 후보</span>
                    </p>
                    <h2>
                      {routes.status === 'recommended'
                        ? '시설 데이터 기준 추천'
                        : routes.status === 'no_candidates'
                          ? '조회된 경로가 없어요'
                          : '조건을 확인한 추천 경로가 없어요'}
                    </h2>
                  </div>
                  {routes.status === 'no_eligible_route' && (
                    <p className="navigation-result-note">
                      확인되지 않은 길을 추천하지 않아요. 후보별 이유를
                      확인하거나 위치를 바꿔보세요.
                    </p>
                  )}
                  {routes.status === 'no_candidates' && (
                    <p>위치를 조정해 다시 조회해 주세요.</p>
                  )}
                  {routes.optionErrors.length > 0 && (
                    <p className="field-error">
                      일부 경로를 불러오지 못해, 조회된 후보끼리 비교했어요.
                    </p>
                  )}
                  <div className="navigation-candidates">
                    {[...routes.candidates]
                      .sort(
                        (a, b) =>
                          Number(b.id === routes.recommendedId) -
                          Number(a.id === routes.recommendedId),
                      )
                      .map((candidate) => (
                        <article
                          key={candidate.id}
                          className={`navigation-candidate ${candidate.id === selectedId ? 'selected' : ''}`}
                        >
                          <button
                            className="navigation-candidate-select"
                            aria-pressed={candidate.id === selectedId}
                            onClick={() => selectCandidate(candidate)}
                          >
                            <span className="navigation-route-label">
                              경로{' '}
                              {routes.candidates.findIndex(
                                (item) => item.id === candidate.id,
                              ) + 1}
                              <span
                                className={`navigation-decision ${candidate.decision}`}
                              >
                                {routes.recommendedId === candidate.id
                                  ? '추천'
                                  : decisionLabels[candidate.decision]}
                              </span>
                              <RouteIcon name="arrow" />
                            </span>
                            <span className="navigation-route-numbers">
                              <strong>
                                {formatDuration(candidate.durationS)}
                              </strong>
                              <span>{formatDistance(candidate.distanceM)}</span>
                            </span>
                          </button>
                          <p className="navigation-candidate-reason">
                            {candidate.reason}
                          </p>
                          <p className="navigation-candidate-counts">
                            횡단 {candidate.summary.crossingCount}곳
                            <span>·</span>
                            시설 연결 {candidate.summary.matchedCount}곳
                            <span>·</span>
                            미확인 {candidate.summary.unknownCount}곳
                          </p>
                          {candidate.extraDistanceM != null &&
                            candidate.extraDistanceM > 0 && (
                              <p className="hint">
                                최단 평가 가능 후보보다 +
                                {formatDistance(candidate.extraDistanceM)} · +
                                {Math.round(
                                  (candidate.extraDurationS ?? 0) / 60,
                                )}
                                분
                              </p>
                            )}
                          <details>
                            <summary>시설·평가 근거 보기</summary>
                            {candidate.score !== null && (
                              <p>
                                비교 비용{' '}
                                {Math.round(candidate.score).toLocaleString()} =
                                거리{' '}
                                {Math.round(
                                  candidate.distanceM,
                                ).toLocaleString()}{' '}
                                + 시설 가중치{' '}
                                {Math.round(
                                  candidate.penalties.reduce(
                                    (sum, penalty) => sum + penalty.cost,
                                    0,
                                  ),
                                ).toLocaleString()}
                              </p>
                            )}
                            {candidate.penalties.length > 0 && (
                              <ul>
                                {candidate.penalties.map((penalty, n) => (
                                  <li key={`${penalty.crossingId}-${n}`}>
                                    {fieldLabels[penalty.field] ??
                                      penalty.field}{' '}
                                    {flagLabels[penalty.value]}: +{penalty.cost}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {candidate.crossings.map((crossing, n) => (
                              <div
                                className="navigation-crossing"
                                key={crossing.id}
                              >
                                <strong>횡단 {n + 1}</strong>
                                <p>{crossing.reason}</p>
                                {crossing.facility && (
                                  <dl>
                                    {(
                                      [
                                        'signal',
                                        'audibleSignal',
                                        'curbRamp',
                                        'tactilePaving',
                                      ] as const
                                    ).map((field) => (
                                      <div key={field}>
                                        <dt>{fieldLabels[field]}</dt>
                                        <dd>
                                          {
                                            flagLabels[
                                              crossing.facility![field]
                                            ]
                                          }
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                              </div>
                            ))}
                            <p className="hint">
                              시설 가중치는 데모용 비교 기준이며 실제 위험
                              수치가 아닙니다.
                            </p>
                          </details>
                        </article>
                      ))}
                  </div>
                </section>
              </details>
            ) : (
              !pending && (
                <section
                  className="navigation-explainer"
                  aria-label="경로 추천 방식"
                >
                  <div className="navigation-explainer-heading">
                    <RouteIcon name="crossing" />
                    <h2>짧은 거리, 그 이상의 기준.</h2>
                  </div>
                  <p>
                    신호등 없는 횡단보도는 추천에서 빼고,
                    <br />
                    음향신호기·보도턱 낮춤·점자블록을 살펴요.
                  </p>
                  <ol className="navigation-steps">
                    <li className={!start || !end ? 'current' : 'complete'}>
                      <span>01</span>출발지와 도착지 정하기
                    </li>
                    <li className={start && end ? 'current' : ''}>
                      <span>02</span>시설 정보로 경로 비교하기
                    </li>
                    <li>
                      <span>03</span>지도를 따라 이동 미리보기
                    </li>
                  </ol>
                </section>
              )
            )}
          </section>
        )}
        {routes && (
          <aside className="demo-telemetry" aria-label="동행 데이터 대시보드">
            <div className="demo-section-heading">
              <div>
                <p className="demo-section-label">WALK TOGETHER</p>
                <h2>움직임을 확인하세요.</h2>
              </div>
            </div>
            <div className="companion-input-source">
              <label htmlFor="companion-source">연결할 데이터</label>
              <select
                id="companion-source"
                value={companionSource}
                onChange={(event) => {
                  setCompanionSource(event.target.value as 'live' | 'replay');
                  setCompanionEnabled(true);
                  setCompanionFrame(null);
                  setJourneyContext(null);
                  setPlaying(false);
                  setMeters(0);
                }}
              >
                <option value="live">휴대폰 실시간 센서</option>
                <option value="replay">공개 개 기록 Replay</option>
              </select>
            </div>
            {companionSource === 'live' ? (
              <LiveCompanion address={address} immersive={immersive} />
            ) : eligible && selected ? (
              <>
                <button
                  className="companion-toggle"
                  aria-pressed={companionEnabled}
                  onClick={() => {
                    setPlaying(false);
                    setMeters(0);
                    setCompanionFrame(null);
                    setJourneyContext(null);
                    setCompanionEnabled((value) => !value);
                  }}
                >
                  {companionEnabled
                    ? '행동 연결 켜짐 · 경로만 보기로 전환'
                    : '개 행동 데이터 연결'}
                </button>
                {companionEnabled && (
                  <CompanionJourney
                    immersive={immersive}
                    onStart={() => {
                      immersiveDismissed.current = false;
                    }}
                    key={`${routes?.requestId}:${selected.id}`}
                    address={address}
                    candidate={selected}
                    onFrame={setCompanionFrame}
                  />
                )}
              </>
            ) : (
              <div className="demo-replay-empty">
                <span>PUBLIC REPLAY</span>
                <h3>개 행동 기록을 길 위에 연결</h3>
                <p>
                  추천 가능한 경로를 선택하면 공개 기록의 센서 그래프와 AI 행동
                  분류를 함께 재생합니다.
                </p>
                <p className="hint">
                  실제 안내견의 위치가 아닌 가상 경로 대응입니다.
                </p>
              </div>
            )}
            {companionEnabled && companionSource === 'replay' && eligible && (
              <CompanionLog frame={companionFrame} />
            )}
            {companionEnabled &&
              companionSource === 'replay' &&
              eligible &&
              end && (
                <JourneyRecheck
                  key={`${routes?.requestId}:${selectedId}`}
                  address={address}
                  end={end}
                  frame={companionFrame}
                  onContext={setJourneyContext}
                />
              )}
          </aside>
        )}
      </div>
      <footer className="navigation-footer">
        <span>
          GuideSense <span className="footer-separator">/</span> 성동구 보행
          길찾기
        </span>
        <span>TMAP 경로 · 성동구 공공데이터</span>
      </footer>
      <dialog
        className="navigation-info-dialog"
        ref={infoDialog}
        aria-labelledby="navigation-info-title"
      >
        <div className="navigation-dialog-header">
          <p className="navigation-kicker">OUR APPROACH</p>
          <button
            className="navigation-close"
            onClick={() => infoDialog.current?.close()}
            aria-label="안내 기준 닫기"
          >
            <RouteIcon name="close" />
          </button>
        </div>
        <h2 id="navigation-info-title">어떤 길을 추천하나요?</h2>
        <p>
          TMAP이 찾은 보행 경로에 성동구 횡단보도 시설 정보를 연결해 비교합니다.
        </p>
        <ol>
          <li>
            <strong>보행자신호등을 먼저 확인해요.</strong>
            <p>
              신호등이 없거나 횡단 시설을 확인할 수 없는 후보는 추천하지 않아요.
            </p>
          </li>
          <li>
            <strong>거리와 시설을 함께 비교해요.</strong>
            <p>
              음향신호기, 보도턱 낮춤, 점자블록의 유무에 따라 가중치를 더해요.
              모든 길 중 최적 경로를 보장하는 것은 아니에요.
            </p>
          </li>
          <li>
            <strong>지도로 이동을 미리 살펴봐요.</strong>
            <p>
              가상 위치가 경로를 따라 움직입니다. 개 행동 데이터 연결을 켜면
              공개 Replay의 센서값을 기존 모델로 분류하고, 재생 진행률을 경로에
              대응시킵니다. 실제 GPS 기록은 아니며 가상 행동 기록은 추천
              가중치에 반영하지 않습니다.
            </p>
          </li>
        </ol>
        <div className="navigation-data-source">
          <strong>
            시설 {metadata?.crosswalkCount.toLocaleString() ?? '—'}개 기록 ·{' '}
            {metadata?.dataDate ?? '확인 중'}
          </strong>
          <p>
            과거 시설 정보로, 현재 신호나 시설 작동 상태를 나타내지 않습니다.
          </p>
          <a
            href="https://www.data.go.kr/data/15111354/fileData.do"
            target="_blank"
            rel="noreferrer"
          >
            성동구 횡단보도 공공데이터 ↗
          </a>
        </div>
        {metadata && (
          <details>
            <summary>데이터의 확인 범위</summary>
            {metadata.limitations.map((note, index) => (
              <p key={index}>{note}</p>
            ))}
          </details>
        )}
      </dialog>
    </main>
  );
}
