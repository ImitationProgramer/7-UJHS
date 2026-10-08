import {
  emptyFrame,
  freshFrame,
  FRAME_INTERVAL_MS,
  MOTION_STALE_MS,
  type SensorFrame,
  type MotionReading,
  type LocationReading,
  type SensorKey,
  type SensorStatus,
  deviceWebSocketUrl,
} from '@guidesense/protocol';

export type Connection =
  'stopped' | 'preparing' | 'connecting' | 'streaming' | 'disconnected';
export type StreamView = {
  connection: Connection;
  detail: string;
  frame: SensorFrame;
};
type Subscription = { remove(): void };
type MotionSource = {
  isAvailableAsync(): Promise<boolean>;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  setUpdateInterval(ms: number): void;
  addListener(
    callback: (value: { x: number; y: number; z: number }) => void,
  ): Subscription;
};
export type Sources = {
  accelerometer: MotionSource;
  gyroscope: MotionSource;
  location: {
    requestPermission(): Promise<boolean>;
    servicesEnabled(): Promise<boolean>;
    watch(
      onValue: (value: LocationReading) => void,
      onError: () => void,
    ): Promise<Subscription>;
  };
  socket(url: string): WebSocket;
};

export class SensorStream {
  private generation = 0;
  private subscriptions: Subscription[] = [];
  private socket: WebSocket | null = null;
  private sendTimer?: ReturnType<typeof setInterval>;
  private viewTimer?: ReturnType<typeof setInterval>;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private lastSentAt = 0;
  private lastSentAccelTimestamp = 0;
  private lastSentGyroTimestamp = 0;
  private raw: SensorFrame;
  private connection: Connection = 'stopped';
  private detail = 'Start Streaming을 눌러 수집을 시작하세요.';

  constructor(
    private deviceId: string,
    private sources: Sources,
    private onView: (view: StreamView) => void,
  ) {
    this.raw = emptyFrame(deviceId, 'stopped');
  }

  private emit() {
    this.onView({
      connection: this.connection,
      detail: this.detail,
      frame: freshFrame(this.raw, Date.now()),
    });
  }

  private status(key: SensorKey, status: SensorStatus) {
    this.raw[key] = null;
    this.raw.sensorStatus[key] = status;
    this.emit();
  }

  private sendFrame() {
    const socket = this.socket;
    if (this.connection !== 'streaming' || socket?.readyState !== 1) return;
    if (socket.bufferedAmount > 65536) {
      this.stop(
        '전송이 지연되었습니다. 네트워크 확인 후 다시 시작하세요.',
        'disconnected',
      );
      return;
    }
    try {
      const now = Date.now();
      socket.send(JSON.stringify(freshFrame(this.raw, now)));
      this.lastSentAt = now;
      this.lastSentAccelTimestamp = this.raw.accelerometer?.timestamp ?? 0;
      this.lastSentGyroTimestamp = this.raw.gyroscope?.timestamp ?? 0;
    } catch {
      this.stop('전송 실패. 다시 시작하세요.', 'disconnected');
    }
  }

  stop(
    detail = '스트리밍이 중지되었습니다.',
    connection: Connection = 'stopped',
  ) {
    this.generation++;
    clearInterval(this.sendTimer);
    clearInterval(this.viewTimer);
    clearTimeout(this.connectionTimer);
    for (const subscription of this.subscriptions.splice(0))
      subscription.remove();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      socket.close();
    }
    this.connection = connection;
    this.detail = detail;
    this.raw = emptyFrame(this.deviceId, 'stopped');
    this.lastSentAt = 0;
    this.lastSentAccelTimestamp = 0;
    this.lastSentGyroTimestamp = 0;
    this.emit();
  }

  async start(address: string) {
    this.stop();
    const generation = this.generation;
    const active = () => this.generation === generation;
    this.raw = emptyFrame(this.deviceId);
    this.connection = 'preparing';
    this.detail = '센서 권한을 확인합니다.';
    this.emit();
    let url: string;
    try {
      url = deviceWebSocketUrl(address, 'device');
    } catch {
      this.stop(
        'Backend 주소를 http://Mac-IP:8000 형식으로 입력하세요.',
        'disconnected',
      );
      return;
    }

    for (const key of ['accelerometer', 'gyroscope'] as const) {
      const sensor = this.sources[key];
      try {
        const available = await sensor.isAvailableAsync();
        if (!active()) return;
        if (!available) {
          this.status(key, 'unavailable');
          continue;
        }
        const permission = await sensor.requestPermissionsAsync();
        if (!active()) return;
        if (!permission.granted) {
          this.status(key, 'denied');
          continue;
        }
        sensor.setUpdateInterval(FRAME_INTERVAL_MS);
        this.subscriptions.push(
          sensor.addListener((value) => {
            if (!active()) return;
            if (![value.x, value.y, value.z].every(Number.isFinite)) {
              this.status(key, 'error');
              return;
            }
            const reading: MotionReading = {
              x: value.x,
              y: value.y,
              z: value.z,
              timestamp: Date.now(),
            };
            this.raw[key] = reading;
            this.raw.sensorStatus[key] = 'ready';
            // Pair newly observed IMU readings. Sending immediately on every
            // accel callback can repeat a gyro value and lose the next one.
            // Either callback may complete the pair; absent/stalled sensors
            // still use the original callback-driven status fallback.
            const accel = this.raw.accelerometer;
            const gyro = this.raw.gyroscope;
            const now = Date.now();
            const freshPair =
              accel &&
              gyro &&
              accel.timestamp > this.lastSentAccelTimestamp &&
              gyro.timestamp > this.lastSentGyroTimestamp;
            const stalledGyro =
              !gyro || now - gyro.timestamp >= 2 * FRAME_INTERVAL_MS;
            const stalledAccel =
              !accel || now - accel.timestamp > MOTION_STALE_MS;
            if (
              freshPair ||
              (key === 'accelerometer' && stalledGyro) ||
              (key === 'gyroscope' && stalledAccel)
            ) {
              this.sendFrame();
            }
          }),
        );
      } catch {
        if (active()) this.status(key, 'error');
      }
    }
    if (!active()) return;
    // Location permission never blocks motion streaming after denial.
    try {
      const granted = await this.sources.location.requestPermission();
      if (!active()) return;
      if (!granted) this.status('location', 'denied');
      else if (!(await this.sources.location.servicesEnabled())) {
        if (active()) this.status('location', 'unavailable');
      } else if (active()) {
        // Starting the watcher may be slow; do not wait for a GPS fix to connect.
        void this.sources.location
          .watch(
            (value) => {
              if (!active()) return;
              this.raw.location = value;
              this.raw.sensorStatus.location = 'ready';
            },
            () => {
              if (active()) this.status('location', 'error');
            },
          )
          .then((subscription) => {
            if (active()) this.subscriptions.push(subscription);
            else subscription.remove();
          })
          .catch(() => {
            if (active()) this.status('location', 'error');
          });
      }
    } catch {
      if (active()) this.status('location', 'error');
    }
    if (!active()) return;
    this.connection = 'connecting';
    this.detail = 'Mac 서버에 연결 중입니다.';
    this.emit();
    try {
      const socket = this.sources.socket(url);
      this.socket = socket;
      this.connectionTimer = setTimeout(() => {
        if (active())
          this.stop(
            '연결 시간 초과. 같은 Wi-Fi와 Backend 주소를 확인하세요.',
            'disconnected',
          );
      }, 8000);
      socket.onopen = () => {
        if (!active()) return;
        clearTimeout(this.connectionTimer);
        this.connection = 'streaming';
        this.detail = '센서 프레임 전송 중 · 목표 50 Hz';
        this.emit();
        // Keep permissions/missing/stale status flowing when motion is absent.
        this.sendTimer = setInterval(() => {
          if (Date.now() - this.lastSentAt >= 100) this.sendFrame();
        }, 100);
        this.viewTimer = setInterval(() => this.emit(), 100);
      };
      socket.onerror = () => {
        if (active())
          this.stop(
            '서버 연결 실패. 주소·Wi-Fi·로컬 네트워크 권한을 확인하세요.',
            'disconnected',
          );
      };
      socket.onclose = (event) => {
        if (active())
          this.stop(
            event.code === 1008
              ? '서버가 연결을 거부했습니다. 다른 기기의 스트리밍을 중지하세요.'
              : '서버 연결이 끊겼습니다. 다시 시작하세요.',
            'disconnected',
          );
      };
    } catch {
      this.stop(
        'WebSocket을 열 수 없습니다. 주소를 확인하세요.',
        'disconnected',
      );
    }
  }
}
