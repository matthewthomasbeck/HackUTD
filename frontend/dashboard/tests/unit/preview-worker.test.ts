import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, expect, test, vi } from 'vitest';
const { PreviewWorker } = createRequire(import.meta.url)('../../electron/preview-worker.cjs');

afterEach(() => vi.useRealTimers());

test('worker restarts after failure and stops without restarting on app exit', () => {
  vi.useFakeTimers();
  const children: Array<EventEmitter & { kill: ReturnType<typeof vi.fn>; stderr: EventEmitter; exitCode: null; signalCode: null }> = [];
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), stderr: new EventEmitter(), exitCode: null, signalCode: null });
    children.push(child);
    return child;
  });
  const worker = new PreviewWorker({ spawnProcess: spawn, restartMs: 3000, log: vi.fn() });
  worker.start('/python', '/repo/server.py', 'http://pi:8081/', '/data');
  expect(spawn.mock.calls[0]).toBeDefined();
  children[0].emit('exit', 1);
  vi.advanceTimersByTime(3000);
  expect(spawn).toHaveBeenCalledTimes(2);
  worker.stop();
  expect(children[1].kill).toHaveBeenCalledWith('SIGTERM');
  children[1].emit('exit', 0);
  vi.advanceTimersByTime(10000);
  expect(spawn).toHaveBeenCalledTimes(2);
});

test('spawn error schedules one restart even when followed by exit', () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), stderr: new EventEmitter() });
  const spawn = vi.fn(() => child);
  const worker = new PreviewWorker({ spawnProcess: spawn, log: vi.fn() });
  worker.start('/missing', '/server.py', 'http://pi:8081', '/data');
  child.emit('error', new Error('missing interpreter'));
  child.emit('exit', 1);
  vi.advanceTimersByTime(3000);
  expect(spawn).toHaveBeenCalledTimes(2);
  worker.stop();
});
