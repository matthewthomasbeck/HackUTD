// Child process for local --live scenarios. Uses the primary runtime and a scripted model.
// IPC carries evidence back to the scenario parent; no NVIDIA provider is constructed.
import { DryRunActions } from "../src/actions.ts";
import { buildAgent } from "../src/agents/index.ts";
import { RealClock } from "../src/clock.ts";
import { loadConfig } from "../src/config.ts";
import { FakeModule } from "../src/fake/module.ts";
import { OverlayStore } from "../src/fake/store.ts";
import { Budget } from "../src/llm/budget.ts";
import { LlmGateway, ModelHealth } from "../src/llm/client.ts";
import { DEFAULT_FIXTURE_DIR, loadFixtures, MockLLM } from "../src/llm/mock.ts";
import { DEFAULT_POLICIES } from "../src/llm/policies.ts";
import { Logger, MemoryTrace } from "../src/log.ts";
import { AgentRuntime } from "../src/runtime.ts";
import { LiveConnection } from "../src/stdb/connect.ts";
import { TABLE_NAMES, type TableSource } from "../src/types.ts";
import { World } from "../src/world.ts";

const cfg = loadConfig({ ...process.env, LLM_MODE: "mock" });
const clock = new RealClock();
const trace = new MemoryTrace();
const log = new Logger("warn", trace);
const health = new ModelHealth(clock);
const mock = new MockLLM([
  ...(process.env.LIVE_RACE === "1" ? [{ agent: "orchestrator", contains: ["#1 house 3"], turn: 0, delay_ms: 26_000, policy: "greedy_orchestrator" }] : []),
  { agent: "orchestrator", turn: 0, policy: "greedy_orchestrator" },
  ...loadFixtures(["common"], DEFAULT_FIXTURE_DIR),
], clock, DEFAULT_POLICIES);
const provider = { send: (req: import("../src/llm/types.ts").ChatRequest) => {
  if (process.env.LIVE_RACE === "1" && req.agent === "orchestrator" &&
      req.messages.some(m => m.role === "user" && /#1 house 3/.test(m.content ?? "")))
    process.send?.({ kind: "race_pending" });
  return mock.send(req);
} };
const budget = new Budget(cfg.RPM_BUDGET, clock);
const llm = new LlmGateway(provider, budget, health, clock);
const connections: LiveConnection[] = [];
const runtimes: AgentRuntime[] = [];
let source: TableSource | undefined;
let overlay: OverlayStore | undefined;
let shadow: FakeModule | undefined;

process.on("message", message => {
  if ((message as any)?.kind === "snapshot" && source) process.send?.({
    kind: "snapshot", rows: Object.fromEntries(TABLE_NAMES.map(t => [t, source!.rows(t)])),
    trace: trace.lines, requests: mock.requests, limited: mock.limited, drops: budget.drops, grants: budget.grants,
  });
});
function stop() {
  for (const rt of runtimes) rt.stop();
  for (const conn of connections) conn.close();
  clock.clearAll();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("disconnect", stop);

try {
  if (process.env.LIVE_BUDGET === "1") {
    // Controlled depleted-budget fixture: consume the initial grant without sending a
    // model request. Both real agent cycles then contend for the same primary Budget.
    await budget.acquire({ agent: "comms_agent", priority: "critical", deadlineAt: Date.now() + 1000 });
  }
  for (const name of cfg.AGENTS) {
    if (process.env.LIVE_BUDGET === "1" && name === "comms_agent") await clock.sleep(500);
    const conn = await LiveConnection.open(cfg, name, log);
    connections.push(conn);
    source = conn;
    let actions = conn as import("../src/actions.ts").Actions;
    if (cfg.DRY_RUN !== "0") {
      overlay ??= new OverlayStore(conn);
      shadow ??= new FakeModule(overlay, clock, { timers: false });
      source = overlay;
      actions = new DryRunActions(conn, cfg.DRY_RUN, shadow.actionsFor(conn.identityHex));
    }
    const agent = buildAgent(name, cfg);
    // Failure injection only: let the deliberately late reply reach the write guard.
    // Production's 15-second request timeout would discard it before that guard.
    if (process.env.LIVE_RACE === "1" && name === "orchestrator") agent.timeoutMs = 30_000;
    const rt = new AgentRuntime(agent, { cfg, clock, log, llm, dryRun: cfg.DRY_RUN },
      new World(source, clock), actions);
    runtimes.push(rt);
    await rt.start();
  }
  // The orchestrator's full subscription is the evidence source for a combined worker.
  source = overlay ?? connections.find(c => c.name === "orchestrator") ?? connections[0];
  process.send?.({ kind: "ready", pid: process.pid, agents: cfg.AGENTS });
} catch (err) {
  process.send?.({ kind: "error", error: String(err) });
  process.exit(1);
}
