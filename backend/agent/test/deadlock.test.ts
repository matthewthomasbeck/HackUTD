// The rehearsal deadlock (2026-11-08): a proposal for an IMMEDIATE survivor lapsed, the mock policy
// kept choosing the lapsed rescuer, the lapse guard rejected it, and the tier guard then rejected
// every other proposal, so the survivor and the rest of the board waited for minutes.

import { describe, expect, it } from "vitest";
import { dispatch } from "../src/tools/dispatch.ts";
import type { Assignment } from "../src/types.ts";
import { at, ctxFor, fakeWorld, RESCUER, survivorAt } from "./helpers.ts";

const C = "c".repeat(64);

describe("lapsed proposal for a tier 0 survivor", () => {
  it("re-proposes another rescuer at once and keeps lower tiers moving", async () => {
    const { h, m } = fakeWorld({ fixtures: ["budget"], env: { ENABLE_AUDITOR_MODEL: "0", ENABLE_COMMS_MODEL: "0" } });
    const c = at(75, 80);
    m.addRescuer("Cara Diaz", c.lat, c.lon, C);
    // B and C accept on their glasses; A (nearest to house 3) never answers, so A's proposal lapses.
    h.store.onChange((ch) => {
      if (ch.table !== "assignment" || ch.op !== "insert") return;
      const a = ch.row as Assignment;
      if (a.rescuer_identity === RESCUER.A) return;
      h.clock.setTimeout(() => {
        try {
          m.acceptAssignment(a.rescuer_identity, a.id);
        } catch {
          /* already taken */
        }
      }, 2000);
    });
    const urgent = survivorAt(h, 3, { score: 92 });
    const delayed = [1, 2, 4].map((k) => survivorAt(h, k, { level: "delayed", score: 40 - k }));
    m.start();
    await h.startAgents(["orchestrator"]);
    await h.run(5_000);
    const first = h.store.rows("assignment").find((a) => a.survivor_id === urgent)!;
    expect(first.rescuer_identity).toBe(RESCUER.A);

    // A's proposal lapses after proposal_lease_s (30 s in demo mode).
    await h.run(35_000);
    const lapse = h.store.get("assignment", first.id)!;
    expect(lapse.status).toBe("released");
    expect(lapse.release_cause).toBe("expired");
    await h.run(10_000);

    const again = h.store.rows("assignment").filter((a) => a.survivor_id === urgent && a.id !== first.id);
    expect(again.length).toBeGreaterThan(0);
    expect(again[0].rescuer_identity).not.toBe(RESCUER.A);
    expect(again[0].created_at - lapse.updated_at).toBeLessThan(5_000);
    // Every delayed survivor got a proposal too, and no call hit the deadlock errors.
    for (const sid of delayed) expect(h.store.rows("assignment").some((a) => a.survivor_id === sid)).toBe(true);
    const errors = h.store.rows("agent_action").filter((a) => a.agent === "orchestrator" && a.result.startsWith("error"));
    expect(errors.filter((e) => /propose it first|lapsed in the last 5 min|no proposed or active assignment/.test(e.result))).toEqual([]);
    h.stop();
  });
});

describe("tier guard never starves the board", () => {
  it("a tier 0 survivor whose proposal was just rejected does not block lower tiers, and it is logged once", async () => {
    const { h } = fakeWorld();
    const urgent = survivorAt(h, 3, { breathing: "not_detected", score: 10 });
    const delayed = survivorAt(h, 2, { level: "delayed", score: 50 });
    const ctx = ctxFor(h, "orchestrator");
    const blocked = await dispatch(ctx, "propose_assignment", { reason: "DELAYED first", survivor_id: delayed, rescuer_identity: RESCUER.A }, "m");
    expect(blocked.error).toContain(`#${urgent} (tier 0)`);

    // The proposal for the tier 0 survivor is rejected (here: an unknown rescuer).
    const bad = await dispatch(ctx, "propose_assignment", { reason: "IMMEDIATE", survivor_id: urgent, rescuer_identity: "9".repeat(64) }, "m");
    expect(bad.ok).toBe(false);
    const warn: string[] = [];
    const orig = ctx.deps.log.warn.bind(ctx.deps.log);
    ctx.deps.log.warn = (scope: string, msg: string) => {
      warn.push(msg);
      orig(scope, msg);
    };
    const ok = await dispatch(ctx, "propose_assignment", { reason: "DELAYED, Rescuer A nearest at 40 m", survivor_id: delayed, rescuer_identity: RESCUER.A }, "m");
    expect(ok.ok).toBe(true);
    await dispatch(ctx, "propose_assignment", { reason: "IMMEDIATE, Rescuer B because A is taken", survivor_id: urgent, rescuer_identity: RESCUER.B }, "m");
    expect(warn.filter((w) => w.includes(`survivor #${urgent}`))).toHaveLength(1);
  });

  it("the lapsed rescuer is refused while another is available, and allowed when it is the only one", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    h.module.proposeAssignment(h.identity("orchestrator"), sid, RESCUER.A, "IMMEDIATE");
    const a = h.store.rows("assignment")[0];
    h.store.update("assignment", { ...a, status: "released", release_cause: "expired" });
    const ctx = ctxFor(h, "orchestrator");
    const r = await dispatch(ctx, "propose_assignment", { reason: "IMMEDIATE, Rescuer A nearest", survivor_id: sid, rescuer_identity: RESCUER.A }, "m");
    expect(r.error).toMatch(/lapsed in the last 5 min; choose another available rescuer, such as Rescuer B/);
    // B goes offline: A is the only available rescuer, so A may be proposed again.
    const b = h.store.rows("participant").find((p) => p.identity === RESCUER.B)!;
    h.store.update("participant", { ...b, online: false });
    const again = await dispatch(ctx, "propose_assignment", { reason: "IMMEDIATE, Rescuer A is the only one left", survivor_id: sid, rescuer_identity: RESCUER.A }, "m");
    expect(again.ok).toBe(true);
  });
});

describe("the module's unproposed-immediate backstop (CONTRACTS.md 8.2)", () => {
  it("proposes while the orchestrator heartbeats, and the orchestrator tolerates it", async () => {
    const { h, m } = fakeWorld();
    const urgent = survivorAt(h, 3, { score: 92 });
    const delayed = survivorAt(h, 2, { level: "delayed", score: 40 });
    m.start();
    // A live but stuck orchestrator: heartbeats every 5 s and never proposes.
    const beat = () => m.agentHeartbeat(h.identity("orchestrator"));
    beat();
    for (let t = 0; t < 25_000; t += 5_000) {
      await h.run(5_000);
      beat();
    }
    expect(m.watchdogFires).toBe(0);
    const backstop = h.store.rows("assignment").find((a) => a.survivor_id === urgent)!;
    expect(backstop.created_by).toBe("module");
    expect(h.store.rows("agent_action").some((a) => a.agent === "module" && a.reason === "unproposed immediate backstop")).toBe(true);

    const ctx = ctxFor(h, "orchestrator");
    const other = backstop.rescuer_identity === RESCUER.A ? RESCUER.B : RESCUER.A;
    const dup = await dispatch(ctx, "propose_assignment", { reason: "IMMEDIATE, nearest", survivor_id: urgent, rescuer_identity: other }, "m");
    expect(dup.error).toBe("already proposed by watchdog");
    expect(ctx.memory.proposalRejected.has(urgent)).toBe(false);
    // The backstop proposal does not leave the tier 0 survivor blocking the delayed one.
    const ok = await dispatch(ctx, "propose_assignment", { reason: "DELAYED, the only free rescuer, load 0", survivor_id: delayed, rescuer_identity: other }, "m");
    expect(ok.ok).toBe(true);
    h.stop();
  });
});
