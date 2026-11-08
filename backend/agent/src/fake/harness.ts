// In-process harness: virtual clock, memory store, fake module, MockLLM, and one AgentRuntime per
// agent, each with its own identity. Used by the vitest suites and scripts/scenario.ts.

import { buildAgent } from "../agents/index.ts";
import type { RuntimeDeps } from "../agent-types.ts";
import { VirtualClock } from "../clock.ts";
import { loadConfig, type Config } from "../config.ts";
import { Budget } from "../llm/budget.ts";
import { LlmGateway, ModelHealth } from "../llm/client.ts";
import { DEFAULT_FIXTURE_DIR, loadFixtures, MockLLM, type FixtureRule, type MockPolicy } from "../llm/mock.ts";
import { DEFAULT_POLICIES } from "../llm/policies.ts";
import { Logger, MemoryTrace } from "../log.ts";
import { AgentRuntime } from "../runtime.ts";
import type { AgentName } from "../types.ts";
import { World } from "../world.ts";
import { FakeModule, hexId, type FakeModuleOptions } from "./module.ts";
import { MemoryStore } from "./store.ts";

export interface HarnessOptions {
  env?: Record<string, string>;
  fixtures?: string[];
  rules?: FixtureRule[];
  policies?: Record<string, MockPolicy>;
  module?: FakeModuleOptions;
  verbose?: boolean;
}

export class Harness {
  readonly clock = new VirtualClock();
  readonly store = new MemoryStore();
  readonly module: FakeModule;
  readonly trace = new MemoryTrace();
  readonly log: Logger;
  readonly cfg: Config;
  readonly budget: Budget;
  readonly health: ModelHealth;
  readonly mock: MockLLM;
  readonly llm: LlmGateway;
  readonly world: World;
  readonly runtimes = new Map<AgentName, AgentRuntime>();

  constructor(opts: HarnessOptions = {}) {
    this.cfg = loadConfig({ LLM_MODE: "mock", DRY_RUN: "0", ...(opts.env ?? {}) });
    this.log = new Logger(opts.verbose ? "info" : "error", this.trace, () => this.clock.now());
    this.module = new FakeModule(this.store, this.clock, opts.module);
    this.budget = new Budget(this.cfg.RPM_BUDGET, this.clock);
    this.health = new ModelHealth(this.clock);
    const rules = [...(opts.rules ?? []), ...loadFixtures(opts.fixtures ?? [], DEFAULT_FIXTURE_DIR)];
    this.mock = new MockLLM(rules, this.clock, { ...DEFAULT_POLICIES, ...(opts.policies ?? {}) });
    let seed = 1;
    // Deterministic jitter so runs repeat exactly.
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.llm = new LlmGateway(this.mock, this.budget, this.health, this.clock, rand);
    this.world = new World(this.store, this.clock, (m) => this.log.warn("world", m));
  }

  identity(name: AgentName): string {
    return hexId("agent:" + name);
  }

  deps(): RuntimeDeps {
    // Against the in-process fake module, every write goes to the fake module: it plays the role of
    // the DRY_RUN shadow, so no real reducer ever runs whatever DRY_RUN says.
    return { cfg: this.cfg, clock: this.clock, log: this.log, llm: this.llm, dryRun: "0", fakeModule: true };
  }

  /** Start agents. Each gets its own World (own callsign map), as each live agent has its own cache. */
  async startAgents(names: AgentName[]): Promise<void> {
    for (const n of names) {
      const agent = buildAgent(n, this.cfg);
      const w = new World(this.store, this.clock, (m) => this.log.warn(n, m));
      const rt = new AgentRuntime(agent, this.deps(), w, this.module.actionsFor(this.identity(n)));
      this.runtimes.set(n, rt);
      await rt.start();
    }
    await this.clock.advance(0);
  }

  stopAgent(name: AgentName): void {
    this.runtimes.get(name)?.stop();
  }

  async run(ms: number, step = 250): Promise<void> {
    await this.clock.run(ms, step);
  }

  stop(): void {
    for (const r of this.runtimes.values()) r.stop();
    this.module.stop();
  }
}
