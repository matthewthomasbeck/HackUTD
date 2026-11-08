import { describe, expect, it } from 'vitest';
import { getCellAccounting } from '../../src/model/accounting';

describe('getCellAccounting', () => {
  it('uses the module-maintained cell summary values without recomputing them', () => {
    expect(getCellAccounting({ found: 1, reportedMissing: 2, reportedSafe: 0, unaccounted: 1 })).toEqual({
      found: 1, reportedMissing: 2, reportedSafe: 0, unaccounted: 1,
      reportText: '1 UNACCOUNTED',
    });
  });
});
