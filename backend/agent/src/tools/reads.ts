// Read tools over WorldView (agent.md 7.1). Cache only, no network. Rescuers appear by callsign
// and identity hex only, never by name (G8).

import { haversineM } from "../geo.ts";
import { breathingDisplay, levelWord, sortSurvivors, tierOf } from "../priority.ts";
import type { CellStatus, SearchCell, Survivor } from "../types.ts";
import { iso, type World } from "../world.ts";

type Args = Record<string, any>;

export function survivorDisplay(w: World, s: Survivor): string {
  const parts = [levelWord(s), breathingDisplay(s)];
  if (s.visibility_pct != null) parts.push(`visibility ${Math.round(s.visibility_pct)}%`);
  return parts.join(", ");
}

function survivorBrief(w: World, s: Survivor) {
  return {
    id: s.id,
    place: w.placeOf(s),
    tier: tierOf(s),
    critical_level: s.critical_level,
    critical_score: s.critical_score,
    breathing: s.breathing,
    status: s.status,
    display: survivorDisplay(w, s),
    open_assignment: w.openAssignmentFor(s.id)?.id ?? null,
  };
}

export function getBoard(w: World) {
  const all = w.survivors().filter((s) => s.status !== "resolved");
  const byTier: Record<string, number> = { "0": 0, "1": 0, "2": 0 };
  const byStatus: Record<string, number> = {};
  for (const s of all) {
    byTier[String(tierOf(s))]++;
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }
  const cellsByStatus: Record<string, number> = {};
  for (const c of w.cells()) cellsByStatus[c.status] = (cellsByStatus[c.status] ?? 0) + 1;
  return {
    run: w.activeRun()?.id ?? null,
    counts: { by_tier: byTier, by_status: byStatus },
    top_survivors: sortSurvivors(all).slice(0, 5).map((s) => survivorBrief(w, s)),
    rescuers: w.rescuers().map((r) => ({
      callsign: r.callsign,
      identity: r.identity,
      fresh: r.fresh,
      available: r.available,
      free: r.free,
      active_assignments: r.active_assignments,
    })),
    cells: cellsByStatus,
    robots: w.robots().map((r) => ({ robot_id: r.robot_id, online: r.online, state: r.state, idle: w.robotIdle(r), battery_pct: r.battery_pct })),
    open_flags: w
      .auditFlags()
      .filter((f) => f.status === "open")
      .map((f) => ({ id: f.id, kind: f.kind, entity: f.entity, entity_id: f.entity_id, message: f.message })),
  };
}

export function getSurvivor(w: World, a: Args) {
  const s = w.survivor(a.survivor_id);
  if (!s) throw new Error(`survivor #${a.survivor_id} is not in the active run`);
  const cell = s.cell_id ? w.cell(s.cell_id) : null;
  return {
    survivor: {
      id: s.id,
      place: w.placeOf(s),
      lat: s.lat,
      lon: s.lon,
      location_note: s.location_note,
      breathing: s.breathing,
      breathing_rate_bpm: s.breathing_rate_bpm,
      breathing_confidence: s.breathing_confidence,
      visibility_pct: s.visibility_pct,
      critical_level: s.critical_level,
      critical_score: s.critical_score,
      score_reasons: s.score_reasons,
      status: s.status,
      created_at: iso(s.created_at),
    },
    tier: tierOf(s),
    rank: w.rankOf(s.id),
    display: survivorDisplay(w, s),
    detections: w
      .detections()
      .filter((d) => d.survivor_id === s.id)
      .map((d) => ({ id: d.id, source: d.source, thermal_confidence: d.thermal_confidence, location_note: d.location_note, created_at: iso(d.created_at) })),
    cell: cell
      ? {
          id: cell.id,
          label: cell.label,
          status: cell.status,
          found: cell.found,
          reported_missing: cell.reported_missing,
          reported_safe: cell.reported_safe,
          unaccounted: cell.unaccounted,
        }
      : null,
    assignments: w.assignmentsFor(s.id).map((x) => ({
      id: x.id,
      rescuer: w.callsign(x.rescuer_identity),
      status: x.status,
      created_by: x.created_by,
      release_cause: x.release_cause,
    })),
  };
}

export function listRescuers(w: World, a: Args) {
  const onlyAvailable = a.only_available ?? true;
  if (a.near_survivor_id) {
    const s = w.survivor(a.near_survivor_id);
    if (!s) throw new Error(`survivor #${a.near_survivor_id} is not in the active run`);
    return w.rescuersNear(s.lat, s.lon, onlyAvailable).map((r) => ({
      identity: r.identity,
      callsign: r.callsign,
      fresh: r.fresh,
      available: r.available,
      free: r.free,
      active_assignments: r.active_assignments,
      distance_m: r.distance_m,
      bearing_deg: r.bearing_deg,
      compass: r.compass,
    }));
  }
  return w
    .rescuers()
    .filter((r) => !onlyAvailable || r.available)
    .map((r) => ({
      identity: r.identity,
      callsign: r.callsign,
      fresh: r.fresh,
      available: r.available,
      free: r.free,
      active_assignments: r.active_assignments,
    }));
}

export function targetedBy(w: World, cellId: number): number | null {
  const m = w
    .missions()
    .find((x) => ["proposed", "queued", "leased", "active"].includes(x.status) && x.target_cell_ids.includes(cellId));
  return m ? m.id : null;
}

/** Search order (CONTRACTS.md search_cell): unaccounted first, then unsearched and partially searched, then distance. */
export function orderCells(w: World, cells: SearchCell[], from: { lat: number; lon: number } | null) {
  const rank = (c: SearchCell) => (c.unaccounted > 0 ? 0 : c.status === "unsearched" || c.status === "partially_searched" ? 1 : 2);
  return cells
    .map((c) => ({ c, d: from ? haversineM(from.lat, from.lon, c.lat, c.lon) : 0 }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.d - b.d || a.c.id - b.c.id);
}

export function listCells(w: World, a: Args) {
  const statuses: CellStatus[] = a.statuses ?? ["unsearched", "partially_searched"];
  const limit = a.limit ?? 10;
  const site = w.site();
  let from: { lat: number; lon: number } | null = site ? { lat: site.center_lat, lon: site.center_lon } : null;
  if (a.near_robot_id) {
    const r = w.robot(a.near_robot_id);
    if (!r) throw new Error(`robot ${a.near_robot_id} not found`);
    if (r.lat != null && r.lon != null) from = { lat: r.lat, lon: r.lon };
  }
  const cells = w.cells().filter((c) => statuses.includes(c.status) || c.unaccounted > 0);
  return orderCells(w, cells, from)
    .map(({ c, d }) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      found: c.found,
      reported_missing: c.reported_missing,
      reported_safe: c.reported_safe,
      unaccounted: c.unaccounted,
      distance_m: Math.round(d),
      targeted_by_mission_id: targetedBy(w, c.id),
    }))
    .filter((c) => a.include_targeted || c.targeted_by_mission_id == null)
    .slice(0, limit);
}

export function getRobot(w: World, a: Args) {
  const r = w.robot(a.robot_id);
  if (!r) throw new Error(`robot ${a.robot_id} not found`);
  return {
    robot: {
      robot_id: r.robot_id,
      online: r.online,
      state: r.state,
      lat: r.lat,
      lon: r.lon,
      battery_pct: r.battery_pct,
      current_mission_id: r.current_mission_id,
      terrain_class: r.terrain_class,
      terrain_confidence: r.terrain_confidence,
      terrain_source: r.terrain_source,
      terrain_action: r.terrain_action,
    },
    idle: w.robotIdle(r),
    seconds_since_heartbeat: Math.round((w.now() - r.last_heartbeat) / 1000),
    devices: w.devices(r.robot_id).map((d) => ({ device: d.device, status: d.status, detail: d.detail })),
    missions: w.openMissionsFor(r.robot_id).map((m) => ({ id: m.id, kind: m.kind, status: m.status, created_by: m.created_by })),
  };
}
