import { describe, expect, it } from 'vitest';
import { createDemoPlayer } from '../src/plugin/demo';
import type { DemoRecording } from '../src/plugin/demo';
import type { ServiceMsg } from '../src/plugin/protocol';
import recording from '../src/plugin/demo-recording.json';

const page = (layout: string, extra: Record<string, unknown> = {}): ServiceMsg => ({ type: 'page', layout, containers: [], ...extra });
const text = (content: string): ServiceMsg => ({ type: 'text', id: 8, content });

/** Manual clock: timers run only when advance() passes their due time. */
function clock() {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers = timers.filter((t) => t.id !== id);
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        now = due.at;
        due.fn();
      }
      now = end;
    },
  };
}

const STORY: DemoRecording = {
  frames: [
    { t: 0, msg: page('idle') },
    { t: 0, msg: text('stand by') },
    { t: 1000, msg: page('ack', { ack_assignment_id: '7' }) },
    { t: 2000, msg: text('TAP TO ACCEPT - 29s left') },
    { t: 3000, msg: text('TAP TO ACCEPT - 28s left') },
    { t: 9000, msg: page('map') },
    { t: 12000, msg: page('arrived') },
  ],
};

function setup(rec: DemoRecording = STORY) {
  const c = clock();
  const seen: string[] = [];
  const player = createDemoPlayer({
    recording: rec,
    deliver: (msg) => seen.push(msg.type === 'page' ? `page:${msg.layout}` : msg.type === 'text' ? `text:${msg.content}` : msg.type),
    loopPauseMs: 5000,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  });
  return { c, seen, player };
}

describe('demo player', () => {
  it('plays frames on the recorded timing', () => {
    const { c, seen, player } = setup();
    player.start();
    c.advance(0);
    expect(seen).toEqual(['page:idle', 'text:stand by']);
    c.advance(1000);
    expect(seen.at(-1)).toBe('page:ack');
    c.advance(8000);
    expect(seen.slice(-3)).toEqual(['text:TAP TO ACCEPT - 29s left', 'text:TAP TO ACCEPT - 28s left', 'page:map']);
  });

  it('a tap on the task screen skips the countdown and shows the next view', () => {
    const { c, seen, player } = setup();
    player.start();
    c.advance(1500);
    player.handle({ type: 'ack', assignment_id: '7' });
    c.advance(0);
    expect(seen).toEqual(['page:idle', 'text:stand by', 'page:ack', 'page:map']);
  });

  it('ignores taps away from the task screen and other messages', () => {
    const { c, seen, player } = setup();
    player.start();
    c.advance(0);
    player.handle({ type: 'ack', assignment_id: '7' });
    player.handle({ type: 'input', source: 'ring', event: 'tap' });
    c.advance(0);
    expect(seen).toEqual(['page:idle', 'text:stand by']);
  });

  it('loops after the last view stays up for the pause', () => {
    const { c, seen, player } = setup();
    player.start();
    c.advance(12000);
    expect(seen.at(-1)).toBe('page:arrived');
    c.advance(4999);
    expect(seen.at(-1)).toBe('page:arrived');
    c.advance(1);
    expect(seen.slice(-2)).toEqual(['page:idle', 'text:stand by']);
  });

  it('stops delivering once stopped', () => {
    const { c, seen, player } = setup();
    player.start();
    c.advance(0);
    player.stop();
    c.advance(60_000);
    expect(seen).toEqual(['page:idle', 'text:stand by']);
    expect(player.isRunning()).toBe(false);
  });
});

describe('bundled recording', () => {
  const rec = recording as DemoRecording;
  const layouts = rec.frames.filter((f) => f.msg.type === 'page').map((f) => (f.msg as { layout?: string }).layout);

  it('tells the whole house 3 story in order', () => {
    const order = ['ack', 'map', 'arrived'].map((l) => layouts.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(rec.frames[0]!.msg.type).toBe('page');
  });

  it('has times that never go backwards', () => {
    for (let i = 1; i < rec.frames.length; i++) expect(rec.frames[i]!.t).toBeGreaterThanOrEqual(rec.frames[i - 1]!.t);
  });

  it('has an assignment id on the task screen so a tap can accept it', () => {
    const ack = rec.frames.find((f) => f.msg.type === 'page' && f.msg.layout === 'ack')!.msg as { ack_assignment_id?: unknown };
    expect(ack.ack_assignment_id).toBeDefined();
  });
});
