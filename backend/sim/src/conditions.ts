import type { DemoSiteConfig } from './config.ts';
import type { SimActor } from './pool.ts';
import { getSimulatorStatus } from './status.ts';
import type { TimelineStep } from './timeline.ts';

const OPEN_MISSION = new Set(['Proposed', 'Queued', 'Leased', 'Active']);

export function makeCondition(step: TimelineStep, sim: SimActor, config: DemoSiteConfig): () => boolean {
  const db = sim.connection.db;
  const cellIdFor = (house: string) => Array.from(db.searchCell.iter()).find((row) => row.label === house)?.id;
  const identitiesFor = (key: string) => rescuerIdentities(sim, config, key);
  const maxId = (rows: Iterable<{ id: bigint }>) => { let max = 0n; for (const row of rows) if (row.id > max) max = row.id; return max; };
  switch (step.await) {
    case 'survivor_in':
      return () => Array.from(db.survivor.iter()).some((row) => row.houseLabel === step.house && row.status.tag !== 'Resolved');
    case 'assignment_for': {
      const wanted = step.status ? pascal(step.status) : undefined;
      return () => {
        const identities = identitiesFor(step.rescuer!);
        return Array.from(db.assignment.iter()).some((row) => identities.has(hex(row.rescuerIdentity)) && (wanted ? row.status.tag === wanted : row.status.tag === 'Proposed' || row.status.tag === 'Active'));
      };
    }
    case 'released': {
      const before = new Set(Array.from(db.assignment.iter()).filter((row) => row.status.tag === 'Released').map((row) => row.id));
      return () => {
        const identities = identitiesFor(step.rescuer!);
        return Array.from(db.assignment.iter()).some((row) => row.status.tag === 'Released' && !before.has(row.id) && identities.has(hex(row.rescuerIdentity)));
      };
    }
    case 'person_report': {
      const after = maxId(db.personReport.iter());
      return () => {
        const cellId = cellIdFor(step.house!);
        return Array.from(db.personReport.iter()).some((row) => row.id > after && row.cellId === cellId);
      };
    }
    case 'mission_for': {
      const wanted = step.status ? pascal(step.status) : undefined;
      return () => {
        const cellId = cellIdFor(step.house!);
        return Array.from(db.mission.iter()).some((row) => cellId !== undefined && row.targetCellIds.includes(cellId) && (wanted ? row.status.tag === wanted : OPEN_MISSION.has(row.status.tag)));
      };
    }
    case 'watchdog_fallback': {
      const after = maxId(db.eventLog.iter());
      return () => Array.from(db.eventLog.iter()).some((row) => row.id > after && row.kind === 'agent_watchdog_fallback');
    }
    case 'audit_flag': {
      const after = maxId(db.auditFlag.iter());
      const wanted = step.kind ? pascal(step.kind) : undefined;
      return () => Array.from(db.auditFlag.iter()).some((row) => row.id > after && (!wanted || row.kind.tag === wanted));
    }
    case 'status': {
      const limit = Number(step.status ?? 0);
      return () => getSimulatorStatus(sim).headline <= limit;
    }
    default:
      throw new Error(`Condition ${step.await} is not polled from the subscription`);
  }
}

// The sim registers rescuers by display name ("R1"), but the glasses service registers
// the real rescuer by its key ("cayden"), so match a configured rescuer by either, ignoring case.
export function rescuerIdentities(sim: SimActor, config: DemoSiteConfig, key: string): Set<string> {
  const wanted = key.toLowerCase();
  const configured = config.rescuers.find((item) => item.key.toLowerCase() === wanted || item.name.toLowerCase() === wanted);
  const names = new Set([wanted, ...(configured ? [configured.key.toLowerCase(), configured.name.toLowerCase()] : [])]);
  return new Set(Array.from(sim.connection.db.participant.iter())
    .filter((row) => row.role.tag === 'Rescuer' && names.has(row.name.toLowerCase()))
    .map((row) => hex(row.identity)));
}

export function pascal(value: string): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function hex(identity: { toHexString(): string }): string { return identity.toHexString().toLowerCase().replace(/^0x/, ''); }
