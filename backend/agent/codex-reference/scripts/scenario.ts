import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { exampleWorld,FakeActions } from '../src/fake.js';
import { MockLLM } from '../src/llm/client.js';
import { agentConfig } from '../src/agents/index.js';
import { cycle } from '../src/loop.js';
import { trace } from '../src/log.js';
import { tier } from '../src/priority.js';
import { reviewRules } from '../src/rules.js';
import { guard } from '../src/guards.js';

export async function runScenario(name:string) {
  console.log('FIXTURE SCENARIO: deterministic inputs, no NVIDIA requests, no live database writes.');
  const cfg=loadConfig({...process.env,LLM_MODE:'mock',ENABLE_COMMS_MODEL:'0',ENABLE_AUDITOR_MODEL:'0'}),w=exampleWorld();
  if(['kill_orchestrator','all_down'].includes(name)) throw new Error(`${name} requires Cayden's running SpacetimeDB module and simulator; not simulated or claimed as passed here.`);
  if(name==='priority') {
    w.tables.survivor.push({...w.tables.survivor[0],id:13,critical_level:'delayed',critical_score:1,breathing:'not_detected'});
    w.tables.survivor[0].critical_level='delayed';w.tables.survivor[0].breathing='detected';
    if(w.pending()[0].id!==13 || tier(w.pending()[0])!==0)throw new Error('Priority scenario failed');
  }else if(name==='race') {
    w.tables.assignment.push({id:55,survivor_id:12,status:'proposed',created_by:'module',rescuer_identity:'a'.repeat(64)});
    try{guard(w,'orchestrator','propose_assignment',{survivor_id:12,rescuer_identity:'a'.repeat(64),reason:'Nearest rescuer'}, {kind:'survivor',priority:'critical'});throw new Error('Duplicate not rejected');}
    catch(error){if((error as Error).message!=='already proposed by watchdog')throw error;}
  }else if(name==='auditor_disagrees') {
    const result=reviewRules(w,{survivor_id:12,rescuer_identity:'b'.repeat(64)});
    if(result.verdict!=='disagree')throw new Error('Expected a disagreement');
  }else if(name==='budget') {
    console.log('Budget time-window and priority behavior are exercised by npm test with fake timers.');
  }else if(['chain','comms_fallback'].includes(name)) {
    const fixture=JSON.parse(readFileSync(new URL('../test/fixtures/chain.json',import.meta.url),'utf8'));
    const llm=new MockLLM(fixture);
    await cycle(w,new FakeActions(w,'orchestrator'),llm,agentConfig('orchestrator',cfg),{kind:'survivor',priority:'critical',survivor_id:12},cfg,trace);
    for(const task of [...w.tables.agent_task]) {
      await cycle(w,new FakeActions(w,task.to_agent),llm,agentConfig(task.to_agent,cfg),{kind:task.kind,priority:task.priority,task_id:task.id,chain_id:task.chain_id},cfg,trace);
    }
    if(w.tables.assignment.length!==1 || w.tables.assignment[0].rescuer_identity!=='a'.repeat(64))throw new Error('Expected nearest rescuer A proposal');
    if(!w.tables.mission.some(m=>m.kind==='inspect'))throw new Error('Missing inspect mission');
    if(!w.tables.briefing.length || w.tables.agent_task.some(t=>t.status!=='done'))throw new Error('Chain incomplete');
    if(w.tables.agent_action.some(a=>a.chain_id!==1042))throw new Error('Chain provenance missing');
  }else throw new Error(`Unknown scenario ${name}`);
  const report={scenario:name,status:'passed',scope:'in-memory fixture only; no live database or NVIDIA verification',proposals:w.tables.assignment.length,tasks:w.tables.agent_task.length,briefings:w.tables.briefing.length};
  console.log(JSON.stringify(report));return {world:w,report};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await runScenario(process.argv[2] || 'chain');
