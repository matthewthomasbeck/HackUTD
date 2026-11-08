import type { TimestampLike } from '../stdb/time';

export type ContractEnum = string | { tag: string };

export interface RankedSurvivor {
  id: bigint;
  siteId: bigint;
  criticalLevel: ContractEnum;
  criticalScore: number;
  scoreConfidence: number;
  status: ContractEnum;
  createdAt: TimestampLike;
}

export interface HeadlineSurvivor {
  id: bigint;
  siteId: bigint;
  criticalLevel: ContractEnum;
  status: ContractEnum;
  createdAt: TimestampLike;
}

export interface EscalationSince {
  survivorId: bigint;
  since: TimestampLike;
}
