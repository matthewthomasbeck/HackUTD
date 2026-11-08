// Live adapter acceptance, using an empty, disposable local database only.
// Publish the module first; README.md has the commands. No model calls are made.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { Logger } from "../src/log.ts";
import { LiveConnection, loadBindings } from "../src/stdb/connect.ts";

const uri = process.env.STDB_URI ?? "http://127.0.0.1:3918";
const database = process.env.STDB_DATABASE ?? "eric-transition";
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(uri).hostname), "smoke requires a local server");
const tokens = mkdtempSync(join(tmpdir(), "eric-stdb-smoke-"));
const agents: LiveConnection[] = [];
// Keep generated binding imports behind the existing adapter boundary.
let seed: any;
let rescuer: any;
const timeout = setTimeout(() => { console.error("FAIL: live smoke exceeded 30 s"); process.exit(1); }, 30_000);
async function until<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for subscribed state");
}
try {
  const { DbConnection } = await loadBindings();
  seed = await new Promise<any>((resolve, reject) => {
    DbConnection.builder().withUri(uri).withDatabaseName(database)
      .onConnect((conn: any) => {
        seed = conn;
        conn.subscriptionBuilder().onApplied(() => resolve(conn))
          .onError((ctx: any) => reject(ctx.event))
          .subscribe(["SELECT * FROM site", "SELECT * FROM run"]);
      }).onConnectError((_ctx: any, err: Error) => reject(err)).build();
  });
  assert.equal([...seed.db.site.iter()].length, 0, "use a fresh disposable database; existing site found");
  await seed.reducers.registerParticipant({ name: "adapter-smoke", role: { tag: "Sim" } });
  await seed.reducers.createSite({ name: "Adapter smoke (simulated)", centerLat: 32.99, centerLon: -96.75,
    radiusM: 483, demoMode: true, requireMissionApproval: true });
  const site = await until(() => [...seed!.db.site.iter()][0]);
  await seed.reducers.startRun({ siteId: site.id, name: "Eric adapter acceptance" });
  const cfg = loadConfig({ LLM_MODE: "mock", STDB_URI: uri, STDB_DATABASE: database, STDB_TOKEN_DIR: tokens });
  for (const name of ["orchestrator", "auditor", "comms_agent"] as const) {
    const conn = await LiveConnection.open(cfg, name, new Logger("warn"));
    agents.push(conn);
    await conn.registerParticipant(name, name === "auditor" ? "auditor" : "agent");
    await conn.agentHeartbeat();
    assert.equal(conn.rows("run")[0]?.name, "Eric adapter acceptance");
  }
  const [orchestrator, auditor, comms] = agents;
  await until(() => orchestrator.rows("participant").length === 4 ? true : undefined);
  for (const conn of agents) {
    const participant = orchestrator.rows("participant").find(p => p.identity === conn.identityHex)!;
    assert.equal(typeof participant.last_heartbeat, "number");
    assert.equal(participant.online, true);
  }
  console.log("PASS: three live identities registered; timestamps, roles and active run decoded");
  // Exercise both task enum spellings, optional fields, claims, completion and action logging.
  for (const [recipient, name] of [[auditor, "auditor"], [comms, "comms_agent"]] as const) {
    await orchestrator.postAgentTask(name, "adapter_smoke", "{}", "normal", "adapter acceptance", 0);
    const task = await until(() => recipient.rows("agent_task").find(t => t.to_agent === name && t.kind === "adapter_smoke"));
    await recipient.claimAgentTask(task.id);
    await recipient.logAgentAction("adapter_smoke", "{}", "ok", "adapter acceptance", 1, "rules", task.chain_id);
    await recipient.completeAgentTask(task.id, "done", '{"ok":true}');
    await until(() => orchestrator.rows("agent_task").find(t => t.id === task.id && t.status === "done"));
    await until(() => orchestrator.rows("agent_action").find(a => a.tool === "adapter_smoke" && a.agent === name));
    console.log(`PASS: ${name} task post/claim/log/complete round trip`);
  }
  // Leave one deterministic simulated survivor for perception/scripts/smoke_stdb.py.
  await seed.reducers.robotHeartbeat({ robotId: "simdog", state: { tag: "Ready" }, batteryPct: 95, observedAt: undefined });
  await seed.reducers.reportDetection({ robotId: "simdog", missionId: 0n, source: { tag: "Thermal" },
    clientRef: "adapter-smoke", lat: 32.99, lon: -96.75, gpsFix: false,
    locationNote: "simulated adapter fixture", maxTempC: 36, thermalConfidence: 0.9,
    thermalImageUrl: undefined, cameraImageUrl: undefined, breathingClipUrl: undefined, observedAt: undefined });
  const survivor = await until(() => orchestrator.rows("survivor")[0]);
  assert.equal(survivor.status, "unassigned");
  assert.equal(orchestrator.rows("robot")[0]?.state, "READY");
  assert.equal(typeof survivor.created_at, "number");
  console.log(`PASS: detection/survivor/robot decoded; run ${orchestrator.rows("run")[0].id}, survivor ${survivor.id}`);
  rescuer = await new Promise<any>((resolve, reject) => {
    DbConnection.builder().withUri(uri).withDatabaseName(database)
      .onConnect((conn: any) => { rescuer = conn; resolve(conn); })
      .onConnectError((_ctx: any, err: Error) => reject(err)).build();
  });
  await rescuer.reducers.registerParticipant({ name: "Rescuer (sim)", role: { tag: "Rescuer" } });
  await rescuer.reducers.participantUpdatePosition({ lat: 32.99, lon: -96.75 });
  await rescuer.reducers.rescuerHeartbeat({});
  const person = await until(() => orchestrator.rows("participant").find(p => p.name === "Rescuer (sim)" && p.online));
  await orchestrator.proposeAssignment(survivor.id, person.identity, "local adapter acceptance");
  const assignment = await until(() => orchestrator.rows("assignment").find(a => a.survivor_id === survivor.id));
  const review = await until(() => auditor.rows("agent_task").find(t => t.kind === "review"));
  assert.equal(review.chain_id, assignment.chain_id);
  await auditor.claimAgentTask(review.id);
  await auditor.completeAgentTask(review.id, "done", '{"verdict":"agree","reason":"adapter acceptance only"}');
  await comms.postBriefing(person.identity, "Simulated survivor: request human assessment.", "critical", survivor.id, "briefing");
  await until(() => orchestrator.rows("briefing").find(b => b.survivor_id === survivor.id));
  await rescuer.reducers.acceptAssignment({ assignmentId: BigInt(assignment.id) });
  await until(() => orchestrator.rows("assignment").find(a => a.id === assignment.id && a.status === "active"));
  await orchestrator.createMission("simdog", "inspect", [], 32.99, -96.75, "adapter acceptance", assignment.chain_id);
  const mission = await until(() => orchestrator.rows("mission")[0]);
  await orchestrator.cancelOwnMission(mission.id);
  console.log(`PASS: Identity proposal, review, briefing, simulated acknowledgement and optional mission args; chain ${assignment.chain_id}`);
} finally {
  clearTimeout(timeout);
  for (const conn of agents) conn.close();
  seed?.disconnect();
  rescuer?.disconnect();
  rmSync(tokens, { recursive: true, force: true });
}
