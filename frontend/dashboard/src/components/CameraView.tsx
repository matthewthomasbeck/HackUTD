// Camera View: what the robots last saw next to what a rescuer's glasses show right now.
// The robots send stills with each find (detection.camera_image_url, thermal_image_url on the media server),
// not live video, so each robot tile shows its newest still and says when it was taken.
// The glasses tile embeds the glasses fallback page (frontend/glasses/fallback.html), which draws exactly the
// containers the G2 shows, live from the glasses service.
import { useEffect, useState } from 'react';
import { Mascot } from './Mascot';

export interface RobotFrame { robotId: string; name: string; online: boolean; cameraUrl?: string; thermalUrl?: string; takenAt?: string; place?: string }

type Props = {
  robots: readonly RobotFrame[];
  rescuers: ReadonlyArray<{ key: string; name: string }>;
  glassesUrl: (rescuerKey: string) => string;
  onClose: () => void;
};

export function CameraView({ robots, rescuers, glassesUrl, onClose }: Props) {
  const [rescuer, setRescuer] = useState(rescuers[0]?.key ?? 'cayden');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="camera-view" role="dialog" aria-label="Camera view">
    <div className="camera-panel">
      <header>
        <h2 className="display">Camera view</h2>
        <button className="close" aria-label="Close camera view" onClick={onClose}>×</button>
      </header>
      <div className="camera-grid">
        <section className="camera-robots" aria-label="Robot cameras">
          <h3>Robot cameras</h3>
          {robots.length === 0 && <p className="empty">No robot is connected.</p>}
          {robots.map((robot) => <article key={robot.robotId} className={`robot-feed ${robot.online ? '' : 'offline'}`}>
            <div className="feed-head"><Mascot kind="robot" size={28} /><b>{robot.name}</b><span className={robot.online ? 'tone-ok' : 'tone-muted'}>{robot.online ? 'online' : 'offline'}</span></div>
            <div className="frames">
              <figure>{robot.cameraUrl ? <img src={robot.cameraUrl} alt={`Camera still from ${robot.name}`} /> : <span className="no-frame">No camera frame yet</span>}<figcaption>Camera</figcaption></figure>
              <figure>{robot.thermalUrl ? <img src={robot.thermalUrl} alt={`Thermal still from ${robot.name}`} /> : <span className="no-frame">No thermal frame yet</span>}<figcaption>Thermal</figcaption></figure>
            </div>
            <p className="feed-note">{robot.takenAt ? `Latest frame ${robot.takenAt}${robot.place ? ` · ${robot.place}` : ''}` : 'The robot sends a still with every find.'}</p>
          </article>)}
        </section>
        <section className="camera-glasses" aria-label="Glasses heads-up">
          <div className="glasses-head">
            <h3>Glasses heads-up</h3>
            <select aria-label="Rescuer" value={rescuer} onChange={(event) => setRescuer(event.target.value)}>
              {rescuers.map((person) => <option key={person.key} value={person.key}>{person.name}</option>)}
            </select>
          </div>
          <div className="glasses-frame"><iframe title={`Glasses view for ${rescuer}`} src={glassesUrl(rescuer)} /></div>
          <p className="feed-note">Exactly what the G2 shows: black is see-through on the lens.</p>
        </section>
      </div>
    </div>
  </div>;
}
