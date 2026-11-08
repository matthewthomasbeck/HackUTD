# Glasses spec: Even Hub plugin, glasses service, and fallback view

Status: PROPOSED (2026-11-07), follows `docs/specs/CONTRACTS.md` version 8: no beacon mode (the robot never waits beside a survivor, so the glasses have no beacon target or beacon text) and no outcome recording.
Owner components: `frontend/glasses/` (plugin, fallback page, phone page) and `backend/glasses-service/`.
Read `docs/specs/CONTRACTS.md`, then the "Glasses view", "How no one is overlooked", and "Microphone and glasses" sections of `docs/PROJECT.md`, then `docs/AGENT_WORKFLOW.md`.
This spec follows CONTRACTS.md exactly; CONTRACTS.md wins where they differ.
Its earlier contract additions are merged into CONTRACTS.md version 8.
Plugin-to-service messages are ours on both ends, so build them behind the names given here; anything that needs a module reducer or table change waits for the module owner.

Backend: SpacetimeDB (CONTRACTS.md version 8).
The service talks to it only through the generated TypeScript bindings in `backend/spacetimedb-bindings/`, writes only through reducers, and gets live data from subscriptions.

Agents: the orchestrator, `comms_agent`, and `auditor` coordinate through the `agent_task` board (`docs/AGENT_WORKFLOW.md`).
The comms agent owns what the rescuer reads that needs judgment: briefings, navigation hints, acknowledgement nudges, and answers to voice questions, all written with `post_briefing`.
The glasses service never calls a model; it renders, counts, measures distance, and forwards input.
No agent commands motors, and nothing in this spec talks to the robot.

Tags used below:

- VERIFIED: checked on 2026-11-07 against the official docs, the SDK type file, an official template, or a live request.
- UNCONFIRMED: not stated by an official source, or not tested; the agent must test it and report.

## 1. What we build

```
phone (Even app WebView)                   laptop                                  SpacetimeDB
+----------------------+   WebSocket   +------------------------------+  SDK, one +-----------+
| glasses plugin       |<------------->| glasses service (Node.js)    |<--------->| module    |
|  render + input only |  /glasses     |  one session per rescuer     | connection| (tables,  |
|  + phone GPS, mic    |               |  view logic, map, arrows     | per       | reducers, |
+----------------------+               |  HTTP + WS on port 8787      | session   | schedules)|
        | BLE                          +------------------------------+           +-----------+
        v                                  ^ /view (mirror)   ^ /phone      | POST /transcribe
   G2 glasses (576x288)              fallback page (browser)  phone page    v
                                                                  perception service (speech to text)
```

- The plugin is a thin client.
  It creates the startup page, applies `page`, `text`, `image`, and `mic` messages, sends input, heartbeats, acknowledgements, the phone's position, and microphone audio.
  It holds no product logic.
- The service holds all logic.
  It opens one SpacetimeDB connection per glasses session with that rescuer's own identity, decides the view, renders map and arrow images, and pushes messages.
  Because the connection belongs to the session, the module's `client_disconnected` lifecycle reducer sees a dropped session, and after a 2 s disconnect grace the module releases that rescuer's assignments (CONTRACTS.md `participant`, `assignment`, and `heartbeat_timer`).
- Voice questions: the rescuer speaks into the G2 microphone, the service gets a transcript from the perception service and calls `rescuer_ask`, which posts an `answer_rescuer` task for the comms agent (section 5.15).
- The fallback page receives the exact same messages as the plugin and draws them on a 576x288 canvas in green.
  It is the projector view, the recording source, and the backup if the glasses fail.

## 2. Setup

### 2.1 Versions (VERIFIED on npm, 2026-11-07)

| Package | Version | Notes |
| --- | --- | --- |
| `@evenrealities/even_hub_sdk` | 0.0.16 | MIT. README requires Even App 2.2.10 or later and Node `^20.0.0 \|\| >=22.0.0`. |
| `@evenrealities/evenhub-cli` | 0.2.0 | Binary `evenhub` (alias `eh`). Engines: Node `^20.17.0 \|\| ^22.13.0 \|\| >=23.5.0`. |
| `@evenrealities/evenhub-simulator` | 0.9.5 | Binary `evenhub-simulator`. |
| `spacetimedb` | 2.14.1 | Official TypeScript client SDK (the old `@clockworklabs/spacetimedb-sdk` is deprecated). |
| `ws` | 8.22.1 | WebSocket server in the service. |
| `@napi-rs/canvas` | 1.1.0 | Canvas in Node.js with prebuilt binaries, for map and arrow PNGs. |

Use Node 22.13 or later on the laptop, because both the CLI and the SpacetimeDB Node quickstart accept it.

### 2.2 Developer mode on the phone (Cayden does this by hand)

1. Update the Even Realities app to 2.2.10 or later, and take any glasses firmware update it offers ([Hardware quickstart](https://hub.evenrealities.com/docs/get-started/quickstart/hardware); version floor from the SDK 0.0.16 README).
2. Sign in at https://hub.evenrealities.com with the same account as the phone app.
   There is no separate sign-up and no developer toggle ([Sign in](https://hub.evenrealities.com/docs/get-started/quickstart/sign-in)).
3. Force-quit and reopen the Even app.
   A developer section with "Scan QR" appears ([Hardware quickstart](https://hub.evenrealities.com/docs/get-started/quickstart/hardware)).
4. No Even Realities API key is needed.
   Agents must not sign in, sign up, or run `evenhub login`; only Cayden does account steps.

### 2.3 Network: phone and laptop on the same hotspot

- Use a phone hotspot or the team travel router, never venue Wi-Fi, because client isolation blocks phone-to-laptop traffic ([Local testing](https://hub.evenrealities.com/docs/test/local-testing)).
- The phone that runs the Even app can itself be the hotspot.
  If so, the laptop joins that phone's hotspot.
- Laptop IP on macOS: `ipconfig getifaddr en0`.
  Write it into `frontend/glasses/.env` as `VITE_GLASSES_WS_URL=ws://<ip>:8787/glasses` and into the `app.json` whitelist (section 3.7).
- macOS firewall: allow incoming connections for `node` (ports 5173 and 8787).
- Check from the phone's browser that `http://<ip>:5173` and `http://<ip>:8787/healthz` load before scanning any QR code.

### 2.4 Scaffold and install

The official templates are MIT licensed ([even-realities/evenhub-templates](https://github.com/even-realities/evenhub-templates), VERIFIED license), so starting from them is allowed.
Do not copy code from bluebook or tesla-even-g2 (no license).

```bash
# in the team repo root
npx degit even-realities/evenhub-templates/minimal frontend/glasses
cd frontend/glasses
npm install @evenrealities/even_hub_sdk@0.0.16
npm install -D @evenrealities/evenhub-cli@0.2.0 @evenrealities/evenhub-simulator@0.9.5 typescript vite vitest

# global binaries (optional; npx works too)
npm install -g @evenrealities/evenhub-cli@0.2.0 @evenrealities/evenhub-simulator@0.9.5

cd ../../backend/glasses-service
npm init -y
npm install spacetimedb@2.14.1 ws@8.22.1 @napi-rs/canvas@1.1.0 dotenv
npm install -D typescript tsx vitest @types/ws @types/node
```

### 2.5 Run (three terminals)

```bash
# 1. service
cd backend/glasses-service && npm run dev        # tsx watch src/index.ts, listens on 0.0.0.0:8787

# 2. plugin dev server (also serves fallback.html and phone.html)
cd frontend/glasses && npm run dev                # vite, 0.0.0.0:5173

# 3a. simulator, no glasses needed
evenhub-simulator --automation-port 9898 http://localhost:5173

# 3b. or real glasses: print the QR and scan it in the Even app developer section
evenhub qr --url "http://<laptop-ip>:5173"
```

- `evenhub qr --url ...` is documented in the official local testing page and the CLI README (VERIFIED).
  The CLI also accepts `--ip`, `--port`, `--external` (writes a PNG), and `--clear` (CLI 0.2.0 README, VERIFIED).
- `vite.config.ts` must set `server.host: true` and `server.hmr.host` to the laptop IP so hot reload does not try `localhost` on the phone ([Local testing](https://hub.evenrealities.com/docs/test/local-testing), VERIFIED).
- Keep the Even app open and in front on an unlocked phone.
  When it goes to the background, the WebView is suspended, the dev connection dies, and you may need to rescan ([Local testing](https://hub.evenrealities.com/docs/test/local-testing), VERIFIED).
- Simulator automation (VERIFIED, [Simulator](https://hub.evenrealities.com/docs/test/simulator)): `GET /api/ping`, `GET /api/screenshot/glasses` (576x288 RGBA PNG, lit pixels have alpha above 0), `POST /api/input` with body `{"action":"click"}` and actions `up`, `down`, `click`, `double_click`, `long_press`, `long_press_release`, `context_menu`.
  Input sent in the first few seconds, before the capture container exists, is dropped, so wait about 4 seconds.
- Backup path if the dev server cannot stay up: a private build (`npm run build`, `evenhub pack app.json dist -o rubble.ehpk`, then upload through the portal or `evenhub upload`).
  This needs Cayden's login and is not needed for the demo.

## 3. Plugin (`frontend/glasses/`)

### 3.1 Files

```
frontend/glasses/
  app.json                 # manifest, section 3.7
  index.html               # plugin entry (loaded by QR)
  fallback.html            # fallback view, section 6
  phone.html               # fallback GPS + action buttons, section 5.3
  vite.config.ts           # multi-page build: index, fallback, phone
  .env.example             # VITE_GLASSES_WS_URL=ws://192.168.1.10:8787/glasses
  src/
    main.ts                # plugin boot
    bridge.ts              # SDK wrapper: startup page, rebuild, text, image, shutdown
    queue.ts               # serialized, coalescing write queue
    socket.ts              # WebSocket with reconnect and backoff
    input.ts               # SDK events -> contract input messages
    location.ts            # SDK location -> position messages
    heartbeat.ts           # {"type":"heartbeat"} every 5 s while the socket is open
    mic.ts                 # audioControl on service command, PCM chunks -> audio messages
    protocol.ts            # message types (copy of the service's protocol.ts, keep identical)
    fallback/*.ts          # fallback page renderer
    phone/*.ts             # phone page
```

`vite.config.ts`: `server: { host: true, port: 5173, hmr: { host: process.env.LAN_IP } }`, `build: { target: 'esnext', rollupOptions: { input: { index: 'index.html', fallback: 'fallback.html', phone: 'phone.html' } } }`.

### 3.2 SDK calls used (all VERIFIED in `dist/index.d.ts` of 0.0.16 and the SDK README)

| Purpose | Call |
| --- | --- |
| Get the bridge | `const bridge = await waitForEvenAppBridge()` |
| First page, exactly once | `bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum, textObject, imageObject }))`, returns `StartUpPageCreateResult` (`success = 0`, `invalid = 1`, `oversize = 2`, `outOfMemory = 3`) |
| Every later layout | `bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum, textObject, imageObject }))`, returns `Promise<boolean>` |
| Text in place | `bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID, containerName, content, textColor? }))`, returns `Promise<boolean>` |
| Image | `bridge.updateImageRawData(new ImageRawDataUpdate({ containerID, containerName, imageData }))`, returns `ImageRawDataUpdateResult` (`'success'`, `'imageException'`, `'imageSizeInvalid'`, `'imageToGray4Failed'`, `'sendFailed'`) |
| Exit | `bridge.shutDownPageContainer(exitMode)`; `0` exits now, `1` lets the user confirm |
| Input and lifecycle | `bridge.onEvenHubEvent(cb)`, with `event.sysEvent` (`eventType`, `eventSource`) and `event.textEvent` (`eventType`) |
| Serial | `(await bridge.getDeviceInfo())?.sn` |
| Location | `bridge.startAppLocationUpdates({ accuracy: AppLocationAccuracy.High, intervalMs: 1000, distanceFilter: 1 })` and `bridge.onAppLocationChanged(loc => ...)`, where `loc` has `latitude`, `longitude`, `accuracy?`, `heading?`, `speed?`, `timestamp?` |
| Pre-check a layout | `validateEvenHubPageContainer(container)` returns `{ valid: true }` or an error you print with `formatEvenHubPageContainerValidationError` |
| Microphone on or off | `bridge.audioControl(isOpen, AudioInputSource.Glasses)` returns `Promise<boolean>`; `bridge.audioControl(false)` stops it |
| Microphone audio | `event.audioEvent` in `onEvenHubEvent`, with `audioPcm` (`Uint8Array`), `source`, `direction` (number or null), `speakerRole` (`self`, `other`, `unknown`) |

Microphone facts (VERIFIED on 2026-11-07 in `dist/index.d.ts` and the README of SDK 0.0.16, and on [Device APIs](https://hub.evenrealities.com/docs/build/device-apis)):

- Audio is "PCM 16 kHz, signed 16-bit little-endian, mono", delivered as `Uint8Array` chunks in `audioEvent.audioPcm`.
- The glasses source requires `createStartUpPageContainer` to have run first; the phone source (`AudioInputSource.Phone`) does not.
- Permissions in `app.json`: `g2-microphone` for the glasses source, `phone-microphone` for the phone source.
- The SDK has no audio output, so the glasses can never play a sound.
- UNCONFIRMED: chunk size and rate, whether the simulator delivers any audio, and whether the host sends `audioPcm` as a number array or base64 (the SDK's `AudioEvent.fromJson` handles both, per its type comments).

Container property fields (VERIFIED): `xPosition`, `yPosition`, `width`, `height`, `containerID`, `containerName`, `zOrderIndex`, `isEventCapture` (0 or 1), and for text also `content`, `textColor` (0 to 4), `borderWidth` (0 to 5), `borderColor`, `borderRadius` (0 to 10), `paddingLength` (0 to 32).
Image containers take width 20 to 288 and height 20 to 144, and cannot capture input.

`imageData` must be encoded image bytes (PNG), passed as a `Uint8Array`.
The SDK decodes, resizes, and converts to 4-bit greyscale itself (VERIFIED in the official `image` template's `renderer.ts`).
So the plugin only base64-decodes `png_b64` into a `Uint8Array`.

### 3.3 Boot sequence

1. `const bridge = await waitForEvenAppBridge()`.
2. Create the startup page once with two text containers and nothing else:
   - id 1 `capture`: x 0, y 0, w 576, h 288, z 1, content `' '`, `isEventCapture: 1`, `borderWidth: 0`, `paddingLength: 0`.
   - id 8 `status`: x 8, y 130, w 560, h 56, z 2, content `RUBBLE SEARCH\nconnecting...`, `textColor: 3`.
   If the result is not `StartUpPageCreateResult.success`, log it, wait 500 ms, and try once more.
3. Register `bridge.onEvenHubEvent` (section 3.5).
4. Read the serial with `getDeviceInfo()`; use `"sim"` if it is null (the simulator hardcodes profiles).
5. Open the WebSocket to `import.meta.env.VITE_GLASSES_WS_URL` (section 3.6).
   On open, send `{"type":"hello","serial":"<sn>","rescuer":"<from ?rescuer= in location.search, optional>"}`.
6. Start location updates (section 5.1).
   If `startAppLocationUpdates` returns false or throws, keep going without position.
7. Start the heartbeat timer: while the socket is open, send `{"type":"heartbeat"}` every 5 s (CONTRACTS.md glasses protocol).
   The service forwards each one as `rescuer_heartbeat`.
8. Do not open the microphone at boot; it opens only on a service `mic` message (section 3.9).
9. Draw a short plain HTML note in `#app` for the phone screen ("Keep this app open").

### 3.4 Write queue (one, serialized, coalescing per container)

All SDK display calls go through one queue in `queue.ts`, because image sends must not overlap and order matters ([Display](https://hub.evenrealities.com/docs/build/display), VERIFIED).

```ts
type Op =
  | { kind: 'page'; msg: PageMsg }
  | { kind: 'text'; id: number; content: string; textColor?: number }
  | { kind: 'image'; id: number; bytes: Uint8Array };

const pending = new Map<string, Op>();   // insertion order = execution order
// key: 'page' | `text:${id}` | `image:${id}`

function enqueue(op: Op) {
  if (op.kind === 'page') { pending.clear(); pending.set('page', op); }   // a new layout makes old writes useless
  else pending.set(`${op.kind}:${op.id}`, op);                            // same key: newest payload wins, keeps its slot
  kick();
}
```

- One async worker takes the first entry, deletes it from the map, runs it, and awaits it before taking the next.
- A `page` op maps the containers (section 3.8) and calls `rebuildPageContainer`.
  After it succeeds, store `currentIds: Map<id, {name, kind}>`.
  If it returns false, log `validateEvenHubPageContainer` output and retry once after 300 ms.
- A `text` or `image` op whose id is not in `currentIds`, or has the wrong kind, is dropped with a console warning.
- A `text` op whose content equals the last applied content for that id is skipped.
- Image ops wait until at least 110 ms have passed since the previous image send started.
  The SDK already holds sends for 100 ms (SDK 0.0.14+), and this keeps us clear of it.
- If `updateImageRawData` returns anything but `'success'`, log it and do not retry; the service resends on the next change.
- A failed call never stops the worker; catch, log, continue.

### 3.5 Input mapping

`input.ts` follows the official template's event rules (VERIFIED in `evenhub-templates/minimal/src/main.ts`):

- `CLICK_EVENT` is 0 and is dropped on the wire, so an envelope with no `eventType` is a click.
  Resolve that default inside each envelope, never as `event.sysEvent?.eventType ?? CLICK`.
- Taps, double taps, long presses, and lifecycle events come in `event.sysEvent`; scrolls come in `event.textEvent`.
- Check double tap before tap.

| SDK event | Envelope | Contract `event` |
| --- | --- | --- |
| `DOUBLE_CLICK_EVENT` (3) | sys or text | `double_tap`, then exit (below) |
| `CLICK_EVENT` (0 or missing) | sys or text | `tap` |
| `SCROLL_TOP_EVENT` (1) | text | `scroll_up` |
| `SCROLL_BOTTOM_EVENT` (2) | text | `scroll_down` |
| `LONG_PRESS_EVENT` (9) | sys | `long_press` |
| `LONG_PRESS_RELEASE_EVENT` (10) | sys | ignored |
| `FOREGROUND_ENTER_EVENT` (4) | sys | not sent; reconnect now if the socket is closed |
| `SYSTEM_EXIT_EVENT` (7), `ABNORMAL_EXIT_EVENT` (6) | sys | not sent; close the socket cleanly and unsubscribe |

Source: `eventSource` on `sysEvent`: `TOUCH_EVENT_FROM_GLASSES_R` (1) is `right`, `TOUCH_EVENT_FROM_RING` (2) is `ring`, `TOUCH_EVENT_FROM_GLASSES_L` (3) is `left`.
`textEvent` has no source field, and `sysEvent` may omit it.
Send `unknown` when the source is missing (CONTRACTS.md version 8).

Message: `{"type":"input","source":"ring","event":"tap"}`.
Drop an identical event that repeats within 150 ms.

Acknowledge prompt: while the current `page` carries `ack_assignment_id` (section 3.8, CONTRACTS.md glasses protocol), a tap sends `{"type":"ack","assignment_id":<id>}` instead of the `input` message.
The plugin does not decide anything here; it only swaps the message type for the id the service gave it, and clears the id on the next `page`.
The contract says "ring tap"; the plugin sends `ack` for a tap from any source (ring, temple, or `unknown`), because the simulator and some envelopes carry no source, and the service logs the source.

Double tap must always exit, whatever the view, as the store rules and the template require ([App submission](https://hub.evenrealities.com/docs/ship/app-submission)):
send the `double_tap` input if the socket is open, then call `bridge.shutDownPageContainer(1)` (the user confirms on the glasses).
A service `{"type":"exit"}` message calls `bridge.shutDownPageContainer(0)`.
Never put a product action on double tap.
Long press is not guaranteed because the OS may use it for its menu ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)), so every long-press action also has a scroll gesture.

Display off (Cayden, 2026-11-08): a tap, then a long press within 1.5 s (`DISPLAY_OFF_WINDOW_MS` in `src/plugin/input.ts`), blanks the glasses while the app, the socket, and GPS keep running.
The SDK has no screen-off call, so the plugin rebuilds a page with only the blank capture layer (`BLANK_PAGE` in `src/plugin/bridge.ts`), which the G2 shows as nothing.
That long press is not sent, so it does not start a voice question; the tap before it is handled as a normal tap (it still accepts a task on the ack view).
While the display is off, the write queue keeps the latest page and every text and image written since, and draws nothing.
The next tap, long press, or scroll only turns the display back on and redraws that view; it is not sent and never accepts a task.
Double tap still exits.
The service does not know the display is off; this is plugin-only.

### 3.6 WebSocket and reconnect

- Backoff: 500 ms, 1 s, 2 s, 4 s, 8 s, then 10 s forever, each plus 0 to 250 ms random jitter.
  Reset to 500 ms after a connection stays open for 10 s.
- On `FOREGROUND_ENTER_EVENT` or `document.visibilitychange` to visible, reconnect at once.
- Liveness: the service sends at least one message every 5 s (the status line).
  If nothing arrives for 15 s, close and reconnect.
- On close, the plugin writes `LINK LOST - retrying` to text id 8 through the queue, and closes the microphone if it is open.
  This is the only text the plugin writes by itself, and it relies on the rule that every layout has text id 8 named `status` (CONTRACTS.md).
- A closed socket ends the session's SpacetimeDB connection on the service side (section 5.4), which releases the rescuer's assignments after the module's 2 s disconnect grace.
  The rescuer sees that on reconnect as the "assignment released" view (section 4.8), so a long phone lock never leaves a survivor silently held.
- On every (re)connect the plugin sends `hello`; the service answers with a full `page`, every text, and every image, so the plugin keeps no state across connections.
- Unknown message types are ignored with a console warning.

### 3.7 `app.json`

Fields VERIFIED against [Packaging](https://hub.evenrealities.com/docs/ship/packaging) and [Networking](https://hub.evenrealities.com/docs/build/networking).

```json
{
  "package_id": "com.hackutd.rubblesearch",
  "edition": "202601",
  "name": "Rubble Search",
  "version": "0.1.0",
  "min_sdk_version": "0.0.16",
  "entrypoint": "index.html",
  "permissions": [
    {
      "name": "network",
      "desc": "Connects to the team's glasses service on the local network to get the rescue view.",
      "whitelist": ["http://172.20.10.2:8787", "ws://172.20.10.2:8787"]
    },
    {
      "name": "location",
      "desc": "Sends the rescuer's position so the view can show distance and direction to survivors."
    },
    {
      "name": "g2-microphone",
      "desc": "Records a short spoken question only while the rescuer asks one, so the coordinator team can answer it."
    }
  ],
  "supported_languages": ["en"]
}
```

- The permission name `g2-microphone` comes from [Device APIs](https://hub.evenrealities.com/docs/build/device-apis) (VERIFIED); the exact `permissions` entry shape follows [Packaging](https://hub.evenrealities.com/docs/ship/packaging).
  UNCONFIRMED: whether a QR dev session enforces permissions at all.
- Replace `172.20.10.2` with the laptop's hotspot IP.
  Whitelist entries are full origins with no wildcards, and a whitelist change needs a repack (VERIFIED).
- UNCONFIRMED: whether `ws://` origins belong in the whitelist or only `http://`, whether a LAN IP is accepted in a packed build, and whether a QR dev session enforces the whitelist at all.
  Keep both entries; test on the phone.
- The whitelist does not bypass CORS (VERIFIED), so every HTTP endpoint of the service returns `Access-Control-Allow-Origin: *`.
- The public store would likely reject this app (emergency routing is banned), which does not matter for QR or private builds.

### 3.8 Mapping a `page` message to SDK objects

The service sends containers in the schema below (CONTRACTS.md version 8 leaves the schema to this spec).
The plugin maps fields one to one and builds `CreateStartUpPageContainer`-shaped objects for `rebuildPageContainer`.
A `page` may also carry `"ack_assignment_id": <u64>` (only in the `ack` layout, CONTRACTS.md glasses protocol); the plugin keeps it until the next `page`.

```json
{
  "type": "page",
  "layout": "map",
  "containers": [
    {"kind":"text","id":1,"name":"capture","x":0,"y":0,"w":576,"h":288,"z":1,"content":" ","capture":true},
    {"kind":"image","id":2,"name":"map_top","x":0,"y":0,"w":288,"h":144,"z":2},
    {"kind":"text","id":4,"name":"count","x":296,"y":0,"w":280,"h":56,"z":4,"content":"2 CRITICAL\nwithin 0.3 mi","text_color":4,"padding":2}
  ]
}
```

| Message field | SDK field |
| --- | --- |
| `id` | `containerID` |
| `name` | `containerName` |
| `x`, `y`, `w`, `h` | `xPosition`, `yPosition`, `width`, `height` |
| `z` | `zOrderIndex` (the service always sets it on every container, unique per page) |
| `capture` | `isEventCapture: 1` if true, else `0` (text only) |
| `content` | `content` |
| `text_color` | `textColor` |
| `border_width`, `border_color`, `border_radius`, `padding` | `borderWidth`, `borderColor`, `borderRadius`, `paddingLength` (default 0) |

`containerTotalNum` is the container count.
Run `validateEvenHubPageContainer` before the call and log failures.

### 3.9 Microphone (`mic.ts`)

The microphone is for one thing: a rescuer's spoken question to the comms agent.
It is off by default and opens only when the service says so, so the plugin keeps no logic about when to listen.

- Service to plugin: `{"type":"mic","on":true,"max_s":8}` or `{"type":"mic","on":false}` (CONTRACTS.md version 8 leaves the microphone messages to this spec).
- On `on: true`: call `bridge.audioControl(true, AudioInputSource.Glasses)`.
  If it returns false or throws, call it once with `AudioInputSource.Phone` (needs the `phone-microphone` permission), and if that also fails send `{"type":"audio_error","detail":"..."}`.
- While open, every `event.audioEvent` becomes `{"type":"audio","seq":n,"pcm_b64":"<base64 of audioPcm>","source":"glasses"|"phone"}`, in order, with `seq` counting from 0 for each question.
- On `on: false`, after `max_s` seconds (the plugin's own safety stop), on socket close, or on `SYSTEM_EXIT_EVENT`: call `bridge.audioControl(false)` and send `{"type":"audio_end","seq":<last>}`.
- Audio messages bypass the display queue; they go straight to the socket.
  At 16 kHz, 16-bit mono, 8 s is 256 KB of PCM, about 342 KB as base64, which is fine on the local hotspot.
- The plugin never stores audio.

## 4. Screen layouts (576x288 display pixels)

### 4.1 Rules every layout follows

- At most 4 image and 8 text containers, at most 12 in total, exactly one capture container (VERIFIED limits).
- Text id 1 is always the full-screen capture layer with content `' '`, z 1, behind everything (the official image template uses the same pattern, because image containers cannot capture input).
- Text id 8 is always `status`.
- Image containers are at most 288x144.
- Text and images do not overlap (except the empty capture layer), because it is unknown whether black image pixels hide text under them.
- The firmware font is about 27 px per line, has one size, and drops glyphs it does not have ([Display](https://hub.evenrealities.com/docs/build/display)).
  Budget 13 px per character, so 280 px holds about 21 characters and 576 px about 44.
  UNCONFIRMED until checked on real glasses; adjust the `CHARS_PER_PX` constant in one place.
- All text is printable ASCII.
  The service passes every string through `toAscii()`, which maps common symbols (`°` to ` deg`, `·` to `-`, `©` to `(c)`, dashes to `-`) and deletes anything else.
- Text brightness: 4 for main lines, 3 for details, 2 for status, 1 for attribution.
- The service runs `validateLayout()` before sending any page and in unit tests: counts, sizes, bounds inside 576x288, unique ids and z, one capture, ASCII only, content at most 1,000 characters on a page and 2,000 on an update.

### 4.2 Map view (target more than 60 m away, or after a tap)

| id | kind | name | x | y | w | h | z | Example content |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | text | capture | 0 | 0 | 576 | 288 | 1 | `' '` |
| 2 | image | map_top | 0 | 0 | 288 | 144 | 2 | map rows 0-143 |
| 3 | image | map_bot | 0 | 144 | 288 | 144 | 3 | map rows 144-287 |
| 4 | text | count | 296 | 0 | 280 | 56 | 4 | `2 CRITICAL`<br>`within 0.3 mi` |
| 5 | text | target | 296 | 58 | 280 | 56 | 5 | `NEXT: house 3`<br>`340 m NE` |
| 6 | text | brief | 296 | 116 | 280 | 112 | 6 | `IMMEDIATE house 3:`<br>`breathing 14/min,`<br>`8 m in, front door` (up to 4 lines, about 84 chars) |
| 8 | text | status | 296 | 232 | 280 | 28 | 7 | `tap: back  upd 2s` |
| 7 | text | attrib | 296 | 260 | 280 | 28 | 8 | `(c) Esri, OSM` |

8 containers: 6 text, 2 image.

### 4.3 Arrow view (target closer than 40 m, until it is farther than 60 m)

| id | kind | name | x | y | w | h | z | Example content |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | text | capture | 0 | 0 | 576 | 288 | 1 | `' '` |
| 2 | image | arrow | 16 | 40 | 144 | 144 | 2 | one of 8 arrows |
| 4 | text | primary | 184 | 8 | 384 | 56 | 3 | `NE  32 m`<br>`house 3 - CRITICAL` |
| 5 | text | detail | 184 | 72 | 384 | 84 | 4 | `8 m in from front door`<br>`breathing 14/min`<br>`conf 0.7` |
| 6 | text | brief | 184 | 164 | 384 | 56 | 5 | `> Enter by front door,`<br>`ground ahead: debris` |
| 8 | text | status | 8 | 232 | 560 | 28 | 6 | `2 CRITICAL in area - arrow is N-up - upd 1s` |

Robot target example for id 4 (after `scroll_up`): `ROBOT dog1  NE 18 m` / `scroll up: back to survivor`.

### 4.4 Arrived view (5 m or less from the target)

| id | kind | name | x | y | w | h | z | Example content |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | text | capture | 0 | 0 | 576 | 288 | 1 | `' '` |
| 4 | text | head | 8 | 0 | 560 | 56 | 2 | `ARRIVED - house 3`<br>`CRITICAL score 86 (conf 0.7)` |
| 5 | text | where | 8 | 60 | 560 | 56 | 3 | `Where: 8 m in from the front door,`<br>`under boxes` |
| 6 | text | life | 8 | 120 | 560 | 56 | 4 | `Breathing 14/min (conf 0.7)`<br>`About 20% of body visible` |
| 7 | text | brief | 8 | 180 | 560 | 48 | 5 | `Coordinator: 2nd rescuer 3 min out` |
| 8 | text | status | 8 | 232 | 560 | 28 | 6 | `tap: mark reached - confirm on phone` |

When `breathing` is `not_detected`, id 6 reads `No signs of life detected,` / `low confidence - keep checking`.
When it is `unknown`, id 6 reads `Breathing not checked yet`.
No string anywhere may say dead, deceased, or expectant (CONTRACTS.md rule).
After `mark_reached` succeeds, id 8 reads `REACHED - resolve on phone`.
Resolving (`resolve_survivor` with `rescued`, `handed_off`, `false_alarm`, or `duplicate`) is only on the phone page, because a tap is too easy to make by mistake.

### 4.5 Idle view (no active assignment)

| id | kind | name | x | y | w | h | z | Example content |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | text | capture | 0 | 0 | 576 | 288 | 1 | `' '` |
| 2 | image | map_top | 0 | 0 | 288 | 144 | 2 | same map |
| 3 | image | map_bot | 0 | 144 | 288 | 144 | 3 | same map |
| 4 | text | head | 296 | 0 | 280 | 56 | 4 | `NO ASSIGNMENT`<br>`stand by` |
| 5 | text | count | 296 | 58 | 280 | 84 | 5 | `2 CRITICAL`<br>`3 unassigned`<br>`within 0.3 mi` |
| 6 | text | brief | 296 | 144 | 280 | 84 | 6 | latest briefing, 3 lines |
| 8 | text | status | 296 | 232 | 280 | 28 | 7 | `hold:ask  scroll:next` (21 characters, one line) |
| 7 | text | attrib | 296 | 260 | 280 | 28 | 8 | `(c) Esri, OSM` |

When the user scrolls to browse a survivor, the service switches to the map or arrow view for that survivor, and id 8 reads `VIEW ONLY 2/4 - not assigned`.

### 4.6 Status line content (id 8)

Priority order, first match wins:
`DB OFFLINE - data 40s old`, `NO GPS FIX`, `ROBOT OFFLINE`, `ASKING - speak now 6s` (while the microphone is open), then the view's hint plus `upd Ns` (seconds since the newest change to the target or own position).
The service resends id 8 every 5 s, which doubles as the service-to-plugin keepalive.

### 4.7 Acknowledge view (a `proposed` assignment for this rescuer)

Shown whenever this rescuer has an assignment with status `proposed`, over any other view except `released`.
The `page` carries `ack_assignment_id`, so a tap becomes `ack` (section 3.5).

| id | kind | name | x | y | w | h | z | Example content |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | text | capture | 0 | 0 | 576 | 288 | 1 | `' '` |
| 2 | image | arrow | 16 | 40 | 144 | 144 | 2 | arrow toward the survivor |
| 4 | text | head | 184 | 0 | 384 | 56 | 3 | `NEW TASK - IMMEDIATE`<br>`house 3, 120 m NE` |
| 5 | text | detail | 184 | 60 | 384 | 84 | 4 | `breathing 34/min (conf 0.7)`<br>`8 m in from front door` |
| 6 | text | brief | 184 | 148 | 384 | 80 | 5 | comms agent briefing or nudge, 2 to 3 lines |
| 8 | text | status | 8 | 232 | 560 | 28 | 6 | `TAP TO ACCEPT - 24s left` |

- The countdown is `lease_expires_at - now` of the proposed row (the module's `lease_timer` releases it at zero, CONTRACTS.md `assignment`).
- Only `accept_assignment` makes the assignment count; until then the arrow is a preview, and the view says so in id 8.
- Declining: the phone page has `Decline`, which calls `release_assignment`; there is no decline gesture on the lens.
- A nudge from the comms agent (a briefing of kind `nudge` for this rescuer about the survivor) replaces id 6.
- After `accept_assignment` succeeds, id 8 shows `ACCEPTED` for 2 s and the normal view selection takes over.
- If the reducer rejects (lease already expired), id 8 shows `TOO LATE - task released` and the view goes to idle.

### 4.8 Assignment released view

Shown for 10 s (or until a tap) when an assignment of this rescuer leaves `proposed` or `active` for `released`.

| id | kind | name | x | y | w | h | z | Example content |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | text | capture | 0 | 0 | 576 | 288 | 1 | `' '` |
| 4 | text | head | 8 | 0 | 560 | 56 | 2 | `ASSIGNMENT RELEASED`<br>`house 3 - IMMEDIATE` |
| 5 | text | why | 8 | 60 | 560 | 84 | 3 | `Link to glasses was lost.`<br>`Survivor is back on the board for`<br>`the next rescuer.` |
| 6 | text | next | 8 | 148 | 560 | 80 | 4 | `If you are still going, tell the`<br>`coordinator.` |
| 8 | text | status | 8 | 232 | 560 | 28 | 5 | `tap: ok` |

The service picks the text from the row's `release_cause` (CONTRACTS.md `assignment`):

| `release_cause` | id 5 text |
| --- | --- |
| `disconnected` | `Link to glasses was lost.` |
| `heartbeat` | `Glasses heartbeat stopped.` |
| `declined` | `You released it.` |
| `expired` on a `proposed` row | `Not accepted in time.` |
| `expired` on an `active` row, `reassigned`, or missing | `Lease expired or a coordinator reassigned it.` |

The second and third lines are always the same, so the rescuer knows the survivor was not dropped.

### 4.9 Ask view (rescuer voice question)

| id | kind | name | x | y | w | h | z | Example content |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | text | capture | 0 | 0 | 576 | 288 | 1 | `' '` |
| 4 | text | head | 8 | 0 | 560 | 56 | 2 | `ASK - speak now`<br>`tap to send` |
| 5 | text | heard | 8 | 60 | 560 | 84 | 3 | `You: "is anyone else in house 3"` |
| 6 | text | answer | 8 | 148 | 560 | 80 | 4 | `Answer: 1 more reported missing,`<br>`unit 3B, not found yet.` |
| 8 | text | status | 8 | 232 | 560 | 28 | 5 | `ASKING - speak now 6s` |

States, in order: `listening` (microphone open), `transcribing`, `sent - waiting for answer` (task posted), `answered` (the answer briefing arrived), or `no answer yet - see dashboard` after 30 s.
The answer stays visible for 20 s, then the previous view returns; the answer also stays in the normal `brief` line as the newest briefing.

## 5. Glasses service (`backend/glasses-service/`)

### 5.1 How the rescuer's position reaches SpacetimeDB

`participant_update_position(lat, lon)` uses the caller's identity and renews the caller's assignment leases, so the call must be made with the rescuer's own identity.
The service therefore holds one SpacetimeDB connection per rescuer, with that rescuer's saved token.

Position sources, by priority:

1. Demo mode (`site.demo_mode == true`): the service's own demo walker (section 5.9).
   Phone fixes are shown in logs but ignored, because the venue is indoors.
2. Plugin: the plugin calls the SDK location API (section 3.2) and sends `{"type":"position","lat":..,"lon":..,"accuracy_m":..}` at most once a second (CONTRACTS.md glasses protocol).
   The plugin needs the `location` permission in `app.json`.
   UNCONFIRMED: whether the simulator returns any location; the plugin must tolerate none.
3. Phone page fallback (`phone.html?rescuer=<name>`): browser `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`, posting to the service's `/phone` WebSocket.
   Browsers allow geolocation only in a secure context, so a page on `http://<LAN-IP>` gets no position.
   Serve it with `@vitejs/plugin-basic-ssl` in a second Vite mode on port 5174 (`vite --mode phone`), proxy `/phone` to the service with `server.proxy: { '/phone': { target: 'ws://localhost:8787', ws: true } }`, and accept the self-signed certificate warning once on the phone.
   UNCONFIRMED until tried on the actual phone.

Filtering (real GPS only): drop fixes with `accuracy_m > 30`, keep the median of the last 3 fixes, and mark `NO GPS FIX` if no good fix arrived for 15 s (keep the last position).

Sending to SpacetimeDB: call `participantUpdatePosition` when the position moved more than 2 m, at most every 2 s, and at least every 5 s even when still.
Lease renewal does not depend on position: the plugin's `heartbeat` every 5 s is forwarded as `rescuerHeartbeat()` (section 5.4), so a rescuer standing still indoors with no GPS keeps the assignment.

### 5.2 Files

```
backend/glasses-service/
  package.json             # scripts: dev (tsx watch), start, test (vitest), tiles
  .env.example             # see 5.3
  rescuers.json            # {"default":"alex","by_serial":{"<sn>":"alex"}}
  .tokens/                 # git-ignored, one SpacetimeDB token per rescuer
  tiles/                   # git-ignored tile cache
  src/
    index.ts               # boot: config, db, arrows, http + ws
    config.ts
    protocol.ts            # message types, shared with the plugin
    db.ts                  # SpacetimeDB connections, cache, reducer calls
    session.ts             # one per rescuer: state, view model, diff, fan-out
    select.ts              # target and view selection (pure functions)
    geo.ts                 # haversine, bearing, octant, mercator
    layouts.ts             # the seven layouts (map, arrow, arrived, idle, ack, released, ask) + validateLayout + toAscii
    ask.ts                 # voice question: PCM buffer -> WAV -> /media + /transcribe -> rescuer_ask
    wav.ts                 # 44-byte WAV header for 16 kHz s16le mono PCM
    render/arrows.ts       # 8 arrow PNGs, rendered once
    render/map.ts          # base map + markers -> two PNGs
    tiles/source.ts        # tile source configs
    tiles/cache.ts         # disk cache, fetch on miss
    tiles/prefetch.ts      # npm run tiles
    demo.ts                # demo walker
    http.ts                # /healthz, /phone actions, CORS
  test/*.test.ts
```

### 5.3 Environment (`.env.example`)

```
PORT=8787
STDB_URI=https://maincloud.spacetimedb.com           # or ws://localhost:3000 for the local fallback server
STDB_DATABASE=<database name from the module spec>
TILE_SOURCE=esri-dark                                # esri-dark | carto-dark | osm-inverted | none
CARTO_KEY=                                           # only for carto-dark
PERCEPTION_URL=http://localhost:8080                 # media server and speech to text (perception.md)
ASK_MAX_S=8                                          # longest voice question
PRIMARY_GRACE_MS=0                                   # delay before closing the DB connection after the plugin socket closes
DEMO_SPEED_MPS=6
DEMO_START_BEARING_DEG=158
DEMO_START_DISTANCE_M=92
```

### 5.4 SpacetimeDB client

API names VERIFIED against the [TypeScript SDK reference](https://spacetimedb.com/docs/clients/typescript); generated names follow the module, so check `backend/spacetimedb-bindings/` for exact camelCase spellings.

```ts
import { DbConnection, tables } from '../../spacetimedb-bindings';

const conn = DbConnection.builder()
  .withUri(env.STDB_URI)
  .withDatabaseName(env.STDB_DATABASE)
  .withToken(readToken(rescuer))            // undefined on first run
  .onConnect((c, identity, token) => { saveToken(rescuer, token); session.identityHex = identity.toHexString(); subscribe(c); })
  .onDisconnect((ctx, err) => scheduleReconnect())
  .onConnectError((ctx, err) => scheduleReconnect())
  .build();

function subscribe(c: DbConnection, me: string /* identity hex */) {
  c.subscriptionBuilder()
    .onApplied(() => session.markDirty())
    .subscribe(visibilityQueries(me));      // section 5.4.1
}
// row callbacks: c.db.survivor.onInsert((ctx,row)=>...), onUpdate((ctx,old,row)=>...), onDelete(...); all call session.markDirty()
// reducers: await c.reducers.participantUpdatePosition({ lat, lon }); a failure rejects with SenderError
```

Connection rules:

- One connection per glasses session, with that rescuer's own saved token, so every reducer call (`participant_update_position`, `rescuer_heartbeat`, `accept_assignment`, `release_assignment`, `start_en_route`, `mark_reached`, `resolve_survivor`, `rescuer_ask`) runs as the rescuer, and the module checks the `rescuer` role itself.
- After connecting, if no `participant` row has this identity, call `registerParticipant({ name: rescuer, role: 'rescuer' })` (rescuers need no prior `grant_role`, CONTRACTS.md reducer table).
- Open the connection when the session's first primary socket connects (the plugin on `/glasses`, or a fallback page opened with `&primary=1` for a demo without glasses).
  Close it with `conn.disconnect()` as soon as the last primary socket closes (after `PRIMARY_GRACE_MS`, default 0), so the module releases the rescuer's assignments after its 2 s disconnect grace (CONTRACTS.md `heartbeat_timer`).
  Mirror-only fallback pages (`/view` without `primary=1`) never keep the connection open, so a forgotten projector tab cannot hold an assignment.
- Heartbeat: forward every plugin `heartbeat` as `rescuerHeartbeat()`, at most one call per 4 s per session.
  Forward only while the primary socket is open, and never invent heartbeats in the service, because the module's `heartbeat_timer` (15 s) is the check that the glasses are really there.
  In demo mode with only a primary fallback page, the page sends the same `heartbeat` message every 5 s.
- Acknowledge: an `ack` message calls `acceptAssignment({ assignmentId })` only if that id is this rescuer's `proposed` assignment in the cache; otherwise drop it with a log line.
- If the module rejects a reducer, show the `SenderError` text (ASCII, cut to fit) in id 8 for 5 s; never retry a rejection.
- If the connection drops by itself (network), reconnect with the same backoff as the plugin (500 ms up to 10 s), keep showing the cached view with `DB OFFLINE - data Ns old`, and expect any assignment to have been released after the 2 s disconnect grace; the released view (4.8) explains it.
- Track `lastDbMessageAt` for the status line.
- One connection per active rescuer is fine for the demo (one to three rescuers); the simulator's many rescuers use their own connections in `backend/sim/`, not this service.

#### 5.4.1 What each session sees (visibility)

CONTRACTS.md version 8: each glasses session sees only its own rows through the views `my_assignment`, `my_briefing`, `my_survivor`, and `critical_open`; if a view fails, the service subscribes to the base tables with string filters and filters in its own code.

What the module supports (VERIFIED 2026-11-07 on [Row Level Security](https://spacetimedb.com/docs/how-to/rls)): TypeScript modules can declare `spacetimedb.clientVisibilityFilter.sql('SELECT * FROM t WHERE t.col = :sender')`, but the docs call it "an experimental, unstable feature" and recommend views instead; views can filter by the caller's identity.
The SDK 2.14.1 server typings contain both `clientVisibilityFilter` and view contexts (checked in the npm package).
So the module uses sender-filtered views, not row-level security; this service uses them and falls back to client-side filtering if a view fails.

| Data | With module views (preferred) | Fallback (no views yet) |
| --- | --- | --- |
| Own assignments | view `my_assignment` (rows where `rescuer_identity = sender`) | subscribe to `assignment`, keep only rows whose `rescuer_identity` equals this identity |
| Own briefings | view `my_briefing` (`audience` is `all` or the sender's identity hex) | `SELECT * FROM briefing WHERE audience = 'all'` and `SELECT * FROM briefing WHERE audience = '<own hex>'` (string filters work, per `spacetimedb.md` section 11) |
| Own proposed and active survivors | view `my_survivor` | `survivor` rows whose id is in the own assignments |
| Critical count | view `critical_open` (rows of `immediate` survivors that are not `resolved`; the service counts rows and derives the unassigned ones among them) | computed from `survivor` |
| Survivors for the map, arrow, and browse | `survivor` (public board table; holds no personal data) | same |
| Robot and site | `robot`, `site` | same |
| Own participant row | `participant` filtered to own identity in the service | same |

- Base tables stay public for the dashboard and the agents (CONTRACTS.md version 8 views), so the service reads `survivor`, `robot`, and `site` for the map and browse.
- Other rescuers' positions and assignments are not shown on the glasses, so the map has no "other rescuers" markers (section 5.11).
- In the fallback, other rescuers' rows still reach the laptop service; they never reach the glasses or the fallback page.

#### 5.4.2 Briefings from the comms agent

The comms agent writes every briefing this service shows, except module-written escalations, with `post_briefing(audience, text, priority, survivor_id, kind)`.
`audience` is `all`, `coordinators`, `commander`, or a rescuer's identity hex (CONTRACTS.md `briefing`; the service compares with `identity.toHexString()`, 64 hex characters without `0x`).

| `kind` | What it is | How the service shows it |
| --- | --- | --- |
| `briefing` | briefing for an assignment (`brief_rescuer` task from the orchestrator) | `brief` line in every view; first lines of the arrived view's id 7 |
| `nav` | navigation hint ("enter by the back door, front is blocked") | `brief` line with prefix `> ` when `survivor_id` equals the current target |
| `nudge` | acknowledgement nudge while a proposal waits | id 6 of the acknowledge view (4.7) |
| `answer` | answer to a voice question | id 6 of the ask view (4.9), then the `brief` line |
| `escalation` | module-written escalation (section 5.12) | `brief` line |

A briefing with no `kind` is shown as `briefing`.
If the comms agent is down, the module and the service still work: escalations still arrive, the acknowledge view still shows the survivor from its own rows, and the `brief` line stays empty.

### 5.5 Sessions and fan-out

- A session is keyed by rescuer name.
  `hello` picks the rescuer: `hello.rescuer` if given and listed in `rescuers.json`, else `by_serial[serial]`, else `default`.
- Each session has a set of sockets: the plugin on `/glasses` and any fallback pages on `/view?rescuer=<name>`.
  Every outgoing message goes to all of them, so the fallback page mirrors the glasses exactly.
- Inputs, `ack`, and `heartbeat` from either socket type are handled the same way; `heartbeat` counts only from a primary socket (section 5.4).
- `mic` messages go only to the plugin socket; a fallback page asks with the phone page's microphone path instead (section 5.15).
- Recompute when dirty: DB change, position change, input, or the 5 s timer, debounced to 200 ms.
- Diff against the last sent state:
  - layout name changed: send `page` (with current contents in it), then every image of that layout;
  - else send only changed `text` messages and changed `image` messages (compare PNG sha1).
- A new socket gets the full state: `page`, then all images.

### 5.6 Target selection

```
ranked(survivors) = survivors where status != 'resolved',
  sorted by critical_level (immediate, delayed, minor, unknown), then critical_score desc, then distance asc

proposed = this rescuer's assignment with status 'proposed' (at most one at a time)   # drives the acknowledge view
assigned = survivor of this rescuer's assignment with status 'active' (if several, the first in ranked order)

target_survivor =
  browse_index != null ? ranked[browse_index] : assigned        # browsing is view only

robot = the only robot row (the lowest robot_id that is online, if several)

target =
  mode == 'robot'    -> robot position
  target_survivor    -> survivor saved lat, lon
  else               -> none (idle view)
```

- `mode` toggles between `survivor` and `robot` on `scroll_up`; the robot is a target only when the rescuer asks for it (there is no beacon mode).
- `browse_index` steps through `ranked` on `scroll_down` or `long_press` (wrapping), and clears after 30 s without input or when the assignment changes.
- If the robot target has no position or the robot is offline, fall back to the survivor and show `ROBOT OFFLINE`.
- Arrived details (section 4.4) always describe `target_survivor`, also when the arrow points at the robot.
- Survivor statuses (CONTRACTS.md): `unassigned`, `assigned`, `en_route`, `reached`, `resolved`.
  The module moves them; the service only calls the rescuer reducers and shows the result.
  The service calls `start_en_route(assignment_id)` once after acceptance, when the rescuer has moved 10 m toward the target or 30 s have passed, whichever is first; that is the step from `assigned` to `en_route`, and position updates do not make it.
  A rescuer may hold several active assignments, and may get a new proposal while holding them.

### 5.7 Geometry (put these in `geo.ts`, unit-tested)

Radians: `φ = lat * π/180`, `λ = lon * π/180`.
Earth radius `R = 6371008.8` m (mean radius).

Haversine distance:

```
a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
d = 2 · R · atan2(√a, √(1−a))
```

Initial bearing from point 1 to point 2, degrees clockwise from true north:

```
y = sin Δλ · cos φ2
x = cos φ1 · sin φ2 − sin φ1 · cos φ2 · cos Δλ
θ = (atan2(y, x) · 180/π + 360) mod 360
```

8-way octant: `octant = floor(((θ + 22.5) mod 360) / 45)`, labels `N, NE, E, SE, S, SW, W, NW`.
Octant hysteresis: keep the current octant until θ is more than 5 degrees past its edge.

Web Mercator world pixel at zoom `z` (256 px tiles):

```
px = 256 · 2^z · (lon + 180) / 360
py = 256 · 2^z · (1 − ln(tan φ + 1/cos φ) / π) / 2
tile x = floor(px / 256), tile y = floor(py / 256)
meters per pixel = 156543.03392 · cos φ / 2^z
```

Test values: 0.001 degrees of latitude is 111.2 m with bearing 0; from (32.9857, -96.7502) to (32.9857, -96.7492) is about 93.3 m with bearing about 90.
At latitude 33, zoom 15 is 4.0 m per pixel, so 288 px covers about 1,154 m, and the 483 m site radius (966 m across) fits in the 288x288 map.

The arrow is compass-relative (north up), because the SDK has no compass API and `heading` exists only when available.
The status line says `arrow is N-up` in the arrow view.

### 5.8 View selection

Per session, on each recompute, with `d` the distance from the rescuer to the target:

```
if released_until > now             -> 'released'   (section 4.8)
if ask state is active              -> 'ask'        (section 4.9)
if proposed exists                  -> 'ack'        (section 4.7)
if peek_until > now                 -> 'map'        (tap shows the map for 10 s; a second tap ends it)
if no target                        -> 'idle'
switch current:
  'arrived': if d > 8   -> 'arrow'  else stay
  'arrow'  : if d <= 5  -> 'arrived'; if d > 60 -> 'map'; else stay
  'map'/'idle'/start: if d <= 5 -> 'arrived'; if d < 40 -> 'arrow'; else 'map'
```

- 40 m in and 60 m out, from PROJECT.md, so the view does not flicker.
- Arrived enters at 5 m and leaves only above 8 m (our hysteresis; two GPS errors of a few meters each combine to about 5 m).
- If the rescuer has no position yet, show `map` (or `idle`) with `NO GPS FIX`.

Input handling in the service:

| Input | Map, arrow, idle | Arrived | Ack | Released | Ask |
| --- | --- | --- | --- | --- | --- |
| `tap` | map peek on, or off if on | call `markReached({ survivorId })` once; status shows the result | (arrives as `ack`) `acceptAssignment` | dismiss | stop listening and send now |
| `scroll_up` | toggle target survivor or robot | same | ignored | dismiss | cancel the question |
| `scroll_down` | next survivor (view only) | same | ignored | dismiss | ignored |
| `long_press` | start a voice question (section 5.15), if the OS delivers it | same | ignored | dismiss | ignored |
| `double_tap` | log only (the plugin exits) | same | same | same | same |

- Long press is not guaranteed (section 3.5), so the phone page also has an `Ask` button that starts the same question flow; browsing stays on `scroll_down`.
- `resolve_survivor` is only on the phone page, behind a confirm dialog, because a tap is too easy to make by mistake.

### 5.9 Demo mode

- When `site.demo_mode` is true, the rescuer starts `DEMO_START_DISTANCE_M` from the site center at bearing `DEMO_START_BEARING_DEG` (destination-point formula below), so the demo opens on the map view.
- The walker moves the rescuer toward the current target at `DEMO_SPEED_MPS` (6 m/s default, faster than walking so the demo fits; `npm run demo` uses 4 m/s), updating every 500 ms, and stops 2 m from the target.
  It starts and stops on `W` in the fallback page or `POST /demo/<rescuer>/walk`.
- Arrow keys on the fallback page move the rescuer 5 m north, south, east, or west; `R` resets to the start.
- Every demo position goes through the same path as a real one, including `participantUpdatePosition`, so the dashboard shows the rescuer moving.
- Destination point from start (φ1, λ1), bearing θ, distance d, δ = d/R:
  `φ2 = asin(sin φ1 cos δ + cos φ1 sin δ cos θ)`, `λ2 = λ1 + atan2(sin θ sin δ cos φ1, cos δ − sin φ1 sin φ2)`.
- When demo mode is false and the real GPS has no fix (indoors), the view keeps the last fix and shows `NO GPS FIX`; switch the site to demo mode for indoor judging.

### 5.10 Arrow images

- Render once at startup with `@napi-rs/canvas`: a 144x144 black canvas, one arrow pointing up (shaft 20 px wide, from y 112 to y 52, head a triangle from (72,16) to (32,64) to (112,64)), filled white (level 15).
- Rotate by `k · 45` degrees about the center for k = 0..7, encode each with `canvas.encode('png')`, and keep the base64 strings.
- Send the arrow image only when the octant changes or on a new page.
- The text in id 4 always repeats the direction (`NE 32 m`), so the view still works if an image fails.

### 5.11 Map images

Tile sources (`tiles/source.ts`):

| Name | URL template | Attribution (full, on the fallback page and in the video) | On-lens text (id 7) |
| --- | --- | --- | --- |
| `esri-dark` (default) | `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` (note y before x, JPEG) | `Esri, HERE, Garmin, (c) OpenStreetMap contributors` (UNCONFIRMED wording, check Esri's attribution page) | `(c) Esri, OSM` |
| `carto-dark` | `https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=${CARTO_KEY}` | `(c) OpenStreetMap contributors, (c) CARTO` | `(c) OSM, CARTO` |
| `osm-inverted` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with a descriptive `User-Agent` | `(c) OpenStreetMap contributors` | `(c) OSM contributors` |
| `none` | no tiles; black background with a 100 m grid | none | empty |

Important finding (VERIFIED by fetching one tile on 2026-11-07): CARTO raster tiles requested without `?key=` now return a tile that says "API KEY REQUIRED", and CARTO's basemap README now documents a key.
PROJECT.md assumed CARTO needs no key.
Agents must not sign up for a key; the default is therefore `esri-dark`, which returned a clean dark tile without a key on the same day.
UNCONFIRMED: Esri's terms for keyless use of this service; it is fine for a one-off student demo in our reading, but Cayden should decide.
If Cayden gets a CARTO key, set `TILE_SOURCE=carto-dark`; nothing else changes.
The OSM tile policy forbids bulk downloads, so `osm-inverted` must only fetch the handful of tiles for the site.

Pre-download (`npm run tiles`):

- Reads the site center and radius from the `site` table (or `--lat --lon --radius`), picks the zoom (below), and downloads every tile that touches the 288x288 map window into `tiles/<source>/<z>/<x>/<y>.<ext>`.
  That is at most 3x3 = 9 tiles.
- Run it on the laptop with internet before the demo; the cache is git-ignored (do not commit third-party tiles).
- At runtime, a missing tile is fetched once and cached; if offline, that area is drawn black and the map still shows markers.

Zoom: the largest integer z (cap 17) where `2 · radius_m · 1.15 / meters_per_pixel(z) <= 288`.
For the default 483 m radius near Dallas that is z 15.

Base layer (built once per site, cached in memory):

1. Composite the tiles on a 288x288 canvas so the site center lands on pixel (144, 144): draw tile (tx, ty) at `(tx·256 − cpx + 144, ty·256 − cpy + 144)`, where (cpx, cpy) is the center's world pixel.
2. Convert to luminance L. For `osm-inverted`, use 255 − L.
3. Tone map so the background is see-through and roads stay dim: `bg` = median L, `p99` = 99th percentile; `v = clamp((L − bg − 4) · 119 / max(1, p99 − bg), 0, 119)`.
   Level 7 of 15 at most, so markers (level 15) stand out.
4. Draw the site boundary: a circle of `radius_m` in pixels, 1 px, dashed 4 on 4 off, value 85 (level 5).
5. Draw a small `N` and up tick at the top-left corner (as a path, not a font).

Markers (drawn on a copy of the base each time), positions from the Mercator formula relative to the site center:

| Thing | Shape | Value |
| --- | --- | --- |
| Survivor, `immediate` | filled circle r 7 with a 1 px black outline | 255 |
| Survivor, other levels | ring r 6, 2 px | 204 |
| Current target (any kind) | extra ring r 11, 1 px | 255 |
| Resolved survivor | not drawn | - |
| Robot | filled triangle 14 px pointing along `heading_deg` (up if null); hollow if offline | 255 |
| This rescuer | dot r 3 | 255 |
| Other rescuers | not drawn (visibility, section 5.4.1) | - |

- Markers outside the window are drawn clamped to the edge as a small edge tick.
- Quantize the final image to 16 levels (`round(v / 17) · 17`) so the PNG, the glasses, and the fallback page agree.
- Split into `map_top` (rows 0-143) and `map_bot` (rows 144-287), encode each as PNG, and send only halves whose sha1 changed.
- Redraw only when the marker key changes: the list of (kind, style, x px, y px) rounded to whole pixels.
  Throttle to at most one redraw every 2 s (trailing edge), since each image costs about 100 ms on the glasses.

### 5.12 Text content

- Count line: survivors with `critical_level == 'immediate'` and status not `resolved`, within `site.radius_m` of the rescuer (of the site center if the rescuer has no position), counted from the rows of the `critical_open` view (section 5.4.1).
  Radius in miles with one decimal: `483 m` shows `0.3 mi`.
  The second line in the idle view counts the `critical_open` rows whose status is `unassigned`.
- Target line: `house_label` if set, else `survivor <id>`; distance rounded to whole meters under 100 m, to 10 m above; direction label from the octant.
- Detail line: `location_note`, then breathing (`breathing 14/min`, or the wording rules in 4.4), then `conf <score_confidence>` with one decimal.
  Always show the confidence next to the score (PROJECT.md rule).
- Briefing line: the newest `briefing` row with `audience` equal to `all` or this rescuer's identity hex, created in the last 10 minutes.
  Prefix `!! ` for `critical` and `! ` for `warning`.
  Word-wrap to the container's character budget and cut with `...` if too long.
- Escalation text (CONTRACTS.md `escalation_timer`): the module posts a `critical` briefing of kind `escalation` to `all` at N s (`site.escalate_after_s`), and at 2N s to the `commander` and to `all`.
  The service shows the newest one in the `brief` line:

  | Level | When (survivor `immediate` and `unassigned`) | `brief` line text |
  | --- | --- | --- |
  | 1 | the module's first `all` escalation briefing | the module's text with `!! ` (for example `!! IMMEDIATE unassigned 45s - house 4`) |
  | 2 | the module's second `all` escalation briefing | the module's text with `!! ` (for example `!! 2ND ALERT: commander notified - house 4`) |

  When this rescuer is free (idle view), a level 2 escalation also adds `hold: ask  phone: take it` to id 8; there is no "accept" without a proposal, because only the orchestrator, a coordinator, or the module watchdog proposes assignments.

### 5.13 HTTP endpoints (all with `Access-Control-Allow-Origin: *` and an `OPTIONS` handler)

| Method and path | Purpose |
| --- | --- |
| `GET /healthz` | `{"ok":true,"db":"connected","server":"http://127.0.0.1:3000","database":"assess-0hw81"}` (`server` and `database` are null on fake data; the dashboard's Play demo uses them to check that it and the glasses share one database) |
| WS `/glasses` | plugin protocol (CONTRACTS.md) |
| WS `/view?rescuer=<name>[&primary=1]` | fallback page: same service messages; accepts `input`, `ack`, `heartbeat` (counted only with `primary=1`), and the demo messages below; it attaches at once to the rescuer in the URL (no hello) |
| WS `/phone?rescuer=<name>` | phone page: accepts `position`; receives `{"type":"phone_state",...}` with the assignment, its status and lease countdown, and the target |
| `POST /rescuer/<name>/action` | body `{"action":"accept"\|"decline"\|"release"\|"reached"\|"resolve"\|"ask", ...}` calls the matching reducer as that rescuer (table below) |
| `POST /rescuer/<name>/ask_audio` | body: a WAV file (16 kHz mono s16le) from the phone page microphone; same flow as section 5.15 |
| `POST /demo/<name>/walk`, `/demo/<name>/start`, `/demo/<name>/move`, `/demo/<name>/reset` | demo walker controls on demo_mode sites: `walk` toggles, `start` always walks (the dashboard's Play demo), `reset` returns to the start point (also sent over `/view` as `{"type":"demo","cmd":"walk"\|"reset"\|"move","dn":5,"de":0}`) |

| `action` | Extra fields | Reducer, called as the rescuer |
| --- | --- | --- |
| `accept` | `assignment_id` | `accept_assignment(assignment_id)` |
| `decline`, `release` | `assignment_id` | `release_assignment(assignment_id)` |
| `reached` | `survivor_id` | `mark_reached(survivor_id)` |
| `resolve` | `survivor_id`, `resolution` (`rescued`, `handed_off`, `false_alarm`, `duplicate`), `note` | `resolve_survivor(survivor_id, resolution, note)` |
| `ask` | none | opens the glasses microphone (sends `mic` on to the plugin), same as a long press |

`/view`, `/phone`, `/rescuer/...`, and the demo messages are service-internal and not part of the glasses contract.

### 5.14 Heartbeat and lease summary

| Signal | Sender | Rate | Effect in the module (CONTRACTS.md) |
| --- | --- | --- | --- |
| `{"type":"heartbeat"}` to `rescuer_heartbeat()` | plugin (or a primary fallback page), forwarded by the service | every 5 s | renews the rescuer's active leases; no heartbeat for 15 s and `heartbeat_timer` releases the assignment |
| `participant_update_position` | service | moved 2 m, or every 5 s | position for the dashboard and the map; also renews leases |
| SpacetimeDB connection of the session | service | open while the primary socket is open | a dropped connection releases the rescuer's assignments after a 2 s disconnect grace |
| Assignment lease (`site.assignment_lease_s`) | module | - | backup if both of the above fail |

### 5.15 Voice questions (rescuer to comms agent)

Flow, all in `ask.ts`:

1. Start: a `long_press` in a normal view, or the phone page `Ask` button.
   The service sends `{"type":"mic","on":true,"max_s":ASK_MAX_S}` to the plugin and shows the ask view (4.9).
2. Collect `audio` messages in order by `seq` into one PCM buffer.
3. Stop: a tap, `audio_end`, `ASK_MAX_S` seconds, or 1.5 s of silence after speech (RMS below the first 300 ms noise floor plus 6 dB; Inference: a simple end-of-speech rule, tune on the lens).
   The service sends `{"type":"mic","on":false}`.
4. Wrap the PCM in a WAV header (16 kHz, 16-bit, mono), upload it to the media server `POST /media` with `kind=voice`, and send it to the perception service `POST /transcribe` (perception.md section 12).
   Timeout 10 s.
5. If the transcript is empty, show `Did not catch that - hold to ask again` and stop.
6. Show the transcript in id 5 (`You: "..."`).
7. Post the question as an `answer_rescuer` task for the comms agent.
   The service calls `rescuer_ask(text, audio_url, survivor_id)` as the rescuer (`survivor_id` = the current target, or 0); the rescuer role cannot call `post_agent_task`.
   The module logs `rescuer_question` and inserts the `agent_task` row, with `chain_id` = the survivor's chain if `survivor_id` is set, else the `rescuer_question` event id: `from_agent` = the rescuer's name, `to_agent = comms_agent`, `kind = answer_rescuer`, `priority = high` (or `critical` when the current target is `immediate`), `payload_json` = `{"rescuer_identity":"<hex>","rescuer_name":"alex","text":"...","audio_url":"...","survivor_id":3,"lat":..,"lon":..,"asked_at":"<ISO>"}`, `reason = "rescuer voice question"`.
   The question text is exempt from the death-word check (CONTRACTS.md version 8), because it records what the rescuer said; if `rescuer_ask` fails for another reason, show `Rephrase - hold to ask again`.
8. The comms agent claims the task, answers from the board, and calls `post_briefing(<rescuer hex>, <answer, at most 120 characters>, info, survivor_id, answer)`.
   The service shows the first briefing of kind `answer` for this rescuer newer than `asked_at` as the answer (4.9).
9. If no answer comes in 30 s, show `no answer yet - see dashboard`; the task stays on the board, and if its lease expires the module puts it back to `open` for another try (CONTRACTS.md `agent_task`).

Rules:

- The microphone is open only between steps 1 and 3; the status line shows `ASKING` the whole time.
- The service never answers a question itself, and never calls a model.
- Questions and answers are visible on the dashboard's agent board, so a coordinator can answer by hand with `post_briefing` if the comms agent is down.
- The audio file stays on the media server on the laptop; only the transcript goes into SpacetimeDB.
- Phone page fallback: `Ask` on the phone page sends `action: ask`, which opens the glasses microphone; when no plugin is connected (fallback-only demo), the phone page records with `getUserMedia` (secure context, the same `vite --mode phone` HTTPS server as geolocation) and posts the WAV to `/rescuer/<name>/ask_audio`.
  UNCONFIRMED until tried on the phone.

## 6. Fallback page (`frontend/glasses/fallback.html`)

- URL: `http://<laptop-ip>:5173/fallback.html?rescuer=alex&ws=ws://<laptop-ip>:8787/view`.
  Add `&record=1` for recording mode.
  Add `&primary=1` when the page stands in for the glasses (no plugin connected): it then sends `heartbeat` every 5 s, its taps in the acknowledge view send `ack`, and closing the tab releases the assignment like a dropped glasses session.
- It does not load the Even SDK.
  It keeps a container map from `page` messages and redraws a 576x288 canvas after every message.
- Drawing:
  - black background;
  - images: decode the PNG, draw it at (x, y), then tint: greyscale value v becomes green `rgb(0.25v, v, 0.45v)` (approximate G2 green; adjust by eye against a photo of the real lens);
  - text: monospace font sized so one character is about 13 px wide and lines are 27 px apart, word-wrapped to the container width minus padding, top-left aligned, clipped to the container; brightness `text_color` 0 to 4 maps to alpha 0.25, 0.45, 0.65, 0.85, 1.0;
  - borders when `border_width > 0`.
- Normal mode: the canvas at 2x with `image-rendering: pixelated`, plus a side panel with the connection state, the layout name, buttons for tap, scroll up, scroll down, long press, and double tap (double tap only sends input, it does not close the page), and the demo keys (`W`, arrows, `R`).
- Record mode: only the canvas, scaled to fill the window on pure black, no panel, no cursor.
- Full attribution text of the tile source in small grey type under the canvas in normal mode.

Phone page (`phone.html`): big buttons `Accept` and `Decline` (while a proposal waits, with its countdown), `Release`, `Mark reached`, `Resolve` (a confirm dialog with the four resolutions and a note), and `Ask`; plus the current target and distance from `phone_state`, and the geolocation status.
No button can label a person as dead; the resolutions are the contract's four values only.

## 7. Recording for the demo video

1. Start the stack in demo mode and open the fallback page in record mode in a browser window sized to 1152x576 (2x).
2. Record that window with QuickTime (File, New Screen Recording, record selected portion) or OBS (Window Capture), at 30 fps.
   Alternative: record the simulator by polling `GET /api/screenshot/glasses` and building a video with ffmpeg; the PNG is RGBA, so flatten it on black first.
3. Script the walk: start on the map, press `W`, let the view switch to the arrow at 40 m, then to arrived at 5 m, then tap for `mark reached`.
4. In the editor (Premiere, DaVinci Resolve, CapCut), put the glasses clip above the real footage and set the blend mode to Screen or Add, so black disappears and only the green shows, as in the bluebook demo video.
   ffmpeg version (UNCONFIRMED, test once):
   `ffmpeg -i footage.mp4 -i hud.mp4 -filter_complex "[0:v]format=gbrp[bg];[1:v]scale=960:480,pad=1920:1080:480:60:black,format=gbrp[hud];[bg][hud]blend=all_mode=screen,format=yuv420p" -c:a copy out.mp4`
   (both inputs must have the same frame rate; footage assumed 1920x1080).
5. Show the full map attribution in the video credits.

## 8. Test plan

### 8.1 Unit tests (`vitest`, no hardware)

- `geo.test.ts`: the test values in 5.7, octant edges (22.4 is N, 22.6 is NE), octant hysteresis, destination point round trip.
- `select.test.ts`: view transitions at 39, 41, 59, 61 m going in and out; arrived at 5 and back at 8.1; peek timeout; `scroll_up` makes the robot the target and back; robot offline falls back; no assignment gives idle; browse wraps and clears; a `proposed` row gives the ack view over everything but released; `active` to `released` gives the released view with the right reason text; resolved survivors are not ranked.
- `layouts.test.ts`: every layout (seven) passes `validateLayout()`; non-ASCII input is cleaned; long briefings and transcripts are cut; no string contains dead, deceased, or expectant.
- `escalation.test.ts`: level 1 and level 2 both from the module's `escalation` briefings to `all`, nothing once the survivor is assigned.
- `session.test.ts` with a fake connection: the DB connection opens on the first primary socket and closes at once when it closes; a mirror-only `/view` never opens it; heartbeats are forwarded at most every 4 s and only from a primary socket; `ack` for a foreign assignment id is dropped.
- `ask.test.ts`: PCM chunks in order make one WAV with a correct header; out-of-order `seq` is sorted; the silence stop fires; an empty transcript posts no task.
- Plugin `mic.test.ts` with a fake bridge: `mic on` calls `audioControl(true, Glasses)`, falls back to `Phone` once, stops after `max_s`, and stops on socket close.
- `map.test.ts`: two PNGs of 288x144; a marker at the site center lands at (144, 144); with `TILE_SOURCE=none` it renders offline.
- Plugin `queue.test.ts` with a fake bridge: a page clears pending writes; two texts for one id send only the newest; images are at least 110 ms apart; writes for unknown ids are dropped; a throwing call does not stop the queue.
- Plugin `input.test.ts`: missing `eventType` is a tap; double tap calls `shutDownPageContainer(1)` from either envelope; a scroll with no `sysEvent` is not a tap.

### 8.2 Simulator, no glasses

1. Service running against a local SpacetimeDB with the demo simulator's data (or a fixture script that inserts a site, 3 survivors, a robot, and an assignment).
2. `evenhub-simulator --automation-port 9898 http://localhost:5173`; wait 4 s.
3. Check each view by grabbing `GET /api/screenshot/glasses` and looking at it: idle, map, arrow, arrived (drive the distance with the demo walker).
4. `POST /api/input` with `click`, `up`, `down`, `long_press` plus `long_press_release`, and `double_click`; check the service log shows the mapped inputs and the double click exits.
5. Kill the service for 20 s and restart it; the plugin must show `LINK LOST - retrying` and recover with no manual step.
   With an accepted assignment, the dashboard must show it `released` about 2 s after the kill (the disconnect grace), and the glasses must show the released view after reconnect.
6. Acknowledge: have the simulator or a coordinator call `propose_assignment` for this rescuer; the ack view appears with a countdown; `POST /api/input {"action":"click"}` accepts it, and the dashboard shows `active`; let a second one run out and check the released view says `Not accepted in time.`
7. Heartbeat: block the plugin's heartbeats (a test flag in `heartbeat.ts`) with the socket still open; the assignment must be released by the module after about 15 s.
8. The simulator does not enforce image size limits and may accept more image containers than the glasses (VERIFIED caveat), so the layout validator is the guard.
9. Microphone: check whether the simulator delivers any `audioEvent` (UNCONFIRMED); if not, test the ask flow with a WAV file through `/rescuer/<name>/ask_audio`.

### 8.3 Fallback page

1. Open the fallback page next to the simulator and compare: same layout, same text, same map.
2. Run the full demo walk from the fallback page alone with no plugin connected.
3. Record 20 s in record mode and do the Screen blend once to confirm black disappears.

### 8.4 Real G2

1. Phone on the hotspot, `evenhub qr --url "http://<ip>:5173"`, scan, confirm the startup text appears.
2. Check every view on the lens; fix the character budget (`CHARS_PER_PX`) if lines wrap or cut; check that dim levels 1 and 2 are readable.
3. Check that ring taps arrive with source `ring` and temple taps with `left` or `right`.
4. Check the image update time when the map changes (should be well under a second) and that text never flickers.
5. Lock the phone for 10 s and unlock it; the plugin must reconnect (rescan if the dev session died).
6. Walk outside for 2 minutes with demo mode off and confirm real positions reach the dashboard.
7. Ring tap on a proposal accepts it; check the source logged is `ring`.
8. Hold to ask (or phone `Ask`), say "is anyone else in house 3", and check the transcript on the lens, the `answer_rescuer` task on the dashboard, and the comms agent's answer on the lens within 30 s.
   Check the PCM chunk sizes in the log, and that a loud venue still gives a usable transcript at mouth distance.

## 9. Build order (about 17 hours left; estimates for one agent or person)

The order follows "Priority by sponsor track" in `docs/MVP.md`.
The glasses are priority 4 (count, acknowledge, arrow), and they rest on the module's guarantees (priority 1: views, leases, the disconnect release) and the comms agent's briefings (priority 2), which steps 7 and 8 connect to.
Voice questions (step 12) are priority 6, so they come after the map, the arrow, and the acknowledge flow.

| Step | Work | Hours | Done when |
| --- | --- | --- | --- |
| 1 | Cayden: Even app update, hub sign-in, developer section visible | 0.25 | "Scan QR" shows |
| 2 | Scaffold plugin from the minimal template; hello text on simulator, then on glasses by QR | 1 | text on the lens |
| 3 | `geo.ts`, `select.ts`, `layouts.ts` (all seven layouts) with unit tests | 2.5 | tests pass |
| 4 | Service WS server, sessions, fake data source (no DB), page/text messages; plugin queue, input, heartbeat, reconnect | 2.5 | simulator shows every view from fake data |
| 5 | Fallback page (normal, record, and primary mode) | 1.5 | mirrors the simulator |
| 6 | Arrow images | 0.5 | arrow turns as the demo walker moves |
| 7 | SpacetimeDB connection per session (open and close with the primary socket), register, visibility subscriptions, `participantUpdatePosition`, `rescuerHeartbeat`, `acceptAssignment` from `ack`, `startEnRoute`, `markReached` | 2.5 | dashboard shows the rescuer moving; closing the plugin releases the assignment within about 2 s |
| 8 | Ack, released, and escalation text | 1 | simulator tests 8.2 steps 5 to 7 pass |
| 9 | Demo walker | 1 | scripted walk works end to end |
| 10 | Map: tile cache and prefetch, tone map, markers, split, diff | 2.5 | map with live markers on the lens |
| 11 | Plugin location and `position` message; phone page with all buttons | 1.5 | real position reaches SpacetimeDB outside |
| 12 | Microphone and voice questions (`mic.ts`, `ask.ts`, `/transcribe`, `rescuer_ask`) | 2 | a spoken question gets a comms agent answer on the lens |
| 13 | Real G2 pass (8.4) and fixes | 1.5 | checklist done |
| 14 | Record the glasses footage and blend test | 1 | clip ready for the video |

Total about 21 hours of work, so two people should split it (the service and the plugin parallelize well).
If time runs short, cut in this order: phone page geolocation (use demo mode), voice questions (the cut order in `docs/research/agents.md` also cuts them early), robot target toggle, browse, map tiles (use `TILE_SOURCE=none`).
Never cut the fallback page, the heartbeat, the acknowledge view, or the released view; they are the safety net for the live demo and the "no one overlooked" story.

## 10. Open questions

- Is Cayden's phone iOS or Android (background behavior differs)?
- Esri keyless tile terms, or a CARTO key from Cayden (section 5.11).
- Character width and dim levels on the real lens (section 4.1).
- Microphone chunk size, simulator support, and transcript quality in the venue noise (section 3.2).

## Proposed contract changes

Proposed contract changes: none open (merged into CONTRACTS.md version 8).
