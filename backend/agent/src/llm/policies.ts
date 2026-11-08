// Scripted MockLLM policies for fixtures that cannot be static (LLM_MODE=mock only).
// They read the wake packet, which this runner writes, so they play a simple, rule-following model.

import type { FixtureReply, MockPolicy } from "./mock.ts";
import type { ChatRequest } from "./types.ts";
import { NEXT_CELLS_LABEL } from "../agents/orchestrator.ts";

function packetOf(req: ChatRequest): string {
  return req.messages.find((m) => m.role === "user")?.content ?? "";
}

/** comms agent: a short briefing to the rescuer named in the packet. */
const briefFromPacket: MockPolicy = (req) => {
  const p = packetOf(req);
  const who = /for (Rescuer \w+), assignment/.exec(p);
  const surv = /SURVIVOR #(\d+): (\w+)/.exec(p);
  if (!who || !surv) return null;
  const place = /, (house \d+)/.exec(p)?.[1] ?? `survivor #${surv[1]}`;
  const nav = p.startsWith("NAVIGATION");
  const text = nav ? `Enter ${place} for #${surv[1]}. Follow the arrow.` : `${surv[2].replace(/,$/, "")} ${place}: survivor #${surv[1]}, go now.`;
  return {
    tool_calls: [
      {
        name: "send_briefing",
        arguments: {
          reason: nav ? `navigation hint for ${who[1]}` : `brief ${who[1]} on #${surv[1]}`,
          audience: who[1],
          text,
          priority: nav ? "info" : "critical",
          survivor_id: Number(surv[1]),
        },
      },
    ],
  };
};

const MAX_CALLS = 8;

/**
 * orchestrator, as a rule-following model would act on the packet:
 * - every robot the ROBOT line shows idle (on any wake, not only the idle transition) gets one
 *   search_cells mission over the next cells to search (up to 3, distinct per robot); the
 *   robotIdle rule already excludes a robot with a proposed, queued, or leased mission;
 * - each waiting survivor, in packet order, gets its best listed candidate (fewest active, then
 *   nearest) not used yet in this reply, plus the brief_rescuer delegate. Once a survivor has no
 *   unused candidate, lower-tier survivors wait (the tier rule would reject them).
 * Missions are planned first so a long survivor list never crowds them out of the 8 calls.
 */
const greedyOrchestrator: MockPolicy = (req) => {
  const p = packetOf(req);
  const lines = p.split("\n");
  const available = new Set<string>();
  for (const m of p.matchAll(/(Rescuer \w+) available/g)) available.add(m[1]);

  const missions: NonNullable<FixtureReply["tool_calls"]> = [];
  const robotLine = lines.find((l) => l.startsWith("ROBOT:")) ?? "";
  const cellLine = lines.find((l) => l.startsWith("CELLS:")) ?? "";
  const nextList = cellLine.split(`${NEXT_CELLS_LABEL}: `)[1] ?? "";
  const freeCells = [...nextList.matchAll(/#(\d+) ([^,;]+)/g)].map((m) => ({ id: Number(m[1]), label: m[2].trim() }));
  for (const m of robotLine.replace(/^ROBOT: /, "").split("; ").map((e) => /^([a-z0-9_-]+) online READY idle\b/.exec(e))) {
    if (!m) continue;
    const pick = freeCells.splice(0, 3);
    if (!pick.length) break;
    missions.push({
      name: "create_mission",
      arguments: { reason: `${m[1]} idle; search ${pick.map((c) => c.label).join(", ")}`.slice(0, 140), robot_id: m[1], kind: "search_cells", target_cell_ids: pick.map((c) => c.id) },
    });
  }

  const calls: NonNullable<FixtureReply["tool_calls"]> = [];
  const used = new Set<string>();
  let blockedTier = Infinity;
  for (const line of lines) {
    const m = /^\s+#(\d+) .*?(IMMEDIATE|DELAYED|MINOR).*\| candidates[^:]*: (.*?)(?: \| lapsed.*)?$/.exec(line);
    if (!m) continue;
    const tier = m[2] === "IMMEDIATE" ? 0 : 1;
    if (tier > blockedTier) break;
    if (calls.length + 2 + missions.length > MAX_CALLS) break;
    const pick = m[3]
      .split("; ")
      .map((x) => /^(Rescuer \w+) (\d+) m.*?, (\d+) active$/.exec(x))
      .find((x) => x && available.has(x[1]) && !used.has(x[1]));
    if (!pick) {
      blockedTier = Math.min(blockedTier, tier);
      continue;
    }
    used.add(pick[1]);
    const sid = Number(m[1]);
    calls.push({
      name: "propose_assignment",
      arguments: { reason: `${m[2]} #${sid}; ${pick[1]} at ${pick[2]} m, load ${pick[3]}, best by load then distance`, survivor_id: sid, rescuer_identity: pick[1] },
    });
    calls.push({ name: "delegate", arguments: { reason: `brief ${pick[1]} on #${sid}`, to_agent: "comms_agent", kind: "brief_rescuer", priority: m[2] === "IMMEDIATE" ? "critical" : "high", survivor_id: sid } });
  }
  calls.push(...missions);
  return calls.length ? { tool_calls: calls } : { content: "No available rescuer for the waiting survivors." };
};

export const DEFAULT_POLICIES: Record<string, MockPolicy> = {
  brief_from_packet: briefFromPacket,
  greedy_orchestrator: greedyOrchestrator,
};
