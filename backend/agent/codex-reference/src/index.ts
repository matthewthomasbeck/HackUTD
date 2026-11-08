import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { agentConfig } from './agents/index.js';
import { Budget } from './llm/budget.js';
import { MockLLM,NvidiaLLM } from './llm/client.js';
import { connect } from './stdb/connect.js';
import { Runtime } from './runtime.js';
import { trace } from './log.js';
import { runScenario } from '../scripts/scenario.js';
const cfg=loadConfig();
// A local fixture preview requires no account and cannot contact a database.
if(cfg.llmMode==='mock' && !cfg.database) {
  console.log('LOCAL FIXTURE PREVIEW: no SpacetimeDB connection or NVIDIA request.');
  await runScenario('chain');
}else{
  const budget=new Budget(cfg.rpm);
  const llm=cfg.llmMode==='mock'?new MockLLM(JSON.parse(readFileSync(new URL('../test/fixtures/chain.json',import.meta.url),'utf8'))):new NvidiaLLM(cfg,budget);
  const runtimes:Runtime[]=[],connections:{disconnect:()=>void}[]=[],timers:ReturnType<typeof setInterval>[]=[];
  const shutdown=()=>{for(const t of timers)clearInterval(t);for(const r of runtimes)r.stop();for(const c of connections)c.disconnect();budget.close();};
  process.once('SIGINT',()=>{shutdown();process.exit(0);});process.once('SIGTERM',()=>{shutdown();process.exit(0);});
  try {
    for(const name of cfg.agents) {
      let runtime:Runtime|undefined;
      const conn=await connect(cfg,name,(_w,table,row)=>runtime?.change(table,row));connections.push(conn);
      runtime=new Runtime(conn.world,conn.actions,llm,agentConfig(name,cfg),cfg,trace);runtimes.push(runtime);runtime.change('ready');
      timers.push(setInterval(()=>void runtime!.heartbeat().catch(error=>console.error(`Heartbeat failed: ${error.message}`)),name==='orchestrator'?5000:10000));
    }
  }catch(error){shutdown();console.error((error as Error).message);process.exitCode=1;}
}
