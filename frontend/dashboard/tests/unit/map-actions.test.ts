import { describe, expect, it } from 'vitest';
import { mapCellActionCommand } from '../../src/model/mapActions';

describe('mapCellActionCommand', () => {
  it('builds a reducer-safe single-cell search mission for an online robot', () => {
    expect(mapCellActionCommand('send', 12n, { robotId: 'dog-1' })).toEqual({
      type: 'create_mission',
      args: { robotId: 'dog-1', kind: { tag: 'SearchCells' }, targetCellIds: [12n], targetLat: undefined, targetLon: undefined, reason: 'coordinator map request', chainId: 0n },
    });
  });

  it('requires a selected online robot before creating a mission', () => {
    expect(mapCellActionCommand('send', 12n)).toBeUndefined();
  });

  it('uses the contract cell status tags for the searched actions', () => {
    expect(mapCellActionCommand('searched', 12n)).toEqual({ type: 'mark_cell', args: { cellId: 12n, status: { tag: 'Searched' }, observedAt: undefined } });
    expect(mapCellActionCommand('partial', 12n)).toEqual({ type: 'mark_cell', args: { cellId: 12n, status: { tag: 'PartiallySearched' }, observedAt: undefined } });
  });

  it('returns the label request and person-report route without inventing reducers', () => {
    expect(mapCellActionCommand('rename', 12n, { label: 'North House' })).toEqual({ type: 'label_cell', args: { cellId: 12n, label: 'North House' } });
    expect(mapCellActionCommand('report', 12n)).toEqual({ type: 'open_person_report', cellId: 12n });
    expect(mapCellActionCommand('rename', 12n, { label: '   ' })).toBeUndefined();
  });
});
