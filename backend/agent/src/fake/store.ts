// In-memory tables with change events, in contract names. Used by the fake module (tests and
// scenarios) and, as an overlay over the live cache, by the DRY_RUN=1 shadow.

import { primaryKey, TABLE_NAMES, type Change, type TableName, type TableRows, type TableSource } from "../types.ts";

export interface MutableSource extends TableSource {
  insert<T extends TableName>(table: T, row: Omit<TableRows[T], "id"> & { id?: number }): TableRows[T];
  update<T extends TableName>(table: T, row: TableRows[T]): TableRows[T];
  get<T extends TableName>(table: T, key: string | number): TableRows[T] | null;
}

type Listener = (c: Change) => void;

export class MemoryStore implements MutableSource {
  private tables = new Map<TableName, Map<string | number, unknown>>();
  private nextId = new Map<TableName, number>();
  private listeners = new Set<Listener>();

  constructor(private idStart = 1) {
    for (const t of TABLE_NAMES) this.tables.set(t, new Map());
  }

  rows<T extends TableName>(table: T): TableRows[T][] {
    return [...(this.tables.get(table)!.values() as Iterable<TableRows[T]>)];
  }

  get<T extends TableName>(table: T, key: string | number): TableRows[T] | null {
    return (this.tables.get(table)!.get(key) as TableRows[T] | undefined) ?? null;
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  protected emit(c: Change): void {
    for (const l of [...this.listeners]) {
      try {
        l(c);
      } catch (err) {
        console.error("[store] listener failed:", (err as Error).message);
      }
    }
  }

  insert<T extends TableName>(table: T, row: Omit<TableRows[T], "id"> & { id?: number }): TableRows[T] {
    const pk = primaryKey(table);
    const full = { ...row } as Record<string, unknown>;
    if (pk === "id" && (full.id == null || full.id === 0)) {
      const n = this.nextId.get(table) ?? this.idStart;
      full.id = n;
      this.nextId.set(table, n + 1);
    }
    const key = full[pk] as string | number;
    const map = this.tables.get(table)!;
    const old = this.get(table, key) ?? undefined;
    map.set(key, full);
    if (typeof key === "number") this.nextId.set(table, Math.max(this.nextId.get(table) ?? this.idStart, key + 1));
    this.emit({ table, op: old ? "update" : "insert", row: full as unknown as TableRows[T], old });
    return full as unknown as TableRows[T];
  }

  update<T extends TableName>(table: T, row: TableRows[T]): TableRows[T] {
    const pk = primaryKey(table);
    const key = (row as unknown as Record<string, unknown>)[pk] as string | number;
    const map = this.tables.get(table)!;
    const old = this.get(table, key) ?? undefined;
    const next = { ...row };
    map.set(key, next);
    this.emit({ table, op: old ? "update" : "insert", row: next, old });
    return next;
  }
}

/**
 * Reads the base rows with this store's rows on top (same primary key wins here).
 * Writes never reach the base. New ids start high so they never collide with live ids.
 */
export class OverlayStore extends MemoryStore {
  constructor(private base: TableSource) {
    super(1_000_000_000);
    base.onChange((c) => this.emit(c));
  }
  override rows<T extends TableName>(table: T): TableRows[T][] {
    const pk = primaryKey(table);
    const mine = super.rows(table);
    const keys = new Set(mine.map((r) => (r as unknown as Record<string, unknown>)[pk]));
    const baseRows = this.base.rows(table).filter((r) => !keys.has((r as unknown as Record<string, unknown>)[pk]));
    return [...baseRows, ...mine];
  }
  override get<T extends TableName>(table: T, key: string | number): TableRows[T] | null {
    const own = super.get(table, key);
    if (own) return own;
    const pk = primaryKey(table);
    return this.base.rows(table).find((r) => (r as unknown as Record<string, unknown>)[pk] === key) ?? null;
  }
}
