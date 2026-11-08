import { timestampToMs, type TimestampLike } from '../stdb/time';

export interface ChainRow {
  id: bigint;
  chainId: bigint;
  source: string;
  createdAt: TimestampLike;
}

export function orderChainRows<T extends ChainRow>(rows: readonly T[], chainId: bigint): T[] {
  return rows
    .filter((row) => row.chainId === chainId)
    .slice()
    .sort((a, b) => timestampToMs(a.createdAt) - timestampToMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
