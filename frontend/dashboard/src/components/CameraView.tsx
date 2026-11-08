// Live feeds share equal tiles. Expanding a tile keeps the other feeds mounted.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LiveFeed } from './LiveFeed';

export interface RobotFrame { robotId: string; name: string; online: boolean; cameraUrl?: string; thermalUrl?: string; takenAt?: string; place?: string }
type Feed = 'camera' | 'model' | 'thermal' | 'glasses';
type Props = {
  robots: readonly RobotFrame[];
  rescuers: ReadonlyArray<{ key: string; name: string }>;
  glassesUrl: (rescuerKey: string) => string;
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

export function CameraView({ robots, rescuers, glassesUrl, onClose, replay = false }: Props) {
  const params = new URLSearchParams(window.location.search);
  const sensor = (params.get('robotPreview') ?? import.meta.env.VITE_ROBOT_PREVIEW_URL ?? '').replace(/\/$/, '');
  const vision = (params.get('visionPreview') ?? import.meta.env.VITE_VISION_PREVIEW_URL ?? sensor).replace(/\/$/, '');
  const [rescuer, setRescuer] = useState(rescuers[0]?.key ?? 'cayden');
  const [expanded, setExpanded] = useState<Feed | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (expanded) setExpanded(null); else onClose();
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
  }, [onClose, expanded]);
  const missing = (message: string) => <div className="no-frame">{replay ? 'Live feeds are disabled during replay' : message}</div>;
  return <div className="camera-view" role="dialog" aria-modal="true" aria-labelledby="camera-view-title" ref={dialog}>
    <div className="camera-panel">
      <header><div><h2 className="display" id="camera-view-title">Camera view</h2>
        <p className="feed-note">Four views. Expand any feed for a closer look.</p></div>
        <button className="close" ref={closeButton} aria-label="Close camera view" onClick={onClose}>×</button>
      </header>
      <div className={`camera-grid ${expanded ? 'has-expanded' : ''}`}>
        <FeedTile id="camera" title="Robot camera" expanded={expanded} onExpand={setExpanded}>
          {!replay && sensor ? <LiveFeed url={`${sensor}/camera.jpg`} label="Raw camera" /> : missing('Camera is not connected')}
        </FeedTile>
        <FeedTile id="model" title="Model detections" expanded={expanded} onExpand={setExpanded}>
          {!replay && vision ? <LiveFeed url={`${vision}/vision.jpg`} label="Boxes & pose keypoints" /> : missing('Model is not connected')}
        </FeedTile>
        <FeedTile id="thermal" title="Thermal" expanded={expanded} onExpand={setExpanded}>
          {!replay && sensor ? <LiveFeed url={`${sensor}/thermal.png`} label="Thermal" thermal /> : missing('Thermal is not connected')}
        </FeedTile>
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
          {robots.map((robot) => <article key={robot.robotId} className="robot-feed">
            <div className="feed-head"><b>{robot.name}</b><span className={robot.online ? 'tone-ok' : 'tone-muted'}>{robot.online ? 'online' : 'offline'}</span></div>
            <div className="frames">
              <figure>{robot.cameraUrl ? <img src={robot.cameraUrl} alt={`Saved camera image from ${robot.name}`} /> : <span className="no-frame">No camera frame yet</span>}<figcaption>Saved camera</figcaption></figure>
              <figure>{robot.thermalUrl ? <img className="thermal-image" src={robot.thermalUrl} alt={`Saved thermal image from ${robot.name}`} /> : <span className="no-frame">No thermal frame yet</span>}<figcaption>Saved thermal</figcaption></figure>
            </div><p className="feed-note">{robot.takenAt ? `Latest finding ${robot.takenAt}${robot.place ? ` · ${robot.place}` : ''}` : 'No finding recorded yet.'}</p>
          </article>)}
        </div>
      </details>}
    </div>
  </div>;
}
