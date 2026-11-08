// Deterministic rules (agent.md 9): the auditor's rule checks and fallback verdict, and the
// orchestrator's search continue rule for an idle robot when its model is down.

import { haversineM } from "./geo.ts";
import { aboutAsClose } from "./guards.ts";
import { levelWord, sortTier } from "./priority.ts";
import { orderCells, targetedBy } from "./tools/reads.ts";
import type { AuditFlagKind, Robot, Survivor } from "./types.ts";
import type { World } from "./world.ts";

export interface ReviewPayload {
  assignment_id: number;
  survivor_id: number;
  rescuer_identity: string;
  distance_m?: number;
  critical_level?: string;
  reason?: string;
}

export interface RuleChecks {
  survivor: Survivor | null;
  callsign: string;
  proposedDistanceM: number | null;
  proposedActive: number;
  higherTier: Survivor[];
  nearerFree: { callsign: string; identity: string; distance_m: number } | null;
  lighterNearby: { callsign: string; identity: string; distance_m: number } | null;
  otherUnassigned: Array<{ survivor: Survivor; distance_m: number | null }>;
}

/**
 * Consistency check on the auditor model's own review, run as a submit_review guard. The prompt
 * says "disagree only when you can name a better action"; on real Nemotron Lightning often
 * disagreed while naming the proposal itself, or called a load unfair with no other load. A
 * rejected review leaves the rules verdict (reviewChecks) as the answer. Returns the error, or null.
 */
export function reviewConsistency(w: World, p: ReviewPayload, a: { verdict?: unknown; flag_kind?: unknown; suggested_action?: unknown }): string | null {
  if (a.verdict !== "disagree") return null;
  const c = reviewChecks(w, p);
  const text = String(a.suggested_action ?? "");
  const lower = text.toLowerCase();
  const hex = p.rescuer_identity.toLowerCase();
  // The rescuer the suggestion names first is the one it assigns ("Assign #1 to Rescuer B ...").
  let first: { callsign: string; identity: string; at: number } | null = null;
  for (const r of w.rescuers()) {
    const at = lower.indexOf(r.callsign.toLowerCase());
    if (at >= 0 && (!first || at < first.at)) first = { callsign: r.callsign, identity: r.identity.toLowerCase(), at };
  }
  const otherSurvivor = [...text.matchAll(/#(\d+)/g)].some((m) => Number(m[1]) !== p.survivor_id);
  if (a.flag_kind === "load_imbalance" && c.proposedActive === 0) {
    return `${c.callsign} has no other active assignments, so the load cannot be unfair; use proposal_disagree with a better rescuer, or agree`;
  }
  if (first && first.identity === hex && !otherSurvivor) {
    return `suggested_action keeps ${c.callsign} on survivor #${p.survivor_id}, which is the proposal itself; that is verdict agree`;
  }
  if (first && first.identity !== hex && !otherSurvivor && c.proposedDistanceM != null && c.higherTier.length === 0) {
    const s = c.survivor;
    const alt = s ? w.rescuersNear(s.lat, s.lon, false).find((r) => r.identity.toLowerCase() === first!.identity) : null;
    if (alt && alt.distance_m != null && alt.distance_m >= c.proposedDistanceM && alt.active_assignments >= c.proposedActive) {
      return `${alt.callsign} is ${alt.distance_m} m away and ${c.callsign} ${c.proposedDistanceM} m, with no lighter load; that is not a better rescuer`;
    }
  }
  return null;
}

export function reviewChecks(w: World, p: ReviewPayload): RuleChecks {
  const s = w.survivor(p.survivor_id);
  const hex = p.rescuer_identity.toLowerCase();
  const callsign = w.callsign(hex);
  const me = w.rescuer(hex);
  // The proposal itself is open, so count only active assignments for the load, and not the
  // reviewed one once the rescuer has accepted it (the review can run after the acceptance).
  const reviewed = w.assignment(p.assignment_id);
  const ownActive = reviewed && reviewed.status === "active" && reviewed.rescuer_identity.toLowerCase() === hex ? 1 : 0;
  const proposedActive = Math.max(0, (me?.active_assignments ?? 0) - ownActive);
  const proposedDistanceM = s ? w.distanceM(hex, s.id) : null;
  const out: RuleChecks = {
    survivor: s,
    callsign,
    proposedDistanceM,
    proposedActive,
    higherTier: [],
    nearerFree: null,
    lighterNearby: null,
    otherUnassigned: [],
  };
  if (!s) return out;
  const tier = sortTier(s);
  out.higherTier = w.waitingRanked().filter((x) => x.id !== s.id && sortTier(x) < tier);
  const free = w
    .rescuersNear(s.lat, s.lon, false)
    .filter((r) => r.identity !== hex && r.free && r.distance_m != null) as Array<{ callsign: string; identity: string; distance_m: number }>;
  if (proposedDistanceM != null) {
    const nearer = free.find((r) => r.distance_m < 0.5 * proposedDistanceM);
    if (nearer) out.nearerFree = { callsign: nearer.callsign, identity: nearer.identity, distance_m: nearer.distance_m };
    if (proposedActive > 0) {
      const lighter = free.find((r) => aboutAsClose(r.distance_m, proposedDistanceM));
      if (lighter) out.lighterNearby = { callsign: lighter.callsign, identity: lighter.identity, distance_m: lighter.distance_m };
    }
  }
  const rp = w.participant(hex);
  out.otherUnassigned = w
    .waitingRanked()
    .filter((x) => x.id !== s.id)
    .slice(0, 3)
    .map((x) => ({
      survivor: x,
      distance_m: rp?.lat != null && rp?.lon != null ? Math.round(haversineM(rp.lat, rp.lon, x.lat, x.lon)) : null,
    }));
  return out;
}

export function ruleChecksLine(c: RuleChecks): string {
  const higher = c.higherTier.length ? c.higherTier.map((s) => `#${s.id} ${levelWord(s)}`).join(", ") : "none";
  const nearer = c.nearerFree ? `${c.nearerFree.callsign} free at ${c.nearerFree.distance_m} m` : "none";
  const dist = c.proposedDistanceM != null ? `${Math.round(c.proposedDistanceM)} m` : "unknown";
  const lighter = c.lighterNearby ? `; ${c.lighterNearby.callsign} free and about as close at ${c.lighterNearby.distance_m} m` : "";
  return `higher-tier unassigned survivors: ${higher}; nearer available rescuer: ${nearer}; ${c.callsign} at ${dist}, active assignments: ${c.proposedActive}${lighter}`;
}

export interface Verdict {
  verdict: "agree" | "disagree";
  flag_kind?: AuditFlagKind;
  reason: string;
  suggested_action: string;
}

/**
 * disagree (proposal_disagree) if a higher-tier survivor is unassigned or a free rescuer is over
 * 50% closer; disagree (load_imbalance) if a free rescuer is about as close while the proposed one
 * already has active assignments; else agree with "rules check only".
 */
export function rulesVerdict(c: RuleChecks): Verdict {
  const sid = c.survivor?.id ?? 0;
  if (c.higherTier.length) {
    const h = c.higherTier[0];
    return {
      verdict: "disagree",
      flag_kind: "proposal_disagree",
      reason: `#${h.id} (${levelWord(h)}, tier ${sortTier(h)}) is unassigned with no proposal and ranks above #${sid}`,
      suggested_action: `propose a rescuer for #${h.id} first`,
    };
  }
  if (c.nearerFree && c.proposedDistanceM != null) {
    return {
      verdict: "disagree",
      flag_kind: "proposal_disagree",
      reason: `${c.nearerFree.callsign} is free at ${c.nearerFree.distance_m} m, over 50% closer than ${c.callsign} at ${Math.round(c.proposedDistanceM)} m`,
      suggested_action: `propose ${c.nearerFree.callsign} for #${sid}`,
    };
  }
  if (c.lighterNearby) {
    return {
      verdict: "disagree",
      flag_kind: "load_imbalance",
      reason: `${c.callsign} has ${c.proposedActive} active assignments while ${c.lighterNearby.callsign} is free at ${c.lighterNearby.distance_m} m`,
      suggested_action: `give the next survivor to ${c.lighterNearby.callsign}`,
    };
  }
  const dist = c.proposedDistanceM != null ? `${Math.round(c.proposedDistanceM)} m` : "unknown distance";
  return {
    verdict: "agree",
    reason: `rules check only: no higher tier unassigned; no free rescuer over 50% closer; ${c.callsign} at ${dist}, load ${c.proposedActive}`,
    suggested_action: "",
  };
}

/**
 * Continue rule: the next search_cells mission for an idle robot. Untargeted cells with people
 * unaccounted for first, then the nearest unsearched and partially searched cells; no inspect.
 */
export function continueMission(w: World, r: Robot): { target_cell_ids: number[]; reason: string } | null {
  if (!w.robotIdle(r)) return null;
  const site = w.site();
  const from = r.lat != null && r.lon != null ? { lat: r.lat, lon: r.lon } : site ? { lat: site.center_lat, lon: site.center_lon } : null;
  const cells = w.cells().filter((c) => c.status !== "searched" && c.status !== "searching" && targetedBy(w, c.id) == null);
  const ordered = orderCells(w, cells, from)
    .filter(({ c }) => c.unaccounted > 0 || c.status === "unsearched" || c.status === "partially_searched")
    .slice(0, 3)
    .map(({ c }) => c);
  if (ordered.length === 0) return null;
  const labels = ordered.map((c) => (c.unaccounted > 0 ? `${c.label} (${c.unaccounted} unaccounted)` : c.label)).join(", ");
  return {
    target_cell_ids: ordered.map((c) => c.id),
    reason: `[fallback] continue search: ${labels}`.slice(0, 140),
  };
}
