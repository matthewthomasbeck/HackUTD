// Spool to a local file while SpacetimeDB is unreachable (robot.md 9.7, CONTRACTS.md
// "Recording and replay"), then replay in order on reconnect.
//
// File: append-only JSON lines, each {seq, observed_at, msg}, where msg is the local message as
// the robot sent it (a detection may also carry `_uploaded`, the media URLs already uploaded).
// - detection, cell, mission_progress: fsync after each append.
// - device: kept, no fsync.
// - position, terrain: current state only, so a new one replaces an older one in memory (by
//   observed_at, then seq; an older one arriving late is not kept).
// - heartbeat: never spooled.
// Replay is at least once: a crash during replay sends the replayed part again.

import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LocalMessage } from './mapping.ts';

export type SendOutcome = 'ok' | 'rejected' | 'network';

export interface SpoolEntry {
  seq: number | null;
  observed_at: string | null;
  msg: LocalMessage;
}

export type AppendResult = 'spooled' | 'not_spooled' | 'dropped';

export interface ReplayResult {
  sent: number;
  rejected: number;
  skipped: number;
  stopped: boolean;
}

export interface SpoolOptions {
  path: string;
  maxBytes: number;
  log?: (line: string) => void;
}

const FSYNC_TYPES = new Set(['detection', 'cell', 'mission_progress']);
const LATEST_ONLY_TYPES = new Set(['position', 'terrain']);

export function spoolable(type: string): boolean {
  return type !== 'heartbeat';
}

/** a is strictly newer than b: observed_at when both have one (ISO UTC sorts as text), else seq. */
export function isNewer(a: SpoolEntry, b: SpoolEntry): boolean {
  if (a.observed_at !== null && b.observed_at !== null && a.observed_at !== b.observed_at) return a.observed_at > b.observed_at;
  if (a.seq !== null && b.seq !== null) return a.seq > b.seq;
  return false;
}

function lineOf(entry: SpoolEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

export class Spool {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly log: (line: string) => void;
  private entries: SpoolEntry[] = [];
  private fd: number | undefined;
  private bytes = 0;
  private replayingNow = false;

  constructor(options: SpoolOptions) {
    this.path = options.path;
    this.maxBytes = options.maxBytes;
    this.log = options.log ?? (() => {});
  }

  get size(): number { return this.entries.length; }
  get replaying(): boolean { return this.replayingNow; }
  get fileBytes(): number { return this.bytes; }
  /** Copy of the pending entries, oldest first (for tests and status). */
  pending(): SpoolEntry[] { return this.entries.map((entry) => ({ ...entry })); }

  /**
   * Load what a previous run left. A last line cut off by a crash or power loss is dropped and
   * the file is trimmed back to the last full line, so the next append starts on a fresh line.
   */
  open(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    let text = '';
    if (existsSync(this.path)) text = readFileSync(this.path, 'utf8');
    const lastNewline = text.lastIndexOf('\n');
    const complete = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : '';
    if (complete.length !== text.length) this.log(`spool: dropped a partial last line (${text.length - complete.length} bytes)`);
    this.entries = [];
    for (const line of complete.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const entry = JSON.parse(line) as SpoolEntry;
        if (entry && typeof entry === 'object' && entry.msg && typeof entry.msg.type === 'string') this.keep(entry);
        else this.log('spool: skipped a line with no message');
      } catch {
        this.log('spool: skipped a line that is not JSON');
      }
    }
    this.fd = openSync(this.path, 'a');
    if (complete.length !== text.length) ftruncateSync(this.fd, Buffer.byteLength(complete));
    this.bytes = Buffer.byteLength(complete);
    if (this.entries.length > 0) this.log(`spool: ${this.entries.length} entries waiting from a previous run`);
  }

  close(): void {
    if (this.fd !== undefined) closeSync(this.fd);
    this.fd = undefined;
  }

  /** Append one message. Heartbeats are never spooled. */
  append(msg: LocalMessage): AppendResult {
    if (!spoolable(msg.type)) return 'not_spooled';
    const entry: SpoolEntry = {
      seq: typeof msg.seq === 'number' ? msg.seq : null,
      observed_at: typeof msg.observed_at === 'string' ? msg.observed_at : null,
      msg,
    };
    const line = lineOf(entry);
    const size = Buffer.byteLength(line);
    if (this.bytes + size > this.maxBytes && !this.makeRoom(size, msg.type)) {
      this.log(`spool: full (${this.maxBytes} bytes), dropped a ${msg.type}`);
      return 'dropped';
    }
    if (!this.keep(entry)) return 'not_spooled'; // a newer position or terrain is already waiting
    this.write(line, FSYNC_TYPES.has(msg.type));
    return 'spooled';
  }

  /**
   * Send every entry in file order, one call at a time, awaiting each. A rejection is logged and
   * skipped; a network failure stops the replay and keeps the rest. Entries appended while
   * replaying (live messages) are sent after the older ones. The file is truncated when empty.
   */
  async replay(send: (msg: LocalMessage) => Promise<SendOutcome>): Promise<ReplayResult> {
    const result: ReplayResult = { sent: 0, rejected: 0, skipped: 0, stopped: false };
    if (this.replayingNow) return result;
    this.replayingNow = true;
    try {
      while (this.entries.length > 0) {
        const entry = this.entries[0]!;
        let outcome: SendOutcome;
        try {
          outcome = await send(entry.msg);
        } catch (error) {
          this.log(`spool: replay send threw, treating as a network failure: ${String(error)}`);
          outcome = 'network';
        }
        if (outcome === 'network') {
          result.stopped = true;
          this.rewrite();
          return result;
        }
        if (outcome === 'ok') result.sent += 1;
        else {
          result.rejected += 1;
          this.log(`spool: replayed ${entry.msg.type} was rejected, skipped`);
        }
        // A newer position may have replaced this entry while it was in flight.
        const index = this.entries.indexOf(entry);
        if (index >= 0) this.entries.splice(index, 1);
      }
      this.truncate();
      return result;
    } finally {
      this.replayingNow = false;
    }
  }

  /** Returns false when a newer entry of a latest-only type is already kept. */
  private keep(entry: SpoolEntry): boolean {
    if (LATEST_ONLY_TYPES.has(entry.msg.type)) {
      if (this.entries.some((old) => old.msg.type === entry.msg.type && isNewer(old, entry))) return false;
      this.entries = this.entries.filter((old) => old.msg.type !== entry.msg.type);
    }
    this.entries.push(entry);
    return true;
  }

  private write(line: string, sync: boolean): void {
    if (this.fd === undefined) this.open();
    writeSync(this.fd!, line);
    if (sync) fsyncSync(this.fd!);
    this.bytes += Buffer.byteLength(line);
  }

  /**
   * Past the cap: rewrite without superseded positions, then drop position and terrain entries,
   * then device entries. Detections are never dropped; a detection is written even past the cap
   * (a lost survivor is worse than a full file). Returns false to refuse a non-detection.
   */
  private makeRoom(incoming: number, type: string): boolean {
    this.rewrite();
    if (this.bytes + incoming <= this.maxBytes) return true;
    for (const drop of [LATEST_ONLY_TYPES, new Set(['device'])]) {
      const before = this.entries.length;
      this.entries = this.entries.filter((entry) => !drop.has(entry.msg.type));
      if (this.entries.length !== before) {
        this.log(`spool: over the cap, dropped ${before - this.entries.length} ${[...drop].join('/')} entries`);
        this.rewrite();
      }
      if (this.bytes + incoming <= this.maxBytes) return true;
    }
    if (type === 'detection') {
      this.log('spool: over the cap with no position or device entries left; keeping the detection anyway');
      return true;
    }
    return false;
  }

  /** Atomically replace the file with the in-memory entries (write, fsync, rename). */
  private rewrite(): void {
    const text = this.entries.map(lineOf).join('');
    const tmp = `${this.path}.tmp`;
    const fd = openSync(tmp, 'w');
    writeSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    if (this.fd !== undefined) closeSync(this.fd);
    renameSync(tmp, this.path);
    this.fd = openSync(this.path, 'a');
    this.bytes = Buffer.byteLength(text);
  }

  private truncate(): void {
    if (this.fd === undefined) this.open();
    ftruncateSync(this.fd!, 0);
    fsyncSync(this.fd!);
    this.bytes = 0;
  }
}
