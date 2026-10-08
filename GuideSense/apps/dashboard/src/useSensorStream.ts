import { useEffect, useState } from 'react';
import {
  deviceWebSocketUrl,
  SnapshotSchema,
  type Snapshot,
} from '@guidesense/protocol';

export function useSensorStream(address: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [transport, setTransport] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let watchdog: ReturnType<typeof setInterval>;
    let lastMessage = 0;
    let retryCount = 0;
    let latest: Snapshot | null = null;
    let dirty = false;
    let url: string;
    setSnapshot(null);
    setError('');
    try {
      url = deviceWebSocketUrl(address, 'dashboard');
    } catch {
      setTransport('disconnected');
      setError('Backend 주소를 확인하세요.');
      return;
    }
    const connect = () => {
      if (disposed) return;
      setTransport('connecting');
      lastMessage = Date.now();
      socket = new WebSocket(url);
      socket.onopen = () => {
        if (disposed) return;
        lastMessage = Date.now();
        // Connected only after a valid snapshot has arrived.
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const result = SnapshotSchema.safeParse(JSON.parse(event.data));
          if (!result.success) throw new Error('schema');
          latest = result.data;
          dirty = true;
          lastMessage = Date.now();
          retryCount = 0;
          setTransport('connected');
          setError('');
        } catch {
          setError('서버 데이터 형식 오류. 연결을 다시 시도합니다.');
          setTransport('disconnected');
          socket?.close();
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onclose = () => {
        if (disposed) return;
        setTransport('disconnected');
        setError(
          (previous) =>
            previous || '서버 연결이 끊겼습니다. 자동으로 다시 연결합니다.',
        );
        retry = setTimeout(connect, Math.min(1000 * 2 ** retryCount++, 10000));
      };
    };
    connect();
    // Retain only the latest frame; render at 10 Hz without buffering a history.
    const paint = setInterval(() => {
      if (dirty) {
        setSnapshot(latest);
        dirty = false;
      }
    }, 100);
    watchdog = setInterval(() => {
      if (socket && socket.readyState <= 1 && Date.now() - lastMessage > 4000) {
        setTransport('disconnected');
        setError('서버 응답이 지연되었습니다. 자동으로 다시 연결합니다.');
        socket.close();
      }
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      clearInterval(paint);
      if (socket) {
        socket.onclose =
          socket.onerror =
          socket.onmessage =
          socket.onopen =
            null;
        socket.close();
      }
    };
  }, [address]);
  return { snapshot, transport, error };
}
