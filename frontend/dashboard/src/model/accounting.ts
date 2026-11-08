export interface CellSummary {
  found: number;
  reportedMissing: number;
  reportedSafe: number;
  unaccounted: number;
}

export function getCellAccounting(cell: CellSummary): CellSummary & { reportText: string } {
  return {
    found: cell.found,
    reportedMissing: cell.reportedMissing,
    reportedSafe: cell.reportedSafe,
    unaccounted: cell.unaccounted,
    reportText: cell.unaccounted > 0 ? `${cell.unaccounted} UNACCOUNTED` : 'No reports',
  };
}
