import type { Actions, AgentConfig, Row, Trace, Wake } from '../types.js';
import type { WorldView } from '../world.js';
import { guard,forbidden } from '../guards.js';
import { validators } from './schemas.js';
import { readTool } from './reads.js';
import { writeTool } from './writes.js';
// Cycle dispatchers are short lived; rate limits must survive their replacement.
const lastSitreps = new WeakMap<WorldView, number>();
export class Dispatcher {
  private briefings=0;
  constructor(public w:WorldView,public actions:Actions,public agent:AgentConfig,public wake:Wake,public chain:number,private sink:(trace:Trace)=>void,private model=agent.model) {}
  async run(tool:string,input:Row,step=1) {
    const a={...input};
    for(const field of ['rescuer_identity','audience']) {
      const rescuer=this.w.rescuers().find(r=>r.callsign===a[field]); if(rescuer) a[field]=rescuer.identity;
    }
    let result: Row;
    try {
      if(!this.agent.tools.includes(tool)) throw new Error('unknown tool');
      const validate=validators[tool];
      if(!validate?.(a)) throw new Error(`invalid arguments: ${JSON.stringify(validate?.errors)}`);
      guard(this.w,this.agent.name,tool,a,this.wake);
      if(tool==='send_briefing' && this.briefings>=2) throw new Error('At most 2 briefings per cycle');
      if(tool==='sitrep' && this.w.now()-(lastSitreps.get(this.w) ?? -Infinity)<300000) throw new Error('Sitrep limited to once per 5 minutes');
      const value=readTool(this.w,tool,a);
      result={ok:true,result:value!==undefined?value:await writeTool(this.w,this.actions,tool,a,this.wake,this.chain)};
      if(tool==='send_briefing') this.briefings++;
      if(tool==='sitrep') lastSitreps.set(this.w,this.w.now());
    } catch(error) {result={ok:false,error:(error as Error).message};}
    const entry={agent:this.agent.name,model:this.model,tool,args:a,result,reason:String(a.reason || 'invalid call').slice(0,140),step,chain_id:this.chain};
    this.sink(entry);
    // Log through the same action boundary, including dry-run policy.
    try {
      const scrub=(value:string)=>value.replace(new RegExp(forbidden.source,'gi'),'[redacted wording]');
      const args=scrub(JSON.stringify(a));
      await this.actions.call('log_agent_action',{tool,args_json:args.length<=1000?args:JSON.stringify({truncated:args.slice(0,950)}),result:scrub((result.ok?'ok: ':'error: ')+JSON.stringify(result).slice(0,280)),reason:scrub(entry.reason),step,model:this.model,chain_id:this.chain});
    } catch { /* A logging failure never restarts a tool or cycle. */ }
    return result;
  }
}
