import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { distanceM } from '../src/geo.js';
import { FakeSession, pickAssignment } from '../src/session.js';
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

  it('fills the acknowledgement view with the proposed survivor, not the layout placeholders', () => {
    const session = new FakeSession({ demoStartBearingDeg: 225, demoStartDistanceM: 250 });
    session.enableLiveMode();
    session.applyDbSnapshot(snapshot());
    const data = (session as unknown as { data(layout: string): Record<string, string> }).data('ack');

    expect(data.head).toMatch(/^NEW TASK - IMMEDIATE\nhouse 3, 250 m NE$/);
    expect(data.detail).toBe('breathing detected\nfront door');
    expect(data.status).toMatch(/^TAP TO ACCEPT - \d+s left$/);
  });

  it('starts the demo walker idempotently, while walk toggles it', () => {
    const session = new FakeSession({ demoStartBearingDeg: 225, demoStartDistanceM: 250 });
    session.applyDbSnapshot(snapshot());
    const walking = () => (session as unknown as { demo: { walking: boolean } }).demo.walking;
    session.demoCommand('start');
    session.demoCommand('start');
    expect(walking()).toBe(true);
    session.demoCommand('walk');
    expect(walking()).toBe(false);
    session.demoCommand('reset');
    expect(walking()).toBe(false);
  });

  it('projects an active assignment to the arrow view near its target', () => {
    const session = new FakeSession({ demoStartBearingDeg: 0, demoStartDistanceM: 30 });
    session.enableLiveMode();
    const value = snapshot();
    value.assignments[0]!.status = { Active: [] };
    session.applyDbSnapshot(value);

    expect(session.currentLayout()).toBe('arrow');
  });

  it('does not resend an unchanged page or image to the same socket', async () => {
    const session = new FakeSession({ demoStartBearingDeg: 0, demoStartDistanceM: 30 });
    await session.init();
    session.enableLiveMode();
    const value = snapshot();
    value.assignments[0]!.status = { Active: [] };
    const sent: Array<{ type: string }> = [];
    const ws = { OPEN: 1, readyState: 1, on: vi.fn(), send: (raw: string) => sent.push(JSON.parse(raw)) } as unknown as WebSocket;
    session.applyDbSnapshot(value);
    session.attach(ws);
    // Guide images are encoded asynchronously, so let each round of sends finish before counting.
    const settle = () => new Promise(resolve => setTimeout(resolve, 100));
    await settle();
    const first = sent.length;
    session.applyDbSnapshot(value);
    session.applyDbSnapshot(value);
    await settle();

    expect(sent.filter(message => message.type === 'page')).toHaveLength(1);
    expect(sent.length).toBe(first);
  });

  it('shows a new proposal over an active assignment, newest first', () => {
    const rows = [
      { id: 28, status: { Active: [] } },
      { id: 46, status: { Proposed: [] } },
      { id: 12, status: { Released: [] } },
      { id: 44, status: { Proposed: [] } },
    ];
    expect(pickAssignment(rows)?.id).toBe(46);
    expect(pickAssignment(rows.filter(row => row.id !== 46 && row.id !== 44))?.id).toBe(28);
  });

  it('updates changed text in place on the same layout instead of rebuilding the page', async () => {
    const session = new FakeSession({ demoStartBearingDeg: 0, demoStartDistanceM: 30 });
    await session.init();
    session.enableLiveMode();
    const value = snapshot();
    value.assignments[0]!.status = { Active: [] };
    const sent: Array<{ type: string; id?: number }> = [];
    const ws = { OPEN: 1, readyState: 1, on: vi.fn(), send: (raw: string) => sent.push(JSON.parse(raw)) } as unknown as WebSocket;
    session.applyDbSnapshot(value);
    session.attach(ws);
    await new Promise(resolve => setTimeout(resolve, 100));
    const before = sent.length;
    value.survivors[0]!.breathingRateBpm = 22;
    session.applyDbSnapshot(value);
    await new Promise(resolve => setTimeout(resolve, 600));
    const after = sent.slice(before);
    expect(after.some(message => message.type === 'text')).toBe(true);
    expect(after.some(message => message.type === 'page' || message.type === 'image')).toBe(false);
  });
});
