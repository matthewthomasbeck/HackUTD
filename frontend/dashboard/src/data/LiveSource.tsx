import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from '@bindings/index';
import type { BoardState } from './BoardData';
import type { DashboardConfig } from '../stdb/connection';

export const BoardContext = createContext<BoardState | null>(null);

export function LiveSource({ children, config }: { children: ReactNode; config: DashboardConfig }) {
  const [now, setNow] = useState(Date.now());
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const registrationAttempt = useRef<string | null>(null);
  const connectionState = useSpacetimeDB();
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  const [participants, participantsReady] = useTable(tables.participant);
  const [sites, sitesReady] = useTable(tables.site);
  const [cells, cellsReady] = useTable(tables.searchCell);
  const [robots, robotsReady] = useTable(tables.robot);
  const [devices, devicesReady] = useTable(tables.deviceStatus);
  const [missions, missionsReady] = useTable(tables.mission);
  const [detections, detectionsReady] = useTable(tables.detection);
  const [survivors, survivorsReady] = useTable(tables.survivor);
  const [assignments, assignmentsReady] = useTable(tables.assignment);
  const [briefings, briefingsReady] = useTable(tables.briefing);
  const [agentActions, agentActionsReady] = useTable(tables.agentAction);
  const [events, eventsReady] = useTable(tables.eventLog);
  const [runs, runsReady] = useTable(tables.run);
  const [auditFlags, auditFlagsReady] = useTable(tables.auditFlag);
  const [personReports, personReportsReady] = useTable(tables.personReport);
  const [agentTasks, agentTasksReady] = useTable(tables.agentTask);
  const [leases, leasesReady] = useTable(tables.leaseTimer);
  const [heartbeats, heartbeatsReady] = useTable(tables.heartbeatTimer);
  const [escalations, escalationsReady] = useTable(tables.escalationTimer);
  const [agentWatchdogs, agentWatchdogsReady] = useTable(tables.agentWatchdog);

  useEffect(() => {
    if (config.view === 'replay') return;
    const identity = connectionState.identity;
    const identityHex = identity?.toHexString();
    if (!participantsReady || !identityHex || participants.some((participant) => participant.identity.toHexString() === identityHex)) return;
    if (registrationAttempt.current === identityHex) return;
    const connection = connectionState.getConnection() as DbConnection | null;
    if (!connection) return;
    registrationAttempt.current = identityHex;
    const role: { tag: 'Commander' } | { tag: 'Coordinator' } = config.role === 'commander'
      ? { tag: 'Commander' }
      : { tag: 'Coordinator' };
    connection.reducers.registerParticipant({ name: `${config.role}-${config.screen}`, role })
      .then(() => setRegistrationError(null))
      .catch((error: unknown) => setRegistrationError(error instanceof Error ? error.message : String(error)));
  }, [connectionState.identity, connectionState.getConnection, config.role, config.screen, config.view, participantsReady, participants]);

  const state = useMemo<BoardState>(() => {
    const site = sites.slice().sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch))[0] ?? null;
    const siteRuns = site ? runs.filter((run) => run.siteId === site.id) : [];
    const run = siteRuns
      .filter((candidate) => candidate.endedAt === undefined || candidate.endedAt === null)
      .slice()
      .sort((a, b) => Number(b.startedAt.microsSinceUnixEpoch - a.startedAt.microsSinceUnixEpoch))[0] ?? null;
    const ready = [participantsReady, sitesReady, cellsReady, robotsReady, devicesReady, missionsReady,
      detectionsReady, survivorsReady, assignmentsReady, briefingsReady, agentActionsReady, eventsReady,
      runsReady, auditFlagsReady, personReportsReady, agentTasksReady, leasesReady, heartbeatsReady,
      escalationsReady, agentWatchdogsReady].every(Boolean);

    return {
      mode: 'live',
      now,
      site,
      run,
      runs: siteRuns,
      allRuns: runs,
      sites,
      survivors,
      detections,
      missions,
      assignments,
      cells,
      robots,
      devices,
      participants,
      briefings,
      agentActions,
      agentTasks,
      auditFlags,
      personReports,
      events,
      timers: { leases, heartbeats, escalations, agentWatchdogs },
      ready,
      registrationError,
    };
  }, [now, registrationError, participants, participantsReady, sites, sitesReady, cells, cellsReady, robots, robotsReady, devices, devicesReady,
    missions, missionsReady, detections, detectionsReady, survivors, survivorsReady, assignments, assignmentsReady,
    briefings, briefingsReady, agentActions, agentActionsReady, events, eventsReady, runs, runsReady, auditFlags,
    auditFlagsReady, personReports, personReportsReady, agentTasks, agentTasksReady, leases, leasesReady,
    heartbeats, heartbeatsReady, escalations, escalationsReady, agentWatchdogs, agentWatchdogsReady]);

  return <BoardContext.Provider value={state}>{children}</BoardContext.Provider>;
}

export function useBoard(): BoardState {
  const board = useContext(BoardContext);
  if (!board) throw new Error('useBoard must be used inside LiveSource or ReplaySource');
  return board;
}
