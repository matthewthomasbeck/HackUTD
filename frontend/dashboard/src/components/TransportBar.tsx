import { useMemo } from 'react';
import { useBoard } from '../data/LiveSource';
import { formatDuration, timestampToMs } from '../stdb/time';
import { formatReplayTime } from '../replay/player';
import { useReplayControls } from '../data/ReplaySource';

type Props = { readOnly: boolean; view: 'live' | 'replay'; onStart: () => void; onEnd: () => void; onSync: (text: string) => void };

function syncSentAt(text: string, nowMs: number) {
  const match = text.match(/ at (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return nowMs;
  const date = new Date(nowMs); date.setHours(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]));
  const estimate = date.getTime();
  return estimate > nowMs + 12 * 60 * 60 * 1000 ? estimate - 24 * 60 * 60 * 1000 : estimate;
}

function clockStamp(milliseconds: number) {
  const date = new Date(milliseconds);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function TransportBar({ readOnly, view, onStart, onEnd, onSync }: Props) {
  const board = useBoard();
  const replay = useReplayControls();
  const run = board.run;
  const events = useMemo(() => board.events.filter((event) => run && event.runId === run.id).sort((a, b) => timestampToMs(a.createdAt) - timestampToMs(b.createdAt)), [board.events, run]);
  const lastChange = events.at(-1);
  const syncBriefing = board.briefings.filter((row) => row.text.startsWith('Sync test from ')).slice().sort((a, b) => timestampToMs(a.createdAt) - timestampToMs(b.createdAt)).at(-1);
  const receivedMs = syncBriefing ? Math.max(0, board.now - syncSentAt(syncBriefing.text, board.now)) : 0;
  const duration = run ? Math.max(1, (timestampToMs(run.endedAt ?? board.now) - timestampToMs(run.startedAt))) : 0;
  if (view === 'replay' && replay) {
    const replayDuration = Math.max(1, replay.endMs - replay.startMs);
    const position = Math.min(100, Math.max(0, (replay.currentMs - replay.startMs) / replayDuration * 100));
    return <section className="transport-bar replay" aria-label="Replay transport">
      <div className="transport-main replay-main">
        <span className="transport-mode replay">REPLAY</span>
        <div className="transport-run"><strong>{run?.name ?? 'Run unavailable'}</strong><span>{formatReplayTime(replay.currentMs - replay.startMs)} / {formatReplayTime(replay.endMs - replay.startMs)}</span></div>
        <div className="transport-actions replay-actions">
          <button className="button primary" onClick={replay.togglePlaying} disabled={!run || replay.endMs <= replay.startMs}>{replay.isPlaying ? 'Pause' : 'Play'}</button>
          {([1, 4, 16] as const).map((rate) => <button key={rate} className={`button secondary ${replay.speed === rate ? 'selected' : ''}`} aria-pressed={replay.speed === rate} onClick={() => replay.setSpeed(rate)}>{rate}x</button>)}
          <button className="button secondary" onClick={replay.backToLive}>Back to live</button>
        </div>
      </div>
      <div className="replay-scrubber" aria-label="Replay timeline">
        <input type="range" aria-label="Seek replay time" min={replay.startMs} max={Math.max(replay.startMs + 1, replay.endMs)} value={Math.min(replay.currentMs, Math.max(replay.startMs + 1, replay.endMs))} onChange={(event) => replay.seek(Number(event.target.value))} />
        <span className="replay-scrubber-fill" style={{ inlineSize: `${position}%` }} />
        {replay.history.map((item, index) => {
          const tickPosition = Math.min(100, Math.max(0, (item.createdAtMs - replay.startMs) / replayDuration * 100));
          return <button key={`${item.source}:${item.id}:${index}`} className={`replay-tick ${replayTickClass(item)}`} style={{ insetInlineStart: `${tickPosition}%` }} title={item.message ?? item.kind} aria-label={`Seek before ${item.message ?? item.kind}`} onClick={() => replay.seek(Math.max(replay.startMs, item.createdAtMs - 1_000))} />;
        })}
        <span className="replay-playhead" style={{ insetInlineStart: `${position}%` }} />
      </div>
      {replay.malformedCount > 0 && <p className="replay-warning" role="status">{replay.malformedCount} events could not be read</p>}
      {!run && <p className="empty-state">No run matched the replay URL. Choose a valid run id.</p>}
    </section>;
  }
  return <section className={`transport-bar ${view}`} aria-label="Live run transport">
    <div className="transport-main">
      <span className={`transport-mode ${view}`}>{view.toUpperCase()}</span>
      <div className="transport-run"><strong>{run?.name ?? 'No run recording'}</strong><span>{run ? formatDuration(board.now - timestampToMs(run.startedAt)) : 'Start a run to record this incident'}</span></div>
      {run ? <span className="count-pill">{events.length} events</span> : <button className="button primary" disabled={readOnly || !board.site} onClick={onStart}>Start run</button>}
      <div className="transport-actions">
        <button className="button secondary" disabled={readOnly} onClick={() => {
          const date = new Date();
          const stamp = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
          onSync(`Sync test from SCREEN ${new URLSearchParams(window.location.search).get('screen') || 'A'} at ${stamp}`);
        }}>Sync test</button>
        {run && <button className="button secondary" disabled={readOnly} onClick={onEnd}>End run</button>}
      </div>
    </div>
    {run && <div className="transport-timeline" aria-label={`${events.length} events during this run`}>
      <span className="timeline-track" />{events.map((event) => {
        const elapsed = Math.max(0, timestampToMs(event.createdAt) - timestampToMs(run.startedAt));
        const percent = Math.min(100, elapsed / duration * 100);
        return <span key={event.id.toString()} className={`timeline-tick ${event.kind}`} style={{ insetInlineStart: `${percent}%` }} title={event.message} />;
      })}
      <span className="timeline-playhead" />
    </div>}
    <div className="transport-foot"><span>Last change {lastChange ? `${clockStamp(timestampToMs(lastChange.createdAt))}, ${lastChange.entity} #${lastChange.entityId}` : 'waiting for first event'}</span>
      {syncBriefing && <span className="sync-confirmation">{syncBriefing.text} · received about {receivedMs} ms after it was sent</span>}
    </div>
  </section>;
}

function replayTickClass(item: { source: string; kind: string }) {
  if (item.source === 'detection' || item.kind === 'survivor_created') return 'detection';
  if (item.kind === 'escalation' || item.kind === 'escalation_commander') return 'escalation';
  if (item.kind === 'assignment_released' || item.kind === 'assignment_expired') return 'release';
  if (item.kind === 'agent_watchdog_fallback') return 'watchdog';
  if (item.kind === 'audit_flag') return 'audit';
  if (item.kind === 'robot_offline') return 'offline';
  if (item.kind === 'survivor_resolved') return 'resolved';
  return 'other';
}
