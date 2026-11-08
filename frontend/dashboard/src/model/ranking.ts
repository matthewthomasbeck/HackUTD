import { enumTagToContract } from '../stdb/enums';
import { timestampToMs } from '../stdb/time';
import type { RankedSurvivor } from './types';

const levelOrder = new Map([
  ['immediate', 0],
  ['unknown', 1],
  ['delayed', 2],
  ['minor', 3],
]);

export function rankSurvivors<T extends RankedSurvivor>(survivors: readonly T[], siteId: bigint): T[] {
  return survivors
    .filter((row) => row.siteId === siteId && enumTagToContract(row.status) !== 'resolved')
    .slice()
    .sort((a, b) => {
      const scoreDifference = b.criticalScore - a.criticalScore;
      if (scoreDifference !== 0) return scoreDifference;

      const levelDifference = (levelOrder.get(enumTagToContract(a.criticalLevel)) ?? Number.MAX_SAFE_INTEGER)
        - (levelOrder.get(enumTagToContract(b.criticalLevel)) ?? Number.MAX_SAFE_INTEGER);
      if (levelDifference !== 0) return levelDifference;

      return timestampToMs(a.createdAt) - timestampToMs(b.createdAt);
    });
}
