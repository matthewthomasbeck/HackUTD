// Live feeds share equal tiles. Expanding a tile keeps the other feeds mounted.
// The robot bar says what the robot is doing; Take over switches to the drive layout (docs/specs/robot.md 18.1).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DriveCommand } from '../model/teleop';
import { DrivePad } from './DrivePad';
import { LiveFeed } from './LiveFeed';

export interface RobotFrame { robotId: string; name: string; online: boolean; cameraUrl?: string; thermalUrl?: string; takenAt?: string; place?: string }
export interface RobotControl {
  robotId: string; name: string; online: boolean; state: string; doing: string; batteryPct?: number;
  control: { kind: 'free' } | { kind: 'mine' | 'other'; missionId: bigint; by: string; phase: 'waiting' | 'driving' };
}
type Feed = 'camera' | 'model' | 'thermal' | 'glasses';
type Props = {
  robots: readonly RobotFrame[];
  controls: readonly RobotControl[];
  rescuers: ReadonlyArray<{ key: string; name: string }>;
  glassesUrl: (rescuerKey: string) => string;
  // The live site map, shown next to the controls while driving (App centres it on the driven robot).
  map?: ReactNode;
  readOnly: boolean;
  onTakeOver: (robotId: string) => Promise<unknown>;
  onHandBack: (missionId: bigint) => Promise<unknown>;
  onDrive: (robotId: string, command: DriveCommand, seq: bigint) => Promise<void>;
  onDriveError: (message: string) => void;
  onClose: () => void;
  replay?: boolean;
};

function FeedTile({ id, title, expanded, onExpand, children, controls }: {
  id: Feed; title: string; expanded: Feed | null; onExpand: (id: Feed | null) => void;
  children: ReactNode; controls?: ReactNode;
}) {
  const active = expanded === id;
  return <section className={`camera-tile ${active ? 'is-expanded' : ''}`} aria-label={title}>
    <header><h3>{title}</h3><div className="camera-tile-actions">{controls}
      <button type="button" aria-label={`${active ? 'Restore' : 'Expand'} ${title}`} aria-expanded={active}
        onClick={() => onExpand(active ? null : id)}>{active ? 'Restore grid' : 'Expand'}</button>
    </div></header>
    <div className="camera-tile-content">{children}</div>
  </section>;
}

const DRIVE_FEEDS: ReadonlyArray<{ id: Exclude<Feed, 'glasses'>; label: string }> = [
  { id: 'camera', label: 'Camera' }, { id: 'model', label: 'Model' }, { id: 'thermal', label: 'Thermal' },
];

export function CameraView({ robots, controls, rescuers, glassesUrl, map, readOnly, onTakeOver, onHandBack, onDrive, onDriveError, onClose, replay = false }: Props) {
  const params = new URLSearchParams(window.location.search);
  const sensor = (params.get('robotPreview') ?? import.meta.env.VITE_ROBOT_PREVIEW_URL ?? '').replace(/\/$/, '');
  const vision = (params.get('visionPreview') ?? import.meta.env.VITE_VISION_PREVIEW_URL ?? sensor).replace(/\/$/, '');
  const [rescuer, setRescuer] = useState(rescuers[0]?.key ?? 'cayden');
  const [expanded, setExpanded] = useState<Feed | null>(null);
  const [driveFeed, setDriveFeed] = useState<Exclude<Feed, 'glasses'>>('camera');
  // The robot this screen drives stays selected; otherwise the picked robot, else the first (online first).
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const robot = controls.find((row) => row.control.kind === 'mine') ?? controls.find((row) => row.robotId === picked) ?? controls[0];
  const mine = robot?.control.kind === 'mine' ? robot.control : null;
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const act = (work: () => Promise<unknown>) => { setBusy(true); work().catch(() => {}).finally(() => setBusy(false)); };
  // Closing Camera View hands the robot back, so it never sits in remote control with nobody driving.
  const mineRef = useRef(mine);
  mineRef.current = mine;
  const close = () => { if (mineRef.current) void onHandBack(mineRef.current.missionId).catch(() => {}); onClose(); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (expanded) setExpanded(null); else close();
      }
      if (event.key === 'Tab') {
        const targets = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button, select, iframe, summary, a[href]') ?? [])
          .filter((node) => node.getClientRects().length > 0 && !node.hasAttribute('disabled'));
        const first = targets[0], last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = (message: string) => <div className="no-frame">{replay ? 'Live feeds are disabled during replay' : message}</div>;
  const feed = (id: Exclude<Feed, 'glasses'>) => id === 'camera'
    ? (!replay && sensor ? <LiveFeed url={`${sensor}/camera.jpg`} label="Raw camera" /> : missing('Camera is not connected'))
    : id === 'model'
      ? (!replay && vision ? <LiveFeed url={`${vision}/vision.jpg`} label="Boxes & pose keypoints" /> : missing('Model is not connected'))
      : (!replay && sensor ? <LiveFeed url={`${sensor}/thermal.png`} label="Thermal" thermal /> : missing('Thermal is not connected'));

  const takeOverButton = () => {
    if (!robot || replay) return null;
    const control = robot.control;
    if (control.kind === 'mine') return null; // the drive pad has the Hand back button
    if (control.kind === 'other') return <button type="button" className="robot-action" disabled={busy || readOnly} title={`End ${control.by}'s remote control`}
      onClick={() => act(() => onHandBack(control.missionId))}>End {control.by}'s control</button>;
    const why = readOnly ? 'Read-only screen' : !robot.online ? `${robot.name} is offline` : '';
    return <button type="button" className="robot-action take-over" disabled={busy || Boolean(why)} title={why || `Stop ${robot.name}'s mission and drive it yourself`}
      onClick={() => act(() => onTakeOver(robot.robotId))}>{busy ? 'Taking over…' : 'Take over'}</button>;
  };

  return <div className="camera-view" role="dialog" aria-modal="true" aria-labelledby="camera-view-title" ref={dialog}>
    <div className="camera-panel">
      <header><div><h2 className="display" id="camera-view-title">Camera view</h2>
        <p className="feed-note">{mine ? `Driving ${robot!.name}. Esc or × hands it back.` : 'Four views. Expand any feed for a closer look, or take over the robot to drive it.'}</p></div>
        <button className="close" ref={closeButton} aria-label="Close camera view" onClick={close}>×</button>
      </header>
      {robot && <div className="robot-bar" aria-label="Robot status">
        {controls.length > 1 && !mine
          ? <select aria-label="Robot" value={robot.robotId} onChange={(event) => setPicked(event.target.value)}>
            {controls.map((row) => <option key={row.robotId} value={row.robotId}>
              {controls.some((other) => other !== row && other.name === row.name) ? `${row.name} (${row.robotId})` : row.name}</option>)}
          </select>
          : <b>{robot.name}</b>}
        <span className={`robot-state ${robot.online ? 'tone-ok' : 'tone-muted'}`}>{robot.online ? robot.state : 'OFFLINE'}</span>
        <span className="robot-doing">{robot.doing}</span>
        {robot.batteryPct !== undefined && <span className="robot-battery">Battery {robot.batteryPct}%</span>}
        {takeOverButton()}
      </div>}

      {mine && robot ? <div className="drive-layout">
        <section className="camera-tile drive-feed" aria-label="Robot view">
          <header><h3>Robot view</h3>
            <div className="segmented" role="group" aria-label="Feed">
              {DRIVE_FEEDS.map((option) => <button key={option.id} type="button" aria-pressed={driveFeed === option.id}
                className={driveFeed === option.id ? 'on' : ''} onClick={() => setDriveFeed(option.id)}>{option.label}</button>)}
            </div>
          </header>
          <div className="camera-tile-content">{feed(driveFeed)}</div>
        </section>
        <aside className="drive-side">
          <DrivePad robotName={robot.name} phase={mine.phase} robotState={robot.state}
            onDrive={(command, seq) => onDrive(robot.robotId, command, seq)} onError={onDriveError}
            onHandBack={() => act(() => onHandBack(mine.missionId))} />
          {map && <div className="drive-map" aria-label="Site map">{map}</div>}
        </aside>
      </div> : <>
        <div className={`camera-grid ${expanded ? 'has-expanded' : ''}`}>
          <FeedTile id="camera" title="Robot camera" expanded={expanded} onExpand={setExpanded}>{feed('camera')}</FeedTile>
          <FeedTile id="model" title="Model detections" expanded={expanded} onExpand={setExpanded}>{feed('model')}</FeedTile>
          <FeedTile id="thermal" title="Thermal" expanded={expanded} onExpand={setExpanded}>{feed('thermal')}</FeedTile>
          <FeedTile id="glasses" title="Glasses heads-up" expanded={expanded} onExpand={setExpanded}
            controls={<select aria-label="Rescuer" value={rescuer} onChange={(event) => setRescuer(event.target.value)}>
              {!rescuers.some((person) => person.key === rescuer) && <option value={rescuer}>{rescuer}</option>}
              {rescuers.map((person) => <option key={person.key} value={person.key}>{person.name}</option>)}
            </select>}>
            <div className="glasses-frame"><iframe title={`Glasses view for ${rescuer}`} src={glassesUrl(rescuer)} /></div>
            <p className="feed-note">G2 display mirror. Black is see-through on the lens.</p>
          </FeedTile>
        </div>
        {!expanded && <details className="camera-evidence"><summary>Saved findings · {robots.length} robot{robots.length === 1 ? '' : 's'}</summary>
          <div className="camera-robots">{robots.length === 0 && <p className="empty">No saved robot findings yet.</p>}
            {robots.map((row) => <article key={row.robotId} className="robot-feed">
              <div className="feed-head"><b>{robots.some((other) => other !== row && other.name === row.name) ? `${row.name} (${row.robotId})` : row.name}</b><span className={row.online ? 'tone-ok' : 'tone-muted'}>{row.online ? 'online' : 'offline'}</span></div>
              <div className="frames">
                <figure>{row.cameraUrl ? <img src={row.cameraUrl} alt={`Saved camera image from ${row.name}`} /> : <span className="no-frame">No camera frame yet</span>}<figcaption>Saved camera</figcaption></figure>
                <figure>{row.thermalUrl ? <img className="thermal-image" src={row.thermalUrl} alt={`Saved thermal image from ${row.name}`} /> : <span className="no-frame">No thermal frame yet</span>}<figcaption>Saved thermal</figcaption></figure>
              </div><p className="feed-note">{row.takenAt ? `Latest finding ${row.takenAt}${row.place ? ` · ${row.place}` : ''}` : 'No finding recorded yet.'}</p>
            </article>)}
          </div>
        </details>}
      </>}
    </div>
  </div>;
}
