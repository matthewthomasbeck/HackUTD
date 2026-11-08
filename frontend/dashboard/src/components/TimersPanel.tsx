import { buildTimerItems, timerText } from '../model/timers';
import { useBoard } from '../data/LiveSource';

export function TimersPanel() {
  const board = useBoard();
  const timers = buildTimerItems(board);
  return <section className="panel detail-tab-panel" aria-labelledby="timers-title">
    <div className="panel-heading"><div><p className="eyebrow">DATABASE SCHEDULES</p><h2 id="timers-title">Timers</h2></div><span className="count-pill">{timers.length} running</span></div>
    <p className="panel-hint">Countdowns refresh four times per second. Schedule rows are the source when present; entity timestamps are shown as derived fallbacks.</p>
    <ul className="timer-list">{timers.map((timer) => <li className={`timer-row ${timer.state}`} key={timer.id}>
      <span className="timer-led" aria-hidden="true" /><strong>{timerText(timer)}</strong><span className="source-chip">{timer.source}</span>
    </li>)}</ul>
    {timers.length === 0 && <p className="empty-state">No active timers.</p>}
  </section>;
}
