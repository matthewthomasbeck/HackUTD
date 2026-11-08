import { describe, expect, it } from 'vitest';
import type { DisplayBridge } from '../src/plugin/bridge';
import type { ContainerMsg, PageMsg } from '../src/plugin/protocol';
import { createWriteQueue } from '../src/plugin/queue';

const capture: ContainerMsg = { kind: 'text', id: 1, name: 'capture', x: 0, y: 0, w: 576, h: 288, z: 1, content: ' ', capture: true };
const status: ContainerMsg = { kind: 'text', id: 8, name: 'status', x: 8, y: 232, w: 560, h: 28, z: 3, content: 'hi' };
const arrow: ContainerMsg = { kind: 'image', id: 2, name: 'arrow', x: 16, y: 40, w: 144, h: 144, z: 2 };
const page = (layout: string, containers: ContainerMsg[] = [capture, arrow, status]): PageMsg => ({ type: 'page', layout, containers });

/** Fake bridge with a manual clock: every call takes `callMs` of fake time. */
function fake(opts: { rebuildOk?: boolean[]; throwOnText?: boolean } = {}) {
  let clock = 0;
  const calls: Array<{ op: string; id?: number; content?: string; at: number }> = [];
  const rebuildOk = [...(opts.rebuildOk ?? [])];
  const bridge: DisplayBridge = {
    async rebuild(p) {
      calls.push({ op: `page:${p.layout}`, at: clock });
      return rebuildOk.length ? rebuildOk.shift()! : true;
    },
    async text(id, _name, content) {
      calls.push({ op: 'text', id, content, at: clock });
      if (opts.throwOnText) throw new Error('boom');
      return true;
    },
    async image(id) {
      calls.push({ op: 'image', id, at: clock });
      clock += 5;
      return 'success';
    },
    async shutdown() {
      return true;
    },
  };
  const queue = createWriteQueue(bridge, {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: () => {},
  });
  return { queue, calls };
}

describe('write queue', () => {
  it('a page clears pending writes', async () => {
    const { queue, calls } = fake();
    queue.setLayout([capture, arrow, status]);
    // The worker starts at once with the first op; everything queued behind it is cleared by the page.
    queue.enqueue({ kind: 'text', id: 8, content: 'first' });
    queue.enqueue({ kind: 'text', id: 8, content: 'stale' });
    queue.enqueue({ kind: 'image', id: 2, bytes: new Uint8Array([1]) });
    queue.enqueue({ kind: 'page', msg: page('map') });
    await queue.idle();
    expect(calls.map((c) => c.op)).toEqual(['text', 'page:map']);
    expect(calls[0].content).toBe('first');
  });

  it('two texts for one id send only the newest', async () => {
    const { queue, calls } = fake();
    queue.setLayout([capture, arrow, status]);
    queue.enqueue({ kind: 'image', id: 2, bytes: new Uint8Array([1]) }); // keeps the worker busy
    queue.enqueue({ kind: 'text', id: 8, content: 'old' });
    queue.enqueue({ kind: 'text', id: 8, content: 'new' });
    await queue.idle();
    const texts = calls.filter((c) => c.op === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].content).toBe('new');
  });

  it('skips a text equal to the last applied content', async () => {
    const { queue, calls } = fake();
    queue.setLayout([capture, arrow, status]); // status content is 'hi'
    queue.enqueue({ kind: 'text', id: 8, content: 'hi' });
    await queue.idle();
    expect(calls).toHaveLength(0);
  });

  it('images are at least 110 ms apart', async () => {
    const { queue, calls } = fake();
    const second: ContainerMsg = { kind: 'image', id: 3, name: 'map_bot', x: 0, y: 144, w: 288, h: 144, z: 4 };
    queue.setLayout([capture, arrow, second, status]);
    queue.enqueue({ kind: 'image', id: 2, bytes: new Uint8Array([1]) });
    queue.enqueue({ kind: 'image', id: 3, bytes: new Uint8Array([2]) });
    await queue.idle();
    queue.enqueue({ kind: 'image', id: 2, bytes: new Uint8Array([3]) });
    await queue.idle();
    const at = calls.filter((c) => c.op === 'image').map((c) => c.at);
    expect(at).toHaveLength(3);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(110);
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(110);
  });

  it('drops writes for unknown ids or the wrong kind', async () => {
    const { queue, calls } = fake();
    queue.setLayout([capture, status]);
    queue.enqueue({ kind: 'text', id: 5, content: 'nobody' });
    queue.enqueue({ kind: 'image', id: 8, bytes: new Uint8Array([1]) }); // id 8 is text
    await queue.idle();
    expect(calls).toHaveLength(0);
  });

  it('uses the new layout after a page', async () => {
    const { queue, calls } = fake();
    queue.setLayout([capture, status]);
    const brief: ContainerMsg = { kind: 'text', id: 6, name: 'brief', x: 184, y: 164, w: 384, h: 56, z: 4, content: '' };
    queue.enqueue({ kind: 'page', msg: page('arrow', [capture, arrow, brief, status]) });
    queue.enqueue({ kind: 'text', id: 6, content: 'enter by front door' });
    await queue.idle();
    expect(calls.map((c) => c.op)).toEqual(['page:arrow', 'text']);
  });

  it('retries a failed rebuild once', async () => {
    const { queue, calls } = fake({ rebuildOk: [false, true] });
    queue.enqueue({ kind: 'page', msg: page('map') });
    await queue.idle();
    expect(calls.map((c) => c.op)).toEqual(['page:map', 'page:map']);
  });

  it('a throwing call does not stop the queue', async () => {
    const { queue, calls } = fake({ throwOnText: true });
    queue.setLayout([capture, arrow, status]);
    queue.enqueue({ kind: 'text', id: 8, content: 'throws' });
    queue.enqueue({ kind: 'image', id: 2, bytes: new Uint8Array([1]) });
    await queue.idle();
    expect(calls.map((c) => c.op)).toEqual(['text', 'image']);
  });

  it('display off blanks the page, holds writes, and wake redraws the latest view', async () => {
    const { queue, calls } = fake();
    queue.setLayout([capture, arrow, status]);
    queue.enqueue({ kind: 'page', msg: page('map') });
    queue.enqueue({ kind: 'image', id: 2, bytes: new Uint8Array([1]) });
    await queue.idle();
    queue.sleep();
    await queue.idle();
    expect(queue.isAsleep()).toBe(true);
    // While off, writes only update the kept view.
    queue.enqueue({ kind: 'text', id: 8, content: 'old' });
    queue.enqueue({ kind: 'text', id: 8, content: 'new' });
    await queue.idle();
    expect(calls.map((c) => c.op)).toEqual(['page:map', 'image', 'page:blank']);
    queue.wake();
    await queue.idle();
    expect(calls.slice(3).map((c) => c.op)).toEqual(['page:map', 'image', 'text']);
    expect(calls[5].content).toBe('new');
  });

  it('a page that arrives while off is the one redrawn on wake', async () => {
    const { queue, calls } = fake();
    queue.setLayout([capture, arrow, status]);
    queue.sleep();
    queue.enqueue({ kind: 'image', id: 2, bytes: new Uint8Array([1]) });
    queue.enqueue({ kind: 'page', msg: page('arrived') });
    await queue.idle();
    queue.wake();
    await queue.idle();
    expect(calls.map((c) => c.op)).toEqual(['page:blank', 'page:arrived']);
  });
});
