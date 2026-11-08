// Offline demo: replays a recording of the glasses service's messages from the dashboard's Play demo (the find,
// assignment, accept, walk, arrival), so an installed build shows the story with no laptop or network.
// The recording comes from `npm run record-demo` (scripts/record-demo.mjs). The player feeds the same message handler
// as the live socket, so every view is drawn by the same code as in a live run.
import type { PluginMsg, ServiceMsg } from './protocol';

export interface DemoFrame {
  /** Milliseconds from the start of the recording. */
  t: number;
  msg: ServiceMsg;
}

export interface DemoRecording {
  recorded_at?: string;
  rescuer?: string;
  frames: DemoFrame[];
}

export interface DemoPlayerOptions {
  recording: DemoRecording;
  deliver(msg: ServiceMsg): void;
  /** How long the last view stays up before the story starts again. */
  loopPauseMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DemoPlayer {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  /** Messages the plugin would send to the service. A tap on the task screen accepts it at once. */
  handle(msg: PluginMsg): void;
}

function isNextView(msg: ServiceMsg): boolean {
  return msg.type === 'page' && msg.layout !== 'ack';
}

export function createDemoPlayer(opts: DemoPlayerOptions): DemoPlayer {
  const frames = opts.recording.frames;
  const loopPauseMs = opts.loopPauseMs ?? 15_000;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let running = false;
  let next = 0;
  let timer: unknown = null;
  let onAckPage = false;

  function schedule(ms: number): void {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(step, Math.max(0, ms));
  }

  // Deliver every frame due at the same moment, then wait for the next one.
  function step(): void {
    timer = null;
    if (!running) return;
    if (next >= frames.length) {
      next = 0;
      onAckPage = false;
      schedule(0);
      return;
    }
    const t = frames[next]!.t;
    while (next < frames.length && frames[next]!.t === t) {
      const msg = frames[next]!.msg;
      if (msg.type === 'page') onAckPage = msg.layout === 'ack';
      opts.deliver(msg);
      next += 1;
    }
    schedule(next < frames.length ? frames[next]!.t - t : loopPauseMs);
  }

  return {
    start() {
      if (running || frames.length === 0) return;
      running = true;
      next = 0;
      onAckPage = false;
      schedule(0);
    },
    stop() {
      running = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    isRunning: () => running,
    handle(msg) {
      if (!running || msg.type !== 'ack' || !onAckPage) return;
      // Skip the rest of the wait on the task screen (its countdown updates) and show the next view now.
      onAckPage = false;
      while (next < frames.length && !isNextView(frames[next]!.msg)) next += 1;
      schedule(0);
    },
  };
}
