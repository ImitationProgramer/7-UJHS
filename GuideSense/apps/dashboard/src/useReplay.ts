import { useEffect, useRef, useState } from 'react';
import {
  ReplaySnapshotSchema,
  replayUrl,
  type ReplayAction,
  type ReplaySample,
  type ReplaySnapshot,
} from './replayContract';

export function useReplay(address: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef(false);
  const commandId = useRef(0);
  const [snapshot, setSnapshot] = useState<ReplaySnapshot | null>(null);
  const [history, setHistory] = useState<ReplaySample[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let lastMessage = Date.now();
    let retries = 0;
    let run = -1;
    let points: ReplaySample[] = [];
    const clear = () => {
      setConnected(false);
      setSnapshot(null);
      setHistory([]);
      pendingRef.current = false;
      setPending(false);
      points = [];
      run = -1;
    };
    clear();
    const connect = () => {
      if (disposed) return;
      try {
        socket = new WebSocket(replayUrl(address));
      } catch {
        setError('Backend 주소를 확인하세요.');
        return;
      }
      socketRef.current = socket;
      lastMessage = Date.now();
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const data = ReplaySnapshotSchema.parse(JSON.parse(event.data));
          lastMessage = Date.now();
          retries = 0;
          if (run !== data.run_id) {
            points = [];
            run = data.run_id;
          }
          if (data.state === 'ERROR' || data.state === 'STOPPED') points = [];
          for (const sample of data.samples) {
            if (
              !points.length ||
              sample.timestamp > points[points.length - 1].timestamp
            )
              points.push(sample);
          }
          points = points.slice(-750); // 15 s of actual 50 Hz samples, bounded memory.
          setHistory([...points]);
          setSnapshot(data);
          setConnected(true);
          setError('');
          if (data.command_id === commandId.current) {
            pendingRef.current = false;
            setPending(false);
          }
        } catch {
          clear();
          setError('Replay 데이터 형식 오류. 연결을 다시 시도합니다.');
          socket?.close();
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        clear();
        setError(
          'Replay 서버 연결이 끊겼습니다. 재연결 후 Play로 처음부터 재생하세요.',
        );
        retry = setTimeout(connect, Math.min(1000 * 2 ** retries++, 10000));
      };
    };
    connect();
    const watchdog = setInterval(() => {
      if (socket && socket.readyState <= 1 && Date.now() - lastMessage > 5000) {
        clear();
        setError('Replay 응답 시간 초과. 다시 연결합니다.');
        socket.close();
      }
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      socketRef.current = null;
      if (socket) {
        socket.onmessage = socket.onclose = socket.onerror = null;
        socket.close();
      }
    };
  }, [address]);
  const command = (action: ReplayAction, clipId?: string) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN || pendingRef.current)
      return;
    pendingRef.current = true;
    setPending(true);
    socketRef.current.send(
      JSON.stringify({
        action,
        command_id: ++commandId.current,
        ...(clipId ? { clip_id: clipId } : {}),
      }),
    );
  };
  return { snapshot, history, connected, error, pending, command };
}
