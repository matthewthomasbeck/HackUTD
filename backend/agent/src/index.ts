// Start the agents named in AGENTS against the live module (agent.md 3.3).
//   npm start                    real model, real reducers
//   DRY_RUN=1 npm start          no reducer at all; writes play out in an in-process shadow
//   DRY_RUN=log npm start        the same, plus log_agent_action rows with "dry_run: not executed"
//   LLM_MODE=mock ...            MockLLM replays test/fixtures/ (our addition, see README.md)

import "dotenv/config";
import { DryRunActions, type Actions } from "./actions.ts";
import { buildAgent } from "./agents/index.ts";
import { RealClock } from "./clock.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { FakeModule } from "./fake/module.ts";
import { OverlayStore } from "./fake/store.ts";
import { Budget } from "./llm/budget.ts";
import { LlmGateway, ModelHealth, NvidiaProvider } from "./llm/client.ts";
import { DEFAULT_FIXTURE_DIR, loadFixtures, MockLLM } from "./llm/mock.ts";
import { DEFAULT_POLICIES } from "./llm/policies.ts";
import type { LlmProvider } from "./llm/types.ts";
import { FileTrace, Logger } from "./log.ts";
import { AgentRuntime } from "./runtime.ts";
import { BindingsMissingError, LiveConnection } from "./stdb/connect.ts";
import type { TableSource } from "./types.ts";
import { World } from "./world.ts";

async function main(): Promise<number> {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`config: ${err.message}`);
      return 2;
    }
    throw err;
  }
  const clock = new RealClock();
  const log = new Logger(cfg.LOG_LEVEL, new FileTrace("logs"));
  const budget = new Budget(cfg.RPM_BUDGET, clock);
  const health = new ModelHealth(clock);
  let provider: LlmProvider;
  if (cfg.LLM_MODE === "mock") {
    const names = [...cfg.MOCK_FIXTURES.filter((n) => n !== "common"), "common"];
    provider = new MockLLM(loadFixtures(names, DEFAULT_FIXTURE_DIR), clock, DEFAULT_POLICIES);
    log.info("runner", `LLM_MODE=mock with fixtures ${names.join(", ")}`);
  } else provider = new NvidiaProvider(cfg.NVIDIA_API_KEY, cfg.NVIDIA_BASE_URL);
  const llm = new LlmGateway(provider, budget, health, clock);

  const conns: LiveConnection[] = [];
  const runtimes: AgentRuntime[] = [];
  let overlay: OverlayStore | null = null;
  let shadow: FakeModule | null = null;

  for (const name of cfg.AGENTS) {
    let conn: LiveConnection;
    try {
      conn = await LiveConnection.open(cfg, name, log);
    } catch (err) {
      if (err instanceof BindingsMissingError) {
        console.error(err.message);
        return 2;
      }
      throw err;
    }
    conns.push(conn);
    let source: TableSource = conn;
    let actions: Actions = conn;
    if (cfg.DRY_RUN !== "0") {
      // One shadow for the process, so a task one agent posts reaches another in-process.
      overlay ??= new OverlayStore(conn);
      shadow ??= new FakeModule(overlay, clock, { timers: false });
      source = overlay;
      actions = new DryRunActions(conn, cfg.DRY_RUN, shadow.actionsFor(conn.identityHex));
    }
    const world = new World(source, clock, (m) => log.warn(name, m));
    const rt = new AgentRuntime(buildAgent(name, cfg), { cfg, clock, log, llm, dryRun: cfg.DRY_RUN }, world, actions);
    runtimes.push(rt);
    await rt.start();
    const run = world.activeRun();
    log.info(name, `identity ${conn.identityHex}; active run ${run ? `#${run.id} "${run.name}"` : "none (waiting for a run)"}`);
  }
  log.info("runner", `running ${cfg.AGENTS.join(", ")}; DRY_RUN=${cfg.DRY_RUN}; budget ${cfg.RPM_BUDGET}/min`);

  await new Promise<void>((resolve) => {
    const stop = () => {
      log.info("runner", "stopping");
      for (const r of runtimes) r.stop();
      for (const c of conns) c.close();
      clock.clearAll();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
