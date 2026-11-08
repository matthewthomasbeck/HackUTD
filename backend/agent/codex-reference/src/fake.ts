import type { Actions, AgentName, Row } from './types.js';
import { FakeWorld } from './world.js';
export class FakeActions implements Actions {
  calls: {name:string;args:Row}[]=[];
  constructor(public w:FakeWorld,public agent:AgentName) {}
  async call(name:string,args:Row) {
    this.calls.push({name,args:structuredClone(args)});
    const rows=(table:string)=>this.w.tables[table]??=([]);
    const append=(table:string,data:Row)=>{const row:Row={id:Math.max(0,...rows(table).map(r=>r.id || 0))+1,run_id:this.w.activeRun()?.id,created_at:new Date(this.w.now()).toISOString(),...data};rows(table).push(row);return row;};
    if(name==='propose_assignment') {
      if(rows('assignment').some(a=>a.survivor_id===args.survivor_id && ['proposed','active'].includes(a.status))) throw new Error('Duplicate proposal rejected by FakeActions');
      const a=append('assignment',{...args,status:'proposed',created_by:this.agent});
      const chain=this.w.active('event_log').find(e=>e.entity_id===a.survivor_id)?.id ?? 0;
      append('agent_task',{to_agent:'auditor',from_agent:this.agent,kind:'review',status:'open',priority:'high',chain_id:chain,payload_json:JSON.stringify({assignment_id:a.id,survivor_id:a.survivor_id,rescuer_identity:a.rescuer_identity})});
    } else if(name==='post_agent_task') append('agent_task',{...args,from_agent:this.agent,status:'open'});
    else if(name==='claim_agent_task') {
      const t=rows('agent_task').find(t=>t.id===args.task_id);
      if(!t || t.to_agent!==this.agent || t.status!=='open') throw new Error('Claim rejected');
      t.status='claimed';t.lease_expires_at=new Date(this.w.now()+30000).toISOString();
    } else if(name==='complete_agent_task') {
      const t=rows('agent_task').find(t=>t.id===args.task_id);
      if(!t || t.to_agent!==this.agent || t.status!=='claimed') throw new Error('Completion rejected');
      Object.assign(t,{status:args.status,result_json:args.result_json});
      const result=JSON.parse(args.result_json);
      if(t.kind==='review' && result.verdict==='disagree') append('audit_flag',{kind:result.flag_kind || 'proposal_disagree',status:'open',filed_by:'auditor',chain_id:t.chain_id,message:result.reason});
    } else if(name==='post_briefing') append('briefing',args);
    else if(name==='create_mission') append('mission',{...args,created_by:this.agent,status:'proposed'});
    else if(name==='cancel_own_mission') {const m=rows('mission').find(m=>m.id===args.mission_id);if(m)m.status='cancelled';}
    else if(name==='set_audit_flag_status') {const f=rows('audit_flag').find(f=>f.id===args.flag_id);if(f)f.status=args.status;}
    else if(name==='log_agent_action') append('agent_action',{...args,agent:this.agent});
  }
}
export function exampleWorld(now=Date.now()) {
  const at=new Date(now).toISOString(),start=new Date(now-10000).toISOString();
  return new FakeWorld({
    run:[{id:3,site_id:1,started_at:start}],site:[{id:1,center_lat:32.9857,center_lon:-96.7502,radius_m:483,proposal_lease_s:30,agent_watchdog_s:15}],
    survivor:[{id:12,site_id:1,created_at:at,status:'unassigned',critical_level:'immediate',critical_score:78,breathing:'detected',breathing_rate:34,confidence:0.71,cell_id:4,lat:32.9861,lon:-96.7497}],
    participant:[{identity:'a'.repeat(64),name:'Private Alice',role:'rescuer',online:true,last_heartbeat:at,lat:32.9858,lon:-96.7497},{identity:'b'.repeat(64),name:'Private Bob',role:'rescuer',online:true,last_heartbeat:at,lat:32.9850,lon:-96.7497}],
    search_cell:[{id:4,site_id:1,label:'house 3',lat:32.9861,lon:-96.7497,status:'partially_searched',found:1,unaccounted:1,reported_missing:2,reported_safe:0}],
    robot:[{robot_id:'dog1',site_id:1,online:true,state:'READY',current_mission_id:0,battery:71,lat:32.9857,lon:-96.7502}],
    event_log:[{id:1042,run_id:3,kind:'survivor_created',entity_id:12}],
    assignment:[],agent_task:[],mission:[],briefing:[],agent_action:[],audit_flag:[],detection:[],device_status:[],
  },()=>now);
}
