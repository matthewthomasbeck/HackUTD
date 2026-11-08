// Scripted MockLLM policies for fixtures that cannot be static (LLM_MODE=mock only).
// They read the wake packet, which this runner writes, so they play a simple, rule-following model.

import type { FixtureReply, MockPolicy } from "./mock.ts";
import type { ChatRequest } from "./types.ts";

function packetOf(req: ChatRequest): string {
  return req.messages.find((m) => m.role === "user")?.content ?? "";
}

/** comms agent: a short briefing to the rescuer named in the packet. */
const briefFromPacket: MockPolicy = (req) => {
  const p = packetOf(req);
  const who = /for (Rescuer \w+) \(identity ([0-9a-f]{64})\)/.exec(p);
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
          audience: who[2],
          text,
          priority: nav ? "info" : "critical",
          survivor_id: Number(surv[1]),
        },
      },
    ],
  };
};

/** orchestrator: for each waiting survivor in packet order, the nearest available rescuer not yet used. */
const greedyOrchestrator: MockPolicy = (req) => {
  const p = packetOf(req);
  const ids = new Map<string, string>();
  for (const m of p.matchAll(/(Rescuer \w+) available[^;]*?, id ([0-9a-f]{64})/g)) ids.set(m[1], m[2]);
  const used = new Set<string>();
  const calls: NonNullable<FixtureReply["tool_calls"]> = [];
  for (const line of p.split("\n")) {
    const m = /^\s+#(\d+) .*?(IMMEDIATE|DELAYED|MINOR).*nearest available: (.*)$/.exec(line);
    if (!m) continue;
    const pick = m[3]
      .split(", ")
      .map((x) => /^(Rescuer \w+) (\d+) m/.exec(x))
      .find((x) => x && ids.has(x[1]) && !used.has(x[1]));
    if (!pick) continue;
    used.add(pick[1]);
    const sid = Number(m[1]);
    calls.push({ name: "propose_assignment", arguments: { reason: `${m[2]} #${sid}; ${pick[1]} nearest at ${pick[2]} m`, survivor_id: sid, rescuer_identity: ids.get(pick[1])! } });
    calls.push({ name: "delegate", arguments: { reason: `brief ${pick[1]} on #${sid}`, to_agent: "comms_agent", kind: "brief_rescuer", priority: m[2] === "IMMEDIATE" ? "critical" : "high", survivor_id: sid } });
    if (calls.length >= 8) break;
  }
  // A robot named idle in the WAKE line gets a search mission over the next unsearched cells in
  // the CELLS line (up to 3, distinct per robot), as a rule-following model would.
  const wakeLine = p.split("\n").find((l) => l.startsWith("WAKE:")) ?? "";
  const robotLine = p.split("\n").find((l) => l.startsWith("ROBOT:")) ?? "";
  const cellLine = p.split("\n").find((l) => l.startsWith("CELLS:")) ?? "";
  const freeCells = [...cellLine.matchAll(/#(\d+) ([^,;]+)/g)].map((m) => ({ id: Number(m[1]), label: m[2].trim() }));
  for (const m of wakeLine.matchAll(/robot ([a-z0-9_-]+) idle/g)) {
    const id = m[1];
    if (!new RegExp(`(^|[ ;])${id} online READY idle`).test(robotLine)) continue;
    const pick = freeCells.splice(0, 3);
    if (!pick.length || calls.length >= 8) break;
    calls.push({
      name: "create_mission",
      arguments: {
        reason: `${id} idle; search ${pick.map((c) => c.label).join(", ")}`,
        robot_id: id,
        kind: "search_cells",
        target_cell_ids: pick.map((c) => c.id),
      },
    });
  }
  return calls.length ? { tool_calls: calls } : { content: "No available rescuer for the waiting survivors." };
};

export const DEFAULT_POLICIES: Record<string, MockPolicy> = {
  brief_from_packet: briefFromPacket,
  greedy_orchestrator: greedyOrchestrator,
};
