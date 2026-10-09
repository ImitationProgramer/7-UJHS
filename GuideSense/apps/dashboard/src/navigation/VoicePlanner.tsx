import { useEffect, useRef, useState } from 'react';
import {
  navigationUrl,
  readResponse,
  type Place,
  type Point,
} from './contract';
import { VoiceParticles } from './VoiceParticles';
import { createAudioLevels } from './audioLevels';
import { createVoiceTools, type VoiceTarget } from './voiceTools';

type Props = {
  immersive?: boolean;
  address: string;
  locationReady: boolean;
  demoStart: Point | null;
  journeyContext?: { id: string; text: string };
  start: Point | null;
  end: Point | null;
  onSelect: (target: VoiceTarget, point: Point) => void;
};
type Session = {
  controller: AbortController;
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  stream?: MediaStream;
  meter: ReturnType<typeof createAudioLevels>;
  audioElement: HTMLAudioElement | null;
  timer?: ReturnType<typeof setTimeout>;
  connectTimer?: ReturnType<typeof setTimeout>;
  tools: ReturnType<typeof createVoiceTools>;
  calls: Set<string>;
  responseActive: boolean;
  speechActive: boolean;
  handlingTools: boolean;
  pendingContext?: { id: string; text: string };
  spokenContextIds: Set<string>;
};
type Transcript = { id: string; speaker: string; text: string };

export function VoicePlanner({
  immersive = false,
  address,
  locationReady,
  demoStart,
  start,
  end,
  onSelect,
  journeyContext,
}: Props) {
  const [state, setState] = useState<'idle' | 'connecting' | 'listening'>(
    'idle',
  );
  const [status, setStatus] = useState('마이크를 누르고 목적지만 말해 보세요.');
  const [error, setError] = useState('');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [candidates, setCandidates] = useState<Record<VoiceTarget, Place[]>>({
    start: [],
    end: [],
  });
  const session = useRef<Session | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const levelRef = useRef({ input: 0, output: 0 });
  const current = useRef({ start, end, onSelect });
  current.current = { start, end, onSelect };

  function cleanup() {
    const active = session.current;
    session.current = null;
    if (active) {
      active.controller.abort();
      clearTimeout(active.timer);
      clearTimeout(active.connectTimer);
      active.meter.close();
      active.stream?.getTracks().forEach((track) => track.stop());
      active.channel.close();
      active.peer.close();
    }
    const audioElement = active?.audioElement ?? audio.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.srcObject = null;
    }
  }
  function stop(message = '음성 입력을 종료했어요. 선택한 장소는 유지됩니다.') {
    cleanup();
    setState('idle');
    setCandidates({ start: [], end: [] });
    setStatus(message);
  }
  useEffect(() => {
    setState('idle');
    return cleanup;
  }, [address]);
  useEffect(() => {
    const active = session.current;
    if (!active) return;
    active.tools.invalidate('start');
    send(active, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `현재 출발지가 ${start?.name ?? '미선택'}으로 변경되었습니다. 화면의 최신 선택을 유지하고, 이전 검색 결과로 덮어쓰지 마세요.`,
          },
        ],
      },
    });
  }, [start?.lat, start?.lon, start?.name]);
  useEffect(() => {
    const active = session.current;
    if (!active) return;
    active.tools.invalidate('end');
    send(active, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `현재 도착지가 ${end?.name ?? '미선택'}으로 변경되었습니다. 화면의 최신 선택을 유지하고, 이전 검색 결과로 덮어쓰지 마세요.`,
          },
        ],
      },
    });
  }, [end?.lat, end?.lon, end?.name]);

  useEffect(() => {
    const active = session.current;
    if (!active) return;
    if (!journeyContext || active.spokenContextIds.has(journeyContext.id)) {
      active.pendingContext = undefined;
      return;
    }
    active.pendingContext = journeyContext;
    flushContext(active);
  }, [journeyContext]);

  function requestResponse(active: Session) {
    if (active.responseActive || active.speechActive || active.handlingTools)
      return;
    active.responseActive = true;
    send(active, { type: 'response.create' });
  }
  function flushContext(active: Session) {
    if (
      !active.pendingContext ||
      active.responseActive ||
      active.speechActive ||
      active.handlingTools ||
      active.channel.readyState !== 'open'
    )
      return;
    const context = active.pendingContext;
    active.pendingContext = undefined;
    active.spokenContextIds.add(context.id);
    send(active, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `앱의 경로 상황 데이터: ${context.text}\n이 결과를 지금 음성으로 안내해 주세요. 오류이면 원인과 다음에 말할 내용을 설명하고 답을 기다리세요. 조회가 끝났으면 더 기다리라고 하지 마세요. 실제 도착이나 실시간 GPS 안내로 표현하지 마세요.`,
          },
        ],
      },
    });
    requestResponse(active);
  }

  function send(active: Session, event: unknown) {
    if (session.current !== active || active.channel.readyState !== 'open')
      return;
    try {
      active.channel.send(JSON.stringify(event));
    } catch {
      if (session.current === active)
        stop('음성 연결이 끊겼어요. 다시 연결해 주세요.');
    }
  }
  function addTranscript(id: string, speaker: string, text: unknown) {
    if (typeof text !== 'string' || !text.trim()) return;
    setTranscripts((items) =>
      [...items.filter((item) => item.id !== id), { id, speaker, text }].slice(
        -6,
      ),
    );
  }
  async function receive(active: Session, raw: string) {
    if (session.current !== active) return;
    let event: Record<string, any>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return;
      event = parsed as Record<string, any>;
    } catch {
      return;
    }
    if (event.type === 'response.created') active.responseActive = true;
    if (event.type === 'input_audio_buffer.speech_started') {
      active.speechActive = true;
      setStatus('듣고 있어요…');
    }
    if (event.type === 'input_audio_buffer.speech_stopped') {
      active.speechActive = false;
      // Server VAD creates this response; reserve it before response.created arrives.
      active.responseActive = true;
      setStatus('말씀하신 내용을 확인하고 있어요…');
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed')
      addTranscript(`user-${event.item_id}`, '나', event.transcript);
    if (
      event.type === 'response.output_audio_transcript.done' ||
      event.type === 'response.audio_transcript.done'
    ) {
      addTranscript(
        `assistant-${event.item_id}`,
        'GuideSense',
        event.transcript,
      );
      setStatus('듣고 있어요. 장소를 바꾸거나 추가로 말씀해 주세요.');
    }
    if (event.type === 'error') {
      stop('음성 연결이 종료되었어요. 다시 시도해 주세요.');
      setError('음성 요청을 처리하지 못했어요. 잠시 후 다시 말해 주세요.');
      return;
    }
    if (event.type !== 'response.done') return;
    active.responseActive = false;
    active.handlingTools = true;
    const outputs: unknown[] = Array.isArray(event.response?.output)
      ? event.response.output
      : [];
    let handled = false;
    for (const value of outputs) {
      const call = value as Record<string, unknown>;
      if (
        !call ||
        call.type !== 'function_call' ||
        typeof call.call_id !== 'string' ||
        typeof call.name !== 'string' ||
        typeof call.arguments !== 'string' ||
        active.calls.has(call.call_id)
      )
        continue;
      active.calls.add(call.call_id);
      const output = await active.tools.execute(call.name, call.arguments);
      if (session.current !== active) return;
      send(active, {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(output),
        },
      });
      if (
        call.name === 'end_session' &&
        typeof output === 'object' &&
        output !== null &&
        'ended' in output &&
        output.ended === true
      ) {
        addTranscript(
          `end-${call.call_id}`,
          'GuideSense',
          '음성 대화를 종료했어요.',
        );
        stop();
        return;
      }
      handled = true;
    }
    active.handlingTools = false;
    if (handled) requestResponse(active);
    else flushContext(active);
  }

  async function connect() {
    if (session.current) return;
    setError('');
    setTranscripts([]);
    setCandidates({ start: [], end: [] });
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === 'undefined'
    ) {
      setError(
        '이 브라우저에서는 음성 입력을 사용할 수 없어요. HTTPS 또는 localhost에서 지원 브라우저로 열어 주세요.',
      );
      return;
    }
    const controller = new AbortController();
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel('oai-events');
    const active: Session = {
      controller,
      audioElement: audio.current,
      meter: createAudioLevels(levelRef),
      peer,
      channel,
      calls: new Set(),
      responseActive: false,
      speechActive: false,
      handlingTools: false,
      spokenContextIds: new Set(),
      pendingContext: journeyContext,
      tools: createVoiceTools({
        address,
        signal: controller.signal,
        demoStart,
        onCandidates: (target, places) => {
          if (session.current === active)
            setCandidates((old) => ({ ...old, [target]: places }));
        },
        onSelect: (target, point) => {
          if (session.current === active) {
            if (target === 'start') setError('');
            current.current.onSelect(target, point);
          }
        },
      }),
    };
    session.current = active;
    setState('connecting');
    setStatus('마이크와 음성 연결을 준비하고 있어요…');
    active.connectTimer = setTimeout(() => {
      if (session.current === active) {
        stop('연결 시간이 초과되었어요. 다시 시도해 주세요.');
        setError('마이크 권한과 네트워크 연결을 확인해 주세요.');
      }
    }, 35_000);
    peer.ontrack = (event) => {
      if (session.current !== active || !audio.current) return;
      const remote = event.streams[0] ?? new MediaStream([event.track]);
      audio.current.srcObject = remote;
      active.meter.bind('output', remote);
      void audio.current.play().catch(() => {
        if (session.current === active)
          setStatus(
            '음성이 자동 재생되지 않으면 아래 재생 버튼을 눌러 주세요.',
          );
      });
    };
    peer.onconnectionstatechange = () => {
      if (
        session.current === active &&
        ['failed', 'closed', 'disconnected'].includes(peer.connectionState)
      )
        stop('음성 연결이 끊겼어요. 다시 연결해 주세요.');
    };
    channel.onclose = () => {
      if (session.current === active) stop('음성 연결이 종료되었어요.');
    };
    channel.onmessage = (event) => {
      void receive(active, event.data);
    };
    let locationStatus = '';
    channel.onopen = () => {
      if (session.current !== active) return;
      clearTimeout(active.connectTimer);
      setState('listening');
      setStatus('듣고 있어요. 어디로 가시나요?');
      active.timer = setTimeout(() => {
        if (session.current === active)
          stop(
            '15분이 지나 음성 연결을 종료했어요. 필요하면 다시 시작해 주세요.',
          );
      }, 900_000);
      send(active, {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `현재 화면에서 선택된 장소: 출발지 ${current.current.start?.name ?? '미선택'}, 도착지 ${current.current.end?.name ?? '미선택'}. 음성 장소 입력을 시작합니다. ${locationStatus} 출발지가 선택되어 있다면 유지하고 목적지만 짧게 물어보세요. 출발지를 따로 언급하지 않은 장소는 도착지입니다.`,
            },
          ],
        },
      });
      requestResponse(active);
    };
    try {
      const config = (await readResponse(
        await fetch(navigationUrl(address, 'voice/status'), {
          signal: controller.signal,
        }),
      )) as { configured?: boolean };
      if (!config.configured)
        throw new Error(
          '서버에 OpenAI API 키가 아직 설정되지 않았어요. 설정 후 다시 시도해 주세요.',
        );
      if (!current.current.start) {
        setStatus(
          demoStart
            ? '시연 출발지를 준비하고 있어요…'
            : '현재 위치를 확인하고 있어요…',
        );
        const result = (await active.tools.execute(
          'get_current_location',
          '{}',
        )) as {
          selected?: boolean;
          message?: string;
          source?: string;
          name?: string;
        };
        if (session.current !== active) return;
        locationStatus = result.selected
          ? result.source === 'demo_location'
            ? `시연 모드: ${result.name}을 가상 출발지로 설정했습니다. 실제 GPS 위치가 아닙니다. 첫 응답에서 시연 출발지를 짧게 알려주고 목적지를 물어보세요.`
            : '브라우저 현재 위치를 출발지로 설정했습니다.'
          : `현재 위치 확인 실패: ${result.message ?? '출발할 장소도 말해 주세요.'} 첫 응답에서 이 실패 원인을 먼저 소리 내어 설명한 뒤 출발지를 물어보세요. 현재 위치를 반복 요청하지 마세요.`;
        if (!result.selected)
          setError(
            result.message ??
              '현재 위치를 확인하지 못했어요. 출발할 장소도 말해 주세요.',
          );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (session.current !== active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      active.stream = stream;
      active.meter.bind('input', stream);
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (session.current !== active) return;
      const response = await fetch(navigationUrl(address, 'voice/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: offer.sdp }),
        signal: controller.signal,
      });
      if (!response.ok) await readResponse(response);
      const sdp = await response.text();
      if (session.current !== active) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch (cause) {
      if (session.current !== active) return;
      stop('음성 입력을 시작하지 못했어요.');
      setError(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? '마이크 사용이 허용되지 않았어요. 브라우저에서 마이크를 허용한 뒤 다시 시도해 주세요.'
          : cause instanceof Error
            ? cause.message
            : '음성 연결에 실패했어요. 다시 시도해 주세요.',
      );
    }
  }

  return (
    <section
      className={`voice-planner voice-state-${state}`}
      aria-label="음성으로 출발지와 도착지 설정"
    >
      <div className="voice-planner-heading">
        <div className="voice-cloud-control">
          <VoiceParticles
            active={state !== 'idle'}
            levelRef={levelRef}
            expanded={immersive}
          />
          <button
            type="button"
            className="voice-toggle"
            aria-label={state === 'idle' ? '음성으로 입력' : '음성 종료'}
            aria-pressed={state !== 'idle'}
            disabled={state === 'idle' && !locationReady}
            onClick={() => (state === 'idle' ? void connect() : stop())}
          >
            <svg
              viewBox="0 0 48 48"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {state === 'idle' ? (
                <>
                  <rect x="18" y="6" width="12" height="24" rx="6" />
                  <path d="M12 22a12 12 0 0 0 24 0M24 34v8M18 42h12" />
                </>
              ) : (
                <rect x="14" y="14" width="20" height="20" rx="4" />
              )}
            </svg>
          </button>
        </div>
        <h1>
          {state === 'idle'
            ? '어디로 갈까요?'
            : state === 'connecting'
              ? '연결하고 있어요'
              : '목적지를 말해 주세요'}
        </h1>
      </div>
      <p className="voice-status" role="status">
        {status}
      </p>
      <p className="voice-disclosure">
        {demoStart
          ? `시연 모드 · 가상 기본 출발지: ${demoStart.name}. 실제 위치는 사용하지 않습니다. `
          : '시작하면 현재 위치 권한을 요청합니다. '}
        AI 음성으로 대화하며 음성이 OpenAI로 전송됩니다. 경로 안내 중에도
        연결되며 최대 15분입니다.
      </p>
      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}
      <audio
        ref={audio}
        autoPlay
        controls={state === 'listening' && !immersive}
        aria-label="AI 음성 재생"
        hidden={state !== 'listening'}
      />
      {transcripts.length > 0 && (
        <details className="voice-transcripts">
          <summary>대화 내용 보기</summary>
          <ol>
            {transcripts.map((item) => (
              <li key={item.id}>
                <strong>{item.speaker}</strong> {item.text}
              </li>
            ))}
          </ol>
        </details>
      )}
      {(candidates.start.length > 0 || candidates.end.length > 0) && (
        <details className="voice-place-details">
          <summary>장소 상세 보기</summary>
          {(['start', 'end'] as const).map(
            (target) =>
              candidates[target].length > 0 && (
                <div className="voice-candidates" key={target}>
                  <strong>
                    {target === 'start' ? '출발지' : '도착지'} 후보
                  </strong>
                  <ol>
                    {candidates[target].map((place) => (
                      <li key={place.id}>
                        <span>{place.name}</span>
                        <small>{place.address}</small>
                      </li>
                    ))}
                  </ol>
                </div>
              ),
          )}
        </details>
      )}
    </section>
  );
}
