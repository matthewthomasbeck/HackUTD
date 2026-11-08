import { useEffect, useMemo, useState } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import { DbConnection } from '@bindings/index';
import type { PersonReportKind, PersonReportSource, Resolution } from '@bindings/types';
import { AgentsPanel } from './components/AgentsPanel';
import { AssignmentsPanel } from './components/AssignmentsPanel';
import { BuildingsPanel, type PersonReportInput } from './components/BuildingsPanel';
import { MapOverview, type CellPopupAction } from './components/MapOverview';
import { MissionQueuePanel } from './components/MissionQueuePanel';
import { PipelineBand } from './components/PipelineBand';
import { SurvivorDetail } from './components/SurvivorDetail';
import { SurvivorList } from './components/SurvivorList';
import { TimersPanel } from './components/TimersPanel';
import { TopBar } from './components/TopBar';
import { TransportBar } from './components/TransportBar';
import { useBoard } from './data/LiveSource';
import { useReplayControls } from './data/ReplaySource';
import { enumTagToContract } from './stdb/enums';
import { timestampToMs } from './stdb/time';
import { formatReplayTime } from './replay/player';
import { mapCellActionCommand } from './model/mapActions';
import type { DashboardConfig } from './stdb/connection';

type ResolutionKey = 'rescued' | 'handed_off' | 'false_alarm' | 'duplicate';
type Section = 'priority' | 'stats' | 'map' | 'agents' | 'assignments' | 'timers' | 'buildings' | 'events';
function formatReplayElapsed(time: number, start: number) { return formatReplayTime(time - start); }
const resolutionVariants: Record<ResolutionKey, Resolution> = {
  rescued: { tag: 'Rescued' }, handed_off: { tag: 'HandedOff' }, false_alarm: { tag: 'FalseAlarm' }, duplicate: { tag: 'Duplicate' },
};
const reportKinds: Record<PersonReportInput['kind'], PersonReportKind> = { missing: { tag: 'Missing' }, safe: { tag: 'Safe' } };
const reportSources: Record<PersonReportInput['source'], PersonReportSource> = { family: { tag: 'Family' }, neighbor: { tag: 'Neighbor' }, hotline: { tag: 'Hotline' }, coordinator: { tag: 'Coordinator' } };
const sectionLabels: Array<{ id: Section; label: string }> = [
  { id: 'priority', label: 'Priority' }, { id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' },
  { id: 'assignments', label: 'Assignments' }, { id: 'agents', label: 'Agents' }, { id: 'timers', label: 'Timers' }, { id: 'buildings', label: 'Buildings' }, { id: 'events', label: 'Events' },
];

function initialSection(view: string): Section {
  const focus = new URLSearchParams(window.location.search).get('focus');
  if (focus === 'canvas') return 'stats';
  if (focus === 'map') return 'map';
  if (focus === 'agents' || focus === 'tasks' || focus === 'chain') return 'agents';
  if (focus === 'buildings') return 'buildings';
  if (focus === 'events') return 'events';
  if (view === 'agents') return 'agents';
  return 'priority';
}

export default function App({ config }: { config: DashboardConfig }) {
  const connectionState = useSpacetimeDB();
  const board = useBoard();
  const replay = useReplayControls();
  const identityHex = connectionState.identity?.toHexString();
  const [selectedId, setSelectedId] = useState<bigint | null>(() => {
    try { const raw = new URLSearchParams(window.location.search).get('survivor'); return raw ? BigInt(raw) : null; } catch { return null; }
  });
  const [agentsFullScreen, setAgentsFullScreen] = useState(config.view === 'agents' || ['agents', 'tasks', 'chain'].includes(new URLSearchParams(window.location.search).get('focus') ?? ''));
  const [section, setSection] = useState<Section>(() => initialSection(config.view));
  const [selectedBuildingCellId, setSelectedBuildingCellId] = useState<bigint | null>(null);
  const [toast, setToast] = useState('');
  const connection = connectionState.getConnection() as DbConnection | null;
  const isRegistered = config.view === 'replay' || Boolean(identityHex && board.participants.some((person) => person.identity.toHexString() === identityHex));
  const isReadOnly = config.view === 'replay' || Boolean(board.registrationError) || !isRegistered;
  const siteCells = board.cells.filter((row) => row.siteId === board.site?.id);
  const siteSurvivors = board.survivors.filter((row) => row.siteId === board.site?.id);
  const ranked = useMemo(() => board.site
    ? board.survivors.filter((row) => row.siteId === board.site?.id && enumTagToContract(row.status) !== 'resolved')
      .sort((a, b) => b.criticalScore - a.criticalScore || Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch))
    : [], [board.site, board.survivors]);

  useEffect(() => { if ((!selectedId || !ranked.some((row) => row.id === selectedId)) && ranked[0]) setSelectedId(ranked[0].id); }, [selectedId, ranked]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key.toLowerCase() === 'a' && !event.metaKey && !event.ctrlKey && !event.altKey) setAgentsFullScreen(true);
      if (event.key === 'Escape') setAgentsFullScreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 6_000); };
  const resolveSurvivor = async (survivorId: bigint, resolution: ResolutionKey, note: string) => {
    if (!connection) throw new Error('No active database connection.');
    try { await connection.reducers.resolveSurvivor({ survivorId, resolution: resolutionVariants[resolution], note }); showToast(`Survivor #${survivorId.toString()} resolved as ${resolution.replaceAll('_', ' ')}.`); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); showToast(message); throw error; }
  };
  const assignSurvivor = async (survivorId: bigint, identity: string) => {
    if (!connection) throw new Error('No active database connection.');
    const rescuer = board.participants.find((person) => person.identity.toHexString() === identity);
    if (!rescuer) throw new Error('The rescuer is no longer online.');
    try { await connection.reducers.proposeAssignment({ survivorId, rescuerIdentity: rescuer.identity, reason: 'coordinator assignment' }); showToast(`Proposed survivor #${survivorId.toString()} to ${rescuer.name}. They must acknowledge on the glasses.`); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); showToast(message); throw error; }
  };
  const reportPerson = async (input: PersonReportInput) => {
    if (!connection) throw new Error('No active database connection.');
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 500) throw new Error('Count must be a whole number from 1 to 500.');
    await connection.reducers.reportPerson({ cellId: input.cellId, kind: reportKinds[input.kind], count: input.count, nameOrUnit: input.nameOrUnit.trim() || undefined, note: input.note.trim(), source: reportSources[input.source] });
    showToast(`Person report added to ${board.cells.find((cell) => cell.id === input.cellId)?.label ?? 'cell'}.`);
  };
  const startRun = async () => {
    if (!connection || !board.site) return;
    try { await connection.reducers.startRun({ siteId: board.site.id, name: `${board.site.name} · ${new Date().toLocaleTimeString()}` }); showToast('Run recording started.'); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  const endRun = async () => {
    if (!connection || !board.run) return;
    try { await connection.reducers.endRun({ runId: board.run.id, notes: '' }); showToast(`Run ${board.run.name} ended.`); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  const syncTest = async (text: string) => {
    if (!connection) return;
    try { await connection.reducers.postBriefing({ audience: 'coordinators', text, priority: { tag: 'Info' }, survivorId: undefined, kind: undefined }); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  const approveMission = async (missionId: bigint) => {
    if (!connection) return;
    try { await connection.reducers.approveMission({ missionId }); showToast(`Mission #${missionId} approved.`); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  const cancelMission = async (missionId: bigint) => {
    if (!connection) return;
    try { await connection.reducers.cancelMission({ missionId }); showToast(`Mission #${missionId} cancelled.`); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };
  const onCellAction = async (action: CellPopupAction, cellId: bigint, label?: string) => {
    if (!connection || isReadOnly) return;
    try {
      const robot = action === 'send' ? board.robots.find((row) => row.online) : undefined;
      const command = mapCellActionCommand(action, cellId, { robotId: robot?.robotId, label });
      if (!command && action === 'send') { showToast('No robot is online to search this cell.'); return; }
      if (!command) return;
      if (command.type === 'create_mission') {
        await connection.reducers.createMission(command.args);
        showToast(`Search mission queued for ${board.cells.find((cell) => cell.id === cellId)?.label ?? 'cell'}.`);
      } else if (command.type === 'mark_cell') {
        await connection.reducers.markCell(command.args);
        showToast(`Cell marked ${action === 'searched' ? 'searched' : 'partially searched'}.`);
      } else if (command.type === 'label_cell') {
        await connection.reducers.labelCell(command.args);
        showToast(`Cell renamed to ${command.args.label}.`);
      } else if (command.type === 'open_person_report') {
        setSelectedBuildingCellId(cellId);
        setSection('buildings');
        showToast(`Add a person report for ${board.cells.find((cell) => cell.id === cellId)?.label ?? 'cell'}.`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    }
  };

  const currentSection = section === 'agents' ? <AgentsPanel selectedId={selectedId} isFullScreen={false} onSelectSurvivor={setSelectedId} />
    : section === 'map' ? <MapOverview readOnly={isReadOnly} onCellAction={onCellAction} onSelectSurvivor={setSelectedId} onOpenBuildings={(cellId) => { setSelectedBuildingCellId(cellId); setSection('buildings'); showToast(`Showing reports for cell #${cellId}.`); }} />
      : section === 'assignments' ? <><MissionQueuePanel readOnly={isReadOnly} onApprove={approveMission} onCancel={cancelMission} /><AssignmentsPanel /></>
        : section === 'timers' ? <TimersPanel />
          : section === 'buildings' ? <BuildingsPanel readOnly={isReadOnly} onReport={reportPerson} selectedCellId={selectedBuildingCellId} />
            : section === 'events' ? <section className="panel detail-tab-panel"><div className="panel-heading"><div><p className="eyebrow">RUN HISTORY</p><h2>Events & briefings</h2></div><span className="count-pill">{board.events.length} events</span></div>
              <div className="events-feed">{board.briefings.slice().sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt)).slice(0, 20).map((row) => <article key={`briefing-${row.id}`}><span>BRIEFING · {enumTagToContract(row.priority).toUpperCase()}</span><strong>{row.text}</strong><time>{new Date(timestampToMs(row.createdAt)).toLocaleTimeString()}</time></article>)}
                {board.events.slice().sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt)).slice(0, 50).map((row) => <article key={`event-${row.id}`}><span>{row.kind.toUpperCase()} · {row.entity}</span><strong>{row.message}</strong><time>{new Date(timestampToMs(row.createdAt)).toLocaleTimeString()}</time></article>)}</div>
              {board.events.length === 0 && board.briefings.length === 0 && <p className="empty-state">No events have been recorded.</p>}</section>
              : section === 'stats' ? <PipelineBand onOpenAgents={() => { setSection('agents'); setAgentsFullScreen(true); }} /> : null;

  return <main className={`dashboard-app ${config.view === 'replay' ? 'replay-mode' : ''}`}>
    <TopBar config={config} isConnected={connectionState.isActive} identity={identityHex} connectionError={board.registrationError ?? connectionState.connectionError?.message} />
    {board.registrationError && <p className="registration-error" role="alert">Not registered: {board.registrationError}</p>}
    {!isRegistered && !board.registrationError && <p className="registration-notice" role="status">Connecting your {config.role} identity to the live board.</p>}
    {config.view === 'replay' && <p className="replay-notice">REPLAY of {board.run?.name ?? 'selected run'} · {formatReplayElapsed(replay?.currentMs ?? board.now, replay?.startMs ?? board.now)} of {formatReplayElapsed(replay?.endMs ?? board.now, replay?.startMs ?? board.now)} · nothing here changes the database{replay?.malformedCount ? ` · ${replay.malformedCount} events could not be read` : ''}</p>}

    {agentsFullScreen ? <div className="agents-fullscreen-wrap">
      <button className="button secondary return-live" onClick={() => setAgentsFullScreen(false)}>Back to live board</button>
      <AgentsPanel selectedId={selectedId} isFullScreen onSelectSurvivor={setSelectedId} />
    </div> : <>
      <nav className="dashboard-nav" aria-label="Dashboard sections">{sectionLabels.map((item) => <button key={item.id} className={`dashboard-nav-button ${section === item.id ? 'selected' : ''}`} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}{item.id === 'buildings' && <span>{siteCells.filter((cell) => cell.unaccounted > 0).length}</span>}</button>)}</nav>
      {section === 'priority' ? <div className="priority-focus-grid">
        <section className="priority-queue-column" aria-label="Priority survivor queue"><div className="section-heading"><div><p className="eyebrow">URGENT NEEDS FIRST</p><h1>Priority queue</h1></div><p className="panel-hint">Ranked by critical score. Select a person to review evidence and response.</p></div><SurvivorList selectedId={selectedId} onSelect={setSelectedId} /></section>
        <aside className="priority-response-column"><SurvivorDetail selectedId={selectedId} isReadOnly={isReadOnly} onResolve={resolveSurvivor} onAssign={assignSurvivor} />
          <section className="panel live-counts-panel"><div className="panel-heading"><div><p className="eyebrow">INCIDENT STATUS</p><h2>Live counts</h2></div><span className="run-state">LIVE</span></div><dl className="sidebar-counts"><div><dt>Search cells</dt><dd>{siteCells.length}</dd></div><div><dt>People found</dt><dd>{siteSurvivors.length}</dd></div><div><dt>Rescuers online</dt><dd>{board.participants.filter((person) => person.online && enumTagToContract(person.role) === 'rescuer').length}</dd></div><div><dt>Unaccounted</dt><dd>{siteCells.filter((cell) => cell.unaccounted > 0).reduce((sum, cell) => sum + cell.unaccounted, 0)}</dd></div><div><dt>Agents online</dt><dd>{board.participants.filter((person) => person.online && ['agent', 'auditor'].includes(enumTagToContract(person.role))).length}</dd></div></dl></section>
        </aside>
      </div> : <div className="section-focus">
        <section className="center-column">
          <div className="section-heading"><div><p className="eyebrow">LIVE OPERATIONS</p><h1>{sectionLabels.find((item) => item.id === section)?.label}</h1></div></div>
          {currentSection}
        </section>
      </div>}
      <TransportBar readOnly={isReadOnly} view={config.view === 'replay' ? 'replay' : 'live'} onStart={startRun} onEnd={endRun} onSync={syncTest} />
    </>}
    {toast && <div className="toast-message" role="status">{toast}</div>}
  </main>;
}
