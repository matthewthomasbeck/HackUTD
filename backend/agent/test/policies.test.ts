import { describe, expect, it } from "vitest";
import { DEFAULT_POLICIES } from "../src/llm/policies.ts";

const req = (packet: string) => ({ messages: [{ role: "system", content: "s" }, { role: "user", content: packet }] }) as any;

describe("greedy_orchestrator mock policy", () => {
  it("sends a robot named idle in the WAKE line to search the next unsearched cells", () => {
    const packet = [
      "WAKE: robot sim-dog-2 idle",
      "SURVIVORS (unassigned, priority order): none",
      "CELLS: 197 unsearched or partly searched: #1 house 1, #2 house 2, #3 house 3, #4 house 4",
      "ROBOT: sim-dog offline READY, terrain unknown; sim-dog-2 online READY idle battery 95%, terrain unknown",
    ].join("\n");
    const out = DEFAULT_POLICIES.greedy_orchestrator(req(packet)) as any;
    expect(out.tool_calls).toEqual([
      { name: "create_mission", arguments: { reason: "sim-dog-2 idle; search house 1, house 2, house 3", robot_id: "sim-dog-2", kind: "search_cells", target_cell_ids: [1, 2, 3] } },
    ]);
  });

  it("does nothing for a robot that is not idle", () => {
    const packet = ["WAKE: robot sim-dog idle", "SURVIVORS (unassigned, priority order): none", "CELLS: 1 unsearched or partly searched: #1 house 1", "ROBOT: sim-dog offline READY"].join("\n");
    expect(DEFAULT_POLICIES.greedy_orchestrator(req(packet))).toEqual({ content: "No available rescuer for the waiting survivors." });
  });
});
