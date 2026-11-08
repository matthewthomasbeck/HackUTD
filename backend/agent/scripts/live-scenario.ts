// Acceptance against an empty disposable local module, actual simulator and primary runtimes.
// The module must already be published. This harness never publishes, resets or calls a model.
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBindings } from "../src/stdb/connect.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(label: string, read: () => T | undefined | Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await read();
    if (value !== undefined) return value;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

interface Worker {
  child: ChildProcess;
  ready: Promise<void>;
  racePending: boolean;
  snapshot(): Promise<any>;
  stop(signal?: NodeJS.Signals): Promise<void>;
}

export async function runLiveScenario(name: string, dryRun: boolean, verbose: boolean): Promise<void> {
  assert(["chain", "kill_orchestrator", "race", "all_down", "budget"].includes(name),
    "--live supports chain, kill_orchestrator, race, all_down and budget (one fresh database per run)");
  assert(!dryRun || name === "chain", "DRY_RUN=1 is supported for chain only");
  const uri = process.env.STDB_URI ?? "http://127.0.0.1:3927";
  const database = process.env.STDB_DATABASE ?? "";
  assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(uri).hostname), "--live requires a local server");
  assert(/^eric-live-[a-z0-9-]+$/.test(database), "use an explicit disposable STDB_DATABASE=eric-live-<name>");
  const tokens = mkdtempSync(join(tmpdir(), "eric-live-scenario-"));
  const workers: Worker[] = [];
  const killOwnedWorkers = () => { for (const w of workers) w.child.kill("SIGKILL"); };
  process.once("exit", killOwnedWorkers);
  let inspector: any;
  let session: any;
  let heartbeat: NodeJS.Timeout | undefined;
  const hardStop = setTimeout(() => {
    console.error("FAIL: live scenario exceeded 120 seconds; stopping owned workers and connections");
    for (const w of workers) w.child.kill("SIGKILL");
    session?.close(); inspector?.disconnect();
    rmSync(tokens, { recursive: true, force: true });
    process.exit(1);
  }, 120_000);
  function worker(agents: string, suffix: string, rpm = 10): Worker {
    const child = fork(fileURLToPath(new URL("./live-worker.ts", import.meta.url)), [], {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, STDB_URI: uri, STDB_DATABASE: database,
        STDB_TOKEN_DIR: join(tokens, suffix), AGENTS: agents, RPM_BUDGET: String(rpm),
        LLM_MODE: "mock", DRY_RUN: dryRun ? "1" : "0", DEBOUNCE_MS: "100", MAX_WAIT_MS: "200",
        LIVE_RACE: name === "race" && agents === "orchestrator" ? "1" : "0",
        LIVE_BUDGET: name === "budget" && suffix === "others" ? "1" : "0",
        TOOL_MODE: "native", TOOL_MODE_SUPER: "native", TOOL_MODE_NANO: "native" },
      stdio: ["ignore", verbose ? "inherit" : "ignore", "inherit", "ipc"],
    });
    let readyDone = false;
    const ready = new Promise<void>((resolve, reject) => {
      child.on("message", (m: any) => {
        if (m.kind === "ready") { readyDone = true; resolve(); }
        if (m.kind === "error") reject(new Error(m.error));
      });
      child.on("error", reject);
      child.on("exit", code => { if (!readyDone) reject(new Error(`worker exited before ready (${code})`)); });
    });
    const result: Worker = {
      child, ready, racePending: false,
      snapshot: () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { child.off("message", onMessage); reject(new Error("worker snapshot timed out")); }, 3000);
        const onMessage = (m: any) => {
          if (m.kind !== "snapshot") return;
          clearTimeout(timeout); child.off("message", onMessage); resolve(m);
        };
        child.on("message", onMessage);
        child.send({ kind: "snapshot" });
      }),
      stop: async (signal = "SIGTERM") => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise<void>(resolve => {
          const escalation = setTimeout(() => child.kill("SIGKILL"), 2000);
          const deadline = setTimeout(resolve, 4000);
          child.once("exit", () => { clearTimeout(escalation); clearTimeout(deadline); resolve(); });
          child.kill(signal);
        });
      },
    };
    child.on("message", (m: any) => { if (m.kind === "race_pending") result.racePending = true; });
    workers.push(result);
    return result;
  }
  try {
    const { DbConnection } = await loadBindings();
    inspector = await new Promise<any>((resolve, reject) => {
      DbConnection.builder().withUri(uri).withDatabaseName(database).onConnect((conn: any) => {
        inspector = conn;
        conn.subscriptionBuilder().onApplied(() => resolve(conn)).onError((c: any) => reject(c.event))
          .subscribe(["SELECT * FROM site", "SELECT * FROM run"]);
      }).onConnectError((_c: any, err: Error) => reject(err)).build();
    });
    assert.equal([...inspector.db.site.iter()].length, 0, "database already contains a site; publish a fresh disposable database");
    // Keep simulator binding imports in its own component. Dynamic URLs avoid making its
    // separate TypeScript project part of the agent typecheck.
    const simRoot = new URL("../../sim/src/", import.meta.url);
    const { loadDemoConfig } = await import(new URL("config.ts", simRoot).href);
    const { SimPool } = await import(new URL("pool.ts", simRoot).href);
    const { SimSession } = await import(new URL("dispatch.ts", simRoot).href);
    const config = loadDemoConfig();
    config.timing.auto_resolve_sim_rescues = false;
    const pool = new SimPool({ uri, database, tokenDirectory: join(tokens, "sim"), env: {} });
    session = new SimSession(config, pool, { persistent: false });
    await session.execute("setup");
    await session.execute(`run start Eric live ${name}`);
    const db = pool.get("sim").connection.db;
    const rows = (table: string): any[] => [...db[table].iter()];
    const silent = new Set<string>();
    const beat = async () => {
      for (const a of pool.list() as any[]) {
        if (a.role === "rescuer" && !silent.has(a.identity)) await a.connection.reducers.rescuerHeartbeat({});
        if (a.role === "robot") await a.connection.reducers.robotHeartbeat({ robotId: a.name, state: { tag: "Ready" }, batteryPct: 95, observedAt: undefined });
      }
    };
    await beat();
    heartbeat = setInterval(() => { void beat().catch(err => console.error("sim heartbeat:", err.message)); }, 1000);
    const site = rows("site")[0];
    await pool.get("sim").connection.reducers.setSiteTimings({ siteId: site.id,
      missionLeaseS: 120, assignmentLeaseS: 120, proposalLeaseS: 120, escalateAfterS: name === "all_down" ? 5 : 60 });
    console.log(`LOCAL ${database}: real simulator, module reducers/subscriptions/timers; mock models only`);

    let primary: Worker;
    let other: Worker | undefined;
    if (name === "budget") {
      const started = Date.now();
      for (const house of [3, 1, 2, 4, 5, 6, 7, 8, 9, 10]) await session.execute(`spawn immediate house ${house}`);
      assert.equal(rows("survivor").length, 10);
      assert(Date.now() - started < 10_000, "ten detections must arrive within ten seconds");
    }
    if (name === "chain") {
      primary = worker("all", "all", 20);
      await primary.ready;
    } else {
      primary = worker("orchestrator", "orchestrator", 10);
      if (name === "budget") {
        await primary.ready;
        await until("startup batches at least two proposals", () => rows("assignment").length >= 2 ? true : undefined);
        other = worker("auditor,comms_agent", "others", 1);
      } else other = worker("comms_agent,auditor", "others", 10);
      await Promise.all([primary.ready, other.ready]);
      if (name === "kill_orchestrator" || name === "all_down") {
        await until("orchestrator watchdog armed", () => rows("agentWatchdog").length ? true : undefined);
        await primary.stop("SIGKILL");
        if (name === "all_down") await other.stop("SIGKILL");
        console.log(`KILLED actual worker process${name === "all_down" ? "es" : ""} before detection`);
      }
    }
    if (name !== "budget") await session.execute("spawn immediate house 3");
    const survivor = await until("simulator detection", () => rows("survivor")[0]);
    const detection = rows("detection").find(d => d.survivorId === survivor.id)!;
    const chain = detection.chainId;
    assert(chain > 0n);
    if (name === "race") {
      await until("orchestrator captured the detection packet", () => primary.racePending ? true : undefined);
      console.log("RACE FIXTURE: actual orchestrator process has a 26-second mock reply in flight; test-only request timeout 30 seconds, subscriptions remain live");
    }

    if (dryRun) {
      const snapshot = await until("shadow review and briefing", async () => {
        const snap = await primary.snapshot();
        return snap.rows.agent_task.some((t: any) => t.kind === "review" && t.status === "done") && snap.rows.briefing.length ? snap : undefined;
      });
      for (const table of ["assignment", "agentTask", "briefing", "agentAction", "mission", "auditFlag"])
        assert.equal(rows(table).length, 0, `dry-run wrote live ${table}`);
      assert(snapshot.rows.assignment.some((a: any) => a.chain_id === Number(chain)));
      assert(snapshot.rows.agent_task.filter((t: any) => ["review", "brief_rescuer"].includes(t.kind)).every((t: any) => t.chain_id === Number(chain)));
      assert(snapshot.rows.briefing.some((b: any) => b.chain_id === Number(chain)));
      const review = snapshot.rows.agent_task.find((t: any) => t.kind === "review" && t.status === "done");
      assert(["agree", "disagree"].includes(JSON.parse(review.result_json).verdict));
      assert(snapshot.trace.some((t: any) => t.tool === "send_briefing" && t.dry_run === "1"));
      console.log(`PASS chain DRY_RUN=1: shadow proposal/review/briefing, chain ${chain}; zero live agent domain/action writes`);
      return;
    }

    const assignment = await until("assignment proposal", () => rows("assignment").find(a => a.survivorId === survivor.id), 40_000);
    assert.equal(assignment.chainId, chain);
    const moduleFallback = ["kill_orchestrator", "all_down", "race"].includes(name);
    if (moduleFallback) {
      assert.equal(assignment.createdBy, "module");
      const fallback = rows("agentAction").find(a => a.agent === "module" && a.tool === "propose_assignment" && a.chainId === chain);
      assert(fallback, "real database fallback action missing");
      assert(rows("eventLog").some(e => e.kind === "agent_watchdog_fallback" && e.entityId === assignment.id));
      assert(["orchestrator watchdog fallback", "unproposed immediate backstop"].includes(fallback.reason));
      if (name === "kill_orchestrator") assert.equal(fallback.reason, "orchestrator watchdog fallback");
      console.log(`PASS ${name}: database schedule fallback, reason ${fallback.reason}, chain ${chain}`);
    } else assert.equal(assignment.createdBy, "orchestrator");

    if (name !== "all_down") {
      const review = await until("completed review", () => rows("agentTask").find(t => t.kind === "review" && t.chainId === chain && t.status.tag === "Done"), name === "budget" ? 40_000 : 15_000);
      assert(["agree", "disagree"].includes(JSON.parse(review.resultJson).verdict));
      const briefing = await until("comms briefing", () => rows("briefing").find(b => b.survivorId === survivor.id && b.kind?.tag === "Briefing"), 15_000);
      assert.equal(briefing.chainId, chain);
      assert.equal(briefing.audience, assignment.rescuerIdentity.toHexString());
      if (name === "chain") {
        const task = rows("agentTask").find(t => t.kind === "brief_rescuer" && t.chainId === chain);
        assert.equal(task?.status.tag, "Done");
        console.log(`PASS chain: survivor ${survivor.id}, proposal ${assignment.id}, review ${review.id}, briefing ${briefing.id}; chain ${chain}`);
      }
      if (name === "kill_orchestrator") assert.match(briefing.text, /RULES FALLBACK/);
      if (name === "race") {
        await until("late proposal rejected", () => rows("agentAction").find(a =>
          a.agent === "orchestrator" && a.tool === "propose_assignment" && a.result.includes("already proposed by watchdog")));
        assert.equal(rows("assignment").filter(a => a.survivorId === survivor.id).length, 1);
        console.log("PASS race: late orchestrator proposal rejected as already proposed by watchdog; exactly one proposal");
      }
    }
    const rescuer = pool.list().find((a: any) => a.identity === assignment.rescuerIdentity.toHexString());
    assert(rescuer, "proposal must target a simulator rescuer");
    await rescuer.connection.reducers.acceptAssignment({ assignmentId: assignment.id });
    await until("simulated acknowledgement", () => rows("survivor").find(s => s.id === survivor.id && s.status.tag === "Assigned"));
    if (name === "all_down") {
      assert(rows("briefing").some(b => b.survivorId === survivor.id && b.priority.tag === "Critical" && b.audience === "all"));
      silent.add(rescuer.identity);
      const released = await until("database heartbeat release", () => rows("assignment").find(a => a.id === assignment.id && a.status.tag === "Released"), 20_000);
      assert.equal(released.releaseCause?.tag, "Heartbeat");
      const replacement = await until("database replacement proposal", () => rows("assignment").find(a => a.survivorId === survivor.id && a.id !== assignment.id && a.status.tag === "Proposed"), 25_000);
      const next = pool.list().find((a: any) => a.identity === replacement.rescuerIdentity.toHexString());
      assert(next);
      await next.connection.reducers.acceptAssignment({ assignmentId: replacement.id });
      await until("replacement acknowledged", () => rows("survivor").find(s => s.id === survivor.id && s.status.tag === "Assigned"));
      console.log("PASS all_down: real escalation briefing, 15-second heartbeat release, module replacement proposal and simulated acknowledgement");
    }
    if (name === "budget") {
      await until("all ten survivors acknowledged", async () => {
        for (const a of rows("assignment").filter(a => a.status.tag === "Proposed")) {
          const actor = pool.list().find((p: any) => p.identity === a.rescuerIdentity.toHexString());
          if (actor) await actor.connection.reducers.acceptAssignment({ assignmentId: a.id });
        }
        return rows("survivor").every(s => s.status.tag === "Assigned") ? true : undefined;
      }, 85_000);
      const snapshots = await Promise.all([primary.snapshot(), other!.snapshot()]);
      const requests = snapshots.flatMap(s => s.requests).sort((a, b) => a.at - b.at);
      for (const req of requests) assert(requests.filter(r => r.at > req.at - 60_000 && r.at <= req.at).length <= 20,
        "combined actual model sends exceeded 20 per rolling minute");
      assert(snapshots.every(s => s.limited === 0), "mock server received a 429-producing flood");
      assert(rows("agentAction").some(a => a.agent === "auditor" && a.model === "rules"), "auditor must fall back under the depleted budget");
      const drops = snapshots.flatMap(s => s.drops).sort((a, b) => a.at - b.at);
      assert.equal(drops[0]?.agent, "auditor", "auditor must be the first agent dropped by the depleted queue");
      const firstWake = snapshots[0].trace.findIndex((t: any) => t.event === "wake");
      const nextWake = snapshots[0].trace.findIndex((t: any, i: number) => i > firstWake && t.event === "wake");
      const firstCycle = snapshots[0].trace.slice(firstWake, nextWake < 0 ? undefined : nextWake);
      assert(firstCycle.filter((t: any) => t.tool === "propose_assignment" && t.result.startsWith("ok")).length >= 2,
        "one orchestrator cycle must cover several survivors");
      console.log(`PASS budget: ten detections in ten seconds, all acknowledged; ${requests.length} model sends, <=20 per rolling minute, no mock 429s, batched proposals, first budget drop auditor`);
      console.log("BUDGET FIXTURE: orchestrator 10 RPM, shared auditor/comms 1 RPM; initial other-worker grant consumed without model send; auditor starts 500 ms before comms");
    }
    console.log(`PASS ${name}: simulated rescuer acknowledged; survivor assigned (not resolved)`);
  } finally {
    clearTimeout(hardStop);
    if (heartbeat) clearInterval(heartbeat);
    await Promise.all(workers.map(w => w.stop()));
    session?.close();
    inspector?.disconnect();
    rmSync(tokens, { recursive: true, force: true });
    process.off("exit", killOwnedWorkers);
  }
}
