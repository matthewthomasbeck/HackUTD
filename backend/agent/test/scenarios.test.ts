// The eight scenarios of agent.md 12.3 against the fake module with MockLLM (LLM_MODE=mock).

import { describe, expect, it } from "vitest";
import { SCENARIOS, type ScenarioResult } from "../scripts/scenarios.ts";

function failures(r: ScenarioResult): string[] {
  return r.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`);
}

describe("scenarios (fake module, MockLLM)", () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(name, async () => {
      const r = await SCENARIOS[name]();
      expect(failures(r)).toEqual([]);
    });
  }

  it("chain in strict JSON tool mode", async () => {
    const r = await SCENARIOS.chain({ env: { TOOL_MODE: "json" } });
    expect(failures(r)).toEqual([]);
    expect(r.harness.mock.requests.every((q) => !q.native)).toBe(true);
  });

  it("chain with templates only (ENABLE_COMMS_MODEL=0)", async () => {
    const r = await SCENARIOS.chain({ env: { ENABLE_COMMS_MODEL: "0" } });
    expect(failures(r)).toEqual([]);
    const comms = r.harness.store.rows("agent_action").filter((a) => a.agent === "comms_agent" && a.tool === "send_briefing");
    expect(comms.length).toBeGreaterThan(0);
    expect(comms.every((a) => a.model === "rules" && a.reason.startsWith("[fallback]"))).toBe(true);
  });

  it("chain with rules verdicts (ENABLE_AUDITOR_MODEL=0)", async () => {
    const r = await SCENARIOS.chain({ env: { ENABLE_AUDITOR_MODEL: "0" } });
    expect(failures(r)).toEqual([]);
  });
});
