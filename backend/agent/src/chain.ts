// chain_id (agent.md 5.5): for a survivor, the event_log id of its survivor_created event.
// A task carries its chain; every action and task it causes uses the same chain.
// A row wake that is not about a survivor uses its event id if one exists, else 0.

import type { Wake } from "./agent-types.ts";
import type { AgentTask } from "./types.ts";
import { parseJson, type World } from "./world.ts";

export function survivorChain(w: World, survivorId: number): number {
  const ev = w
    .raw("event_log")
    .find((e) => e.kind === "survivor_created" && e.entity === "survivor" && e.entity_id === survivorId);
  if (ev) return ev.id;
  // Fallback: an assignment or detection of this survivor already carries the chain.
  const a = w.assignmentsFor(survivorId).find((x) => x.chain_id);
  if (a) return a.chain_id;
  const d = w.raw("detection").find((x) => x.survivor_id === survivorId && x.chain_id);
  return d ? d.chain_id : 0;
}

export function taskChain(w: World, t: AgentTask): number {
  if (t.chain_id) return t.chain_id;
  const p = parseJson<{ chain_id?: number; survivor_id?: number }>(t.payload_json);
  if (p?.chain_id) return p.chain_id;
  if (p?.survivor_id) return survivorChain(w, p.survivor_id);
  return 0;
}

/** Chain for a cycle: the task's chain, else the first survivor wake's chain, else a wake's own chain. */
export function resolveChain(w: World, task: AgentTask | null, wakes: Wake[]): number {
  if (task) return taskChain(w, task);
  for (const wk of wakes) if (wk.survivorId) {
    const c = survivorChain(w, wk.survivorId);
    if (c) return c;
  }
  for (const wk of wakes) if (wk.chainId) return wk.chainId;
  return 0;
}
