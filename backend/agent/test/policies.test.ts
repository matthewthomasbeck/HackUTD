import { describe, expect, it } from "vitest";
import { orchestratorPacket } from "../src/agents/orchestrator.ts";
import { DEFAULT_POLICIES } from "../src/llm/policies.ts";
import { ctxFor, fakeWorld, RESCUER, survivorAt } from "./helpers.ts";

const req = (packet: string) => ({ messages: [{ role: "system", content: "s" }, { role: "user", content: packet }] }) as any;
const greedy = (packet: string) => DEFAULT_POLICIES.greedy_orchestrator(req(packet)) as any;

describe("greedy_orchestrator mock policy", () => {
  it("sends an idle robot to search the next cells on any wake, not only the idle transition", () => {
    const packet = [
      "WAKE: survivor #12 created (tier 0)",
      "SURVIVORS (unassigned, priority order): none",
      "CELLS: 197 unsearched or partly searched; next to search: #1 house 1, #2 house 2, #3 house 3, #4 house 4",
      "ROBOT: sim-dog offline READY, terrain unknown; sim-dog-2 online READY idle battery 95%, terrain unknown",
    ].join("\n");
    expect(greedy(packet).tool_calls).toEqual([
      { name: "create_mission", arguments: { reason: "sim-dog-2 idle; search house 1, house 2, house 3", robot_id: "sim-dog-2", kind: "search_cells", target_cell_ids: [1, 2, 3] } },
    ]);
  });

  it("does nothing for a robot that is not idle", () => {
    const packet = [
      "WAKE: robot sim-dog idle",
      "SURVIVORS (unassigned, priority order): none",
      "CELLS: 1 unsearched or partly searched; next to search: #1 house 1",
      "ROBOT: sim-dog online READY, terrain unknown, mission #4 search_cells queued",
    ].join("\n");
    expect(greedy(packet)).toEqual({ content: "No available rescuer for the waiting survivors." });
  });

  it("keeps a call slot for the idle robot when many survivors wait", () => {
    const { h } = fakeWorld();
    for (const k of [1, 2, 3, 4, 5, 6]) survivorAt(h, k, { score: 90 - k });
    for (let i = 0; i < 4; i++) h.module.addRescuer(`Extra ${i}`, 29.4 + i * 1e-4, -98.5, undefined);
    const ctx = ctxFor(h, "orchestrator");
    const out = greedy(orchestratorPacket(ctx.world, ctx.input, ctx));
    expect(out.tool_calls.length).toBeLessThanOrEqual(8);
    expect(out.tool_calls.some((c: any) => c.name === "create_mission" && c.arguments.robot_id === "dog1")).toBe(true);
  });

  it("never picks a rescuer the packet marks as lapsed for that survivor", () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE, A nearest");
    // The proposal lapses (the lease timer's release, written directly so rescuers stay fresh).
    const lapsed = h.store.rows("assignment")[0];
    h.store.update("assignment", { ...lapsed, status: "released", release_cause: "expired" });
    const ctx = ctxFor(h, "orchestrator");
    const packet = orchestratorPacket(ctx.world, ctx.input, ctx);
    expect(packet).toContain("lapsed, do not propose: Rescuer A");
    const propose = greedy(packet).tool_calls.find((c: any) => c.name === "propose_assignment");
    expect(propose.arguments.rescuer_identity).toBe(RESCUER.B);
  });

  it("lists free rescuers before busier ones, as the watchdog ranks them", () => {
    const { h } = fakeWorld();
    const first = survivorAt(h, 4, { level: "delayed", score: 40 });
    h.module.proposeAssignment(h.identity("orchestrator"), first, RESCUER.A, "DELAYED, A nearest");
    h.module.acceptAssignment(RESCUER.A, h.store.rows("assignment")[0].id);
    survivorAt(h, 3);
    const ctx = ctxFor(h, "orchestrator");
    const line = orchestratorPacket(ctx.world, ctx.input, ctx).split("\n").find((l) => /^\s+#\d+ house 3/.test(l))!;
    expect(line.indexOf("Rescuer B")).toBeLessThan(line.indexOf("Rescuer A"));
    expect(line).toMatch(/Rescuer B \d+ m \w+, 0 active; Rescuer A \d+ m \w+, 1 active/);
  });
});
