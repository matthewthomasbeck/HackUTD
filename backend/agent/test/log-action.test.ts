// log_agent_action must accept every action (rehearsal 2026-11-08: "bad json in args_json" five
// times). The cause was clip(safeJson(args), 1000): a cycle_summary with many merged wakes was
// cut mid-string, which is not JSON. The fake module now runs the live reducer's checks.

import { describe, expect, it } from "vitest";
import { boundedJson, safeJson } from "../src/log.ts";
import { dispatch, logAction, logArgsJson } from "../src/tools/dispatch.ts";
import { ctxFor, fakeWorld, survivorAt } from "./helpers.ts";

describe("args_json is always valid and bounded", () => {
  it("keeps a large value valid JSON within the limit", () => {
    const wakes = Array.from({ length: 200 }, (_, i) => `freed:assignment:${i}`);
    const s = boundedJson({ wakes, task_id: null }, 1000);
    expect(s.length).toBeLessThanOrEqual(1000);
    const back = JSON.parse(s);
    expect(back.wakes[0]).toBe("freed:assignment:0");
    expect(back.task_id).toBeNull();
  });

  it("handles one huge string, bigint, undefined, and cycles", () => {
    expect(JSON.parse(boundedJson({ text: "x".repeat(10_000) }, 1000)).text.length).toBeLessThan(1000);
    expect(JSON.parse(boundedJson("y".repeat(5000), 300))).toMatch(/^y+\.\.\.$/);
    // Too many keys to shrink: the last resort wraps a cut preview in a valid object.
    const wide = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`key_${i}`, i]));
    const w = boundedJson(wide, 300);
    expect(w.length).toBeLessThanOrEqual(300);
    expect(JSON.parse(w)).toMatchObject({ truncated: true });
    expect(JSON.parse(safeJson({ id: 12n }))).toEqual({ id: 12 });
    expect(safeJson(undefined)).toBe("null");
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(JSON.parse(logArgsJson(loop))).toBe("<unserializable>");
    // Every escape-heavy string stays valid when cut.
    expect(() => JSON.parse(boundedJson({ s: '"\\\n'.repeat(2000) }, 500))).not.toThrow();
  });

  it("removes forbidden words from the logged copy only", () => {
    const s = logArgsJson({ text: "possibly dead under the slab" });
    expect(JSON.parse(s).text).toBe("possibly [word removed] under the slab");
  });
});

describe("every action reaches agent_action", () => {
  it("a cycle_summary with many merged wakes is logged", async () => {
    const { h } = fakeWorld();
    const ctx = ctxFor(h, "orchestrator");
    const wakes = Array.from({ length: 120 }, (_, i) => ({ key: `freed:assignment:${1000 + i}`, kind: "assignment", priority: "high" as const, at: 0, note: "n" }));
    ctx.input.wakes = wakes;
    await logAction(ctx, "cycle_summary", { wakes: wakes.map((w) => w.key), task_id: null }, "ok: Everything handled.", "Everything handled.", "m");
    const row = h.store.rows("agent_action").at(-1)!;
    expect(row.tool).toBe("cycle_summary");
    expect(JSON.parse(row.args_json).wakes.length).toBeGreaterThan(0);
    expect(h.trace.lines.some((l) => l.event === "log_failed")).toBe(false);
  });

  it("a call rejected for a forbidden word, and one with no reason, are still logged", async () => {
    const { h } = fakeWorld();
    const sid = survivorAt(h, 3);
    const ctx = ctxFor(h, "orchestrator");
    const n = h.store.rows("agent_action").length;
    const r = await dispatch(ctx, "propose_assignment", { reason: "the person looks dead", survivor_id: sid, rescuer_identity: "a".repeat(64) }, "m");
    expect(r.ok).toBe(false);
    await dispatch(ctx, "get_board", {}, "m");
    const rows = h.store.rows("agent_action").slice(n);
    expect(rows.map((a) => a.tool)).toEqual(["propose_assignment", "get_board"]);
    expect(rows[0].reason).toBe("the person looks [word removed]");
    expect(rows[1].reason).toBe("(no reason given)");
    expect(h.trace.lines.some((l) => l.event === "log_failed")).toBe(false);
  });
});
