import { useMemo, useState } from 'react';
import { useBoard } from '../data/LiveSource';
import { rankSurvivors } from '../model/ranking';
import { breathingLabel, survivorStatusLabel } from '../model/labels';
import { enumTagToContract } from '../stdb/enums';
import { timestampToMs, formatDuration } from '../stdb/time';
import { StatusChip } from './StatusChip';

type ListFilter = 'all' | 'immediate' | 'unattended' | 'duplicates' | 'not-seen';

export function SurvivorList({ selectedId, onSelect }: { selectedId: bigint | null; onSelect: (id: bigint) => void }) {
  const board = useBoard();
  const [filter, setFilter] = useState<ListFilter>('all');
  const ranked = useMemo(() => board.site ? rankSurvivors(board.survivors, board.site.id) : [], [board.survivors, board.site]);
  const visible = ranked.filter((survivor) => {
    if (filter === 'immediate') return enumTagToContract(survivor.criticalLevel) === 'immediate';
    if (filter === 'unattended') return enumTagToContract(survivor.criticalLevel) === 'immediate' && enumTagToContract(survivor.status) === 'unassigned';
    if (filter === 'duplicates') return survivor.possibleDuplicateOf !== 0n;
    if (filter === 'not-seen') return enumTagToContract(survivor.breathing) === 'not_detected';
    return true;
  });
  const top = visible.slice(0, 40);

  return (
    <section className="panel survivor-list-panel" aria-label="Ranked survivors">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">TRIAGE QUEUE</p>
          <h2>Survivors <span className="count-pill">{ranked.length}</span></h2>
        </div>
        <span className="panel-hint">Ranked by urgency</span>
      </div>
      <div className="filter-row" role="group" aria-label="Filter survivors">
        {([
          ['all', 'All'], ['immediate', 'Immediate'], ['unattended', 'Unattended'], ['duplicates', 'Possible duplicates'], ['not-seen', 'Not breathing seen'],
        ] as const).map(([value, label]) => (
          <button key={value} className={`filter-chip ${filter === value ? 'selected' : ''}`} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      <div className="survivor-list">
        {top.map((survivor, index) => {
          const selected = selectedId === survivor.id;
          const age = Math.max(0, board.now - timestampToMs(survivor.createdAt));
          const firstReason = survivor.scoreReasons[0] ?? 'Score pending';
          return (
            <button key={survivor.id.toString()} className={`survivor-row ${selected ? 'selected' : ''} ${enumTagToContract(survivor.breathing) === 'not_detected' ? 'breathing-urgent' : ''}`} onClick={() => onSelect(survivor.id)}>
              <span className="rank-index">{index + 1}</span>
              <span className="survivor-row-main">
                <span className="survivor-row-firstline">
                  <StatusChip value={survivor.criticalLevel} />
                  <strong className="survivor-score">{Math.round(survivor.criticalScore)}</strong>
                  <span className="confidence">conf {survivor.scoreConfidence.toFixed(2)}</span>
                  {survivor.possibleDuplicateOf !== 0n && <span className="duplicate-chip">?= #{survivor.possibleDuplicateOf.toString()}</span>}
                </span>
                <span className="survivor-row-secondline">
                  <strong>{survivor.houseLabel ?? 'No house label'}</strong>
                  <span>{survivorStatusLabel(survivor.status)}</span>
                  <span>{breathingLabel(enumTagToContract(survivor.breathing), survivor.breathingRateBpm ?? null, survivor.breathingConfidence)}</span>
                  <span>{firstReason}</span>
                  {enumTagToContract(survivor.status) === 'unassigned' && <span>unattended {formatDuration(age)}</span>}
                </span>
              </span>
            </button>
          );
        })}
        {visible.length === 0 && <p className="empty-state">No survivors match this filter.</p>}
      </div>
      {visible.length > top.length && <footer className="list-footer">{visible.length - top.length} more survivors</footer>}
    </section>
  );
}
