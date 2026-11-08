// Remote driving controls (docs/specs/robot.md section 18.1). Hold a button or key to drive; let go and the robot stops.
// A held input is re-sent every DRIVE_SEND_MS, and one zero command goes out on release. The robot also stops by itself
// 300 ms after the last command, so a closed tab or dropped Wi-Fi never leaves it driving.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { describeCommand, DRIVE_SEND_MS, driveCommand, driveInputForKey, isStill, type DriveCommand, type DriveInput } from '../model/teleop';

type Props = {
  robotName: string;
  phase: 'waiting' | 'driving';
  robotState: string;
  onDrive: (command: DriveCommand, seq: bigint) => Promise<void>;
  onError: (message: string) => void;
  onHandBack: () => void;
};

// The pad, row by row: the label, its key hint, and the input it holds (null for the centre Stop).
const PAD: ReadonlyArray<ReadonlyArray<{ input: DriveInput | null; label: string; keys: string } | null>> = [
  [{ input: 'turn_left', label: '↺ Turn left', keys: 'Q ←' }, { input: 'forward', label: '▲ Forward', keys: 'W ↑' }, { input: 'turn_right', label: '↻ Turn right', keys: 'E →' }],
  [{ input: 'left', label: '◀ Left', keys: 'A' }, { input: null, label: '■ Stop', keys: 'Space' }, { input: 'right', label: 'Right ▶', keys: 'D' }],
  [null, { input: 'back', label: '▼ Back', keys: 'S ↓' }, null],
];

export function DrivePad({ robotName, phase, robotState, onDrive, onError, onHandBack }: Props) {
  const [held, setHeld] = useState<ReadonlySet<DriveInput>>(new Set());
  const heldRef = useRef(held);
  const seq = useRef(BigInt(Date.now())); // keeps rising across reloads, so the robot always sees a new command
  const driving = phase === 'driving';
  const update = (next: ReadonlySet<DriveInput>) => { heldRef.current = next; setHeld(next); };
  const press = (input: DriveInput) => { if (!heldRef.current.has(input)) update(new Set([...heldRef.current, input])); };
  const release = (input: DriveInput) => { if (heldRef.current.has(input)) { const next = new Set(heldRef.current); next.delete(input); update(next); } };
  const releaseAll = () => { if (heldRef.current.size) update(new Set()); };

  // Keys. Capture phase on window, so a drive key (A strafes) never reaches the board's own shortcuts (A opens Agents).
  useEffect(() => {
    const typing = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      return Boolean(target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    };
    const onDown = (event: KeyboardEvent) => {
      if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); releaseAll(); return; }
      const input = driveInputForKey(event.key);
      if (!input) return;
      event.preventDefault();
      event.stopPropagation();
      press(input);
    };
    const onUp = (event: KeyboardEvent) => {
      const input = driveInputForKey(event.key);
      if (!input) return;
      event.stopPropagation();
      release(input);
    };
    // A key let go while the window is not focused never sends keyup, so losing focus lets go of everything.
    const onHidden = () => { if (document.hidden) releaseAll(); };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The send loop: the held command every DRIVE_SEND_MS, then one zero when everything is let go.
  const sendRef = useRef({ onDrive, onError });
  sendRef.current = { onDrive, onError };
  useEffect(() => {
    if (!driving) return;
    let moving = false;
    let lastError = '';
    const send = (command: DriveCommand) => {
      seq.current += 1n;
      sendRef.current.onDrive(command, seq.current).then(() => { lastError = ''; }, (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) sendRef.current.onError(message); // once per new problem, not ten times a second
        lastError = message;
      });
    };
    const tick = () => {
      const command = driveCommand(heldRef.current);
      if (!isStill(command)) { send(command); moving = true; }
      else if (moving) { send(command); moving = false; }
    };
    const timer = window.setInterval(tick, DRIVE_SEND_MS);
    return () => { window.clearInterval(timer); if (moving) send(driveCommand(new Set())); };
  }, [driving]);

  const onPointerDown = (input: DriveInput | null) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (!input) { releaseAll(); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    press(input);
  };
  const onPointerEnd = (input: DriveInput | null) => () => { if (input) release(input); };
  const command = driveCommand(held);
  const status = driving
    ? `You are driving ${robotName}. Hold a button or key; let go to stop.`
    : `Waiting for ${robotName} to stop its mission and take control (robot ${robotState}).`;

  return <section className="drive-pad" aria-label={`Drive ${robotName}`}>
    <p className={`drive-status ${driving ? 'is-driving' : ''}`} role="status">{status}</p>
    <div className="drive-grid" role="group" aria-label="Driving controls">
      {PAD.flat().map((cell, index) => cell
        ? <button key={cell.label} type="button" disabled={!driving} aria-pressed={cell.input ? held.has(cell.input) : undefined}
          className={`${cell.input === null ? 'stop' : ''} ${cell.input && held.has(cell.input) ? 'is-held' : ''}`}
          onPointerDown={onPointerDown(cell.input)} onPointerUp={onPointerEnd(cell.input)} onPointerCancel={onPointerEnd(cell.input)}
          onLostPointerCapture={onPointerEnd(cell.input)} onContextMenu={(event) => event.preventDefault()}>
          <span>{cell.label}</span><kbd>{cell.keys}</kbd>
        </button>
        : <span key={`gap${index}`} aria-hidden="true" />)}
    </div>
    <p className="drive-readout" aria-live="polite">{driving ? describeCommand(command) : 'Controls unlock when the robot takes control.'}</p>
    <button type="button" className="hand-back" onClick={onHandBack}>Hand back to autonomy</button>
    <p className="feed-note">Up to 0.2 m/s and 45°/s; the robot's safety gate still applies.</p>
  </section>;
}
