import { Identity } from 'spacetimedb';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BoardState } from './BoardData';
import { BoardContext, useBoard } from './LiveSource';
import type { DashboardConfig } from '../stdb/connection';
import { timestampToMs } from '../stdb/time';
import { buildHistory, type ReplayInputRow, type ReplayHistoryItem } from '../replay/history';
import { buildReplayTimeline, foldReplayAt } from '../replay/fold';
import { advanceReplayTime } from '../replay/player';

interface ReplayControls {
  currentMs: number;
  startMs: number;
  endMs: number;
  speed: 1 | 4 | 16;
  isPlaying: boolean;
  history: readonly ReplayHistoryItem[];
  malformedCount: number;
  seek: (timeMs: number) => void;
  setSpeed: (speed: 1 | 4 | 16) => void;
  togglePlaying: () => void;
  backToLive: () => void;
}

const ReplayContext = createContext<ReplayControls | null>(null);

export function useReplayControls() {
  return useContext(ReplayContext);
}

export function ReplaySource({ config, children }: { config: DashboardConfig; children: ReactNode }) {
  const live = useBoard();
  const stableLive = useMemo(() => live, [live.mode, live.site, live.run, live.runs, live.allRuns, live.sites, live.survivors, live.detections, live.missions, live.assignments, live.cells, live.robots, live.devices, live.participants, live.briefings, live.agentActions, live.agentTasks, live.auditFlags, live.personReports, live.events, live.timers.leases, live.timers.heartbeats, live.timers.escalations, live.timers.agentWatchdogs, live.ready, live.registrationError]);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const runParam = config.run;
  const selectedRun = useMemo(() => {
    if (runParam) {
      try { return stableLive.allRuns.find((run) => run.id === BigInt(runParam)) ?? null; } catch { return null; }
    }
    return stableLive.run ?? stableLive.allRuns.slice().sort((a, b) => timestampToMs(b.startedAt) - timestampToMs(a.startedAt))[0] ?? null;
  }, [runParam, stableLive.allRuns, stableLive.run]);
  const startMs = selectedRun ? timestampToMs(selectedRun.startedAt) : 0;
  const selectedEvents = useMemo(() => selectedRun ? stableLive.events.filter((row) => row.runId === selectedRun.id) : [], [stableLive.events, selectedRun]);
  const history = useMemo(() => buildHistory(selectedRun ? collectHistoryRows(stableLive, selectedRun.id, selectedEvents) : []), [stableLive, selectedRun, selectedEvents]);
  const newestMs = history.reduce((latest, item) => Math.max(latest, item.createdAtMs), startMs);
  const endMs = selectedRun?.endedAt ? timestampToMs(selectedRun.endedAt) : newestMs;
  const timeline = useMemo(() => buildReplayTimeline(history, startMs, Math.max(startMs, endMs)), [history, startMs, endMs]);
  const initialTime = useMemo(() => {
    const raw = params.get('t');
    if (!raw) return startMs;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? startMs + Math.max(0, numeric) : startMs;
  }, [params, startMs]);
  const [currentMs, setCurrentMs] = useState(initialTime);
  const [speed, setSpeedState] = useState<1 | 4 | 16>(() => parseSpeed(params.get('speed')));
  const [isPlaying, setIsPlaying] = useState(false);
  const currentMsRef = useRef(initialTime);
  currentMsRef.current = currentMs;

  useEffect(() => setCurrentMs((value) => clamp(value < startMs ? initialTime : value, startMs, endMs)), [startMs, endMs, initialTime]);
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let lastTime = 0;
    const tick = (now: number) => {
      if (lastTime) {
        const next = advanceReplayTime(currentMsRef.current, now - lastTime, speed, endMs);
        currentMsRef.current = next;
        setCurrentMs(next);
        if (next >= endMs) { setIsPlaying(false); return; }
      }
      lastTime = now;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [isPlaying, speed, endMs]);

  const seek = useCallback((timeMs: number) => {
    const next = clamp(timeMs, startMs, endMs);
    currentMsRef.current = next;
    setCurrentMs(next);
    const url = new URL(window.location.href);
    url.searchParams.set('t', String(Math.round(next - startMs)));
    window.history.replaceState(null, '', url);
  }, [startMs, endMs]);
  const setSpeed = useCallback((value: 1 | 4 | 16) => {
    setSpeedState(value);
    const url = new URL(window.location.href);
    url.searchParams.set('speed', String(value));
    window.history.replaceState(null, '', url);
  }, []);
  const togglePlaying = useCallback(() => setIsPlaying((value) => !value), []);
  const backToLive = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.delete('run');
    url.searchParams.delete('t');
    url.searchParams.delete('speed');
    window.location.assign(url.toString());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
      if (event.code === 'Space') { event.preventDefault(); setIsPlaying((value) => !value); }
      if (event.key === '[') seek(currentMsRef.current - 10_000);
      if (event.key === ']') seek(currentMsRef.current + 10_000);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [seek]);

  const folded = useMemo(() => foldReplayAt(timeline, currentMs), [timeline, currentMs]);
  const replay = useMemo(() => boardAtTime(stableLive, selectedRun, folded, history, currentMs), [stableLive, selectedRun, folded, history, currentMs]);
  const controls: ReplayControls = { currentMs, startMs, endMs, speed, isPlaying, history, malformedCount: folded.malformedCount, seek, setSpeed, togglePlaying, backToLive };

  const replayMode = config.view === 'replay';
  return <ReplayContext.Provider value={replayMode ? controls : null}><BoardContext.Provider value={replayMode ? replay : live}>{children}</BoardContext.Provider></ReplayContext.Provider>;
}

function collectHistoryRows(board: BoardState, runId: bigint, events: BoardState['events']): ReplayInputRow[] {
  const rows: ReplayInputRow[] = events.map((row) => ({ source: 'event_log', id: row.id, kind: row.kind, entity: row.entity, entityId: row.entityId, message: row.message, payloadJson: row.payloadJson, createdAtMs: timestampToMs(row.createdAt), row }));
  for (const row of board.agentActions.filter((item) => item.runId === runId)) rows.push({ source: 'agent_action', id: row.id, kind: 'agent_action', createdAtMs: timestampToMs(row.createdAt), row });
  for (const row of board.detections.filter((item) => item.runId === runId)) rows.push({ source: 'detection', id: row.id, kind: 'detection', createdAtMs: timestampToMs(row.createdAt), row });
  for (const row of board.briefings.filter((item) => item.runId === runId)) rows.push({ source: 'briefing', id: row.id, kind: 'briefing', createdAtMs: timestampToMs(row.createdAt), row });
  for (const row of board.personReports.filter((item) => item.runId === runId)) rows.push({ source: 'person_report', id: row.id, kind: 'person_report', createdAtMs: timestampToMs(row.createdAt), row });
  return rows;
}

function boardAtTime(live: BoardState, run: BoardState['run'], folded: ReturnType<typeof foldReplayAt>, history: readonly ReplayHistoryItem[], timeMs: number): BoardState {
  if (!run) return { ...live, mode: 'replay', now: timeMs, site: null, run: null, survivors: [], detections: [], missions: [], assignments: [], cells: [], robots: [], devices: [], participants: [], briefings: [], agentActions: [], agentTasks: [], auditFlags: [], personReports: [], events: [], timers: { leases: [], heartbeats: [], escalations: [], agentWatchdogs: [] } };
  const entityRows = (name: string) => Array.from(folded.entities.get(name)?.values() ?? []);
  const cellsById = new Map(entityRows('search_cell').map((row) => [String(row.id), typedRow(row, 'search_cell')]));
  const cells = live.cells.filter((cell) => cell.siteId === run.siteId && cellsById.has(cell.id.toString())).map((cell) => ({ ...cellsById.get(cell.id.toString()), lat: cell.lat, lon: cell.lon, sizeM: cell.sizeM, label: cell.label, siteId: cell.siteId }));
  const replayCells = cells;
  const mapRows = (name: string) => entityRows(name).map((row) => typedRow(row, name));
  const actionRows = rowsAtTime(live.agentActions, run.id, timeMs);
  const detectionRows = rowsAtTime(live.detections, run.id, timeMs);
  const briefingRows = rowsAtTime(live.briefings, run.id, timeMs);
  const personReportRows = rowsAtTime(live.personReports, run.id, timeMs);
  const replayEvents = history.filter((item) => item.source === 'event_log' && item.createdAtMs <= timeMs).map((item) => item.row).filter(Boolean) as BoardState['events'];
  const replayRobots = mapRows('robot').map((raw) => {
    const row = raw as Record<string, unknown>;
    return { ...row, name: `${String(row.name ?? row.robotId)} · position not recorded in replay` };
  });
  const sites = live.sites;
  return {
    ...live,
    mode: 'replay', now: timeMs, site: sites.find((site) => site.id === run.siteId) ?? live.site, run,
    survivors: mapRows('survivor') as unknown as BoardState['survivors'], detections: detectionRows, missions: mapRows('mission') as unknown as BoardState['missions'], assignments: mapRows('assignment') as unknown as BoardState['assignments'],
    cells: replayCells as unknown as BoardState['cells'], robots: replayRobots as unknown as BoardState['robots'], devices: mapRows('device_status') as unknown as BoardState['devices'], participants: [],
    briefings: briefingRows, agentActions: actionRows, agentTasks: mapRows('agent_task').filter((row) => BigInt(String(row.runId)) === run.id) as unknown as BoardState['agentTasks'], auditFlags: mapRows('audit_flag').filter((row) => BigInt(String(row.runId)) === run.id) as unknown as BoardState['auditFlags'],
    personReports: personReportRows, events: replayEvents, timers: { leases: [], heartbeats: [], escalations: [], agentWatchdogs: [] },
  };
}

function rowsAtTime<T extends { runId: bigint; createdAt: unknown }>(rows: readonly T[], runId: bigint, timeMs: number): T[] {
  return rows.filter((row) => row.runId === runId && timestampToMs(row.createdAt as Parameters<typeof timestampToMs>[0]) <= timeMs);
}

function typedRow(row: Record<string, unknown>, entity: string): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) normalized[snakeToCamel(key)] = typedValue(snakeToCamel(key), value, entity);
  return normalized;
}

function typedValue(key: string, value: unknown, entity: string): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return key === 'targetCellIds' ? value.map((item) => BigInt(String(item))) : value;
  if (typeof value === 'object' && value) return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [snakeToCamel(childKey), typedValue(snakeToCamel(childKey), child, entity)]));
  if (typeof value !== 'string') return value;
  if (key === 'identity' || key === 'rescuerIdentity') { try { return Identity.fromString(value); } catch { return Identity.zero(); } }
  if (key === 'id' || key.endsWith('Id') && key !== 'robotId' && key !== 'identity') { try { return BigInt(value); } catch { return value; } }
  if (key.endsWith('At') || key === 'since' || key === 'dueAt' || key === 'lastSeen' || key === 'lastHeartbeat') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? { microsSinceUnixEpoch: BigInt(parsed) * 1_000n } : undefined;
  }
  if (['status', 'resolution', 'criticalLevel', 'breathing', 'priority', 'source', 'role', 'state', 'terrainClass', 'terrainAction', 'releaseCause', 'toAgent'].includes(key) || key === 'kind' && ['mission', 'audit_flag', 'briefing', 'person_report', 'detection'].includes(entity)) return { tag: pascalCase(value) };
  return value;
}

function snakeToCamel(value: string) { return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()); }
function pascalCase(value: string) { return value.split(/[_\s-]+/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(''); }
function parseSpeed(value: string | null): 1 | 4 | 16 { return value === '4' ? 4 : value === '16' ? 16 : 1; }
function clamp(value: number, low: number, high: number) { return Math.max(low, Math.min(high, value)); }
