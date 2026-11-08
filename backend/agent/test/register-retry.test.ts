import { describe, expect, it } from "vitest";
import { buildAgent } from "../src/agents/index.ts";
import { REGISTER_BACKOFF_S, AgentRuntime } from "../src/runtime.ts";
import { World } from "../src/world.ts";
import { fakeWorld } from "./helpers.ts";

describe("register_participant retry (outside demo mode, before grant_role)", () => {
  it("retries with backoff, not in a tight loop, and heartbeats only once registered", async () => {
    const { h } = fakeWorld();
    const real = h.module.actionsFor(h.identity("auditor"));
    let rejects = 2;
    let registers = 0;
    let heartbeats = 0;
    const actions = Object.create(real);
    actions.registerParticipant = async (name: string, role: any) => {
      registers++;
      if (rejects-- > 0) throw new Error("role not granted");
      return real.registerParticipant(name, role);
    };
    actions.agentHeartbeat = async () => {
      heartbeats++;
      return real.agentHeartbeat();
    };
    const rt = new AgentRuntime(buildAgent("auditor", h.cfg), h.deps(), new World(h.store, h.clock), actions);
    await rt.start();
    expect(registers).toBe(1);
    expect(rt.registered).toBe(false);
    await h.clock.advance(REGISTER_BACKOFF_S[0] * 1000 - 1);
    expect(registers).toBe(1); // waits out the first delay
    expect(heartbeats).toBe(0);
    await h.clock.advance(1);
    expect(registers).toBe(2);
    await h.clock.advance(REGISTER_BACKOFF_S[1] * 1000);
    expect(registers).toBe(3);
    expect(rt.registered).toBe(true);
    await h.clock.advance(60_000);
    expect(registers).toBe(3); // no more attempts once registered
    expect(heartbeats).toBeGreaterThan(0);
    rt.stop();
  });

  it("registers again when a heartbeat says not registered", async () => {
    const { h } = fakeWorld();
    const real = h.module.actionsFor(h.identity("auditor"));
    let registers = 0;
    let fail = false;
    const actions = Object.create(real);
    actions.registerParticipant = async (name: string, role: any) => {
      registers++;
      return real.registerParticipant(name, role);
    };
    actions.agentHeartbeat = async () => {
      if (fail) {
        fail = false;
        throw new Error("not registered");
      }
    };
    const rt = new AgentRuntime(buildAgent("auditor", h.cfg), h.deps(), new World(h.store, h.clock), actions);
    await rt.start();
    expect(registers).toBe(1);
    fail = true;
    await h.clock.advance(30_000);
    expect(registers).toBe(2);
    rt.stop();
  });
});
