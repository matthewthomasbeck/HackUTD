import type { Config } from './config.js';
import type { Actions,AgentConfig,Row,Trace,Wake } from './types.js';
import type { LLM } from './llm/client.js';
import { FakeWorld,WorldView } from './world.js';
import { FakeActions } from './fake.js';
import { cycle } from './loop.js';
import { tier } from './priority.js';

// Dry runs use an isolated shadow, never the live subscription cache or reducers.
export function dryActions(w:WorldView,actual:Actions,name:AgentConfig['name'],mode:Config['dryRun']) {
  if(mode==='0') return {world:w,actions:actual};
  const world=new FakeWorld(structuredClone(w.tables),w.now),shadow=new FakeActions(world,name);
  const actions:Actions={async call(tool,args) {
    if(tool==='log_agent_action') {if(mode==='log') await actual.call(tool,{...args,result:'dry_run: not executed'});return;}
    await shadow.call(tool,args);
  }};
  return {world,actions};
}
export class Runtime {
  private pending:Wake[]=[];private timer?:ReturnType<typeof setTimeout>;private running=false;private first=0;
  private timers=new Map<string,ReturnType<typeof setTimeout>>();private stopped=false;
  private tier0Since?:number;private blockHeartbeatUntil=0;
  constructor(private w:WorldView,private actions:Actions,private llm:LLM,private agent:AgentConfig,private cfg:Config,private sink:(t:Trace)=>void) {}
  wake(wake:Wake) {
    if(this.stopped) return;
    this.first ||= Date.now();
    if(wake.priority==='critical') this.tier0Since ||= Date.now();
    const priorities={critical:0,high:1,normal:2};
    // Coalesce board wakes but never discard a different task-board lease.
    const index=this.pending.findIndex(p=>wake.task_id ? p.task_id===wake.task_id : !p.task_id);
    if(index<0)this.pending.push(wake);
    else if(priorities[wake.priority]<=priorities[this.pending[index].priority])this.pending[index]=wake;
    this.pending.sort((a,b)=>priorities[a.priority]-priorities[b.priority]);
    if(this.timer) clearTimeout(this.timer);
    const delay=wake.priority==='critical'?0:Math.max(0,Math.min(this.cfg.debounceMs,this.first+this.cfg.maxWaitMs-Date.now()));
    this.timer=setTimeout(()=>void this.flush(),delay);
  }
  private async flush() {
    if(this.running || !this.pending.length || this.stopped)return;
    const wake=this.pending.shift()!;this.first=0;this.running=true;
    try {
      const runtime=dryActions(this.w,this.actions,this.agent.name,this.cfg.dryRun);
      const result=await cycle(runtime.world,runtime.actions,this.llm,this.agent,wake,this.cfg,this.sink);
      if('fallback' in result && result.fallback && this.agent.name==='orchestrator')this.blockHeartbeatUntil=Date.now()+60000;
      else if('fallback' in result && !result.fallback)this.blockHeartbeatUntil=0;
      if(!this.pending.some(p=>p.priority==='critical'))this.tier0Since=undefined;
    }catch(error){console.error(`${this.agent.name} cycle failed: ${(error as Error).message}`);}
    finally {this.running=false;if(this.pending.length) this.timer=setTimeout(()=>void this.flush(),0);}
  }
  change(table:string,row?:Row) {
    if(table==='disconnected') {this.stop();return;}
    if(!this.w.activeRun()) return;
    if(table==='ready') {
      if(this.agent.name==='orchestrator') this.wake({kind:'startup',priority:'critical'});
      for(const task of this.w.active('agent_task').filter(t=>t.to_agent===this.agent.name && t.status==='open')) this.change('agent_task',task);
      return;
    }
    if(table==='agent_task' && row?.to_agent===this.agent.name && row.status==='open') this.wake({kind:row.kind,priority:row.priority,task_id:row.id,chain_id:row.chain_id});
    if(this.agent.name==='orchestrator' && ['survivor','audit_flag','person_report','search_cell'].includes(table)) this.wake({kind:table,priority:table==='survivor' && row && tier(row)===0?'critical':'high',survivor_id:table==='survivor'?row?.id:undefined});
    if(this.agent.name==='orchestrator' && table==='assignment' && row && ['released','completed'].includes(row.status)) this.wake({kind:'rescuer_available',priority:'high'});
    if(this.agent.name==='comms_agent' && table==='assignment' && row) {
      if(row.status==='proposed') {
        const id=row.id;
        this.once(`brief-${id}`,5000,()=>{
          const a=this.w.assignment(id);
          if(a?.status==='proposed' && !this.w.active('agent_task').some(t=>t.kind==='brief_rescuer' && JSON.parse(t.payload_json).assignment_id===id)) this.wake({kind:'brief_rescuer',priority:'critical',assignment_id:id,survivor_id:a.survivor_id});
        });
        const site=this.w.rows('site').find(s=>s.id===this.w.activeRun()?.site_id);
        this.once(`nudge-${id}`,Number(site?.proposal_lease_s || 30)*500,()=>{if(this.w.assignment(id)?.status==='proposed')this.wake({kind:'nudge',priority:'high',assignment_id:id});});
      }else if(row.status==='active') this.wake({kind:'navigation',priority:'high',assignment_id:row.id});
    }
  }
  private once(key:string,ms:number,callback:()=>void) {if(this.timers.has(key))return;this.timers.set(key,setTimeout(()=>{this.timers.delete(key);if(!this.stopped)callback();},ms));}
  async heartbeat() {
    if(this.cfg.dryRun!=='0' || this.stopped) return;
    if(this.agent.name==='orchestrator' && (Date.now()<this.blockHeartbeatUntil || this.llm.isDown(this.agent.name) || this.tier0Since && Date.now()-this.tier0Since>8000)) return;
    await this.actions.call('agent_heartbeat',{});
  }
  stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
}
