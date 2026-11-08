import type { Config } from './config.js';
import type { Actions, AgentConfig, Row, Trace, Wake } from './types.js';
import type { WorldView } from './world.js';
import type { LLM } from './llm/client.js';
import { chainId } from './chain.js';
import { claim,complete } from './board.js';
import { Dispatcher } from './tools/dispatch.js';
import { toolDefinitions } from './tools/schemas.js';
import { reviewRules,continueMission } from './rules.js';
import { answerTemplate,briefingTemplate,navigationTemplate,nudgeTemplate,short } from './templates.js';

export async function cycle(w:WorldView,actions:Actions,llm:LLM,agent:AgentConfig,wake:Wake,cfg:Config,sink:(trace:Trace)=>void) {
  if(!w.activeRun()) return {skipped:'no active run'};
  if(wake.kind==='answer_rescuer' && !cfg.questions) return {skipped:'questions disabled'};
  let task=w.active('agent_task').find(t=>t.id===wake.task_id);
  if(task) {try {task=await claim(w,actions,agent.name,task.id);} catch {return {skipped:'claim failed'};}}
  const chain=chainId(w,wake);
  const deadline=task?.lease_expires_at ? Date.parse(task.lease_expires_at)-5000 : Date.now()+Math.min(agent.maxSteps*agent.timeoutMs,60000);
  const stale=Boolean(task && w.now()-Date.parse(task.created_at)>120000);
  const payload=task?JSON.parse(task.payload_json):{};
  const results:Row[]=[];
  const dispatch=new Dispatcher(w,actions,agent,wake,chain,sink);
  const summary=async (text:string,model=agent.model) => {sink({agent:agent.name,model,tool:'cycle_summary',args:{},result:text,reason:'Cycle finished',step:0,chain_id:chain});};
  const fallback=async () => {
    const d=new Dispatcher(w,actions,agent,wake,chain,sink,'rules');
    let result:Row={fallback:true,...(stale?{stale:true}:{})};
    if(agent.name==='orchestrator') {
      const mission=continueMission(w);if(mission) results.push(await d.run('create_mission',mission));
      // Only the database watchdog proposes when the orchestrator cannot act.
      sink({agent:agent.name,model:'rules',tool:'model_down',args:{},result:'Heartbeat stopped; database watchdog owns assignment fallback',reason:'[fallback] model unavailable or cycle limit reached',step:0,chain_id:chain});
    } else if(agent.name==='auditor' && task) {
      const assignment=w.assignment(payload.assignment_id);
      if(assignment) result={...result,...reviewRules(w,assignment)};
      else result={...result,error:'Assignment no longer in active run'};
      if(result.verdict) {results.push(await d.run('submit_review',{verdict:result.verdict,reason:`[fallback] ${result.reason}`,...(result.flag_kind?{flag_kind:result.flag_kind,suggested_action:result.suggested_action}:{})}));}
    } else if(agent.name==='comms_agent') {
      const assignment=w.assignment(payload.assignment_id ?? wake.assignment_id ?? 0);
      const survivor=w.survivor(payload.survivor_id ?? wake.survivor_id ?? assignment?.survivor_id);
      const cell=w.active('search_cell').find(c=>c.id===survivor?.cell_id);
      const note=w.active('detection').find(d=>d.survivor_id===survivor?.id)?.location_note || '';
      let text=wake.kind==='answer_rescuer'?answerTemplate(cell):wake.kind==='nudge'?nudgeTemplate(cell):wake.kind==='navigation'?navigationTemplate(cell,note,w.active('robot')[0]?.terrain_class):survivor?briefingTemplate(survivor,cell,note):'Board details unavailable. Ask coordinator.';
      if(wake.kind==='sitrep') text=short([`${payload.counts?.found ?? 0} found, ${payload.counts?.unassigned ?? 0} unassigned.`,`${payload.counts?.unaccounted ?? 0} unaccounted.`]);
      const audience=payload.audience ?? payload.rescuer_identity ?? assignment?.rescuer_identity;
      if(audience) {
        const r=await d.run('send_briefing',{audience,text,priority:survivor?.critical_level==='immediate'?'critical':'info',...(survivor?{survivor_id:survivor.id}:{}),reason:'[fallback] Brief from current board facts'});
        results.push(r);if(r.ok) result={...result,...r.result};
      }
    }
    if(task && w.active('agent_task').find(t=>t.id===task!.id)?.status==='claimed') await complete(actions,task.id,result);
    await summary('Deterministic fallback completed','rules');return {fallback:true,results};
  };
  if(stale || (agent.name==='comms_agent' && (!cfg.commsModel || ['nudge'].includes(wake.kind))) || (agent.name==='auditor' && !cfg.auditorModel)) return fallback();
  const packet={wake,task:payload,chain_id:chain,board:w.board(),rescuer_distances:wake.survivor_id?w.rescuers(w.survivor(wake.survivor_id)):undefined,rule_checks:agent.name==='auditor' && payload.assignment_id?reviewRules(w,w.assignment(payload.assignment_id)!):undefined};
  const jsonMode=(agent.name==='orchestrator'?cfg.toolModeSuper:cfg.toolModeNano)==='json';
  const prompt=agent.prompt+(jsonMode?'\nReply with exactly one JSON object: {"actions":[{"tool":"name","args":{"reason":"facts",...}}]} or {"done":true,"summary":"one line"}. At most 3 actions. Every args includes reason. Catalog: '+JSON.stringify(toolDefinitions(agent.tools)):'');
  const messages:any[]=[{role:'system',content:prompt},{role:'user',content:JSON.stringify(w.modelPacket(packet))}];
  let calls=0,parseFailures=0;
  for(let step=1;step<=agent.maxSteps;step++) {
    if(Date.now()>=deadline || llm.isDown(agent.name)) return fallback();
    let response;
    try {response=await llm.request(agent,messages,wake,deadline);} catch(error) {
      if(/JSON|balanced|actions|action|Reply|Unexpected|args.reason/.test((error as Error).message) && parseFailures++===0) {messages.push({role:'user',content:'Reply with one JSON object only.'});continue;}
      return fallback();
    }
    messages.push(response.message);
    if(response.reply.done || !response.reply.actions.length) {
      if(agent.name==='orchestrator') for(const assignment of w.active('assignment').filter(a=>a.created_by==='orchestrator' && a.status==='proposed')) {
        if(!w.active('agent_task').some(t=>t.kind==='brief_rescuer' && JSON.parse(t.payload_json).assignment_id===assignment.id)) {
          results.push(await dispatch.run('delegate',{to_agent:'comms_agent',kind:'brief_rescuer',priority:'critical',assignment_id:assignment.id,survivor_id:assignment.survivor_id,reason:'Brief the rescuer after the proposal'},step));
        }
      }
      if(task && w.active('agent_task').find(t=>t.id===task!.id)?.status==='claimed') await complete(actions,task.id,{summary:response.reply.summary || 'done',fallback:false});
      await summary(response.reply.summary || 'done');return {fallback:false,results};
    }
    const toolResults=[];
    for(let i=0;i<response.reply.actions.length;i++) {
      if(++calls>agent.maxToolCalls || Date.now()>=deadline) return fallback();
      const action=response.reply.actions[i],result=await dispatch.run(action.tool,action.args,step);results.push(result);toolResults.push({tool:action.tool,...result});
      const nativeCall=response.message.tool_calls?.[i];
      if(nativeCall) messages.push({role:'tool',tool_call_id:nativeCall.id,content:JSON.stringify(w.modelPacket(result))});
    }
    if(!response.message.tool_calls?.length) messages.push({role:'user',content:'TOOL_RESULTS '+JSON.stringify(w.modelPacket(toolResults))});
  }
  return fallback();
}
