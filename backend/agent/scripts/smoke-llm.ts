// npm run smoke:llm: tool calling and strict JSON on the hosted models (agent.md 4.3).
// Needs only NVIDIA_API_KEY in backend/agent/.env; no SpacetimeDB. Uses the runner's own
// llm/client.ts (NvidiaProvider and buildBody), so a pass here means the runner's client works.
//
// Test the key in one line first (no tools):
//   curl -s https://integrate.api.nvidia.com/v1/chat/completions -H "Authorization: Bearer $NVIDIA_API_KEY" -H "Content-Type: application/json" -d '{"model":"nvidia/nemotron-3.5-lightning-30b-a3b","messages":[{"role":"user","content":"Say OK"}],"max_tokens":16,"stream":false}'

import "dotenv/config";
import { loadConfig, type Config } from "../src/config.ts";
import { bearingDeg, compass, haversineM } from "../src/geo.ts";
import { modelExtras, realProvider } from "../src/llm/client.ts";
import type { LlmProvider } from "../src/llm/types.ts";
import { parseReply } from "../src/llm/parse.ts";
import { LlmError, type ChatMessage, type ChatReply, type ChatRequest, type ToolDef } from "../src/llm/types.ts";

const MESSAGE = "Use compute_bearing from 32.9857,-96.7502 to 32.9861,-96.7497 and tell me the result.";
const TOOL: ToolDef = {
  type: "function",
  function: {
    name: "compute_bearing",
    description: "Distance in meters and bearing in degrees from one point to another.",
    parameters: {
      type: "object",
      properties: {
        from_lat: { type: "number" },
        from_lon: { type: "number" },
        to_lat: { type: "number" },
        to_lon: { type: "number" },
        reason: { type: "string" },
      },
      required: ["from_lat", "from_lon", "to_lat", "to_lon", "reason"],
      additionalProperties: false,
    },
  },
};
const JSON_SYSTEM = [
  "You act only through tools. TOOLS (JSON mode):",
  `- compute_bearing: ${TOOL.function.description}\n  schema: ${JSON.stringify(TOOL.function.parameters)}`,
  "Reply with exactly one JSON object and nothing else, in one of two shapes:",
  '{"actions":[{"tool":"<tool name>","args":{...}}]}',
  '{"done":true,"summary":"<one line>"}',
  'At most 3 actions per reply. Every args object must include "reason".',
].join("\n");

interface Row {
  model: string;
  step: string;
  mode: string;
  status: string;
  latency: string;
  pass: string;
  note: string;
}

async function call(p: LlmProvider, req: ChatRequest): Promise<{ reply?: ChatReply; status: string; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const reply = await p.send(req);
    return { reply, status: String(reply.status), ms: Date.now() - t0 };
  } catch (err) {
    const e = err as LlmError;
    return { status: e.status ? String(e.status) : e.kind ?? "error", ms: Date.now() - t0, error: e.message };
  }
}

function fourNumbers(args: Record<string, unknown>): boolean {
  return ["from_lat", "from_lon", "to_lat", "to_lon"].every((k) => typeof args[k] === "number" && Number.isFinite(args[k] as number));
}

function bearingResult(a: Record<string, number>) {
  const b = bearingDeg(a.from_lat, a.from_lon, a.to_lat, a.to_lon);
  return { distance_m: Math.round(haversineM(a.from_lat, a.from_lon, a.to_lat, a.to_lon)), bearing_deg: Math.round(b), compass: compass(b) };
}

async function smokeModel(cfg: Config, p: LlmProvider, model: string, rows: Row[]): Promise<void> {
  const base = { agent: "orchestrator" as const, model, maxTokens: 512, timeoutMs: 30_000 };
  const extras = modelExtras(cfg, model);
  const msgs: ChatMessage[] = [{ role: "user", content: MESSAGE }];

  // Step 1: one native tool call.
  const s1 = await call(p, { ...base, messages: msgs, tools: [TOOL], extra: extras });
  const tc = s1.reply?.toolCalls[0];
  let args: Record<string, unknown> = {};
  try {
    args = tc ? JSON.parse(tc.function.arguments) : {};
  } catch {
    /* not JSON */
  }
  let leaked = false;
  if (!tc && s1.reply) {
    const pr = parseReply(s1.reply.content);
    if (pr.kind === "actions" && pr.actions[0].tool === "compute_bearing") {
      leaked = true;
      args = pr.actions[0].args;
    }
  }
  const pass1 = (tc?.function.name === "compute_bearing" || leaked) && fourNumbers(args);
  rows.push({ model, step: "1 tool call", mode: "native", status: s1.status, latency: `${s1.ms}`, pass: pass1 ? "pass" : "FAIL", note: s1.error ?? (leaked ? "tool call came back in content (parse.ts)" : "") });

  // Step 2: tool result back as a role "tool" message.
  if (pass1 && tc) {
    const result = bearingResult(args as Record<string, number>);
    const s2 = await call(p, {
      ...base,
      tools: [TOOL],
      extra: extras,
      messages: [...msgs, { role: "assistant", content: null, tool_calls: [tc] }, { role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) }],
    });
    const text = s2.reply?.content ?? "";
    const pass2 = !!s2.reply && s2.reply.toolCalls.length === 0 && /\b(m|meters?|metres?)\b/i.test(text);
    rows.push({ model, step: "2 tool result", mode: "native", status: s2.status, latency: `${s2.ms}`, pass: pass2 ? "pass" : "FAIL", note: s2.error ?? text.slice(0, 60).replace(/\s+/g, " ") });
  } else rows.push({ model, step: "2 tool result", mode: "native", status: "-", latency: "-", pass: "skip", note: "step 1 did not return a native tool call" });

  // Step 3: reasoning off.
  const off = model === cfg.MODEL_SUPER ? { reasoning_effort: "none" } : { chat_template_kwargs: { enable_thinking: false } };
  const s3 = await call(p, { ...base, messages: [{ role: "user", content: "Say OK" }], maxTokens: 64, extra: off });
  const hadReasoning = !!s1.reply?.reasoning;
  const gone = !!s3.reply && !s3.reply.reasoning;
  rows.push({
    model,
    step: model === cfg.MODEL_SUPER ? "3 reasoning_effort none" : "3 enable_thinking false",
    mode: "native",
    status: s3.status,
    latency: `${s3.ms}`,
    pass: s3.reply ? "accepted" : "rejected",
    note: s3.error ?? `reasoning text ${gone ? "absent" : "still present"} (step 1 had ${hadReasoning ? "some" : "none"})`,
  });

  // Step 4: strict JSON mode, no tools field.
  const s4 = await call(p, { ...base, messages: [{ role: "system", content: JSON_SYSTEM }, ...msgs], extra: { ...extras, response_format: { type: "json_object" } } });
  const pr = s4.reply ? parseReply(s4.reply.content) : null;
  const pass4 = pr?.kind === "actions" && pr.actions[0].tool === "compute_bearing" && fourNumbers(pr.actions[0].args);
  rows.push({ model, step: "4 JSON action", mode: "json", status: s4.status, latency: `${s4.ms}`, pass: pass4 ? "pass" : "FAIL", note: s4.error ?? (pr?.kind === "error" ? pr.error : "") });
}

function table(rows: Row[]): string {
  const head: Row = { model: "model", step: "step", mode: "mode", status: "HTTP", latency: "ms", pass: "result", note: "note" };
  const all = [head, ...rows];
  const keys = Object.keys(head) as Array<keyof Row>;
  const w = keys.map((k) => Math.max(...all.map((r) => String(r[k]).length)));
  const line = (r: Row) => "| " + keys.map((k, i) => String(r[k]).padEnd(w[i])).join(" | ") + " |";
  return [line(head), "| " + w.map((n) => "-".repeat(n)).join(" | ") + " |", ...rows.map(line)].join("\n");
}

async function main(): Promise<number> {
  const cfg = loadConfig(process.env, { requireKey: false });
  if (!cfg.NVIDIA_API_KEY) {
    console.log("smoke:llm skipped: NVIDIA_API_KEY is not set.");
    console.log("Get a key from build.nvidia.com (\"Get API Key\" on a model page), put it in backend/agent/.env as NVIDIA_API_KEY=, and run again.");
    console.log("Never commit the key; the repo is public.");
    return 0;
  }
  const p = realProvider(cfg);
  const rows: Row[] = [];
  for (const model of [cfg.MODEL_SUPER, cfg.MODEL_NANO]) {
    console.log(`testing ${model} ...`);
    await smokeModel(cfg, p, model, rows);
  }
  console.log("\n" + table(rows));
  const decide = (m: string) => {
    const r = rows.filter((x) => x.model === m);
    if (r.find((x) => x.step.startsWith("1"))?.pass === "pass" && r.find((x) => x.step.startsWith("2"))?.pass === "pass") return "native";
    if (r.find((x) => x.step.startsWith("4"))?.pass === "pass") return "json";
    return "neither (raise with the NVIDIA mentors)";
  };
  console.log(`\nSuggested: TOOL_MODE_SUPER=${decide(cfg.MODEL_SUPER)}  TOOL_MODE_NANO=${decide(cfg.MODEL_NANO)}`);
  console.log("Write the table into backend/agent/README.md and the decision into docs/specs/agent.md 4.3.");
  return rows.some((r) => r.pass === "FAIL") ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
