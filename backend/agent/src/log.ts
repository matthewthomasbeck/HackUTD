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

export function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
  } catch {
    return '"<unserializable>"';
  }
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
