import { useMemo, useState } from 'react';
import { useBoard } from '../data/LiveSource';
import { breathingLabel, resolutionLabel, survivorStatusLabel } from '../model/labels';
import { enumTagToContract } from '../stdb/enums';
import { formatDuration, timestampToMs } from '../stdb/time';
import { StatusChip } from './StatusChip';

const resolutions = [
  { key: 'rescued', label: 'Rescued' },
  { key: 'handed_off', label: 'Handed off' },
  { key: 'false_alarm', label: 'False alarm' },
  { key: 'duplicate', label: 'Duplicate' },
] as const;

type ResolutionKey = typeof resolutions[number]['key'];

export function SurvivorDetail({ selectedId, isReadOnly, onResolve, onAssign }: {
  selectedId: bigint | null;
  isReadOnly: boolean;
  onResolve: (id: bigint, resolution: ResolutionKey, note: string) => Promise<void>;
  onAssign: (id: bigint, identityHex: string) => Promise<void>;
}) {
  const board = useBoard();
  const [dialog, setDialog] = useState(false);
  const [note, setNote] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const survivor = board.survivors.find((row) => row.id === selectedId) ?? null;
  const detections = useMemo(() => survivor
    ? board.detections.filter((detection) => detection.survivorId === survivor.id).slice().sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch))
    : [], [board.detections, survivor]);
  const assignment = survivor ? board.assignments.find((row) => row.survivorId === survivor.id && ['proposed', 'active'].includes(enumTagToContract(row.status))) : undefined;
  const rescuer = assignment ? board.participants.find((person) => person.identity.toHexString() === assignment.rescuerIdentity.toHexString()) : undefined;
  const hasDuplicatePair = survivor ? survivor.possibleDuplicateOf !== 0n || board.survivors.some((row) => row.possibleDuplicateOf === survivor.id) : false;

  if (!survivor) {
    return <aside className="panel survivor-detail empty-detail"><p className="eyebrow">SURVIVOR DETAIL</p><h2>Select a survivor</h2><p>Choose a person from the ranked queue to inspect the evidence and hand-off state.</p></aside>;
  }

  const status = enumTagToContract(survivor.status);
  const allowedResolutions = resolutions.filter(({ key }) => {
    if (key === 'duplicate') return hasDuplicatePair;
    if (key === 'rescued' || key === 'handed_off') return status === 'reached';
    return true;
  });

  const submitResolution = async (resolution: ResolutionKey) => {
    setBusy(true);
    setActionMessage('');
    try {
      await onResolve(survivor.id, resolution, note);
      setDialog(false);
      setNote('');
      setActionMessage(resolutionLabel(resolution));
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const assign = async (identityHex: string) => {
    setBusy(true);
    setActionMessage('');
    try {
      await onAssign(survivor.id, identityHex);
      setAssigning(false);
      setActionMessage('Assignment proposal sent. The rescuer must acknowledge on the glasses.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const unattendedMs = Math.max(0, board.now - timestampToMs(survivor.createdAt));

  return (
    <aside className="panel survivor-detail" aria-label={`Survivor ${survivor.id.toString()} details`}>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">SURVIVOR #{survivor.id.toString()}</p>
          <h2>{survivor.houseLabel ?? 'No house label'}</h2>
        </div>
        <StatusChip value={survivor.criticalLevel} />
      </div>
      <div className="detail-score-row">
        <strong className="detail-score">{Math.round(survivor.criticalScore)}</strong>
        <span>score</span><span>confidence {survivor.scoreConfidence.toFixed(2)}</span>
        {survivor.possibleDuplicateOf !== 0n && <span className="duplicate-chip">?= #{survivor.possibleDuplicateOf.toString()}</span>}
      </div>
      <p className="detail-state">{survivorStatusLabel(survivor.status)}{rescuer ? ` · ${rescuer.name}` : ''}</p>
      <dl className="detail-facts">
        <div><dt>Location</dt><dd>{survivor.locationNote || 'No location note'} · {survivor.lat.toFixed(5)}, {survivor.lon.toFixed(5)}</dd></div>
        <div><dt>Waiting</dt><dd>{formatDuration(unattendedMs)}{survivor.escalatedAt ? ' · ESCALATED' : ''}</dd></div>
        <div><dt>Breathing</dt><dd>{breathingLabel(enumTagToContract(survivor.breathing), survivor.breathingRateBpm ?? null, survivor.breathingConfidence)}</dd></div>
        <div><dt>Body visible</dt><dd>{survivor.visibilityPct === undefined ? 'Not measured' : `${survivor.visibilityPct}%`}</dd></div>
      </dl>
      {enumTagToContract(survivor.breathing) === 'not_detected' && <p className="urgent-explanation">The camera could not see breathing. The chest may be covered, the camera may have moved, or the light may be poor. Treat as urgent.</p>}
      {survivor.scoreReasons.length > 0 && <div className="detail-reasons"><h3>Score reasons</h3><ul>{survivor.scoreReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul></div>}

      <div className="evidence-list">
        <h3>Evidence <span className="count-pill">{detections.length}</span></h3>
        {detections.map((detection) => (
          <article className="evidence-card" key={detection.id.toString()}>
            <div className="evidence-title"><strong>{enumTagToContract(detection.source).toUpperCase()}</strong><span>{new Date(timestampToMs(detection.createdAt)).toLocaleTimeString()}</span></div>
            {detection.thermalImageUrl && <figure><img className="thermal-image" src={detection.thermalImageUrl} alt={`Thermal image for survivor ${survivor.id.toString()}`} /><figcaption>Max {detection.maxTempC?.toFixed(1) ?? 'unknown'} C · thermal confidence {detection.thermalConfidence.toFixed(2)}</figcaption></figure>}
            {detection.cameraImageUrl && <figure><img src={detection.cameraImageUrl} alt={`Camera image for survivor ${survivor.id.toString()}`} /><figcaption>Camera image · dark frames can mean poor light</figcaption></figure>}
            {detection.breathingClipUrl && <figure><video controls muted loop playsInline src={detection.breathingClipUrl} /><figcaption>Breathing clip</figcaption></figure>}
            {!detection.thermalImageUrl && !detection.cameraImageUrl && !detection.breathingClipUrl && <div className="media-placeholder">No media yet</div>}
          </article>
        ))}
        {detections.length === 0 && <div className="media-placeholder">No detections are linked to this survivor yet.</div>}
        {survivor.breathingDisplayUrl && <figure><video controls muted loop playsInline src={survivor.breathingDisplayUrl} /><figcaption>Magnified breathing clip</figcaption></figure>}
      </div>

      <div className="detail-actions">
        <button className="button secondary" disabled={isReadOnly || status === 'resolved'} onClick={() => setAssigning((open) => !open)}>Assign rescuer</button>
        <button className="button primary" disabled={isReadOnly || status === 'resolved'} onClick={() => setDialog(true)}>Resolve</button>
      </div>
      {assigning && <div className="action-picker"><strong>Choose an online rescuer</strong>{board.participants.filter((person) => enumTagToContract(person.role) === 'rescuer' && person.online).map((person) => <button key={person.identity.toHexString()} className="picker-option" disabled={busy} onClick={() => void assign(person.identity.toHexString())}>{person.name}</button>)}{board.participants.every((person) => enumTagToContract(person.role) !== 'rescuer' || !person.online) && <p>No online rescuers.</p>}</div>}
      {actionMessage && <p className="action-message" role="status">{actionMessage}</p>}

      {dialog && <div className="dialog-scrim"><section className="resolve-dialog" role="dialog" aria-modal="true" aria-labelledby="resolve-title">
        <button className="dialog-close" aria-label="Close dialog" onClick={() => setDialog(false)}>×</button>
        <p className="eyebrow">HUMAN DECISION</p><h2 id="resolve-title">Resolve survivor #{survivor.id.toString()}</h2>
        <p>Only a person can resolve a survivor. This removes the row from the active board.</p>
        <label className="field-label" htmlFor="resolution-note">Note</label>
        <textarea id="resolution-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for the run record" />
        <div className="resolution-buttons">
          {allowedResolutions.map(({ key, label }) => <button key={key} className={`button ${key === 'false_alarm' || key === 'duplicate' ? 'secondary' : 'primary'}`} disabled={busy || isReadOnly || ((key === 'false_alarm' || key === 'duplicate') && !note.trim())} onClick={() => void submitResolution(key)}>{label}</button>)}
        </div>
        {(status !== 'reached') && <p className="dialog-hint">Rescued and handed off are available after a rescuer reaches this person.</p>}
      </section></div>}
    </aside>
  );
}
