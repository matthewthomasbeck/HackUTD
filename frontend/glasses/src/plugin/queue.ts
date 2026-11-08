// One serialized, coalescing write queue for every display call (glasses.md 3.4).
// It also keeps the current view (the last page plus every text and image written since), so the display can be
// turned off and back on without the service resending anything.
import { BLANK_PAGE } from './bridge';
import type { DisplayBridge } from './bridge';
import type { ContainerMsg, PageMsg } from './protocol';

export type Op =
  | { kind: 'page'; msg: PageMsg }
  | { kind: 'text'; id: number; content: string; textColor?: number }
  | { kind: 'image'; id: number; bytes: Uint8Array };

export interface QueueOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between the starts of two image sends. */
  imageGapMs?: number;
  /** Wait before the single retry of a failed rebuild. */
  rebuildRetryMs?: number;
  log?: (...args: unknown[]) => void;
}

export interface WriteQueue {
  enqueue(op: Op): void;
  /** Tell the queue which containers exist now (used after the startup page). */
  setLayout(containers: ContainerMsg[]): void;
  /** Resolves when the queue is empty and the worker is idle. */
  idle(): Promise<void>;
  /** Blank the display. Later writes only update the kept view until wake(). */
  sleep(): void;
  /** Redraw the kept view: its page, then the texts and images written since it. */
  wake(): void;
  isAsleep(): boolean;
}

type Slot = { name: string; kind: 'text' | 'image' };

export function createWriteQueue(bridge: DisplayBridge, opts: QueueOptions = {}): WriteQueue {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const imageGapMs = opts.imageGapMs ?? 110;
  const rebuildRetryMs = opts.rebuildRetryMs ?? 300;
  const log = opts.log ?? ((...a: unknown[]) => console.warn('[queue]', ...a));

  // Insertion order is execution order. Same key: newest payload wins and keeps its slot.
  const pending = new Map<string, Op>();
  let currentIds = new Map<number, Slot>();
  const lastText = new Map<number, string>();
  let lastImageStart = -Infinity;
  let running = false;
  let idleWaiters: Array<() => void> = [];
  // The view to restore on wake: the last page and the writes since it, newest per container.
  let viewPage: PageMsg | null = null;
  const viewWrites = new Map<string, Op>();
  let asleep = false;

  function setLayout(containers: ContainerMsg[]): void {
    viewPage = { type: 'page', containers };
    viewWrites.clear();
    applyLayout(containers);
  }

  function applyLayout(containers: ContainerMsg[]): void {
    currentIds = new Map(containers.map((c) => [c.id, { name: c.name, kind: c.kind }]));
    lastText.clear();
    for (const c of containers) if (c.kind === 'text') lastText.set(c.id, c.content ?? '');
  }

  function enqueue(op: Op): void {
    if (op.kind === 'page') {
      viewPage = op.msg;
      viewWrites.clear();
    } else {
      viewWrites.set(`${op.kind}:${op.id}`, op);
    }
    if (asleep) return;
    if (op.kind === 'page') {
      pending.clear(); // a new layout makes old writes useless
      pending.set('page', op);
    } else {
      pending.set(`${op.kind}:${op.id}`, op);
    }
    void kick();
  }

  function slotFor(op: Exclude<Op, { kind: 'page' }>): Slot | null {
    const slot = currentIds.get(op.id);
    if (!slot || slot.kind !== op.kind) {
      log(`dropping ${op.kind} for id ${op.id}: not in the current layout`);
      return null;
    }
    return slot;
  }

  async function run(op: Op): Promise<void> {
    if (op.kind === 'page') {
      let ok = await bridge.rebuild(op.msg);
      if (!ok) {
        log(`rebuild failed (${op.msg.layout ?? 'page'}), retrying once`);
        await sleep(rebuildRetryMs);
        ok = await bridge.rebuild(op.msg);
      }
      if (ok) applyLayout(op.msg.containers);
      else log(`rebuild failed twice (${op.msg.layout ?? 'page'})`);
      return;
    }
    if (op.kind === 'text') {
      const slot = slotFor(op);
      if (!slot) return;
      if (lastText.get(op.id) === op.content && op.textColor === undefined) return;
      const ok = await bridge.text(op.id, slot.name, op.content, op.textColor);
      if (ok) lastText.set(op.id, op.content);
      else log(`text ${op.id} failed`);
      return;
    }
    // image
    if (!slotFor(op)) return;
    const wait = lastImageStart + imageGapMs - now();
    if (wait > 0) await sleep(wait);
    // A page may have arrived while waiting; check the layout again.
    const slot = slotFor(op);
    if (!slot) return;
    lastImageStart = now();
    const result = await bridge.image(op.id, slot.name, op.bytes);
    if (result !== 'success') log(`image ${op.id} returned ${result}; not retried`);
  }

  async function kick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (pending.size > 0) {
        const [key, op] = pending.entries().next().value as [string, Op];
        pending.delete(key);
        try {
          await run(op);
        } catch (err) {
          log(`${op.kind} threw`, err); // a failed call never stops the worker
        }
      }
    } finally {
      running = false;
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  function idle(): Promise<void> {
    if (!running && pending.size === 0) return Promise.resolve();
    return new Promise((r) => idleWaiters.push(r));
  }

  function blank(): void {
    if (asleep) return;
    asleep = true;
    pending.clear();
    pending.set('page', { kind: 'page', msg: BLANK_PAGE });
    void kick();
  }

  function restore(): void {
    if (!asleep) return;
    asleep = false;
    pending.clear();
    if (viewPage) pending.set('page', { kind: 'page', msg: viewPage });
    for (const [key, op] of viewWrites) pending.set(key, op);
    void kick();
  }

  return { enqueue, setLayout, idle, sleep: blank, wake: restore, isAsleep: () => asleep };
}
