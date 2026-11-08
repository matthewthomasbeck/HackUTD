import { EventSourceType, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { describe, expect, it } from 'vitest';
import { createInputHandler } from '../src/plugin/input';
import type { PluginMsg } from '../src/plugin/protocol';

function setup(ackId: number | null = null) {
  let clock = 1000;
  const sent: PluginMsg[] = [];
  const shutdowns: number[] = [];
  const life: string[] = [];
  let displayOff = false;
  const handle = createInputHandler({
    send: (m) => sent.push(m),
    isOpen: () => true,
    shutdown: (mode) => shutdowns.push(mode),
    getAckId: () => ackId,
    isDisplayOff: () => displayOff,
    setDisplayOff: (off) => { displayOff = off; life.push(off ? 'display off' : 'display on'); },
    onForeground: () => life.push('foreground'),
    onExit: () => life.push('exit'),
    now: () => clock,
    log: () => {},
  });
  return {
    sent,
    shutdowns,
    life,
    fire(ev: EvenHubEvent, advanceMs = 500) {
      clock += advanceMs;
      handle(ev);
    },
  };
}

// The SDK types use class instances; plain objects with the same fields are what the host delivers.
const ev = (e: Record<string, unknown>) => e as unknown as EvenHubEvent;

describe('input mapping', () => {
  it('a missing eventType in sysEvent is a tap', () => {
    const t = setup();
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    expect(t.sent).toEqual([{ type: 'input', source: 'ring', event: 'tap' }]);
  });

  it('a missing eventType in textEvent is a tap with source unknown', () => {
    const t = setup();
    t.fire(ev({ textEvent: { containerID: 1 } }));
    expect(t.sent).toEqual([{ type: 'input', source: 'unknown', event: 'tap' }]);
  });

  it('maps temple sources', () => {
    const t = setup();
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_GLASSES_L } }));
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_GLASSES_R } }));
    expect(t.sent.map((m) => (m.type === 'input' ? m.source : ''))).toEqual(['left', 'right']);
  });

  it('double tap calls shutDownPageContainer(1) from the sys envelope', () => {
    const t = setup();
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT, eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    expect(t.sent).toEqual([{ type: 'input', source: 'ring', event: 'double_tap' }]);
    expect(t.shutdowns).toEqual([1]);
  });

  it('double tap calls shutDownPageContainer(1) from the text envelope', () => {
    const t = setup();
    t.fire(ev({ textEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }));
    expect(t.shutdowns).toEqual([1]);
  });

  it('double tap exits even on the ack page and never sends ack', () => {
    const t = setup(42);
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }));
    expect(t.shutdowns).toEqual([1]);
    expect(t.sent.some((m) => m.type === 'ack')).toBe(false);
  });

  it('a scroll with no sysEvent is not a tap', () => {
    const t = setup();
    t.fire(ev({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } }));
    t.fire(ev({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }));
    expect(t.sent).toEqual([
      { type: 'input', source: 'unknown', event: 'scroll_up' },
      { type: 'input', source: 'unknown', event: 'scroll_down' },
    ]);
  });

  it('a tap on a page with ack_assignment_id sends ack instead of input', () => {
    const t = setup(42);
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    expect(t.sent).toEqual([{ type: 'ack', assignment_id: 42 }]);
  });

  it('long press is sent and its release is ignored', () => {
    const t = setup();
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT } }));
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT } }));
    expect(t.sent).toEqual([{ type: 'input', source: 'unknown', event: 'long_press' }]);
  });

  it('drops an identical event repeated within 150 ms', () => {
    const t = setup();
    t.fire(ev({ sysEvent: {} }));
    t.fire(ev({ sysEvent: {} }), 100);
    t.fire(ev({ sysEvent: {} }), 200);
    expect(t.sent).toHaveLength(2);
  });

  it('lifecycle events are not sent', () => {
    const t = setup();
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }));
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.SYSTEM_EXIT_EVENT } }));
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.ABNORMAL_EXIT_EVENT } }));
    expect(t.sent).toEqual([]);
    expect(t.life).toEqual(['foreground', 'exit', 'exit']);
  });

  it('ignores audio events', () => {
    const t = setup();
    t.fire(ev({ audioEvent: { audioPcm: new Uint8Array(4) } }));
    expect(t.sent).toEqual([]);
  });

  it('tap then long press turns the display off instead of asking', () => {
    const t = setup();
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT, eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }), 800);
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT, eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    expect(t.sent).toEqual([{ type: 'input', source: 'ring', event: 'tap' }]);
    expect(t.life).toEqual(['display off']);
  });

  it('a long press long after a tap still asks', () => {
    const t = setup();
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT, eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }), 2000);
    expect(t.sent.map((m) => (m.type === 'input' ? m.event : m.type))).toEqual(['tap', 'long_press']);
    expect(t.life).toEqual([]);
  });

  it('while off, a tap only turns the display on and never acks', () => {
    const t = setup(42);
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } }));
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } })); // acks 42
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT, eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    const before = t.sent.length;
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    expect(t.sent.length).toBe(before);
    expect(t.life).toEqual(['display off', 'display on']);
  });

  it('double tap still exits while the display is off', () => {
    const t = setup();
    t.fire(ev({ sysEvent: { eventSource: EventSourceType.TOUCH_EVENT_FROM_RING } }));
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT } }));
    t.fire(ev({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }));
    expect(t.shutdowns).toEqual([1]);
  });
});
