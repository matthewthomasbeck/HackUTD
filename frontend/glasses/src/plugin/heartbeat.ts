// {"type":"heartbeat"} every 5 s while the socket is open (CONTRACTS.md glasses protocol).
// The service forwards each one as rescuer_heartbeat; the module's heartbeat_timer checks the glasses are really there.
import type { ServiceSocket } from './socket';

export const HEARTBEAT_MS = 5000;

/**
 * Starts the timer and returns a stop function.
 * `disabled` is the test flag from glasses.md 8.2 step 7 (`?noheartbeat=1`): the socket stays open but no heartbeat goes out.
 */
export function startHeartbeat(socket: Pick<ServiceSocket, 'isOpen' | 'send'>, disabled = false, intervalMs = HEARTBEAT_MS): () => void {
  if (disabled) {
    console.warn('[heartbeat] disabled by ?noheartbeat=1');
    return () => {};
  }
  const timer = setInterval(() => {
    if (socket.isOpen()) socket.send({ type: 'heartbeat' });
  }, intervalMs);
  return () => clearInterval(timer);
}
