import { afterEach, expect, it, vi } from "vitest";
import { runLiveScenario } from "../scripts/live-scenario.ts";

afterEach(() => vi.unstubAllEnvs());

it("refuses remote databases before opening a connection", async () => {
  vi.stubEnv("STDB_URI", "https://maincloud.spacetimedb.com");
  vi.stubEnv("STDB_DATABASE", "eric-live-chain");
  await expect(runLiveScenario("chain", false, false)).rejects.toThrow("local server");
});

it("refuses the shared database even on a local server", async () => {
  vi.stubEnv("STDB_URI", "http://127.0.0.1:3927");
  vi.stubEnv("STDB_DATABASE", "assess-0hw81");
  await expect(runLiveScenario("chain", false, false)).rejects.toThrow("disposable STDB_DATABASE");
});

it("refuses a dry failure scenario instead of silently writing to the module", async () => {
  await expect(runLiveScenario("all_down", true, false)).rejects.toThrow("chain only");
});
