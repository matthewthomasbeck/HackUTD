import { describe, expect, it } from 'vitest';
import { rankSurvivors } from '../../src/model/ranking';

const row = (id: bigint, criticalLevel: string, criticalScore: number, createdAt: number, status = 'unassigned') => ({
  id, siteId: 1n, criticalLevel, criticalScore, scoreConfidence: 0.8, status, createdAt,
});

describe('rankSurvivors', () => {
  it('sorts by score, then urgency class, then oldest first, and excludes other sites and resolved rows', () => {
    const rows = [
      row(1n, 'delayed', 70, 1),
      row(2n, 'immediate', 70, 2),
      row(3n, 'unknown', 70, 2),
      row(4n, 'immediate', 70, 1),
      row(5n, 'immediate', 80, 1),
      { ...row(6n, 'immediate', 100, 1), siteId: 2n },
      row(7n, 'immediate', 90, 1, 'resolved'),
    ];

    expect(rankSurvivors(rows, 1n).map((survivor) => survivor.id)).toEqual([5n, 4n, 2n, 3n, 1n]);
  });
});
