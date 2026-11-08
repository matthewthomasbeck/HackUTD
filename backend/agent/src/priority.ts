// Survivor tiers and ordering (agent.md 7.1, rule G3).
// Tier 0: immediate or unknown level, or breathing not_detected or unknown, whatever the level says.
// Tier 1: delayed. Tier 2: minor (sorted with tier 1, with a warning, since perception never assigns it).

import type { Survivor } from "./types.ts";

export type Tier = 0 | 1 | 2;

export function tierOf(s: Pick<Survivor, "critical_level" | "breathing">): Tier {
  if (s.breathing === "not_detected" || s.breathing === "unknown") return 0;
  if (s.critical_level === "immediate" || s.critical_level === "unknown") return 0;
  if (s.critical_level === "delayed") return 1;
  return 2;
}

/** Tier used for ordering: tier 2 sorts with tier 1. */
export function sortTier(s: Pick<Survivor, "critical_level" | "breathing">): number {
  const t = tierOf(s);
  return t === 2 ? 1 : t;
}

/** Most urgent first: tier, then higher critical_score, then older created_at, then lower id. */
export function compareSurvivors(a: Survivor, b: Survivor): number {
  const ta = sortTier(a);
  const tb = sortTier(b);
  if (ta !== tb) return ta - tb;
  if (a.critical_score !== b.critical_score) return b.critical_score - a.critical_score;
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  return a.id - b.id;
}

export function sortSurvivors(list: Survivor[], warn?: (msg: string) => void): Survivor[] {
  if (warn) {
    for (const s of list) if (tierOf(s) === 2) warn(`survivor #${s.id} has level minor; sorted with tier 1`);
  }
  return [...list].sort(compareSurvivors);
}

export function levelWord(s: Pick<Survivor, "critical_level" | "breathing">): string {
  // A person whose level is unknown is treated as IMMEDIATE until scored (orchestrator prompt).
  if (s.critical_level === "unknown") return "IMMEDIATE";
  if (tierOf(s) === 0) return "IMMEDIATE";
  return s.critical_level.toUpperCase();
}

/** Display string used by get_survivor and the packets. Never a death word (G2). */
export function breathingDisplay(s: Pick<Survivor, "breathing" | "breathing_rate_bpm" | "breathing_confidence">): string {
  if (s.breathing === "detected") {
    const rate = s.breathing_rate_bpm == null ? "?" : String(Math.round(s.breathing_rate_bpm));
    return `breathing ${rate}/min conf ${s.breathing_confidence.toFixed(2)}`;
  }
  if (s.breathing === "not_detected") return "no signs of life detected, low confidence, needs human check";
  return "breathing not seen yet, low confidence";
}
