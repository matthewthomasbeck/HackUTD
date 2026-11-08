// WebSocket to the glasses service with reconnect and backoff (glasses.md 3.6).
import type { PluginMsg } from './protocol';

export interface SocketOptions {
  url: string;
  onOpen(): void;
  onMessage(data: string): void;
  onClose(): void;
  /** Injected for tests. */
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
}

export interface ServiceSocket {
  send(msg: PluginMsg): boolean;
  isOpen(): boolean;
  /** Reconnect at once if the socket is not open (foreground, visibility). */
  reconnectNow(): void;
  /** Close for good (app exit). */
  close(): void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 10000];
const STABLE_MS = 10_000; // reset the backoff after the socket stays open this long
const SILENCE_MS = 15_000; // the service sends at least every 5 s; reconnect after 15 s of silence

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  return base + Math.floor(random() * 250);
}

export function connectService(opts: SocketOptions): ServiceSocket {
  const WS = opts.WebSocketImpl ?? WebSocket;
  const random = opts.random ?? Math.random;
  let ws: WebSocket | null = null;
  let attempt = 0;
  let closedForGood = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setInterval> | null = null;
  let lastMessageAt = 0;

  function clearTimers(): void {
    if (stableTimer) clearTimeout(stableTimer);
    if (silenceTimer) clearInterval(silenceTimer);
    stableTimer = null;
    silenceTimer = null;
  }

  function open(): void {
    if (closedForGood) return;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    let sock: WebSocket;
    try {
      sock = new WS(opts.url);
    } catch (err) {
      console.warn('[socket] could not open', opts.url, err);
      scheduleRetry();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      console.log('[socket] open', opts.url);
      lastMessageAt = Date.now();
      stableTimer = setTimeout(() => (attempt = 0), STABLE_MS);
      silenceTimer = setInterval(() => {
        if (Date.now() - lastMessageAt > SILENCE_MS) {
          console.warn('[socket] no message for 15 s, reconnecting');
          sock.close();
        }
      }, 1000);
      opts.onOpen();
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      lastMessageAt = Date.now();
      if (typeof ev.data === 'string') opts.onMessage(ev.data);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      clearTimers();
      opts.onClose();
      scheduleRetry();
    };
    sock.onerror = () => {
      // onclose follows and handles the retry
    };
  }

  function scheduleRetry(): void {
    if (closedForGood || retryTimer) return;
    const delay = backoffDelay(attempt++, random);
    console.log(`[socket] retry in ${delay} ms`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  }

  open();

  return {
    send(msg) {
      if (!ws || ws.readyState !== WS.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    isOpen() {
      return !!ws && ws.readyState === WS.OPEN;
    },
    reconnectNow() {
      if (closedForGood) return;
      if (ws && (ws.readyState === WS.OPEN || ws.readyState === WS.CONNECTING)) return;
      attempt = 0;
      open();
    },
    close() {
      closedForGood = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearTimers();
      const sock = ws;
      ws = null;
      sock?.close();
    },
  };
}
