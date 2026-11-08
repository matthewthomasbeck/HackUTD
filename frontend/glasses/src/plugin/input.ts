// SDK events to contract input messages (glasses.md 3.5).
// CLICK_EVENT is 0 and dropped on the wire, so a missing eventType inside an envelope is a click.
import { EventSourceType, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';
import type { InputEventName, InputSource, PluginMsg } from './protocol';

export interface InputDeps {
  send(msg: PluginMsg): void;
  isOpen(): boolean;
  shutdown(exitMode: 0 | 1): void;
  /** The current page's ack_assignment_id, or null. */
  getAckId(): number | string | null;
  onForeground(): void;
  onExit(): void;
  now?: () => number;
  log?: (...args: unknown[]) => void;
}

const REPEAT_MS = 150;

export function sourceName(raw: unknown): InputSource {
  switch (raw) {
    case EventSourceType.TOUCH_EVENT_FROM_RING:
      return 'ring';
    case EventSourceType.TOUCH_EVENT_FROM_GLASSES_L:
      return 'left';
    case EventSourceType.TOUCH_EVENT_FROM_GLASSES_R:
      return 'right';
    default:
      return 'unknown';
  }
}

/** Pick the envelope and resolve its event type. Returns null when there is nothing to handle. */
export function resolveEvent(event: EvenHubEvent): { type: OsEventTypeList; source: InputSource } | null {
  const sys = event.sysEvent;
  const text = event.textEvent ?? event.listEvent;
  const source = sys ? sourceName(sys.eventSource) : 'unknown';
  // An explicit type in the text envelope (scrolls) wins; else the sys envelope; else a bare text envelope is a click.
  if (text && text.eventType !== undefined && text.eventType !== null) return { type: text.eventType, source };
  if (sys) return { type: sys.eventType ?? OsEventTypeList.CLICK_EVENT, source };
  if (text) return { type: OsEventTypeList.CLICK_EVENT, source };
  return null;
}

export function createInputHandler(deps: InputDeps): (event: EvenHubEvent) => void {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((...a: unknown[]) => console.log('[input]', ...a));
  let lastKey = '';
  let lastAt = -Infinity;

  function repeated(key: string): boolean {
    const t = now();
    const dup = key === lastKey && t - lastAt < REPEAT_MS;
    lastKey = key;
    lastAt = t;
    return dup;
  }

  function sendInput(event: InputEventName, source: InputSource): void {
    if (deps.isOpen()) deps.send({ type: 'input', source, event });
  }

  return (event: EvenHubEvent) => {
    if (event.audioEvent) return; // microphone is not implemented yet (mic.ts is cut until checkpoint 4)
    const resolved = resolveEvent(event);
    if (!resolved) return;
    const { type, source } = resolved;

    switch (type) {
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        // Double tap always exits, whatever the view. Never a product action.
        if (!repeated(`double_tap:${source}`)) {
          log('double_tap', source);
          sendInput('double_tap', source);
        }
        deps.shutdown(1);
        return;
      case OsEventTypeList.CLICK_EVENT: {
        if (repeated(`tap:${source}`)) return;
        const ackId = deps.getAckId();
        log('tap', source, ackId !== null ? `ack ${ackId}` : '');
        if (ackId !== null) {
          if (deps.isOpen()) deps.send({ type: 'ack', assignment_id: ackId });
        } else {
          sendInput('tap', source);
        }
        return;
      }
      case OsEventTypeList.SCROLL_TOP_EVENT:
        if (!repeated(`scroll_up:${source}`)) sendInput('scroll_up', source);
        return;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        if (!repeated(`scroll_down:${source}`)) sendInput('scroll_down', source);
        return;
      case OsEventTypeList.LONG_PRESS_EVENT:
        if (!repeated(`long_press:${source}`)) sendInput('long_press', source);
        return;
      case OsEventTypeList.FOREGROUND_ENTER_EVENT:
        deps.onForeground();
        return;
      case OsEventTypeList.SYSTEM_EXIT_EVENT:
      case OsEventTypeList.ABNORMAL_EXIT_EVENT:
        deps.onExit();
        return;
      default:
        // LONG_PRESS_RELEASE_EVENT, FOREGROUND_EXIT_EVENT, IMU_DATA_REPORT: not sent.
        return;
    }
  };
}
