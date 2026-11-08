import { describe, expect, it } from 'vitest';
import { distanceM } from '../src/geo.js';
import { FakeSession } from '../src/session.js';
import type { DbSnapshot } from '../src/db.js';

function snapshot(): DbSnapshot {
  return {
    status: 'connected',
    assignments: [{ id: 41, survivorId: 9, status: { Proposed: [] }, leaseExpiresAt: new Date(Date.now() + 20_000) }],
    briefings: [], assignedSurvivors: [], criticalOpen: [],
    survivors: [{ id: 9, lat: 32.9857, lon: -96.7502, criticalLevel: { Immediate: [] }, criticalScore: 88, status: { Unassigned: [] }, houseLabel: 'house 3', locationNote: 'front door', breathing: { Detected: [] } }],
    sites: [{ id: 1, centerLat: 32.9857, centerLon: -96.7502, radiusM: 483, demoMode: true }],
    robots: [], viewFallbacks: [], lastMessageAt: Date.now(),
  };
}

describe('glasses session projection', () => {
  it('projects the owned proposal as an acknowledgement view with the configured demo origin', () => {
    const session = new FakeSession({ demoStartBearingDeg: 225, demoStartDistanceM: 250 });
    session.enableLiveMode();
    session.applyDbSnapshot(snapshot());

    expect(session.currentLayout()).toBe('ack');
    expect(session.currentSurvivorId()).toBe('9');
    expect(distanceM(session.currentPosition(), { lat: 32.9857, lon: -96.7502 })).toBeCloseTo(250, 0);
  });

  it('projects an active assignment to the arrow view near its target', () => {
    const session = new FakeSession({ demoStartBearingDeg: 0, demoStartDistanceM: 30 });
    session.enableLiveMode();
    const value = snapshot();
    value.assignments[0]!.status = { Active: [] };
    session.applyDbSnapshot(value);

    expect(session.currentLayout()).toBe('arrow');
  });
});
