import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDITOR_PROMPT, COMMS_PROMPT, ORCHESTRATOR_PROMPT } from "../src/agents/prompts.ts";
import { camelKey, enumTag, fromBinding, reducerArgs, snakeKey } from "../src/stdb/convert.ts";

describe("stdb/convert.ts", () => {
  it("maps key spellings and enum tags", () => {
    expect(snakeKey("criticalLevel")).toBe("critical_level");
    expect(camelKey("payload_json")).toBe("payloadJson");
    expect(enumTag("EnRoute")).toBe("en_route");
    expect(enumTag("en_route")).toBe("en_route");
    expect(enumTag("SAFE_STOP")).toBe("SAFE_STOP");
    expect(enumTag("PartiallySearched")).toBe("partially_searched");
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
