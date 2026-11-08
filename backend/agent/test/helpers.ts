// Test helpers: a seeded fake world (FakeWorld), recording FakeActions, and a CycleCtx builder.

import { newCycleState, newMemory, type CycleCtx, type CycleInput } from "../src/agent-types.ts";
import { buildAgent } from "../src/agents/index.ts";
import { Board } from "../src/board.ts";
import { Harness, type HarnessOptions } from "../src/fake/harness.ts";
import type { AgentName, AgentTask } from "../src/types.ts";
import { World } from "../src/world.ts";
import { at, CENTER, house, RESCUER } from "../scripts/scenarios.ts";

export { at, house, RESCUER };

/** A fake world with a site, a run, six houses, dog1 idle at the center, and rescuers A (40 m from house 3) and B (120 m). */
export function fakeWorld(opts: HarnessOptions = {}) {
  const h = new Harness(opts);
  const m = h.module;
  m.createSite({ name: "test", center_lat: CENTER.lat, center_lon: CENTER.lon, demo_mode: true, require_mission_approval: true });
  m.startRun("test run");
  const cells = [1, 2, 3, 4, 5, 6].map((k) => m.addCell(`house ${k}`, house(k).lat, house(k).lon));
  m.addRobot("dog1", CENTER.lat, CENTER.lon);
  const a = at(75, 40);
  const b = at(75, -120);
  m.addRescuer("Ana Lopez", a.lat, a.lon, RESCUER.A);
  m.addRescuer("Ben Okafor", b.lat, b.lon, RESCUER.B);
  for (const n of ["orchestrator", "comms_agent", "auditor"] as AgentName[])
    m.registerParticipant(h.identity(n), n, n === "auditor" ? "auditor" : "agent");
  return { h, m, cells };
}

export function survivorAt(h: Harness, k: number, extra: Partial<Parameters<Harness["module"]["addSurvivor"]>[0]> = {}): number {
  const cell = h.store.rows("search_cell").find((c) => c.label === `house ${k}`)!;
  return h.module.addSurvivor({
    ...house(k),
    cell_id: cell.id,
    house_label: `house ${k}`,
    location_note: "8 m in from front door",
    level: "immediate",
    score: 78,
    breathing: "detected",
    rate: 34,
    conf: 0.71,
    ...extra,
  });
}

/** A cycle context for one agent, with its own World, the fake module's actions, and an optional task. */
export function ctxFor(h: Harness, name: AgentName, task: AgentTask | null = null, input: Partial<CycleInput> = {}): CycleCtx {
  const agent = buildAgent(name, h.cfg);
  const world = new World(h.store, h.clock);
  const actions = h.module.actionsFor(h.identity(name));
  const now = h.clock.now();
  return {
    agent,
    deps: h.deps(),
    world,
    actions,
    board: new Board(actions),
    input: { agent: name, wakes: [], task, chainId: task?.chain_id ?? 0, priority: "high", deadlineAt: now + 60_000, startedAt: now, ...input },
    state: newCycleState(agent.model),
    memory: newMemory(),
  };
}

/** Post a task as if another agent did, then claim it as `to`. */
export function postAndClaim(h: Harness, from: AgentName, to: AgentName, kind: string, payload: Record<string, unknown>, chain = 0): AgentTask {
  h.module.postAgentTask(h.identity(from), to, kind, JSON.stringify(payload), "high", "test", chain);
  const t = h.store.rows("agent_task").at(-1)!;
  h.module.claimAgentTask(h.identity(to), t.id);
  return h.store.get("agent_task", t.id)!;
}
