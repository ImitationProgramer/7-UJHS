import { expect, type Page } from '@playwright/test';
import { start } from './navigation';

// No microphone or OpenAI connection is used in these browser tests.
export async function mockVoice(page: Page, denyMicrophone = false) {
  await page.addInitScript(
    ({ denied }) => {
      const state = {
        sent: [] as Record<string, any>[],
        microphoneRequests: 0,
        stoppedTracks: 0,
        closedPeers: 0,
        closedChannels: 0,
        receive: (_event: unknown) => {},
      };
      Object.assign(window, { __voiceTest: state });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          state.microphoneRequests++;
          if (denied)
            throw new DOMException('Permission denied', 'NotAllowedError');
          const track = {
            stop: () => {
              state.stoppedTracks++;
            },
          };
          return { getTracks: () => [track], getAudioTracks: () => [track] };
        },
      });
      class FakeChannel extends EventTarget {
        readyState = 'connecting';
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: Event) => void) | null = null;
        send(raw: string) {
          state.sent.push(JSON.parse(raw));
        }
        open() {
          this.readyState = 'open';
          const event = new Event('open');
          this.dispatchEvent(event);
          this.onopen?.(event);
        }
        receive(data: unknown) {
          const event = new MessageEvent('message', {
            data: JSON.stringify(data),
          });
          this.dispatchEvent(event);
          this.onmessage?.(event);
        }
        close() {
          if (this.readyState === 'closed') return;
          state.closedChannels++;
          this.readyState = 'closed';
          const event = new Event('close');
          this.dispatchEvent(event);
          this.onclose?.(event);
        }
      }
      class FakePeer extends EventTarget {
        connectionState = 'new';
        iceGatheringState = 'complete';
        localDescription: { type: string; sdp: string } | null = null;
        onconnectionstatechange: ((event: Event) => void) | null = null;
        channel: FakeChannel | null = null;
        addTrack() {}
        createDataChannel() {
          this.channel = new FakeChannel();
          state.receive = (event) => this.channel!.receive(event);
          return this.channel;
        }
        async createOffer() {
          return { type: 'offer', sdp: 'v=0\r\nmock-browser-offer' };
        }
        async setLocalDescription(description: { type: string; sdp: string }) {
          this.localDescription = description;
        }
        async setRemoteDescription() {
          this.connectionState = 'connected';
          const event = new Event('connectionstatechange');
          this.dispatchEvent(event);
          this.onconnectionstatechange?.(event);
          this.channel!.open();
        }
        close() {
          if (this.connectionState === 'closed') return;
          state.closedPeers++;
          this.connectionState = 'closed';
        }
      }
      Object.assign(window, { RTCPeerConnection: FakePeer });
      HTMLMediaElement.prototype.play = async () => {};
    },
    { denied: denyMicrophone },
  );
}

export async function emit(page: Page, event: unknown) {
  await page.evaluate(
    (value) => (window as any).__voiceTest.receive(value),
    event,
  );
}

// Synthetic coordinates only: browser tests never read the user's location.
export async function mockLocation(page: Page, denied = false) {
  await page.addInitScript(
    ({ point, denied }) => {
      Object.assign(window, { __locationRequests: 0 });
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
        configurable: true,
        value: (success: PositionCallback, failure?: PositionErrorCallback) => {
          (window as any).__locationRequests++;
          if (denied) {
            failure?.({
              code: 1,
              message: 'Synthetic permission denial',
            } as GeolocationPositionError);
            return;
          }
          success({
            coords: { latitude: point.lat, longitude: point.lon, accuracy: 8 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      });
    },
    { point: start, denied },
  );
}

export async function callTool(
  page: Page,
  id: string,
  name: string,
  args: unknown,
) {
  await emit(page, {
    type: 'response.done',
    response: {
      status: 'completed',
      output: [
        {
          type: 'function_call',
          call_id: id,
          name,
          arguments: JSON.stringify(args),
        },
      ],
    },
  });
  await expect
    .poll(() =>
      page.evaluate(
        (callId) =>
          (window as any).__voiceTest.sent.find(
            (event: any) =>
              event.type === 'conversation.item.create' &&
              event.item?.type === 'function_call_output' &&
              event.item.call_id === callId,
          ),
        id,
      ),
    )
    .toBeTruthy();
  return page.evaluate(
    (callId) =>
      JSON.parse(
        (window as any).__voiceTest.sent.find(
          (event: any) => event.item?.call_id === callId,
        ).item.output,
      ),
    id,
  );
}

export async function mockVoiceEndpoints(page: Page) {
  await page.route('**/api/navigation/validate-location', (route) =>
    route.fulfill({ json: { inServiceArea: true } }),
  );
  await page.route('**/api/navigation/voice/status', (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  await page.route('**/api/navigation/voice/session', (route) =>
    route.fulfill({
      contentType: 'application/sdp',
      body: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
    }),
  );
}
export async function selectVoicePlace(
  page: Page,
  target: 'start' | 'end',
  query: string,
) {
  const id = `${target}-${query}-${Date.now()}`;
  const search = await callTool(page, `${id}-search`, 'search_places', {
    target,
    query,
  });
  expect(search.places.length).toBeGreaterThan(0);
  return callTool(page, `${id}-select`, 'select_place', {
    target,
    place_id: search.places[0].place_id,
  });
}
