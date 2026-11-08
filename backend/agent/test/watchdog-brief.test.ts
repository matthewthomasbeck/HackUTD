import { expect, it } from "vitest";
import { runCycle } from "../src/loop.ts";
import { ctxFor, fakeWorld, RESCUER, survivorAt } from "./helpers.ts";

it("marks a watchdog-only template as RULES FALLBACK within the glasses limit", async () => {
  const { h } = fakeWorld();
  const sid = survivorAt(h, 3, { location_note: "front room " + "under debris ".repeat(20) });
  h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE");
  const a = h.store.rows("assignment")[0];
  const ctx = ctxFor(h, "comms_agent", null, { wakes: [{
    key: `watchdog_brief:assignment:${a.id}`, kind: "watchdog_brief", priority: "critical",
    at: h.clock.now(), note: "database fallback", survivorId: sid, assignmentId: a.id,
  }] });
  await runCycle(ctx);
  const briefing = h.store.rows("briefing")[0];
  expect(briefing.text).toMatch(/^RULES FALLBACK: IMMEDIATE house 3/);
  expect(briefing.text.length).toBeLessThanOrEqual(120);
  expect(briefing.audience).toBe(RESCUER.A);
  expect(h.mock.requests).toHaveLength(0);
});
