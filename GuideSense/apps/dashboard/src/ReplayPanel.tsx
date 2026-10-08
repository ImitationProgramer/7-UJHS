import { useState } from 'react';
import { MotionPanel } from './MotionPanel';
import { MotionGraph } from './MotionGraph';
import { broochText } from './replayContract';
import { useReplay } from './useReplay';

export function ReplayPanel({ address }: { address: string }) {
  const {
    snapshot: data,
    history,
    connected,
    error,
    pending,
    command,
  } = useReplay(address);
  const [clip, setClip] = useState('dog22-demo');
  const state = data?.state ?? 'UNAVAILABLE';
  const manifest = data?.manifest;
  const prediction = data?.prediction ?? null;
  const sample = data?.sample;
  const playing = state === 'PLAYING';
  const output = broochText(prediction);
  const analysisStart = manifest
    ? manifest.start +
      Math.min(
        Math.floor((data?.elapsed_seconds ?? 0) / 3) * 3,
        manifest.end - manifest.start - 3,
      )
    : 0;
  return (
    <div className="replay" data-testid="replay-panel">
      <section
        className="connection-panel replay-header"
        aria-label="Replay 재생 상태"
      >
        <div>
          <p className="eyebrow">
            RECORDED DATA · 과거에 실제 개에게서 수집한 공개 기록
          </p>
          <p className="device-state" role="status">
            {state}
          </p>
          <p className="connection-help">
            현재 살아 있는 안내견의 실시간 측정이 아닙니다. iPhone 연결과
            독립적으로 재생합니다.
          </p>
        </div>
        <div>
          <label htmlFor="clip">Recorded clip · 각각 독립된 연속 기록</label>
          <select
            id="clip"
            value={clip}
            disabled={!connected || pending || playing || state === 'PAUSED'}
            onChange={(e) => {
              setClip(e.target.value);
              command('stop');
            }}
          >
            {(data?.clips ?? [{ id: 'dog22-demo', available: false }]).map(
              (c) => (
                <option key={c.id} value={c.id}>
                  {c.id === 'dog22-demo'
                    ? 'Dog 22 / Test 2 · 30초 · 기본 데모'
                    : c.id === 'dog45-transition'
                      ? 'Dog 45 / Test 1 · 30초 · 행동 전환'
                      : 'Dog 44 / Test 1 · 9초 · 자세 기록'}
                  {c.available ? '' : ' · 파일 없음'}
                </option>
              ),
            )}
          </select>
          <div className="replay-controls" aria-label="Replay controls">
            <button
              disabled={!connected || pending || playing}
              onClick={() =>
                command(state === 'PAUSED' ? 'resume' : 'play', clip)
              }
            >
              {state === 'PAUSED' ? '▶ Resume' : '▶ Play'}
            </button>
            <button
              disabled={!connected || pending || !playing}
              onClick={() => command('pause')}
            >
              ⏸ Pause
            </button>
            <button
              disabled={
                !connected ||
                pending ||
                !['PLAYING', 'PAUSED', 'COMPLETED'].includes(state)
              }
              onClick={() => command('stop')}
            >
              ■ Stop
            </button>
            <button
              disabled={!connected || pending}
              onClick={() => command('restart', clip)}
            >
              ↻ Restart
            </button>
          </div>
          <div className="progress-label">
            <span data-testid="replay-time">
              {(data?.elapsed_seconds ?? 0).toFixed(1)} /{' '}
              {(data?.duration_seconds ?? 30).toFixed(1)} s
            </span>
            <span>1× · {Math.round((data?.progress ?? 0) * 100)}%</span>
          </div>
          <progress
            aria-label="Replay 진행률"
            value={data?.progress ?? 0}
            max="1"
          />
        </div>
      </section>
      <p
        className={
          error || data?.error ? 'transport-note field-error' : 'transport-note'
        }
        role="status"
      >
        {error ||
          data?.error ||
          (pending
            ? '재생 명령 처리 중…'
            : state === 'COMPLETED'
              ? '기록 재생 완료. 센서 현재값은 제거했고 마지막 분석은 기록으로 남깁니다.'
              : state === 'PAUSED'
                ? '일시정지 · 화면은 정지 시점의 기록이며 새로운 분석을 생성하지 않습니다.'
                : '50 Hz 기록 · 3초 Window + FIR context 0.2초 후 실제 모델 실행 · 최종 분석은 기록 끝 + 0.2초에 완료')}
      </p>
      <div className="replay-layout">
        <div className="replay-sensors">
          <section className="panel provenance" aria-label="Dataset source">
            <p className="eyebrow">DATASET SOURCE</p>
            <h2>Mendeley Canine Movement</h2>
            <p>
              {manifest
                ? `Dog ${manifest.dog_id} / Test ${manifest.test_num} · ${manifest.split.toUpperCase()} split · ${manifest.samples.toLocaleString()} samples`
                : 'Play를 누르면 파일·모델·출처를 검증하고 기록을 불러옵니다.'}
            </p>
            <p className="hint">
              Recorded timestamp:{' '}
              <span data-testid="recorded-time">
                {sample?.timestamp.toFixed(2) ?? '—'}
              </span>{' '}
              s · 실험 시작 기준 상대초 (날짜/GPS 없음)
            </p>
            <p className="hint">
              현재 원문 annotation:{' '}
              {sample?.label.join(' + ') || '미주석 / 현재값 없음'}
            </p>
          </section>
          <div className="motion-grid">
            <MotionPanel
              title="Accelerometer"
              unit="UNKNOWN"
              status={sample ? 'ready' : 'stopped'}
              value={sample?.accelerometer ?? null}
              recorded
            />
            <MotionPanel
              title="Gyroscope"
              unit="UNKNOWN"
              status={sample ? 'ready' : 'stopped'}
              value={sample?.gyroscope ?? null}
              recorded
            />
          </div>
          <MotionGraph
            samples={history}
            start={manifest?.start ?? 0}
            windowStart={analysisStart}
          />
        </div>
        <section
          className="panel activity"
          aria-label="Canine Activity Analysis"
        >
          <p className="eyebrow">CANINE ACTIVITY ANALYSIS</p>
          <h2>기록과 AI 예측 비교</h2>
          <p className="analysis-status" role="status">
            {prediction
              ? prediction.inference_executed
                ? 'Prediction Available'
                : 'INVALID_WINDOW · 추론 거부'
              : '3초 Window 분석 대기'}
          </p>
          <div className="activity-result">
            <span>Actual Label · 완성된 Window 정답</span>
            <strong data-testid="actual-label">
              {prediction?.actual_activity ?? '—'}
            </strong>
            {prediction && !prediction.actual_activity && (
              <p className="hint">
                미주석·전환·복수 행동 등으로 단일 정답 없음
              </p>
            )}
          </div>
          <div className="activity-result predicted">
            <span>AI Prediction · 실제 모델 실행</span>
            <strong data-testid="predicted-label">
              {prediction?.predicted_activity ?? '—'}
            </strong>
          </div>
          <p
            className={`comparison ${prediction?.matches_actual === false ? 'mismatch' : ''}`}
            data-testid="comparison"
          >
            {prediction?.matches_actual == null
              ? '비교 가능한 정답 없음'
              : prediction.matches_actual
                ? '일치 · MATCH'
                : '불일치 · MISMATCH'}
          </p>
          <dl className="analysis-meta">
            <div>
              <dt>Window Quality</dt>
              <dd>
                {prediction?.window_quality ?? sample?.window_quality ?? '—'}
              </dd>
            </div>
            <div>
              <dt>분석 구간 · 기록 상대초</dt>
              <dd>
                {prediction
                  ? `${prediction.window_start.toFixed(1)}–${prediction.window_end.toFixed(1)} s`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>현재 수집 Window</dt>
              <dd>
                {manifest
                  ? `${analysisStart.toFixed(1)}–${(analysisStart + 3).toFixed(1)} s`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Model / Version</dt>
              <dd>
                {manifest
                  ? `RandomForest / ${manifest.model_version}`
                  : '로드 대기'}
              </dd>
            </div>
            <div>
              <dt>입력</dt>
              <dd>50 Hz · 3초 · 112 features</dd>
            </div>
            <div>
              <dt>완료한 분석</dt>
              <dd data-testid="analysis-count">{data?.analysis_count ?? 0}</dd>
            </div>
            <div>
              <dt>Goal 3 저장 예측과 비교</dt>
              <dd>
                {prediction?.matches_saved == null
                  ? '—'
                  : prediction.matches_saved
                    ? '동일'
                    : '상이 · 실제 재추론 결과 유지'}
              </dd>
            </div>
          </dl>
          <p className="hint">
            {playing
              ? '마지막 완성 Window 결과입니다. 다음 분석을 기다리는 동안 유지됩니다.'
              : '정지·완료 상태의 결과는 과거 분석입니다.'}
          </p>
          {prediction?.quality_reasons.length ? (
            <p className="field-error">
              {prediction.quality_reasons.join(', ')}
            </p>
          ) : null}
          <p className="hint">
            6개 행동의 closed-set 모델입니다. Pacing 등 미학습 행동·전환의
            정확도는 검증되지 않았습니다. 건강·질병을 판단하지 않습니다.
          </p>
        </section>
      </div>
      <section className="brooch replay-brooch" aria-label="User Brooch Output">
        <div>
          <p className="eyebrow">USER BROOCH OUTPUT</p>
          <h2>User Brooch Output</h2>
          <p className="hint">텍스트 시뮬레이터 · 음성/TTS 미구현</p>
        </div>
        <div>
          <p data-testid="brooch-output">
            {output ?? '실제 모델 분석 결과를 기다립니다.'}
          </p>
          <p className="hint">
            {prediction
              ? `Window ${prediction.window_id + 1}의 ${playing ? '마지막' : '과거'} 결과 · 정답 안내가 아닌 모델의 분류입니다.`
              : 'Navigation · Reminders · Health Monitoring은 향후 범위입니다.'}
          </p>
        </div>
      </section>
      {manifest && (
        <details className="attribution">
          <summary>데이터 출처 · 라이선스 · 변경사항</summary>
          <p>{manifest.attribution}</p>
          <p>
            <a href={manifest.dataset_source}>Mendeley Data v4</a> ·{' '}
            <a href={manifest.license_url}>{manifest.license}</a>
          </p>
          <p>{manifest.changes}</p>
        </details>
      )}
    </div>
  );
}
