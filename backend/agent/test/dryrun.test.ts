// DRY_RUN modes (agent.md 12.2) over a "live" store that stands in for the real module, with the
// shadow FakeModule over an overlay, exactly as index.ts wires them. LLM_MODE=mock throughout.

import { describe, expect, it } from "vitest";
import { DryRunActions, DRY_RESULT } from "../src/actions.ts";
import { buildAgent } from "../src/agents/index.ts";
import { FakeModule } from "../src/fake/module.ts";
import { OverlayStore } from "../src/fake/store.ts";
import { AgentRuntime } from "../src/runtime.ts";
import type { AgentName, TableName } from "../src/types.ts";
import { World } from "../src/world.ts";
import { fakeWorld, survivorAt } from "./helpers.ts";

const WRITE_TABLES: TableName[] = ["agent_task", "agent_action", "assignment", "briefing", "mission", "audit_flag"];

async function runDry(mode: "1" | "log") {
  const { h, m, cells } = fakeWorld({ fixtures: ["chain", "common"], env: { DRY_RUN: mode } });
  // The robot is busy, as in the chain scenario, so the orchestrator plans only the inspect mission.
  m.setRobot("dog1", { state: "ACTIVE", current_mission_id: 99 });
  m.reportPerson(cells[2].id, "missing", 2);
  const counts = () => Object.fromEntries(WRITE_TABLES.map((t) => [t, h.store.rows(t).length]));
  const overlay = new OverlayStore(h.store);
  const shadow = new FakeModule(overlay, h.clock, { timers: false });
  const runtimes: AgentRuntime[] = [];
  for (const name of ["orchestrator", "comms_agent", "auditor"] as AgentName[]) {
    const id = h.identity(name);
    const actions = new DryRunActions(h.module.actionsFor(id), mode, shadow.actionsFor(id));
    const rt = new AgentRuntime(buildAgent(name, h.cfg), { ...h.deps(), dryRun: mode, fakeModule: false }, new World(overlay, h.clock), actions);
    runtimes.push(rt);
    await rt.start();
  }
  const before = counts();
  survivorAt(h, 3, { location_note: "8 m in from front door" });
  const sid = h.store.rows("survivor")[0].id;
  const chain = h.module.survivorChain(sid);
  await h.run(20_000);
  for (const r of runtimes) r.stop();
  return { h, overlay, before, after: counts(), chain, sid };
}

describe("DRY_RUN=1", () => {
  it("logs a full chain in-process and leaves the live tables unchanged", async () => {
    const { h, overlay, before, after, chain } = await runDry("1");
    expect(after).toEqual(before);
    expect(h.module.calls.filter((c) => c.reducer !== "register_participant" && !c.error).length).toBe(0);
    const tasks = overlay.rows("agent_task");
    expect(tasks.some((t) => t.kind === "brief_rescuer" && t.chain_id === chain)).toBe(true);
    expect(tasks.some((t) => t.kind === "review" && t.chain_id === chain && t.status === "done")).toBe(true);
    expect(overlay.rows("assignment").some((a) => a.created_by === "orchestrator" && a.chain_id === chain)).toBe(true);
    expect(overlay.rows("briefing").some((b) => b.chain_id === chain && b.text.length <= 120)).toBe(true);
    // Write tools answered the model with dry_run: true.
    const trace = h.trace.lines.filter((l) => l.tool === "propose_assignment");
    expect((trace[0]?.full_result as any)?.result?.dry_run).toBe(true);
  });
});

describe("DRY_RUN=log", () => {
  it("only log_agent_action reaches the module, with result 'dry_run: not executed'", async () => {
    const { h, before, after } = await runDry("log");
    expect(after.agent_action).toBeGreaterThan(before.agent_action);
    for (const t of WRITE_TABLES.filter((x) => x !== "agent_action")) expect(after[t]).toBe(before[t]);
    expect(h.store.rows("agent_action").every((a) => a.result === DRY_RESULT)).toBe(true);
    const tools = new Set(h.store.rows("agent_action").map((a) => a.tool));
    for (const t of ["propose_assignment", "delegate", "create_mission", "send_briefing", "submit_review"]) expect(tools.has(t)).toBe(true);
  });
});

describe("DRY_RUN=1 without a shadow", () => {
  it("write tools return {ok:true, dry_run:true} and call no reducer", async () => {
    const { h } = fakeWorld({ env: { DRY_RUN: "1" } });
    const sid = survivorAt(h, 3);
    const actions = new DryRunActions(h.module.actionsFor(h.identity("orchestrator")), "1");
    const { dispatch } = await import("../src/tools/dispatch.ts");
    const { ctxFor } = await import("./helpers.ts");
    const ctx = { ...ctxFor(h, "orchestrator"), actions, deps: { ...h.deps(), dryRun: "1" as const } };
    const n = h.module.calls.length;
    const r = await dispatch(ctx, "propose_assignment", { reason: "IMMEDIATE, A nearest at 40 m", survivor_id: sid, rescuer_identity: "a".repeat(64) }, "m");
    expect(r).toMatchObject({ ok: true, result: { ok: true, dry_run: true } });
    expect(h.module.calls.length).toBe(n);
  });
});
