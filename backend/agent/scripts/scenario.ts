// npm run scenario -- <name|all> [--verbose] [--live] [--real]
//
// Runs the scripted scenarios of agent.md 12.3. By default they run in-process against the fake
// module (src/fake/module.ts) with MockLLM on a virtual clock, so they need no SpacetimeDB, no
// simulator, and no NVIDIA key; against the fake module every write goes to the fake module, which
// is the DRY_RUN shadow, so no real reducer runs.
// --live is reserved for the published module plus backend/sim in demo mode; that scenario
// harness is not implemented yet, even though the bindings and simulator sources now exist.
// --real (our addition) keeps the fake module but calls the real NVIDIA models in real time, so it
// needs NVIDIA_API_KEY and spends requests. Only the scenarios whose outcome comes from the model run
// by default; race, comms_fallback, all_down and budget depend on MockLLM failure policies.

import "dotenv/config";
import { SCENARIOS } from "./scenarios.ts";
import type { RealCall } from "../src/fake/harness.ts";

const REAL_DEFAULT = ["chain", "priority", "auditor_disagrees", "kill_orchestrator"];

function report(calls: RealCall[]): void {
  const by = new Map<string, RealCall[]>();
  for (const c of calls) {
    const k = `${c.agent} (${c.model})`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(c);
  }
  for (const [k, list] of by) {
    const ms = list.map((c) => c.ms).sort((a, b) => a - b);
    const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
    const tools = list.flatMap((c) => c.toolCalls);
    const errs = list.filter((c) => !c.ok).map((c) => c.error);
    console.log(`  model  ${k}: ${list.length} calls, p50 ${p(0.5)} ms, max ${ms[ms.length - 1]} ms, tools [${tools.join(", ")}]${errs.length ? `, errors: ${errs.join(" | ")}` : ""}`);
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const live = args.includes("--live");
  const real = args.includes("--real");
  const names = args.filter((a) => !a.startsWith("--"));
  const all = real && !names.includes("all") ? REAL_DEFAULT : Object.keys(SCENARIOS);
  const pick = names.length === 0 || names.includes("all") ? all : names;

  if (live) {
    console.error(
      "scenario --live is not implemented yet. The module, bindings and simulator sources exist; " +
        "use smoke:stdb for local adapter acceptance, or run without --live for the in-process scenarios.",
    );
    return 2;
  }
  const unknown = pick.filter((n) => !SCENARIOS[n]);
  if (unknown.length) {
    console.error(`unknown scenario(s): ${unknown.join(", ")}. Known: ${Object.keys(SCENARIOS).join(", ")}`);
    return 2;
  }
  const env: Record<string, string> = {};
  const keys = ["ENABLE_COMMS_MODEL", "ENABLE_AUDITOR_MODEL", "TOOL_MODE", "TOOL_MODE_SUPER", "TOOL_MODE_NANO", "RPM_BUDGET"];
  if (real) keys.push("NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NANO_BASE_URL", "NANO_API_KEY", "MODEL_SUPER", "MODEL_NANO", "NANO_THINKING_OFF", "SUPER_REASONING_EFFORT");
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== "") env[k] = v;
  }
  if (real) console.log("real NVIDIA models in real time against the fake module (each scenario takes 30 to 120 s)");
  else if (process.env.LLM_MODE && process.env.LLM_MODE !== "mock") console.log("note: without --real, scenarios use LLM_MODE=mock against the fake module");
  let failed = 0;
  for (const n of pick) {
    const t0 = Date.now();
    const r = await SCENARIOS[n]({ env, verbose, real });
    console.log(`\n${r.pass ? "PASS" : "FAIL"}  ${n}${real ? `  (${Math.round((Date.now() - t0) / 1000)} s)` : ""}`);
    for (const c of r.checks) console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.name}${c.detail && (!c.pass || verbose || real) ? `  (${c.detail})` : ""}`);
    if (real) report(r.harness.realCalls);
    if (!r.pass) failed++;
  }
  console.log(`\n${pick.length - failed}/${pick.length} scenarios passed`);
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
