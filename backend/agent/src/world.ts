// WorldView: typed reads over the subscription cache (or the fake store), with the active run
// filter in one place (agent.md 6.4) and the shared definitions of agent.md 7.1.
// The rows come from a TableSource that already speaks contract names (stdb/convert.ts does the
// mapping for live rows), so nothing here imports the generated bindings.

import type { Clock } from "./clock.ts";
import { bearingDeg, compass, haversineM } from "./geo.ts";
import { sortSurvivors, tierOf, type Tier } from "./priority.ts";
import type {
  AgentAction,
  AgentTask,
  Assignment,
  AuditFlag,
  Briefing,
  Change,
  DeviceStatus,
  Detection,
  EventLog,
  Mission,
  Participant,
  PersonReport,
  Robot,
  Run,
  SearchCell,
  Site,
  Survivor,
  TableName,
  TableRows,
  TableSource,
} from "./types.ts";

export const RESCUER_FRESH_MS = 15_000;
export const OPEN_MISSION: Mission["status"][] = ["proposed", "queued", "leased", "active"];

export interface RescuerView {
  identity: string;
  callsign: string;
  lat: number | null;
  lon: number | null;
  online: boolean;
  fresh: boolean;
  available: boolean;
  free: boolean;
  active_assignments: number;
  proposed_assignment_id: number | null;
}

export interface RescuerNear extends RescuerView {
  distance_m: number | null;
  bearing_deg: number | null;
  compass: string | null;
}

export class World {
  /** Stable callsigns: the first rescuer this process sees is "Rescuer A". Never names (G8). */
  private callsigns = new Map<string, string>();
  private warned = new Set<string>();

  constructor(
    readonly source: TableSource,
    readonly clock: Clock,
    private warn: (msg: string) => void = () => {},
  ) {}

  now(): number {
    return this.clock.now();
  }

  onChange(cb: (c: Change) => void): () => void {
    return this.source.onChange(cb);
  }

  raw<T extends TableName>(t: T): TableRows[T][] {
    return this.source.rows(t);
  }

  // ---------- run and site ----------

  activeRun(): Run | null {
    const open = this.raw("run").filter((r) => r.ended_at == null);
    if (open.length === 0) return null;
    if (open.length > 1) {
      const key = "runs:" + open.map((r) => r.id).join(",");
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.warn(`several active runs (${open.map((r) => "#" + r.id).join(", ")}); using the newest`);
      }
    }
    return open.reduce((a, b) => (b.started_at > a.started_at ? b : a));
  }

  site(): Site | null {
    const run = this.activeRun();
    const sites = this.raw("site");
    if (run) return sites.find((s) => s.id === run.site_id) ?? null;
    if (sites.length === 0) return null;
    return sites.reduce((a, b) => (b.id < a.id ? b : a));
  }

  // ---------- filtered tables ----------

  survivors(): Survivor[] {
    const run = this.activeRun();
    if (!run) return [];
    return this.raw("survivor").filter((s) => s.site_id === run.site_id && s.created_at >= run.started_at);
  }

  survivor(id: number): Survivor | null {
    return this.survivors().find((s) => s.id === id) ?? null;
  }

  assignments(): Assignment[] {
    const ids = new Set(this.survivors().map((s) => s.id));
    return this.raw("assignment").filter((a) => ids.has(a.survivor_id));
  }

  assignmentsFor(survivorId: number): Assignment[] {
    return this.raw("assignment").filter((a) => a.survivor_id === survivorId);
  }

  assignment(id: number): Assignment | null {
    return this.assignments().find((a) => a.id === id) ?? null;
  }

  openAssignmentFor(survivorId: number): Assignment | null {
    return (
      this.assignmentsFor(survivorId).find((a) => a.status === "proposed" || a.status === "active") ?? null
    );
  }

  private byRun<T extends { run_id: number }>(rows: T[]): T[] {
    const run = this.activeRun();
    if (!run) return [];
    return rows.filter((r) => r.run_id === run.id);
  }

  tasks(): AgentTask[] {
    return this.byRun(this.raw("agent_task"));
  }
  task(id: number): AgentTask | null {
    return this.raw("agent_task").find((t) => t.id === id) ?? null;
  }
  events(): EventLog[] {
    return this.byRun(this.raw("event_log"));
  }
  detections(): Detection[] {
    return this.byRun(this.raw("detection"));
  }
  briefings(): Briefing[] {
    return this.byRun(this.raw("briefing"));
  }
  actions(): AgentAction[] {
    return this.byRun(this.raw("agent_action"));
  }
  auditFlags(): AuditFlag[] {
    return this.byRun(this.raw("audit_flag"));
  }
  personReports(): PersonReport[] {
    return this.byRun(this.raw("person_report"));
  }

  cells(): SearchCell[] {
    const site = this.site();
    if (!site) return [];
    return this.raw("search_cell").filter((c) => c.site_id === site.id);
  }
  cell(id: number): SearchCell | null {
    return this.cells().find((c) => c.id === id) ?? null;
  }

  robots(): Robot[] {
    return this.raw("robot");
  }
  robot(id: string): Robot | null {
    return this.robots().find((r) => r.robot_id === id) ?? null;
  }
  devices(robotId: string): DeviceStatus[] {
    return this.raw("device_status").filter((d) => d.robot_id === robotId);
  }
  missions(): Mission[] {
    const run = this.activeRun();
    if (!run) return [];
    return this.raw("mission").filter((m) => m.created_at >= run.started_at);
  }
  mission(id: number): Mission | null {
    return this.missions().find((m) => m.id === id) ?? null;
  }

  participants(): Participant[] {
    return this.raw("participant");
  }
  participant(identity: string): Participant | null {
    const hex = identity.toLowerCase();
    return this.participants().find((p) => p.identity === hex) ?? null;
  }
  participantByName(name: string): Participant | null {
    return this.participants().find((p) => p.name === name) ?? null;
  }

  // ---------- rescuers (agent.md 7.1) ----------

  callsign(identity: string): string {
    const hex = identity.toLowerCase();
    let c = this.callsigns.get(hex);
    if (!c) {
      // Letter every rescuer not lettered yet, in identity order, so agents that start together agree.
      const unseen = this.participants()
        .filter((p) => p.role === "rescuer" && !this.callsigns.has(p.identity))
        .map((p) => p.identity);
      if (!unseen.includes(hex)) unseen.push(hex);
      unseen.sort();
      for (const id of unseen) {
        const n = this.callsigns.size;
        // A..Z, then A2..Z2, and so on.
        this.callsigns.set(id, "Rescuer " + String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26) + 1) : ""));
      }
      c = this.callsigns.get(hex)!;
    }
    return c;
  }

  rescuers(): RescuerView[] {
    const now = this.now();
    const people = this.participants()
      .filter((p) => p.role === "rescuer")
      .sort((a, b) => (a.identity < b.identity ? -1 : 1));
    const open = this.raw("assignment").filter((a) => a.status === "proposed" || a.status === "active");
    return people.map((p) => {
      const mine = open.filter((a) => a.rescuer_identity === p.identity);
      const proposed = mine.find((a) => a.status === "proposed") ?? null;
      const active = mine.filter((a) => a.status === "active").length;
      const fresh = p.online && now - p.last_heartbeat <= RESCUER_FRESH_MS && p.lat != null && p.lon != null;
      const available = fresh && !proposed;
      return {
        identity: p.identity,
        callsign: this.callsign(p.identity),
        lat: p.lat,
        lon: p.lon,
        online: p.online,
        fresh,
        available,
        free: available && active === 0,
        active_assignments: active,
        proposed_assignment_id: proposed ? proposed.id : null,
      };
    });
  }

  rescuer(identity: string): RescuerView | null {
    const hex = identity.toLowerCase();
    return this.rescuers().find((r) => r.identity === hex) ?? null;
  }

  rescuersNear(lat: number, lon: number, onlyAvailable = true): RescuerNear[] {
    const list = this.rescuers().filter((r) => !onlyAvailable || r.available);
    const out = list.map((r) => {
      if (r.lat == null || r.lon == null) return { ...r, distance_m: null, bearing_deg: null, compass: null };
      // Bearing from the rescuer to the survivor, as the glasses arrow points.
      const b = bearingDeg(r.lat, r.lon, lat, lon);
      return { ...r, distance_m: Math.round(haversineM(r.lat, r.lon, lat, lon)), bearing_deg: Math.round(b), compass: compass(b) };
    });
    return out.sort((a, b) => (a.distance_m ?? 1e12) - (b.distance_m ?? 1e12));
  }

  distanceM(identity: string, survivorId: number): number | null {
    const r = this.participant(identity);
    const s = this.survivor(survivorId);
    if (!r || !s || r.lat == null || r.lon == null) return null;
    return haversineM(r.lat, r.lon, s.lat, s.lon);
  }

  // ---------- survivors ----------

  tier(s: Survivor): Tier {
    return tierOf(s);
  }

  /** Unassigned survivors, most urgent first. */
  unassignedRanked(): Survivor[] {
    return sortSurvivors(
      this.survivors().filter((s) => s.status === "unassigned"),
      (m) => this.warnOnce(m),
    );
  }

  /** Unassigned survivors with no open (proposed or active) assignment, most urgent first. */
  waitingRanked(): Survivor[] {
    return this.unassignedRanked().filter((s) => !this.openAssignmentFor(s.id));
  }

  rankOf(id: number): number {
    const all = sortSurvivors(this.survivors().filter((s) => s.status !== "resolved"));
    return all.findIndex((s) => s.id === id) + 1;
  }

  placeOf(s: Survivor): string {
    if (s.house_label) return s.house_label;
    const c = s.cell_id ? this.cell(s.cell_id) : null;
    if (c?.label) return c.label;
    return `survivor #${s.id}`;
  }

  // ---------- robots ----------

  openMissionsFor(robotId: string): Mission[] {
    return this.missions().filter((m) => OPEN_MISSION.includes(m.status) && (m.robot_id === robotId || m.robot_id === ""));
  }

  robotIdle(r: Robot): boolean {
    if (!r.online || r.state !== "READY") return false;
    if (r.current_mission_id && r.current_mission_id !== 0) return false;
    return !this.missions().some(
      (m) => m.robot_id === r.robot_id && (m.status === "proposed" || m.status === "queued" || m.status === "leased"),
    );
  }

  private warnOnce(m: string): void {
    if (this.warned.has(m)) return;
    this.warned.add(m);
    this.warn(m);
  }
}

export function iso(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

export function parseJson<T = Record<string, unknown>>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
