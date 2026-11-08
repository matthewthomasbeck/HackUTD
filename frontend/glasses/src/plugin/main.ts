// Plugin boot (glasses.md 3.3). Thin client: render page, text, and image messages; send input, ack, heartbeat, position.
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import { STARTUP_CONTAINERS, base64ToBytes, createStartupPage, sdkDisplayBridge } from './bridge';
import { startHeartbeat } from './heartbeat';
import { createInputHandler } from './input';
import { startLocation } from './location';
import { createMicrophoneController } from './mic';
import { LINK_LOST_TEXT, STATUS_ID, parseServiceMsg } from './protocol';
import type { PluginMsg } from './protocol';
import { createWriteQueue } from './queue';
import { connectService } from './socket';
import type { ServiceSocket } from './socket';

const params = new URLSearchParams(location.search);

function serviceUrl(): string {
  const fromQuery = params.get('ws');
  if (fromQuery) return fromQuery;
  const fromEnv = import.meta.env.VITE_GLASSES_WS_URL as string | undefined;
  if (fromEnv) return fromEnv;
  // Same host as the page, which is the laptop when loaded by QR or in the simulator.
  return `ws://${location.hostname || 'localhost'}:8787/glasses`;
}

function phoneNote(text: string): void {
  const app = document.getElementById('app');
  if (app) app.textContent = text;
}

async function boot(): Promise<void> {
  phoneNote('Rubble Search: keep this app open and in front while you wear the glasses.');

  // 1. Bridge
  const sdk = await waitForEvenAppBridge();

  // 2. Startup page, exactly once (one retry on failure)
  const created = await createStartupPage(sdk);
  if (!created) console.error('[main] startup page failed twice; continuing so the service can rebuild');

  const display = sdkDisplayBridge(sdk);
  const queue = createWriteQueue(display);
  queue.setLayout(STARTUP_CONTAINERS);

  let ackId: number | string | null = null;
  let socket: ServiceSocket | null = null;
  let stopHeartbeat: () => void = () => {};
  let stopLocation: () => void = () => {};
  const send = (msg: PluginMsg) => socket?.send(msg) ?? false;
  const microphone = createMicrophoneController(sdk, { send, isOpen: () => socket?.isOpen() ?? false });

  // 3. Input and lifecycle
  const inputHandler = createInputHandler({
      send,
      isOpen: () => socket?.isOpen() ?? false,
      shutdown: (mode) => {
        sdk.shutDownPageContainer(mode).catch((err) => console.warn('[main] shutdown failed', err));
      },
      getAckId: () => ackId,
      onForeground: () => socket?.reconnectNow(),
      onExit: () => {
        stopHeartbeat();
        stopLocation();
        void microphone.stop(true);
        socket?.close();
        unsubscribeEvents();
      },
    });
  const unsubscribeEvents = sdk.onEvenHubEvent(event => {
    microphone.handleEvent(event);
    inputHandler(event);
  });

  // 4. Serial
  let serial = 'sim';
  try {
    serial = (await sdk.getDeviceInfo())?.sn || 'sim';
  } catch (err) {
    console.warn('[main] getDeviceInfo failed, using "sim"', err);
  }
  const rescuer = params.get('rescuer') ?? undefined;

  // 5. Socket
  const url = serviceUrl();
  console.log('[main] serial', serial, 'service', url);
  socket = connectService({
    url,
    onOpen: () => {
      const hello: PluginMsg = rescuer ? { type: 'hello', serial, rescuer } : { type: 'hello', serial };
      socket?.send(hello);
    },
    onMessage: (raw) => {
      const msg = parseServiceMsg(raw);
      if (!msg) {
        console.warn('[main] bad message', raw.slice(0, 120));
        return;
      }
      switch (msg.type) {
        case 'page':
          ackId = msg.ack_assignment_id ?? null; // kept until the next page
          queue.enqueue({ kind: 'page', msg });
          break;
        case 'text':
          queue.enqueue({ kind: 'text', id: msg.id, content: msg.content, textColor: msg.text_color });
          break;
        case 'image':
          try {
            queue.enqueue({ kind: 'image', id: msg.id, bytes: base64ToBytes(msg.png_b64) });
          } catch (err) {
            console.warn('[main] bad png_b64 for image', msg.id, err);
          }
          break;
        case 'exit':
          sdk.shutDownPageContainer(0).catch((err) => console.warn('[main] exit failed', err));
          break;
        case 'mic':
          void microphone.handleServiceMessage(msg);
          break;
        default:
          console.warn('[main] unknown message type', (msg as { type: string }).type);
      }
    },
    onClose: () => {
      // The only text the plugin writes by itself; every layout has text id 8 named status.
      void microphone.stop(false);
      queue.enqueue({ kind: 'text', id: STATUS_ID, content: LINK_LOST_TEXT });
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') socket?.reconnectNow();
  });

  // 6. Location (tolerates none)
  stopLocation = await startLocation(sdk, send);

  // 7. Heartbeat
  stopHeartbeat = startHeartbeat(socket, params.get('noheartbeat') === '1');

  // 8. The microphone remains off until a service mic message arrives.
}

boot().catch((err) => {
  console.error('[main] boot failed', err);
  phoneNote(`Rubble Search failed to start: ${String(err)}`);
});
