// Time source for the runner. Real time in production; a virtual clock in tests and the
// fake-module scenarios, so a 15 s watchdog takes milliseconds to test.

export type TimerHandle = number;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
  sleep(ms: number): Promise<void>;
}

export class RealClock implements Clock {
  private next = 1;
  private timers = new Map<number, NodeJS.Timeout>();
  now(): number {
    return Date.now();
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.next++;
    const t = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, Math.max(0, ms));
    this.timers.set(id, t);
    return id;
  }
  clearTimeout(h: TimerHandle): void {
    const t = this.timers.get(h);
    if (t) clearTimeout(t);
    this.timers.delete(h);
  }
  sleep(ms: number): Promise<void> {
    return new Promise((r) => this.setTimeout(r, ms));
  }
  /** Cancel every pending timer (clean shutdown). */
  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

interface VTimer {
  id: number;
  due: number;
  seq: number;
  fn: () => void;
}

/** Let pending promise chains run. Everything in the fake world resolves without real I/O. */
export async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

export class VirtualClock implements Clock {
  private t: number;
  private next = 1;
  private seq = 0;
  private timers: VTimer[] = [];
  constructor(start = Date.UTC(2026, 10, 8, 3, 0, 0)) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.next++;
    this.timers.push({ id, due: this.t + Math.max(0, ms), seq: this.seq++, fn });
    return id;
  }
  clearTimeout(h: TimerHandle): void {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  sleep(ms: number): Promise<void> {
    return new Promise((r) => this.setTimeout(r, ms));
  }
  /** Advance virtual time by ms, firing due timers in order and settling promises between them. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await settle();
    for (;;) {
      let best: VTimer | undefined;
      for (const x of this.timers) {
        if (x.due > target) continue;
        if (!best || x.due < best.due || (x.due === best.due && x.seq < best.seq)) best = x;
      }
      if (!best) break;
      const fire = best;
      this.timers = this.timers.filter((x) => x !== fire);
      this.t = Math.max(this.t, fire.due);
      fire.fn();
      await settle();
    }
    this.t = target;
    await settle();
  }
  /** Advance in small steps (keeps ordering realistic for code that schedules as it goes). */
  async run(ms: number, stepMs = 250): Promise<void> {
    let left = ms;
    while (left > 0) {
      const s = Math.min(stepMs, left);
      await this.advance(s);
      left -= s;
    }
  }
}
