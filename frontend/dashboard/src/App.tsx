// UnderDog, the coordinator dashboard: a full-bleed map of the Worthing St block with floating cards
// (who needs help first; the database headline; rescuers and robot; houses) and an Agents page.
// All data comes live from SpacetimeDB through useBoard(); see src/view/derive.ts for what each card shows.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import { DbConnection } from '@bindings/index';
import type { PersonReportKind, PersonReportSource, Resolution as ResolutionValue } from '@bindings/types';
import { AgentsPage } from './components/AgentsPage';
import { AppBar, type Page } from './components/AppBar';
import { CameraView } from './components/CameraView';
import { GlassesPanel } from './components/GlassesPanel';
import { HelpCard, type Resolution } from './components/HelpCard';
import { HousePanel, type HouseAction, type PersonReportInput } from './components/HousePanel';
import { HeadlineCard, HousesCard, MapKey, PeopleCard } from './components/SideCards';
import { SiteMap, type MapLayers, type SiteMapHandle } from './components/SiteMap';
import { TransportBar } from './components/TransportBar';
import { useBoard } from './data/LiveSource';
import { runName } from './model/labels';
import { mapCellActionCommand } from './model/mapActions';
import { enumTagToContract } from './stdb/enums';
import type { DashboardConfig } from './stdb/connection';
import { timestampToMs } from './stdb/time';
import { loadSite, type House, type SiteGeometry } from './site/geometry';
import { buildStreetGraph } from './site/route';
import { DEMO_RESCUER, demoStepLabel, glassesMismatch, runDemo, type DemoStep, type GlassesDemoCommand } from './view/demo';
import {
  agentCards, chainOptions, chainSteps, glassesRescuers, headline, helpRows, houseSummary, mapLayers, onlineRescuers, peopleRows,
  pendingMissions, robotFrames, systemChips, taskTimeline,
} from './view/derive';

const DEMO_HOUSE = { lat: 32.9968745, lon: -96.7704708 }; // 7716 Worthing St, until the site row arrives
// The floating card columns (see .fcol in underdog.css, narrower under 1500 px), so the map frames the block between them.
// Where Camera View finds the glasses heads-up: the glasses fallback page and the glasses service socket.
// Set VITE_GLASSES_PAGE_URL and VITE_GLASSES_WS_URL, or ?glassesPage= and ?glassesWs= on the dashboard URL.
function glassesSocketUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('glassesWs') ?? import.meta.env.VITE_GLASSES_WS_URL ?? `ws://${window.location.hostname || 'localhost'}:8787/view`;
}

// primary: the page counts as the rescuer's glasses (heartbeats, database connection), as Play demo needs.
function glassesViewUrl(rescuer: string, primary = false): string {
  const params = new URLSearchParams(window.location.search);
  const page = params.get('glassesPage') ?? import.meta.env.VITE_GLASSES_PAGE_URL ?? `http://${window.location.hostname || 'localhost'}:5173/fallback.html`;
  const url = new URL(page);
  url.searchParams.set('rescuer', rescuer);
  url.searchParams.set('ws', glassesSocketUrl());
  url.searchParams.set('record', '1'); // the display only, without the fallback page's test buttons
  if (primary) url.searchParams.set('primary', '1');
  return url.toString();
}

// The glasses service's HTTP base (demo controls), from its socket address: ws://host:8787/view -> http://host:8787.
function glassesServiceBase(): string {
  const socket = new URL(glassesSocketUrl());
  return `${socket.protocol === 'wss:' ? 'https:' : 'http:'}//${socket.host}`;
}

// A POST to Cayden's session on the glasses service. The session appears a moment after the glasses view connects,
// so "not found" is retried briefly.
async function glassesPost(path: string, what: string, body?: object): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${glassesServiceBase()}${path}`, { method: 'POST', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (response.ok) return;
    if (response.status !== 404 || attempt >= 20) throw new Error(`Glasses ${what} failed: ${(await response.text()) || response.statusText}`);
    await new Promise((done) => window.setTimeout(done, 500));
  }
}

const insetsFor = (width: number) => (width <= 1500 ? { left: 424, right: 344 } : { left: 494, right: 384 });

const resolutions: Record<Resolution, ResolutionValue> = { rescued: { tag: 'Rescued' }, handed_off: { tag: 'HandedOff' }, false_alarm: { tag: 'FalseAlarm' }, duplicate: { tag: 'Duplicate' } };
const reportKinds: Record<PersonReportInput['kind'], PersonReportKind> = { missing: { tag: 'Missing' }, safe: { tag: 'Safe' } };
const reportSources: Record<PersonReportInput['source'], PersonReportSource> = { family: { tag: 'Family' }, neighbor: { tag: 'Neighbor' }, hotline: { tag: 'Hotline' }, coordinator: { tag: 'Coordinator' } };

export default function App({ config }: { config: DashboardConfig }) {
  const connectionState = useSpacetimeDB();
  const board = useBoard();
  const connection = connectionState.getConnection() as DbConnection | null;
  const identityHex = connectionState.identity?.toHexString();
  const replayMode = config.view === 'replay';
  const isRegistered = replayMode || Boolean(identityHex && board.participants.some((row) => row.identity.toHexString() === identityHex));
  const readOnly = replayMode || Boolean(board.registrationError) || !isRegistered;

  const [page, setPage] = useState<Page>(config.view === 'agents' ? 'agents' : 'board');
  const [site, setSite] = useState<SiteGeometry | null>(null);
  const [siteError, setSiteError] = useState('');
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ status: true, rescuers: true, robots: true });
  const [pixelsPerMeter, setPixelsPerMeter] = useState(2.5);
  const [mapMoved, setMapMoved] = useState(false);
  const [cameras, setCameras] = useState(false);
  const [glassesOpen, setGlassesOpen] = useState(false);
  const [demoStep, setDemoStep] = useState<DemoStep | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const mapRef = useRef<SiteMapHandle>(null);
  const [toast, setToast] = useState('');
  const [insets, setInsets] = useState(() => insetsFor(window.innerWidth));

  useEffect(() => { loadSite().then(setSite, (error: Error) => setSiteError(error.message)); }, []);
  // Tell the launch animation (src/splash.ts) the dashboard can be shown: the map has loaded, or failed with a notice.
  useEffect(() => {
    if (!site && !siteError) return;
    (window as { underdogReady?: boolean }).underdogReady = true;
    window.dispatchEvent(new Event('underdog:ready'));
    window.underdogDesktop?.dashboardReady();
  }, [site, siteError]);
  useEffect(() => {
    const onResize = () => setInsets(insetsFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'a' && !event.metaKey && !event.ctrlKey) setPage('agents');
      if (event.key === 'Escape') { setPage('board'); setHouseId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const graph = useMemo(() => (site ? buildStreetGraph(site.context.roads) : null), [site]);
  const origin = board.site ? { lat: board.site.centerLat, lon: board.site.centerLon } : DEMO_HOUSE;
  const rows = useMemo(() => helpRows(board, site), [board, site]);
  const counts = headline(board);
  const houses = useMemo(() => houseSummary(board, site), [board, site]);
  const layersData = useMemo(() => mapLayers(board, site, graph), [board, site, graph]);
  const people = useMemo(() => peopleRows(board, site, graph), [board, site, graph]);
  const missions = useMemo(() => pendingMissions(board, site), [board, site]);
  const chains = useMemo(() => chainOptions(board, site), [board, site]);
  const activeChain = chainId !== null && chains.some((row) => row.id === chainId) ? chainId : chains[0]?.id ?? null;
  const house = houseId ? houses.views.find((view) => view.house.id === houseId) : undefined;

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 6000); };
  const call = async (action: () => Promise<unknown>, done: string) => {
    if (!connection) { showToast('No database connection.'); throw new Error('no connection'); }
    try { await action(); showToast(done); } catch (error) { showToast(error instanceof Error ? error.message : String(error)); throw error; }
  };

  const assign = (survivorId: bigint, rescuerHex: string) => {
    const rescuer = board.participants.find((row) => row.identity.toHexString() === rescuerHex);
    if (!rescuer) { showToast('That rescuer is no longer online.'); return Promise.reject(new Error('offline')); }
    return call(() => connection!.reducers.proposeAssignment({ survivorId, rescuerIdentity: rescuer.identity, reason: 'coordinator assignment' }), `Proposed to ${rescuer.name}. They accept on the glasses.`);
  };
  const resolve = (survivorId: bigint, resolution: Resolution, note: string) =>
    call(() => connection!.reducers.resolveSurvivor({ survivorId, resolution: resolutions[resolution], note }), `Survivor #${survivorId} resolved as ${resolution.replaceAll('_', ' ')}.`);
  const report = (input: PersonReportInput) => {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 500) { showToast('Count must be a whole number from 1 to 500.'); return Promise.reject(new Error('count')); }
    return call(() => connection!.reducers.reportPerson({ cellId: input.cellId, kind: reportKinds[input.kind], count: input.count, nameOrUnit: input.nameOrUnit.trim() || undefined, note: input.note.trim(), source: reportSources[input.source] }), 'Report added.');
  };
  const houseAction = (action: HouseAction, cellId: bigint) => {
    const robot = board.robots.find((row) => row.online);
    const command = mapCellActionCommand(action, cellId, { robotId: robot?.robotId });
    if (!command) { showToast('No robot is online to search this house.'); return; }
    if (command.type === 'create_mission') void call(() => connection!.reducers.createMission(command.args), 'Search mission queued for approval.').catch(() => {});
    else if (command.type === 'mark_cell') void call(() => connection!.reducers.markCell(command.args), action === 'searched' ? 'Marked searched.' : 'Marked partly searched; it stays open.').catch(() => {});
  };
  // Polls the live board until check() returns a value, for the Play demo steps.
  const waitFor = <T,>(check: () => T | undefined, timeoutMs: number, failure: string) => new Promise<T>((done, fail) => {
    const started = Date.now();
    const poll = () => {
      const value = check();
      if (value !== undefined) done(value);
      else if (Date.now() - started > timeoutMs) fail(new Error(failure));
      else window.setTimeout(poll, 250);
    };
    poll();
  });
  const demoBusy = demoStep !== null && demoStep !== 'arrived';
  const playDemo = () => {
    if (!connection || demoBusy) return;
    setGlassesOpen(true);
    runDemo({
      preflight: async () => {
        const health = await fetch(`${glassesServiceBase()}/healthz`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json(), () => undefined);
        if (!health) throw new Error('The glasses service is not running. Start everything with `npm run demo` in frontend/dashboard.');
        const mismatch = glassesMismatch(config, health);
        if (mismatch) throw new Error(mismatch);
      },
      board: () => boardRef.current,
      createSearch: (cellId, robotId) => {
        const command = mapCellActionCommand('send', cellId, { robotId });
        if (command?.type !== 'create_mission') throw new Error('Could not build the search mission.');
        return connection.reducers.createMission({ ...command.args, reason: 'demo: search house 3' });
      },
      propose: (survivorId, rescuer) => connection.reducers.proposeAssignment({ survivorId, rescuerIdentity: rescuer.identity, reason: 'coordinator assignment' }),
      glasses: (command: GlassesDemoCommand) => glassesPost(`/demo/${DEMO_RESCUER}/${command}`, command),
      accept: (assignmentId) => glassesPost(`/rescuer/${DEMO_RESCUER}/action`, 'accept', { action: 'accept', assignment_id: assignmentId.toString() }),
      release: (assignmentId) => glassesPost(`/rescuer/${DEMO_RESCUER}/action`, 'release', { action: 'release', assignment_id: assignmentId.toString() }),
      waitFor,
      onStep: setDemoStep,
    }).catch((error: unknown) => {
      setDemoStep(null);
      showToast(error instanceof Error ? error.message : String(error));
    });
  };
  const runActive = Boolean(board.run && !board.run.endedAt);
  const toggleRun = () => {
    if (runActive && board.run) void call(() => connection!.reducers.endRun({ runId: board.run!.id, notes: '' }), 'Run recording stopped.').catch(() => {});
    else if (board.site) void call(() => connection!.reducers.startRun({ siteId: board.site!.id, name: runName(board.site!.name, new Date()) }), 'Recording this run for replay.').catch(() => {});
  };

  const notice = board.registrationError ? `Not registered: ${board.registrationError}`
    : !isRegistered ? `Connecting your ${config.role} identity to the live board.`
      : siteError ? `Map could not load: ${siteError}` : !board.site && board.ready ? 'No site yet. Run the simulator setup to create the demo site.' : '';

  return <main className={`app ${page === 'agents' ? 'show-agents' : ''}`}>
    <AppBar page={page} onPage={setPage} chips={systemChips(board, connectionState.isActive)}
      demo={replayMode || !board.site?.demoMode ? null : { label: demoStep === 'arrived' ? 'Play again' : demoStep ? demoStepLabel[demoStep] : 'Play demo', busy: demoBusy, disabled: readOnly || demoBusy, onClick: playDemo }}
      run={replayMode ? null : { active: runActive, disabled: readOnly || !board.site, onClick: toggleRun }} />
    {notice && <p className="notice" role="status">{notice}</p>}

    {page === 'board' ? <>
      {site && <SiteMap ref={mapRef} site={site} origin={origin} houses={houses.views} survivors={layersData.survivors} rescuers={layersData.rescuers} robots={layersData.robots}
        routes={layersData.routes} layers={layers} selectedSurvivorId={selectedId} selectedHouseId={houseId} insets={insets}
        onSelectHouse={(next: House) => setHouseId(next.id === houseId ? null : next.id)} onSelectSurvivor={(id) => setSelectedId(id === selectedId ? null : id)} onScale={setPixelsPerMeter} onMoved={setMapMoved} />}
      <div className="fcol left">
        <HelpCard critical={counts.critical} rows={rows} selectedId={selectedId} rescuers={onlineRescuers(board)} readOnly={readOnly}
          onSelect={setSelectedId} onAssign={assign} onResolve={resolve} />
      </div>
      <div className="fcol right">
        <HeadlineCard unattended={counts.unattended} />
        {house ? <HousePanel view={house} canSendRobot={board.robots.some((row) => row.online)} readOnly={readOnly}
          reports={board.personReports.filter((row) => house.cell && row.cellId === house.cell.id).slice().sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt))
            .map((row) => ({ id: row.id, time: new Date(timestampToMs(row.createdAt)).toLocaleTimeString([], { hour12: false }), text: `${enumTagToContract(row.kind).toUpperCase()} · ${row.count} · ${enumTagToContract(row.source)}${row.note ? ` · ${row.note}` : ''}` }))}
          onAction={houseAction} onReport={report} onClose={() => setHouseId(null)} />
          : <PeopleCard rows={people} />}
        <HousesCard counts={houses.counts} missions={missions} readOnly={readOnly}
          onApprove={(id) => void call(() => connection!.reducers.approveMission({ missionId: id }), `Mission #${id} approved.`).catch(() => {})}
          onCancel={(id) => void call(() => connection!.reducers.cancelMission({ missionId: id }), `Mission #${id} cancelled.`).catch(() => {})} />
        <MapKey />
      </div>
      {replayMode ? <div className="dock replay"><TransportBar readOnly view="replay" onStart={() => {}} onEnd={() => {}} onSync={() => {}} /></div>
        : <div className="dock">
          <div className="layer-menu">
            <button className={`status-btn ${layers.status ? 'on' : ''}`} aria-pressed={layers.status} title={layers.status ? 'Hide each house’s search status' : 'Show each house’s search status'}
              onClick={() => setLayers({ ...layers, status: !layers.status })}>Status</button>
            <div className="layer-pop" role="group" aria-label="Map layers">
              <button className={layers.rescuers ? 'on' : ''} aria-pressed={layers.rescuers} onClick={() => setLayers({ ...layers, rescuers: !layers.rescuers })}>Rescuers</button>
              <button className={layers.robots ? 'on' : ''} aria-pressed={layers.robots} onClick={() => setLayers({ ...layers, robots: !layers.robots })}>Robots</button>
            </div>
          </div>
          <button className="camera-btn" onClick={() => setCameras(true)}>Camera view</button>
          <div className="zoom" role="group" aria-label="Zoom">
            <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomBy(1 / 1.4)}>−</button>
            <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomBy(1.4)}>+</button>
            {mapMoved && <button className="recenter" onClick={() => mapRef.current?.recenter()}>Recenter</button>}
          </div>
          <span className="scale"><i style={{ width: `${Math.min(160, 50 * pixelsPerMeter)}px` }} />{50 * pixelsPerMeter > 160 ? '' : '50 m'}</span>
        </div>}
    </> : <AgentsPage chains={chains} chainId={activeChain} onChain={setChainId} steps={chainSteps(board, activeChain)} agents={agentCards(board)}
      fallback={{ armed: board.timers.agentWatchdogs.length > 0, text: 'If every agent stops, the database still assigns the nearest rescuer within 60 s. The agents can only propose what the reducers allow.' }}
      timeline={taskTimeline(board)} />}

    {/* Kept mounted (hidden) while the demo runs: it is Cayden's glasses connection, and closing it would release his assignment. */}
    {(glassesOpen || demoBusy) && <GlassesPanel url={glassesViewUrl(DEMO_RESCUER, true)} hidden={!glassesOpen || page !== 'board'} status={demoStep ? demoStepLabel[demoStep] : ''}
      onClose={() => { setGlassesOpen(false); if (!demoBusy) setDemoStep(null); }} />}
    {cameras && <CameraView robots={robotFrames(board, site)} rescuers={glassesRescuers(board)} glassesUrl={glassesViewUrl} onClose={() => setCameras(false)} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}
