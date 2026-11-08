// Plugin boot (glasses.md 3.3). Thin client: render page, text, and image messages; send input, ack, heartbeat, position.
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import { STARTUP_CONTAINERS, base64ToBytes, createStartupPage, sdkDisplayBridge } from './bridge';
import { startHeartbeat } from './heartbeat';
import { createInputHandler } from './input';
import { startLocation } from './location';
import { createDemoPlayer } from './demo';
import type { DemoPlayer, DemoRecording } from './demo';
import { createMicrophoneController } from './mic';
import { LINK_LOST_TEXT, STATUS_ID, parseServiceMsg } from './protocol';
import type { PluginMsg, ServiceMsg } from './protocol';
import { createWriteQueue } from './queue';
import { connectService } from './socket';
import type { ServiceSocket } from './socket';

const params = new URLSearchParams(location.search);
// Offline demo (demo.ts): `?demo=1` plays it at once, `?demo=0` never plays it, and by default it plays when the
// service has not answered OFFLINE_AFTER_MS after boot. Once a live link has opened, a later drop shows LINK LOST
// and never switches to the recording, so a rescuer is never shown a recorded survivor as live.
const DEMO_PARAM = params.get('demo');
const OFFLINE_AFTER_MS = 6000;

function serviceUrl(): string {
  const fromQuery = params.get('ws');
  if (fromQuery) return fromQuery;
  const fromEnv = import.meta.env.VITE_GLASSES_WS_URL as string | undefined;
  if (fromEnv) return fromEnv;
  // Same host as the page, which is the laptop when loaded by QR or in the simulator.
  return `ws://${location.hostname || 'localhost'}:8787/glasses`;
}

let currentNote = '';
let displayOffNote = false;

function phoneNote(text: string): void {
  currentNote = text;
  if (!displayOffNote) showNote(text);
}

function showNote(text: string): void {
  const app = document.getElementById('app');
  if (app) app.textContent = text;
}

async function boot(): Promise<void> {
  phoneNote('UnderDog: keep this app open and in front while you wear the glasses.');

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
  let everOpen = false;
  // The recording loads only when the demo plays, so a live session never downloads it.
  let demo: DemoPlayer | null = null;
  const demoRunning = () => demo?.isRunning() ?? false;
  const send = (msg: PluginMsg) => {
    if (demo && demo.isRunning()) {
      demo.handle(msg);
      return true;
    }
    return socket?.send(msg) ?? false;
  };
  const isOpen = () => demoRunning() || (socket?.isOpen() ?? false);
  const microphone = createMicrophoneController(sdk, { send, isOpen: () => socket?.isOpen() ?? false });

  function handleServiceMsg(msg: ServiceMsg): void {
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
  }

  async function startDemo(): Promise<void> {
    if (demoRunning()) return;
    const { default: recording } = await import('./demo-recording.json');
    if (everOpen || (socket?.isOpen() ?? false)) return; // the live link came up while the recording loaded
    demo ??= createDemoPlayer({ recording: recording as DemoRecording, deliver: (msg) => handleServiceMsg(msg) });
    console.log('[main] offline demo: playing the recorded Play demo run');
    phoneNote('UnderDog demo: playing a recorded run on the glasses (no service connected). Tap to accept the task.');
    demo.start();
  }

  // 3. Input and lifecycle
  const inputHandler = createInputHandler({
      send,
      isOpen,
      shutdown: (mode) => {
        sdk.shutDownPageContainer(mode).catch((err) => console.warn('[main] shutdown failed', err));
      },
      getAckId: () => ackId,
      isDisplayOff: () => queue.isAsleep(),
      setDisplayOff: (off) => {
        displayOffNote = off;
        if (off) {
          queue.sleep();
          showNote('UnderDog: glasses display is off. Tap the ring to turn it back on.');
        } else {
          queue.wake();
          showNote(currentNote);
        }
      },
      onForeground: () => socket?.reconnectNow(),
      onExit: () => {
        stopHeartbeat();
        stopLocation();
        demo?.stop();
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

  // 5. Socket, or the offline demo
  if (DEMO_PARAM === '1') void startDemo();
  const url = serviceUrl();
  console.log('[main] serial', serial, 'service', url);
  socket = connectService({
    url,
    onOpen: () => {
      everOpen = true;
      if (demo && demo.isRunning()) {
        // The live service wins; its hello reply rebuilds the whole page.
        demo.stop();
        phoneNote('UnderDog: keep this app open and in front while you wear the glasses.');
      }
      const hello: PluginMsg = rescuer ? { type: 'hello', serial, rescuer } : { type: 'hello', serial };
      socket?.send(hello);
    },
    onMessage: (raw) => {
      const msg = parseServiceMsg(raw);
      if (!msg) {
        console.warn('[main] bad message', raw.slice(0, 120));
        return;
      }
      handleServiceMsg(msg);
    },
    onClose: () => {
      // The only text the plugin writes by itself; every layout has text id 8 named status.
      void microphone.stop(false);
      if (!demoRunning()) queue.enqueue({ kind: 'text', id: STATUS_ID, content: LINK_LOST_TEXT });
    },
  });
  if (DEMO_PARAM !== '0') {
    setTimeout(() => {
      if (!everOpen && !(socket?.isOpen() ?? false)) void startDemo();
    }, OFFLINE_AFTER_MS);
  }

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
  phoneNote(`UnderDog failed to start: ${String(err)}`);
});
