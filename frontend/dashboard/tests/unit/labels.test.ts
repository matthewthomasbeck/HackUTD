import { describe, expect, it } from 'vitest';
import { breathingLabel, resolutionLabel, RUN_NAME_MAX, runName, survivorStatusLabel } from '../../src/model/labels';

describe('labels', () => {
  it('uses the specified breathing copy', () => {
    expect(breathingLabel('detected', 18, 0.72)).toBe('Breathing seen, 18 per min (confidence 0.72)');
    expect(breathingLabel('not_detected', null, 0)).toBe('No signs of life detected, low confidence');
    expect(breathingLabel('unknown', null, 0)).toBe('Breathing not checked yet');
  });

  it('labels all survivor states and resolutions without forbidden death language', () => {
    expect(['unassigned', 'assigned', 'en_route', 'reached', 'resolved'].map(survivorStatusLabel)).toEqual([
      'UNASSIGNED, no rescuer', 'ASSIGNED, acknowledged', 'EN ROUTE', 'REACHED', 'RESOLVED',
    ]);
    expect(resolutionLabel('false_alarm')).toBe('RESOLVED: false alarm');
    expect(resolutionLabel('duplicate')).toBe('RESOLVED: duplicate');
    const copy = JSON.stringify(['unassigned', 'assigned', 'en_route', 'reached', 'resolved'].map(survivorStatusLabel));
    expect(copy).not.toMatch(/dead|deceased|expectant|no pulse/i);
  });

  it('builds run names the module accepts, keeping the time', () => {
    const at = new Date(2026, 10, 8, 9, 5, 7);
    const long = runName('Demo: tornado damage, Richardson TX (simulated)', at);
    expect(long.length).toBeLessThanOrEqual(RUN_NAME_MAX);
    expect(long.endsWith(at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))).toBe(true);
    expect(runName('Smoke site', at).startsWith('Smoke site · ')).toBe(true);
    expect(runName('  ', at).startsWith('Run · ')).toBe(true);
  });
});
