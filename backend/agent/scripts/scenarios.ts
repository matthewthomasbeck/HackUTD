// The eight scripted scenarios of agent.md 12.3, run in-process against the fake module with
// MockLLM on a virtual clock. Each checks end states and required tool names, not exact order.
// scripts/scenario.ts is the CLI; test/scenarios.test.ts runs them under `npm test`.

import { DEATH_WORDS, ALREADY_BY_WATCHDOG } from "../src/guards.ts";
import { offsetM } from "../src/geo.ts";
import { Harness, type HarnessOptions } from "../src/fake/harness.ts";
import type { AgentAction, AgentName, Assignment } from "../src/types.ts";
import { parseJson } from "../src/world.ts";

export const CENTER = { lat: 32.9857, lon: -96.7502 };
export const RESCUER = {
  A: "a".repeat(64),
  B: "b".repeat(64),
  C: "c".repeat(64),
  D: "d".repeat(64),
  E: "e".repeat(64),
};
const NAMES: Record<keyof typeof RESCUER, string> = { A: "Ana Lopez", B: "Ben Okafor", C: "Cara Diaz", D: "Dev Shah", E: "Eli Park" };

export interface ScenarioResult {
  name: string;
  pass: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
  harness: Harness;
}

export interface ScenarioOptions {
  env?: Record<string, string>;
  verbose?: boolean;
}

/** Position `north`/`east` meters from the site center. */
export function at(north: number, east: number) {
  return offsetM(CENTER.lat, CENTER.lon, north, east);
}
export const house = (k: number) => at(25 * k, 0);

class Checker {
  checks: ScenarioResult["checks"] = [];
  ok(name: string, cond: boolean, detail?: string): void {
    this.checks.push({ name, pass: !!cond, detail });
  }
}

/** Site, run, six houses, and the robot searching house 3 (not idle), as in agent.md section 10. */
function seed(h: Harness, rescuers: Array<[keyof typeof RESCUER, number, number]>, opts: { robotIdle?: boolean } = {}) {
  const m = h.module;
  m.createSite({ name: "demo site", center_lat: CENTER.lat, center_lon: CENTER.lon, demo_mode: true, require_mission_approval: true });
  m.startRun("demo 2");
  const cells = [1, 2, 3, 4, 5, 6].map((k) => m.addCell(`house ${k}`, house(k).lat, house(k).lon));
  m.addRobot("dog1", house(3).lat, house(3).lon);
  if (!opts.robotIdle) {
    const mission = h.store.insert("mission", {
      chain_id: 0,
      robot_id: "dog1",
      kind: "search_cells",
      target_cell_ids: [cells[2].id],
      target_lat: null,
      target_lon: null,
      status: "active",
      lease_expires_at: null,
      created_by: "coordinator",
      reason: "search house 3",
      created_at: h.clock.now(),
      updated_at: h.clock.now(),
    });
    h.store.update("search_cell", { ...cells[2], status: "searching" });
    m.setRobot("dog1", { state: "ACTIVE", current_mission_id: mission.id });
  }
  for (const [k, n, e] of rescuers) {
    const p = at(n, e);
    m.addRescuer(NAMES[k], p.lat, p.lon, RESCUER[k]);
  }
  return cells;
}

/** The simulated glasses: the named rescuers accept each proposal after delayMs. */
function autoAccept(h: Harness, who: string[], delayMs: number): void {
  h.store.onChange((c) => {
    if (c.table !== "assignment" || c.op !== "insert") return;
    const a = c.row as Assignment;
    if (a.status !== "proposed" || !who.includes(a.rescuer_identity)) return;
    h.clock.setTimeout(() => {
      const cur = h.store.get("assignment", a.id);
      if (cur?.status === "proposed") {
        try {
          h.module.acceptAssignment(a.rescuer_identity, a.id);
        } catch {
          /* survivor already taken */
        }
      }
    }, delayMs);
  });
}

function actions(h: Harness, agent?: string, tool?: string): AgentAction[] {
  return h.store.rows("agent_action").filter((a) => (!agent || a.agent === agent) && (!tool || a.tool === tool));
}

function okActions(h: Harness, agent: string, tool: string): AgentAction[] {
  return actions(h, agent, tool).filter((a) => a.result.startsWith("ok"));
}

function noDeathWords(h: Harness): boolean {
  const texts = [
    ...h.store.rows("briefing").map((b) => b.text),
    ...h.store.rows("agent_action").map((a) => a.reason + " " + a.args_json),
    ...h.store.rows("agent_task").map((t) => t.payload_json + " " + (t.result_json ?? "")),
  ];
  return !texts.some((t) => DEATH_WORDS.test(t));
}

function harness(fixtures: string[], o: ScenarioOptions, extra: HarnessOptions = {}): Harness {
  return new Harness({ fixtures: [...fixtures, "common"], verbose: o.verbose, ...extra, env: { ...(extra.env ?? {}), ...(o.env ?? {}) } });
}

async function finish(name: string, h: Harness, c: Checker): Promise<ScenarioResult> {
  h.stop();
  return { name, pass: c.checks.every((x) => x.pass), checks: c.checks, harness: h };
}

const ALL: AgentName[] = ["orchestrator", "comms_agent", "auditor"];

// ---------- chain (agent.md 10, steps 1 to 8) ----------

export async function chain(o: ScenarioOptions = {}): Promise<ScenarioResult> {
  const h = harness(["chain"], o);
  const c = new Checker();
  const cells = seed(h, [
    ["A", 75, 40],
    ["B", 75, -120],
  ]);
  h.module.start();
  await h.startAgents(ALL);
  autoAccept(h, [RESCUER.A], 8000);
  h.module.reportPerson(cells[2].id, "missing", 2);
  await h.run(1000);
  const sid = h.module.addSurvivor({
    ...house(3),
    cell_id: cells[2].id,
    house_label: "house 3",
    location_note: "8 m in from front door",
    level: "immediate",
    score: 78,
    breathing: "detected",
    rate: 34,
    conf: 0.71,
    visibility: 40,
  });
  const chainId = h.module.survivorChain(sid);
  await h.run(30_000);

  const props = h.store.rows("assignment").filter((a) => a.survivor_id === sid);
  c.ok("one proposal, to Rescuer A, by the orchestrator", props.length === 1 && props[0].rescuer_identity === RESCUER.A && props[0].created_by === "orchestrator", JSON.stringify(props.map((p) => [p.created_by, p.rescuer_identity.slice(0, 4), p.status])));
  const tasks = h.store.rows("agent_task");
  const brief = tasks.find((t) => t.kind === "brief_rescuer");
  const review = tasks.find((t) => t.kind === "review");
  c.ok("brief_rescuer task on the survivor chain", !!brief && brief.chain_id === chainId, `chain ${brief?.chain_id} vs ${chainId}`);
  c.ok("review task on the survivor chain", !!review && review.chain_id === chainId);
  c.ok("review has a verdict in result_json", !!review?.result_json && !!parseJson<{ verdict?: string }>(review.result_json)?.verdict, review?.result_json ?? "none");
  const mission = h.store.rows("mission").find((m) => m.created_by === "orchestrator" && m.kind === "inspect");
  c.ok("inspect mission by the orchestrator on the chain", !!mission && mission.chain_id === chainId);
  const toA = h.store.rows("briefing").filter((b) => b.audience === RESCUER.A);
  c.ok("a briefing to Rescuer A of at most 120 characters", toA.some((b) => b.kind === "briefing" && b.text.length <= 120 && b.chain_id === chainId), toA.map((b) => b.text).join(" | "));
  c.ok("navigation hint after acceptance", toA.some((b) => b.kind === "nav"));
  c.ok("no proposal by the comms agent or the auditor", actions(h, "comms_agent", "propose_assignment").length === 0 && actions(h, "auditor", "propose_assignment").length === 0 && props.every((p) => p.created_by === "orchestrator"));
  c.ok("required tools ran", okActions(h, "orchestrator", "propose_assignment").length >= 1 && okActions(h, "orchestrator", "delegate").length >= 1 && okActions(h, "orchestrator", "create_mission").length >= 1 && okActions(h, "comms_agent", "send_briefing").length >= 1 && okActions(h, "auditor", "submit_review").length >= 1);
  const chainActs = h.store.rows("agent_action").filter((a) => ["propose_assignment", "delegate", "create_mission", "send_briefing", "submit_review"].includes(a.tool) && a.result.startsWith("ok"));
  c.ok("every chain action carries the chain_id", chainActs.length > 0 && chainActs.every((a) => a.chain_id === chainId), chainActs.map((a) => `${a.tool}:${a.chain_id}`).join(","));
  c.ok("no death words", noDeathWords(h));
  return finish("chain", h, c);
}

// ---------- priority ----------

export async function priority(o: ScenarioOptions = {}): Promise<ScenarioResult> {
  const h = harness(["priority"], o);
  const c = new Checker();
  const cells = seed(h, [["A", 60, 30]]);
  h.module.start();
  await h.startAgents(ALL);
  const delayed = h.module.addSurvivor({ ...house(2), cell_id: cells[1].id, house_label: "house 2", location_note: "under the stairs", level: "delayed", score: 70, breathing: "detected", rate: 18, conf: 0.8 });
  await h.run(500);
  const nd = h.module.addSurvivor({ ...house(4), cell_id: cells[3].id, house_label: "house 4", location_note: "back bedroom, covered", level: "immediate", score: 60, breathing: "not_detected", conf: 0.2 });
  await h.run(20_000);
  const first = h.store.rows("assignment").sort((a, b) => a.id - b.id)[0];
  c.ok("the free rescuer goes to the not_detected survivor", !!first && first.survivor_id === nd && first.rescuer_identity === RESCUER.A, first ? `first proposal for #${first.survivor_id}` : "no proposal");
  c.ok("the delayed survivor was not proposed first", !h.store.rows("assignment").some((a) => a.survivor_id === delayed && a.id < (first?.id ?? 0)));
  const rejected = actions(h, "orchestrator", "propose_assignment").find((a) => a.result.startsWith("error") && a.result.includes(`#${nd}`));
  c.ok("the guard named the tier 0 survivor", !!rejected, rejected?.result);
  c.ok("no death words", noDeathWords(h));
  return finish("priority", h, c);
}

// ---------- kill_orchestrator ----------

export async function killOrchestrator(o: ScenarioOptions = {}): Promise<ScenarioResult> {
  const h = harness(["simple"], o);
  const c = new Checker();
  const cells = seed(h, [
    ["A", 75, 40],
    ["B", 75, -120],
  ]);
  h.module.start();
  // Two processes in the demo; here two groups of runtimes in one harness.
  await h.startAgents(ALL);
  autoAccept(h, [RESCUER.A, RESCUER.B], 4000);
  await h.run(3000);
  h.stopAgent("orchestrator");
  const killedAt = h.clock.now();
  await h.run(1000);
  const sid = h.module.addSurvivor({ ...house(3), cell_id: cells[2].id, house_label: "house 3", location_note: "8 m in from front door", level: "immediate", score: 80, breathing: "detected", rate: 36, conf: 0.7 });
  const addedAt = h.clock.now();
  let maxHeadline = 0;
  for (let i = 0; i < 40; i++) {
    await h.run(1000);
    maxHeadline = Math.max(maxHeadline, h.module.headline());
  }
  const fallback = h.store.rows("event_log").find((e) => e.kind === "agent_watchdog_fallback");
  const props = h.store.rows("assignment").filter((a) => a.survivor_id === sid);
  const N = 15_000;
  c.ok("agent_watchdog_fallback event", !!fallback);
  c.ok("module proposal within N s of the kill", props.length > 0 && props[0].created_by === "module" && props[0].created_at - killedAt <= N + 1000, props[0] ? `${(props[0].created_at - addedAt) / 1000} s after the survivor` : "none");
  const rulesBrief = okActions(h, "comms_agent", "send_briefing").filter((a) => a.model === "rules");
  c.ok("comms agent briefed it from the template (model rules)", rulesBrief.length > 0 && rulesBrief.every((a) => a.reason.startsWith("[fallback]")));
  c.ok("headline stays 0", maxHeadline === 0, `max ${maxHeadline}`);
  c.ok("never two proposals for one survivor", props.length === 1, `${props.length} proposals`);
  c.ok("the auditor reviewed the watchdog proposal", h.store.rows("agent_task").some((t) => t.kind === "review" && t.from_agent === "module" && t.status === "done"));
  return finish("kill_orchestrator", h, c);
}

// ---------- race ----------

export async function race(o: ScenarioOptions = {}): Promise<ScenarioResult> {
  const h = harness(["race"], o);
  const c = new Checker();
  const cells = seed(h, [
    ["A", 75, 40],
    ["B", 75, -120],
  ]);
  h.module.start();
  await h.startAgents(ALL);
  await h.run(2000);
  const sid = h.module.addSurvivor({ ...house(3), cell_id: cells[2].id, house_label: "house 3", location_note: "8 m in from front door", level: "immediate", score: 80, breathing: "detected", rate: 36, conf: 0.7 });
  await h.run(45_000);
  const props = h.store.rows("assignment").filter((a) => a.survivor_id === sid);
  c.ok("exactly one proposal", props.length === 1, props.map((p) => p.created_by).join(","));
  c.ok("the proposal came from the watchdog", props[0]?.created_by === "module");
  const logged = actions(h, "orchestrator", "propose_assignment").some((a) => a.result.includes(ALREADY_BY_WATCHDOG));
  c.ok('"already proposed by watchdog" in the log', logged);
  return finish("race", h, c);
}

// ---------- auditor_disagrees ----------

export async function auditorDisagrees(o: ScenarioOptions = {}): Promise<ScenarioResult> {
  const h = harness(["auditor_disagrees"], o);
  const c = new Checker();
  const cells = seed(h, [
    ["A", 75, 40],
    ["B", 75, -100],
  ]);
  h.module.start();
  await h.startAgents(ALL);
  await h.run(1000);
  const sid = h.module.addSurvivor({ ...house(3), cell_id: cells[2].id, house_label: "house 3", location_note: "8 m in from front door", level: "immediate", score: 78, breathing: "detected", rate: 34, conf: 0.71 });
  await h.run(20_000);
  const review = h.store.rows("agent_task").find((t) => t.kind === "review");
  const verdict = parseJson<{ verdict?: string }>(review?.result_json)?.verdict;
  c.ok("auditor completed review with disagree", review?.status === "done" && verdict === "disagree", review?.result_json ?? "none");
  const flags = h.store.rows("audit_flag").filter((f) => f.kind === "proposal_disagree" && f.filed_by === "auditor");
  c.ok("one proposal_disagree flag filed by the auditor", flags.length === 1);
  c.ok("the orchestrator set the flag status with a reason", flags[0]?.status !== "open" && okActions(h, "orchestrator", "set_flag_status").some((a) => a.reason.length >= 3));
  const prop = h.store.rows("assignment").find((a) => a.survivor_id === sid);
  c.ok("the review did not block the proposal", !!prop && prop.rescuer_identity === RESCUER.B && (prop.status === "proposed" || prop.status === "active" || prop.release_cause === "expired"), prop?.status);
  return finish("auditor_disagrees", h, c);
}

// ---------- comms_fallback ----------

export async function commsFallback(o: ScenarioOptions = {}): Promise<ScenarioResult> {
  const c = new Checker();
  // Variant 1: ENABLE_COMMS_MODEL=0. Variant 2: Nano rejects every comms request (bad key for Nano).
  const variants: Array<{ label: string; extra: HarnessOptions }> = [
    { label: "templates", extra: { env: { ENABLE_COMMS_MODEL: "0" } } },
    { label: "nano failing", extra: { rules: [{ agent: "comms_agent", turn: "any", fail: "bad_request" }] } },
  ];
  let last: Harness | null = null;
  for (const v of variants) {
    const h = harness(["simple"], o, v.extra);
    last = h;
    const cells = seed(h, [
      ["A", 75, 40],
      ["B", 75, -120],
    ]);
    h.module.start();
    await h.startAgents(ALL);
    autoAccept(h, [RESCUER.A], 20_000);
    await h.run(1000);
    h.module.addSurvivor({ ...house(3), cell_id: cells[2].id, house_label: "house 3", location_note: "8 m in from front door", level: "immediate", score: 78, breathing: "not_detected", conf: 0.3 });
    await h.run(30_000);
    const rules = okActions(h, "comms_agent", "send_briefing").filter((a) => a.model === "rules");
    c.ok(`${v.label}: template briefing with model rules`, rules.some((a) => a.reason.startsWith("[fallback] template briefing")));
    const toA = h.store.rows("briefing").filter((b) => b.audience === RESCUER.A);
    c.ok(`${v.label}: nudge after half the proposal lease`, toA.some((b) => b.kind === "nudge"), toA.map((b) => `${b.kind}:${b.text}`).join(" | "));
    c.ok(`${v.label}: briefings at most 120 characters`, toA.every((b) => b.text.length <= 120));
    const holders = new Set(h.store.rows("assignment").filter((a) => a.status === "proposed" || a.status === "active").map((a) => a.rescuer_identity));
    c.ok(`${v.label}: no empty glasses panel`, [...holders].every((id) => h.store.rows("briefing").some((b) => b.audience === id)));
    c.ok(`${v.label}: no death words ("breathing not seen" wording)`, noDeathWords(h) && toA.some((b) => b.text.includes("breathing not seen, low confidence")));
    h.stop();
  }
  return { name: "comms_fallback", pass: c.checks.every((x) => x.pass), checks: c.checks, harness: last! };
}

// ---------- all_down ----------

export async function allDown(o: ScenarioOptions = {}): Promise<ScenarioResult> {
  const h = harness([], o);
  const c = new Checker();
  const cells = seed(h, [
    ["A", 50, 30],
    ["B", 100, 30],
    ["C", 150, -30],
  ]);
  h.module.start();
  // No agents at all. A and B accept on their glasses; C never answers.
  autoAccept(h, [RESCUER.A, RESCUER.B], 3000);
  const s1 = h.module.addSurvivor({ ...house(2), cell_id: cells[1].id, house_label: "house 2", location_note: "kitchen", level: "immediate", score: 80, breathing: "detected", rate: 36, conf: 0.7 });
  const s2 = h.module.addSurvivor({ ...house(4), cell_id: cells[3].id, house_label: "house 4", location_note: "hallway", level: "immediate", score: 75, breathing: "not_detected", conf: 0.2 });
  const s3 = h.module.addSurvivor({ ...house(6), cell_id: cells[5].id, house_label: "house 6", location_note: "garage", level: "immediate", score: 70, breathing: "unknown", conf: 0 });
  await h.run(25_000);
  const firstWave = h.store.rows("assignment").filter((a) => a.created_by === "module").length;
  c.ok("watchdog proposals for every immediate survivor", [s1, s2, s3].every((sid) => h.store.rows("assignment").some((a) => a.survivor_id === sid && a.created_by === "module")), `${firstWave} proposals`);
  // A's glasses die while A holds an active assignment.
  const aActive = h.store.rows("assignment").find((a) => a.rescuer_identity === RESCUER.A && a.status === "active");
  h.module.dropRescuer(RESCUER.A);
  await h.run(60_000);
  const released = aActive ? h.store.get("assignment", aActive.id) : null;
  c.ok("release on heartbeat loss", released?.status === "released" && released.release_cause === "heartbeat", released?.release_cause ?? "no active assignment for A");
  if (aActive) {
    const again = h.store.rows("assignment").filter((a) => a.survivor_id === aActive.survivor_id && a.id !== aActive.id && a.created_by === "module");
    c.ok("the watchdog re-proposed the released survivor", again.length > 0);
  }
  c.ok("escalation briefings", h.store.rows("briefing").some((b) => b.kind === "escalation" && b.audience === "all"));
  const stuck = h.store
    .rows("survivor")
    .filter((s) => s.critical_level === "immediate" && s.status === "unassigned")
    .filter((s) => !h.store.rows("assignment").some((a) => a.survivor_id === s.id && a.status === "proposed"));
  // A survivor between a lapsed proposal and the next watchdog pass waits at most one watchdog period.
  c.ok("no stuck survivor", stuck.every((s) => h.store.rows("assignment").some((a) => a.survivor_id === s.id && h.clock.now() - a.updated_at <= 15_000)), stuck.map((s) => "#" + s.id).join(","));
  c.ok("no agent actions (every agent down)", h.store.rows("agent_action").every((a) => a.agent === "module"));
  return finish("all_down", h, c);
}

// ---------- budget ----------

export async function budget(o: ScenarioOptions = {}): Promise<ScenarioResult> {
  const h = harness(["budget"], o);
  const c = new Checker();
  const cells = seed(
    h,
    [
      ["A", 25, 20],
      ["B", 50, 20],
      ["C", 75, 20],
      ["D", 100, 20],
      ["E", 125, 20],
    ],
    {},
  );
  h.module.start();
  await h.startAgents(ALL);
  autoAccept(h, Object.values(RESCUER), 3000);
  for (let i = 0; i < 10; i++) {
    const k = (i % 6) + 1;
    h.module.addSurvivor({ ...at(25 * k, 3 + i), cell_id: cells[k - 1].id, house_label: `house ${k}`, location_note: `spot ${i + 1}`, level: "immediate", score: 90 - i, breathing: "detected", rate: 32, conf: 0.6 });
    await h.run(1000);
  }
  await h.run(110_000);
  c.ok("at most RPM_BUDGET requests in any minute", h.budget.maxPerMinute() <= h.cfg.RPM_BUDGET, `max ${h.budget.maxPerMinute()} of ${h.cfg.RPM_BUDGET}`);
  // One orchestrator cycle covers several survivors: count ok proposals between cycle summaries.
  let best = 0;
  let cur = 0;
  for (const a of h.store.rows("agent_action").filter((x) => x.agent === "orchestrator").sort((x, y) => x.id - y.id)) {
    if (a.tool === "cycle_summary") {
      best = Math.max(best, cur);
      cur = 0;
    } else if (a.tool === "propose_assignment" && a.result.startsWith("ok")) cur++;
  }
  c.ok("one orchestrator cycle covers several survivors", Math.max(best, cur) >= 2, `max ${Math.max(best, cur)} proposals in one cycle`);
  const auditorRules = actions(h, "auditor", "submit_review").filter((a) => a.model === "rules").sort((x, y) => x.created_at - y.created_at);
  const commsRules = actions(h, "comms_agent", "send_briefing")
    .filter((a) => a.model === "rules" && a.reason.includes("template briefing"))
    .sort((x, y) => x.created_at - y.created_at);
  c.ok("the auditor falls back first", auditorRules.length > 0 && (commsRules.length === 0 || auditorRules[0].created_at <= commsRules[0].created_at), `auditor rules ${auditorRules.length}, comms rules ${commsRules.length}`);
  c.ok("no HTTP 429 loops", h.mock.requests.length <= h.cfg.RPM_BUDGET * 3 && h.budget.drops.length >= 0 && h.mock.limited === 0, `${h.mock.limited} mock 429s`);
  c.ok("every survivor proposed", h.store.rows("survivor").every((s) => h.store.rows("assignment").some((a) => a.survivor_id === s.id)));
  return finish("budget", h, c);
}

export const SCENARIOS: Record<string, (o?: ScenarioOptions) => Promise<ScenarioResult>> = {
  chain,
  priority,
  kill_orchestrator: killOrchestrator,
  race,
  auditor_disagrees: auditorDisagrees,
  comms_fallback: commsFallback,
  all_down: allDown,
  budget,
};
