// One DbConnection per agent identity (agent.md 6.1), over the generated bindings in
// backend/spacetimedb-bindings/. The bindings are loaded with a dynamic import at runtime, so the
// runner typechecks and its tests pass before the bindings exist; a missing folder fails with a
// clear message. Only this folder and world.ts may touch binding shapes.
//
// UNCONFIRMED until the bindings exist (each is isolated here):
// - reducer argument key spelling: reducerArgs() sends both snake_case and camelCase keys;
// - enum argument shape { tag } and enum tag spelling on rows (convert.ts);
// - Identity.fromString for propose_assignment (present in the spacetimedb 2.14 SDK);
// - optional arguments as undefined (post_briefing survivor_id and kind, create_mission targets).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Actions } from "../actions.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../log.ts";
import type {
  AgentName,
  AuditFlagStatus,
  BriefingKind,
  BriefingPriority,
  Change,
  MissionKind,
  Role,
  TableName,
  TableRows,
  TableSource,
  TaskPriority,
} from "../types.ts";
import { fromBinding, reducerArgs, toEnum } from "./convert.ts";

export class BindingsMissingError extends Error {}

const ACCESSOR: Record<TableName, string> = {
  participant: "participant",
  site: "site",
  run: "run",
  search_cell: "searchCell",
  robot: "robot",
  device_status: "deviceStatus",
  mission: "mission",
  detection: "detection",
  survivor: "survivor",
  assignment: "assignment",
  briefing: "briefing",
  agent_action: "agentAction",
  event_log: "eventLog",
  audit_flag: "auditFlag",
  person_report: "personReport",
  agent_task: "agentTask",
};

/** agent.md 6.2. agent_action is added for every agent so the runner can find its own rows. */
const COMMON: TableName[] = ["participant", "site", "run", "agent_task", "survivor", "assignment", "event_log", "agent_action"];
export const SUBSCRIPTIONS: Record<AgentName, TableName[]> = {
  orchestrator: [...COMMON, "search_cell", "robot", "device_status", "mission", "detection", "audit_flag", "person_report", "briefing"],
  comms_agent: [...COMMON, "search_cell", "detection", "briefing", "robot"],
  auditor: [...COMMON, "search_cell", "robot", "audit_flag"],
};

export async function loadBindings(): Promise<any> {
  const override = process.env.STDB_BINDINGS;
  const url = override ? new URL(override, `file://${process.cwd()}/`).href : new URL("../../../spacetimedb-bindings/index.ts", import.meta.url).href;
  try {
    return await import(url);
  } catch (err) {
    throw new BindingsMissingError(
      `SpacetimeDB bindings not found (${url}): ${(err as Error).message.split("\n")[0]}\n` +
        "Generate them with: spacetime generate --lang typescript --out-dir backend/spacetimedb-bindings --module-path backend/spacetimedb\n" +
        "Until then use the in-process fake module: npm run scenario -- chain",
    );
  }
}

async function loadSdk(): Promise<any> {
  return await import("spacetimedb");
}

const BACKOFF_S = [1, 2, 4, 8];

export class LiveConnection implements Actions, TableSource {
  private conn: any = null;
  private ready = false;
  private listeners = new Set<(c: Change) => void>();
  private attempt = 0;
  private closed = false;
  identityHex = "";

  private constructor(
    private bindings: any,
    private sdk: any,
    private cfg: Config,
    readonly name: AgentName,
    private log: Logger,
    private onReady: () => void,
  ) {}

  static async open(cfg: Config, name: AgentName, log: Logger): Promise<LiveConnection> {
    if (!cfg.STDB_DATABASE) throw new Error("STDB_DATABASE is empty; set it in backend/agent/.env");
    const [bindings, sdk] = await Promise.all([loadBindings(), loadSdk()]);
    if (!bindings.DbConnection) throw new BindingsMissingError("bindings loaded but export no DbConnection");
    let resolveReady!: () => void;
    const first = new Promise<void>((r) => (resolveReady = r));
    const c = new LiveConnection(bindings, sdk, cfg, name, log, () => resolveReady());
    c.connect();
    await first;
    return c;
  }

  private tokenPath(): string {
    return join(this.cfg.STDB_TOKEN_DIR, `${this.name}.token`);
  }
  private loadToken(): string | undefined {
    try {
      return readFileSync(this.tokenPath(), "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }
  private saveToken(token: string): void {
    try {
      mkdirSync(this.cfg.STDB_TOKEN_DIR, { recursive: true });
      writeFileSync(this.tokenPath(), token, { mode: 0o600 });
    } catch (err) {
      this.log.warn(this.name, `could not save token: ${(err as Error).message}`);
    }
  }

  private connect(): void {
    if (this.closed) return;
    const b = this.bindings.DbConnection.builder()
      .withUri(this.cfg.STDB_URI)
      .withDatabaseName(this.cfg.STDB_DATABASE)
      .withToken(this.loadToken())
      .onConnect((conn: any, identity: any, token: string) => {
        this.attempt = 0;
        this.identityHex = String(identity.toHexString()).toLowerCase();
        this.saveToken(token);
        this.log.info(this.name, `connected as ${this.identityHex.slice(0, 12)}...`);
        this.subscribe(conn);
      })
      .onConnectError((_ctx: any, err: Error) => {
        this.log.warn(this.name, `connect error: ${err?.message ?? err}`);
        this.retry();
      })
      .onDisconnect(() => {
        this.ready = false;
        this.log.warn(this.name, "disconnected");
        this.retry();
      });
    this.conn = b.build();
  }

  private retry(): void {
    if (this.closed) return;
    const s = BACKOFF_S[this.attempt] ?? 10;
    this.attempt++;
    setTimeout(() => this.connect(), s * 1000);
  }

  private subscribe(conn: any): void {
    const tables = SUBSCRIPTIONS[this.name];
    for (const t of tables) {
      const tbl = conn.db[ACCESSOR[t]];
      if (!tbl) {
        this.log.warn(this.name, `bindings have no table accessor ${ACCESSOR[t]}`);
        continue;
      }
      // Row callbacks before onApplied are ignored (half-loaded state).
      tbl.onInsert?.((_ctx: any, row: any) => this.ready && this.emit({ table: t, op: "insert", row: fromBinding(row) as any }));
      tbl.onUpdate?.((_ctx: any, old: any, row: any) => this.ready && this.emit({ table: t, op: "update", row: fromBinding(row) as any, old: fromBinding(old) as any }));
      tbl.onDelete?.((_ctx: any, row: any) => this.ready && this.emit({ table: t, op: "delete", row: fromBinding(row) as any }));
    }
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        this.ready = true;
        this.log.info(this.name, `subscribed to ${tables.length} tables`);
        this.onReady();
      })
      .subscribe(tables.map((t) => `SELECT * FROM ${t}`));
  }

  private emit(c: Change): void {
    for (const l of [...this.listeners]) {
      try {
        l(c);
      } catch (err) {
        this.log.error(this.name, `change listener failed: ${(err as Error).message}`);
      }
    }
  }

  close(): void {
    this.closed = true;
    try {
      this.conn?.disconnect?.();
    } catch {
      /* already closed */
    }
  }

  // ---------- TableSource ----------

  rows<T extends TableName>(table: T): TableRows[T][] {
    const tbl = this.conn?.db?.[ACCESSOR[table]];
    if (!tbl || !this.ready) return [];
    return [...tbl.iter()].map((r: unknown) => fromBinding(r) as TableRows[T]);
  }

  onChange(cb: (c: Change) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---------- Actions ----------

  private call(name: string, args: Record<string, unknown>): Promise<void> {
    if (!this.conn || !this.ready) return Promise.reject(new Error("not connected"));
    const fn = this.conn.reducers?.[name];
    if (typeof fn !== "function") return Promise.reject(new Error(`bindings have no reducer ${name}`));
    return Promise.resolve(fn.call(this.conn.reducers, reducerArgs(args))).then(() => undefined);
  }

  registerParticipant(name: string, role: Role) {
    return this.call("registerParticipant", { name, role: toEnum(role) });
  }
  agentHeartbeat() {
    return this.call("agentHeartbeat", {});
  }
  postAgentTask(to: AgentName, kind: string, payload_json: string, priority: TaskPriority, reason: string, chain_id: number) {
    return this.call("postAgentTask", { to_agent: toEnum(to), kind, payload_json, priority: toEnum(priority), reason, chain_id: BigInt(chain_id) });
  }
  claimAgentTask(task_id: number) {
    return this.call("claimAgentTask", { task_id: BigInt(task_id) });
  }
  completeAgentTask(task_id: number, status: "done" | "failed", result_json: string) {
    return this.call("completeAgentTask", { task_id: BigInt(task_id), status: toEnum(status), result_json });
  }
  logAgentAction(tool: string, args_json: string, result: string, reason: string, step: number, model: string, chain_id: number) {
    return this.call("logAgentAction", { tool, args_json, result, reason, step, model, chain_id: BigInt(chain_id) });
  }
  proposeAssignment(survivor_id: number, rescuer_identity: string, reason: string) {
    const Identity = this.sdk.Identity ?? this.bindings.Identity;
    return this.call("proposeAssignment", { survivor_id: BigInt(survivor_id), rescuer_identity: Identity.fromString(rescuer_identity), reason });
  }
  createMission(robot_id: string, kind: MissionKind, target_cell_ids: number[], target_lat: number | null, target_lon: number | null, reason: string, chain_id: number) {
    return this.call("createMission", {
      robot_id,
      kind: toEnum(kind),
      target_cell_ids: target_cell_ids.map((n) => BigInt(n)),
      target_lat: target_lat ?? undefined,
      target_lon: target_lon ?? undefined,
      reason,
      chain_id: BigInt(chain_id),
    });
  }
  cancelOwnMission(mission_id: number) {
    return this.call("cancelOwnMission", { mission_id: BigInt(mission_id) });
  }
  setAuditFlagStatus(flag_id: number, status: AuditFlagStatus) {
    return this.call("setAuditFlagStatus", { flag_id: BigInt(flag_id), status: toEnum(status) });
  }
  postBriefing(audience: string, text: string, priority: BriefingPriority, survivor_id: number | null, kind: BriefingKind | null) {
    return this.call("postBriefing", {
      audience,
      text,
      priority: toEnum(priority),
      survivor_id: survivor_id ? BigInt(survivor_id) : undefined,
      kind: kind ? toEnum(kind) : undefined,
    });
  }
}
