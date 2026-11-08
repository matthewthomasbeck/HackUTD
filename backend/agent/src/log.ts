// Console logging plus the JSONL trace (logs/trace-<date>.jsonl, agent.md 5.7 step 6).
// Logging must never throw into the caller: errors go to stderr and the run continues.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface TraceSink {
  write(line: Record<string, unknown>): void;
}

/** Appends one JSON object per line to logs/trace-YYYY-MM-DD.jsonl. */
export class FileTrace implements TraceSink {
  constructor(
    private dir = "logs",
    private nowFn: () => number = Date.now,
  ) {}
  write(line: Record<string, unknown>): void {
    try {
      const day = new Date(this.nowFn()).toISOString().slice(0, 10);
      const path = `${this.dir}/trace-${day}.jsonl`;
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, safeJson(line) + "\n");
    } catch (err) {
      console.error("[trace] write failed:", (err as Error).message);
    }
  }
}

/** Keeps trace lines in memory (tests and scenarios). */
export class MemoryTrace implements TraceSink {
  lines: Record<string, unknown>[] = [];
  write(line: Record<string, unknown>): void {
    this.lines.push(line);
  }
}

/** JSON text for any value: bigint as a number, undefined as null, cycles and throwing getters as a marker string. */
export function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)) ?? "null";
  } catch {
    return '"<unserializable>"';
  }
}

/** Shorten long strings and arrays, recursively, so a large value keeps its shape. */
function shrink(v: unknown, str: number, arr: number, depth = 0): unknown {
  if (typeof v === "string") return v.length > str ? v.slice(0, str) + "..." : v;
  if (Array.isArray(v)) {
    const head = v.slice(0, arr).map((x) => shrink(x, str, arr, depth + 1));
    return v.length > arr ? [...head, `...${v.length - arr} more`] : head;
  }
  if (v && typeof v === "object") {
    if (depth > 6) return "...";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x, str, arr, depth + 1)]));
  }
  return v;
}

/**
 * JSON text of at most `max` characters that always parses (log_agent_action rejects args_json
 * that does not). Cutting a JSON string at a length breaks it, so this first shortens strings
 * and arrays inside the value, and as a last resort wraps a cut preview in a valid object.
 */
export function boundedJson(v: unknown, max: number): string {
  const full = safeJson(v);
  if (full.length <= max) return full;
  let value: unknown;
  try {
    value = JSON.parse(full);
  } catch {
    value = full;
  }
  for (const [str, arr] of [
    [200, 20],
    [80, 8],
    [30, 3],
  ]) {
    const s = safeJson(shrink(value, str, arr));
    if (s.length <= max) return s;
  }
  for (let k = Math.max(0, max - 60); k >= 0; k -= Math.max(10, Math.floor(k / 4))) {
    const s = JSON.stringify({ truncated: true, chars: full.length, preview: full.slice(0, k) });
    if (s.length <= max) return s;
    if (k === 0) break;
  }
  return "{}";
}

export class Logger {
  constructor(
    private level: Level = "info",
    private trace: TraceSink | null = null,
    private nowFn: () => number = Date.now,
    private quiet = false,
  ) {}
  setQuiet(q: boolean): void {
    this.quiet = q;
  }
  private out(level: Level, scope: string, msg: string): void {
    if (this.quiet || RANK[level] < RANK[this.level]) return;
    const ts = new Date(this.nowFn()).toISOString().slice(11, 23);
    const line = `${ts} ${level.padEnd(5)} [${scope}] ${msg}`;
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  }
  debug(scope: string, msg: string): void {
    this.out("debug", scope, msg);
  }
  info(scope: string, msg: string): void {
    this.out("info", scope, msg);
  }
  warn(scope: string, msg: string): void {
    this.out("warn", scope, msg);
  }
  error(scope: string, msg: string): void {
    this.out("error", scope, msg);
  }
  /** Full trace line: never truncated, never sent to the database. */
  traceLine(line: Record<string, unknown>): void {
    if (!this.trace) return;
    try {
      this.trace.write({ ts: new Date(this.nowFn()).toISOString(), ...line });
    } catch (err) {
      console.error("[trace] failed:", (err as Error).message);
    }
  }
}
