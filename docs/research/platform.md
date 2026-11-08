# Platform research: Nemotron, SpacetimeDB, GPS, comms, navigation

Researched on 2026-11-07 for the rubble search robot dog (see `docs/PROJECT.md` and `docs/ROBOT.md`).
Every fact has a source in the "Sources" section at the end, numbered like [S1].
Where a fact could not be confirmed, this file says so.
Nothing was signed up for during this research.

## Key takeaways and recommended stack

- Backend: one SpacetimeDB module written in TypeScript, hosted on Maincloud.
  TypeScript is one of four module languages (Rust, C#, TypeScript, C++), and it is the only one where procedures (outbound HTTP) are not marked unstable [S10][S11].
  The web board, the agent, and the glasses app can then all share the same generated TypeScript bindings [S16].
- Robot link: there is no official standalone C++ client SDK, only Rust, C#, TypeScript, and Unreal (C++ and Blueprint) [S11].
  Run a small Node.js TypeScript bridge process on the Pi that talks to SpacetimeDB, and talk to it from the C++ program over a local non-blocking socket.
  The C++ program can also call reducers directly with HTTP POST as a fallback [S13].
- Agent: a Node.js TypeScript process on a laptop that is both a SpacetimeDB client and a Nemotron client.
  Its tools are SpacetimeDB reducers and reads from its subscription cache.
- Model: `nvidia/nemotron-3-super-120b-a12b` on the hosted NVIDIA API (`https://integrate.api.nvidia.com/v1`, OpenAI compatible), which NVIDIA lists as supporting function calling [S2][S3].
  Nemotron 3 Nano 30B-A3B is the faster fallback, and its model card lists multi-step tool use [S4].
- NVIDIA access: a free NVIDIA Developer Program account and an API key from build.nvidia.com [S1][S6].
  The free tier is for prototyping, and forum reports put the limit at about 40 requests per minute [S7][S8].
  The $200 Brev credits are prizes for 1st and 2nd place only, not handed to every team (`docs/notes/2026-11-07-nvidia-track.md`).
- GPS: connect Matthew's GPS module to the Pi through a USB-to-TTL serial adapter (or use a USB GPS dongle) and read it with gpsd.
  This needs no Pi or Pico UART, which are all taken.
  The fallback is a PIO software UART (RX only) on a free Pico pin.
- GPS gives position only, about 2.5 m CEP under open sky, and it fails indoors or under rubble [S20][S23].
  Plan to take a GPS anchor outdoors and add the LiDAR or odometry offset for indoor finds.
- Demo comms: Pi Wi-Fi on a dedicated phone hotspot or travel router, with the laptops on the same network.
  Keep a local SpacetimeDB server on a laptop as the fallback if the internet drops.
- Navigation for the glasses: compute distance and bearing on the client with the haversine and initial bearing formulas (no API key) [S28].
  A street route is optional and can come from OSRM's demo server (no key mentioned, 1 request per second max) or openrouteservice (free key) [S29][S30].
- Safety: the robot's C++ state machine never waits on the network.
  Commands from the agent are high-level requests with an expiry time, and only the safety gate passes commands to the drivers (as in `docs/ROBOT.md`).

## 1. Nemotron

### Which models

| Model | API model id | Notes | Source |
| --- | --- | --- | --- |
| Nemotron 3 Super 120B-A12B | `nvidia/nemotron-3-super-120b-a12b` | Hybrid Mamba-Transformer MoE, 120B total, about 12B active, 1M context. NVIDIA lists "agentic reasoning, coding, planning, tool calling". Released March 11, 2026. | [S2][S3][S5] |
| Nemotron 3 Nano 30B-A3B | Not confirmed for the hosted API. Copy it from the build.nvidia.com page. The Hugging Face id is `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16`. | MoE, 1M context, "coding, reasoning, instruction following, tool calling". Training included multi-step tool use. | [S4] |
| Llama 3.3 Nemotron Super 49B v1.5 | Not confirmed. Copy it from its build.nvidia.com page. | Older generation. NVIDIA lists "reasoning, tool calling, chat, and instruction following". DPO training for tool calling. | [S9] |

Recommendation: start with Nemotron 3 Super for the planning agent.
If it is too slow for the live demo, switch the same code to Nano by changing the model string.
Both default to reasoning on, which costs time.
On the hosted Super endpoint, `reasoning_effort` takes `none`, `low`, or `high` (default `high`), and `reasoning_budget` caps the thinking tokens [S3].

### How to call it

Three options:

1. Hosted NVIDIA API (recommended for the hackathon).
   Base URL `https://integrate.api.nvidia.com/v1`, endpoint `POST /v1/chat/completions`, header `Authorization: Bearer $NVIDIA_API_KEY` [S2][S3].
   It works with the OpenAI client libraries by setting `base_url` [S2].
2. NIM containers.
   Developer Program members can download NIM containers for research and testing on up to 16 GPUs [S6].
   Super is 120B parameters, so it needs a large GPU, and no team GPU is planned for it (`docs/notes/2026-11-07-nvidia-track.md`).
3. Brev GPUs.
   Brev bills per hour by GPU type, and stopped instances have no compute charge [S31].
   Live GPU prices were not captured, so check the Brev console [S32].
   The hackathon's Brev credits are prizes, so this option costs the team money.

### API key, credits, rate limits

- Get a key: on a model page at build.nvidia.com, click "Get API Key", enter an email, and sign in or create an NVIDIA account.
  This also enrolls you in the Developer Program [S1].
- Cost: Developer Program members get free NIM API endpoints for prototyping, research, development, and testing [S6].
- Rate limits: NVIDIA says the catalog is a trial, the limits are designed for evaluation, and your limit is shown in the account menu on build.nvidia.com [S7].
  Many forum threads report 40 requests per minute and say it cannot be raised for free accounts [S8].
  This is not in official docs, so check the account menu.
- Credits: a 2024 forum answer says sign-up gave 1,000 API credits, up to 5,000 [S7].
  That may be out of date, and recent forum users report "unlimited but RPM" [S27].
  Could not confirm the current credit model.
- Budget for the demo: at about 40 requests per minute, one agent loop of 5 to 10 tool calls per minute is fine, but do not run several agents or a retry storm.

### Tool calling

- NVIDIA's NIM docs use the OpenAI-style `tools` and `tool_choice` parameters.
  `tool_choice` can be `"none"`, `"auto"`, or a named function [S12].
- The Super model page lists function calling as supported [S2].
- The Super API reference page shows `tools` and `tool_choice` in its code snippets, but its JSON schema does not list them [S3].
  So send one test call with a tool before building on it.
- `stream` defaults to `true` on the hosted Super endpoint, so set `"stream": false` for simple agent code [S3].
- A 202 status means the result is pending, and the client polls with the `NVCF-REQID` header [S3].
- If a reply has an empty tool-call field but the call appears in the message text, the output was not parsed as a tool call [S12].
  Handle this case in code (parse the JSON from the text or retry).

Minimal request shape.
The base request comes from the official API reference [S3], and the `tools` block uses the OpenAI format that NIM docs describe [S12].
The tool itself (`rank_survivors`) is a placeholder for this project.

```bash
curl -sS https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/nemotron-3-super-120b-a12b",
    "messages": [
      {"role": "system", "content": "You coordinate a rubble search. Use tools."},
      {"role": "user", "content": "New detections arrived. Update the plan."}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "rank_survivors",
        "description": "Return survivors ordered by critical level",
        "parameters": {
          "type": "object",
          "properties": {"radius_m": {"type": "number"}},
          "required": ["radius_m"]
        }
      }
    }],
    "tool_choice": "auto",
    "max_tokens": 1024,
    "reasoning_effort": "low",
    "stream": false
  }'
```

The agent loop: send the messages and tools, run each returned tool call (a reducer call or a cache read), append the result as a `tool` message, and repeat until the model replies with no tool calls.

## 2. SpacetimeDB

### Languages

- Server modules: Rust, C#, TypeScript, and C++ [S11].
  C++ modules compile to WebAssembly with Emscripten [S14].
  Other docs say C++ support is in beta and pinned to v1.12.0, so avoid it [S15].
- Client SDKs: Rust, C#, TypeScript, and Unreal Engine (C++ and Blueprint). Unity uses the C# SDK [S11].
- C++ on the Pi: there is no official standalone native C++ client.
  The Unreal SDK is a plugin for Unreal 5.6 and installs from GitHub during preview, so it is not usable from a plain C++ program [S15].
  A community project (jstreibel/SpacetimeDB-Cpp) calls itself early-stage [S15].
- Python: a `spacetimedb-sdk` package exists on PyPI at version 0.7.0, but the current docs do not list Python, and it looks unmaintained [S17].
  Do not use it.
- Current docs describe SpacetimeDB 2.x.
  The `spacetimedb-cli` crate on crates.io is an outdated 1.x release, so do not `cargo install` it [S10].

### Recommended pattern for the Pi

Option A (recommended): a Node.js TypeScript bridge on the Pi.

- It uses the official `spacetimedb` npm package and the same generated bindings as the web board and the agent [S16].
- The C++ program sends findings and telemetry to the bridge over a local Unix socket or localhost UDP (JSON lines), without blocking.
- The bridge subscribes to a `robot_command` table and forwards new commands to the C++ program, which stores them in a latest-value slot.
- The Node quickstart needs Node.js 22, 24, or 26+ [S18].
  Check that a supported Node version installs on the Pi's Debian 12 (aarch64), since this was not confirmed.

Option B: a Rust bridge with the official `spacetimedb_sdk` crate [S19].
The docs do not state aarch64 Linux support, so test the build on the Pi first.

Option C: HTTP from C++ with libcurl, no bridge.

- Call a reducer with `POST /v1/database/:name_or_identity/call/:reducer`, a JSON array of arguments as the body, and `Authorization: Bearer <token>` [S13].
- Read with `POST /v1/database/:name_or_identity/sql` [S13].
- Get an identity and token with `POST /v1/identity`, which returns `identity` and `token` [S24].
- This has no live subscriptions, so the robot would poll for commands.
  Use it as a fallback if the bridge is not ready.

### Features the project needs

- Reducers: transactional functions that clients call.
  In TypeScript a client calls `await conn.reducers.setName({ name })`, which rejects with `SenderError` if the reducer fails [S16].
- Scheduled reducers: a schedule table with a `t.scheduleAt()` column and a reducer registered with `onSchedule`.
  `ScheduleAt.interval(...)` repeats, and `ScheduleAt.time(...)` runs once, in microseconds [S21].
  Use these for escalation ("waiting too long") and lease expiry.
- Procedures: functions that can make outbound HTTP calls with `ctx.http.fetch` in TypeScript.
  The default timeout is 30 seconds, and the host clamps any timeout to 180 seconds at most.
  Procedures manage transactions themselves with `ctx.withTx`, and cannot send HTTP while a transaction is open [S22].
  They are marked unstable in C#, Rust, and C++, but not in TypeScript [S22].
  The docs warn "Never hardcode API keys in your client code" [S22].
  A procedure could call Nemotron from inside the database, but this file did not confirm how a module stores a secret, so keep the agent outside for now.
- Subscriptions: `ctx.subscriptionBuilder().onApplied(...).subscribe([tables.survivor, ...])`, then `onInsert`, `onUpdate`, and `onDelete` callbacks per table [S25].
- Auth and identity: SpacetimeDB uses OpenID Connect tokens.
  A client that connects without a token gets a new identity and a token, and must save the token to keep that identity [S26].
  Give the robot, the agent, and each operator their own saved token, and check the caller in reducers (see the "Using auth claims" page [S10]).
  SpacetimeAuth is beta [S10].

### Maincloud, CLI, and quickstarts

- Install the CLI: `curl -sSf https://install.spacetimedb.com | sh` on macOS and Linux, or `iwr https://windows.spacetimedb.com -useb | iex` on Windows [S33].
- Log in with `spacetime login`, then publish with `spacetime publish my-database --server maincloud`.
  Republishing hot-swaps the module without disconnecting clients.
  `--delete-data` clears the data [S34].
- Clients connect to `https://maincloud.spacetimedb.com` with the database name [S34].
- Free plan: 2,500 TeV per month (about 3,000,000 function calls, 12.5 GB egress, 1 GB storage), up to 5 databases per project, and databases pause after 1 week of inactivity [S35].
- Hackathon credit: 100,000 TeV (about $38) per GitHub account, redeemed with code `HACKUTD2026` from the leaflet QR code (`docs/notes/2026-11-07-spacetime-track.md`).
- Generate TypeScript bindings: `spacetime generate --lang typescript --out-dir client/src/module_bindings --module-path <module dir>` [S16].
- Quickstarts: TypeScript https://spacetimedb.com/docs/quickstarts/typescript, Node.js https://spacetimedb.com/docs/quickstarts/nodejs, React https://spacetimedb.com/docs/quickstarts/react, Rust https://spacetimedb.com/docs/quickstarts/rust [S36].
  The Node quickstart starts a project with `spacetime dev --template nodejs-ts`, which runs a local server, publishes, and generates bindings [S18].

## 3. Architecture

```
                         Maincloud (internet)
              +--------------------------------------+
              |  SpacetimeDB module (TypeScript)     |
              |  tables: survivor, search_cell,      |
              |   robot, robot_command, assignment,  |
              |   briefing                           |
              |  reducers enforce rules              |
              |  scheduled reducers: escalate,       |
              |   expire leases                      |
              +---+-----------+-----------+------+---+
                  ^ WebSocket ^           ^      ^
                  |           |           |      |
   +--------------+--+  +-----+--------+  |  +---+-----------------+
   | Pi 4B            |  | Laptop A     |  |  | Phone (Even Hub app)|
   | robot (C++)      |  | Nemotron     |  |  | TypeScript SDK      |
   |  state machine   |  | agent (Node) |  |  | -> G2 glasses       |
   |  safety gate     |  | tools =      |  |  +---------------------+
   |   ^ local socket |  |  reducers +  |  |
   |   v (non-block)  |  |  cache reads |  |  +---------------------+
   | bridge (Node)    |  |    |         |  +--+ Laptop B: web board |
   +--------+---------+  +----+---------+     | (React, live subs)  |
            | clip upload     | HTTPS         +---------------------+
            v (HTTP, LAN)     v
   +------------------+  integrate.api.nvidia.com
   | Laptop A: video  |  (Nemotron 3 Super)
   | worker (EVM,     |
   | breathing rate)  |---> reducer: report_vitals
   +------------------+
```

How the pieces connect:

- Robot (C++ on the Pi).
  The control loop runs at a fixed rate and reads only latest-value slots, as in `docs/ROBOT.md`.
  It writes findings and telemetry to the bridge socket with non-blocking sends and drops them if the socket is full.
  It reads commands from a slot that the bridge fills.
- Bridge (Node on the Pi).
  It calls reducers such as `report_detection`, `update_robot`, and `mark_cell_searched`.
  It subscribes to `robot_command` rows for this robot and forwards them.
- Agent (Node on a laptop).
  It subscribes to `survivor`, `search_cell`, and `robot`.
  On a new detection or a timer, it runs a Nemotron tool loop.
  Example tools: `list_survivors`, `rank_survivors`, `plan_route`, `send_robot_to_cell` (inserts a `robot_command`), and `post_briefing` (inserts a `briefing`).
  Reducers validate every tool call, so the agent can only propose actions inside the rules (the same pattern as Vouch and skyFall in `docs/notes/2026-11-07-spacetime-winners.md`).
- Operator view.
  The web board is a React client with live subscriptions.
  The glasses: Even Hub apps are written in TypeScript with the `@evenrealities/even_hub_sdk` npm package, and they run on the phone inside the Even Realities app, with the G2 as the display (576 by 288, monochrome green) [S37].
  Apps must request network access explicitly [S37].
  So the glasses app can likely be a SpacetimeDB TypeScript client that subscribes to `briefing`, but this is not tested.
  If it fails, the phone app can poll the SQL HTTP endpoint [S13].
- Video processing.
  Eulerian video magnification is heavy for the Pi 4B (`docs/PROJECT.md`).
  At each stop, the robot records a few seconds of NoIR video and uploads the clip over the LAN to a worker on Laptop A.
  The worker computes the breathing rate and confidence and calls a reducer.
  Do not put video into SpacetimeDB; store only the result and a small still image or a file reference.
- Network independence.
  The control loop never waits on the bridge, the agent, or SpacetimeDB.
  Each `robot_command` carries an expiry time, and the robot ignores expired commands.
  If the bridge goes silent, the robot finishes or holds its current safe behavior and does not start new moves.
  The e-stop, the stale-sensor checks, and the Pico heartbeat stay local, as in `docs/ROBOT.md`.

## 4. GPS

### How a hobby GPS module works

- u-blox modules output NMEA text sentences over a UART, and the NEO-6M is commonly run at 9600 baud.
  Do not assume Matthew's module's baud rate; gpsd probes 4800, 9600, 19200, and 38400 [S38].
- Accuracy: u-blox gives 2.5 m CEP (50% of fixes within 2.5 m, 24 h static, open sky) for the NEO-M8 [S20].
  Secondary sources give 2.5 m (2.0 m with SBAS) for the NEO-6M [S39].
- Time to first fix: NEO-M8 cold start is about 26 s, hot start about 1 s [S20].
  NEO-6M cold start is listed as about 27 s, but sources disagree [S39].
  Power the module and let it fix outdoors before the demo.
- Indoors and under rubble: building materials attenuate GNSS signals, reinforced concrete by about 29 to 33 dB.
  One study found no signals in windowless rooms and cellars [S23].
  Expect no fix inside a damaged building or under a rubble pile.
  GPS gives position only.
  It does not carry any data back to the operator.

### Options for adding GPS (all Pi and Pico UARTs are taken)

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| A. USB on the Pi (recommended) | Matthew's module through a USB-to-TTL serial adapter (shows as `/dev/ttyUSB*`), or a USB GPS dongle (u-blox dongles show as `/dev/ttyACM0`) [S38]. Read with gpsd (`gpsd`, `gpsd-clients`; check with `cgps -s`) [S38]. | No pin conflicts. The Pi 4B has 2 USB 3.0 and 2 USB 2.0 ports [S40]. gpsd parses NMEA. No Pico firmware change. | Needs an adapter or dongle on hand. Check the adapter's logic level is 3.3 V for the module. |
| B. PIO software UART on the Pico | Use the `pio/uart_rx` example from pico-examples on a free GPIO (for example GP6), RX only [S41]. Send parsed fixes as a DATA frame on the existing Pi link. | No new hardware. Uses the existing protocol and timestamps. | More firmware work. One user reported dropped bytes at 1 Mbaud, which should not matter at 9600 [S41]. |
| C. u-blox I2C (DDC) | u-blox DDC default address 0x42, data stream register 0xFF [S42]. The Pi's I2C1 (GPIO2/GPIO3) is not used in `docs/ROBOT.md`, or the Pico's shared I2C1. | No UART needed. | Only works if the breakout exposes SDA/SCL, and many NEO-6M breakouts expose only UART. Register details came from u-blox 5/6 docs and third-party code. |

Recommendation: option A.
Ask Matthew for the module's model and baud rate, and whether the team has a USB-to-TTL adapter.
If not, use option B.

### Positions for survivors

GPS will not work inside the mock rubble or a building.
Use a hybrid: take a GPS fix at the entry point (outdoors), then add the robot's local offset from the LD19 LiDAR map or odometry for each finding.
For the indoor demo, set a fixed anchor coordinate and say so on the board ("position: anchor plus LiDAR offset").

## 5. Communication from the robot to the operator

| Link | Range | Data rate | Fit |
| --- | --- | --- | --- |
| Wi-Fi (Pi 4B has 2.4 and 5 GHz 802.11ac) [S40] | Rough figures: 30 to 70 m indoors and 100 to 250 m outdoors at 2.4 GHz, from secondary sources [S43]. Walls cut it quickly. | High, enough for video clips. | Best for the demo. |
| Wi-Fi plus Matthew's Pi range extender | Extends the Wi-Fi above. Its range was not measured. | Same as Wi-Fi. | Good for a larger search area. |
| Phone hotspot | Similar to Wi-Fi. The phone gives the internet uplink to Maincloud. | High. | Easiest demo setup. |
| LoRa | Up to about 5 km urban and 15 km or more rural line of sight (Semtech) [S44]. | Low; Semtech says it is meant for "low throughput, low data rate" use [S44]. | Real deployments for telemetry and survivor pings only, no video. The team does not own LoRa radios in the inventory. |
| Cellular / FirstNet | FirstNet has deployable cell sites (SatCOLT and COW) for disasters [S45]. Starlink-based kits such as miniCRD claim up to 220 Mbps [S46]. | High. | Real deployments where towers are down. |

Demo plan:

1. Bring a phone hotspot or travel router just for the team, and do not rely on the venue Wi-Fi.
   Put the Pi, both laptops, and the glasses' phone on it.
2. Use Maincloud for the main demo.
3. Keep a local SpacetimeDB server on Laptop A as a fallback (the quickstarts run one with `spacetime dev`) [S18].
   Switching is a change of URI in each client.
4. Upload video clips over the LAN to Laptop A, not over the internet.

Real deployment: the robot reaches a field gateway (a deployable cell site, a satellite terminal, or a mesh radio) and that gateway reaches the cloud.
LoRa can carry small survivor reports when nothing else works.
Say this in the pitch, but do not build it.

## 6. Navigation for the operator

- Straight-line distance and bearing (no API key): use the haversine formula with R = 6,371 km, and the initial bearing formula `atan2(sin(Δλ)cos(φ2), cos(φ1)sin(φ2) - sin(φ1)cos(φ2)cos(Δλ))`, normalized to 0-360 degrees [S28].
  This is enough for "nearest 40 m north", and it runs on the phone or in the agent.
  Turn the bearing into an arrow relative to the operator's heading.
  The phone's compass gives the heading, because GPS alone gives no heading when standing still.
- Street routes (optional):
  - OSRM demo server: car, foot, and bike profiles, at most 1 request per second, no uptime guarantee, and no API key mentioned [S29].
    Example: `https://router.project-osrm.org/route/v1/foot/<lon1>,<lat1>;<lon2>,<lat2>?steps=true`.
  - openrouteservice: free Standard plan with a key, 2,000 directions requests per day and 40 per minute [S30].
  - Google or Mapbox: paid APIs with keys, not researched further, and not needed.
- After a disaster, street maps may be wrong (blocked roads, collapsed buildings).
  Inside the search area, give the operator a bearing and distance, not a street route.

## 7. Accounts and API keys

| Account or key | Used for | How to get it | Cost |
| --- | --- | --- | --- |
| NVIDIA Developer Program account + `NVIDIA_API_KEY` | Nemotron on the hosted API | build.nvidia.com, a model page, "Get API Key" [S1] | Free for prototyping [S6]. Rate-limited [S7]. |
| SpacetimeDB account (sign in on the website) + CLI login | Maincloud hosting, `spacetime login` | spacetimedb.com, then `spacetime login` [S34] | Free plan 2,500 TeV per month [S35], plus 100,000 TeV hackathon credit per GitHub account with code `HACKUTD2026` |
| GitHub account | Required to redeem the SpacetimeDB credit, and public source is required to win the SpacetimeDB track | github.com | Free |
| SpacetimeDB identity tokens (robot, agent, each operator) | Each client's identity | Created on first connect, or `POST /v1/identity` [S24][S26] | Free |
| Even Realities developer access | Glasses app | Even Hub developer portal; details not confirmed [S37] | Not confirmed |
| openrouteservice key (optional) | Street routes | Free Standard key from the ORS account site [S30] | Free |
| None for OSRM demo or haversine | Routes and bearings | No signup [S28][S29] | Free |
| Brev (optional, not needed) | Self-hosted NIM on a GPU | NVIDIA Brev | Paid per hour [S31]. Hackathon credits are prizes only. |

Keep every key out of the public GitHub repo (use `.env` files listed in `.gitignore`), because the SpacetimeDB track requires public source.

## Could not confirm

- The exact hosted model ids for Nemotron 3 Nano and Llama 3.3 Nemotron Super 49B v1.5.
- Whether the hosted Super endpoint accepts `tools` exactly as the code snippet shows, since its schema omits it [S3].
- The current free credit amount on build.nvidia.com, and the official rate limit number.
- How a SpacetimeDB module stores a secret such as an API key.
- Node.js and Rust SDK support on aarch64 Debian 12.
- Matthew's GPS module model, baud rate, and whether it exposes I2C.
- The range of Matthew's Pi range extender.
- Even Hub developer access terms.

## Sources

- [S1] NVIDIA API quickstart: https://docs.api.nvidia.com/nim/docs/api-quickstart
- [S2] Nemotron 3 Super on build.nvidia.com: https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b
- [S3] Nemotron 3 Super API reference: https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer
- [S4] Nemotron 3 Nano 30B-A3B model card: https://build.nvidia.com/nvidia/nemotron-3-nano-30b-a3b/modelcard and https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b
- [S5] Nemotron 3 Super NVFP4 on Hugging Face (release date): https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4
- [S6] NIM for Developers: https://developer.nvidia.com/nim
- [S7] General NIM FAQ: https://docs.api.nvidia.com/nim/docs/product and forum credits thread: https://forums.developer.nvidia.com/t/api-credits-for-build-nvidia-com/306633
- [S8] Forum, 40 RPM limit: https://forums.developer.nvidia.com/t/request-for-nvidia-build-api-rate-limit-increase-40-rpm-200-rpm/373495
- [S9] Llama 3.3 Nemotron Super 49B v1.5: https://build.nvidia.com/nvidia/llama-3_3-nemotron-super-49b-v1_5 and https://huggingface.co/nvidia/Llama-3_3-Nemotron-Super-49B-v1_5/blob/main/README.md
- [S10] SpacetimeDB docs index (llms.txt): https://spacetimedb.com/docs/llms.txt
- [S11] SpacetimeDB language support: https://spacetimedb.com/docs/intro/language-support/
- [S12] NIM for LLMs function calling: https://docs.nvidia.com/nim/large-language-models/latest/function-calling.html and https://docs.nvidia.com/nim/large-language-models/1.15.0/function-calling.html
- [S13] SpacetimeDB HTTP database API: https://spacetimedb.com/docs/http/database
- [S14] SpacetimeDB C++ quickstart: https://spacetimedb.com/docs/quickstarts/c-plus-plus
- [S15] SpacetimeDB Unreal SDK: https://spacetimedb.com/docs/clients/unreal, https://spacetimedb.com/docs/tutorials/unreal/part-1, https://spacetimedb.com/blog/official-support-for-unreal-engine, community C++ client: https://github.com/jstreibel/SpacetimeDB-Cpp
- [S16] SpacetimeDB TypeScript client: https://spacetimedb.com/docs/clients/typescript
- [S17] Python SDK on PyPI: https://pypi.org/project/spacetimedb-sdk
- [S18] SpacetimeDB Node.js quickstart: https://spacetimedb.com/docs/quickstarts/nodejs
- [S19] SpacetimeDB Rust client: https://spacetimedb.com/docs/clients/rust
- [S20] u-blox NEO-M8 data sheet: https://content.u-blox.com/sites/default/files/NEO-M8-FW3_DataSheet_UBX-15031086.pdf and product summary: https://content.u-blox.com/sites/default/files/products/documents/NEO-M8_ProductSummary_UBX-16000345.pdf
- [S21] SpacetimeDB schedule tables: https://spacetimedb.com/docs/tables/schedule-tables/
- [S22] SpacetimeDB procedures: https://spacetimedb.com/docs/functions/procedures
- [S23] GNSS indoors (Schwieger, FIG 2008): https://www.fig.net/resources/Proceedings/fig_proceedings/fig2008/papers/ts01c/ts01c_01_schwieger_2959.pdf
- [S24] SpacetimeDB HTTP identity API: https://spacetimedb.com/docs/http/identity
- [S25] SpacetimeDB subscriptions: https://spacetimedb.com/docs/clients/subscriptions
- [S26] SpacetimeDB authentication: https://spacetimedb.com/docs/core-concepts/authentication
- [S27] Forum, "Is NIM free": https://forums.developer.nvidia.com/t/is-nim-free/369368
- [S28] Movable Type, lat/long formulas: https://www.movable-type.co.uk/scripts/latlong.html
- [S29] OSRM demo server: https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server
- [S30] openrouteservice plans: https://openrouteservice.org/plans/
- [S31] NVIDIA Brev docs: https://docs.nvidia.com/brev/llms-full.txt
- [S32] NVIDIA Launchables pricing: https://www.nvidia.com/en-us/launchables/pricing
- [S33] SpacetimeDB install: https://spacetimedb.com/install
- [S34] SpacetimeDB Maincloud deploy: https://spacetimedb.com/docs/how-to/deploy/maincloud
- [S35] SpacetimeDB pricing: https://spacetimedb.com/pricing
- [S36] SpacetimeDB docs home: https://spacetimedb.com/docs/
- [S37] Even Realities blog (Even Hub SDK): https://www.evenrealities.com/es-ES/blogs/even-insider/the-unfinished-glasses and launch coverage: https://androidguys.com/news/even-realities-even-hub-app-store-for-g2-smart-glasses-launches/
- [S38] gpsd with a u-blox USB dongle: https://stfn.pl/blog/08-gpsd-linux-ublox/
- [S39] NEO-6M figures (secondary): https://www.altronics.com.au/product/z6318-neo-6m-gps-breakout-module-with-antenna and https://www.sainsmart.com/products/ublox-neo-6m-uart-iic-gps-module-for-arduino
- [S40] Raspberry Pi 4 specifications: https://raspberrypi.com/products/raspberry-pi-4-model-b/specifications/
- [S41] pico-examples PIO UART RX (mirror): https://sourcevu.sysprogs.com/rp2040/examples/pio/uart_rx/files/uart_rx.c and user report: https://gitlab.cba.mit.edu/jakeread/low-level-link-speed-tests/-/commit/ff5e3ffa190c81658a9e12202306ee3149f12a39
- [S42] u-blox DDC address and stream register: https://www.verlab.dcc.ufmg.br/old/_media/projetos/v8/u-blox5_protocol_specifications_gps.g5-x-07036_.pdf and https://iotdk.intel.com/docs/upm/v1.6.0/classupm_1_1_n_m_e_a_g_p_s.html
- [S43] Wi-Fi range (secondary, rough): https://everycalculators.com/how-to-calculate-wifi-router-range.html
- [S44] Semtech, LoRa and LoRaWAN: https://www.semtech.com/uploads/technology/LoRa/lora-and-lorawan.pdf
- [S45] FirstNet deployables: https://firstnet.gov/newsroom/blog/firstnet-deployables-are-unique-offering-emergency-managers
- [S46] Rescue 42 miniCRD for FirstNet: https://urgentcomm.com/enterprise/rescue-42-launches-minicrd-deployable-for-firstnet
