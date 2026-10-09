import { useEffect, useState } from 'react';
import { statusLabels } from '@guidesense/protocol';
import { MotionGraph } from '../MotionGraph';
import { useSensorStream } from '../useSensorStream';
import { appendLiveFrame, EMPTY_LIVE_HISTORY } from './liveHistory';
import './live-demo.css';

export function LiveCompanion({ address }: { address: string }) {
  const { snapshot, transport, error } = useSensorStream(address);
  const connected =
    transport === 'connected' && snapshot?.status === 'connected';
  const frame = connected ? (snapshot?.frame ?? null) : null;
  const [history, setHistory] = useState(EMPTY_LIVE_HISTORY);
  useEffect(() => {
    setHistory((previous) => appendLiveFrame(previous, frame));
  }, [frame]);
  const visible =
    frame && history.deviceId === frame.deviceId ? history : EMPTY_LIVE_HISTORY;
  return (
    <section
      className="live-companion companion-playback"
      aria-label="휴대폰 실시간 센서"
    >
      <div
        className={`live-companion-heading ${connected ? 'is-connected' : ''}`}
      >
        <div>
          <span className="live-source-label">LIVE · iPHONE</span>
          <strong>지금, 휴대폰의 움직임</strong>
        </div>
        <span role="status" data-testid="live-device-status">
          {connected
            ? '휴대폰 연결됨'
            : transport === 'connected'
              ? '휴대폰 연결 대기'
              : '서버 연결 중'}
        </span>
      </div>
      <div className="live-signal-path" aria-label="실시간 데이터 연결 흐름">
        <span className={connected ? 'active' : ''}>휴대폰</span>
        <span aria-hidden="true">→</span>
        <span className={transport === 'connected' ? 'active' : ''}>
          센서 서버
        </span>
        <span aria-hidden="true">→</span>
        <span className={frame ? 'active' : ''}>실시간 그래프</span>
      </div>
      <p className="companion-status" role="status">
        {error ||
          (connected
            ? 'Expo 앱에서 보내는 센서값을 표시합니다.'
            : '같은 Wi-Fi의 Expo 앱에서 서버 주소를 입력하고 Start Streaming을 누르세요.')}
      </p>
      <dl className="live-companion-meta">
        <div>
          <dt>기기</dt>
          <dd data-testid="live-device-id">
            {connected ? (snapshot?.deviceId ?? '—') : '—'}
          </dd>
        </div>
        <div>
          <dt>마지막 수신</dt>
          <dd>
            {connected && snapshot?.lastReceivedAt
              ? new Date(snapshot.lastReceivedAt).toLocaleTimeString('ko-KR', {
                  hour12: false,
                })
              : '—'}
          </dd>
        </div>
        <div>
          <dt>가속도</dt>
          <dd>
            {statusLabels[frame?.sensorStatus.accelerometer ?? 'stopped']}
          </dd>
        </div>
        <div>
          <dt>각속도</dt>
          <dd>{statusLabels[frame?.sensorStatus.gyroscope ?? 'stopped']}</dd>
        </div>
      </dl>
      <div className="companion-motion" data-testid="live-motion">
        <MotionGraph
          samples={visible.samples}
          start={visible.start}
          windowStart={0}
          compact
          live
        />
      </div>
      <div className="live-analysis-boundary">
        <strong>이 화면에서 확인하는 것</strong>
        <p>실제 휴대폰 센서 수신과 움직임 변화</p>
        <span>
          개 행동 AI 분류는 공개 기록 Replay에서 시연합니다. 휴대폰 센서에 개
          행동 모델을 적용하지 않습니다.
        </span>
      </div>
    </section>
  );
}
