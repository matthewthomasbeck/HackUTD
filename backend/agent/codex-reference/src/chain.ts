import type { Wake } from './types.js';
import type { WorldView } from './world.js';
export function chainId(w: WorldView, wake: Wake) {
  if (wake.chain_id) return wake.chain_id;
  const task = w.active('agent_task').find(t => t.id === wake.task_id);
  if (task?.chain_id) return task.chain_id;
  const id = wake.survivor_id ?? w.assignment(wake.assignment_id ?? 0)?.survivor_id;
  return w.active('event_log').find(e => e.kind === 'survivor_created' && (e.entity_id === id || e.survivor_id === id))?.id ?? 0;
}
