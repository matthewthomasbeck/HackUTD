import type { Actions, AgentName, Row } from './types.js';
import type { WorldView } from './world.js';
export async function claim(w: WorldView, actions: Actions, name: AgentName, id: number) {
  const task=w.active('agent_task').find(t=>t.id===id && t.to_agent===name && t.status==='open');
  if(!task) throw new Error('Task is not open for this agent');
  await actions.call('claim_agent_task',{task_id:id});
  return w.active('agent_task').find(t=>t.id===id) || task;
}
export async function complete(actions: Actions, id: number, result: Row, failed=false) {
  const result_json=JSON.stringify(result);
  if(result_json.length>2000) throw new Error('Task result exceeds 2000 characters');
  await actions.call('complete_agent_task',{task_id:id,status:failed?'failed':'done',result_json});
}
