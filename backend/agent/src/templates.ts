// Template briefings (agent.md 7.3), used for nudges always, and for everything when the comms
// model is down or cut. Every template is at most 120 characters, plain ASCII, one line;
// parts are dropped from the end to fit.

import { asciiLine, BRIEFING_MAX } from "./guards.ts";
import { levelWord } from "./priority.ts";
import type { Survivor } from "./types.ts";

const ROUGH_TERRAIN = ["debris", "step", "gap", "blocked"];

function sentence(s: string): string {
  const t = asciiLine(s).replace(/[.\s]+$/, "");
  return t ? t + "." : "";
}

/** Join parts with spaces, dropping parts from the end until the line fits in max characters. */
export function fitParts(parts: string[], max = BRIEFING_MAX): string {
  const clean = parts.map((p) => asciiLine(p)).filter(Boolean);
  while (clean.length > 1 && clean.join(" ").length > max) clean.pop();
  let out = clean.join(" ");
  if (out.length > max) out = out.slice(0, max - 3).replace(/\s+\S*$/, "") + "...";
  return out.slice(0, max);
}

export function breathingPart(s: Pick<Survivor, "breathing" | "breathing_rate_bpm" | "breathing_confidence">): string {
  if (s.breathing === "detected" && s.breathing_rate_bpm != null)
    return `breathing ${Math.round(s.breathing_rate_bpm)}/min (conf ${s.breathing_confidence.toFixed(2)})`;
  return "breathing not seen, low confidence";
}

/** `{LEVEL} {place}: {breathing}. {location_note}. {distance} m {compass}.` */
export function briefingTemplate(
  s: Survivor,
  place: string,
  distanceM: number | null,
  compassWord: string | null,
): string {
  const parts = [`${levelWord(s)} ${asciiLine(place)}: ${breathingPart(s)}.`, sentence(s.location_note ?? "")];
  if (distanceM != null) parts.push(`${Math.round(distanceM)} m${compassWord ? " " + compassWord : ""}.`);
  return fitParts(parts);
}

/** `{place} is yours ({LEVEL}). Tap ring to accept or release.` */
export function nudgeTemplate(s: Survivor, place: string): string {
  return fitParts([`${asciiLine(place)} is yours (${levelWord(s)}).`, "Tap ring to accept or release."]);
}

/** `Enter {place}: {location_note}.` plus `Ground ahead: {terrain_class}.` for rough ground. */
export function navTemplate(s: Survivor, place: string, terrainClass: string | null): string {
  const note = sentence(s.location_note ?? "");
  const parts = [note ? `Enter ${asciiLine(place)}: ${note}` : `Enter ${asciiLine(place)}.`];
  if (terrainClass && ROUGH_TERRAIN.includes(terrainClass)) parts.push(`Ground ahead: ${terrainClass}.`);
  return fitParts(parts);
}

/** `Board: {place} {found} found, {unaccounted} unaccounted. Ask coordinator for more.` */
export function answerTemplate(place: string, found: number, unaccounted: number): string {
  return fitParts([`Board: ${asciiLine(place)} ${found} found, ${unaccounted} unaccounted.`, "Ask coordinator for more."]);
}
