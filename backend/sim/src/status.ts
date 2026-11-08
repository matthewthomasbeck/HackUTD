import { countUnattendedImmediate } from '../../../frontend/dashboard/src/model/headline.ts';
import type { SimActor } from './pool.ts';

export interface SimulatorStatus {
  site: string;
  demoMode: boolean;
  headline: number;
  survivorsByLevel: Record<string, number>;
  survivorsByStatus: Record<string, number>;
  cellsByStatus: Record<string, number>;
  assignments: Record<string, number>;
  agentsOnline: number;
  robotsOnline: number;
  activeRun?: string;
}

export function getSimulatorStatus(actor: SimActor, now = Date.now()): SimulatorStatus {
  const sites = Array.from(actor.connection.db.site.iter()).sort((a, b) => Number(b.id - a.id));
  const site = sites[0];
  if (!site) throw new Error('No site exists. Run setup first.');
  const survivors = Array.from(actor.connection.db.survivor.iter()).filter((row) => row.siteId === site.id);
  const events = Array.from(actor.connection.db.eventLog.iter());
  const timers = Array.from(actor.connection.db.escalationTimer.iter());
  const headline = countUnattendedImmediate(survivors, timers, now, site.id, events);
  const survivorsByLevel = countBy(survivors, (row) => tag(row.criticalLevel));
  const survivorsByStatus = countBy(survivors, (row) => tag(row.status));
  const cellsByStatus = countBy(Array.from(actor.connection.db.searchCell.iter()).filter((row) => row.siteId === site.id), (row) => tag(row.status));
  const assignments = countBy(Array.from(actor.connection.db.assignment.iter()), (row) => tag(row.status));
  const participantRows = Array.from(actor.connection.db.participant.iter());
  const activeRun = Array.from(actor.connection.db.run.iter()).find((row) => row.endedAt === undefined);
  return {
    site: site.name,
    demoMode: site.demoMode,
    headline,
    survivorsByLevel,
    survivorsByStatus,
    cellsByStatus,
    assignments,
    agentsOnline: participantRows.filter((row) => ['orchestrator', 'comms_agent', 'auditor'].includes(row.name) && row.online).length,
    robotsOnline: Array.from(actor.connection.db.robot.iter()).filter((row) => row.online).length,
    ...(activeRun ? { activeRun: activeRun.name } : {}),
  };
}

export function formatSimulatorStatus(status: SimulatorStatus): string {
  const byLevel = Object.entries(status.survivorsByLevel).map(([key, value]) => `${key}=${value}`).join(' ');
  const byStatus = Object.entries(status.survivorsByStatus).map(([key, value]) => `${key}=${value}`).join(' ');
  const cellStatus = Object.entries(status.cellsByStatus).map(([key, value]) => `${key}=${value}`).join(' ');
  const assignments = Object.entries(status.assignments).map(([key, value]) => `${key}=${value}`).join(' ');
  return [
    `Site: ${status.site} | ${status.demoMode ? 'DEMO MODE' : 'LIVE MODE'}`,
    `Critical survivors unattended over 60 s: ${status.headline}`,
    `Survivors by level: ${byLevel || 'none'}`,
    `Survivors by status: ${byStatus || 'none'}`,
    `Cells by status: ${cellStatus || 'none'}`,
    `Assignments: ${assignments || 'none'}`,
    `Agents online: ${status.agentsOnline} | Robots online: ${status.robotsOnline}`,
    `Active run: ${status.activeRun ?? 'none'}`,
  ].join('\n');
}

function countBy<T>(items: readonly T[], keyFor: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function tag(value: { tag: string }): string { return value.tag.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); }
