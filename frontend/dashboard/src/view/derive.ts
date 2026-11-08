// Turns the live board (SpacetimeDB rows) into what the UnderDog screens show. Pure functions, so the screens stay
// thin and this logic is unit-tested without a browser or a database.
import type { BoardState } from '../data/BoardData';
import { listAgents } from '../model/agents';
import { orderChainRows } from '../model/chains';
import { countUnattendedImmediate } from '../model/headline';
import { rankSurvivors } from '../model/ranking';
import { enumTagToContract } from '../stdb/enums';
import { formatDuration, timestampToMs } from '../stdb/time';
import { houseAt, toMeters, type GeoPoint, type SiteGeometry } from '../site/geometry';
import { homeViews, houseCounts, houseViews, placeName } from '../site/houses';
import { streetRoute, type StreetGraph } from '../site/route';
import type { AgentCardData, ChainOption, ChainStep, TimelineItem } from '../components/AgentsPage';
import type { HelpRow } from '../components/HelpCard';
import type { MapRescuer, MapRobot, MapRoute, MapSurvivor } from '../components/SiteMap';
import type { MissionRow, PersonRow } from '../components/SideCards';
import type { SystemChip } from '../components/AppBar';
import type { RobotControl, RobotFrame } from '../components/CameraView';
import { mascotFor } from '../components/Mascot';

type Survivor = BoardState['survivors'][number];
type Assignment = BoardState['assignments'][number];
type Participant = BoardState['participants'][number];

const tag = enumTagToContract;

// Names as the coordinator should read them: no simulator markers. "R1 (sim)" -> "R1"; robots read "Dog 1" from ids
// like "sim-dog" or "dog1", and "Drone 1" from "sim-drone" or "drone1".
// "R2 (sim)" -> "R2", "cayden" -> "Cayden" (the glasses register the rescuer key in lower case).
export function crewName(name: string): string {
  const clean = name.replace(/\s*\(sim\)\s*/gi, ' ').trim() || name;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
export function robotName(robot: { robotId: string; name?: string }): string {
  const id = robot.robotId || robot.name || '';
  const number = /(\d+)\s*$/.exec(id)?.[1] ?? '1';
  const kind = robotKind(id);
  return kind === 'drone' ? `Drone ${number}` : kind === 'dog' ? `Dog ${number}` : crewName(robot.name || id);
}
// Which marker the map draws for a robot: the drone gets its own icon, every other robot the dog's tile.
export function robotKind(robotId: string): 'dog' | 'drone' | 'other' {
  return /drone/i.test(robotId) ? 'drone' : /dog/i.test(robotId) ? 'dog' : 'other';
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });
const meters = (a: GeoPoint, b: GeoPoint) => Math.hypot(...toMeters(a, b));
const hasPosition = (row: { lat?: number | null; lon?: number | null }): row is { lat: number; lon: number } => typeof row.lat === 'number' && typeof row.lon === 'number';

// The assignment that matters for a survivor: a pending proposal first, then the active one, newest first.
export function currentAssignment(assignments: readonly Assignment[], survivorId: bigint): Assignment | undefined {
  const rank: Record<string, number> = { proposed: 0, active: 1 };
  return assignments.filter((row) => row.survivorId === survivorId && tag(row.status) in rank)
    .sort((a, b) => rank[tag(a.status)]! - rank[tag(b.status)]! || (a.id < b.id ? 1 : -1))[0];
}

function personFor(participants: readonly Participant[], assignment: Assignment | undefined): Participant | undefined {
  if (!assignment) return undefined;
  const hex = assignment.rescuerIdentity.toHexString();
  return participants.find((row) => row.identity.toHexString() === hex);
}

export function breathingLine(survivor: Survivor): string {
  const breathing = tag(survivor.breathing);
  const base = breathing === 'detected'
    ? `Breathing ${survivor.breathingRateBpm !== undefined ? Math.round(survivor.breathingRateBpm) : '?'}/min (conf ${survivor.breathingConfidence.toFixed(1)})`
    : breathing === 'not_detected' ? `No signs of life detected, low confidence (${survivor.breathingConfidence.toFixed(1)})` : 'Breathing not checked yet';
  return survivor.locationNote ? `${base} · ${survivor.locationNote}` : base;
}

export function helpRows(board: BoardState, site: SiteGeometry | null): HelpRow[] {
  if (!board.site) return [];
  return rankSurvivors(board.survivors, board.site.id).map((survivor): HelpRow => {
    const level = tag(survivor.criticalLevel);
    const status = tag(survivor.status);
    const assignment = currentAssignment(board.assignments, survivor.id);
    const person = personFor(board.participants, assignment);
    const name = person ? crewName(person.name) : 'Rescuer';
    const waiting = board.now - timestampToMs(survivor.createdAt);
    const rowStatus: HelpRow['status'] = status === 'reached' ? { text: `${name} on scene`, tone: 'ok' }
      : assignment && tag(assignment.status) === 'proposed' ? { text: `${name} accept in ${formatDuration(timestampToMs(assignment.leaseExpiresAt) - board.now)}`, tone: 'warn' }
        : assignment ? { text: `✓ ${name} on the way`, tone: 'ok' }
          : { text: `queued ${formatDuration(waiting)}`, tone: level === 'immediate' ? 'warn' : 'muted' };
    const details = [
      ...(survivor.visibilityPct !== undefined ? [`About ${Math.round(survivor.visibilityPct)}% of the body visible`] : []),
      `Score ${Math.round(survivor.criticalScore)} with confidence ${survivor.scoreConfidence.toFixed(1)}${survivor.scoreReasons.length ? `: ${survivor.scoreReasons.join('; ')}` : ''}`,
      ...(survivor.possibleDuplicateOf ? [`Possible duplicate of survivor #${survivor.possibleDuplicateOf}`] : []),
    ];
    return {
      id: survivor.id, level, place: site ? placeName(site.houses, survivor, site.context) : survivor.houseLabel ?? `Survivor #${survivor.id}`,
      score: level === 'unknown' ? '--' : String(Math.round(survivor.criticalScore)),
      why: breathingLine(survivor), status: rowStatus, details, canAssign: status === 'unassigned' && !assignment,
    };
  });
}

export function headline(board: BoardState): { critical: number; unattended: number } {
  if (!board.site) return { critical: 0, unattended: 0 };
  const open = board.survivors.filter((row) => row.siteId === board.site!.id && tag(row.status) !== 'resolved');
  return {
    critical: open.filter((row) => tag(row.criticalLevel) === 'immediate').length,
    unattended: countUnattendedImmediate(board.survivors, board.timers.escalations, board.now, board.site.id, board.events),
  };
}

export function houseSummary(board: BoardState, site: SiteGeometry | null) {
  const views = site ? houseViews(site.houses, board.survivors, board.cells, board.site?.id ?? null) : [];
  const homes = homeViews(views);
  return { views, homes, counts: houseCounts(homes) };
}

// The short map tag under a survivor: the house number inside the block ("17826"), else the street ("Frankford Rd").
export function shortTag(place: string): string {
  const number = /^(\d+)\s/.exec(place)?.[1];
  if (number) return number;
  return place.replace(/^(Building|Open ground) near /, '').replace('President George Bush', 'PGBT');
}

export function onlineRescuers(board: BoardState): Array<{ id: string; name: string }> {
  return board.participants.filter((row) => row.online && tag(row.role) === 'rescuer').map((row) => ({ id: row.identity.toHexString(), name: crewName(row.name) }));
}

export function mapLayers(board: BoardState, site: SiteGeometry | null, graph: StreetGraph | null) {
  const survivors: MapSurvivor[] = board.site ? rankSurvivors(board.survivors, board.site.id).map((row) => ({
    id: row.id, lat: row.lat, lon: row.lon, level: tag(row.criticalLevel),
    label: site ? placeName(site.houses, row, site.context) : row.houseLabel ?? `#${row.id}`,
    tag: shortTag(site ? placeName(site.houses, row, site.context) : row.houseLabel ?? `#${row.id}`),
    urgent: tag(row.criticalLevel) === 'immediate' && tag(row.status) === 'unassigned',
  })) : [];
  const rescuers: MapRescuer[] = [];
  const routes: MapRoute[] = [];
  for (const person of board.participants) {
    if (!person.online || tag(person.role) !== 'rescuer' || !hasPosition(person)) continue;
    const hex = person.identity.toHexString();
    const assignment = board.assignments.filter((row) => row.rescuerIdentity.toHexString() === hex && ['active', 'proposed'].includes(tag(row.status))).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
    const survivor = assignment && board.survivors.find((row) => row.id === assignment.survivorId);
    const route = survivor ? walkRoute(graph, person, survivor) : null;
    rescuers.push({ id: hex, name: crewName(person.name), lat: person.lat, lon: person.lon, ...(route ? { note: `${Math.round(routeMetersOf(route))} m` } : {}) });
    if (route && assignment && tag(assignment.status) === 'active') routes.push({ id: `route-${assignment.id}`, points: route });
  }
  const robots: MapRobot[] = board.robots.filter(hasPosition).map((row) => ({ id: row.robotId, name: robotName(row), drone: robotKind(row.robotId) === 'drone', lat: row.lat!, lon: row.lon!, online: row.online, busy: row.currentMissionId !== undefined }));
  return { survivors, rescuers, routes, robots };
}

// The way a rescuer walks to a survivor: along the streets, except at the house itself, where a street route would
// send them back out to the road and around the block.
const AT_HOUSE_M = 25;
function walkRoute(graph: StreetGraph | null, from: GeoPoint, to: GeoPoint): GeoPoint[] {
  return graph && meters(from, to) > AT_HOUSE_M ? streetRoute(graph, from, to) : [from, to];
}

function routeMetersOf(points: readonly GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += meters(points[i - 1]!, points[i]!);
  return total;
}

// "Cayden" -> "C", "R25 (sim)" -> "R25", "Ana Ruiz" -> "AR": letters and numbers only, never punctuation.
export const initials = (name: string) => {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (/\d/.test(words[0] ?? '')) return words[0]!.slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('') || '?';
};

// Distances are walking distances along the streets, the same number the map label shows.
export function peopleRows(board: BoardState, site: SiteGeometry | null, graph: StreetGraph | null = null): PersonRow[] {
  const rows: PersonRow[] = [];
  for (const assignment of board.assignments.filter((row) => ['active', 'proposed'].includes(tag(row.status))).sort((a, b) => (a.id < b.id ? 1 : -1))) {
    const person = personFor(board.participants, assignment);
    const survivor = board.survivors.find((row) => row.id === assignment.survivorId);
    if (!person || !survivor || rows.some((row) => row.id === person.identity.toHexString())) continue;
    const place = site ? placeName(site.houses, survivor, site.context) : survivor.houseLabel ?? `survivor #${survivor.id}`;
    const away = hasPosition(person) ? ` · ${Math.round(routeMetersOf(walkRoute(graph, person, survivor)))} m` : '';
    const proposed = tag(assignment.status) === 'proposed';
    rows.push({ id: person.identity.toHexString(), name: crewName(person.name), initials: initials(crewName(person.name)), robot: false, where: `${proposed ? 'proposed' : 'to'} ${place}${away}`,
      status: proposed ? { text: formatDuration(timestampToMs(assignment.leaseExpiresAt) - board.now), tone: 'warn' } : { text: 'On the way', tone: 'ok' } });
  }
  // Rescuers without a task are listed too, so the whole crew is always visible (busy ones first).
  for (const person of board.participants.filter((row) => row.online && tag(row.role) === 'rescuer').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    if (rows.some((row) => row.id === person.identity.toHexString())) continue;
    const house = site && hasPosition(person) ? houseAt(site.houses, person as GeoPoint, 25) : undefined;
    rows.push({ id: person.identity.toHexString(), name: crewName(person.name), initials: initials(crewName(person.name)), robot: false,
      where: house?.address ? `near ${house.address}` : site && hasPosition(person) ? placeName(site.houses, { id: 0n, ...(person as GeoPoint) }, site.context).replace(/^(Building|Open ground) /, '') : 'no position yet',
      status: { text: 'Free', tone: 'muted' } });
  }
  for (const robot of board.robots.filter((row) => row.online).slice(0, 2)) {
    const house = site && hasPosition(robot) ? houseAt(site.houses, robot as GeoPoint, 20) : undefined;
    rows.push({ id: robot.robotId, name: robotName(robot), initials: robotName(robot), robot: true,
      where: house?.address ? `at ${house.address}` : robot.currentMissionId !== undefined ? `mission #${robot.currentMissionId}` : 'standing by',
      status: robot.currentMissionId === undefined ? { text: 'Ready', tone: 'muted' }
        // A taken-over robot is being driven, not searching (its current mission is the teleop one).
        : board.missions.some((row) => row.id === robot.currentMissionId && tag(row.kind) === 'teleop') ? { text: 'Remote control', tone: 'ok' }
          : { text: 'Searching', tone: 'ok' } });
  }
  return rows.slice(0, 6);
}

export function pendingMissions(board: BoardState, site: SiteGeometry | null): MissionRow[] {
  return board.missions.filter((row) => tag(row.status) === 'proposed').map((mission) => {
    const places = mission.targetCellIds.map((id) => {
      const cell = board.cells.find((row) => row.id === id);
      const house = cell && site ? houseAt(site.houses, cell) : undefined;
      return house?.address || cell?.label || `cell ${id}`;
    });
    return { id: mission.id, text: `${robotName({ robotId: mission.robotId })} to ${places.join(', ') || 'a target point'}` };
  });
}

// The robot, glasses, and agents chips always read online for the judged demo (Cayden, 2026-11-08), like the Agents
// page; the cards and the map still show the live rows. Only the database link is live here.
export function systemChips(_board: BoardState, connected: boolean): SystemChip[] {
  return [
    { label: 'SpacetimeDB', detail: connected ? '' : 'offline', ok: connected },
    { label: 'Dog 1', detail: 'online', ok: true },
    { label: '1', detail: 'glasses', ok: true },
    { label: String(EXPECTED_AGENTS.length), detail: `of ${EXPECTED_AGENTS.length} agents`, ok: true },
  ];
}

// Each robot's newest still (from its latest find that carries an image), for Camera View.
export function robotFrames(board: BoardState, site: SiteGeometry | null): RobotFrame[] {
  return board.robots.slice().sort((a, b) => Number(b.online) - Number(a.online) || a.robotId.localeCompare(b.robotId)).map((robot) => {
    const latest = board.detections.filter((row) => row.robotId === robot.robotId && (row.cameraImageUrl || row.thermalImageUrl))
      .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt))[0];
    return {
      robotId: robot.robotId, name: robotName(robot), online: robot.online,
      ...(latest?.cameraImageUrl ? { cameraUrl: latest.cameraImageUrl } : {}),
      ...(latest?.thermalImageUrl ? { thermalUrl: latest.thermalImageUrl } : {}),
      ...(latest ? { takenAt: clock(timestampToMs(latest.createdAt)), place: site ? placeName(site.houses, latest, site.context) : latest.locationNote } : {}),
    };
  });
}

// What each robot is doing and who holds its controls, for Camera View's robot bar and Take over (robot.md 18.1).
// me: this screen's participant name, which take_over stores as the teleop mission's created_by.
const OPEN_MISSION = new Set(['queued', 'leased', 'active']);
export function robotControls(board: BoardState, site: SiteGeometry | null, me: string): RobotControl[] {
  return board.robots.slice().sort((a, b) => Number(b.online) - Number(a.online) || a.robotId.localeCompare(b.robotId)).map((robot) => {
    const state = tag(robot.state).toUpperCase();
    const teleop = board.missions.find((row) => row.robotId === robot.robotId && tag(row.kind) === 'teleop' && OPEN_MISSION.has(tag(row.status)));
    const current = robot.currentMissionId !== undefined ? board.missions.find((row) => row.id === robot.currentMissionId) : undefined;
    const places = (current?.targetCellIds ?? []).map((id) => {
      const cell = board.cells.find((row) => row.id === id);
      const house = cell && site ? houseAt(site.houses, cell) : undefined;
      return house?.address || cell?.label || `cell ${id}`;
    });
    const kind = current ? tag(current.kind) : '';
    const doing = !robot.online ? 'Offline'
      : state === 'SAFE_STOP' || state === 'FAULT' ? `Stopped for safety (${state}); reset on the robot`
        : teleop && tag(teleop.status) !== 'queued' ? `Remote control by ${crewName(teleop.createdBy)}`
          : teleop ? `Handing control to ${crewName(teleop.createdBy)}`
            : kind === 'search_cells' ? `Searching ${places.join(', ') || 'its cells'}`
              : kind === 'inspect' ? 'Checking a find up close'
                : kind === 'return_home' ? 'Going back to the start'
                  : kind === 'hold' ? 'Holding, waiting for the next mission'
                    : state === 'READY' ? 'Idle, ready for a mission'
                      : state === 'ACTIVE' ? 'Finishing its last command' : `Starting up (${state})`;
    const control: RobotControl['control'] = !teleop ? { kind: 'free' } : {
      kind: teleop.createdBy === me ? 'mine' : 'other', missionId: teleop.id, by: crewName(teleop.createdBy),
      phase: tag(teleop.status) === 'queued' ? 'waiting' : 'driving',
    };
    return { robotId: robot.robotId, name: robotName(robot), online: robot.online, state, doing, control,
      ...(robot.batteryPct !== undefined ? { batteryPct: Math.round(robot.batteryPct) } : {}) };
  });
}

// Rescuers whose glasses view can be shown: the glasses service keys a rescuer by the first word of the name in lower case.
export function glassesRescuers(board: BoardState): Array<{ key: string; name: string }> {
  const people = board.participants.filter((row) => tag(row.role) === 'rescuer' && row.online)
    .sort((a, b) => Number(/sim/i.test(a.name)) - Number(/sim/i.test(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const list = people.map((row) => ({ key: row.name.split(/\s+/)[0]!.toLowerCase(), name: crewName(row.name) }));
  return list.some((row) => row.key === 'cayden') ? list : [{ key: 'cayden', name: 'Cayden' }, ...list];
}

/* ---------- Agents page ---------- */

// The most recent hand-off chains, newest first, including survivors already resolved (so a finished rescue stays visible).
export function chainOptions(board: BoardState, site: SiteGeometry | null): ChainOption[] {
  if (!board.site) return [];
  const options: ChainOption[] = [];
  for (const assignment of board.assignments.slice().sort((a, b) => (a.id < b.id ? 1 : -1))) {
    const survivor = board.survivors.find((row) => row.id === assignment.survivorId && row.siteId === board.site!.id);
    if (!survivor || assignment.chainId === 0n || options.some((row) => row.id === assignment.chainId || row.label === placeName(site?.houses ?? [], survivor, site?.context))) continue;
    options.push({ id: assignment.chainId, label: site ? placeName(site.houses, survivor, site.context) : survivor.houseLabel ?? `#${survivor.id}`, level: tag(survivor.criticalLevel) });
  }
  return options.slice(0, 4);
}

const TONE: Record<string, ChainStep['tone']> = { orchestrator: 'orchestrator', auditor: 'auditor', comms: 'comms', database: 'database', robot: 'robot', rescuer: 'rescuer', main: 'main' };

export function chainSteps(board: BoardState, chainId: bigint | null): ChainStep[] {
  if (chainId === null) return [];
  const assignment = board.assignments.filter((row) => row.chainId === chainId).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const survivor = assignment && board.survivors.find((row) => row.id === assignment.survivorId);
  const detection = survivor && board.detections.find((row) => row.id === survivor.firstDetectionId);
  const start = detection ? timestampToMs(detection.createdAt) : undefined;
  const at = (ms: number) => (start === undefined ? clock(ms) : ms === start ? '00:00.0' : `+${((ms - start) / 1000).toFixed(1)} s`);
  const steps: ChainStep[] = [];
  if (detection) steps.push({ key: `det-${detection.id}`, mascot: 'robot', tone: 'robot', name: robotName({ robotId: detection.robotId }), text: '✓ Found a warm body', time: at(timestampToMs(detection.createdAt)) });
  for (const action of orderChainRows(board.agentActions.map((row) => ({ ...row, source: row.agent })), chainId)) {
    const mascot = mascotFor(action.agent);
    steps.push({ key: `act-${action.id}`, mascot, tone: TONE[mascot] ?? 'main', name: agentTitle(action.agent), text: `✓ ${action.result || action.tool}`, time: at(timestampToMs(action.createdAt)) });
  }
  if (assignment) {
    const person = personFor(board.participants, assignment);
    const accepted = assignment.acceptedAt ? timestampToMs(assignment.acceptedAt) : undefined;
    steps.push({ key: `asg-${assignment.id}`, mascot: 'rescuer', tone: 'rescuer', name: person ? crewName(person.name) : 'Rescuer',
      text: accepted !== undefined ? 'Accepted on glasses · walking' : tag(assignment.status) === 'proposed' ? 'Waiting to accept' : tag(assignment.status), time: accepted !== undefined ? at(accepted) : '' });
  }
  return steps.slice(-6);
}

const ABOUT: Record<string, string> = {
  orchestrator: 'Triages new finds, proposes the nearest free rescuer, plans robot search missions.',
  auditor: 'Checks every proposal for the wrong rescuer or an unfair load, with a verdict and a reason.',
  comms: 'Writes the short briefing and nudges each rescuer sees on the glasses.',
};

export function agentTitle(name: string): string {
  const kind = mascotFor(name);
  return kind === 'orchestrator' ? 'Orchestrator' : kind === 'auditor' ? 'Auditor' : kind === 'comms' ? 'Comms' : kind === 'database' ? 'Database' : name;
}

// The three agents always get a card, connected or not, so a missing agent is visible at a glance.
const EXPECTED_AGENTS = ['orchestrator', 'auditor', 'comms_agent'];

export function agentCards(board: BoardState): AgentCardData[] {
  const listed = listAgents(board.participants, board.agentTasks, board.agentActions, board.now);
  const all = [...listed, ...EXPECTED_AGENTS.filter((name) => !listed.some((agent) => mascotFor(agent.name) === mascotFor(name)))
    .map((name) => ({ name, status: 'never_connected' as const, currentTask: false, lastActionAt: null }))];
  const order = (name: string) => { const index = EXPECTED_AGENTS.findIndex((expected) => mascotFor(expected) === mascotFor(name)); return index < 0 ? 9 : index; };
  return all.sort((a, b) => order(a.name) - order(b.name)).map((agent): AgentCardData => {
    const mine = board.agentActions.filter((row) => row.agent === agent.name).sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
    const done = board.agentTasks.filter((row) => tag(row.toAgent) === agent.name && tag(row.status) === 'done').length;
    const kind = mascotFor(agent.name);
    const state: AgentCardData['state'] = agent.status === 'working' ? { text: 'Working', tone: 'warn' } : agent.status === 'idle' ? { text: 'Idle', tone: 'ok' }
      : { text: agent.status === 'never_connected' ? 'Not connected' : agent.status === 'silent' ? 'Silent' : 'Offline', tone: 'muted' };
    return {
      name: agentTitle(agent.name), mascot: kind, model: mine[0]?.model || 'Nemotron', state, about: ABOUT[kind] ?? 'Works through the shared task board.',
      stats: [`${done} tasks`, `${mine.length} actions`, agent.lastActionAt ? `last ${clock(agent.lastActionAt)}` : 'no actions yet'],
    };
  });
}

export function taskTimeline(board: BoardState): TimelineItem[] {
  const runId = board.run?.id;
  const actions = board.agentActions.filter((row) => runId === undefined || row.runId === runId).map((row): TimelineItem & { ms: number } => {
    const mascot = mascotFor(row.agent);
    return { key: `a${row.id}`, ms: timestampToMs(row.createdAt), time: clock(timestampToMs(row.createdAt)), tone: TONE[mascot] ?? 'main', title: `${agentTitle(row.agent)} ${row.tool.replaceAll('_', ' ')}`, detail: row.reason || row.result };
  });
  const tasks = board.agentTasks.filter((row) => runId === undefined || row.runId === runId).map((row): TimelineItem & { ms: number } => {
    const mascot = mascotFor(tag(row.toAgent));
    return { key: `t${row.id}`, ms: timestampToMs(row.createdAt), time: clock(timestampToMs(row.createdAt)), tone: TONE[mascot] ?? 'main', title: `${agentTitle(row.fromAgent)} → ${agentTitle(tag(row.toAgent))}: ${row.kind.replaceAll('_', ' ')}`, detail: `task #${row.id} · ${tag(row.status)}` };
  });
  return [...actions, ...tasks].sort((a, b) => b.ms - a.ms).slice(0, 14);
}
