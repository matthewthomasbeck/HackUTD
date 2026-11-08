import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDITOR_PROMPT, COMMS_PROMPT, ORCHESTRATOR_PROMPT } from "../src/agents/prompts.ts";
import { camelKey, fromBinding, reducerArgs, snakeKey, toBindingTag, toContractTag, toEnum } from "../src/stdb/convert.ts";

describe("stdb/convert.ts", () => {
  it("maps key spellings and enum tags", () => {
    expect(snakeKey("criticalLevel")).toBe("critical_level");
    expect(camelKey("payload_json")).toBe("payloadJson");
    expect(toContractTag("EnRoute")).toBe("en_route");
    expect(toContractTag("PartiallySearched")).toBe("partially_searched");
  });

  // Variant names from backend/spacetimedb-bindings/types.ts (generated, PascalCase).
  const CASES: Array<[string, string, boolean]> = [
    // [contract spelling, binding variant name, ALL_CAPS enum]
    ["agent", "Agent", false],
    ["auditor", "Auditor", false],
    ["perception", "Perception", false],
    ["orchestrator", "Orchestrator", false],
    ["comms_agent", "CommsAgent", false],
    ["READY", "Ready", true],
    ["SAFE_STOP", "SafeStop", true],
    ["ACTIVE", "Active", true],
    ["OK", "Ok", true],
    ["DEGRADED", "Degraded", true],
    ["FAILED", "Failed", true],
    ["unassigned", "Unassigned", false],
    ["en_route", "EnRoute", false],
    ["resolved", "Resolved", false],
    ["not_detected", "NotDetected", false],
    ["search_cells", "SearchCells", false],
  ];

  it("maps contract enum spellings to binding variant names", () => {
    for (const [contract, binding] of CASES) {
      expect(toBindingTag(contract)).toBe(binding);
      expect(toEnum(contract)).toEqual({ tag: binding });
    }
  });

  it("maps binding variant names back to contract spellings, round trip", () => {
    for (const [contract, binding, upper] of CASES) {
      expect(toContractTag(binding, upper)).toBe(contract);
      expect(toContractTag(toBindingTag(contract), upper)).toBe(contract);
    }
  });

  it("decodes ALL_CAPS enum columns by table", () => {
    const robot = fromBinding({ robotId: "dog1", state: { tag: "Ready" }, terrainClass: { tag: "Flat" } }, "robot");
    expect(robot).toEqual({ robot_id: "dog1", state: "READY", terrain_class: "flat" });
    expect(fromBinding({ state: { tag: "SafeStop" } }, "robot")).toEqual({ state: "SAFE_STOP" });
    expect(fromBinding({ status: { tag: "Ok" } }, "device_status")).toEqual({ status: "OK" });
    expect(fromBinding({ status: { tag: "Degraded" } }, "device_status")).toEqual({ status: "DEGRADED" });
    // The same binding name in a lower-case enum stays lower case.
    expect(fromBinding({ status: { tag: "Active" } }, "assignment")).toEqual({ status: "active" });
    expect(fromBinding({ status: { tag: "EnRoute" } }, "survivor")).toEqual({ status: "en_route" });
    expect(fromBinding({ role: { tag: "Agent" } }, "participant")).toEqual({ role: "agent" });
    expect(fromBinding({ toAgent: { tag: "CommsAgent" } }, "agent_task")).toEqual({ to_agent: "comms_agent" });
  });

  it("turns a binding row into a contract row", async () => {
    // Typed loosely: the SDK's .d.ts re-exports do not resolve under NodeNext, the runtime exports do.
    const { Identity, Timestamp } = (await import("spacetimedb")) as any;
    const hex = "ab".repeat(32);
    const row = {
      id: 7n,
      rescuerIdentity: Identity.fromString(hex),
      status: { tag: "Proposed" },
      leaseExpiresAt: new Timestamp(1_700_000_000_000_000n),
      acceptedAt: undefined,
      targetCellIds: [1n, 2n],
      scoreReasons: ["a", "b"],
    };
    expect(fromBinding(row)).toEqual({
      id: 7,
      rescuer_identity: hex,
      status: "proposed",
      lease_expires_at: 1_700_000_000_000,
      accepted_at: null,
      target_cell_ids: [1, 2],
      score_reasons: ["a", "b"],
    });
    expect(() => JSON.stringify(fromBinding(row))).not.toThrow();
  });

  it("reducer arguments carry both key spellings", () => {
    expect(reducerArgs({ task_id: 1n, result_json: "{}" })).toEqual({ task_id: 1n, taskId: 1n, result_json: "{}", resultJson: "{}" });
  });
});

describe("system prompts are verbatim from agent.md 7.2 to 7.4", () => {
  const spec = readFileSync(new URL("../../../docs/specs/agent.md", import.meta.url), "utf8");
  const blocks = [...spec.matchAll(/System prompt \(full text\):\n\n```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  it("orchestrator, comms agent, auditor", () => {
    expect(blocks.length).toBe(3);
    expect(ORCHESTRATOR_PROMPT).toBe(blocks[0]);
    expect(COMMS_PROMPT).toBe(blocks[1]);
    expect(AUDITOR_PROMPT).toBe(blocks[2]);
  });
  it("no prompt mentions a search agent", () => {
    for (const p of [ORCHESTRATOR_PROMPT, COMMS_PROMPT, AUDITOR_PROMPT]) expect(p.toLowerCase()).not.toMatch(/search agent|robot_agent/);
  });
});

describe("payload_json ids (module convention: u64 as decimal strings)", () => {
  it("parses the module's review payload into numeric ids", async () => {
    const { parsePayload } = await import("../src/world.ts");
    // Shape written by backend/spacetimedb/src/lib/state.ts createProposal.
    const raw = JSON.stringify({ assignment_id: "12", survivor_id: "3", rescuer_identity: "ab".repeat(32), distance_m: null, critical_level: "immediate", reason: "x" });
    expect(parsePayload(raw)).toEqual({ assignment_id: 12, survivor_id: 3, rescuer_identity: "ab".repeat(32), distance_m: null, critical_level: "immediate", reason: "x" });
    expect(parsePayload(JSON.stringify({ survivor_id: 5 }))).toEqual({ survivor_id: 5 });
    expect(parsePayload("not json")).toBeNull();
  });

  it("writes ids as decimal strings", async () => {
    const { payloadJson } = await import("../src/world.ts");
    expect(JSON.parse(payloadJson({ assignment_id: 12, survivor_id: 3, chain_id: 0, why: "w" }))).toEqual({ assignment_id: "12", survivor_id: "3", chain_id: "0", why: "w" });
  });
});
