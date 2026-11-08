import { afterEach,describe,expect,it,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../src/llm/parse.js';
import { Budget } from '../src/llm/budget.js';
import { exampleWorld,FakeActions } from '../src/fake.js';
import { tier } from '../src/priority.js';
import { briefing,guard } from '../src/guards.js';
import { chainId } from '../src/chain.js';
import { answerTemplate,briefingTemplate,navigationTemplate,nudgeTemplate } from '../src/templates.js';
import { reviewRules } from '../src/rules.js';
import { loadConfig } from '../src/config.js';
import { agentConfig } from '../src/agents/index.js';
import { Dispatcher } from '../src/tools/dispatch.js';
import { MockLLM } from '../src/llm/client.js';
import { cycle } from '../src/loop.js';
import { dryActions } from '../src/runtime.js';
import { plain } from '../src/stdb/convert.js';
import { encode } from '../src/stdb/connect.js';
const cfg=()=>loadConfig({LLM_MODE:'mock',ENABLE_COMMS_MODEL:'0',ENABLE_AUDITOR_MODEL:'0'});
const wake={kind:'survivor',priority:'critical' as const,survivor_id:12};
describe('strict JSON replies',()=>{
  const action={actions:[{tool:'get_board',args:{reason:'Read latest board'}}]};
  for(const text of [JSON.stringify(action),'```json\n'+JSON.stringify(action)+'\n```','<think>{bad}</think>'+JSON.stringify(action),JSON.stringify({name:'get_board',arguments:{reason:'Read latest board'}})])it('accepts supported format',()=>expect(parse(text).actions[0].tool).toBe('get_board'));
  it('handles braces in strings',()=>expect(parse('{"done":true,"summary":"a } brace"}').summary).toBe('a } brace'));
  it('rejects garbage and excess actions',()=>{expect(()=>parse('garbage')).toThrow();expect(()=>parse(JSON.stringify({actions:Array(4).fill(action.actions[0])}))).toThrow();});
});
describe('priority and active run',()=>{
  it('never lowers unclear breathing',()=>{expect(tier({critical_level:'delayed',breathing:'not_detected'})).toBe(0);expect(tier({critical_level:'unknown',breathing:'detected'})).toBe(0);});
  it('sorts score then age and ignores earlier runs',()=>{const w=exampleWorld();w.tables.survivor.push({...w.tables.survivor[0],id:13,critical_score:99});expect(w.pending()[0].id).toBe(13);w.tables.survivor[1].created_at='2000-01-01';expect(w.pending().map(s=>s.id)).toEqual([12]);});
  it('uses event chain and preserves task chain',()=>{const w=exampleWorld();expect(chainId(w,wake)).toBe(1042);expect(chainId(w,{...wake,chain_id:900})).toBe(900);});
  it('keeps private identities and names out of model packets',()=>{const w=exampleWorld();const packet=JSON.stringify(w.modelPacket({identity:'a'.repeat(64),note:'Private Alice email person@example.com',rescuer_name:'Private Bob',audio_url:'http://private'}));expect(packet).not.toContain('Private Alice');expect(packet).not.toContain('a'.repeat(64));expect(packet).not.toContain('person@example.com');expect(packet).toContain('Rescuer A');});
  it('normalizes edge types and refuses precision loss',()=>{expect(plain({criticalLevel:{tag:'Immediate'},id:2n,state:{tag:'READY'}})).toEqual({critical_level:'immediate',id:2,state:'READY'});expect(()=>plain(2n**60n)).toThrow();expect(encode('propose_assignment',{survivor_id:12,rescuer_identity:'a'.repeat(64)}).survivorId).toBe(12n);});
});
describe('guards',()=>{
  it('rejects unsafe wording, length, newlines, and false resolution',()=>{for(const text of ['possibly dead','x'.repeat(121),'hello\nthere','rescued now','safe now'])expect(()=>briefing(text)).toThrow();});
  it('accepts factual uncertain wording',()=>expect(()=>briefing('IMMEDIATE house 3: breathing not seen, low confidence.')).not.toThrow());
  it('allows the nearest rescuer once, then blocks the race',async()=>{const w=exampleWorld();const args={survivor_id:12,rescuer_identity:'a'.repeat(64),reason:'Nearest free rescuer'};expect(()=>guard(w,'orchestrator','propose_assignment',args,wake)).not.toThrow();await new FakeActions(w,'orchestrator').call('propose_assignment',args);expect(()=>guard(w,'orchestrator','propose_assignment',args,wake)).toThrow('already');});
  it('rejects lower priority assignment while urgent people wait',()=>{const w=exampleWorld();w.tables.survivor.push({...w.tables.survivor[0],id:13,critical_level:'delayed',breathing:'detected'});expect(()=>guard(w,'orchestrator','propose_assignment',{survivor_id:13,rescuer_identity:'a'.repeat(64),reason:'Nearest'},wake)).toThrow('Higher-tier');});
  it('rejects stale rescuers',()=>{const w=exampleWorld();w.tables.participant[0].last_heartbeat='2000-01-01';expect(()=>guard(w,'orchestrator','propose_assignment',{survivor_id:12,rescuer_identity:'a'.repeat(64),reason:'Nearest'},wake)).toThrow('unavailable');});
  it('rejects wrong agent tools before execution',async()=>{const w=exampleWorld(),actions=new FakeActions(w,'comms_agent');const result=await new Dispatcher(w,actions,agentConfig('comms_agent',cfg()),wake,1042,()=>{}).run('propose_assignment',{survivor_id:12,rescuer_identity:'a'.repeat(64),reason:'Nearest'});expect(result.error).toBe('unknown tool');expect(w.tables.assignment).toHaveLength(0);});
  it('rejects briefings for a different rescuer assignment',()=>{const w=exampleWorld();expect(()=>guard(w,'comms_agent','send_briefing',{audience:'b'.repeat(64),text:'IMMEDIATE house 3',survivor_id:12},wake)).toThrow('does not hold');});
  it('rejects searched cells, offline robots, and another creator mission',()=>{const w=exampleWorld();w.tables.search_cell[0].status='searched';expect(()=>guard(w,'orchestrator','create_mission',{robot_id:'dog1',kind:'search_cells',target_cell_ids:[4],reason:'Continue search'},wake)).toThrow('searched');w.tables.robot[0].online=false;expect(()=>guard(w,'orchestrator','create_mission',{robot_id:'dog1',kind:'inspect',target_lat:32.9861,target_lon:-96.7497,reason:'Inspect'},wake)).toThrow('offline');w.tables.mission.push({id:1,created_by:'module',status:'queued'});expect(()=>guard(w,'orchestrator','cancel_own_mission',{mission_id:1,reason:'Cancel'},wake)).toThrow('another');});
  it('allows an inspect mission and rejects unjustified hold',()=>{const w=exampleWorld();expect(()=>guard(w,'orchestrator','create_mission',{robot_id:'dog1',kind:'inspect',target_lat:32.9861,target_lon:-96.7497,reason:'Inspect unaccounted person'},wake)).not.toThrow();expect(()=>guard(w,'orchestrator','create_mission',{robot_id:'dog1',kind:'hold',reason:'Hold for now'},wake)).toThrow('low battery');});
});
describe('rules and templates',()=>{
  it('objects to a much farther choice without blocking it',()=>{const w=exampleWorld();expect(reviewRules(w,{survivor_id:12,rescuer_identity:'b'.repeat(64)}).verdict).toBe('disagree');expect(w.tables.assignment).toHaveLength(0);});
  it('templates stay ASCII and at most 120 with long notes',()=>{const w=exampleWorld(),s=w.tables.survivor[0],c=w.tables.search_cell[0];for(const text of [briefingTemplate(s,c,'note '.repeat(100)),answerTemplate(c),navigationTemplate(c,'x'.repeat(200),'gap'),nudgeTemplate(c)])expect(()=>briefing(text)).not.toThrow();});
});
describe('shared request budget',()=>{
  afterEach(()=>vi.useRealTimers());
  it('sends at most 20 in the first rolling minute',async()=>{vi.useFakeTimers();const b=new Budget(20),sent:number[]=[];const requests=Array.from({length:25},()=>b.acquire('auditor','normal',Date.now()+120000).then(()=>sent.push(Date.now())));await vi.advanceTimersByTimeAsync(0);expect(sent).toHaveLength(20);await vi.advanceTimersByTimeAsync(59999);expect(sent).toHaveLength(20);await vi.advanceTimersByTimeAsync(1);await Promise.all(requests);expect(sent).toHaveLength(25);b.close();});
  it('critical orchestrator jumps normal auditor and stale requests reject',async()=>{vi.useFakeTimers();const b=new Budget(1),order:string[]=[];const a=b.acquire('auditor','normal',Date.now()+1000).then(()=>order.push('auditor')).catch(()=>order.push('expired'));const c=b.acquire('orchestrator','critical',Date.now()+2000).then(()=>order.push('orchestrator'));await vi.advanceTimersByTimeAsync(0);expect(order).toEqual(['orchestrator']);await vi.advanceTimersByTimeAsync(1001);await Promise.all([a,c]);expect(order).toEqual(['orchestrator','expired']);b.close();});
});
describe('runner integration with fixtures',()=>{
  it('limits sitreps across separate cycles',async()=>{
    const w=exampleWorld(),actions=new FakeActions(w,'orchestrator');
    const config=loadConfig({LLM_MODE:'mock',ENABLE_SITREP:'1'});
    const agent=agentConfig('orchestrator',config);
    const run=()=>new Dispatcher(w,actions,agent,wake,1042,()=>{}).run('sitrep',{audience:'commander',reason:'Current board summary'});
    expect((await run()).ok).toBe(true);
    expect((await run()).error).toContain('once per 5 minutes');
    expect(w.tables.agent_task.filter(t=>t.kind==='sitrep')).toHaveLength(1);
  });
  it('completes proposal, review, briefing, and inspect with one chain',async()=>{
    const w=exampleWorld(),config=cfg(),fixtures=JSON.parse(readFileSync(new URL('./fixtures/chain.json',import.meta.url),'utf8')),llm=new MockLLM(fixtures),traces:any[]=[];
    await cycle(w,new FakeActions(w,'orchestrator'),llm,agentConfig('orchestrator',config),wake,config,t=>traces.push(t));
    for(const t of [...w.tables.agent_task])await cycle(w,new FakeActions(w,t.to_agent),llm,agentConfig(t.to_agent,config),{kind:t.kind,priority:t.priority,task_id:t.id},config,t=>traces.push(t));
    expect(w.tables.assignment).toHaveLength(1);expect(w.tables.agent_task.every(t=>t.status==='done')).toBe(true);expect(w.tables.briefing).toHaveLength(1);expect(w.tables.mission[0].kind).toBe('inspect');expect(traces.every(t=>t.chain_id===1042)).toBe(true);
  });
  it('dry shadow executes a full planning cycle without external reducer calls',async()=>{
    const w=exampleWorld(),before=JSON.stringify(w.tables),actual={call:vi.fn(async()=>{})};const runtime=dryActions(w,actual,'orchestrator','1');
    const config=cfg(),fixtures=JSON.parse(readFileSync(new URL('./fixtures/chain.json',import.meta.url),'utf8'));
    await cycle(runtime.world,runtime.actions,new MockLLM(fixtures),agentConfig('orchestrator',config),wake,config,()=>{});
    expect(actual.call).not.toHaveBeenCalled();expect(JSON.stringify(w.tables)).toBe(before);expect(runtime.world.tables.assignment).toHaveLength(1);
  });
  it('log dry mode allows action logs only',async()=>{const w=exampleWorld(),actual={call:vi.fn(async()=>{})};const runtime=dryActions(w,actual,'orchestrator','log');await runtime.actions.call('create_mission',{robot_id:'dog1'});await runtime.actions.call('log_agent_action',{result:'real'});expect(actual.call).toHaveBeenCalledTimes(1);expect(actual.call.mock.calls[0]).toEqual(['log_agent_action',{result:'dry_run: not executed'}]);});
  it('orchestrator failure never makes deterministic proposals',async()=>{const w=exampleWorld(),actions=new FakeActions(w,'orchestrator'),config=cfg();const result=await cycle(w,actions,new MockLLM({}),agentConfig('orchestrator',config),wake,config,()=>{});expect('fallback' in result && result.fallback).toBe(true);expect(w.tables.assignment).toHaveLength(0);expect(actions.calls.some(c=>c.name==='propose_assignment')).toBe(false);});
  it('answers a question only with board facts when the model is unavailable',async()=>{const w=exampleWorld(),config=cfg();w.tables.agent_task.push({id:1,run_id:3,to_agent:'comms_agent',kind:'answer_rescuer',status:'open',priority:'high',chain_id:1042,created_at:new Date(w.now()).toISOString(),payload_json:JSON.stringify({rescuer_identity:'a'.repeat(64),survivor_id:12,text:'Who else is here?'})});await cycle(w,new FakeActions(w,'comms_agent'),new MockLLM({}),agentConfig('comms_agent',config),{kind:'answer_rescuer',priority:'high',task_id:1},config,()=>{});expect(w.tables.briefing[0].kind).toBe('answer');expect(w.tables.briefing[0].text).toContain('1 unaccounted');});
});
