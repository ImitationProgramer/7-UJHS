import { useRef, useState, type FormEvent } from 'react';
import { deviceWebSocketUrl, statusLabels } from '@guidesense/protocol';
import { MotionPanel } from './MotionPanel';
import { ReplayPanel } from './ReplayPanel';
import { useSensorStream } from './useSensorStream';

const defaultAddress =
  import.meta.env.VITE_BACKEND_URL ||
  `${location.protocol}//${location.hostname}:8000`;
const displayTime = (value?: number | null) =>
  value == null
    ? '아직 수신하지 않음'
    : new Intl.DateTimeFormat('ko-KR', {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: 'Asia/Seoul',
      }).format(value);
const number = (value: number | undefined | null, digits = 3) =>
  value == null ? '—' : value.toFixed(digits);

export default function App() {
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [address, setAddress] = useState(defaultAddress);
  const [draft, setDraft] = useState(defaultAddress);
  const [fieldError, setFieldError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { snapshot, transport, error } = useSensorStream(address);
  const connected =
    transport === 'connected' && snapshot?.status === 'connected';
  const frame = connected ? snapshot?.frame : null;
  const apply = (event: FormEvent) => {
    event.preventDefault();
    try {
      deviceWebSocketUrl(draft, 'dashboard');
      setAddress(draft.trim());
      setFieldError('');
    } catch {
      setFieldError('http://Mac-IP:8000 형식으로 입력하세요.');
      input.current?.focus();
    }
  };
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">GUIDESENSE / INTEGRATED DASHBOARD</p>
          <h1>GuideSense</h1>
        </div>
        <span className="prototype">PROTOTYPE · 04</span>
      </header>
      <div className="mode-switch" role="group" aria-label="데이터 모드">
        <button aria-pressed={mode === 'live'} onClick={() => setMode('live')}>
          LIVE SENSOR
        </button>
        <button
          aria-pressed={mode === 'replay'}
          onClick={() => setMode('replay')}
        >
          DATASET REPLAY
        </button>
      </div>
      <form className="backend" onSubmit={apply} noValidate>
        <label htmlFor="backend">Backend 주소</label>
        <div className="field-row">
          <input
            ref={input}
            id="backend"
            type="url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={Boolean(fieldError)}
            aria-describedby="backend-help"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit">연결 적용</button>
        </div>
        <p id="backend-help" className={fieldError ? 'field-error' : 'hint'}>
          {fieldError || 'iPhone과 Mac을 같은 Wi-Fi에 연결하세요.'}
        </p>
      </form>
      {mode === 'replay' ? (
        <ReplayPanel key={address} address={address} />
      ) : (
        <>
          <p className="mode-explanation">
            실제 iPhone 센서 연결 모드입니다. 개 행동 분류 정확도는 검증되지
            않았습니다.
          </p>
          <section className="connection-panel" aria-label="기기 연결 상태">
            <div>
              <p className="eyebrow">LIVE SENSOR · iPHONE · human-held</p>
              <p
                className={`device-state ${connected ? 'online' : ''}`}
                role="status"
              >
                <span className="state-dot" />
                {connected
                  ? frame?.sensorStatus.accelerometer === 'unavailable' &&
                    frame?.sensorStatus.gyroscope === 'unavailable'
                    ? 'UNAVAILABLE'
                    : 'CONNECTED'
                  : 'DISCONNECTED'}
              </p>
              <p className="connection-help">
                {connected
                  ? '센서 프레임 수신 중입니다. 센서별 수신 상태를 확인하세요.'
                  : '최신 센서 데이터가 없습니다. iPhone에서 Start Streaming을 누르세요.'}
              </p>
            </div>
            <dl className="connection-meta">
              <div>
                <dt>서버 연결</dt>
                <dd>
                  <span role="status">
                    {transport === 'connected'
                      ? '연결됨'
                      : transport === 'connecting'
                        ? '연결 중…'
                        : '연결 끊김'}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Source / Compatibility</dt>
                <dd>iphone_live / UNVALIDATED</dd>
              </div>
              <div>
                <dt>기기 ID</dt>
                <dd className="device-id">{snapshot?.deviceId ?? '—'}</dd>
              </div>
              <div>
                <dt>마지막 데이터 수신 · KST</dt>
                <dd data-testid="received-at">
                  {displayTime(snapshot?.lastReceivedAt)}
                </dd>
              </div>
              <div>
                <dt>마지막 센서 프레임 · KST</dt>
                <dd>{displayTime(snapshot?.lastSensorTimestamp)}</dd>
              </div>
            </dl>
          </section>
          <p className="transport-note" role="status">
            {error ||
              (snapshot && !connected && snapshot.frame
                ? '수신이 중단되어 이전 센서값을 숨겼습니다.'
                : '목표 50 Hz · 마지막 프레임 기준 · 센서값이 없으면 — 표시')}
          </p>
          <p className="hint">
            Sensor Quality ·{' '}
            {connected
              ? frame?.sensorStatus.accelerometer === 'unavailable' &&
                frame?.sensorStatus.gyroscope === 'unavailable'
                ? 'UNAVAILABLE'
                : '센서별 상태 참조'
              : '현재값 없음'}{' '}
            · API {transport === 'connected' ? 'AVAILABLE' : 'UNAVAILABLE'}
          </p>
          <div className="motion-grid">
            <MotionPanel
              title="Accelerometer"
              unit="g"
              status={frame?.sensorStatus.accelerometer ?? 'stopped'}
              value={frame?.accelerometer ?? null}
            />
            <MotionPanel
              title="Gyroscope"
              unit="rad/s"
              status={frame?.sensorStatus.gyroscope ?? 'stopped'}
              value={frame?.gyroscope ?? null}
            />
          </div>
          <section className="panel gps" aria-label="GPS">
            <div className="panel-heading">
              <h2>
                GPS <span className="subtitle">위치</span>
              </h2>
              <span className="sensor-status">
                {statusLabels[frame?.sensorStatus.location ?? 'stopped']}
              </span>
            </div>
            <dl className="coordinates">
              <div>
                <dt>Latitude / 위도</dt>
                <dd data-testid="latitude">
                  {number(frame?.location?.latitude, 6)}
                </dd>
              </div>
              <div>
                <dt>Longitude / 경도</dt>
                <dd data-testid="longitude">
                  {number(frame?.location?.longitude, 6)}
                </dd>
              </div>
              <div>
                <dt>Accuracy / 정확도</dt>
                <dd data-testid="accuracy">
                  {number(frame?.location?.accuracy, 1)}
                  <small> m</small>
                </dd>
              </div>
            </dl>
            <p className="hint">
              위치 권한과 수신 환경에 따라 지연될 수 있습니다. GPS는 동작
              센서보다 느리게 갱신됩니다.
            </p>
          </section>
          <section className="brooch" aria-label="User Brooch Output">
            <h2>User Brooch Output</h2>
            <p>
              iPhone 입력은 UNVALIDATED입니다. 개 행동 안내를 생성하지 않습니다.
            </p>
          </section>
        </>
      )}
      <footer>
        GuideSense · 실시간 센서 파이프라인{' '}
        <span>수신 상태는 보행 안전 판단이 아닙니다.</span>
      </footer>
    </main>
  );
}
