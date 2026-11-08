import type { Actions, Row, Wake } from '../types.js';
import type { WorldView } from '../world.js';
export async function writeTool(w: WorldView,actions: Actions,tool:string,a:Row,wake:Wake,chain:number) {
  if(tool==='propose_assignment') {
    await actions.call(tool,a);
    const assignment=w.active('assignment').find(x=>x.survivor_id===a.survivor_id && x.status==='proposed');
    return {assignment_id:assignment?.id, pending_cache:!assignment};
  }
  if(tool==='delegate') {
    const assignment=w.assignment(a.assignment_id)!;
    const payload={chain_id:chain,assignment_id:assignment.id,survivor_id:assignment.survivor_id,rescuer_identity:assignment.rescuer_identity,why:a.reason};
    await actions.call('post_agent_task',{to_agent:a.to_agent,kind:a.kind,payload_json:JSON.stringify(payload),priority:a.priority,reason:a.reason,chain_id:chain});
    return {delegated:true};
  }
  if(tool==='submit_review') {
    const {reason,verdict,flag_kind,suggested_action}=a;
    await actions.call('complete_agent_task',{task_id:wake.task_id,status:'done',result_json:JSON.stringify({reason,verdict,...(verdict==='disagree'?{flag_kind:flag_kind || 'proposal_disagree',suggested_action}:{})})});
    return {verdict};
  }
  if(tool==='send_briefing') {
    const kind=({navigation:'nav',nudge:'nudge',answer_rescuer:'answer'} as Row)[wake.kind] || 'briefing';
    await actions.call('post_briefing',{audience:a.audience,text:a.text,priority:a.priority,survivor_id:a.survivor_id,kind});
    return {text:a.text,briefing_id:[...w.active('briefing')].reverse().find(b=>b.audience===a.audience && b.text===a.text)?.id};
  }
  if(tool==='set_flag_status') { await actions.call('set_audit_flag_status',{flag_id:a.flag_id,status:a.status}); return {status:a.status}; }
  if(tool==='create_mission') {await actions.call(tool,{...a,target_cell_ids:a.target_cell_ids || [],chain_id:chain});return {created:true};}
  if(tool==='cancel_own_mission') {await actions.call(tool,{mission_id:a.mission_id});return {cancelled:true};}
  if(tool==='sitrep') {
    await actions.call('post_agent_task',{to_agent:'comms_agent',kind:'sitrep',priority:'normal',payload_json:JSON.stringify({audience:a.audience,counts:{found:w.active('survivor').length,unassigned:w.pending().length,unaccounted:w.cells().reduce((sum,c)=>sum+c.unaccounted,0)}}),reason:a.reason,chain_id:chain});return {delegated:true};
  }
  throw new Error('unknown tool');
}
