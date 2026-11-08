// npm run scenario -- <name|all> [--verbose] [--live]
//
// Runs the scripted scenarios of agent.md 12.3. By default they run in-process against the fake
// module (src/fake/module.ts) with MockLLM on a virtual clock, so they need no SpacetimeDB, no
// simulator, and no NVIDIA key; against the fake module every write goes to the fake module, which
// is the DRY_RUN shadow, so no real reducer runs.
// --live is the path for the published module plus backend/sim in demo mode; it is not built yet
// (no bindings or simulator exist), and exits with a clear message.

import "dotenv/config";
import { SCENARIOS } from "./scenarios.ts";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const live = args.includes("--live");
  const names = args.filter((a) => !a.startsWith("--"));
  const pick = names.length === 0 || names.includes("all") ? Object.keys(SCENARIOS) : names;

  if (live) {
    console.error(
      "scenario --live needs the published module, the generated bindings in backend/spacetimedb-bindings/, " +
        "and the simulator in backend/sim/. None exist yet. Run without --live to use the in-process fake module.",
    );
    return 2;
  }
  const unknown = pick.filter((n) => !SCENARIOS[n]);
  if (unknown.length) {
    console.error(`unknown scenario(s): ${unknown.join(", ")}. Known: ${Object.keys(SCENARIOS).join(", ")}`);
    return 2;
  }
  const env: Record<string, string> = {};
  for (const k of ["ENABLE_COMMS_MODEL", "ENABLE_AUDITOR_MODEL", "TOOL_MODE", "TOOL_MODE_SUPER", "TOOL_MODE_NANO", "RPM_BUDGET"]) {
    const v = process.env[k];
    if (v !== undefined && v !== "") env[k] = v;
  }
  if (process.env.LLM_MODE && process.env.LLM_MODE !== "mock") console.log("note: scenarios always use LLM_MODE=mock against the fake module");
  let failed = 0;
  for (const n of pick) {
    const r = await SCENARIOS[n]({ env, verbose });
    console.log(`\n${r.pass ? "PASS" : "FAIL"}  ${n}`);
    for (const c of r.checks) console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.name}${c.detail && (!c.pass || verbose) ? `  (${c.detail})` : ""}`);
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
