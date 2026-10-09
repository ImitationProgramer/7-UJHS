import { useEffect, useRef, useState } from 'react';
import { useReplay } from '../useReplay';
import { MotionGraph } from '../MotionGraph';
import { RouteIcon } from './RouteIcon';
import {
  behaviorLabels,
  observeReplay,
  type JourneyObservation,
} from './companion';
import type { Candidate } from './contract';
import type { ReplaySnapshot, ReplaySample } from '../replayContract';

export type CompanionFrame = {
  progress: number;
  state: ReplaySnapshot['state'] | 'DISCONNECTED';
  observations: JourneyObservation[];
};
const clipLabels: Record<string, string> = {
  'dog45-transition': '걷기 → 앉기 · Dog 45 · 30초',
  'dog22-demo': '걷기 기록 · Dog 22 · 30초',
  'dog44-posture': '분류 불일치 사례 · Dog 44 · 9초',
};
const EMPTY: JourneyObservation[] = [];
const EMPTY_SAMPLES: ReplaySample[] = [];
export function CompanionJourney({
  address,
  candidate,
  onFrame,
}: {
  address: string;
  candidate: Candidate;
  onFrame: (frame: CompanionFrame) => void;
}) {
  const { snapshot, history, connected, pending, error, command } =
    useReplay(address);
  const [clipId, setClipId] = useState('dog45-transition');
  const [observations, setObservations] = useState<JourneyObservation[]>([]);
  const records = useRef<JourneyObservation[]>([]);
  const run = useRef<number | null>(null);
  const awaitingReset = useRef(false);
  const callback = useRef(onFrame);
  callback.current = onFrame;
  const state = connected ? (snapshot?.state ?? 'IDLE') : 'DISCONNECTED';
  const active = state === 'PLAYING' || state === 'PAUSED';
  const available =
    snapshot?.clips.some((clip) => clip.id === clipId && clip.available) ??
    false;
  useEffect(() => {
    if (
      !snapshot ||
      !connected ||
      snapshot.state === 'ERROR' ||
      snapshot.state === 'STOPPED'
    ) {
      records.current = [];
      setObservations([]);
      callback.current({
        progress: 0,
        state: connected ? (snapshot?.state ?? 'IDLE') : 'DISCONNECTED',
        observations: [],
      });
      return;
    }
    if (run.current !== snapshot.run_id) {
      run.current = snapshot.run_id;
      records.current = [];
      awaitingReset.current = false;
    }
    if (awaitingReset.current) return;
    const observation = observeReplay(
      candidate,
      snapshot,
      records.current.at(-1) ?? null,
    );
    if (observation) records.current = [...records.current, observation];
    setObservations(records.current);
    callback.current({
      progress: snapshot.progress,
      state: snapshot.state,
      observations: records.current,
    });
  }, [snapshot, connected, candidate]);
  function begin(restart = false) {
    if (pending || !connected || !available) return;
    awaitingReset.current = true;
    records.current = [];
    setObservations([]);
    callback.current({ progress: 0, state: 'IDLE', observations: [] });
    command(restart ? 'restart' : 'play', clipId);
  }
  function selectClip(value: string) {
    setClipId(value);
    records.current = [];
    setObservations([]);
    awaitingReset.current = true;
    callback.current({ progress: 0, state: 'IDLE', observations: [] });
    if (snapshot?.state !== 'IDLE') command('stop');
  }
  const latest = observations.at(-1);
  const analysisStart = snapshot?.manifest
    ? snapshot.manifest.start +
      Math.min(
        Math.floor(snapshot.elapsed_seconds / 3) * 3,
        snapshot.manifest.end - snapshot.manifest.start - 3,
      )
    : 0;
  const predicted =
    latest?.valid && latest.activity
      ? (behaviorLabels[latest.activity] ?? latest.activity)
      : '분석 대기';
  function download() {
    if (!snapshot?.manifest || !observations.length) return;
    const record = {
      schemaVersion: 'guidesense-companion-v1',
      exportedAt: new Date().toISOString(),
      source: snapshot.source,
      isLive: false,
      association: 'simulated_by_replay_progress_not_recorded_GPS',
      usage: 'demonstration_only_excluded_from_route_ranking',
      clipId: snapshot.clip_id,
      manifest: snapshot.manifest,
      route: {
        id: candidate.id,
        geometry: candidate.geometry,
        crossings: candidate.crossings,
      },
      observations,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `guidesense-${snapshot.clip_id}-journey.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="companion-playback" aria-label="개 행동 기록과 경로 연결">
      <div className="companion-select-row">
        <label htmlFor="companion-clip">공개 개 행동 기록</label>
        <select
          id="companion-clip"
          value={clipId}
          disabled={active || pending}
          onChange={(event) => selectClip(event.target.value)}
        >
          {Object.entries(clipLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="companion-prediction" aria-live="polite">
        <span>
          AI 행동 분류{' '}
          <strong data-testid="companion-predicted">{predicted}</strong>
        </span>
        <span className="companion-annotation">
          원본 주석:{' '}
          <span data-testid="companion-actual">
            {latest?.actualActivity
              ? (behaviorLabels[latest.actualActivity] ?? latest.actualActivity)
              : '없음'}
          </span>
          {latest?.matchesActual === false && <b>분류 불일치</b>}
        </span>
      </div>
      {latest && !latest.valid && (
        <p className="companion-notice">
          센서 구간 품질을 확인하지 못해 행동을 분류하지 않았어요.
        </p>
      )}
      <div className="companion-controls">
        {state === 'PLAYING' ? (
          <button
            className="navigation-play"
            disabled={pending}
            onClick={() => command('pause')}
          >
            <RouteIcon name="pause" />
            동행 일시정지
          </button>
        ) : (
          <button
            className="navigation-play"
            disabled={!connected || !available || pending}
            onClick={() => (state === 'PAUSED' ? command('resume') : begin())}
          >
            <RouteIcon name="play" />
            {state === 'PAUSED'
              ? '동행 계속'
              : state === 'COMPLETED'
                ? '동행 다시 재생'
                : '동행 재생'}
          </button>
        )}
        <button
          className="navigation-restart"
          aria-label="동행 처음부터"
          title="동행 처음부터"
          disabled={!connected || !available || pending}
          onClick={() => begin(true)}
        >
          <RouteIcon name="restart" />
        </button>
        <span className="companion-time" data-testid="companion-time">
          {(snapshot?.elapsed_seconds ?? 0).toFixed(1)} /{' '}
          {(snapshot?.duration_seconds ?? 0).toFixed(0)}초
        </span>
        <button
          className="companion-export"
          disabled={!observations.length || active || pending}
          onClick={download}
        >
          기록 저장
        </button>
      </div>
      <p className="companion-status" role="status">
        {error ||
          snapshot?.error ||
          (!connected
            ? '행동 데이터에 연결하는 중…'
            : !available
              ? '이 기록의 Replay 파일이 준비되지 않았어요.'
              : state === 'COMPLETED'
                ? '재생 완료 · 마지막 분석까지 반영했어요.'
                : '저장된 센서값을 기존 모델로 재분석합니다.')}
      </p>
      <p className="companion-disclosure">
        공개 개 기록 × 가상 경로 · 실제 안내견의 GPS 기록이 아닙니다.
      </p>
      <div className="companion-motion" data-testid="companion-motion">
        <MotionGraph
          samples={
            connected &&
            !awaitingReset.current &&
            snapshot?.clip_id === clipId &&
            !['ERROR', 'STOPPED', 'IDLE'].includes(state)
              ? history
              : EMPTY_SAMPLES
          }
          start={snapshot?.manifest?.start ?? 0}
          windowStart={analysisStart}
          compact
        />
      </div>
      {snapshot?.manifest &&
        snapshot.clip_id === clipId &&
        observations.length > 0 && (
          <details className="companion-source">
            <summary>기록 출처</summary>
            <p>{snapshot.manifest.attribution}</p>
            <p>{snapshot.manifest.changes}</p>
            <a
              href={snapshot.manifest.dataset_source}
              target="_blank"
              rel="noreferrer"
            >
              원본 데이터셋
            </a>{' '}
            ·{' '}
            <a
              href={snapshot.manifest.license_url}
              target="_blank"
              rel="noreferrer"
            >
              {snapshot.manifest.license}
            </a>
            <p>
              모델 {snapshot.manifest.model_version} · Dog{' '}
              {snapshot.manifest.dog_id}
            </p>
          </details>
        )}
    </div>
  );
}

export function CompanionLog({ frame }: { frame: CompanionFrame | null }) {
  const observations = frame?.observations ?? EMPTY;
  const changes = observations.filter((item) => item.changed);
  const reviewed = observations.filter((item) => item.matchesActual !== null);
  const mismatch = reviewed.filter(
    (item) => item.matchesActual === false,
  ).length;
  return (
    <section className="companion-log" aria-label="경로 위 행동 기록">
      <p className="navigation-kicker">WALK TOGETHER</p>
      <h2>어디에서 움직임이 바뀌었을까?</h2>
      <p className="companion-log-intro">
        분류가 달라진 구간을 경로에 대응시켜 살펴봐요.
      </p>
      <dl className="companion-stats">
        <div>
          <dt>분석 구간</dt>
          <dd data-testid="companion-count">{observations.length}</dd>
        </div>
        <div>
          <dt>분류 변화</dt>
          <dd data-testid="companion-changes">{changes.length}</dd>
        </div>
        <div>
          <dt>주석과 불일치</dt>
          <dd>
            {mismatch}
            <small> / {reviewed.length}</small>
          </dd>
        </div>
      </dl>
      {changes.length ? (
        <ol className="companion-events">
          {changes.map((item, index) => (
            <li key={item.id}>
              <span className="companion-event-number">{index + 1}</span>
              <div>
                <strong>
                  {behaviorLabels[item.previousActivity!] ??
                    item.previousActivity}{' '}
                  → {behaviorLabels[item.activity!] ?? item.activity}
                </strong>
                <p>
                  {item.elapsedSeconds.toFixed(1)}초 · {item.context}
                </p>
                <p>가상 경로 {Math.round(item.meters)}m 지점</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="companion-empty">
          {observations.length
            ? '아직 연속된 유효 구간에서 분류 변화가 없어요.'
            : '동행 재생을 시작하면 분석 기록이 쌓여요.'}
        </p>
      )}
      {changes.length > 0 && (
        <p className="companion-reflection" role="status">
          행동 분류가 바뀌었어요. 실제 이동에서는 이 시점의 주변 상황을 확인하는
          데 활용할 수 있어요.
        </p>
      )}
      <details>
        <summary>현재 시연의 전체 분석 기록</summary>
        <ul className="companion-all-records">
          {observations.map((item) => (
            <li key={item.id}>
              {item.elapsedSeconds.toFixed(1)}초 ·{' '}
              {item.valid && item.activity
                ? (behaviorLabels[item.activity] ?? item.activity)
                : '분류 불가'}
              {item.matchesActual === false ? ' · 주석과 불일치' : ''}
            </li>
          ))}
        </ul>
      </details>
      <p className="companion-log-note">
        현재 시연 동안만 보관해요. 경로 변경·재시작 시 초기화됩니다. 가상 기록은
        경로 추천 가중치에 반영하지 않습니다.
      </p>
    </section>
  );
}
