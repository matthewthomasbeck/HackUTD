// WebSocket with the reconnect rules of glasses.md 3.6:
// backoff 500 ms, 1 s, 2 s, 4 s, 8 s, then 10 s, each plus 0 to 250 ms jitter;
// reset after 10 s connected; reconnect if nothing arrives for 15 s; reconnect at once when the tab is visible again.

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 10000];
const STABLE_MS = 10_000;
const SILENCE_MS = 15_000;

export type LinkState =
  | { kind: 'connecting' }
  | { kind: 'open' }
  | { kind: 'retrying'; inMs: number }
  | { kind: 'stopped' };

export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: number | undefined;
  private stableTimer: number | undefined;
  private silenceTimer: number | undefined;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly onMessage: (data: string) => void,
    private readonly onState: (s: LinkState) => void,
    private readonly onOpen: () => void = () => {},
  ) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.isOpen()) this.connectNow();
    });
  }

  start(): void {
    this.connectNow();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.onState({ kind: 'stopped' });
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: unknown): boolean {
    if (!this.isOpen()) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  private connectNow(): void {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.onState({ kind: 'connecting' });
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.onState({ kind: 'open' });
      this.armSilence();
      this.stableTimer = window.setTimeout(() => (this.attempt = 0), STABLE_MS);
      this.onOpen();
    };
    ws.onmessage = (ev) => {
      this.armSilence();
      if (typeof ev.data === 'string') this.onMessage(ev.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.stableTimer);
      clearTimeout(this.silenceTimer);
      this.ws = null;
      if (this.stopped) return;
      const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
      const inMs = base + Math.floor(Math.random() * 250);
      this.attempt++;
      this.onState({ kind: 'retrying', inMs });
      this.retryTimer = window.setTimeout(() => this.connectNow(), inMs);
    };
  }

  private armSilence(): void {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = window.setTimeout(() => this.ws?.close(), SILENCE_MS);
  }
}
