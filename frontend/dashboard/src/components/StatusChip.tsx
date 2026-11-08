import { enumTagToContract } from '../stdb/enums';

const levelClass: Record<string, string> = {
  immediate: 'status-chip immediate',
  delayed: 'status-chip delayed',
  minor: 'status-chip minor',
  unknown: 'status-chip unknown',
  resolved: 'status-chip resolved',
};

const levelLabel: Record<string, string> = {
  immediate: 'IMMEDIATE',
  delayed: 'DELAYED',
  minor: 'MINOR',
  unknown: 'NOT SCORED',
  resolved: 'RESOLVED',
};

export function StatusChip({ value }: { value: string | { tag: string } }) {
  const tag = enumTagToContract(value);
  return <span className={levelClass[tag] ?? 'status-chip neutral'}>{levelLabel[tag] ?? tag.replaceAll('_', ' ').toUpperCase()}</span>;
}
