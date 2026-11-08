import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRescuerMap, resolveRescuer } from '../src/rescuers.js';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });

describe('rescuer selection', () => {
  it('prefers a listed hello name, then serial mapping, then default', () => {
    const map = { default: 'alex', by_serial: { 'g2-123': 'sam' } };
    expect(resolveRescuer(map, { requested: 'sam', serial: 'g2-123' })).toBe('sam');
    expect(resolveRescuer(map, { requested: 'unlisted', serial: 'g2-123' })).toBe('sam');
    expect(resolveRescuer(map, { requested: 'unlisted', serial: 'unknown' })).toBe('alex');
  });

  it('loads a local rescuer map and rejects malformed names', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glasses-rescuers-'));
    const path = join(directory, 'rescuers.json');
    await writeFile(path, JSON.stringify({ default: 'alex', by_serial: { 'g2-123': 'sam' } }));
    expect(await readRescuerMap(path)).toEqual({ default: 'alex', by_serial: { 'g2-123': 'sam' } });
    await writeFile(path, JSON.stringify({ default: '../token', by_serial: {} }));
    await expect(readRescuerMap(path)).rejects.toThrow('valid default rescuer name');
  });
});
