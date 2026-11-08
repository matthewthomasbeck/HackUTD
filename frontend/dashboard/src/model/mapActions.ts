export type MapCellAction = 'send' | 'searched' | 'partial' | 'report' | 'rename';

export type MapCellCommand =
  | { type: 'create_mission'; args: { robotId: string; kind: { tag: 'SearchCells' }; targetCellIds: bigint[]; targetLat: undefined; targetLon: undefined; reason: string; chainId: bigint } }
  | { type: 'mark_cell'; args: { cellId: bigint; status: { tag: 'Searched' } | { tag: 'PartiallySearched' }; observedAt: undefined } }
  | { type: 'label_cell'; args: { cellId: bigint; label: string } }
  | { type: 'open_person_report'; cellId: bigint };

export function mapCellActionCommand(action: MapCellAction, cellId: bigint, options: { robotId?: string; label?: string } = {}): MapCellCommand | undefined {
  if (action === 'send') {
    if (!options.robotId) return undefined;
    return { type: 'create_mission', args: { robotId: options.robotId, kind: { tag: 'SearchCells' }, targetCellIds: [cellId], targetLat: undefined, targetLon: undefined, reason: 'coordinator map request', chainId: 0n } };
  }
  if (action === 'searched' || action === 'partial') return { type: 'mark_cell', args: { cellId, status: action === 'searched' ? { tag: 'Searched' } : { tag: 'PartiallySearched' }, observedAt: undefined } };
  if (action === 'rename') {
    const label = options.label?.trim();
    if (!label) return undefined;
    return { type: 'label_cell', args: { cellId, label } };
  }
  return { type: 'open_person_report', cellId };
}
