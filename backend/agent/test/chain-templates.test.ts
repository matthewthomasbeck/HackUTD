import { describe, expect, it } from "vitest";
import { resolveChain, survivorChain } from "../src/chain.ts";
import { briefingProblem } from "../src/guards.ts";
import { answerTemplate, breathingPart, briefingTemplate, navTemplate, nudgeTemplate } from "../src/templates.ts";
import { dispatch } from "../src/tools/dispatch.ts";
import type { Survivor } from "../src/types.ts";
import { ctxFor, fakeWorld, postAndClaim, RESCUER, survivorAt } from "./helpers.ts";

describe("chain.ts (agent.md 5.5)", () => {
  it("a survivor's chain is its survivor_created event id", () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const ev = h.store.rows("event_log").find((e) => e.kind === "survivor_created" && e.entity_id === sid)!;
    const ctx = ctxFor(h, "orchestrator");
    expect(survivorChain(ctx.world, sid)).toBe(ev.id);
    expect(resolveChain(ctx.world, null, [{ key: "k", kind: "survivor", priority: "critical", at: 0, note: "", survivorId: sid }])).toBe(ev.id);
  });

  it("a task's chain carries to the tasks and actions it causes", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const chain = survivorChain(ctxFor(h, "orchestrator").world, sid);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE, nearest");
    const task = postAndClaim(h, "orchestrator", "comms_agent", "brief_rescuer", { chain_id: chain, assignment_id: 1, survivor_id: sid, rescuer_identity: RESCUER.A, why: "x" }, chain);
    const ctx = ctxFor(h, "comms_agent", task, { chainId: resolveChain(ctxFor(h, "comms_agent").world, task, []) });
    await dispatch(ctx, "send_briefing", { reason: "brief A", audience: RESCUER.A, text: "IMMEDIATE house 3: go now.", priority: "critical" }, "m");
    const act = h.store.rows("agent_action").find((a) => a.tool === "send_briefing")!;
    expect(act.chain_id).toBe(chain);
    expect(h.store.rows("briefing")[0].chain_id).toBe(chain);
  });
});

const base: Survivor = {
  id: 12,
  site_id: 1,
  cell_id: 0,
  first_detection_id: 0,
  lat: 0,
  lon: 0,
  location_note: "8 m in from front door",
  house_label: "house 3",
  breathing: "detected",
  breathing_rate_bpm: 34,
  breathing_confidence: 0.71,
  visibility_pct: 40,
  critical_level: "immediate",
  critical_score: 78,
  score_confidence: 0.7,
  score_reasons: [],
  status: "unassigned",
  resolution: null,
  resolved_by: null,
  possible_duplicate_of: 0,
  breathing_display_url: null,
  escalated_at: null,
  created_at: 0,
  updated_at: 0,
};

describe("templates.ts (agent.md 7.3)", () => {
  it("the briefing template matches the spec shape", () => {
    expect(briefingTemplate(base, "house 3", 41, "NE")).toBe("IMMEDIATE house 3: breathing 34/min (conf 0.71). 8 m in from front door. 41 m NE.");
  });
  it("not_detected reads 'breathing not seen, low confidence' and stays IMMEDIATE", () => {
    const s = { ...base, breathing: "not_detected" as const, critical_level: "delayed" as const };
    expect(breathingPart(s)).toBe("breathing not seen, low confidence");
    expect(briefingTemplate(s, "house 3", null, null)).toMatch(/^IMMEDIATE house 3: breathing not seen, low confidence\./);
  });
  it("every template stays at 120 characters or fewer with long location notes, plain ASCII, and passes the guards", () => {
    const long = { ...base, location_note: "under the collapsed kitchen counter near the back door, \u2014 behind the fridge ".repeat(4) };
    const outs = [
      briefingTemplate(long, "house 3 east wing apartment 4B", 1234, "SW"),
      nudgeTemplate(long, "house 3 east wing apartment 4B ".repeat(5)),
      navTemplate(long, "house 3", "debris"),
      answerTemplate("house 3 ".repeat(20), 3, 1),
    ];
    for (const t of outs) {
      expect(t.length).toBeLessThanOrEqual(120);
      expect(briefingProblem(t)).toBeNull();
    }
  });
  it("the navigation hint adds ground ahead only for rough terrain", () => {
    expect(navTemplate(base, "house 3", "debris")).toBe("Enter house 3: 8 m in from front door. Ground ahead: debris.");
    expect(navTemplate(base, "house 3", "flat")).toBe("Enter house 3: 8 m in from front door.");
  });
  it("nudge and answer templates", () => {
    expect(nudgeTemplate(base, "house 3")).toBe("house 3 is yours (IMMEDIATE). Tap ring to accept or release.");
    expect(answerTemplate("house 3", 1, 1)).toBe("Board: house 3 1 found, 1 unaccounted. Ask coordinator for more.");
  });
});
