import { countdownForDueAt } from '../model/timers';
import { formatCountdown, type TimestampLike } from '../stdb/time';

export function Countdown({ dueAt, now, label }: { dueAt: TimestampLike; now: number; label: string }) {
  const countdown = countdownForDueAt(dueAt, now);
  return (
    <span className={`countdown ${countdown.state}`}>
      <span>{label}</span>
      <strong>{formatCountdown(countdown.remainingMs)}</strong>
      <small>{countdown.source}</small>
    </span>
  );
}
