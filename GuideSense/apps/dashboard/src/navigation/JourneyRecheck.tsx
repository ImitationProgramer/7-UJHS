import { useEffect, useRef, useState } from 'react';
import type { CompanionFrame } from './CompanionJourney';
import { behaviorLabels } from './companion';
import {
  distance,
  navigationUrl,
  readResponse,
  RoutesSchema,
  type Point,
} from './contract';

export type JourneyContext = { id: string; text: string };

/** Public dog records drive a simulated review, never a learned route penalty. */
export function JourneyRecheck({
  address,
  end,
  frame,
  onContext,
}: {
  address: string;
  end: Point;
  frame: CompanionFrame | null;
  onContext: (context: JourneyContext | null) => void;
}) {
  const [message, setMessage] = useState(
    '재생 중 행동 분석과 가상 위치를 바탕으로 남은 경로를 다시 조회합니다.',
  );
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | null>(null);
  const checked = useRef<{ id: string; seconds: number } | null>(null);
  const sequence = useRef(0);
  const callback = useRef(onContext);
  callback.current = onContext;
  const latest = frame?.observations.at(-1);
  useEffect(() => {
    return () => {
      active.current?.abort();
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    if (!latest || !['PLAYING', 'COMPLETED'].includes(frame?.state ?? '')) {
      active.current?.abort();
      sequence.current++;
      setPending(false);
      if (latest) {
        checked.current = null;
        setMessage(
          '재생이 멈춰 경로 재검토도 쉬고 있어요. 재생을 계속하면 다시 확인합니다.',
        );
        callback.current(null);
      }
      if (!latest) {
        checked.current = null;
        setMessage(
          '재생 중 행동 분석과 가상 위치를 바탕으로 남은 경로를 다시 조회합니다.',
        );
        callback.current(null);
      }
      return;
    }
    if (!latest.valid || checked.current?.id === latest.id) return;
    const previous = checked.current;
    const elapsed = latest.elapsedSeconds - (previous?.seconds ?? -Infinity);
    if (previous && elapsed >= 0 && elapsed < (latest.changed ? 5 : 15)) return;
    checked.current = { id: latest.id, seconds: latest.elapsedSeconds };
    const activity = behaviorLabels[latest.activity ?? ''] ?? '분류 미확인';
    const change = latest.changed
      ? `${behaviorLabels[latest.previousActivity ?? ''] ?? '이전 분류'}에서 ${activity}로 분류 변화.`
      : `현재 행동 분류 ${activity}.`;
    if (distance(latest.coordinate, [end.lon, end.lat]) < 20) {
      active.current?.abort();
      sequence.current++;
      setPending(false);
      const text = `공개 Replay 시뮬레이션: ${change} 가상 위치가 목적지 20m 이내여서 추가 경로 조회를 생략했습니다. 실제 도착이나 위험을 의미하지 않습니다.`;
      setMessage(text);
      callback.current({ id: latest.id, text });
      return;
    }
    active.current?.abort();
    const abort = new AbortController();
    active.current = abort;
    const run = ++sequence.current;
    setPending(true);
    setMessage(`${change} 남은 경로를 다시 비교하고 있어요.`);
    const timeout = setTimeout(() => abort.abort(), 25000);
    (async () => {
      try {
        const result = RoutesSchema.parse(
          await readResponse(
            await fetch(navigationUrl(address, 'routes'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: abort.signal,
              body: JSON.stringify({
                start: {
                  lat: latest.coordinate[1],
                  lon: latest.coordinate[0],
                  name: 'Replay 가상 현재 위치',
                },
                end,
              }),
            }),
          ),
        );
        if (run !== sequence.current || abort.signal.aborted) return;
        const recommended = result.candidates.find(
          (item) =>
            item.id === result.recommendedId && item.decision === 'eligible',
        );
        const detail = recommended
          ? `시설 기준 추천 후보는 ${Math.round(recommended.distanceM)}m, 약 ${Math.max(1, Math.round(recommended.durationS / 60))}분입니다. ${recommended.reason}`
          : '현재 조회한 후보 중 시설 조건을 확인한 추천 경로가 없습니다.';
        const text = `공개 Replay 시뮬레이션: ${change} 가상 현재 위치에서 목적지까지 다시 조회했습니다. ${detail} 행동 변화의 원인은 알 수 없으며, 행동에 따른 위험 가중치는 적용하지 않았습니다.`;
        setMessage(text);
        callback.current({ id: latest.id, text });
      } catch {
        if (run !== sequence.current) return;
        const text =
          '남은 경로를 다시 조회하지 못했어요. 기존 미리보기를 유지합니다.';
        setMessage(text);
        callback.current({
          id: latest.id,
          text: `공개 Replay 시뮬레이션: ${change} ${text}`,
        });
      } finally {
        clearTimeout(timeout);
        if (run === sequence.current) setPending(false);
      }
    })();
  }, [latest, frame?.state, address, end]);
  return (
    <section className="journey-recheck" aria-label="이동 중 경로 재검토">
      <strong>
        동행 중 경로 다시 살피기 <small>시뮬레이션</small>
      </strong>
      <p role="status" aria-busy={pending}>
        {message}
      </p>
      <small>
        15초 간격 또는 행동 분류 변화 시 재조회합니다. 실제 안내견의 위치·위험
        판단이 아니며, 기존 미리보기 경로는 유지합니다. 음성 연결 중에는 결과도
        읽어드려요.
      </small>
    </section>
  );
}
