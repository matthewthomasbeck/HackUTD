import { describe, expect, it } from 'vitest';
import { orderChainRows } from '../../src/model/chains';

describe('orderChainRows', () => {
  it('orders a survivor chain by event time and then id', () => {
    const rows = [
      { id: 3n, chainId: 7n, source: 'assignment', createdAt: 200 },
      { id: 2n, chainId: 7n, source: 'agent_action', createdAt: 100 },
      { id: 1n, chainId: 7n, source: 'detection', createdAt: 100 },
      { id: 4n, chainId: 8n, source: 'detection', createdAt: 0 },
    ];

    expect(orderChainRows(rows, 7n).map((row) => row.id)).toEqual([1n, 2n, 3n]);
  });
});
