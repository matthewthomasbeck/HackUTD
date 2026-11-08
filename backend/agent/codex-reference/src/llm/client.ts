import OpenAI from 'openai';
import type { Config } from '../config.js';
import type { AgentConfig, Reply, Wake } from '../types.js';
import { parse, stripThinking } from './parse.js';
import { toolDefinitions } from '../tools/schemas.js';
import { Budget } from './budget.js';
export interface LLM { request(agent: AgentConfig, messages: any[], wake: Wake, deadline: number): Promise<{reply: Reply; message: any}>; isDown(name: string): boolean }
export class NvidiaLLM implements LLM {
  private client: OpenAI; private failures = new Map<string,number>(); private down = new Map<string,number>();
  constructor(private cfg: Config, private budget: Budget) {
    if (!cfg.apiKey) throw new Error('NVIDIA_API_KEY is required for LLM_MODE=nvidia');
    this.client = new OpenAI({apiKey:cfg.apiKey,baseURL:cfg.baseURL,maxRetries:0});
  }
  isDown(name: string) { return (this.down.get(name) || 0) > Date.now(); }
  async request(agent: AgentConfig, messages: any[], wake: Wake, deadline: number) {
    if (this.isDown(agent.name)) throw new Error('Model down for cooldown');
    const mode = agent.name === 'orchestrator' ? this.cfg.toolModeSuper : this.cfg.toolModeNano;
    let retry = 0, rateRetries = 0;
    for (;;) {
      await this.budget.acquire(agent.name, wake.priority, deadline);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Cycle deadline expired');
      try {
        const completion = await this.client.chat.completions.create({
          model:agent.model,messages,temperature:0.6,top_p:0.95,max_tokens:agent.maxTokens,stream:false,
          ...(mode === 'native' ? {tools:toolDefinitions(agent.tools),tool_choice:'auto'} : {}),
          ...(agent.name === 'orchestrator' ? {reasoning_effort:'low'} : {}),
          ...(agent.name !== 'orchestrator' && this.cfg.nanoThinkingOff ? {chat_template_kwargs:{enable_thinking:false}} : {}),
        } as any, {timeout:Math.min(agent.timeoutMs,remaining)});
        if (!completion.choices?.length) throw Object.assign(new Error('Empty choices or pending response'), {status:202});
        const message = completion.choices[0].message;
        const calls = message.tool_calls?.filter(t => t.type === 'function') ?? [];
        let reply: Reply;
        if(calls.length) reply = {actions:calls.map((c: any) => ({tool:c.function.name,args:JSON.parse(c.function.arguments)}))};
        else {
          const content = stripThinking(message.content || '');
          if (mode === 'json' || content.includes('{')) reply = parse(content);
          else reply = {done:true,summary:content.slice(0,300),actions:[]};
        }
        this.failures.set(agent.name,0); this.down.delete(agent.name);
        return {reply,message};
      } catch(error: any) {
        const status = error.status;
        const failures = (this.failures.get(agent.name) || 0) + 1;
        this.failures.set(agent.name,failures);
        if(status === 429 && rateRetries < 3) {
          const wait = 2000 * 2 ** rateRetries++ + Math.floor(Math.random()*1000);
          if(Date.now()+wait >= deadline) throw error;
          await new Promise(r => setTimeout(r,wait)); continue;
        }
        const retryable = status === 202 || status >= 500 || /timeout|timed out/i.test(error.message || '');
        if (failures >= 2) this.down.set(agent.name,Date.now()+60000);
        if(retryable && retry++ === 0 && !this.isDown(agent.name)) continue;
        throw error;
      }
    }
  }
}
export class MockLLM implements LLM {
  private indexes = new Map<string,number>();
  constructor(private replies: Record<string,Reply[]>) {}
  isDown() { return false; }
  async request(agent: AgentConfig) {
    const index = this.indexes.get(agent.name) || 0;
    this.indexes.set(agent.name,index+1);
    const reply = this.replies[agent.name]?.[index];
    if (!reply) throw new Error(`No matching MockLLM fixture for ${agent.name} step ${index}`);
    return {reply:structuredClone(reply),message:{role:'assistant',content:JSON.stringify(reply)}};
  }
}
