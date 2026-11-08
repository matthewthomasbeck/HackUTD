// NANO_BASE_URL: MODEL_NANO calls go to our own server (vLLM on Brev), Super stays hosted,
// and our server never receives the NVIDIA key.
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { modelExtras, realProvider } from "../src/llm/client.ts";

describe("NANO_BASE_URL config", () => {
  it("defaults to the hosted API and the NVIDIA key", () => {
    const cfg = loadConfig({ NVIDIA_API_KEY: "nvapi-test", LLM_MODE: "mock" });
    expect(cfg.NANO_BASE_URL).toBe(cfg.NVIDIA_BASE_URL);
    expect(cfg.NANO_API_KEY).toBe("nvapi-test");
  });
  it("uses a placeholder key, not the NVIDIA key, for our own server", () => {
    const cfg = loadConfig({ NVIDIA_API_KEY: "nvapi-test", NANO_BASE_URL: "http://localhost:8000/v1", LLM_MODE: "mock" });
    expect(cfg.NANO_BASE_URL).toBe("http://localhost:8000/v1");
    expect(cfg.NANO_API_KEY).toBe("none");
  });

  it("sends each model and its own credential to the configured server", async () => {
    const seen: Array<{ server: string; auth: string | undefined; model: string }> = [];
    const servers = ["super", "nano"].map((name) => createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      seen.push({ server: name, auth: req.headers.authorization, model: JSON.parse(body).model });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    }));
    try {
      const urls: string[] = [];
      for (const server of servers) {
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("missing test server port");
        urls.push(`http://127.0.0.1:${address.port}/v1`);
      }
      const cfg = loadConfig({ NVIDIA_API_KEY: "nvapi-test", NVIDIA_BASE_URL: urls[0], NANO_BASE_URL: urls[1] });
      const provider = realProvider(cfg);
      for (const model of [cfg.MODEL_SUPER, cfg.MODEL_NANO])
        await provider.send({ agent: "orchestrator", model, messages: [{ role: "user", content: "Say OK" }], maxTokens: 16, timeoutMs: 2000 });
      expect(seen).toEqual([
        { server: "super", auth: "Bearer nvapi-test", model: cfg.MODEL_SUPER },
        { server: "nano", auth: "Bearer none", model: cfg.MODEL_NANO },
      ]);
    } finally {
      await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      })));
    }
  });
});

describe("Super reasoning control", () => {
  it("keeps low as the default and sends none when configured for slow replies", () => {
    const defaults = loadConfig({ LLM_MODE: "mock" });
    expect(modelExtras(defaults, defaults.MODEL_SUPER)).toEqual({ reasoning_effort: "low" });
    const brev = loadConfig({ LLM_MODE: "mock", SUPER_REASONING_EFFORT: "none", NANO_THINKING_OFF: "1" });
    expect(modelExtras(brev, brev.MODEL_SUPER)).toEqual({ reasoning_effort: "none" });
    expect(modelExtras(brev, brev.MODEL_NANO)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(() => loadConfig({ LLM_MODE: "mock", SUPER_REASONING_EFFORT: "off" })).toThrow("SUPER_REASONING_EFFORT");
  });
});
