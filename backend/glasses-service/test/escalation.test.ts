import { describe, expect, it } from 'vitest';
import { hasLevelTwoEscalation, idleNotice } from '../src/session.js';

describe('level two escalation notice', () => {
  it('requires the second recent all-audience escalation for the same survivor', () => {
    const now = Date.now();
    const recent = (survivorId: number, id: number) => ({ id, survivorId, audience: 'all', kind: { Escalation: [] }, text: 'IMMEDIATE alert', createdAt: new Date(now - id * 1000) });
    expect(hasLevelTwoEscalation([recent(4, 1)], now)).toBe(false);
    expect(hasLevelTwoEscalation([recent(4, 1), recent(4, 2)], now)).toBe(true);
    expect(hasLevelTwoEscalation([recent(4, 1), recent(5, 2)], now)).toBe(false);
  });

  it('ignores non-all, non-escalation, and stale briefings', () => {
    const now = Date.now();
    const stale = { survivorId: 4, audience: 'all', kind: { Escalation: [] }, text: 'old alert', createdAt: new Date(now - 601_000) };
    const own = { survivorId: 4, audience: 'a'.repeat(64), kind: { Escalation: [] }, text: 'private alert', createdAt: new Date(now) };
    const other = { survivorId: 4, audience: 'all', kind: { Info: [] }, text: 'info', createdAt: new Date(now) };
    expect(hasLevelTwoEscalation([stale, own, other], now)).toBe(false);
  });

  it('adds the level two phone/ask notice only while the rescuer is free', () => {
    const now = Date.now();
    const escalation = (id: number) => ({ survivorId: 4, audience: 'all', kind: { Escalation: [] }, text: 'alert', createdAt: new Date(now - id * 1000) });
    const briefings = [escalation(1), escalation(2)];
    expect(idleNotice('NO GPS FIX', true, briefings, now)).toBe('hold: ask  phone: take it');
    expect(idleNotice('assignment active', false, briefings, now)).toBe('assignment active');
  });
});
