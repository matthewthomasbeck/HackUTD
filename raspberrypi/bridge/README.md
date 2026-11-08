# Robot bridge (Node.js)

Holds the robot's one SpacetimeDB connection and talks to the C++ program over a Unix socket (task R3, `docs/specs/robot.md` section 9, `docs/specs/CONTRACTS.md` "Robot bridge local protocol").
It maps each robot message to a reducer, uploads media to the perception service's media server, leases missions with `claim_next_mission`, and spools to a file while SpacetimeDB is unreachable.
It imports the generated bindings from `../../backend/spacetimedb-bindings`; do not copy them here.

Node 22 or newer.

## Files

| File | Job |
| --- | --- |
| `src/index.ts` | wiring, timers, shutdown |
| `src/config.ts` | `.env` keys and the per-server token file name |
| `src/stdb.ts` | connect, own backoff (1, 2, 4 ... 30 s) on top of `withAutomaticReconnect`, token file (0600), six subscriptions, `register_participant`, reducer calls and `claim_next_mission` with a 15 s timeout |
| `src/local_socket.ts` | Unix socket server, one client at a time, NDJSON |
| `src/mapping.ts` | pure: local message to reducer name and arguments |
| `src/to_wire.ts` | pure: mission and site rows to the JSON lines sent to the robot |
| `src/enums.ts` | contract enum spellings and binding tags |
| `src/router.ts` | send now or spool, keeping order |
| `src/spool.ts` | spool file and replay |
| `src/media.ts` | uploads, `report_detection`, survivor lookup by `client_ref`, `POST /breathing` |
| `src/missions.ts` | claim gating, forwarding `leased` missions, `cancel` for any forwarded mission that stops being this robot's open row |

## Run on a laptop

1. Start a local SpacetimeDB and publish the module (see `docs/specs/spacetimedb.md`; `spacetime start`, then from `backend/spacetimedb` `npm run publish:local`).
   Create a demo-mode site (the simulator's `npm run sim -- setup` does), so the `robot` role needs no `grant_role`.
2. Optional: start the perception service and media server (`backend/perception/`). Without it, uploads fail after their retries and detections are still reported with no URLs.
3. Start the bridge:

```
cd raspberrypi/bridge
npm install
cp .env.example .env      # local values: ws://localhost:3000, assess-0hw81, /tmp/robot-bridge.sock
npm run dev               # tsx watch; npm start runs it once without watching
```

The first run creates a new identity and prints its hex; the token is saved to `BRIDGE_TOKEN_FILE` plus the server host (for example `./.data/token.localhost_3000`), so Maincloud and the local server each keep their own identity.
Outside demo mode a coordinator must `grant_role` that identity the `robot` role; the bridge retries `register_participant` every 5 s and spools until it succeeds.

4. Start the C++ program in laptop mode (every device mocked), with `bridge.socket` set to the same path as `BRIDGE_SOCKET`:

```
cd raspberrypi/robot
./build/robot --config config/robot.laptop.yaml
```

5. Check the board:

```
spacetime sql assess-0hw81 "SELECT * FROM robot" --server local
spacetime sql assess-0hw81 "SELECT * FROM device_status" --server local
```

## Checks

```
npm test            # node --test with tsx
npx tsc --noEmit    # or npm run typecheck
```

## Behavior worth knowing

- Heartbeats are sent live whenever connected and never spooled. Every other message waits in the spool until the robot row exists, because the module answers "heartbeat first" before the first `robot_heartbeat`.
- Messages with `mission_id` 0 (local `robotctl` missions) are logged and not sent. Positions and terrain with no `lat`/`lon` (location mode unknown) are logged and not sent.
- A reducer that throws `SenderError` is logged and skipped; only network failures (not connected, not acknowledged in 15 s) go to the spool.
- Order: once anything is spooled or queued, later messages (except heartbeats) wait behind it, also across a disconnect that happens while a send is in flight. A position or terrain whose send fails is spooled only if no newer one has arrived.
- Spool: `{seq, observed_at, msg}` JSON lines; fsync after detection, cell, and mission_progress; only the newest position and terrain are kept (compared by `observed_at`, then `seq`, so an older one arriving late never replaces a newer one); past `SPOOL_MAX_MB` positions, terrain, then device lines are dropped, never detections. Replay is in file order with the original `observed_at`, and is at least once (a crash mid-replay sends the replayed part again).
- A detection whose `client_ref` is already in the `detection` table is skipped, so the robot's outbox replay after a bridge restart does not report it twice. A spooled detection skipped this way still starts `POST /breathing` if it carries an uploaded clip URL.
- When a new C++ client connects, the bridge resends the site and the current `leased` or `active` mission, so a restarted robot program gets its mission back.
- After a bridge restart mid-mission the `active` row arrives as an insert and is not sent at once; the first heartbeat that says `READY` makes the bridge forward it. The C++ program ignores a `mission` whose id it is already running, so resends are safe.
- Cancel is level-triggered: a mission that was forwarded (or is current) gets `{"type":"cancel","mission_id":id}` when its row stops being this robot's `leased` or `active` row for any reason except `done` or `failed` (cancelled, lease expired and requeued, proposed, reassigned to another robot, deleted). A cancel that cannot be sent (no C++ client) waits and goes out, before any mission, on the next successful send or client connect. After the cancel the robot says `READY` and the normal claim path leases a mission again; a requeued mission that is re-leased is forwarded again.
- Reconnects: each connect starts a new generation, and callbacks from a replaced connection are ignored, so a failed first connect arms exactly one reconnect timer. Spool disk errors (for example `ENOSPC`) are logged and do not crash the bridge.

## Not built yet

- `STDB_MODE=http` (robot.md 9.10) logs a line and uses the SDK.
- `upload-logs` (robot.md section 11) and the optional `terrain_hint` forwarding from `POST /terrain` (robot.md 9.4).
- `npm start` runs through `tsx`, not a `dist/` build, because the bindings import `spacetimedb` from outside this folder; `robot-bridge.service` (robot.md 14.2) should run `npx tsx src/index.ts` or `npm start`.
